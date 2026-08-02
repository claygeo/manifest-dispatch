/**
 * ETA + dwell maths. Shared by the seed (so first paint already has honest
 * ETAs) and the sim engine (so they recompute the same way every tick).
 *
 * Unit note: the demo runs a *sim clock* that advances DEMO_TIME_MULTIPLIER×
 * faster than the wall clock. A leg whose OSRM duration is 248 s therefore
 * takes 248 sim-seconds — i.e. every duration in this file is in sim-seconds
 * and every ETA is in sim-minutes. The 36-minute shift is real; only the
 * playback is compressed.
 */

import { hashSeed, rng, type PreparedLeg } from './geo'

/** SPEC: "demo time multiplier ~8× so a 36-min run plays in ~4.5 min". */
export const DEMO_TIME_MULTIPLIER = 8

/** SPEC: "±15% speed jitter". */
export const SPEED_JITTER = 0.15

/** SPEC: "20–75s dwell at each stop". Sim-seconds. */
export const DWELL_MIN_S = 20
export const DWELL_MAX_S = 75

/** Allowance folded into downstream ETAs for each stop still to be served. */
export const DWELL_ALLOWANCE_S = 45

export interface DwellPlan {
  /** arrived -> id_check */
  arriveS: number
  /** id_check -> delivered */
  idCheckS: number
  /** delivered -> departed */
  closeS: number
  totalS: number
}

/**
 * Deterministic-ish per stop: seeded from run + stop index + fleet generation,
 * so a replay feels like the same shift without being a looped video.
 */
export function dwellFor(runId: string, stopIndex: number, generation: number): DwellPlan {
  const r = rng(hashSeed(`${runId}#${stopIndex}#dwell#${generation}`))
  const total = DWELL_MIN_S + r() * (DWELL_MAX_S - DWELL_MIN_S)
  const arriveS = total * (0.32 + r() * 0.14)
  const idCheckS = total * (0.3 + r() * 0.12)
  const closeS = Math.max(4, total - arriveS - idCheckS)
  return { arriveS, idCheckS, closeS, totalS: arriveS + idCheckS + closeS }
}

/** Speed multiplier for a leg — ±15%, seeded from the leg it belongs to. */
export function speedJitterFor(runId: string, legIndex: number, generation: number): number {
  const r = rng(hashSeed(`${runId}#${legIndex}#speed#${generation}`))
  return 1 + (r() * 2 - 1) * SPEED_JITTER
}

/**
 * Sim-minutes until the driver reaches the stop served by `legIndex`.
 * Returns null when the stop is already behind the driver.
 */
export function etaMinutesTo(
  legs: PreparedLeg[],
  currentLeg: number,
  progress: number,
  legIndex: number,
): number | null {
  if (legIndex < currentLeg) return null
  if (legIndex >= legs.length) return null
  let seconds = (1 - Math.max(0, Math.min(1, progress))) * legs[currentLeg].duration_s
  for (let i = currentLeg + 1; i <= legIndex; i++) {
    seconds += legs[i].duration_s + DWELL_ALLOWANCE_S
  }
  return Math.max(1, Math.round(seconds / 60))
}

/** Sim-seconds of driving still on the current leg. */
export function remainingLegSeconds(leg: PreparedLeg, progress: number): number {
  return Math.max(0, (1 - progress) * leg.duration_s)
}
