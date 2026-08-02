/**
 * Derived reads. Components import from here instead of recomputing —
 * the console, the driver app and the tracking card must agree on what
 * "current stop" and "late" mean.
 */

import type { DeliveryEvent, ManifestFleetView, Run, Stop, WindowState } from './selectors.types'
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

/** '2:00 PM' -> ms on the same calendar day as `refMs` (nearest day wins). */
export function parseClock(clock: string, refMs: number): number {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(clock.trim())
  if (!m) return refMs
  let h = parseInt(m[1], 10) % 12
  if (m[3].toUpperCase() === 'PM') h += 12
  const d = new Date(refMs)
  d.setHours(h, parseInt(m[2], 10), 0, 0)
  let ms = d.getTime()
  const DAY = 86_400_000
  if (ms - refMs > DAY / 2) ms -= DAY
  if (refMs - ms > DAY / 2) ms += DAY
  return ms
}

/**
 * SPEC: "stops outside their window flag amber on console."
 * `late` is the only state that earns amber — everything else stays neutral.
 */
export function windowState(stop: Stop, simNowMs: number): WindowState {
  if (stop.status === 'delivered') return 'closed'
  const end = parseClock(stop.window[1], simNowMs)
  const start = parseClock(stop.window[0], simNowMs)
  const arrival = stop.etaMin === null ? simNowMs : simNowMs + stop.etaMin * 60_000
  if (arrival > end) return 'late'
  if (simNowMs >= start) return 'due'
  return 'ok'
}

export function windowLabel(stop: Stop): string {
  return `${stop.window[0]}–${stop.window[1]}`
}
