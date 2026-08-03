/**
 * Regression cover for the LIVE dialog's session code.
 *
 * The bug this file exists for: an unattended dialog showed EIGHT different
 * 16-character codes in eight seconds, because the code was drawn from an effect
 * that re-ran on every store-driven re-render of the console. A dispatcher
 * typing a code their phone had already started had it overwritten mid-word.
 *
 * These tests drive the slot the way React does — repeated reducer calls with
 * the same inputs — and assert that repetition alone changes nothing.
 */

import { describe, expect, it } from 'vitest'
import {
  CLOSED_SLOT,
  editCodeSlot,
  regenerateCodeSlot,
  seedCodeSlot,
  slotKeyFor,
  type CodeSlot,
} from './codeSlot'

/** A generator that is trivially distinguishable per call. */
function counter(): () => string {
  let n = 0
  return () => `GEN${++n}`
}

describe('slotKeyFor', () => {
  it('is null while the dialog is closed, so the next opening draws fresh', () => {
    expect(slotKeyFor(false, null)).toBeNull()
    expect(slotKeyFor(false, 'ARMEDCODEARMEDCO')).toBeNull()
  })

  it('separates an unarmed opening from an armed one', () => {
    expect(slotKeyFor(true, null)).not.toBe(slotKeyFor(true, 'ARMEDCODEARMEDCO'))
  })

  it('does not depend on anything but the session', () => {
    expect(slotKeyFor(true, 'ARMEDCODEARMEDCO')).toBe(slotKeyFor(true, 'ARMEDCODEARMEDCO'))
  })
})

describe('seedCodeSlot', () => {
  it('draws exactly one code when the dialog opens', () => {
    const generate = counter()
    const opened = seedCodeSlot(CLOSED_SLOT, true, null, generate)
    expect(opened.code).toBe('GEN1')
    expect(opened.seededFor).not.toBeNull()
  })

  it('THE BUG: re-running on every re-render must not redraw the code', () => {
    const generate = counter()
    let slot = seedCodeSlot(CLOSED_SLOT, true, null, generate)
    const first = slot.code

    // One second of console at the sim engine's store cadence.
    for (let tick = 0; tick < 60; tick++) {
      slot = seedCodeSlot(slot, true, null, generate)
    }

    expect(slot.code).toBe(first)
    expect(generate()).toBe('GEN2') // i.e. it was called once, ever
  })

  it('returns the SAME object so React bails out instead of re-rendering', () => {
    const generate = counter()
    const opened = seedCodeSlot(CLOSED_SLOT, true, null, generate)
    expect(seedCodeSlot(opened, true, null, generate)).toBe(opened)
  })

  it('never clobbers what the operator typed', () => {
    const generate = counter()
    let slot = seedCodeSlot(CLOSED_SLOT, true, null, generate)

    // The dispatcher types a code a phone already started, one keystroke at a
    // time, while the store re-renders the console underneath them.
    const typed = 'ACDEFGHJKLMNPQRT'
    for (let i = 1; i <= typed.length; i++) {
      slot = editCodeSlot(slot, typed.slice(0, i))
      slot = seedCodeSlot(slot, true, null, generate)
      slot = seedCodeSlot(slot, true, null, generate)
      expect(slot.code).toBe(typed.slice(0, i))
    }

    expect(slot.code).toBe(typed)
  })

  it('shows the armed session’s own code rather than drawing a useless one', () => {
    const generate = counter()
    const armed = 'ARMEDCODEARMEDCO'
    const slot = seedCodeSlot(CLOSED_SLOT, true, armed, generate)
    expect(slot.code).toBe(armed)
    expect(generate()).toBe('GEN1') // generator was never reached
  })

  it('re-seeds when the session identity itself changes', () => {
    const generate = counter()
    let slot = seedCodeSlot(CLOSED_SLOT, true, null, generate)
    expect(slot.code).toBe('GEN1')
    slot = seedCodeSlot(slot, true, 'ARMEDCODEARMEDCO', generate)
    expect(slot.code).toBe('ARMEDCODEARMEDCO')
  })

  it('empties on close so the next opening is a fresh draw', () => {
    const generate = counter()
    let slot = seedCodeSlot(CLOSED_SLOT, true, null, generate)
    slot = seedCodeSlot(slot, false, null, generate)
    expect(slot).toEqual(CLOSED_SLOT)
    // ...and stays put once closed, rather than churning state every render.
    expect(seedCodeSlot(slot, false, null, generate)).toBe(slot)

    slot = seedCodeSlot(slot, true, null, generate)
    expect(slot.code).toBe('GEN2')
  })
})

describe('regenerateCodeSlot', () => {
  it('is the only path that replaces a code wholesale', () => {
    const generate = counter()
    let slot = seedCodeSlot(CLOSED_SLOT, true, null, generate)
    expect(slot.code).toBe('GEN1')
    slot = regenerateCodeSlot(slot, generate)
    expect(slot.code).toBe('GEN2')
    // and the new code survives the next sixty re-renders
    for (let i = 0; i < 60; i++) slot = seedCodeSlot(slot, true, null, generate)
    expect(slot.code).toBe('GEN2')
  })

  it('keeps the slot bound to the same opening', () => {
    const generate = counter()
    const opened = seedCodeSlot(CLOSED_SLOT, true, null, generate)
    expect(regenerateCodeSlot(opened, generate).seededFor).toBe(opened.seededFor)
  })

  it('does nothing to a closed dialog', () => {
    const generate = counter()
    expect(regenerateCodeSlot(CLOSED_SLOT, generate)).toBe(CLOSED_SLOT)
  })
})

describe('editCodeSlot', () => {
  it('records a keystroke without touching the opening identity', () => {
    const generate = counter()
    const opened = seedCodeSlot(CLOSED_SLOT, true, null, generate)
    const typed = editCodeSlot(opened, 'ACDE')
    expect(typed.code).toBe('ACDE')
    expect(typed.seededFor).toBe(opened.seededFor)
  })

  it('is identity-stable when the value did not actually change', () => {
    const generate = counter()
    const opened: CodeSlot = seedCodeSlot(CLOSED_SLOT, true, null, generate)
    expect(editCodeSlot(opened, opened.code)).toBe(opened)
  })

  it('ignores input aimed at a closed dialog', () => {
    expect(editCodeSlot(CLOSED_SLOT, 'ACDE')).toBe(CLOSED_SLOT)
  })
})
