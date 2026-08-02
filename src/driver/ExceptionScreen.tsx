/**
 * Exception path.
 *
 * SPEC: "Exception path: no answer / cannot verify → logs event, undeliverable
 * state, next." The button text is the UI mirror of the reason; the value
 * written into the event log stays the caps `EXCEPTION_LABEL` in store.ts,
 * because that is the record the manifest reads back.
 *
 * The two reasons the spec names are the only two offered — a longer menu would
 * turn a 20-second doorstep decision into a form. Amber lives here and almost
 * nowhere else in the driver app, because an exception is the one thing that
 * puts work back on a dispatcher.
 */

import { EXCEPTION_TEXT } from '../format'
import type { ExceptionReason, Stop } from '../types'

const REASONS: { reason: ExceptionReason; blurb: string }[] = [
  { reason: 'no_answer', blurb: 'Nobody came to the door. Order returns to the depot.' },
  { reason: 'cannot_verify', blurb: 'ID missing, expired, or not a match. Handoff refused.' },
]

export interface ExceptionScreenProps {
  stop: Stop
  onFlag: (reason: ExceptionReason) => void
  onBack: () => void
}

export function ExceptionScreen({ stop, onFlag, onBack }: ExceptionScreenProps) {
  return (
    <>
      <div className="dv-body">
        <div className="dv-screen">
          <section className="dv-block">
            <div className="plate plate--amber">
              <span>Undeliverable</span>
              <span className="plate-id">{stop.orderCode}</span>
            </div>
            <div className="dv-block-body">
              <div className="dv-field">
                <span className="label">Stop</span>
                <span className="dv-name">{stop.customer}</span>
                <span className="micro micro--dim">{stop.address}</span>
              </div>
            </div>
          </section>

          <p className="dv-note">
            Pick a reason. Dispatch sees it the moment you tap, the stop closes
            undelivered, and the run moves on.
          </p>

          <div className="dv-verdict">
            {REASONS.map(({ reason, blurb }) => (
              <button
                key={reason}
                type="button"
                className="btn btn--amber btn--driver dv-slab"
                onClick={() => onFlag(reason)}
              >
                {EXCEPTION_TEXT[reason]}
                <span className="dv-slab-hint">{blurb}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <footer className="dv-foot">
        <button type="button" className="btn btn--driver dv-slab" onClick={onBack}>
          Keep working this stop
        </button>
      </footer>
    </>
  )
}

export default ExceptionScreen
