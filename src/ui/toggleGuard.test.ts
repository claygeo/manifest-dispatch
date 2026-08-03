/**
 * Regression cover for the theme-toggle stall, plus the tab-title format.
 *
 * Reproduced by hand: rapid theme flips each held the main thread 0.6–1.8s
 * (maplibre's `setStyle` rebuild) and the bursts QUEUED, so a handful of clicks
 * bought a UI that stopped answering for the better part of ten seconds. The
 * rebuild is not the bug and is not made faster here; accepting eight clicks
 * for one visible outcome is.
 */

import { describe, expect, it } from 'vitest'
import { acceptClick, THEME_SWAP_COOLDOWN_MS } from './toggleGuard'
import { docTitle, titleToRestore } from './useDocTitle'

describe('acceptClick', () => {
  it('accepts the first click, whatever the clock reads', () => {
    expect(acceptClick(0, 0)).toBe(true)
    expect(acceptClick(0, 1_754_000_000_000)).toBe(true)
  })

  it('THE BUG: a burst of clicks buys exactly one style swap', () => {
    let last = 0
    let swaps = 0
    // Eight clicks in 640ms — a user mashing the toggle.
    for (let i = 0; i < 8; i++) {
      const now = 1_000_000 + i * 80
      if (!acceptClick(last, now)) continue
      last = now
      swaps++
    }
    expect(swaps).toBe(1)
  })

  it('is a leading-edge guard, not a debounce — the first flip is immediate', () => {
    // The click the user actually asked for is never delayed or dropped.
    expect(acceptClick(0, 1_000_000)).toBe(true)
  })

  it('re-opens once the swap has had time to land', () => {
    const t0 = 1_000_000
    expect(acceptClick(t0, t0 + THEME_SWAP_COOLDOWN_MS - 1)).toBe(false)
    expect(acceptClick(t0, t0 + THEME_SWAP_COOLDOWN_MS)).toBe(true)
  })

  it('covers the measured worst-case rebuild', () => {
    // BENCHMARKS/abuse testing put setStyle at 0.6–1.8s; the window has to sit
    // above the top of that range or the queueing bug comes straight back.
    expect(THEME_SWAP_COOLDOWN_MS).toBeGreaterThan(1_800)
  })

  it('does not wedge shut if the clock goes backwards', () => {
    expect(acceptClick(1_000_000, 999_000)).toBe(true)
  })

  it('honours a caller-supplied window', () => {
    expect(acceptClick(100, 150, 100)).toBe(false)
    expect(acceptClick(100, 200, 100)).toBe(true)
  })
})

describe('docTitle', () => {
  it('gives every surface the same shape', () => {
    expect(docTitle('Dispatch')).toBe('Dispatch — Manifest')
    expect(docTitle('Driver')).toBe('Driver — Manifest')
    expect(docTitle('MFST-4301')).toBe('MFST-4301 — Manifest')
    expect(docTitle('MAN-2026-0802-A1')).toBe('MAN-2026-0802-A1 — Manifest')
  })

  it('falls back rather than printing a naked dash', () => {
    expect(docTitle('', 'fallback')).toBe('fallback')
    expect(docTitle('   ', 'fallback')).toBe('fallback')
  })
})

describe('titleToRestore', () => {
  it('puts the previous title back on unmount', () => {
    expect(titleToRestore('Order — Manifest', 'Order — Manifest', 'Dispatch — Manifest')).toBe(
      'Dispatch — Manifest',
    )
  })

  it('falls back to the document default when there was no previous title', () => {
    expect(titleToRestore('Order — Manifest', 'Order — Manifest', '', 'default')).toBe('default')
  })

  it('does NOT stomp a title somebody else has since set', () => {
    // The story page embeds tracking and manifest as figures and holds its own
    // title over them. An unconditional restore would overwrite the holder.
    expect(titleToRestore('Story — Manifest', 'Order — Manifest', 'Dispatch — Manifest')).toBeNull()
  })

  it('stays quiet when there is nothing to change', () => {
    expect(titleToRestore('Same — Manifest', 'Same — Manifest', 'Same — Manifest')).toBeNull()
  })
})
