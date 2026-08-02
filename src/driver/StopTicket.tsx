/**
 * The stop ticket — the driver app's page.
 *
 * SPEC: "Current stop = full-screen POS ticket: customer, address (tap = open
 * in Maps app), items, AMOUNT DUE $84.50, payment method chip, delivery window,
 * mono orderCode."
 *
 * Laid out as a document rather than a card: plate header, mono identifiers,
 * one display numeral (the amount), a tear-off edge. Above it, the four-segment
 * state ladder — the answer to "a driver who has never seen software must never
 * wonder what to press next": the ladder says where they are, the slab at
 * thumb height says what to do, and there is never a second thing competing
 * with it.
 */

import { LegStrip } from './LegStrip'
import { useStore } from '../store'
import { windowLabel, windowState } from '../selectors'
import { formatMoney, PAYMENT_LABEL, STOP_STATUS_LABEL } from '../format'
import type { Run, Stop, StopStatus } from '../types'

type StepState = 'todo' | 'now' | 'done' | 'flag'

const LADDER: readonly string[] = ['EN ROUTE', 'ARRIVED', 'ID CHECK', 'CLOSED']

/** The one primary action this screen state allows. */
export interface TicketAction {
  label: string
  hint?: string
  onPress: () => void
  disabled?: boolean
}

function ladderFor(status: StopStatus, idChecked: boolean): StepState[] {
  switch (status) {
    case 'pending':
    case 'enroute':
      return ['now', 'todo', 'todo', 'todo']
    case 'arrived':
      return ['done', 'now', 'todo', 'todo']
    case 'id_check':
      return ['done', 'done', 'now', 'todo']
    case 'delivered':
      return ['done', 'done', 'done', 'done']
    case 'exception':
      return idChecked ? ['done', 'done', 'done', 'flag'] : ['done', 'done', 'flag', 'todo']
    default:
      return ['todo', 'todo', 'todo', 'todo']
  }
}

function mapsHref(stop: Stop): string {
  const [lng, lat] = stop.lngLat
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

export interface StopTicketProps {
  run: Run
  stop: Stop
  seq: number
  total: number
  simNowMs: number
  action: TicketAction
  /** null once the stop is closed out — there is nothing left to except. */
  onReportIssue: (() => void) | null
}

export function StopTicket({
  run,
  stop,
  seq,
  total,
  simNowMs,
  action,
  onReportIssue,
}: StopTicketProps) {
  const steps = ladderFor(stop.status, stop.idChecked)
  const late = windowState(stop, simNowMs) === 'late' && stop.status !== 'delivered'

  // Live mode only: the mini-map draws a ring at the fix's real accuracy.
  const liveFix = useStore((s) => s.liveFix)
  const liveRunId = useStore((s) => s.liveRunId)
  const accuracyM =
    liveFix && !liveFix.simulated && liveRunId === run.id ? liveFix.accuracyM : null

  return (
    <>
      <div className="dv-body">
        <div className="dv-ladder">
          {LADDER.map((name, i) => (
            <div key={name} className={`dv-step dv-step--${steps[i]}`}>
              <i />
              <span>{name}</span>
            </div>
          ))}
        </div>

        <div className="dv-pad-x">
          <article className="dv-receipt">
            <div className="plate">
              <span>{`STOP ${seq}/${total}`}</span>
              <span>{stop.orderCode}</span>
            </div>

            <div className="dv-receipt-body">
              <div>
                <div className="label">CUSTOMER</div>
                <div className="dv-name">{stop.customer}</div>
                <a
                  className="dv-nav"
                  href={mapsHref(stop)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${stop.address} in Maps`}
                >
                  <span className="dv-nav-addr">{stop.address}</span>
                  <span className="dv-nav-go">NAVIGATE &rsaquo;</span>
                </a>
              </div>

              <div className="dv-tear" />

              <div>
                <div className="label">{`ORDER — ${run.manifestId}`}</div>
                <div className="dv-items">
                  {stop.items.map((item) => (
                    <div className="dv-item" key={item.name}>
                      <span>{item.name}</span>
                      <span className="dv-item-qty">{`×${item.qty}`}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dv-tear" />

              <div className="dv-due">
                <div>
                  <div className="label">AMOUNT DUE</div>
                  {/* the ONE display numeral on this ticket */}
                  <div className="numeral">{formatMoney(stop.amountDue)}</div>
                </div>
                <div className="dv-chips">
                  <span className="chip chip--solid">{PAYMENT_LABEL[stop.payment]}</span>
                  <span className={`chip${late ? ' chip--amber' : ' chip--quiet'}`}>
                    {late ? `LATE ${windowLabel(stop)}` : windowLabel(stop)}
                  </span>
                  <span
                    className={`chip${
                      stop.status === 'exception' ? ' chip--amber' : ' chip--accent'
                    }`}
                  >
                    {STOP_STATUS_LABEL[stop.status]}
                  </span>
                </div>
              </div>
            </div>

            <div className="dv-tear" />
            <div className="dv-perf" />
          </article>

          <LegStrip
            runId={run.id}
            legIndex={run.currentLeg}
            progress={run.progress}
            stop={stop}
            /* An ETA only means something while the van is still rolling. */
            etaMin={stop.status === 'enroute' ? stop.etaMin : null}
            label={run.label.toUpperCase()}
            accuracyM={accuracyM}
          />
        </div>
      </div>

      <footer className="dv-foot">
        <button
          type="button"
          className="btn btn--primary btn--driver dv-slab"
          onClick={action.onPress}
          disabled={action.disabled}
        >
          {action.label}
          {action.hint ? <span className="dv-slab-hint">{action.hint}</span> : null}
        </button>
        {onReportIssue ? (
          <button type="button" className="dv-quiet" onClick={onReportIssue}>
            CAN&rsquo;T COMPLETE THIS STOP
          </button>
        ) : null}
      </footer>
    </>
  )
}

export default StopTicket
