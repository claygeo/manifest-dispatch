/**
 * Sequencing engine.
 *
 * The operator's bar for this file, verbatim: "route building needs to be solid,
 * optimizations need to be solid, all of it." So the invariants are proved
 * against real matrix data at every size the product can produce — all 2,036
 * subsets of the eleven stops — rather than spot-checked on a happy path.
 *
 * The one that earned its keep: 2-opt-from-nearest-neighbour, on its own, came
 * out SLOWER than the caller's own order in 11 of 5,000 random selections. The
 * "never worse than its input" test below is what caught it, and the multi-start
 * in optimize.ts is the fix.
 */

import { describe, expect, it } from 'vitest'
import {
  improveSequence,
  nearestNeighborSequence,
  normalizeSelection,
  suggestSequence,
  totalDuration,
} from './optimize'
import { STOP_NODE_IDS } from './matrix'
import { hashSeed, rng } from '../sim/geo'

const STOPS = STOP_NODE_IDS

/** Every subset of the eleven stops with at least two members: 2^11 - 12 = 2036. */
function allSubsets(min = 2): string[][] {
  const out: string[][] = []
  for (let mask = 1; mask < 1 << STOPS.length; mask++) {
    const subset: string[] = []
    for (let i = 0; i < STOPS.length; i++) if (mask & (1 << i)) subset.push(STOPS[i])
    if (subset.length >= min) out.push(subset)
  }
  return out
}

/** Deterministic shuffle — seeded, so a failure is always reproducible. */
function seededOrder(seed: number): string[] {
  const r = rng(hashSeed(`plan-order-${seed}`))
  const pool = STOPS.slice()
  const size = 2 + Math.floor(r() * (STOPS.length - 1))
  const out: string[] = []
  for (let i = 0; i < size; i++) out.push(...pool.splice(Math.floor(r() * pool.length), 1))
  return out
}

function permutations(items: string[]): string[][] {
  if (items.length <= 1) return [items]
  const out: string[][] = []
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1))
    for (const tail of permutations(rest)) out.push([items[i], ...tail])
  }
  return out
}

const SUBSETS = allSubsets()
const RANDOM_ORDERS = Array.from({ length: 200 }, (_, i) => seededOrder(i))

describe('the never-worse guarantees', () => {
  it('2-opt never returns a slower order than the one it was given — all 2036 subsets, both directions', () => {
    for (const subset of SUBSETS) {
      for (const start of [subset, subset.slice().reverse()]) {
        const before = totalDuration(start)
        const after = totalDuration(improveSequence(start))
        expect(after, `2-opt regressed on ${start.join('>')}`).toBeLessThanOrEqual(before)
      }
    }
  }, 60_000)

  it('the suggestion never loses to plain nearest-neighbour — all 2036 subsets', () => {
    for (const subset of SUBSETS) {
      const result = suggestSequence(subset)
      const naive = totalDuration(nearestNeighborSequence(subset))
      expect(result.naiveS).toBe(naive)
      expect(result.suggestedS, `suggestion lost to NN on ${subset.join('>')}`).toBeLessThanOrEqual(
        naive,
      )
    }
  }, 60_000)

  it('the suggestion never loses to the dispatcher order it was handed — 200 seeded orders', () => {
    for (const order of RANDOM_ORDERS) {
      const result = suggestSequence(order)
      expect(
        result.suggestedS,
        `suggestion lost to the caller's order ${order.join('>')}`,
      ).toBeLessThanOrEqual(totalDuration(order))
      expect(result.suggestedS).toBeLessThanOrEqual(totalDuration(nearestNeighborSequence(order)))
      expect(totalDuration(improveSequence(order))).toBeLessThanOrEqual(totalDuration(order))
    }
  }, 60_000)

  it('keeps every stop it was given, exactly once', () => {
    for (const order of RANDOM_ORDERS) {
      const result = suggestSequence(order)
      expect(result.sequence.slice().sort()).toEqual(order.slice().sort())
      expect(new Set(result.sequence).size).toBe(result.sequence.length)
    }
    for (const subset of SUBSETS) {
      expect(improveSequence(subset).slice().sort()).toEqual(subset.slice().sort())
    }
  }, 60_000)
})

describe('determinism', () => {
  it('returns an identical sequence for an identical input, every time', () => {
    for (const order of RANDOM_ORDERS.slice(0, 60)) {
      const first = suggestSequence(order)
      const second = suggestSequence(order)
      const third = suggestSequence(order.slice())
      expect(second.sequence).toEqual(first.sequence)
      expect(third.sequence).toEqual(first.sequence)
      expect(second.suggestedS).toBe(first.suggestedS)
      expect(second.naiveS).toBe(first.naiveS)
    }
  })

  it('builds nearest-neighbour from the SET, not the click order', () => {
    const set = ['run-c-1', 'run-a-2', 'run-b-4', 'run-a-1']
    const shuffled = ['run-b-4', 'run-a-1', 'run-c-1', 'run-a-2']
    expect(nearestNeighborSequence(shuffled)).toEqual(nearestNeighborSequence(set))
  })

  it('breaks nearest-neighbour ties on the node id, never on iteration order', () => {
    // Same set, three different orderings — the greedy construction must not move.
    const base = nearestNeighborSequence(STOPS)
    expect(nearestNeighborSequence(STOPS.slice().reverse())).toEqual(base)
    expect(nearestNeighborSequence(STOPS.slice().sort())).toEqual(base)
  })
})

describe('quality against brute force', () => {
  it('lands within 4% of the true optimum on every subset up to six stops', () => {
    let worst = 0
    let sum = 0
    let count = 0
    for (const subset of SUBSETS) {
      if (subset.length > 6) continue
      let optimal = Infinity
      for (const permutation of permutations(subset)) {
        optimal = Math.min(optimal, totalDuration(permutation))
      }
      const gap = (suggestSequence(subset).suggestedS - optimal) / optimal
      expect(gap).toBeGreaterThanOrEqual(0)
      worst = Math.max(worst, gap)
      sum += gap
      count += 1
    }
    expect(count).toBe(1474)
    // measured on the shipped matrix: worst 2.92%, mean 0.07%
    expect(worst).toBeLessThan(0.04)
    expect(sum / count).toBeLessThan(0.005)
  }, 60_000)
})

describe('degenerate input', () => {
  it('plans nothing for no stops', () => {
    const result = suggestSequence([])
    expect(result.sequence).toEqual([])
    expect(result.naiveS).toBe(0)
    expect(result.suggestedS).toBe(0)
    expect(totalDuration([])).toBe(0)
    expect(improveSequence([])).toEqual([])
  })

  it('plans a single stop as depot out and depot back', () => {
    const result = suggestSequence(['run-b-2'])
    expect(result.sequence).toEqual(['run-b-2'])
    expect(result.suggestedS).toBe(totalDuration(['run-b-2']))
    expect(result.suggestedS).toBe(result.naiveS)
    expect(improveSequence(['run-b-2'])).toEqual(['run-b-2'])
  })

  it('orders two stops the cheaper way round — the matrix is asymmetric', () => {
    for (const pair of SUBSETS.filter((s) => s.length === 2)) {
      const forward = totalDuration(pair)
      const reverse = totalDuration([pair[1], pair[0]])
      expect(suggestSequence(pair).suggestedS).toBe(Math.min(forward, reverse))
    }
  })

  it('handles all eleven stops without hanging', () => {
    const result = suggestSequence(STOPS)
    expect(result.sequence).toHaveLength(11)
    expect(result.suggestedS).toBeLessThanOrEqual(result.naiveS)
    expect(result.suggestedS).toBeGreaterThan(0)
  }, 10_000)

  it('DEDUPES a stop selected twice rather than routing to it twice', () => {
    const dupes = ['run-a-1', 'run-b-2', 'run-a-1', 'run-b-2', 'run-a-1']
    expect(normalizeSelection(dupes)).toEqual(['run-a-1', 'run-b-2'])
    const result = suggestSequence(dupes)
    expect(result.sequence).toHaveLength(2)
    expect(new Set(result.sequence).size).toBe(2)
    expect(result.suggestedS).toBe(suggestSequence(['run-a-1', 'run-b-2']).suggestedS)
  })

  it('refuses stops the matrix cannot route to, and refuses the depot as a delivery', () => {
    expect(() => suggestSequence(['run-a-1', 'ghost'])).toThrow(/not a matrix node/)
    expect(() => suggestSequence(['depot', 'run-a-1'])).toThrow(/depot is not a delivery/)
    expect(() => normalizeSelection([''])).toThrow(/not a matrix node/)
  })
})
