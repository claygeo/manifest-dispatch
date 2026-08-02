/**
 * Run picker — SPEC: "Run picker (staged/active runs) → ticket queue."
 *
 * The first screen a driver sees. Identical card geometry for every run (BotW
 * neutral shelf); status is the left border weight and a pill chip, never a
 * recoloured card. One display numeral per card: minutes to the next door.
 *
 * The fleet keeps moving underneath this screen — nothing is claimed until a
 * card is tapped, so the picker is honest about what the other drivers are
 * doing right now.
 */

import type { ManifestFleetView } from '../selectors.types'
import { runCounts, runStops, windowLabel } from '../selectors'
import { RUN_STATUS_TEXT } from '../format'

export interface RunPickerProps {
  view: ManifestFleetView
  onPick: (runId: string) => void
}

export function RunPicker({ view, onPick }: RunPickerProps) {
  return (
    <div className="dv-pad-x">
      <div
        className="plate"
        style={{ borderRadius: 'var(--radius-soft) var(--radius-soft) 0 0' }}
      >
        <span>Assigned runs</span>
        <span className="plate-id">{view.runOrder.length}</span>
      </div>

      <div style={{ marginTop: 10 }}>
        {view.runOrder.map((runId) => {
          const run = view.runs[runId]
          if (!run) return null

          const counts = runCounts(view, runId)
          const stops = runStops(view, runId)
          const next = stops.find((s) => s.status !== 'delivered' && s.status !== 'exception')
          const complete = run.status === 'complete'

          const cls = [
            'dv-card',
            run.status === 'active' ? 'dv-card--active' : '',
            complete ? 'dv-card--complete' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <button
              key={runId}
              type="button"
              className={cls}
              disabled={complete}
              onClick={() => onPick(runId)}
            >
              <div className="plate">
                <span>{run.label}</span>
                <span className="plate-id">{run.manifestId}</span>
              </div>

              <div className="dv-card-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
                  <span className="dv-card-driver">{run.driver}</span>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <span className="chip">{`Stop ${counts.done}/${counts.total}`}</span>
                    <span className={`chip${run.status === 'active' ? ' chip--accent' : ''}`}>
                      {RUN_STATUS_TEXT[run.status]}
                    </span>
                  </div>
                </div>

                {/* the ONE display numeral this card is allowed */}
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div className="label">ETA min</div>
                  <div
                    className={`numeral numeral--sm${
                      run.status === 'active' ? ' numeral--accent' : ''
                    }`}
                  >
                    {next?.etaMin ?? '—'}
                  </div>
                </div>
              </div>

              <div className="dv-card-next">
                <hr className="rule" style={{ marginBottom: 8 }} />
                {complete ? (
                  <div className="micro micro--dim">All stops closed — manifest filed</div>
                ) : next ? (
                  <>
                    <div className="micro" style={{ color: 'var(--ink-2)' }}>
                      {'Next '}
                      <span className="micro--mono">{next.orderCode}</span>
                      {` · ${windowLabel(next)}`}
                    </div>
                    <div className="micro micro--dim" style={{ marginTop: 2 }}>
                      {next.address}
                    </div>
                  </>
                ) : (
                  <div className="micro micro--dim">Queue clear</div>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <p className="dv-note" style={{ marginTop: 4 }}>
        Tap a run to take it. While you hold a run the dispatch console follows your
        taps — nothing on it moves until you move.
      </p>
    </div>
  )
}

export default RunPicker
