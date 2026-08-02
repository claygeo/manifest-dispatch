/**
 * Run panel — one boxed instrument module per run.
 *
 * SPEC: "A run panel shows: driver, `STOP 3/5` chip, one display-size ETA
 * numeral, window compliance state."
 *
 * DESIGN, enforced here:
 *  - a plate header starts the section (`RUN A — SOUTH TAMPA`), inverted, mono
 *  - EXACTLY ONE display-size numeral per panel. Its meaning changes with run
 *    status (planned minutes when staged, next-stop ETA when active) but there
 *    is never a second big number in the box.
 *  - every count is dual-resolution: `STOP 2/4`, `LATE 1/4` — no naked numerals
 *  - ETA drift renders inline as `4:12 → 4:19`, never as a red/green badge
 *  - amber only when the dispatcher must act (a stop is missing its window)
 */

import { Link } from 'react-router-dom'
import type { Run, Selection, Stop, ExceptionReason } from '../types'
import { formatClock, RUN_STATUS_LABEL } from '../format'
import { runCounts, windowState } from '../selectors'
import type { ManifestFleetView } from '../selectors.types'
import { legsFor } from '../data/seed'
import { DWELL_ALLOWANCE_S } from '../sim/eta'
import { ChevronDown, ChevronUp } from './icons'
import { promisedArrival } from './etaBaseline'
import StopTicket from './StopTicket'

export interface RunPanelProps {
  run: Run
  view: ManifestFleetView
  /** Run's stops, already in the run's own reorderable sequence. */
  stops: Stop[]
  simNowMs: number
  selection: Selection | null
  collapsed: boolean
  /** Fleet generation — scopes the ETA-drift promise memory to this dispatch. */
  generation: number
  /** Stops whose exception is an order cancellation. Derived from the event log. */
  cancelledIds: Set<string>
  onToggleCollapse: (runId: string) => void
  onSelectRun: (runId: string) => void
  onSelectStop: (stopId: string) => void
  onStartRun: (runId: string) => void
  onReorder: (stopId: string, direction: -1 | 1) => void
  onException: (stopId: string, reason: ExceptionReason) => void
  onCancel: (stopId: string) => void
}

/** 'run-a' -> 'A'. The plate reads `RUN A — SOUTH TAMPA`. */
function runLetter(runId: string): string {
  const tail = runId.slice(runId.lastIndexOf('-') + 1)
  return tail.toUpperCase() || runId.toUpperCase()
}

/**
 * Projected arrival, anchored to the current sim MINUTE.
 *
 * `etaMin` is whole minutes while `simNowMs` advances continuously, so the
 * naive `simNowMs + etaMin*60000` sawtooths across a minute boundary and the
 * clock visibly flickers back and forth several times a second. Anchoring to
 * the floor of the current minute makes the two terms change together and the
 * readout stays still unless the ETA genuinely moves.
 */
function arrivalMs(simNowMs: number, etaMin: number | null): number | null {
  if (etaMin === null) return null
  return Math.floor(simNowMs / 60_000) * 60_000 + etaMin * 60_000
}

/** '4:19 PM' -> '4:19'. DESIGN's drift example is `4:12 → 4:19`, unsuffixed. */
function compactClock(ms: number): string {
  return formatClock(ms).replace(/\s?[AP]M$/, '')
}

/** Whole-shift minutes for a staged run: every leg plus a dwell per stop. */
function plannedMinutes(run: Run): number {
  const legs = legsFor(run.id)
  if (legs.length === 0) return 0
  const seconds =
    legs.reduce((sum, leg) => sum + leg.duration_s, 0) + run.stops.length * DWELL_ALLOWANCE_S
  return Math.max(1, Math.round(seconds / 60))
}

export function RunPanel({
  run,
  view,
  stops,
  simNowMs,
  selection,
  collapsed,
  generation,
  cancelledIds,
  onToggleCollapse,
  onSelectRun,
  onSelectStop,
  onStartRun,
  onReorder,
  onException,
  onCancel,
}: RunPanelProps) {
  const counts = runCounts(view, run.id)
  const selectedRun = selection?.kind === 'run' && selection.id === run.id
  const staged = run.status === 'staged'
  const active = run.status === 'active'

  const lateFlags = stops.map((stop) => windowState(stop, simNowMs) === 'late')
  const lateCount = lateFlags.filter(Boolean).length

  const next = stops.find((s) => s.status !== 'delivered' && s.status !== 'exception') ?? null
  const nextEtaMin = next?.etaMin ?? null
  const nextEtaMs = arrivalMs(simNowMs, nextEtaMin)
  const baselineMs = next ? promisedArrival(generation, next.id, nextEtaMs) : null
  /* Whole minutes: sub-minute noise must never make the drift line flicker. */
  const driftMin =
    baselineMs !== null && nextEtaMs !== null ? Math.round((nextEtaMs - baselineMs) / 60_000) : 0

  /* ---- the single display numeral, and the micro line under it ---- */
  let etaLabel: string
  let etaValue: string
  let etaSub: string
  let etaTone = 'dc-numeral--idle'

  if (active) {
    etaLabel = 'NEXT · MIN'
    etaValue = nextEtaMin === null ? '—' : String(nextEtaMin)
    etaTone = lateCount > 0 ? 'numeral--amber' : 'numeral--accent'
    etaSub =
      nextEtaMs === null
        ? 'AWAITING FIX'
        : baselineMs !== null && Math.abs(driftMin) >= 2
          ? `${compactClock(baselineMs)} → ${compactClock(nextEtaMs)}`
          : `ARRIVES ${compactClock(nextEtaMs)}`
  } else if (staged) {
    etaLabel = 'PLAN · MIN'
    etaValue = String(plannedMinutes(run))
    etaSub = stops.length > 0 ? `OPENS ${stops[0].window[0]}` : 'NO STOPS'
  } else {
    etaLabel = 'RUN · CLOSED'
    etaValue = '—'
    etaSub = 'RETURNED TO DEPOT'
  }

  /* Window compliance, dual-resolution. Amber only where a dispatcher must act:
     a stop projected outside its window, or one already undeliverable. */
  const exceptionCount = stops.filter((s) => s.status === 'exception').length
  const windowChip =
    lateCount > 0
      ? { text: `LATE ${lateCount}/${counts.total}`, cls: 'chip chip--amber' }
      : exceptionCount > 0
        ? { text: `EXCEPTION ${exceptionCount}/${counts.total}`, cls: 'chip chip--amber' }
        : { text: `IN WINDOW ${counts.total}/${counts.total}`, cls: 'chip chip--quiet' }

  return (
    <section
      className={`glass dc-run${selectedRun ? ' dc-run--selected' : ''}${
        run.status === 'complete' ? ' dc-run--complete' : ''
      }`}
      data-sel-id={`run:${run.id}`}
      aria-label={`${run.label} run`}
    >
      <div
        className={`plate${
          selectedRun ? ' plate--accent' : run.status === 'complete' ? ' plate--quiet' : ''
        }`}
      >
        <button
          type="button"
          className="dc-plate-title"
          onClick={() => onSelectRun(run.id)}
          aria-pressed={selectedRun}
        >
          {`RUN ${runLetter(run.id)} — ${run.label.toUpperCase()}`}
        </button>
        <span>{RUN_STATUS_LABEL[run.status]}</span>
        <button
          type="button"
          className="dc-plate-btn"
          onClick={() => onToggleCollapse(run.id)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${run.label} stops`}
          title={collapsed ? 'Expand stops' : 'Collapse stops'}
        >
          {collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
        </button>
      </div>

      <div className="dc-run__body">
        <div className="dc-run__meta">
          <span className="micro micro--mono" style={{ color: 'var(--ink)' }}>
            {run.driver.toUpperCase()}
          </span>
          <div className="dc-run__chips">
            <span className="chip">{`STOP ${counts.done}/${counts.total}`}</span>
            <span className={windowChip.cls}>{windowChip.text}</span>
          </div>
        </div>

        <div className="dc-run__eta">
          <span className="label">{etaLabel}</span>
          <span className={`numeral numeral--sm ${etaTone}`}>{etaValue}</span>
          <span className="micro micro--mono micro--dim">{etaSub}</span>
        </div>
      </div>

      {collapsed ? null : (
        <div className="dc-stoplist">
          {stops.map((stop, i) => (
            <StopTicket
              key={stop.id}
              stop={stop}
              seq={i + 1}
              selected={selection?.kind === 'stop' && selection.id === stop.id}
              late={lateFlags[i]}
              etaClockLabel={(() => {
                const ms = arrivalMs(simNowMs, stop.etaMin)
                return ms === null ? null : compactClock(ms)
              })()}
              canReorder={staged}
              canMoveUp={i > 0}
              canMoveDown={i < stops.length - 1}
              cancelled={cancelledIds.has(stop.id)}
              onSelect={onSelectStop}
              onReorder={onReorder}
              onException={onException}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}

      <div className="dc-run__foot">
        {staged ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onStartRun(run.id)}
          >
            DISPATCH RUN
          </button>
        ) : (
          <span className="micro micro--mono micro--dim">{run.manifestId}</span>
        )}
        <Link className="dc-link" to={`/manifest/${run.id}`}>
          PRINT MANIFEST →
        </Link>
      </div>
    </section>
  )
}

export default RunPanel
