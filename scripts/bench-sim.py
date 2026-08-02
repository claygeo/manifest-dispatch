"""
bench-sim - sim engine + MapLibre frame-time budget (SPEC.md "Measured load proof").

What it does
    Builds nothing and assumes nothing: it starts `npx vite preview` against the
    existing dist/ on a private port, drives a real Chromium through Playwright,
    and samples requestAnimationFrame deltas in the page while the demo fleet is
    actually animating. Two phases:

      baseline  the fleet as a visitor first sees it (SPEC's opening plan:
                one run mid-route, one staged, one just starting)
      loaded    every staged run dispatched from the console UI, so all runs
                animate simultaneously - the stress case SPEC asks for

    Frame times come from performance.now() deltas inside a rAF loop running in
    the page, i.e. the same clock the sim engine itself steps on
    (src/sim/engine.ts). Reported as p50 / p95 / p99 / max plus the share of
    frames over 16.7 ms and 33.3 ms.

Honesty rails baked into the script
    - It refuses to report numbers from a browser that is not really painting.
      A headless Chromium with no compositor can spin rAF at hundreds of Hz and
      produce a beautiful, meaningless 1 ms p95. The script therefore asserts
      that the sampled median lands in a plausible display cadence band and
      fails loudly otherwise.
    - It asserts the fleet actually moved during each sample window (driver
      position deltas read off the DOM-independent store proxy: the map's own
      marker transform is not available, so it uses the console's ETA/stop
      counters and the event feed length). No motion => the sample is void.
    - Every number printed is measured in that run. Nothing is cached.

Usage
    npm run bench:sim
    python scripts/bench-sim.py --seconds 20 --port 5226 [--headed]

Requires: dist/ built (`npm run build`), playwright chromium installed.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import statistics
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - environment problem, not a result
    print("bench-sim: playwright is not installed (pip install playwright)", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parent.parent

# rAF sampler. Collects raw deltas; the page keeps the array so a long window
# costs one array push per frame and nothing else.
SAMPLER_START = """
() => {
  window.__benchFrames = [];
  window.__benchStop = false;
  let last = performance.now();
  const tick = (now) => {
    if (window.__benchStop) return;
    window.__benchFrames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
"""

SAMPLER_STOP = """
() => {
  window.__benchStop = true;
  const f = window.__benchFrames || [];
  window.__benchFrames = [];
  return f;
}
"""


def pct(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return float("nan")
    i = min(len(sorted_vals) - 1, max(0, int(round((p / 100) * len(sorted_vals) + 0.5)) - 1))
    return sorted_vals[i]


def summarize(frames: list[float]) -> dict:
    # Drop the first frame: it measures the gap since the sampler was installed,
    # not a rendered frame.
    vals = [f for f in frames[1:] if f > 0]
    s = sorted(vals)
    over16 = sum(1 for v in vals if v > 16.7)
    over33 = sum(1 for v in vals if v > 33.3)
    return {
        "frames": len(vals),
        "fps_mean": round(1000 / statistics.fmean(vals), 1) if vals else None,
        "p50_ms": round(pct(s, 50), 2) if vals else None,
        "p95_ms": round(pct(s, 95), 2) if vals else None,
        "p99_ms": round(pct(s, 99), 2) if vals else None,
        "max_ms": round(s[-1], 2) if vals else None,
        "over_16_7ms_pct": round(100 * over16 / len(vals), 2) if vals else None,
        "over_33_3ms_pct": round(100 * over33 / len(vals), 2) if vals else None,
    }


def wait_for_port(port: int, timeout_s: float = 40.0) -> bool:
    """
    Poll until something accepts on `port`.

    Both address families, deliberately: `vite preview` binds localhost, which on
    Windows resolves to ::1 only. An AF_INET-only probe therefore reports "never
    came up" against a server that is up and serving, so the readiness check has
    to ask the resolver the same question the browser will.
    """
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            infos = socket.getaddrinfo("localhost", port, type=socket.SOCK_STREAM)
        except socket.gaierror:
            infos = [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", port))]
        for family, socktype, proto, _canon, addr in infos:
            with socket.socket(family, socktype, proto) as sock:
                sock.settimeout(0.5)
                if sock.connect_ex(addr) == 0:
                    return True
        time.sleep(0.3)
    return False


def fleet_probe(page) -> dict:
    """
    Cheap liveness read straight off the rendered console.

    Run status is NOT printed as text anywhere in the panel header (`.plate >
    span` is the manifest id), so status is derived from the one element whose
    wording is a function of it: the single display numeral's label, which
    src/console/RunPanel.tsx sets to 'Planned · min' when staged, 'Next stop ·
    min' when active and 'Run closed' when complete. Everything else here is
    matched case-insensitively — the DOM carries sentence case ('Dispatch run',
    'Stop 2/4') and CSS does the uppercasing.
    """
    return page.evaluate(
        """
        () => {
          const txt = (n) => (n.textContent || '').trim();
          const panels = Array.from(document.querySelectorAll('[data-sel-id^="run:"]'));
          const statusOf = (panel) => {
            const label = txt(panel.querySelector('.dc-run__eta .label')).toLowerCase();
            if (label.startsWith('next stop')) return 'active';
            if (label.startsWith('planned')) return 'staged';
            if (label.startsWith('run closed')) return 'complete';
            return 'unknown';
          };
          return {
            runPanels: panels.length,
            statuses: panels.map(statusOf),
            stopChips: Array.from(document.querySelectorAll('.chip'))
              .map(txt).filter((t) => /^stop /i.test(t)),
            etas: Array.from(document.querySelectorAll('.numeral')).map(txt),
            feedRows: document.querySelectorAll('.dc-ev').length,
            dispatchButtons: Array.from(document.querySelectorAll('button'))
              .filter((b) => txt(b).toLowerCase() === 'dispatch run').length,
          };
        }
        """
    )


def sample(page, seconds: float, label: str) -> dict:
    before = fleet_probe(page)
    page.evaluate(SAMPLER_START)
    time.sleep(seconds)
    frames = page.evaluate(SAMPLER_STOP)
    after = fleet_probe(page)
    summary = summarize(frames)
    summary["phase"] = label
    summary["seconds"] = seconds
    summary["moved"] = before != after
    summary["fleet_before"] = before
    summary["fleet_after"] = after
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--port", type=int, default=5226)
    ap.add_argument("--headed", action="store_true", help="run Chromium with a visible window")
    ap.add_argument("--json-out", type=str, default="")
    ap.add_argument(
        "--path",
        type=str,
        default="",
        help="console route to measure; empty = probe /dispatch then / and use whichever renders run panels",
    )
    args = ap.parse_args()

    dist = ROOT / "dist" / "index.html"
    if not dist.exists():
        print("bench-sim: dist/index.html missing - run `npm run build` first", file=sys.stderr)
        return 2

    npx = "npx.cmd" if os.name == "nt" else "npx"
    server = subprocess.Popen(
        [npx, "vite", "preview", "--port", str(args.port), "--strictPort"],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    results: dict = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "seconds_per_phase": args.seconds,
        "headed": args.headed,
        "phases": [],
    }

    try:
        if not wait_for_port(args.port):
            print("bench-sim: vite preview never came up", file=sys.stderr)
            return 2

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed)
            ctx = browser.new_context(
                viewport={"width": 1440, "height": 900},
                device_scale_factor=1,
                color_scheme="dark",
            )
            page = ctx.new_page()
            console_errors: list[str] = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

            # The console route moved from / to /dispatch when the story page
            # took the front door. Probe rather than hardcode, so this script
            # keeps measuring the console and not whatever else answers /.
            candidates = [args.path] if args.path else ["/dispatch", "/"]
            console_path = None
            for candidate in candidates:
                page.goto(f"http://localhost:{args.port}{candidate}", wait_until="load")
                try:
                    page.wait_for_selector('[data-sel-id^="run:"]', timeout=15_000)
                except Exception:
                    continue
                # The route that ANSWERED, after any redirect — the app's
                # catch-all can serve the console from a path that does not
                # exist yet, and reporting the requested path would lie.
                console_path = candidate
                break
            if console_path is None:
                print(
                    f"bench-sim: no console found at {', '.join(candidates)} "
                    "(no run panels rendered) — pass --path",
                    file=sys.stderr,
                )
                return 2
            results["console_path_requested"] = console_path
            results["console_path"] = urlparse(page.url).path
            # Map tiles + fonts + first fleet paint. The console renders its run
            # panels from the store immediately, so this is about the basemap.
            page.wait_for_timeout(6_000)

            results["ua"] = page.evaluate("() => navigator.userAgent")
            results["hardware_concurrency"] = page.evaluate("() => navigator.hardwareConcurrency")
            # Which rasteriser actually drew the map. Headless Chromium falls
            # back to SwiftShader (CPU) unless a GPU is wired up, and a map
            # benchmark run on SwiftShader measures the CPU, not the product.
            # Recording it means the reader can tell which one they are looking at.
            results["gl_renderer"] = page.evaluate(
                """
                () => {
                  const c = document.createElement('canvas');
                  const gl = c.getContext('webgl2') || c.getContext('webgl');
                  if (!gl) return 'no webgl context';
                  const ext = gl.getExtension('WEBGL_debug_renderer_info');
                  return ext
                    ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} / ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`
                    : `${gl.getParameter(gl.VENDOR)} / ${gl.getParameter(gl.RENDERER)}`;
                }
                """
            )

            # ---- phase 1: the fleet as loaded (SPEC opening plan) -----------
            results["phases"].append(sample(page, args.seconds, "baseline"))

            # ---- phase 2: dispatch everything, all runs animating -----------
            dispatched = 0
            for _ in range(8):
                btns = page.locator("button", has_text="DISPATCH RUN")
                if btns.count() == 0:
                    break
                btns.first.click()
                dispatched += 1
                page.wait_for_timeout(400)
            page.wait_for_timeout(1_500)

            pre_loaded = fleet_probe(page)
            loaded = sample(page, args.seconds, "loaded")
            loaded["dispatched_clicks"] = dispatched
            loaded["active_runs"] = pre_loaded["statuses"].count("active")
            loaded["staged_runs"] = pre_loaded["statuses"].count("staged")
            loaded["complete_runs"] = pre_loaded["statuses"].count("complete")
            loaded["total_runs"] = pre_loaded["runPanels"]
            results["phases"].append(loaded)

            results["console_errors"] = console_errors
            browser.close()
    finally:
        # npx.cmd is a shim: terminating it on Windows leaves the real vite node
        # process holding the port, so the NEXT run dies with "port in use".
        # Kill the tree, not the shim.
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(server.pid)],
                capture_output=True,
                check=False,
            )
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()

    # ---- honesty gate: refuse to publish numbers from a fake compositor ----
    problems = []
    for phase in results["phases"]:
        p50 = phase.get("p50_ms")
        if p50 is None:
            problems.append(f"{phase['phase']}: no frames sampled")
            continue
        if p50 < 4.0:
            problems.append(
                f"{phase['phase']}: p50 {p50}ms implies ~{round(1000 / p50)}fps - "
                "the browser is spinning rAF without presenting frames; numbers are void"
            )
        if not phase.get("moved"):
            problems.append(f"{phase['phase']}: fleet state did not change during the window")
    results["valid"] = not problems
    results["problems"] = problems

    print(json.dumps(results, indent=2))
    print()
    print("SUMMARY")
    for phase in results["phases"]:
        print(
            f"  {phase['phase']:<9} frames {phase['frames']:>5}"
            f"  p50 {phase['p50_ms']:>6} ms"
            f"  p95 {phase['p95_ms']:>6} ms"
            f"  p99 {phase['p99_ms']:>6} ms"
            f"  max {phase['max_ms']:>7} ms"
            f"  >16.7ms {phase['over_16_7ms_pct']:>5}%"
        )
    if problems:
        print("\nINVALID:")
        for problem in problems:
            print(f"  - {problem}")

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(results, indent=2), encoding="utf-8")

    return 0 if results["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
