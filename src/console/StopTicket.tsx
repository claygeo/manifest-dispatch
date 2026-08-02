/**
 * Stop ticket — the console's atom.
 *
 * BotW neutral-shelf rule: identical geometry for every stop, always. Status is
 * carried by left-border weight + fill tint + ONE small pill chip. The card is
 * never resized and never re-coloured wholesale, and badges never pile up.
 * Tight 8px radius: this is dense ops data, not a card (DESIGN.md v2).
 *
 * Amber appears in exactly two situations, both of which a dispatcher must act
 * on: the stop is in `exception`, or its projected arrival misses the delivery
 * window. Everything else stays in the neutral field.
 *
 * Every prop is a primitive or a stable reference so React.memo actually holds
 * — the store republishes fleet state ~5×/second.
 */

import { memo, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ExceptionReason, Stop } from '../types'
import { formatMoney, PAYMENT_TEXT, shortName, STOP_STATUS_TEXT } from '../format'
import { ChevronDown, ChevronUp } from './icons'

export interface StopTicketProps {
  stop: Stop
  /** 1-based position in the run's (reorderable) sequence. */
  seq: number
  selected: boolean
  /** Projected arrival misses the delivery window — the only window amber. */
  late: boolean
  /** Projected arrival clock, e.g. '4:19 PM'. Null when there is no ETA. */
  etaClockLabel: string | null
  /** SPEC: promote/demote is offered on STAGED runs only. */
  canReorder: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  /** The exception on this stop is an order cancellation, not a doorstep failure. */
  cancelled: boolean
  onSelect: (stopId: string) => void
  onReorder: (stopId: string, direction: -1 | 1) => void
  onException: (stopId: string, reason: ExceptionReason) => void
  onCancel: (stopId: string) => void
}

/** How long the CANCEL control stays armed before it forgets it was pressed. */
const CANCEL_ARM_MS = 4000

const OPEN_STATUSES: Stop['status'][] = ['pending', 'enroute', 'arrived', 'id_check']

const FLAGS: { reason: ExceptionReason; label: string }[] = [
  { reason: 'no_answer', label: 'No answer' },
  { reason: 'cannot_verify', label: 'No ID' },
  { reason: 'address_issue', label: 'Address' },
]

function ticketClass(stop: Stop, selected: boolean, late: boolean, canReorder: boolean): string {
  const parts = ['ticket', 'dc-ticket']
  if (stop.status === 'exception') parts.push('ticket--exception')
  else if (stop.status === 'delivered') parts.push('ticket--done')
  else if (late) parts.push('ticket--exception')
  else if (stop.status === 'pending') parts.push('ticket--pending')
  else parts.push('ticket--active')
  if (selected) parts.push('ticket--selected')
  if (canReorder) parts.push('dc-ticket--reorder')
  return parts.join(' ')
}

function statusChip(stop: Stop, late: boolean, cancelled: boolean): { text: string; amber: boolean } {
  // Still ONE chip (no badge pile): a cancelled order just names itself, because
  // "Exception" would send a dispatcher chasing a doorstep that never happened.
  if (stop.status === 'exception') return { text: cancelled ? 'Cancelled' : 'Exception', amber: true }
  if (stop.status === 'delivered') return { text: STOP_STATUS_TEXT.delivered, amber: false }
  if (late) return { text: 'Late', amber: true }
  return { text: STOP_STATUS_TEXT[stop.status], amber: false }
}

function StopTicketBase({
  stop,
  seq,
  selected,
  late,
  etaClockLabel,
  canReorder,
  canMoveUp,
  canMoveDown,
  cancelled,
  onSelect,
  onReorder,
  onException,
  onCancel,
}: StopTicketProps) {
  const chip = statusChip(stop, late, cancelled)
  const open = OPEN_STATUSES.includes(stop.status)

  /**
   * Cancelling an order pulls it out of a run that is already on the road, and
   * there is no undo. One click arms, the second commits, and walking away
   * disarms — the same two-beat every irreversible control in an ops tool has.
   */
  const [cancelArmed, setCancelArmed] = useState(false)
  useEffect(() => {
    if (!cancelArmed) return
    const id = window.setTimeout(() => setCancelArmed(false), CANCEL_ARM_MS)
    return () => window.clearTimeout(id)
  }, [cancelArmed])
  useEffect(() => {
    if (!selected || !open) setCancelArmed(false)
  }, [selected, open])

  return (
    <div
      className={ticketClass(stop, selected, late, canReorder)}
      data-stop-id={stop.id}
      data-sel-id={`stop:${stop.id}`}
    >
      <button
        type="button"
        className="dc-ticket__hit"
        onClick={() => onSelect(stop.id)}
        aria-pressed={selected}
        aria-label={`Stop ${seq}, order ${stop.orderCode}, ${chip.text}`}
      >
        <div className="dc-tk-row">
          <span className="micro micro--mono">
            <span style={{ color: 'var(--ink)' }}>{String(seq).padStart(2, '0')}</span>
            <span className="micro--dim">{' · '}</span>
            {stop.orderCode}
          </span>
          <span className={chip.amber ? 'chip chip--amber' : 'chip'}>{chip.text}</span>
        </div>

        <div className="dc-tk-name">{shortName(stop.customer)}</div>
        <div className="micro micro--dim dc-trunc">{stop.address}</div>

        <div className="dc-tk-foot">
          <span className="micro micro--mono micro--dim">
            {`${stop.window[0]}–${stop.window[1]}`}
          </span>
          <span className={late ? 'micro micro--mono' : 'micro micro--mono micro--dim'}>
            {etaClockLabel ? `ETA ${etaClockLabel}` : stop.closedAt ? 'Closed' : '—'}
          </span>
        </div>

        {selected ? (
          <div style={{ marginTop: 7 }}>
            {stop.items.map((item) => (
              <div key={item.name} className="micro micro--dim dc-trunc">
                {`${item.qty}× ${item.name}`}
              </div>
            ))}
            <div className="micro" style={{ marginTop: 4, color: 'var(--ink)', fontWeight: 500 }}>
              {`${formatMoney(stop.amountDue)} · ${PAYMENT_TEXT[stop.payment]}`}
            </div>
          </div>
        ) : null}
      </button>

      {canReorder ? (
        <div className="dc-tk-tools">
          <button
            type="button"
            className="dc-nudge"
            disabled={!canMoveUp}
            onClick={() => onReorder(stop.id, -1)}
            aria-label={`Promote ${stop.orderCode} in the run sequence`}
            title="Promote"
          >
            <ChevronUp size={10} />
          </button>
          <button
            type="button"
            className="dc-nudge"
            disabled={!canMoveDown}
            onClick={() => onReorder(stop.id, 1)}
            aria-label={`Demote ${stop.orderCode} in the run sequence`}
            title="Demote"
          >
            <ChevronDown size={10} />
          </button>
        </div>
      ) : null}

      {selected ? (
        <div className="dc-actions">
          {open ? (
            <>
              <span className="label">Flag</span>
              {/* Neutral controls on purpose: amber is reserved for the
                  exception STATE, not for the button that creates it. */}
              {FLAGS.map((f) => (
                <button
                  key={f.reason}
                  type="button"
                  className="btn dc-btn-xs"
                  onClick={() => onException(stop.id, f.reason)}
                >
                  {f.label}
                </button>
              ))}
              <span className="label">Order</span>
              <button
                type="button"
                className="btn dc-btn-xs"
                onClick={() => {
                  if (cancelArmed) onCancel(stop.id)
                  else setCancelArmed(true)
                }}
                aria-label={
                  cancelArmed
                    ? `Confirm cancelling order ${stop.orderCode}`
                    : `Cancel order ${stop.orderCode}`
                }
                title="Order cancelled after dispatch — the run skips this stop"
              >
                {cancelArmed ? 'Confirm cancel' : 'Cancel'}
              </button>
            </>
          ) : (
            <span className="label">
              {stop.status === 'exception'
                ? cancelled
                  ? 'Order cancelled'
                  : 'Undeliverable'
                : 'Closed out'}
            </span>
          )}
          <Link className="dc-link" style={{ marginLeft: 'auto' }} to={`/t/${stop.orderCode}`}>
            Tracking →
          </Link>
        </div>
      ) : null}
    </div>
  )
}

export const StopTicket = memo(StopTicketBase)
export default StopTicket
