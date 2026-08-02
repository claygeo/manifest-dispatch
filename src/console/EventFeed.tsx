/**
 * Event feed — the console's right rail.
 *
 * DESIGN: "delivery events (departed, arrived, ID verified, closed — cash) as a
 * chat-transcript-style timeline, newest on top, mono timestamps." The
 * transcript spine is a hairline with a tick per event, so the column reads as
 * one conversation rather than a table of rows. v2 keeps the transcript tight —
 * the stamps stay mono because a timestamp is a record; the event names are UI
 * text and read as sentence case.
 *
 * Collapsible: folded, the panel becomes a labelled spine on the right edge and
 * the map reclaims the width.
 *
 * Accent discipline: a row only takes the live accent when it belongs to the
 * currently selected run — accent means "this is the thing you are watching".
 * Amber is reserved for the two events a dispatcher must act on.
 */

import { memo } from 'react'
import type { DeliveryEvent, DeliveryEventType, Run, Stop } from '../types'
import { formatStamp } from '../format'
import { isLateArrivalNote } from '../window'
import { ChevronRight } from './icons'

const TYPE_LABEL: Record<DeliveryEventType, string> = {
  run_started: 'Run started',
  departed: 'Departed',
  arrived: 'Arrived',
  id_verified: 'ID verified',
  id_failed: 'ID failed',
  closed: 'Closed',
  exception: 'Exception',
  note: 'Note',
}

const AMBER_TYPES: DeliveryEventType[] = ['exception', 'id_failed']

/**
 * SPEC: an out-of-window arrival is flagged and logged. `meta.window` carries
 * the note (see store.arriveStop); only a LATE one earns amber, because a
 * driver waiting for a window to open is the job, not an exception.
 */
function isAmber(event: DeliveryEvent): boolean {
  if (AMBER_TYPES.includes(event.type)) return true
  return event.type === 'arrived' && isLateArrivalNote(event.meta?.window)
}

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
      return meta.to ? `To ${meta.to}` : ''
    case 'arrived':
      return meta.window ?? ''
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
          <span className="dc-ev__type">{TYPE_LABEL[event.type]}</span>
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
          {`Event feed · ${totalCount}`}
        </button>
      </aside>
    )
  }

  const scopeRun = scopeRunId ? runs[scopeRunId] : null
  const scopeTarget = scopableRunId ? runs[scopableRunId] : null

  return (
    <aside className="glass dc-feed" aria-label="Event feed">
      <div className="plate dc-feed__plate">
        <span>Event feed</span>
        <span className="plate-id">{`${events.length}/${totalCount}`}</span>
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
          {scopeRun ? `Scope · ${scopeRun.label}` : 'Scope · fleet'}
        </button>
        <span className="micro micro--dim">Newest first</span>
      </div>

      <div className="dc-feed__scroll">
        {events.length === 0 ? (
          <div className="micro micro--dim dc-feed__empty">No events on this scope yet.</div>
        ) : (
          events.map((event) => {
            const stop = event.stopId ? stops[event.stopId] : null
            const subject = stop?.orderCode ?? runs[event.runId]?.label ?? ''
            const tone: EventRowProps['tone'] = isAmber(event)
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
