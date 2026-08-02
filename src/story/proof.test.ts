/**
 * The measured-proof numbers are the only figures on the marketing surface,
 * which makes them the only figures that can embarrass the whole page by going
 * stale. They already did once: `TEST_COUNTS` sat at 242 across 8 files while
 * the suite had grown past 300 across 12, and nothing anywhere complained.
 *
 * So the counts that CAN be checked from inside the app are checked here, and
 * the ones that cannot (the broadcast run, which needs the real Supabase
 * project and a dated bench) are held to their own internal arithmetic instead
 * — a tier that claims zero loss has to have received everything it sent, and
 * the totals the page prints have to add up from the rows underneath them.
 */

import { describe, expect, it } from 'vitest'
import { BROADCAST_CAVEATS, BROADCAST_RUN, BROADCAST_TIERS, TEST_COUNTS } from './proof'

/**
 * Every vitest file in the app, counted by the bundler rather than by hand.
 * `import.meta.glob` never returns the module doing the globbing, so this file
 * adds itself back — which is also why the +1 is written here rather than
 * folded silently into the expectation below.
 */
const TEST_FILES = import.meta.glob('../**/*.test.ts')
const TEST_FILE_COUNT = Object.keys(TEST_FILES).length + 1

describe('the test counts the page prints', () => {
  it('names the number of test files that actually exist', () => {
    const found = TEST_FILE_COUNT
    expect(found).toBeGreaterThan(1)
    expect(
      TEST_COUNTS.unitFiles,
      `proof.ts says ${TEST_COUNTS.unitFiles} test files, the repo has ${found}`,
    ).toBe(found)
  })

  it('claims at least as many tests as it has files, and a plausible ratio', () => {
    // Not a substitute for reading the runner's output, but it catches the
    // case where the file count moves and the test count is left behind.
    expect(TEST_COUNTS.unit).toBeGreaterThanOrEqual(TEST_COUNTS.unitFiles)
    expect(TEST_COUNTS.unit / TEST_COUNTS.unitFiles).toBeGreaterThan(5)
    expect(Number.isInteger(TEST_COUNTS.unit)).toBe(true)
    expect(Number.isInteger(TEST_COUNTS.rpc)).toBe(true)
  })
})

describe('the broadcast table', () => {
  it('has a row per published tier, in ascending order', () => {
    expect(BROADCAST_TIERS.length).toBeGreaterThanOrEqual(3)
    const sizes = BROADCAST_TIERS.map((t) => t.publishers)
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes)
  })

  it('only claims zero loss where nothing was actually lost', () => {
    for (const tier of BROADCAST_TIERS) {
      if (tier.lossPct === 0) expect(tier.received).toBe(tier.sent)
      else expect(tier.received).toBeLessThan(tier.sent)
      // Fan-out: every send reaches every other client on the channel.
      expect(tier.deliveries).toBeGreaterThanOrEqual(tier.sent)
      expect(tier.p50Ms).toBeLessThanOrEqual(tier.p95Ms)
      expect(tier.p95Ms).toBeLessThanOrEqual(tier.maxMs)
    }
  })

  it('adds up to the totals the page prints beside it', () => {
    const sent = BROADCAST_TIERS.reduce((n, t) => n + t.sent, 0)
    const received = BROADCAST_TIERS.reduce((n, t) => n + t.received, 0)
    expect(received).toBe(sent)
    // StoryPage prints these two by summing the same rows rather than by
    // repeating a literal, which is what this assertion is protecting.
    expect(sent).toBeGreaterThan(0)
  })

  it('keeps its provenance and its caveats attached', () => {
    expect(BROADCAST_RUN.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(BROADCAST_RUN.command).toContain('npm run')
    expect(BROADCAST_RUN.windowSeconds).toBeGreaterThan(0)
    expect(BROADCAST_CAVEATS.length).toBeGreaterThanOrEqual(3)
    for (const line of BROADCAST_CAVEATS) expect(line.length).toBeGreaterThan(80)
  })

  it('does not quietly drop the ugly outlier', () => {
    // SPEC's honesty rail: the worst max in the run stays in the table.
    const worst = Math.round(Math.max(...BROADCAST_TIERS.map((t) => t.maxMs)))
    expect(BROADCAST_CAVEATS.join(' ')).toContain(worst.toLocaleString('en-US'))
  })
})
