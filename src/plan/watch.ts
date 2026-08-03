/**
 * What the planner's watch panel is looking at.
 *
 * Two functions, kept apart on purpose:
 *
 *   `watchKey`      reads the store and flattens the run to a short string.
 *                   PlanPage subscribes to THAT, not to `stops` — the sim
 *                   engine republishes every ETA five times a second, and a
 *                   panel that re-rendered on each of those would re-render the
 *                   whole planner with it. The key only changes when something
 *                   a person can see has changed.
 *
 *   `describeWatch` turns the key into the panel's state. Pure, total, and the
 *                   only place the headline is decided.
 *
 * The bug this file exists to fix: the panel had exactly two states, "driving"
 * and "gone", so a run that finished normally went on claiming "Your run is
 * driving" until the demo fleet's loop deleted it minutes later — the one
 * moment the planner had a real outcome to report and it reported motion. A
 * run has three ends worth naming and they come off `run.status`, not off a
 * guess about whether the store still has the record.
 *
 * DESIGN.md: "Delivered dims to field values — no celebration green." The
 * complete state is calm. It states a count and stops talking.
 */

import type { Run, RunStatus, Stop } from '../types'

/** Which of the three things the panel is showing. */
export type PlanWatchKind = 'driving' | 'complete' | 'gone'

export interface PlanWatch {
  kind: PlanWatchKind
  /** The one line at the top of the panel. */
  headline: string
  /** Stops handed over. Closed means DELIVERED — an exception is not a close. */
  closed: number
  /** Stops that ended undelivered (failed ID, no answer, cancelled). */
  exceptions: number
  /** Everything the driver has finished with, one way or the other. */
  served: number
  total: number
  /** Minutes to the next open stop, or null when there is no live estimate. */
  etaMin: number | null
  /** `run.status`, for the quiet chip. Empty once the run is gone. */
  status: RunStatus | ''
}

/** The slice of the store this module reads. */
export interface WatchView {
  runs: Record<string, Run>
  stops: Record<string, Stop>
}

/**
 * A run's watchable state as one comparable string, or `''` when the run is no
 * longer on the board. Shape: `status|closed|exceptions|total|eta`.
 */
export function watchKey(view: WatchView, runId: string | null): string {
  if (!runId) return ''
  const run = view.runs[runId]
  if (!run) return ''

  let closed = 0
  let exceptions = 0
  let etaMin: number | null = null
  let foundOpen = false

  for (const stopId of run.stops) {
    const stop = view.stops[stopId]
    if (!stop) continue
    if (stop.status === 'delivered') closed += 1
    else if (stop.status === 'exception') exceptions += 1
    else if (!foundOpen) {
      foundOpen = true
      etaMin = stop.etaMin
    }
  }

  return `${run.status}|${closed}|${exceptions}|${run.stops.length}|${etaMin ?? '-'}`
}

const GONE: PlanWatch = {
  kind: 'gone',
  headline: 'The demo fleet reset — plan another?',
  closed: 0,
  exceptions: 0,
  served: 0,
  total: 0,
  etaMin: null,
  status: '',
}

function toStatus(raw: string): RunStatus {
  return raw === 'staged' || raw === 'complete' ? raw : 'active'
}

/** The panel's state, derived from the key and nothing else. */
export function describeWatch(key: string): PlanWatch {
  if (key === '') return GONE

  const [rawStatus, rawClosed, rawExceptions, rawTotal, rawEta] = key.split('|')
  const status = toStatus(rawStatus)
  const closed = Number(rawClosed) || 0
  const exceptions = Number(rawExceptions) || 0
  const total = Number(rawTotal) || 0
  const complete = status === 'complete'

  return {
    kind: complete ? 'complete' : 'driving',
    headline: complete ? 'Run complete.' : 'Your run is driving.',
    closed,
    exceptions,
    served: closed + exceptions,
    total,
    etaMin: rawEta === '-' || rawEta === undefined ? null : Number(rawEta),
    status,
  }
}

/**
 * The line under the headline once the run has finished. Says what was handed
 * over and what was not, in that order, and never rounds an exception away.
 */
export function completionNote(watch: PlanWatch): string {
  const closed = `${watch.closed} of ${watch.total} ${watch.total === 1 ? 'stop' : 'stops'} closed`
  if (watch.exceptions === 0) {
    return `${closed}, every one signed for. The manifest carries the custody log.`
  }
  const undelivered =
    watch.exceptions === 1 ? '1 came back undelivered' : `${watch.exceptions} came back undelivered`
  return `${closed} · ${undelivered}. The manifest records why, and the product goes back to the depot.`
}
