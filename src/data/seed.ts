/**
 * Fleet seed — turns the precomputed OSRM route file into Stops, Runs and the
 * opening DeliveryEvents.
 *
 * Everything here is deterministic: the same generation number always produces
 * the same orders, amounts and dwell timings. Order codes are stable across
 * fleet resets on purpose, so a `/t/MFST-4102` tracking link keeps working for
 * the whole session.
 *
 * ALL DATA IS FICTIONAL. Customers, addresses, orders and drivers are invented
 * for the demo. Not affiliated with any licensed operator.
 */

import routesRaw from './routes.json'
import type {
  DeliveryEvent,
  DeliveryEventType,
  PaymentMethod,
  RouteData,
  RouteLeg,
  Run,
  Stop,
} from '../types'
import { hashSeed, pointOnLeg, prepareLeg, rng, type LngLat, type PreparedLeg } from '../sim/geo'
import { dwellFor, etaMinutesTo } from '../sim/eta'
import { formatClock, formatDocDate, formatMoney, PAYMENT_LABEL } from '../format'

export const ROUTES = routesRaw as unknown as RouteData
export const DEPOT: LngLat = [ROUTES.depot.lon, ROUTES.depot.lat]
export const DEPOT_NAME = ROUTES.depot.name
export const RUN_IDS = ROUTES.runs.map((r) => r.id)

/* ---------------------------------------------------------------- routes -- */

const legCache = new Map<string, PreparedLeg[]>()

/**
 * Legs for runs that are not in routes.json — a run the visitor built in the
 * `/plan` sandbox, whose geometry comes from the leg matrix instead.
 *
 * This is the whole seam. Everything downstream (the sim engine, the map's
 * travelled/ahead split, the driver's mini-map, ETA maths) asks `legsFor` and
 * cannot tell where the polyline came from, which is the same rule the store
 * follows for the sim and live engines.
 */
const dynamicLegs = new Map<string, PreparedLeg[]>()

/**
 * Give a run id its own legs, depot -> stops -> depot, index-aligned with
 * `Run.stops` plus one closing leg. Overwrites any previous registration.
 */
export function registerRunLegs(runId: string, legs: RouteLeg[]): void {
  dynamicLegs.set(runId, legs.map(prepareLeg))
  legCache.delete(runId)
}

export function hasRegisteredLegs(runId: string): boolean {
  return dynamicLegs.has(runId)
}

/** Prepared (cumulative-distance) legs for a run. Memoised — parse once. */
export function legsFor(runId: string): PreparedLeg[] {
  const registered = dynamicLegs.get(runId)
  if (registered) return registered
  const cached = legCache.get(runId)
  if (cached) return cached
  const run = ROUTES.runs.find((r) => r.id === runId)
  const prepared = (run?.legs ?? []).map(prepareLeg)
  legCache.set(runId, prepared)
  return prepared
}

/** Full ordered polyline for a run, depot -> stops -> depot. */
export function routeLineFor(runId: string): LngLat[] {
  const out: LngLat[] = []
  for (const leg of legsFor(runId)) {
    for (const c of leg.coords) {
      const last = out[out.length - 1]
      if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c)
    }
  }
  return out
}

/* ------------------------------------------------------------- catalogue -- */

interface CatalogItem {
  name: string
  price: number
}

/** Fictional menu. Weights follow a real delivery basket: flower anchors, accessories fill. */
const CATALOG: CatalogItem[] = [
  { name: 'Flower 3.5g — Gelato #33', price: 45 },
  { name: 'Flower 3.5g — Wedding Cake', price: 42 },
  { name: 'Flower 7g — Blue Dream', price: 72 },
  { name: 'Flower 3.5g — Sour Diesel', price: 40 },
  { name: 'Preroll 1g — Northern Lights', price: 14 },
  { name: 'Preroll 5pk 0.5g — Runtz', price: 45 },
  { name: 'Vape Cart 0.5g — Pineapple Express', price: 38 },
  { name: 'Vape Cart 1g — Granddaddy Purple', price: 60 },
  { name: 'Disposable 0.3g — Jack Herer', price: 30 },
  { name: 'Gummies 10pk — Sour Mango 10mg', price: 25 },
  { name: 'Gummies 20pk — Blue Razz 5mg', price: 32 },
  { name: 'Chews 10pk — Watermelon 10mg', price: 26 },
  { name: 'Tincture 30ml — 1:1 CBD:THC', price: 55 },
  { name: 'Topical 50ml — Relief Balm', price: 35 },
]

const AMOUNT_MIN = 45
const AMOUNT_MAX = 180
const TAX_RATE = 0.07

function buildBasket(key: string): { items: { name: string; qty: number }[]; amountDue: number } {
  const r = rng(hashSeed(`${key}#basket`))
  const pool = CATALOG.map((c, i) => ({ c, k: r() + i * 1e-6 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.c)

  const items: { name: string; qty: number }[] = []
  let subtotal = 0
  for (const pick of pool) {
    if (items.length >= 3) break
    const qty = r() < 0.22 ? 2 : 1
    const next = subtotal + pick.price * qty
    if (next > AMOUNT_MAX / (1 + TAX_RATE)) continue
    items.push({ name: pick.name, qty })
    subtotal = next
    if (subtotal >= AMOUNT_MIN && r() < 0.55) break
  }
  if (items.length === 0) {
    items.push({ name: CATALOG[0].name, qty: 1 })
    subtotal = CATALOG[0].price
  }

  // round to the quarter — dispensary POS totals are never long decimals
  let amountDue = Math.round(subtotal * (1 + TAX_RATE) * 4) / 4
  amountDue = Math.min(AMOUNT_MAX, Math.max(AMOUNT_MIN, amountDue))
  return { items, amountDue }
}

function paymentFor(key: string): PaymentMethod {
  const v = rng(hashSeed(`${key}#pay`))()
  if (v < 0.45) return 'cash'
  if (v < 0.75) return 'debit'
  return 'digital'
}

/** Stable order code: MFST-4xxx, unique across the fleet, same every session. */
function orderCodeFor(runIndex: number, stopIndex: number): string {
  const r = rng(hashSeed(`order#${runIndex}#${stopIndex}`))
  const base = 4100 + runIndex * 40 + stopIndex * 7
  return `MFST-${base + Math.floor(r() * 6)}`
}

/* ------------------------------------------------------------- dispatch --- */

interface RunPlan {
  status: Run['status']
  currentLeg: number
  progress: number
}

/**
 * SPEC: "One run should start mid-progress on load, one staged, one just
 * starting. Stagger so the map never looks static."
 */
const OPENING_PLAN: RunPlan[] = [
  { status: 'active', currentLeg: 2, progress: 0.42 },
  { status: 'staged', currentLeg: 0, progress: 0 },
  { status: 'active', currentLeg: 0, progress: 0.03 },
]

/** Window anchor offsets in minutes, relative to the session start, per run. */
const WINDOW_RUN_OFFSET_MIN = [-75, -10, -25]
const WINDOW_STOP_STEP_MIN = 35
const WINDOW_SPAN_MIN = 120

function floorToQuarterHour(ms: number): number {
  const d = new Date(ms)
  d.setSeconds(0, 0)
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15)
  return d.getTime()
}

export interface Fleet {
  runs: Run[]
  stops: Stop[]
  events: DeliveryEvent[]
  /** Sim wall-clock at the moment this fleet was built. */
  simEpoch: number
}

/**
 * Build a whole fleet.
 * @param generation 0 = first dispatch of the session (staggered opening plan).
 *                   >0 = post-reset re-dispatch; every run returns to `staged`
 *                   and the engine dispatches them on its own stagger.
 * @param nowMs      sim wall-clock to anchor windows and back-dated events to.
 */
export function buildFleet(generation = 0, nowMs: number = Date.now()): Fleet {
  const runs: Run[] = []
  const stops: Stop[] = []
  const events: DeliveryEvent[] = []
  const anchor = floorToQuarterHour(nowMs)
  const docDate = formatDocDate(nowMs).replace(/-/g, '').slice(0, 8)

  ROUTES.runs.forEach((route, runIndex) => {
    const legs = legsFor(route.id)
    const plan: RunPlan =
      generation === 0
        ? (OPENING_PLAN[runIndex] ?? { status: 'staged', currentLeg: 0, progress: 0 })
        : { status: 'staged', currentLeg: 0, progress: 0 }

    const letter = String.fromCharCode(65 + runIndex)
    const manifestId = `MAN-${docDate.slice(0, 4)}-${docDate.slice(4, 8)}-${letter}${
      generation > 0 ? `-R${generation}` : ''
    }`

    const stopIds: string[] = []

    route.stops.forEach((seedStop, stopIndex) => {
      const id = `${route.id}-${stopIndex + 1}`
      const { items, amountDue } = buildBasket(`${route.id}#${stopIndex}`)
      const payment = paymentFor(`${route.id}#${stopIndex}`)

      const wStart =
        anchor + (WINDOW_RUN_OFFSET_MIN[runIndex] ?? 0) * 60_000 + stopIndex * WINDOW_STOP_STEP_MIN * 60_000
      const wEnd = wStart + WINDOW_SPAN_MIN * 60_000

      const delivered = plan.status === 'active' && stopIndex < plan.currentLeg
      const enroute = plan.status === 'active' && stopIndex === plan.currentLeg

      const status: Stop['status'] = delivered ? 'delivered' : enroute ? 'enroute' : 'pending'

      stops.push({
        id,
        orderCode: orderCodeFor(runIndex, stopIndex),
        customer: seedStop.name,
        address: seedStop.address,
        lngLat: [seedStop.lon, seedStop.lat],
        items,
        amountDue,
        payment,
        status,
        window: [formatClock(wStart), formatClock(wEnd)],
        etaMin:
          plan.status === 'active' && !delivered
            ? etaMinutesTo(legs, plan.currentLeg, plan.progress, stopIndex)
            : null,
        idChecked: delivered,
        closedAt: null, // filled in by the back-dated event walk below
      })
      stopIds.push(id)
    })

    const point =
      plan.status === 'active'
        ? pointOnLeg(legs[plan.currentLeg], plan.progress)
        : { position: DEPOT, heading: 0 }

    runs.push({
      id: route.id,
      label: route.label,
      driver: route.driver,
      status: plan.status,
      stops: stopIds,
      currentLeg: plan.currentLeg,
      progress: plan.progress,
      position: point.position,
      heading: point.heading,
      manifestId,
    })
  })

  // Back-date the history of any run that opens mid-progress, so the event feed
  // reads like a shift already underway rather than an empty box.
  let evtSeq = 0
  const push = (
    runId: string,
    stopId: string | null,
    type: DeliveryEventType,
    at: number,
    meta?: Record<string, string>,
  ) => {
    events.push({
      id: `seed-${generation}-${evtSeq++}`,
      runId,
      stopId,
      type,
      at: new Date(at).toISOString(),
      ...(meta ? { meta } : {}),
    })
  }

  for (const run of runs) {
    if (run.status !== 'active') continue
    const legs = legsFor(run.id)
    const runStops = run.stops.map((sid) => stops.find((s) => s.id === sid)!)

    // total sim-seconds already burned this shift
    let elapsedS = 0
    for (let i = 0; i < run.currentLeg; i++) {
      elapsedS += legs[i].duration_s + dwellFor(run.id, i, generation).totalS
    }
    elapsedS += run.progress * legs[run.currentLeg].duration_s

    let t = nowMs - elapsedS * 1000
    push(run.id, null, 'run_started', t, { manifest: run.manifestId, driver: run.driver })

    for (let i = 0; i <= run.currentLeg && i < runStops.length; i++) {
      const stop = runStops[i]
      push(run.id, stop.id, 'departed', t, { to: stop.orderCode })
      t += legs[i].duration_s * 1000
      if (i < run.currentLeg) {
        const dwell = dwellFor(run.id, i, generation)
        push(run.id, stop.id, 'arrived', t, { order: stop.orderCode })
        t += dwell.arriveS * 1000
        push(run.id, stop.id, 'id_verified', t, { order: stop.orderCode })
        t += dwell.idCheckS * 1000
        stop.closedAt = new Date(t).toISOString()
        push(run.id, stop.id, 'closed', t, {
          order: stop.orderCode,
          payment: PAYMENT_LABEL[stop.payment],
          amount: formatMoney(stop.amountDue),
        })
        t += dwell.closeS * 1000
      }
    }
  }

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return { runs, stops, events, simEpoch: nowMs }
}
