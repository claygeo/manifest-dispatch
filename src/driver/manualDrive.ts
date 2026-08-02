/**
 * Driver-controlled sim progression.
 *
 * SPEC: "In demo mode the driver app drives ITS run's sim progression via store
 * actions (depart/arrive/close advance the run)."
 *
 * The sim engine normally owns the whole ladder for an active run: drive the
 * leg, arrive, dwell, verify, close, dwell, next leg. The moment the driver app
 * claims a run (`store.driverRunId`), that ladder becomes the driver's job and
 * the engine calls in here instead. What is left for the engine to do is the
 * only thing a phone cannot fake: roll the van along the road at the leg's real
 * OSRM speed, but ONLY while the driver has said they departed.
 *
 * The rule that makes the two halves agree:
 *
 *   stop.status === 'enroute'  -> the van moves
 *   stop.status === 'pending'  -> parked where the last stop left it
 *   anything else              -> parked AT the stop (progress pinned to 1)
 *
 * So `setStopStatus(id, 'enroute')` from a button press is what physically
 * moves the truck on the dispatch console, and `setStopStatus(id, 'arrived')`
 * is what parks it. No second source of truth, no engine fork.
 *
 * This module lives under src/driver/** on purpose: the behaviour is the driver
 * app's, the engine just yields to it.
 */

import type { RunSim } from '../sim/engine'
import type { ManifestState } from '../store'
import { useStore } from '../store'
import { speedJitterFor } from '../sim/eta'

/**
 * One frame of a driver-claimed run. Mirrors the engine's own `stepRun`
 * contract: mutate `sim` in place, push nothing but position through the store.
 */
export function stepDriverRun(
  sim: RunSim,
  dtSimS: number,
  generation: number,
  s: ManifestState,
): void {
  const run = s.runs[sim.runId]
  if (!run) return

  // A staged run waits for the driver to press DEPART — no auto-dispatch while
  // a human is holding it. A complete run has nothing left to do.
  if (run.status !== 'active') {
    sim.phase = run.status === 'complete' ? 'done' : 'idle'
    return
  }

  // The store is the queue pointer while the driver holds the run: NEXT STOP
  // writes `currentLeg` and the engine follows it, not the other way round.
  if (run.currentLeg !== sim.legIndex) {
    sim.legIndex = run.currentLeg
    sim.progress = run.progress
  }
  sim.phase = 'driving'

  const leg = sim.legs[sim.legIndex]
  if (!leg) {
    s.completeRun(sim.runId)
    sim.phase = 'done'
    return
  }

  const stopId = run.stops[sim.legIndex] ?? null
  const stop = stopId ? s.stops[stopId] : undefined

  // No stop on this leg = the run home to the depot. Nothing for the driver to
  // press; the van drives itself back and the run closes on arrival.
  if (!stop) {
    sim.progress = Math.min(1, sim.progress + advance(sim, dtSimS, generation, leg.duration_s))
    if (sim.progress >= 1) {
      s.completeRun(sim.runId)
      sim.phase = 'done'
    }
    return
  }

  if (stop.status !== 'enroute') {
    // Parked. `pending` means the driver has not departed yet (still standing
    // where the previous stop left them); everything else means they are at the
    // door, so pin the van to the stop rather than leaving it mid-street.
    if (stop.status !== 'pending') sim.progress = 1
    return
  }

  sim.progress = Math.min(1, sim.progress + advance(sim, dtSimS, generation, leg.duration_s))
}

function advance(sim: RunSim, dtSimS: number, generation: number, durationS: number): number {
  const jitter = speedJitterFor(sim.runId, sim.legIndex, generation)
  return (dtSimS * jitter) / Math.max(1, durationS)
}

/* ------------------------------------------------------------ handover --- */

/**
 * Give a run back to the engine cleanly.
 *
 * The engine resumes in its `driving` phase from `currentLeg`/`progress`. If
 * the driver walked away standing over a stop they had already closed out, the
 * engine would drive a zero-length leg and re-arrive a delivered stop. Advance
 * the queue pointer first so the handover is coherent.
 */
export function handOffRun(runId: string | null): void {
  if (!runId) return
  const s = useStore.getState()
  const run = s.runs[runId]
  if (!run || run.status !== 'active') return
  const stop = s.stops[run.stops[run.currentLeg] ?? '']
  if (!stop) return
  if (stop.status === 'delivered' || stop.status === 'exception') {
    s.advanceRunPosition(runId, {
      position: stop.lngLat,
      heading: run.heading,
      currentLeg: run.currentLeg + 1,
      progress: 0,
    })
  }
}
