/**
 * Same-day feasibility — "can this order get on a route today?"
 *
 * SPEC.md: "answered with arithmetic: remaining driver time + per-stop service
 * time + leg matrix + delivery windows -> 'fits Run C, adds ~9 min' or 'does not
 * fit today — first window tomorrow.'"
 *
 * The arithmetic, in full:
 *
 *   t = now
 *   for each stop in the candidate order:
 *     t += driving time to it        (the CURRENT leg's remainder for the first hop)
 *     if t > window end  -> this order cannot be served today, reject
 *     t  = max(t, window start)      (arriving early means waiting, not delivering)
 *     t += service time              (dwell midpoint, see below)
 *   t += driving time back to the depot
 *   if t > shift end -> reject
 *
 * The new stop is tried at EVERY insertion position and the cheapest feasible
 * one wins, where "cheapest" is the delta to the run's finishing time — not the
 * length of the detour, because a detour that makes the driver wait for a window
 * costs the shift nothing extra.
 *
 * A rejection is never a shrug: an insertion is refused when it would break ANY
 * stop's window, including the ones already on the run. Pushing an existing
 * customer out of their promised window to squeeze in a new order is exactly the
 * failure this screen exists to make visible.
 *
 * Honesty: travel times are static estimates from the precomputed matrix. Live
 * traffic is a production integration (PRODUCTION.md), and the UI says so.
 */

import { DWELL_MAX_S, DWELL_MIN_S } from '../sim/eta'
import { parseClock } from '../window'
import { formatClock } from '../format'
import { DEPOT_NODE, isMatrixNode, legBetween } from './matrix'

/**
 * Per-stop service time, in sim-seconds.
 *
 * The midpoint of the sim engine's dwell range (SPEC: "20-75s dwell at each
 * stop"), so the planner's arithmetic and the fleet the visitor is watching
 * agree on what a doorstep costs. In a production deployment this is a
 * per-operator constant measured from real closeouts, not a demo dwell.
 */
export const SERVICE_TIME_S = (DWELL_MIN_S + DWELL_MAX_S) / 2

const DAY_MS = 86_400_000

/** A stop's delivery window as it lives on `Stop.window` — clock strings. */
export type WindowPair = [string, string]

export interface PlanRunInput {
  runId: string
  /**
   * Matrix node the driver is measured from: the depot before the run starts,
   * or the last stop closed out.
   */
  fromNodeId: string
  /**
   * Sim-seconds of driving still left on the leg the van is CURRENTLY on. Zero
   * (or omitted) when the driver is parked at `fromNodeId`.
   *
   * When this is non-zero the van is already committed to reaching
   * `sequence[0]`, so nothing may be inserted ahead of it — you cannot un-drive
   * half a leg. `canFitToday` enforces that by refusing insertion position 0.
   */
  inTransitS?: number
  /** Remaining, unserved stops in service order — matrix node ids. */
  sequence: string[]
  /** Delivery windows by node id. A node with no entry is treated as unconstrained. */
  windows: Record<string, WindowPair>
  /** Sim wall-clock the run must be back at the depot by. */
  shiftEndMs: number
  /** Optional human labels for the reason strings (order code, customer name). */
  labels?: Record<string, string>
}

export type FailureKind = 'window' | 'shift'

export interface ProjectedStop {
  nodeId: string
  /** When the van reaches the kerb. */
  arriveMs: number
  /** When it pulls away — arrival, plus any wait for the window, plus service. */
  departMs: number
  /** Seconds spent waiting for the window to open. */
  waitS: number
  /** True when the van reaches this kerb after the window has closed. */
  missed: boolean
}

export interface Projection {
  feasible: boolean
  /** Back at the depot at this sim wall-clock. */
  endsAtMs: number
  stops: ProjectedStop[]
  failure: { kind: FailureKind; nodeId: string | null } | null
}

export interface FitResult {
  fits: boolean
  runId: string
  /** Seconds the insertion adds to the run's finishing time. 0 when nothing fits. */
  addedS: number
  /** Position in the remaining sequence the new stop takes. -1 when nothing fits. */
  insertAt: number
  reason: string
}

/* ----------------------------------------------------------------- windows -- */

/**
 * Resolve a clock-string window to absolute ms around `refMs`.
 *
 * `parseClock` snaps to whichever calendar day puts the time within 12 hours of
 * the reference, so a window that reads backwards ('11:00 PM'-'1:00 AM') is an
 * overnight one and its end belongs to the next day.
 */
function windowBounds(window: WindowPair | undefined, refMs: number): [number, number] | null {
  if (!window) return null
  const start = parseClock(window[0], refMs)
  let end = parseClock(window[1], refMs)
  if (end < start) end += DAY_MS
  return [start, end]
}

function labelFor(run: PlanRunInput, nodeId: string): string {
  return run.labels?.[nodeId] ?? nodeId
}

/* -------------------------------------------------------------- projection -- */

/**
 * Walk a candidate order and report when every kerb is reached, when the van is
 * back at the depot, and the first thing that broke.
 *
 * Deliberately total: it always produces `endsAtMs`, even for an order that
 * already blew a window, because `canFitToday` needs a comparable finishing time
 * for the baseline run whether or not that run is currently on schedule.
 */
export function projectSequence(
  run: PlanRunInput,
  sequence: string[],
  nowMs: number,
): Projection {
  const stops: ProjectedStop[] = []
  let failure: Projection['failure'] = null
  let t = nowMs
  let prev = run.fromNodeId

  const inTransitS = run.inTransitS ?? 0
  const committedTo = run.sequence[0]

  sequence.forEach((nodeId, index) => {
    /*
     * First hop only: if the van is already rolling toward this exact stop, the
     * cost is what is LEFT of that leg, not the whole leg. Any other first stop
     * falls back to the full leg from `fromNodeId`, which over-states the cost
     * for a van already halfway somewhere else — deliberately conservative,
     * and `canFitToday` refuses that case outright anyway.
     */
    const driveS =
      index === 0 && inTransitS > 0 && nodeId === committedTo
        ? inTransitS
        : legBetween(prev, nodeId).duration_s

    // the matrix speaks seconds, this clock speaks milliseconds
    t += driveS * 1000
    const arriveMs = t

    const bounds = windowBounds(run.windows[nodeId], nowMs)
    let waitS = 0
    let missed = false

    if (bounds) {
      const [start, end] = bounds
      if (arriveMs > end) {
        missed = true
        if (!failure) failure = { kind: 'window', nodeId }
      } else if (arriveMs < start) {
        waitS = (start - arriveMs) / 1000
        t = start
      }
    }

    t += SERVICE_TIME_S * 1000
    stops.push({ nodeId, arriveMs, departMs: t, waitS, missed })
    prev = nodeId
  })

  /*
   * A van standing at the depot with nothing left to serve has no trip home to
   * make. The matrix carries no depot -> depot leg (correctly — it is not a
   * road), so this is the difference between "the run is finished" and a throw.
   */
  const returnS = prev === DEPOT_NODE ? 0 : legBetween(prev, DEPOT_NODE).duration_s
  const endsAtMs = t + returnS * 1000

  if (!failure && endsAtMs > run.shiftEndMs) failure = { kind: 'shift', nodeId: null }

  return { feasible: failure === null, endsAtMs, stops, failure }
}

/* ------------------------------------------------------------ can it fit? -- */

function rejectionReason(run: PlanRunInput, projection: Projection): string {
  const failure = projection.failure
  if (!failure) return 'Does not fit today.'
  if (failure.kind === 'shift') {
    return `Does not fit today — the van would not be back at the depot until ${formatClock(
      projection.endsAtMs,
    )}, after the shift ends at ${formatClock(run.shiftEndMs)}.`
  }
  const nodeId = failure.nodeId ?? ''
  const window = run.windows[nodeId]
  const closes = window ? window[1] : 'its window'
  const missedIsNew = !run.sequence.includes(nodeId)
  const who = labelFor(run, nodeId)
  return missedIsNew
    ? `Does not fit today — the van cannot reach ${who} before ${closes}. First window tomorrow.`
    : `Does not fit today — squeezing it in pushes ${who} past ${closes}. Existing promises hold.`
}

/**
 * The refusal for a run that was ALREADY broken before anything was added.
 *
 * Without this, the arithmetic tells a lie with a straight face: every
 * insertion into an already-late run is refused, the closest refusal still
 * names the stop whose window was blown two hours before the new order existed,
 * and `rejectionReason` reads that as "squeezing it in pushes Luis H. past
 * 11:00 AM. Existing promises hold." The new order did not push anybody. A
 * screen whose whole argument is "the numbers are measurements" cannot hand a
 * dispatcher a fabricated cause.
 */
function alreadyBrokenReason(run: PlanRunInput, baseline: Projection): string {
  const failure = baseline.failure
  if (failure?.kind === 'shift') {
    return `Nothing fits today — this run is already projected back at ${formatClock(
      baseline.endsAtMs,
    )}, after the ${formatClock(run.shiftEndMs)} cutoff, before any order is added.`
  }
  const nodeId = failure?.nodeId ?? ''
  const window = run.windows[nodeId]
  const closes = window ? window[1] : 'their window'
  return `Nothing fits today — this run already misses ${labelFor(
    run,
    nodeId,
  )} at ${closes} before any order is added. Re-sequence what is on it first.`
}

/**
 * Can `newStopId` join this run today, and where?
 *
 * Tries every legal insertion position, keeps the one that adds the least to the
 * run's finishing time, and refuses the lot if none of them keeps every delivery
 * window intact.
 */
export function canFitToday(newStopId: string, run: PlanRunInput, nowMs: number): FitResult {
  if (!isMatrixNode(newStopId) || newStopId === DEPOT_NODE) {
    return {
      fits: false,
      runId: run.runId,
      addedS: 0,
      insertAt: -1,
      reason: `Does not fit today — '${newStopId}' is not an address this fleet can route to.`,
    }
  }

  if (run.sequence.includes(newStopId)) {
    return {
      fits: false,
      runId: run.runId,
      addedS: 0,
      insertAt: -1,
      reason: `${labelFor(run, newStopId)} is already on this run.`,
    }
  }

  const baseline = projectSequence(run, run.sequence, nowMs)

  /*
   * An insertion only ever adds driving and service time, and every candidate
   * contains the whole existing sequence, so no stop can arrive EARLIER than it
   * does in the baseline. A baseline that already breaks therefore breaks in
   * every candidate — the search below cannot find a fit, and running it would
   * only produce a refusal that blames the newcomer for a breach that predates
   * it.
   */
  if (!baseline.feasible) {
    return {
      fits: false,
      runId: run.runId,
      addedS: 0,
      insertAt: -1,
      reason: alreadyBrokenReason(run, baseline),
    }
  }

  // Position 0 is only available to a van that has not left yet — see `inTransitS`.
  const firstPosition = (run.inTransitS ?? 0) > 0 && run.sequence.length > 0 ? 1 : 0

  let bestIndex = -1
  let bestAdded = Infinity
  let closestRejected: Projection | null = null
  let closestRejectedAdded = Infinity

  for (let k = firstPosition; k <= run.sequence.length; k++) {
    const candidate = [...run.sequence.slice(0, k), newStopId, ...run.sequence.slice(k)]
    const projection = projectSequence(run, candidate, nowMs)
    const added = (projection.endsAtMs - baseline.endsAtMs) / 1000

    if (projection.feasible) {
      // strict `<` keeps the earliest position on a tie — the van commits sooner
      if (added < bestAdded) {
        bestAdded = added
        bestIndex = k
      }
    } else if (added < closestRejectedAdded) {
      closestRejectedAdded = added
      closestRejected = projection
    }
  }

  if (bestIndex < 0) {
    const projection = closestRejected ?? baseline
    return {
      fits: false,
      runId: run.runId,
      addedS: 0,
      insertAt: -1,
      reason: rejectionReason(run, projection),
    }
  }

  const addedMin = Math.max(1, Math.round(bestAdded / 60))
  return {
    fits: true,
    runId: run.runId,
    addedS: bestAdded,
    insertAt: bestIndex,
    reason: `Fits as stop ${bestIndex + 1} — adds about ${addedMin} min.`,
  }
}
