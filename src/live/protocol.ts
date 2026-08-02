/**
 * Wire format for the `session:<code>` broadcast channel.
 *
 * Two message kinds, and the split between them is the whole design:
 *
 *   `gps`  — 1 Hz, high volume, worthless five seconds later. Broadcast only.
 *            Never written to Supabase; there is no table for it and there
 *            should not be. A dropped ping costs nothing, the next one is a
 *            second away.
 *
 *   `sync` — the claimed run's ladder state (run status, queue pointer, every
 *            stop's status/payment/closeout) plus the tail of its event log.
 *            A SNAPSHOT, not a delta, because Supabase broadcast is unordered
 *            and lossy and a console that opens the link mid-shift has to
 *            converge on the truth from one message. Receivers diff it against
 *            their own store and call the SAME actions the sim engine calls.
 *
 * Dispatch events are additionally written through `api_log_event` so a session
 * survives a reload — see ./session.ts. Snapshots carry the event id so a
 * replayed log and a live broadcast of the same event collapse into one row in
 * the feed.
 */

import type { DeliveryEvent, PaymentMethod, RunStatus, StopStatus } from '../types'

/** Which surface this tab is. Only the driver publishes; the rest listen. */
export type LiveRole = 'console' | 'driver' | 'tracking'

export const MSG_GPS = 'gps'
export const MSG_SYNC = 'sync'
/** A late joiner shouting "anyone there?"; the driver answers with a snapshot. */
export const MSG_HELLO = 'hello'

export interface GpsPing {
  runId: string
  lngLat: [number, number]
  /** Degrees clockwise from north, derived from the movement vector. */
  heading: number
  /** Reported horizontal accuracy in metres. 0 when simulated. */
  accuracy: number
  /** Honesty rail: true when the phone is playing the precomputed route. */
  simulated: boolean
  /** Wall-clock ms at the phone. */
  at: number
}

export interface StopSnapshot {
  id: string
  status: StopStatus
  idChecked: boolean
  closedAt: string | null
  payment: PaymentMethod
  etaMin: number | null
}

export interface RunSnapshot {
  runId: string
  status: RunStatus
  currentLeg: number
  progress: number
  position: [number, number]
  heading: number
  stops: StopSnapshot[]
  /** Newest tail of this run's DeliveryEvents, oldest first. */
  events: DeliveryEvent[]
  at: number
}

export interface HelloMessage {
  /** Who is asking. Present so a driver never answers its own echo. */
  role: LiveRole
}

/** Narrowing guards — everything off a socket is untrusted until proven shaped. */

function isLngLat(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
}

export function isGpsPing(v: unknown): v is GpsPing {
  if (!v || typeof v !== 'object') return false
  const p = v as Partial<GpsPing>
  return (
    typeof p.runId === 'string' &&
    isLngLat(p.lngLat) &&
    typeof p.heading === 'number' &&
    typeof p.accuracy === 'number' &&
    typeof p.at === 'number'
  )
}

export function isRunSnapshot(v: unknown): v is RunSnapshot {
  if (!v || typeof v !== 'object') return false
  const s = v as Partial<RunSnapshot>
  return (
    typeof s.runId === 'string' &&
    typeof s.currentLeg === 'number' &&
    typeof s.progress === 'number' &&
    isLngLat(s.position) &&
    Array.isArray(s.stops) &&
    Array.isArray(s.events)
  )
}
