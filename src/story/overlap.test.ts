/**
 * The floating "back to top" control must never sit on an embedded surface.
 *
 * Round-1, on a 390px phone: it covered the Age and Expires values on the
 * ID-check card — the two fields that entire section of the page exists to
 * show. The fix is that the control yields while an embed is under it, and the
 * decision is made by `controlIsClear`, so this file is where that decision is
 * actually held to account.
 *
 * The centrepiece is the recorded case: real measured rectangles from the 390px
 * layout, asserted to hide the button, plus the same button against the same
 * page scrolled past the embed, asserted to bring it back. A fix that only ever
 * returned `false` would pass the first and fail the second.
 */

import { describe, expect, it } from 'vitest'
import {
  controlIsClear,
  EMBED_CLEARANCE,
  isClearOf,
  isRealBox,
  overlaps,
  padBox,
  type Box,
} from './overlap'

/** The floating control as story.css places it: 42px, 16px from both edges. */
function controlBox(viewportW: number, viewportH: number): Box {
  return {
    left: viewportW - 16 - 42,
    right: viewportW - 16,
    top: viewportH - 16 - 42,
    bottom: viewportH - 16,
  }
}

describe('overlaps', () => {
  const a: Box = { top: 0, right: 100, bottom: 100, left: 0 }

  it('sees a box sitting inside another', () => {
    expect(overlaps(a, { top: 10, right: 90, bottom: 90, left: 10 })).toBe(true)
  })

  it('sees a partial corner bite', () => {
    expect(overlaps(a, { top: 90, right: 200, bottom: 200, left: 90 })).toBe(true)
  })

  it('is symmetric', () => {
    const b: Box = { top: 90, right: 200, bottom: 200, left: 90 }
    expect(overlaps(a, b)).toBe(overlaps(b, a))
  })

  it('separates on every axis independently', () => {
    expect(overlaps(a, { top: 0, right: 300, bottom: 100, left: 200 })).toBe(false) // right
    expect(overlaps(a, { top: 0, right: -10, bottom: 100, left: -200 })).toBe(false) // left
    expect(overlaps(a, { top: 200, right: 100, bottom: 300, left: 0 })).toBe(false) // below
    expect(overlaps(a, { top: -300, right: 100, bottom: -10, left: 0 })).toBe(false) // above
  })

  it('does not call touching edges a collision', () => {
    // Otherwise the control flickers as an embed scrolls up to meet it.
    expect(overlaps(a, { top: 0, right: 200, bottom: 100, left: 100 })).toBe(false)
    expect(overlaps(a, { top: 100, right: 100, bottom: 200, left: 0 })).toBe(false)
  })
})

describe('padBox', () => {
  it('grows on all four sides', () => {
    expect(padBox({ top: 10, right: 20, bottom: 30, left: 5 }, 4)).toEqual({
      top: 6,
      right: 24,
      bottom: 34,
      left: 1,
    })
  })

  it('turns a near miss into a hit, which is the point of the clearance', () => {
    const control: Box = { top: 100, right: 100, bottom: 140, left: 60 }
    const embed: Box = { top: 0, right: 400, bottom: 95, left: 0 } // 5px above
    expect(overlaps(control, embed)).toBe(false)
    expect(overlaps(padBox(control, EMBED_CLEARANCE), embed)).toBe(true)
  })
})

describe('isRealBox', () => {
  it('rejects the zero-area rectangles unmounted elements report', () => {
    expect(isRealBox({ top: 0, right: 0, bottom: 0, left: 0 })).toBe(false)
    expect(isRealBox({ top: 50, right: 0, bottom: 50, left: 0 })).toBe(false)
    expect(isRealBox({ top: 0, right: 10, bottom: 10, left: 0 })).toBe(true)
  })
})

describe('isClearOf', () => {
  const target: Box = { top: 0, right: 10, bottom: 10, left: 0 }

  it('is clear against nothing at all', () => {
    expect(isClearOf(target, [])).toBe(true)
  })

  it('is clear when every box misses', () => {
    expect(
      isClearOf(target, [
        { top: 100, right: 200, bottom: 200, left: 100 },
        { top: -50, right: 10, bottom: -10, left: 0 },
      ]),
    ).toBe(true)
  })

  it('is not clear if a single box hits, wherever it is in the list', () => {
    const hit: Box = { top: 5, right: 50, bottom: 50, left: 5 }
    const miss: Box = { top: 500, right: 600, bottom: 600, left: 500 }
    expect(isClearOf(target, [hit, miss])).toBe(false)
    expect(isClearOf(target, [miss, hit])).toBe(false)
  })
})

describe('the recorded 390px regression', () => {
  /**
   * Measured from the phone embed in the ID-check section at a 390px viewport:
   * the frame body is the page width less the 16px gutters, and it is taller
   * than the viewport, so while the section is on screen it runs edge to edge
   * behind the control's corner.
   */
  const control = controlBox(390, 844)

  it('hides the control while the ID-check embed is under it', () => {
    // The phone stage is 760 stage-pixels tall and the viewport is 844, so
    // mid-section the frame runs off the bottom of the screen and the control
    // sits on it. `bottom` here is past the button's own top edge of 786.
    const embed: Box = { top: -120, right: 374, bottom: 900, left: 16 }
    expect(controlIsClear(control, [embed])).toBe(false)
  })

  it('hides it for a merely partial overlap of the corner too', () => {
    // The original bug was not a full cover: the button clipped the right-hand
    // column of the card, which is where Age and Expires are.
    const embed: Box = { top: 400, right: 374, bottom: 800, left: 16 }
    expect(controlIsClear(control, [embed])).toBe(false)
  })

  it('brings the control back once the embed has scrolled clear', () => {
    const embed: Box = { top: -900, right: 374, bottom: -140, left: 16 }
    expect(controlIsClear(control, [embed])).toBe(true)
  })

  it('keeps the control while the reader is in a prose block between embeds', () => {
    const above: Box = { top: -1200, right: 374, bottom: -400, left: 16 }
    const below: Box = { top: 1100, right: 374, bottom: 1900, left: 16 }
    expect(controlIsClear(control, [above, below])).toBe(true)
  })

  it('ignores embeds that are not laid out yet', () => {
    const unmounted: Box = { top: 0, right: 0, bottom: 0, left: 0 }
    expect(controlIsClear(control, [unmounted])).toBe(true)
  })

  it('shows the control when the page has no embeds on screen at all', () => {
    expect(controlIsClear(control, [])).toBe(true)
  })

  it('does not hide a control that has no box of its own', () => {
    // Belt and braces: if the button itself has not been measured, failing
    // open leaves the reader with a working control rather than none.
    expect(controlIsClear({ top: 0, right: 0, bottom: 0, left: 0 }, [
      { top: 0, right: 400, bottom: 900, left: 0 },
    ])).toBe(true)
  })

  it('still clears on a desktop viewport, where embeds are centred and narrow', () => {
    const wide = controlBox(1440, 900)
    const centred: Box = { top: 100, right: 1020, bottom: 800, left: 420 }
    expect(controlIsClear(wide, [centred])).toBe(true)
  })
})
