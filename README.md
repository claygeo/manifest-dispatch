# Manifest

**Live demo: [manifest.claygeo.dev](https://manifest.claygeo.dev)**

Last-mile delivery dispatch for dispensaries. Full-page map dispatch console, a
driver app that works like a POS ticket queue, customer tracking links, and
Florida-compliance features (delivery manifests, ID verification, delivery windows)
built into the flow instead of bolted on.

## Why this exists

I spent three years in cannabis retail operations, including dispensary delivery.
The stack we actually ran was two systems duct-taped together: orders were logged
and packed in the POS/e-commerce platform, but its delivery surface was a tiny map
square with no real tracking — so day-to-day dispatch ran on a *second* map app tied
to an Android phone, because that was the only thing that could answer "where is the
driver actually right now?" Accountability, routing, and compliance lived in the gap
between the two.

Manifest is what I wanted that second system to be: an integration layer that sits
on top of any POS (Sweed, Dutchie, Jane) and owns everything after the order is
packed — dispatch, live tracking, compliant handoff, closeout.

## What it does

- **Dispatch console** (`/`) — the whole page is the map. Runs and stop tickets
  float over it as panels. Start runs, reorder stops, watch ETAs drift, catch
  delivery-window violations before they happen.
- **Driver app** (`/driver`) — phone-first ticket queue. One primary action per
  state: depart → arrived → verify ID → close (cash / debit / digital) → next stop.
  A driver who has never used software doesn't have to think.
- **Customer tracking** (`/t/MFST-4102`) — no-account tracking link: stops away,
  ETA window, driver position.
- **Compliance** — every run carries a printable delivery manifest; ID verification
  is a mandatory state (you cannot close a stop without it); delivery windows are
  enforced in the UI, not a PDF appendix.

## Demo vs. live — honest boundaries

- **Demo fleet (what you see on load)** is simulated, and labeled as such on
  screen. Drivers follow real Tampa road polylines (precomputed once from OSRM,
  shipped as static JSON) with realistic speeds, dwell times, and event flow.
  It runs entirely client-side: the first click can never hit a dead backend.
- **Live mode** connects a real phone as the driver device over Supabase Realtime:
  the phone publishes GPS, the console and tracking pages render it through the
  exact same state store as the simulation. Sessions are gated by unguessable
  codes; GPS pings are ephemeral broadcast only and never persisted.
- Payments are closeout **states** (cash / debit / digital), not processing.
- All customer data is fictional. Not affiliated with any licensed operator.

## Architecture

React 18 + Vite + TypeScript PWA · MapLibre GL with a custom-authored basemap
style (both themes) over OpenFreeMap vector tiles · zustand store fed identically
by the sim engine or Supabase Realtime · Postgres RPCs (security-definer, no
direct table grants to anon) for live-session events · Netlify hosting.

The design system is documented in [DESIGN.md](DESIGN.md); the product contract in
[SPEC.md](SPEC.md).

## Running locally

```bash
npm install
npm run dev
```

---

Built by [Clayton George](https://claygeo.dev) · claygeo6@gmail.com
