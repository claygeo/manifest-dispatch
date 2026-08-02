/**
 * The two screens at the end of a shift.
 *
 * `ReturningToDepot` — the last leg has no stop, so there is nothing for the
 * driver to press. The van drives itself home; the screen says so plainly
 * instead of parking a dead button at thumb height.
 *
 * `RunClosed` — the manifest is filed. Counts only: stops closed, exceptions,
 * cash carried back. No confetti, no green (DESIGN.md: "never green-celebrate").
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
              <span>QUEUE CLEAR</span>
              <span>{run.manifestId}</span>
            </div>
            <div className="dv-block-body">
              <p className="micro">
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
            label={run.label.toUpperCase()}
          />
        </div>
      </div>

      <footer className="dv-foot">
        <button type="button" className="btn btn--driver dv-slab" disabled>
          RETURNING TO DEPOT
          <span className="dv-slab-hint">NO ACTION REQUIRED</span>
        </button>
        <button type="button" className="dv-quiet" onClick={onHandBack}>
          BACK TO RUN LIST
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
              <span>RUN CLOSED</span>
              <span>{run.manifestId}</span>
            </div>

            <div className="dv-block-body">
              <div className="dv-due">
                <div className="dv-field">
                  <span className="label">STOPS CLOSED</span>
                  {/* the ONE display numeral on this panel */}
                  <span className="numeral">{`${delivered.length}/${stops.length}`}</span>
                </div>
                <div className="dv-chips">
                  <span className="chip chip--quiet">{run.driver.toUpperCase()}</span>
                  {exceptions.length > 0 ? (
                    <span className="chip chip--amber">{`EXCEPTIONS ${exceptions.length}`}</span>
                  ) : (
                    <span className="chip">EXCEPTIONS 0</span>
                  )}
                </div>
              </div>

              <div className="dv-tear" />

              <div className="dv-row">
                <span className="label">CASH CARRIED BACK</span>
                <span className="dv-value-mono">{formatMoney(cash)}</span>
              </div>

              {exceptions.map((s) => (
                <div className="dv-row" key={s.id}>
                  <span className="micro micro--mono" style={{ color: 'var(--amber)' }}>
                    {s.orderCode}
                  </span>
                  <span className="micro micro--dim">UNDELIVERED — RETURN TO DEPOT</span>
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
          BACK TO RUN LIST
          <span className="dv-slab-hint">MANIFEST FILED</span>
        </button>
      </footer>
    </>
  )
}
