# Production readiness

What in this repo would survive contact with a real dispensary, what is demo
scaffolding, and the ordered work to close the gap. SPEC.md sets the target:
*"could be used in production in a month if fine-tuned."* This document is the
honest accounting behind that claim.

The split below is per subsystem, not per feature, because the parts that are
genuinely production-shaped and the parts that are theatre do not line up with
what a user sees on screen.

---

## Production-grade today vs demo-grade today

### Production-grade today

| Subsystem | Where | Why it holds up |
|---|---|---|
| **State store** | `src/store.ts` | Single source of truth for every surface. The sim engine and the live engine call the same actions; no component branches on which engine is driving. Swapping the data source is a transport change, not a rewrite. 54 tests in `src/store.test.ts`. |
| **Delivery state machine** | `src/store.ts`, `src/driver/` | The legal ordering is enforced in the store, not just the UI: `closeStop` refuses a stop whose `idChecked` is false, so `arrived -> id_check -> closed` survives even if someone drives the store directly. `src/driver/IdCheckScreen.tsx` has no dismiss affordance, only a verdict. This is the shape a regulator cares about. |
| **Sim engine** | `src/sim/engine.ts`, `src/sim/geo.ts`, `src/sim/eta.ts` | Deterministic from a seed, replayable, tested for leg advancement bounds, dwell transitions and the hand-off when the driver app claims a run. 82 tests across the three files. Frame budget measured, not asserted (see BENCHMARKS.md). |
| **Offline event outbox** | `src/live/queue.ts` | The piece most demos skip. Dispatch events queue in `localStorage` with a retry ladder and survive a reload, because losing the tab is exactly when a phone in a dead zone gets closed. At the cap the oldest entry is dropped and counted, never dropped silently. Transport-agnostic, so it is testable without a socket. 19 tests. |
| **Server access control** | `src/live/session.ts`, `src/live/config.ts`, `scripts/test-rpcs.mjs` | Three SECURITY DEFINER RPCs are the entire public surface. The anon role has no table grants at all: 7 direct table operations are verified rejected. Session code is the authorisation and the server enforces a 12 character floor. Unknown-code writes are silent no-ops. 25 contract checks run against the real project. |
| **Failure states** | `src/live/session.ts`, `src/live/LiveBanner.tsx` | Every network call is wrapped. Anything that fails puts the store in `degraded`, raises an amber banner and leaves the local sim running underneath. Nothing in the live path can throw into a component. |
| **Privacy posture on GPS** | `src/live/protocol.ts`, `src/live/session.ts` | GPS pings are broadcast only and never persisted. Writing 1 Hz location rows is the one part of this system that would genuinely deserve a privacy review, and it was designed out rather than deferred. |
| **Compliance document** | `src/manifest/ManifestPage.tsx` | The manifest is a real printable document generated from run state, not a mock-up image. Delivery-window state is computed in `src/window.ts` (18 tests) and flagged where a dispatcher must act. |
| **Measured load proof** | `scripts/bench-*.{mjs,py}`, BENCHMARKS.md | Re-runnable scripts with honesty gates that refuse to publish void results, plus published numbers with method and date. |

### Demo-grade today

| Subsystem | Where | What is actually missing |
|---|---|---|
| **Order ingestion** | `src/data/seed.ts`, `src/data/routes.json` | Orders are generated client-side from a static seed. There is no POS. Nothing has ever received a real order, and the "integration layer" positioning is a claim about architecture, not a shipped integration. This is the single largest gap. |
| **Persistence** | `src/store.ts` (in memory), Supabase `live_events` | Runs, stops and manifests exist only in the tab. Only live-mode dispatch events reach the server, and only for session continuity. Close the browser in production and the shift is gone. |
| **Identity and access** | none | No auth, no accounts, no roles. Anyone with the URL is a dispatcher. Live sessions are gated by an unguessable 16 character code, which is adequate for an ephemeral demo session and is not an authorisation model. |
| **Tenancy** | none | Single implicit operator. No dispensary, licence, or depot entity exists anywhere in `src/types.ts`. |
| **ID verification** | `src/driver/IdCheckScreen.tsx` | Attestation only: the driver confirms name, DOB and 21+ against what is on screen. No camera, no barcode or PDF417 scan, no photo evidence retained. Cut by decision in SPEC and correct for a demo, but a real deployment's audit trail records *what was checked*, not that someone tapped yes. |
| **Payments** | `src/driver/PaymentScreen.tsx` | States only. The cash path does real tender and change arithmetic because that is what a driver does at the door; debit and digital are honest ladders that say SIMULATED on screen. No terminal, no processor, no settlement. |
| **Routing** | `src/data/routes.json` | Real OSRM polylines, pre-fetched once. No live routing, no re-optimisation, no traffic. Stop order is manual by design. |
| **Regulatory model** | `src/window.ts`, `src/driver/`, `src/manifest/` | Florida OMMU rules are expressed in code and copy rather than in configuration. A second state means editing components. |
| **Infrastructure** | Supabase free tier, us-east-1 | Single region, single project, no backups, no migrations directory in this repo, no staging environment, no monitoring or alerting. |
| **QA coverage** | `src/**/*.test.ts`, `scripts/` | Strong at the unit and contract layer, thin above it. No end-to-end browser test asserts the driver flow end to end; the only automated browser work is the frame-time bench. Cross-device checking has been manual. |

---

## The one-month path, in order

Sequenced by dependency, not by visibility. Each item assumes the ones above it
are done.

### 1. POS order ingestion

Replace `src/data/seed.ts` as the source of truth with real orders.

- Webhook receiver for packed-order events, one adapter per POS (Sweed, Dutchie,
  Jane), normalising to the existing `Stop` shape in `src/types.ts`. That type is
  already the contract every surface reads, so the blast radius is the adapter
  layer plus persistence.
- Idempotency on external order id. POS webhooks retry; a duplicate must not
  become a second stop on a manifest.
- Order lifecycle beyond creation: cancelled after dispatch and item-level
  amendments already have handled states in the store, but they currently
  originate from a UI action rather than an upstream event.
- Persist runs, stops and events server-side. Until this exists nothing else on
  this list can be relied on, because there is no record to secure, retain or
  audit.
- Reconciliation: a periodic pull to catch webhooks that were never delivered.
  Silent divergence between POS and dispatch is worse than a visible error.

Keeps the positioning honest: the pitch is an integration layer, and today the
integration is the part that does not exist.

### 2. Auth and the role model

Nothing below this line is meaningful without it.

- Three roles: **dispatcher** (console, reorder, dispatch, exceptions),
  **driver** (own assigned runs only, ticket flow, closeout), **admin** (fleet
  and user management, audit access).
- Supabase Auth with row-level security keyed on operator id and role. The RPC
  pattern already in `src/live/session.ts` is the right shape; the session code
  becomes a session-scoping detail rather than the authorisation itself.
- A driver must not be able to read another driver's manifest, and no client
  should be able to read across operators. Extend `scripts/test-rpcs.mjs` with
  negative cases per role, since that script is already the mechanism that
  catches a permissive grant added while debugging.
- Phone sessions need to survive a shift: refresh tokens, and a locked state that
  does not lose the outbox in `src/live/queue.ts`.

### 3. Fleet and driver onboarding

- Entities that do not exist yet: operator/licensee, depot, vehicle, driver.
  Vehicle and driver currently appear as strings on `Run` in `src/types.ts` and
  on the printed manifest.
- Driver records need the fields the manifest legally carries: agent card or
  licence number and expiry, assigned vehicle, and an active/inactive state.
- Expiry enforcement: a driver whose credential lapsed cannot be assigned a run.
  This is a real operational failure mode and it is a validation rule, not a
  feature.
- Admin surface for assignment. Runs are currently built by the seed generator.

### 4. Manifest retention and audit

- Immutable manifests. Once dispatched, a manifest is a record: amendments append
  rather than overwrite, and the printed document shows its own revision.
- Retention window per state rule, with export. Assume an auditor asks for a
  named date range and wants documents, not a database.
- Append-only event log with actor identity. `DeliveryEvent` in `src/types.ts`
  already carries type, timestamp and meta; it needs *who*, which only exists
  after step 2.
- Signature capture at handoff, currently a printed line on the document.
- Tie the outbox to retention: `src/live/queue.ts` already refuses to drop events
  silently, and its `dropped` counter must become an alert rather than a banner
  once the log is a compliance artifact.

### 5. Payment terminal integration boundary

The terminal itself stays out of scope. The boundary it plugs into does not.

- `src/driver/PaymentScreen.tsx` already models closeout as a state ladder with
  the terminal's steps represented (`Linking reader`, `Reader linked`, `Card
  presented`, `Approved`). Extract that into a `PaymentProvider` interface:
  `authorise`, `capture`, `void`, plus a status stream the ladder renders.
- The simulated ladder becomes the reference implementation of that interface,
  which keeps demo mode working unchanged and gives an integrator a contract to
  satisfy.
- Required regardless of provider: an idempotency key per stop, a terminal
  reference id stored on the closed stop, and a defined resolution for the
  approved-but-app-crashed case. That last one is the reason to design the
  boundary now instead of during the integration.
- Cash stays first-class. It is the dominant tender in this market and the
  arithmetic is already real.
- Out of scope here and stated plainly: PCI scope, processor selection, hardware
  provisioning, settlement and refunds.

### 6. Multi-state regulation configuration

- Lift Florida's rules out of components into a per-jurisdiction config:
  delivery window rules (`src/window.ts`), whether ID verification is mandatory
  and what it must record, manifest required fields, quantity limits, permitted
  delivery hours, and vehicle or manifest carriage rules.
- Jurisdiction is a property of the operator's licence, resolved at dispatch and
  attached to the manifest, so a record can always be read against the rules that
  applied when it was created.
- The state machine stays fixed; only the predicates around it vary. Keeping the
  ladder constant across jurisdictions is what makes one driver app viable in
  more than one market.
- Tests per jurisdiction, using the harness in `src/test/harness.ts`.

---

## What would still not be done after a month

Listed so the estimate is not read as a promise:

- End-to-end browser test coverage of the driver flow, and cross-device testing
  beyond manual checks.
- Real routing and re-optimisation, multi-depot, traffic-aware ETAs.
- Multi-region, backups, disaster recovery, staging, monitoring and alerting.
- SOC 2, formal pen testing, or a privacy review of anything that persists
  customer location.
- Any of the ID-scanning hardware path.

The one-month target is "a real operator could run a pilot shift on this without
losing a record". It is not "this is a finished product".
