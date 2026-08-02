/**
 * Delivery-window maths.
 *
 * Lifted out of selectors.ts so the STORE can use it too: the store logs the
 * arrival event, and SPEC.md requires an out-of-window arrival to be "flagged,
 * logged, still completable". Importing selectors.ts from store.ts would close
 * an import cycle (selectors already imports `runIdOf` from the store), so the
 * shared half lives here and selectors.ts re-exports it unchanged.
 *
 * Two different questions, deliberately kept apart:
 *
 *   windowState()      — will the driver make this window? Projected, from the
 *                        live ETA. Drives the console's amber. Recomputed every
 *                        tick, meaningless once the stop is closed.
 *   arrivalWindowNote() — did the driver make it? Judged once, at the moment of
 *                        arrival, and written into the event log. Survives the
 *                        stop closing, which is what the manifest needs.
 */

import type { Stop, WindowState } from './types'

/** '2:00 PM' -> ms on the same calendar day as `refMs` (nearest day wins). */
export function parseClock(clock: string, refMs: number): number {
  // Hours are 1–12 and minutes 00–59 by construction: anything else is not a
  // clock, and silently folding it mod 12 (which `\d{1,2}` used to do — '25:00 PM'
  // came back as 1 PM) would put a confident wrong time on a compliance document.
  // Unparseable input falls back to the reference, which is the documented contract.
  const m = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i.exec(clock.trim())
  if (!m) return refMs
  let h = parseInt(m[1], 10) % 12
  if (m[3].toUpperCase() === 'PM') h += 12
  const d = new Date(refMs)
  d.setHours(h, parseInt(m[2], 10), 0, 0)
  let ms = d.getTime()
  const DAY = 86_400_000
  if (ms - refMs > DAY / 2) ms -= DAY
  if (refMs - ms > DAY / 2) ms += DAY
  return ms
}

/**
 * SPEC: "stops outside their window flag amber on console."
 * `late` is the only state that earns amber — everything else stays neutral.
 */
export function windowState(stop: Stop, simNowMs: number): WindowState {
  if (stop.status === 'delivered') return 'closed'
  const end = parseClock(stop.window[1], simNowMs)
  const start = parseClock(stop.window[0], simNowMs)
  const arrival = stop.etaMin === null ? simNowMs : simNowMs + stop.etaMin * 60_000
  if (arrival > end) return 'late'
  if (simNowMs >= start) return 'due'
  return 'ok'
}

export function windowLabel(stop: Stop): string {
  return `${stop.window[0]}–${stop.window[1]}`
}

/* --------------------------------------------------------- arrival note --- */

/**
 * The compliance note for an arrival, or null when the window was still open.
 *
 * SPEC: an out-of-window arrival is "flagged, logged, still completable —
 * reality beats theory in the field". So this returns a note; it never returns
 * a veto. Nothing downstream is allowed to block the close on it.
 *
 * Only a CLOSED window is recorded. Arriving before a window opens is the
 * normal shape of the job — the driver waits — and `windowState` above already
 * takes the same line by treating `late` as the only flag-worthy state. Logging
 * every early arrival would put a compliance note on most stops in the demo
 * (the seeded windows run ahead of the route) and turn the one annotation that
 * matters into wallpaper.
 */
export function arrivalWindowNote(stop: Stop, atMs: number): string | null {
  const end = parseClock(stop.window[1], atMs)
  if (atMs > end) return `LATE — WINDOW CLOSED ${stop.window[1]}`
  return null
}

/** True for the arrival notes that earn amber: the window had already closed. */
export function isLateArrivalNote(note: string | null | undefined): boolean {
  return typeof note === 'string' && note.startsWith('LATE')
}
