/**
 * The two screens at the end of a shift.
 *
 * `ReturningToDepot` — the last leg has no stop, so there is nothing for the
 * driver to press. The van drives itself home; the screen says so plainly
 * instead of parking a dead button at thumb height.
 *
 * `RunClosed` — the manifest is filed. Counts only: stops closed, exceptions,
 * cash carried back. No confetti, no green (DESIGN.md: "never green-celebrate").
 *
 * DESIGN.md v2 names this screen as one of the display-serif moments: the end
 * of a shift is the one place in the driver app that earns a sentence in
 * Source Serif rather than a label. It states a fact; it does not congratulate.
 */

import { LegStrip } from './LegStrip'
import { formatMoney } from '../format'
import type { Run, Stop } from '../types'

export interface ReturningToDepotProps {
  run: Run
  onHandBack: () => void
}

export function ReturningToDepot({ run, onHandBack }: ReturningToDepotProps) {
  return (
    <>
      <div className="dv-body">
        <div className="dv-pad-x">
          <section className="dv-block">
            <div className="plate">
              <span>Queue clear</span>
              <span className="plate-id">{run.manifestId}</span>
            </div>
            <div className="dv-block-body">
              <p className="micro" style={{ margin: 0 }}>
                Every stop on this run is closed out. Heading back to the depot — the
                manifest files itself on arrival.
              </p>
            </div>
          </section>

          <LegStrip
            runId={run.id}
            legIndex={run.currentLeg}
            progress={run.progress}
            stop={null}
            etaMin={null}
            label={run.label}
          />
        </div>
      </div>

      <footer className="dv-foot">
        <button type="button" className="btn btn--driver dv-slab" disabled>
          Returning to depot
          <span className="dv-slab-hint">No action required</span>
        </button>
        <button type="button" className="dv-quiet" onClick={onHandBack}>
          Back to run list
        </button>
      </footer>
    </>
  )
}

export interface RunClosedProps {
  run: Run
  stops: Stop[]
  onPickAnother: () => void
}

export function RunClosed({ run, stops, onPickAnother }: RunClosedProps) {
  const delivered = stops.filter((s) => s.status === 'delivered')
  const exceptions = stops.filter((s) => s.status === 'exception')
  const cash = delivered
    .filter((s) => s.payment === 'cash')
    .reduce((sum, s) => sum + s.amountDue, 0)

  return (
    <>
      <div className="dv-body">
        <div className="dv-pad-x">
          <section className="dv-block">
            <div className="plate">
              <span>Run closed</span>
              <span className="plate-id">{run.manifestId}</span>
            </div>

            <div className="dv-block-body">
              {/* The one serif moment in the driver app. A statement of fact,
                  not a celebration. */}
              <p className="display dv-endline">The manifest is filed.</p>

              <div className="dv-due">
                <div className="dv-field">
                  <span className="label">Stops closed</span>
                  {/* the ONE display numeral on this panel */}
                  <span className="numeral numeral--serif">
                    {`${delivered.length}/${stops.length}`}
                  </span>
                </div>
                <div className="dv-chips">
                  <span className="chip chip--quiet">{run.driver}</span>
                  {exceptions.length > 0 ? (
                    <span className="chip chip--amber">{`Exceptions ${exceptions.length}`}</span>
                  ) : (
                    <span className="chip">Exceptions 0</span>
                  )}
                </div>
              </div>

              <div className="dv-tear" />

              <div className="dv-row">
                <span className="label">Cash carried back</span>
                <span className="dv-value-mono">{formatMoney(cash)}</span>
              </div>

              {exceptions.map((s) => (
                <div className="dv-row" key={s.id}>
                  <span className="micro micro--mono" style={{ color: 'var(--amber)' }}>
                    {s.orderCode}
                  </span>
                  <span className="micro micro--dim">Undelivered — return to depot</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <footer className="dv-foot">
        <button
          type="button"
          className="btn btn--primary btn--driver dv-slab"
          onClick={onPickAnother}
        >
          Back to run list
          <span className="dv-slab-hint">Manifest filed</span>
        </button>
      </footer>
    </>
  )
}
