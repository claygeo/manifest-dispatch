/**
 * Durable outbox for dispatch events.
 *
 * SPEC.md edge case: "driver connectivity loss in live mode (events queue
 * locally, honest reconnect banner, no silent data loss)."
 *
 * Before this existed, `api_log_event` was fire-and-forget: one failed call
 * raised the amber banner and the event was gone — the id had already been
 * marked as sent, so nothing ever retried it. A phone that lost signal for
 * thirty seconds in a tunnel left a hole in the shift's audit trail, which is
 * the one thing a compliance record cannot have.
 *
 * What this is, and what it deliberately is not:
 *
 *  - it queues DISPATCH EVENTS ONLY. GPS pings stay fire-and-forget by design
 *    (see ./protocol.ts): a ping is worthless five seconds later and replaying
 *    a tunnel's worth of stale positions would draw a van driving through the
 *    past.
 *  - it survives a reload, because losing the tab is exactly when a phone in a
 *    dead zone gets closed. `localStorage`, one small JSON array, capped.
 *  - it is transport-agnostic: the caller supplies `send`. That keeps Supabase
 *    out of this file and makes the retry ladder testable without a socket.
 *  - it never drops silently. At the cap the OLDEST entry goes and `dropped`
 *    counts it, so the banner can say so out loud.
 */

import type { DeliveryEvent } from '../types'
import { useStore } from '../store'
import { QUEUE_BACKOFF_MAX_MS, QUEUE_BACKOFF_MS, QUEUE_MAX, QUEUE_STORAGE_KEY } from './config'

export interface QueuedEvent {
  /** Session the event belongs to — a queue can outlive one session's code. */
  code: string
  event: DeliveryEvent
}

export interface QueueStats {
  pending: number
  dropped: number
}

let pending: QueuedEvent[] | null = null
let dropped = 0
let flushing = false
let retryTimer = 0
let backoffMs = QUEUE_BACKOFF_MS
/** Bumped whenever the queue is replaced wholesale, so a flush in flight bails. */
let epoch = 0

/* ------------------------------------------------------------ storage ---- */

function isQueued(v: unknown): v is QueuedEvent {
  if (!v || typeof v !== 'object') return false
  const q = v as Partial<QueuedEvent>
  return (
    typeof q.code === 'string' &&
    Boolean(q.event) &&
    typeof q.event?.id === 'string' &&
    typeof q.event?.at === 'string'
  )
}

function load(): QueuedEvent[] {
  if (pending) return pending
  pending = []
  try {
    const raw = window.localStorage?.getItem(QUEUE_STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) pending = parsed.filter(isQueued)
    }
  } catch {
    /* private mode, quota, or garbage in the slot — start clean */
    pending = []
  }
  return pending
}

function persist(): void {
  try {
    window.localStorage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify(pending ?? []))
  } catch {
    /* the in-memory queue is still authoritative for this tab */
  }
}

function publishCount(): void {
  useStore.getState().setLiveQueued((pending ?? []).length)
}

/* -------------------------------------------------------------- api ------ */

export function queueStats(): QueueStats {
  return { pending: load().length, dropped }
}

/**
 * Accept an event for delivery. Returns immediately — the caller has done its
 * job the moment the event is in here, which is what makes the send-side dedupe
 * (`logged` in session.ts) correct rather than lossy.
 */
export function enqueueEvent(code: string, event: DeliveryEvent): void {
  const queue = load()
  if (queue.some((q) => q.event.id === event.id)) return
  queue.push({ code, event })
  while (queue.length > QUEUE_MAX) {
    queue.shift()
    dropped += 1
  }
  persist()
  publishCount()
}

/**
 * Keep only the entries belonging to `code` (all of them when omitted).
 *
 * Called when a session opens. Leftovers from a different code are dropped on
 * purpose: `api_log_event` for a session this tab has left would retry against
 * a code nobody is watching, forever, on a backoff ladder — a queue that never
 * empties is a banner that never clears, which is the dishonest failure mode
 * this whole file exists to avoid. The events themselves are already in the
 * local feed; what is discarded is a server write nobody can read.
 */
export function retainQueue(code: string | null): void {
  const queue = load()
  pending = code ? queue.filter((q) => q.code === code) : []
  dropped = 0
  epoch += 1
  persist()
  publishCount()
}

export type QueueSender = (item: QueuedEvent) => Promise<boolean>

export interface FlushHandlers {
  /** A send failed; the queue is holding. Raise the honest banner. */
  onStall?: (stats: QueueStats) => void
  /** The queue emptied. Everything written during the outage is now on record. */
  onDrain?: () => void
}

/**
 * Push the queue at the server, oldest first, stopping at the first failure.
 *
 * Strictly in order: these are audit events, and a feed that replays a close
 * before the arrival it belongs to is worse than a feed that is a few seconds
 * behind. Idempotent — a second call while a flush is in flight is a no-op.
 */
export function flushQueue(send: QueueSender, handlers: FlushHandlers = {}): void {
  // Nothing waiting is not a recovery — staying quiet keeps onDrain meaning
  // "the outage is fully written off", which is what the banner reads.
  if (flushing || load().length === 0) return
  flushing = true
  const startedAt = epoch

  void (async () => {
    try {
      for (;;) {
        const queue = load()
        if (epoch !== startedAt) return
        const head = queue[0]
        if (!head) break
        let ok = false
        try {
          ok = await send(head)
        } catch {
          ok = false
        }
        if (epoch !== startedAt) return
        if (!ok) {
          scheduleRetry(send, handlers)
          handlers.onStall?.(queueStats())
          return
        }
        if (queue[0] === head) queue.shift()
        persist()
        publishCount()
      }
      backoffMs = QUEUE_BACKOFF_MS
      handlers.onDrain?.()
    } finally {
      flushing = false
    }
  })()
}

function scheduleRetry(send: QueueSender, handlers: FlushHandlers): void {
  window.clearTimeout(retryTimer)
  const wait = backoffMs
  backoffMs = Math.min(QUEUE_BACKOFF_MAX_MS, Math.round(backoffMs * 2))
  retryTimer = window.setTimeout(() => flushQueue(send, handlers), wait)
}

/** Stop the retry ladder — session teardown. The queue itself is left intact. */
export function stopFlush(): void {
  window.clearTimeout(retryTimer)
  retryTimer = 0
  backoffMs = QUEUE_BACKOFF_MS
}
