/**
 * Turning a plan into a run.
 *
 * The `/plan` sandbox is not a mock-up with a fake "dispatched!" toast. Pressing
 * dispatch builds real `Stop`s and a real `Run`, registers the matrix-built legs
 * under the new run id, and hands the whole thing to the same store actions the
 * seeded fleet uses — after which the SAME sim engine drives it, the console
 * lists it, the driver app can claim it and it prints its own manifest.
 *
 * The orders are copies, not moves. A planned stop takes its customer, address,
 * basket and delivery window from the seeded order at that matrix node, but gets
 * its own stop id and its own order code, so nothing on the live board is
 * hijacked by someone playing with the planner.
 */

import { PLANNER_POOL, registerRunLegs } from '../data/seed'
import { formatClock, formatDocDate, shortName } from '../format'
import {
  DEPOT_NODE,
  durationOf,
  legsForSequence,
  nodePosition,
  stopForNode,
  STOP_NODE_IDS,
} from '../routing/matrix'
import { parseClock } from '../window'
import { useStore } from '../store'
import type { PaymentMethod, Run, Stop } from '../types'
import { projectSequence, type PlanRunInput, type WindowPair } from '../routing/feasibility'

/** Fictional. Same 'First L.' shape as the seeded drivers. */
const PLAN_DRIVER = 'Nadia P.'

/**
 * Depot cutoff — the latest a van is allowed back. Diegetic (a delivery
 * operation has a closing time), and it is what the feasibility check charges
 * the shift against. Floored to three sim-hours out so a visitor opening the
 * demo late at night still gets a shift to plan inside instead of a board that
 * refuses everything.
 */
export const DEPOT_CUTOFF_CLOCK = '10:00 PM'
const MIN_SHIFT_MS = 3 * 3_600_000

export function shiftEndMs(nowMs: number): number {
  return Math.max(parseClock(DEPOT_CUTOFF_CLOCK, nowMs), nowMs + MIN_SHIFT_MS)
}

/* ------------------------------------------------------------------ pool --- */

/** One unrouted practice order in the planner's pool. */
export interface PoolOrder {
  /** Matrix node — what the routing engine speaks. */
  nodeId: string
  orderCode: string
  customer: string
  address: string
  lngLat: [number, number]
  window: WindowPair
  amountDue: number
  payment: PaymentMethod
  items: { name: string; qty: number }[]
}

/**
 * Promised-window spread for the unrouted pool, in minutes from the planning
 * quarter-hour. Deliberately uneven: a couple of these close inside the time a
 * four-stop run takes to drive, which is what makes the feasibility check say
 * "no" sometimes instead of rubber-stamping everything.
 */
const POOL_WINDOW_START_MIN = [-30, -5, 20, 45, 70]
const POOL_WINDOW_SPAN_MIN = [75, 105, 135]

function floorToQuarterHour(ms: number): number {
  const d = new Date(ms)
  d.setSeconds(0, 0)
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15)
  return d.getTime()
}

function poolWindow(index: number, anchorMs: number): WindowPair {
  const start = anchorMs + POOL_WINDOW_START_MIN[index % POOL_WINDOW_START_MIN.length] * 60_000
  const end = start + POOL_WINDOW_SPAN_MIN[index % POOL_WINDOW_SPAN_MIN.length] * 60_000
  return [formatClock(start), formatClock(end)]
}

/**
 * The pool the planner offers, in matrix order.
 *
 * These are the planner's OWN orders (`seed.ts#PLANNER_POOL`) — fresh codes,
 * fresh customers, fresh baskets, none of them on the dispatch board. The
 * planner used to read its pool off the seeded fleet, which put the same order
 * code on `/dispatch` as delivered and on `/plan` as unrouted, in two different
 * delivery windows. A product whose claim is "one state, no second system"
 * cannot show a visitor two states for one order.
 *
 * What the pool still borrows from the fleet is the DOORSTEP: the leg matrix
 * measured twelve places and no others, so an address it has never seen would
 * come with invented travel times. `stopForNode` is the seam, and matrix.ts has
 * already proved that mapping against the coordinates at import time.
 *
 * The delivery WINDOWS are anchored to `nowMs` rather than fixed. These are
 * orders being planned right now: the demo clock runs at eight times real time,
 * so a window written once would have closed within a few minutes of browsing
 * and the planner would refuse everything it is offered. Anchoring to the
 * planning moment is both the honest model of a fresh order and what keeps the
 * screen answering truthfully instead of uniformly.
 */
export function poolOrders(nowMs: number): PoolOrder[] {
  const anchor = floorToQuarterHour(nowMs)
  const byStop = new Map(PLANNER_POOL.map((order) => [order.atStopId, order]))
  const out: PoolOrder[] = []
  STOP_NODE_IDS.forEach((nodeId, index) => {
    const stopId = stopForNode(nodeId)
    const order = stopId ? byStop.get(stopId) : undefined
    if (!order) {
      throw new Error(
        `[plan] matrix node '${nodeId}' has no practice order — seed.ts#PLANNER_POOL is out of step with the matrix`,
      )
    }
    out.push({
      nodeId,
      orderCode: order.orderCode,
      customer: order.customer,
      address: order.address,
      lngLat: nodePosition(nodeId),
      window: poolWindow(index, anchor),
      amountDue: order.amountDue,
      payment: order.payment,
      items: order.items,
    })
  })
  return out
}

/** Windows by node id — the shape `canFitToday` wants. */
export function windowsOf(orders: PoolOrder[]): Record<string, WindowPair> {
  const out: Record<string, WindowPair> = {}
  for (const order of orders) out[order.nodeId] = order.window
  return out
}

/**
 * Human labels by node id, for the feasibility verdict's reason string.
 *
 * Shortened: SPEC's data model says the console and driver surfaces show "first
 * name + last initial", full name only on the ticket itself. A refusal message
 * naming the customer in full would leak a surname onto a planning screen that
 * has no business carrying one.
 */
export function labelsOf(orders: PoolOrder[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const order of orders) out[order.nodeId] = shortName(order.customer)
  return out
}

/* ---------------------------------------------------------- window risk --- */

/**
 * The draft run as the feasibility engine sees it — depot out, in the order the
 * dispatcher currently has, against the windows the pool promised.
 *
 * One arithmetic, one answer. The late-order path already refuses an insertion
 * that would blow a window; this is the same `projectSequence` call, so a manual
 * reorder is judged by exactly the rule an insertion is judged by.
 */
export function planRunInput(sequence: string[], pool: PoolOrder[], nowMs: number): PlanRunInput {
  return {
    runId: 'plan-draft',
    fromNodeId: DEPOT_NODE,
    sequence,
    windows: windowsOf(pool),
    labels: labelsOf(pool),
    shiftEndMs: shiftEndMs(nowMs),
  }
}

/** A stop the current order cannot reach in time, and the two clock times that say so. */
export interface WindowRisk {
  nodeId: string
  /** Projected arrival at the kerb, sim wall-clock. */
  arriveMs: number
  /** '8:41 PM' — the projection. */
  projected: string
  /** '8:30 PM' — the promise. */
  closes: string
  /** 'projected 8:41 PM — window ends 8:30 PM' */
  reason: string
}

/**
 * Which stops the CURRENT order pushes out of their promised window.
 *
 * The home page promises "amber before miss", and the late-order path keeps
 * that promise. A manual reorder did not: it showed the drive-time delta and
 * nothing else, so a dispatcher could demote a stop past its own window and the
 * screen would report the cost as "+11 min" with no warning at all. This is the
 * missing half.
 *
 * Arriving EARLY is not a risk — the van waits, which `projectSequence` already
 * models — so only a late arrival is reported.
 */
export function windowRisks(sequence: string[], pool: PoolOrder[], nowMs: number): WindowRisk[] {
  if (sequence.length === 0) return []
  const run = planRunInput(sequence, pool, nowMs)
  const projection = projectSequence(run, sequence, nowMs)
  const out: WindowRisk[] = []
  for (const stop of projection.stops) {
    if (!stop.missed) continue
    const projected = formatClock(stop.arriveMs)
    const closes = run.windows[stop.nodeId]?.[1] ?? 'its window'
    out.push({
      nodeId: stop.nodeId,
      arriveMs: stop.arriveMs,
      projected,
      closes,
      reason: `projected ${projected} — window ends ${closes}`,
    })
  }
  return out
}

/* -------------------------------------------------------------- dispatch --- */

/**
 * Session-scoped, monotonic. Never reset — a fleet reset rebuilds the seeded
 * runs and would otherwise let a second planned run inherit the first one's id
 * and its registered legs.
 */
let planSeq = 0

export interface PlannedDispatch {
  runId: string
  manifestId: string
  label: string
  stopIds: string[]
}

/** `MFST-9xxx`, distinct from the seeded `MFST-4xxx`, and unique on the board. */
function planOrderCode(taken: Set<string>, seq: number, index: number): string {
  const base = `MFST-9${seq % 10}${String(index + 1).padStart(2, '0')}`
  if (!taken.has(base)) return base
  for (let bump = 1; bump < 1000; bump++) {
    const next = `MFST-9${((seq + bump) % 10)}${String(index + 1).padStart(2, '0')}-${bump}`
    if (!taken.has(next)) return next
  }
  /* istanbul ignore next — 1000 collisions on one index is not a reachable state */
  throw new Error('[plan] could not mint a unique order code')
}

/**
 * Build the run, register its legs, put it on the board and roll it.
 *
 * Order matters: legs first (the engine adopts the run on the next frame and
 * immediately asks for them), then the audit line, then the run, then the start.
 */
export function dispatchPlannedRun(
  sequence: string[],
  pool: PoolOrder[],
  opts: { suggestedS: number; naiveS: number },
): PlannedDispatch {
  if (sequence.length === 0) throw new Error('[plan] cannot dispatch an empty run')

  planSeq += 1
  const seq = planSeq
  const runId = `plan-${seq}`
  const state = useStore.getState()
  const nowMs = state.simNowMs || Date.now()
  const docDate = formatDocDate(nowMs).replace(/-/g, '').slice(0, 8)
  const manifestId = `MAN-${docDate.slice(0, 4)}-${docDate.slice(4, 8)}-P${seq}`
  const label = `Planner build ${seq}`

  const byNode = new Map(pool.map((order) => [order.nodeId, order]))
  const taken = new Set(Object.values(state.stops).map((stop) => stop.orderCode))

  const stops: Stop[] = sequence.map((nodeId, index) => {
    const order = byNode.get(nodeId)
    if (!order) throw new Error(`[plan] no pooled order for matrix node '${nodeId}'`)
    const orderCode = planOrderCode(taken, seq, index)
    taken.add(orderCode)
    return {
      id: `${runId}-${index + 1}`,
      orderCode,
      customer: order.customer,
      address: order.address,
      lngLat: order.lngLat,
      items: order.items,
      amountDue: order.amountDue,
      payment: order.payment,
      status: 'pending',
      window: order.window,
      etaMin: null,
      idChecked: false,
      closedAt: null,
    }
  })

  const legs = legsForSequence(sequence)

  const run: Run = {
    id: runId,
    label,
    driver: PLAN_DRIVER,
    status: 'staged',
    stops: stops.map((stop) => stop.id),
    currentLeg: 0,
    progress: 0,
    // parked at the depot — the first coordinate of the first leg, snapped to the road
    position: [legs[0].coords[0][0], legs[0].coords[0][1]],
    heading: 0,
    manifestId,
  }

  registerRunLegs(runId, legs)

  const plannedS = durationOf(sequence)
  const store = useStore.getState()
  store.addRun(run, stops)

  /*
   * SPEC: "Every resequence writes a DeliveryEvent (who-did-what audit line,
   * visible on the manifest)." Pre-dispatch nudges have no run to log against
   * yet, so the dispatch itself carries the record: what was suggested, what was
   * sent, and by how much the human overrode it.
   */
  const deltaS = Math.round(plannedS - opts.suggestedS)
  store.logEvent({
    runId,
    stopId: null,
    type: 'note',
    meta: {
      message:
        deltaS === 0
          ? 'PLANNED — DISPATCHER ACCEPTED SUGGESTED ORDER'
          : `PLANNED — DISPATCHER ORDER ${deltaS > 0 ? '+' : ''}${Math.round(deltaS / 60)} MIN VS SUGGESTED`,
      manifest: manifestId,
      stops: String(sequence.length),
      planned: `${Math.round(plannedS / 60)} MIN`,
      suggested: `${Math.round(opts.suggestedS / 60)} MIN`,
      naive: `${Math.round(opts.naiveS / 60)} MIN`,
    },
  })

  store.startRun(runId)

  return { runId, manifestId, label, stopIds: run.stops }
}
