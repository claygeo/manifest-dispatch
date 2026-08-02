/**
 * ETA drift bookkeeping.
 *
 * DESIGN.md: "ETA drift rendered inline as `4:12 → 4:19` with an arrow — no
 * red/green diff badges." Drift only means something against a promise, so the
 * console remembers the FIRST arrival time it projected for a stop and compares
 * every later projection to that. The store never carries this — it is a
 * presentation memory, scoped to the console and to one fleet generation.
 *
 * Cleared whenever the sim re-dispatches the fleet (generation bump), so a
 * replayed shift starts from a fresh promise instead of drifting against a
 * previous run's numbers.
 */

let currentGeneration = -1
const promised = new Map<string, number>()

/**
 * Returns the arrival time first promised for `stopId` (ms), recording
 * `projectedMs` the first time one is offered. Idempotent: calling it twice in
 * the same render — as React StrictMode does — cannot move the promise.
 */
export function promisedArrival(
  generation: number,
  stopId: string,
  projectedMs: number | null,
): number | null {
  if (generation !== currentGeneration) {
    currentGeneration = generation
    promised.clear()
  }
  const existing = promised.get(stopId)
  if (existing !== undefined) return existing
  if (projectedMs === null) return null
  promised.set(stopId, projectedMs)
  return projectedMs
}
