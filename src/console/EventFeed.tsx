/**
 * Event feed — the console's right rail.
 *
 * DESIGN: "delivery events (departed, arrived, ID VERIFIED, closed — CASH) as a
 * chat-transcript-style timeline, newest on top, mono timestamps." The
 * transcript spine is a hairline with a tick per event, so the column reads as
 * one conversation rather than a table of rows.
 *
 * Collapsible: folded, the panel becomes a labelled equipment spine on the
 * right edge and the map reclaims the width.
 *
 * Accent discipline: a row only takes the live accent when it belongs to the
 * currently selected run — accent means "this is the thing you are watching".
 * Amber is reserved for the two events a dispatcher must act on.
 */

import { memo } from 'react'
import type { DeliveryEvent, DeliveryEventType, Run, Stop } from '../types'
import { formatStamp } from '../format'
import { ChevronRight } from './icons'

const TYPE_LABEL: Record<DeliveryEventType, string> = {
  run_started: 'RUN STARTED',
  departed: 'DEPARTED',
  arrived: 'ARRIVED',
  id_verified: 'ID VERIFIED',
  id_failed: 'ID FAILED',
  closed: 'CLOSED',
  exception: 'EXCEPTION',
  note: 'NOTE',
}

const AMBER_TYPES: DeliveryEventType[] = ['exception', 'id_failed']

export interface EventFeedProps {
  /** Newest first — pass `recentEvents(...)` straight through. */
  events: DeliveryEvent[]
  totalCount: number
  stops: Record<string, Stop>
  runs: Record<string, Run>
  collapsed: boolean
  /** Run id the feed is scoped to, or null for the whole fleet. */
  scopeRunId: string | null
  /** Run id that could be scoped to (the current selection), if any. */
  scopableRunId: string | null
  onToggleCollapse: () => void
  onToggleScope: () => void
  onSelectEvent: (event: DeliveryEvent) => void
}

function detailOf(event: DeliveryEvent): string {
  const meta = event.meta ?? {}
  switch (event.type) {
    case 'closed':
      return [meta.payment, meta.amount].filter(Boolean).join(' · ')
    case 'departed':
      return meta.to ? `TO ${meta.to}` : ''
    case 'exception':
    case 'id_failed':
      return meta.reason ?? ''
    case 'run_started':
      return [meta.driver, meta.manifest].filter(Boolean).join(' · ')
    case 'note':
      return meta.message ?? ''
    default:
      return ''
  }
}

interface EventRowProps {
  event: DeliveryEvent
  subject: string
  detail: string
  tone: 'neutral' | 'accent' | 'amber'
  onSelect: (event: DeliveryEvent) => void
}

function EventRowBase({ event, subject, detail, tone, onSelect }: EventRowProps) {
  return (
    <button
      type="button"
      className={`dc-ev${tone === 'amber' ? ' dc-ev--amber' : tone === 'accent' ? ' dc-ev--accent' : ''}`}
      onClick={() => onSelect(event)}
    >
      <span className="micro micro--mono micro--dim dc-ev__time">
        {formatStamp(Date.parse(event.at))}
      </span>
      <span className="dc-ev__body">
        <span className="dc-ev__head">
          <span className="micro micro--mono dc-ev__type">{TYPE_LABEL[event.type]}</span>
          {subject ? <span className="micro micro--mono micro--dim">{subject}</span> : null}
        </span>
        {detail ? <span className="micro micro--dim dc-ev__detail">{detail}</span> : null}
      </span>
    </button>
  )
}

const EventRow = memo(EventRowBase)

export function EventFeed({
  events,
  totalCount,
  stops,
  runs,
  collapsed,
  scopeRunId,
  scopableRunId,
  onToggleCollapse,
  onToggleScope,
  onSelectEvent,
}: EventFeedProps) {
  if (collapsed) {
    return (
      <aside className="glass dc-feed dc-feed--collapsed" aria-label="Event feed, collapsed">
        <button
          type="button"
          className="dc-feed__spine"
          onClick={onToggleCollapse}
          aria-expanded={false}
          title="Expand event feed"
        >
          {`EVENT FEED · ${totalCount}`}
        </button>
      </aside>
    )
  }

  const scopeRun = scopeRunId ? runs[scopeRunId] : null
  const scopeTarget = scopableRunId ? runs[scopableRunId] : null

  return (
    <aside className="glass dc-feed" aria-label="Event feed">
      <div className="plate dc-feed__plate">
        <span>EVENT FEED</span>
        <span>{`${events.length}/${totalCount}`}</span>
        <button
          type="button"
          className="dc-plate-btn"
          onClick={onToggleCollapse}
          aria-expanded
          aria-label="Collapse event feed"
          title="Collapse event feed"
        >
          <ChevronRight size={11} />
        </button>
      </div>

      <div className="dc-feed__scope">
        <button
          type="button"
          className={scopeRun ? 'chip chip--accent' : 'chip chip--quiet'}
          onClick={onToggleScope}
          disabled={!scopeRun && !scopeTarget}
          title={scopeRun ? 'Show the whole fleet' : 'Scope the feed to the selected run'}
        >
          {scopeRun ? `SCOPE ${scopeRun.label.toUpperCase()}` : 'SCOPE FLEET'}
        </button>
        <span className="micro micro--mono micro--dim">NEWEST FIRST</span>
      </div>

      <div className="dc-feed__scroll">
        {events.length === 0 ? (
          <div className="micro micro--dim dc-feed__empty">NO EVENTS ON THIS SCOPE YET.</div>
        ) : (
          events.map((event) => {
            const stop = event.stopId ? stops[event.stopId] : null
            const subject = stop?.orderCode ?? runs[event.runId]?.label.toUpperCase() ?? ''
            const tone: EventRowProps['tone'] = AMBER_TYPES.includes(event.type)
              ? 'amber'
              : scopableRunId && event.runId === scopableRunId
                ? 'accent'
                : 'neutral'
            return (
              <EventRow
                key={event.id}
                event={event}
                subject={subject}
                detail={detailOf(event)}
                tone={tone}
                onSelect={onSelectEvent}
              />
            )
          })
        )}
      </div>
    </aside>
  )
}

export default EventFeed
