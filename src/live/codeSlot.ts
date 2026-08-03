/**
 * The session-code slot — who is allowed to change the code in the LIVE dialog,
 * and when.
 *
 * This exists because of a real bug. The dialog used to draw its code inside an
 * effect whose dependency list included the parent's `onClose` callback, and the
 * console re-creates that arrow on every render. The console re-renders roughly
 * once a second (the sim engine ticks the store), so the effect re-ran roughly
 * once a second and called `setCode(generateSessionCode())` each time: an
 * unattended dialog cycled through eight different 16-character credentials in
 * eight seconds, and a dispatcher typing a code a phone had already started
 * watched their own keystrokes get overwritten mid-word.
 *
 * The fix is to make "should this slot be re-seeded?" a decision about the
 * SESSION, not about render timing. A code is drawn exactly once per opening,
 * and after that only two things may replace it: the operator typing, and the
 * operator pressing Generate. Everything here is pure and returns the previous
 * object by identity when nothing changed, so a React `setState` with it is a
 * no-op rather than another render.
 */

export interface CodeSlot {
  /** What the input shows. */
  readonly code: string
  /**
   * Which opening this code was drawn for, or `null` when the dialog is closed.
   * Two openings of the same armed session share a key; opening a fresh dialog
   * after a disarm does not.
   */
  readonly seededFor: string | null
}

/** A closed dialog holds nothing, so the next opening always draws fresh. */
export const CLOSED_SLOT: CodeSlot = { code: '', seededFor: null }

/**
 * Identity of the current opening. Deliberately derived only from state that
 * describes the SESSION — never from callback identity, element identity or
 * anything else that changes when the parent happens to re-render.
 */
export function slotKeyFor(open: boolean, armedCode: string | null): string | null {
  return open ? `armed:${armedCode ?? ''}` : null
}

/**
 * Seed the slot for the current opening.
 *
 * Idempotent on purpose: call it on every render if you like. It draws a code
 * on the transition into an opening and returns `prev` untouched for every call
 * after that, which is what makes typed input safe.
 */
export function seedCodeSlot(
  prev: CodeSlot,
  open: boolean,
  armedCode: string | null,
  generate: () => string,
): CodeSlot {
  const key = slotKeyFor(open, armedCode)
  if (key === null) return prev.seededFor === null ? prev : CLOSED_SLOT
  if (prev.seededFor === key) return prev
  // An already-armed session shows its own code — there is nothing to draw, and
  // drawing anyway would offer the dispatcher a credential that pairs with
  // nothing.
  return { code: armedCode ?? generate(), seededFor: key }
}

/** The explicit Generate button — the ONLY path that replaces a code wholesale. */
export function regenerateCodeSlot(prev: CodeSlot, generate: () => string): CodeSlot {
  if (prev.seededFor === null) return prev
  return { code: generate(), seededFor: prev.seededFor }
}

/** Operator keystrokes. Caller normalises; this only records. */
export function editCodeSlot(prev: CodeSlot, code: string): CodeSlot {
  if (prev.seededFor === null || prev.code === code) return prev
  return { code, seededFor: prev.seededFor }
}
