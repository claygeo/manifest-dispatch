/**
 * Display formatters. Every surface uses these so a dollar amount, a clock
 * time and an order code look identical on the console, the driver phone,
 * the tracking card and the printed manifest.
 */

import type { ExceptionReason, PaymentMethod, StopStatus, RunStatus } from './types'

export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** '2:00 PM' — the window / ETA register. */
export function formatClock(ms: number): string {
  const d = new Date(ms)
  let h = d.getHours()
  const m = d.getMinutes()
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`
}

/** '16:02:41' — the event-feed / document register (mono, 24h, unambiguous). */
export function formatStamp(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

/** '2026-08-02' — manifest document date. */
export function formatDocDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/** Minutes from now, rendered as a clock time. */
export function etaClock(nowMs: number, etaMin: number | null): string {
  if (etaMin === null) return '—'
  return formatClock(nowMs + etaMin * 60_000)
}

/** DESIGN: ETA drift renders inline as `4:12 → 4:19`, never as a red/green badge. */
export function driftLabel(fromMs: number, toMs: number): string {
  return `${formatClock(fromMs)} → ${formatClock(toMs)}`
}

/** '27.9506, -82.4572' — mono coordinate readout. */
export function formatLngLat(lngLat: [number, number]): string {
  return `${lngLat[1].toFixed(4)}, ${lngLat[0].toFixed(4)}`
}

/** Full name -> 'Dana W.' Console and driver queue never show the full surname. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

/** First name only — the tracking page tells the customer who is coming. */
export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0]
}

/* -------------------------------------------------------------- labels ---
 *
 * Two registers, deliberately kept apart (DESIGN.md v2).
 *
 *   *_LABEL — the DOCUMENT/RECORD voice: the printable compliance manifest and
 *             the values written into the event log. Caps is diegetic there and
 *             those strings are also matched on downstream, so they are stable.
 *   *_TEXT  — the UI voice: sentence case, what every screen actually renders.
 *
 * The two must always mean the same thing. Only the shouting differs.
 */

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'CASH',
  debit: 'DEBIT',
  digital: 'DIGITAL',
}

export const STOP_STATUS_LABEL: Record<StopStatus, string> = {
  pending: 'PENDING',
  enroute: 'EN ROUTE',
  arrived: 'ARRIVED',
  id_check: 'ID CHECK',
  delivered: 'DELIVERED',
  exception: 'EXCEPTION',
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  staged: 'STAGED',
  active: 'ACTIVE',
  complete: 'COMPLETE',
}

export const PAYMENT_TEXT: Record<PaymentMethod, string> = {
  cash: 'Cash',
  debit: 'Debit',
  digital: 'Digital',
}

export const STOP_STATUS_TEXT: Record<StopStatus, string> = {
  pending: 'Pending',
  enroute: 'En route',
  arrived: 'Arrived',
  id_check: 'ID check',
  delivered: 'Delivered',
  exception: 'Exception',
}

export const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  staged: 'Staged',
  active: 'Active',
  complete: 'Complete',
}

/**
 * UI voice for the exception reasons. Mirrors `EXCEPTION_LABEL` in store.ts,
 * which stays caps because it is what gets written into the event log and read
 * back by the manifest.
 */
export const EXCEPTION_TEXT: Record<ExceptionReason, string> = {
  no_answer: 'No answer',
  cannot_verify: 'Cannot verify',
  refused: 'Refused',
  address_issue: 'Address issue',
  cancelled: 'Cancelled',
}

/** DESIGN: dual-resolution metrics — never a naked numeral. `Stop 3/5`. */
export function ratioLabel(prefix: string, value: number, ceiling: number): string {
  return `${prefix} ${value}/${ceiling}`
}
