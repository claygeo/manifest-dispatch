# Benchmarks

Measured proof for SPEC.md's production-adaptability bar: *"'Handles load' is a
number, not an adjective."*

Every figure below was produced by a script in this repo, on the date given, on
the machine described. Nothing is estimated, rounded up, or carried over from a
previous run. Where a number is unflattering it is still here.

**Run date: 2026-08-02.**

## The machine, and why that matters

| | |
|---|---|
| CPU | AMD Ryzen 7 5800HS, 8 cores / 16 threads |
| GPU | AMD Radeon integrated (ANGLE, Direct3D 11) |
| RAM | 23.4 GB |
| OS | Windows 11 Home 10.0.26200 |
| Node | v22.13.0 |
| Python | 3.12.10 |
| Browser | Chromium 149.0.7827.55 (Playwright) |
| Network | Consumer residential ISP, Wi-Fi, single machine |
| Supabase | Project `fzmbemnmcfaesrhdtwop`, free tier, us-east-1 |

This is a consumer laptop on consumer internet, not a datacenter host on a
provisioned link. The latency numbers include a residential last mile and the
frame-time numbers include whatever else Windows felt like doing during the
sample window. Treat these as "what one ordinary machine sees", which is also
what a dispensary's dispatch desk is.

---

## 1. Realtime fan-out (Supabase Broadcast)

**Script:** `scripts/bench-broadcast.mjs` · **Command:** `npm run bench:broadcast`
· **Run:** 2026-08-02T18:37:52Z to 18:39:33Z

### Method

For each tier N: open one broadcast channel, join N publisher clients plus one
subscriber, have every publisher send a GPS-shaped payload at 1 Hz for 25
seconds, and timestamp delivery at the subscriber. Every ping carries `t0`, a
`performance.now()` reading taken immediately before `channel.send`; the
subscriber takes a second reading in its broadcast handler and subtracts.
Publishers join in waves of 10 so a tier does not open 50 sockets in one tick.
A 3 second drain follows the last send so in-flight messages are counted rather
than scored as loss.

### The caveats, in the script's own words

These ship with the numbers because removing them would make the table worth
less, not more. Quoted verbatim from `scripts/bench-broadcast.mjs`:

> Publishers and subscriber run in the SAME node process, so both readings come
> off the same monotonic clock: there is no clock skew to correct for and no NTP
> assumption baked into the numbers. The cost of that choice is that the figure
> is a round trip through Supabase from one machine, not a phone-to-console
> wall-clock latency — a real deployment adds each device's own network leg.

> Manifest's own topology is one channel per session (one phone + console +
> tracking page); N publishers on ONE channel is a deliberate stress shape, not
> the product's shape.

So: this measures the server's fan-out under a load the product never generates
on a single channel, using a clock that cannot drift. It does not measure a real
phone's uplink.

### Results

| N publishers | Sent | Received | Loss | p50 | p95 | p99 | max | min | mean |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 246 | 246 | **0%** | 46.4 ms | 359.7 ms | 472.3 ms | 522 ms | 33.1 ms | 83.3 ms |
| 25 | 612 | 612 | **0%** | 74.9 ms | 154.9 ms | 327.5 ms | **2330 ms** | 31.0 ms | 96.8 ms |
| 50 | 1245 | 1245 | **0%** | 75.9 ms | 117.1 ms | 193.6 ms | 394.1 ms | 31.4 ms | 77.7 ms |

Zero duplicates, zero malformed payloads, zero send errors, zero join failures
across all three tiers. Every publisher that was asked to join, joined.

### What the server actually delivered

Because publishers join over a WebSocket exactly like the driver app does, the
server fans every ping out to the other N-1 publishers as well. That inbound
volume is the difference between what the test asks Supabase to *accept* and
what it asks Supabase to *deliver*:

| N | Messages accepted | Messages delivered |
|---:|---:|---:|
| 10 | 246 | 2,460 |
| 25 | 612 | 15,300 |
| 50 | 1,245 | 62,250 |

At N=50 the project delivered 62,250 messages in a 25 second window, roughly
2,500 messages per second, with zero loss to the subscriber.

### About that 2330 ms max at N=25

It is a real number from a real run and it stays in the table. It is a single
tail event: at N=25 the p99 was 327.5 ms, so the 2.3 second outlier is one
message, not a pattern, and the same tier lost nothing. The most likely cause is
a momentary stall on a consumer residential link or a scheduling hiccup on a
laptop running 25 WebSocket clients in one process. Note that the *heavier* tier
immediately after it (N=50) had a max of 394.1 ms, which is what argues against
this being server saturation.

Reported plainly rather than smoothed away: over consumer internet, a small
number of messages will arrive seconds late. A dispatch console has to be built
so that a late GPS ping is a cosmetic delay and never a lost delivery event.
That is why dispatch events go through the durable outbox in `src/live/queue.ts`
and GPS pings do not (`src/live/protocol.ts`).

---

## 2. Sim engine and map frame time

**Script:** `scripts/bench-sim.py` · **Command:** `npm run bench:sim` · **Run:** 2026-08-02

### Method

The script starts `vite preview` against the existing `dist/` on a private port,
drives Chromium through Playwright, and samples `requestAnimationFrame` deltas
inside the page while the demo fleet is actually animating: the same clock the
sim engine steps on (`src/sim/engine.ts`). Two phases of 20 seconds each:

- **baseline** the fleet as a visitor first sees it, which per SPEC is one run
  mid-route, one staged, one just starting. Measured state: 2 active, 1 staged.
- **loaded** every staged run dispatched from the console UI, so all runs animate
  at once. Measured state: **3 of 3 runs active, 0 staged**.

The console was measured at `/` for this run. The console is moving to
`/dispatch` as the story page takes the front door; the script probes `/dispatch`
first and falls back to `/`, and records the path that actually answered after
redirects, so the same command keeps measuring the console and not whatever else
ends up serving the root.

### Honesty rails in the script

- It refuses to publish numbers from a browser that is not really painting. A
  headless Chromium with no compositor can spin rAF at hundreds of Hz and produce
  a beautiful, meaningless 1 ms p95, so a p50 under 4 ms voids the run.
- It asserts the fleet actually moved during each window by diffing console state
  (run statuses, stop counters, ETA numerals, event feed length) before and
  after. No motion means the sample is void. Both phases passed.
- It records the GL renderer, because a map benchmark run on a software
  rasteriser measures the CPU rather than the product.

### Results: real GPU

`ANGLE (AMD, AMD Radeon Graphics, Direct3D11)`, `--headed`. This is what a user
with a normal machine gets.

| Phase | Frames | Mean FPS | p50 | p95 | p99 | max | >16.7 ms | >33.3 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (2 active) | 894 | 44.7 | 16.7 ms | 33.4 ms | 50.0 ms | 516.8 ms | 63.65% | 11.63% |
| loaded (3 of 3 active) | 889 | 44.3 | 16.7 ms | 33.4 ms | 34.3 ms | 50.1 ms | 58.16% | 22.72% |

The median frame is 16.7 ms, exactly one 60 Hz vsync interval, and p95 is 33.4
ms, exactly two. The renderer is vsync-locked and alternating between presenting
on every refresh and every second refresh.

The load result is the point: dispatching every run so all three animate
simultaneously did not degrade the frame budget. p50 and p95 are identical
between the two phases, p99 *improves* from 50.0 ms to 34.3 ms, and the max
drops from 516.8 ms to 50.1 ms. The 516.8 ms spike in the baseline window is a
startup cost, basemap tiles and style layers still landing, not a steady-state
cost of animating the fleet. Adding runs cost frames that were already being
paid for.

### Results: software rasteriser

`ANGLE (Google, Vulkan 1.3.0 SwiftShader Device, SwiftShader driver)`, default
headless. No GPU at all, every pixel rasterised on the CPU.

| Phase | Frames | Mean FPS | p50 | p95 | p99 | max | >16.7 ms | >33.3 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (2 active) | 340 | 17.0 | 66.6 ms | 66.8 ms | 83.4 ms | 99.9 ms | 100% | 100% |
| loaded (3 of 3 active) | 344 | 17.1 | 50.1 ms | 66.7 ms | 83.4 ms | 116.6 ms | 99.71% | 99.71% |

This is a floor, not a user-facing number, and it is included so nobody has to
wonder which one the headline came from. It is still useful: at roughly 17 fps
with no graphics hardware whatsoever, the app animates without stalling, and the
loaded phase again does not regress against baseline.

Zero console errors were logged in either mode, in either phase.

---

## 3. Bundle size

**Script:** `scripts/bench-bundle.mjs` · **Command:** `npm run build && npm run bench:bundle`
· **Run:** 2026-08-02T19:41:21Z

gzip level 9 is the conservative column and the one quoted here. Brotli is shown
alongside because Netlify prefers it when the client advertises support.

| Asset | Raw | gzip | Brotli | Critical path |
|---|---:|---:|---:|:---:|
| `assets/maplibre-*.js` | 1028.3 kB | 277.0 kB | 226.8 kB | yes |
| `assets/index-*.js` (app) | 334.0 kB | 103.4 kB | 87.6 kB | yes |
| `assets/index-*.js` (Supabase SDK) | 215.2 kB | 56.7 kB | 47.8 kB | **no, lazy** |
| `assets/index-*.css` | 105.2 kB | 16.7 kB | 14.1 kB | yes |
| `index.html` | 2.1 kB | 1.0 kB | 0.7 kB | yes |

| Total | Raw | gzip | Brotli |
|---|---:|---:|---:|
| Critical path (js + css + html) | 1469.6 kB | **398.1 kB** | 329.2 kB |
| Lazy chunks | 215.2 kB | 56.7 kB | 47.8 kB |
| All code | 1684.9 kB | 454.7 kB | 376.9 kB |

Fonts: 117.5 kB of woff2 across 8 files, already compressed and served as-is.
A further 135.6 kB of legacy `.woff` sits in `dist/` that no browser Manifest
targets will fetch, because woff2 is listed first in every `@font-face` src.

First visit is approximately **515.6 kB over the wire**: critical code gzipped
plus the woff2 faces. That figure is deliberately pessimistic, since it counts
all eight font files and a real visit only pulls the faces actually used.

**The check this script exists for:** SPEC's "zero backend dependency for the
recruiter first-click" claim rests on the Supabase SDK staying out of the entry
graph. Verified: `realtime-js` and `SupabaseClient` are in the lazy chunk
(56.7 kB gzip), which `index.html` does not reference. A visitor who never opens
LIVE never downloads the SDK. The only `preconnect` in the built HTML is to
`tiles.openfreemap.org`.

MapLibre is 70% of the critical path. That is the honest cost of a real vector
basemap and it is not something to code-split around, since the map is the first
thing on screen.

---

## 4. Test counts

| Suite | Command | Result |
|---|---|---|
| Unit / integration (vitest) | `npm test` | **242 passed**, 8 files, 0 failed, 9.82 s |
| Supabase RPC contract | `npm run test:rpc` | **25 passed**, 0 failed, 2.9 s |

The vitest suite covers the sim engine's determinism and state transitions, the
store actions that live mode feeds, the driver flow's legal ordering, ETA
recompute maths, the seed, the geo maths, delivery-window logic, and the offline
outbox.

`npm run test:rpc` fires at the real Supabase project with the real publishable
key the browser ships. It verifies the three SECURITY DEFINER RPCs, the 12
character server-side code floor, that unknown-code writes are silent no-ops,
that one session cannot read another's events, and that all seven direct table
operations (select / insert / update / delete on both tables) are rejected for
the anon role. That last group is what makes shipping the publishable key
defensible.

What `test:rpc` does not prove, stated by the script itself: the 2000-event
per-session cap and the 500 row read limit are asserted by reading the function
bodies, not by exercising them, because both would need thousands of sequential
round trips against a shared project.

---

## Not measured yet

- **Lighthouse mobile performance score.** SPEC asks for it and it has not been
  run. No number is quoted here rather than a guessed one.
- **Real device-to-device latency.** Every latency figure is one machine's round
  trip through Supabase. A phone on cellular adds its own uplink.
- **Multi-region.** Single project, us-east-1, one client location.
- **Sustained soak.** The longest window here is 25 seconds. Nothing states how
  this behaves over an 8 hour shift.

## Re-running

```bash
npm ci

npm test                              # 242 unit tests
npm run test:rpc                      # 25 contract checks, hits the real project

npm run build                         # required before either bench below
npm run bench:bundle                  # gzip / brotli sizes from dist/
npm run bench:sim                     # frame time, headless (software raster)
python scripts/bench-sim.py --headed  # frame time, real GPU

npm run bench:broadcast               # fan-out at N=10/25/50 against Supabase
```

Notes for anyone reproducing these:

- `bench:sim` needs `dist/` built and Playwright's Chromium installed. It starts
  and stops its own preview server on port 5226. Use `--port` if that is taken
  and `--path` to pin a console route instead of letting it probe.
- Run `--headed` for numbers that reflect a real user. The default headless run
  falls back to SwiftShader and measures your CPU.
- `bench:broadcast` opens up to 51 concurrent WebSocket clients against the live
  project and leaves nothing behind. `test:rpc` does leave a few throwaway
  session rows unless `SUPABASE_SERVICE_KEY` is set for cleanup; they hold no
  PII.
- Numbers will differ on your hardware and link. That is the point of publishing
  the method alongside them.
