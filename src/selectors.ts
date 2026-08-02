/**
 * Derived reads. Components import from here instead of recomputing —
 * the console, the driver app and the tracking card must agree on what
 * "current stop" and "late" mean.
 */

import type { DeliveryEvent, ManifestFleetView, Run, Stop } from './selectors.types'
import { runIdOf } from './store'

/** Stops of a run, in the run's own (reorderable) sequence. */
export function runStops(view: ManifestFleetView, runId: string): Stop[] {
  const run = view.runs[runId]
  if (!run) return []
  return run.stops.map((id) => view.stops[id]).filter(Boolean)
}

export function runOfStop(view: ManifestFleetView, stopId: string): Run | undefined {
  return view.runs[runIdOf(stopId)]
}

/** The stop the driver is working right now — first one not closed out. */
export function currentStop(view: ManifestFleetView, runId: string): Stop | null {
  const stops = runStops(view, runId)
  return stops.find((s) => s.status !== 'delivered' && s.status !== 'exception') ?? null
}

/** DESIGN: dual-resolution metric — `STOP 3/5`. */
export function runCounts(view: ManifestFleetView, runId: string): { done: number; total: number } {
  const stops = runStops(view, runId)
  const done = stops.filter((s) => s.status === 'delivered' || s.status === 'exception').length
  return { done, total: stops.length }
}

export function fleetCounts(view: ManifestFleetView): {
  active: number
  total: number
  exceptions: number
} {
  const runs = view.runOrder.map((id) => view.runs[id]).filter(Boolean)
  return {
    active: runs.filter((r) => r.status === 'active').length,
    total: runs.length,
    exceptions: Object.values(view.stops).filter((s) => s.status === 'exception').length,
  }
}

/** How many stops the driver still has to serve before reaching `stopId`. */
export function stopsAway(view: ManifestFleetView, stopId: string): number | null {
  const run = runOfStop(view, stopId)
  if (!run) return null
  const stops = runStops(view, run.id)
  const target = stops.findIndex((s) => s.id === stopId)
  if (target < 0) return null
  const current = stops.findIndex((s) => s.status !== 'delivered' && s.status !== 'exception')
  if (current < 0) return 0
  return Math.max(0, target - current)
}

/** Newest first, optionally scoped to one run. DESIGN: feed reads newest on top. */
export function recentEvents(
  events: DeliveryEvent[],
  opts?: { runId?: string; limit?: number },
): DeliveryEvent[] {
  const limit = opts?.limit ?? 60
  const out: DeliveryEvent[] = []
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i]
    if (opts?.runId && e.runId !== opts.runId) continue
    out.push(e)
  }
  return out
}

export function findStopByOrderCode(view: ManifestFleetView, orderCode: string): Stop | null {
  const wanted = orderCode.trim().toUpperCase()
  return Object.values(view.stops).find((s) => s.orderCode.toUpperCase() === wanted) ?? null
}

/* ----------------------------------------------------------- windows ----- */

/**
 * Window maths lives in ./window.ts so the store can log an out-of-window
 * arrival without importing this file (which imports the store). Re-exported
 * here because every surface already reaches for it through selectors.
 */
export { arrivalWindowNote, isLateArrivalNote, parseClock, windowLabel, windowState } from './window'

/* -------------------------------------------------------- exceptions ----- */

/**
 * Exception reason label per stop, taken from the event log — `Stop` carries no
 * reason field and SPEC.md's data model is not ours to widen. Last write wins,
 * which is what a re-flagged stop should show.
 */
export function exceptionReasons(events: DeliveryEvent[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of events) {
    if (!e.stopId) continue
    if (e.type !== 'exception' && e.type !== 'id_failed') continue
    const reason = e.meta?.reason
    if (reason) out[e.stopId] = reason
  }
  return out
}

/** Stops an order-cancellation took off the queue. Cheap `has` for the console. */
export function cancelledStopIds(events: DeliveryEvent[], cancelledLabel: string): Set<string> {
  const out = new Set<string>()
  const reasons = exceptionReasons(events)
  for (const [stopId, reason] of Object.entries(reasons)) {
    if (reason === cancelledLabel) out.add(stopId)
  }
  return out
}
