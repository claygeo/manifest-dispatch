# Manifest — Product Spec (build contract)

Last-mile delivery dispatch for dispensaries. Sits ON TOP of any POS (Sweed, Dutchie,
Jane) as an integration layer — we take packed orders, we run dispatch, tracking, and
compliant handoff. Not a POS replacement. Florida-medical (OMMU) delivery rules are
first-class product features, not fine print.

Live at **manifest.claygeo.dev**. Repo: `claygeo/manifest-dispatch` (public portfolio).

## Architecture (decided via outside-voice consult 2026-08-02 — do not relitigate)

- React 18 + Vite + TypeScript PWA. Single app, three routes:
  - `/` — dispatch console (desktop-first, works on tablet)
  - `/driver` — driver app (phone-first)
  - `/t/:orderCode` — customer tracking page (no auth)
- MapLibre GL JS + **custom style JSON** over OpenFreeMap vector tiles
  (`https://tiles.openfreemap.org/styles/liberty` as source reference — we author our
  own style layers per DESIGN.md; tiles are free, no key, production-allowed).
- State: zustand store. Sim engine and live engine feed the SAME store — UI never
  knows which mode it's in.
- **Demo mode (default)**: fully client-side. Simulated fleet plays `data/routes.json`
  (real Tampa road polylines, pre-fetched once from OSRM — NEVER call OSRM at
  runtime). Zero backend dependency for the recruiter first-click.
- **Live mode**: Supabase (project ref `fzmbemnmcfaesrhdtwop`, us-east-1) via
  Realtime broadcast channels. Phone publishes GPS; console + tracking page
  subscribe. Gated by an unguessable session code in the URL (`?live=<code>`) —
  public visitors can never mutate or see live sessions without the code.
- No real payments. Payment closeout = states only (CASH / DEBIT / DIGITAL).
- Hosting: Netlify, site name `manifest-dispatch`, custom_domain manifest.claygeo.dev.

## Data model (shared TypeScript types — the contract between all surfaces)

```ts
type StopStatus = 'pending' | 'enroute' | 'arrived' | 'id_check' | 'delivered' | 'exception'
type RunStatus = 'staged' | 'active' | 'complete'
type PaymentMethod = 'cash' | 'debit' | 'digital'

interface Stop {
  id: string            // 'run-a-1'
  orderCode: string     // 'MFST-4102' (mono, shown everywhere)
  customer: string      // first name + last initial on driver/console; full only on ticket
  address: string
  lngLat: [number, number]
  items: { name: string; qty: number }[]   // e.g. 'Flower 3.5g — Gelato'
  amountDue: number
  payment: PaymentMethod
  status: StopStatus
  window: [string, string]  // delivery window '2:00 PM'–'4:00 PM'
  etaMin: number | null     // live-updated
  idChecked: boolean
  closedAt: string | null
}

interface Run {
  id: string; label: string; driver: string; status: RunStatus
  stops: string[]          // ordered stop ids
  currentLeg: number       // index into legs
  progress: number         // 0..1 along current leg
  position: [number, number]
  heading: number
  manifestId: string       // 'MAN-2026-0802-A' — the compliance document id
}

interface DeliveryEvent {
  id: string; runId: string; stopId: string | null
  type: 'run_started' | 'departed' | 'arrived' | 'id_verified' | 'id_failed'
      | 'closed' | 'exception' | 'note'
  at: string; meta?: Record<string, string>
}
```

## Sim engine (the heart of the demo)

- Advances each active run along its precomputed legs at the leg's real OSRM speed
  ×(demo time multiplier ~8× so a 36-min run plays in ~4.5 min) with ±15% speed jitter
  and 20–75s dwell at each stop (arrive → id_check → delivered progression with
  realistic pauses).
- Runs loop: when all runs complete, the fleet resets to staged and re-dispatches
  itself after a short beat — an unattended browser tab always shows a living system.
- Emits DeliveryEvents into the store; ETAs recompute from remaining leg durations.
- One run should start mid-progress on load (recruiter sees motion in <3 seconds),
  one staged, one just starting. Stagger so the map never looks static.
- Deterministic-ish: seed jitter from stop index so replays feel similar but not
  looped-video identical.

## Dispatch console `/`

Full-bleed map (all three runs visible, Tampa). Floating panels:
- Left: run list — plate header per run, stop tickets beneath, drag not required:
  promote/demote stop order via up/down affordances on staged runs only.
- A run panel shows: driver, `STOP 3/5` chip, one display-size ETA numeral, window
  compliance state.
- Right (collapsible): event feed (chat-transcript style, mono timestamps).
- Top-left: `DEMO FLEET` chip + product wordmark plate. Top-right: theme toggle +
  `LIVE` entry (prompts for session code — see live mode).
- Click driver/run/stop ⇒ map flies to it, accent pulse on selection.
- Dispatch actions in demo mode: start a staged run, mark exception, reorder stops —
  all local, instant.

## Driver app `/driver`

- Run picker (staged/active runs) → ticket queue.
- Current stop = full-screen POS ticket: customer, address (tap = open in Maps app),
  items, `AMOUNT DUE $84.50`, payment method chip, delivery window, mono orderCode.
- One primary button per state: DEPART → ARRIVED → VERIFY ID → CLOSE (payment
  method select: cash keypad-style confirm / debit "reader linked" state / digital) →
  NEXT STOP. ID verify = full-screen check screen (name + DOB confirm + 21+ big
  yes/no) — no camera (cut by decision).
- Mini-map strip shows next leg only.
- GPS: in live mode uses `watchPosition` (high accuracy), lerp-smoothed, accuracy
  ring, heading from movement vector; `SIM GPS` toggle for dead interview rooms —
  plays the precomputed route instead.
- Exception path: NO ANSWER / CANNOT VERIFY → logs event, undeliverable state, next.

## Customer tracking `/t/:orderCode`

Works for any demo orderCode (e.g. MFST-4102). Card: status ladder (packed →
out for delivery → arriving → delivered), `2 STOPS AWAY` chip, ETA window, driver
first name, order summary, map with driver dot once out for delivery.

## Live mode (interview story)

- Console: enter/generate session code → creates `session:<code>` broadcast channel.
- Phone `/driver?live=<code>`: publishes GPS at 1Hz over the channel; console and
  tracking page render it exactly like sim data (same store).
- Supabase tables (thin, for session continuity): `live_sessions(code, created_at)`,
  `live_events` mirror of DeliveryEvents. RLS: anon can insert/select ONLY rows whose
  session code it knows. No PII, nothing sensitive — codes are ephemeral.
- If Supabase is unreachable, live mode degrades with an honest amber banner; demo
  mode never touches the network.

## Compliance surface (FL OMMU — the domain-credibility layer)

- Every run carries a **manifest**: `/manifest/:runId` printable document —
  mono/document styling, dispensary + vehicle + driver, ordered stops with orderCodes,
  window times, signature lines. "Print manifest" from console run panel.
- Delivery window enforcement: stops outside their window flag amber on console.
- ID verification is a mandatory state between arrived and closed — the driver
  cannot close a stop without it (the app enforces the law's shape).
- Footer of README + site: "Demo uses fictional data. Not affiliated with any
  licensed operator."

## Non-goals (cut by decision — do not build)

Camera/hardware hooks; route optimization builder (reordering is enough); real
payments; accounts/auth; multi-depot; Sweed API integration (positioning only —
"integration layer" is the pitch, the demo fakes the POS handoff with seeded orders).

## Definition of done

- First paint <3s on cable, map moving <3s after that, Lighthouse perf ≥85 mobile.
- Both themes flawless per DESIGN.md anti-slop checklist ON the map.
- Driver flow completable start-to-finish with thumbs only, no instructions.
- Zero console errors; works in Chrome + mobile Safari viewport.
- README: product story (the Sweed gap, integration-layer positioning), architecture,
  honest demo-vs-live caveats, screenshots both themes.
