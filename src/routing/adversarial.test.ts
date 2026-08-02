/**
 * Adversarial pass over the routing engine.
 *
 * The suite next door proves the engine right on the shipped matrix. This one
 * assumes the shipped matrix is the easy case and goes after the engine with
 * the inputs a real deployment produces on a bad day: a matrix regenerated with
 * a hole in it, travel times that bear no resemblance to Tampa geography, a
 * pool where every promised window shut hours ago, and a run that was already
 * late before anyone tried to add to it.
 *
 * Three of these started life as failures.
 *
 *   1. A leg whose duration came back `null` — which is exactly what OSRM's
 *      table service emits for a pair it cannot route — was summed as ZERO,
 *      not as NaN. `durationOf(['run-a-1'])` returned 279 s for a round trip
 *      whose outbound leg had no measurement at all, and `suggestSequence`
 *      reported a confident 1598 s. Free roads win every comparison, so the
 *      undrivable order would have been the one on screen.
 *   2. `canFitToday` on a run that had ALREADY blown a window blamed the new
 *      order for it: "squeezing it in pushes Luis H. past 11:00 AM. Existing
 *      promises hold." Nobody was pushed. The breach predated the order by two
 *      hours.
 *   3. The suggestion moved when the same stops were ticked in a different
 *      order — 22 of 273 sampled selections, by up to 64 s.
 *
 * The matrix-mutating tests below reach into the imported JSON module object,
 * which is the same object `matrix.ts` reads. That is deliberate: it is the
 * only way to ask "what does this engine do when its data is wrong" without
 * shipping a second, more forgiving copy of the loader. Every one of them
 * restores the file in a `finally`, and vitest isolates by file, so nothing
 * leaks past this module.
 */

import { describe, expect, it } from 'vitest'
import matrixRaw from '../data/matrix.json'
import {
  assertMatrixIntegrity,
  DEPOT_NODE,
  durationOf,
  legBetween,
  STOP_NODE_IDS,
} from './matrix'
import { improveSequence, suggestForSet, suggestSequence, totalDuration } from './optimize'
import {
  canFitToday,
  projectSequence,
  SERVICE_TIME_S,
  type PlanRunInput,
  type WindowPair,
} from './feasibility'
import { formatClock } from '../format'
import { hashSeed, rng } from '../sim/geo'

/* ------------------------------------------------------- matrix scaffolding -- */

interface RawLeg {
  distance_m: number
  duration_s: number
  coords: [number, number][]
}

const RAW = matrixRaw as unknown as { legs: Record<string, RawLeg> }
const LEG_KEYS = Object.keys(RAW.legs)

/**
 * Run `body` against a deliberately damaged matrix, then put every byte back.
 * Key set and numeric values are restored separately because the snapshot is
 * shallow — the leg objects themselves are shared with the live file.
 */
function withDamagedMatrix(damage: () => void, body: () => void): void {
  const keySnapshot = { ...RAW.legs }
  const durations = LEG_KEYS.map((k) => RAW.legs[k].duration_s)
  const distances = LEG_KEYS.map((k) => RAW.legs[k].distance_m)
  try {
    damage()
    body()
  } finally {
    RAW.legs = keySnapshot
    LEG_KEYS.forEach((k, i) => {
      RAW.legs[k].duration_s = durations[i]
      RAW.legs[k].distance_m = distances[i]
    })
    // the restore itself has to be provable, or every later test is suspect
    assertMatrixIntegrity()
  }
}

const ELEVEN = STOP_NODE_IDS.slice()

function seededPermutation(items: string[], seed: string): string[] {
  const r = rng(hashSeed(seed))
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* ----------------------------------------------------------- damaged matrix -- */

describe('a matrix that is wrong rather than missing', () => {
  it('never prices an unmeasured road as free — a null duration is caught, not summed as zero', () => {
    withDamagedMatrix(
      () => {
        // OSRM's table service emits null for a pair it cannot route.
        ;(RAW.legs['depot|run-a-1'] as unknown as { duration_s: unknown }).duration_s = null
      },
      () => {
        expect(() => assertMatrixIntegrity()).toThrow(/duration_s null/)
        expect(() => durationOf(['run-a-1'])).toThrow(/unusable duration/)
        expect(() => legBetween(DEPOT_NODE, 'run-a-1')).toThrow(/unusable duration/)
        // and the whole planner refuses rather than proposing the free road
        expect(() => suggestSequence(['run-a-1', 'run-b-2', 'run-c-1'])).toThrow(
          /unusable duration/,
        )
      },
    )

    // undamaged, the same call is fine — the guard is not a blanket refusal
    expect(durationOf(['run-a-1'])).toBeGreaterThan(0)
  })

  it('refuses every other shape of unusable leg the same way', () => {
    const shapes: Array<[string, unknown, RegExp]> = [
      ['duration_s', undefined, /duration_s undefined/],
      ['duration_s', 0, /duration_s 0/],
      ['duration_s', -30, /duration_s -30/],
      ['duration_s', NaN, /duration_s NaN/],
      ['distance_m', null, /distance_m null/],
    ]
    for (const [field, value, expected] of shapes) {
      withDamagedMatrix(
        () => {
          ;(RAW.legs['run-a-1|run-a-2'] as unknown as Record<string, unknown>)[field] = value
        },
        () => {
          expect(() => assertMatrixIntegrity(), `${field}=${String(value)}`).toThrow(expected)
        },
      )
    }
  })

  it('refuses a matrix with a hole in it instead of routing around the hole', () => {
    withDamagedMatrix(
      () => {
        delete RAW.legs['run-b-2|run-c-1']
      },
      () => {
        expect(() => assertMatrixIntegrity()).toThrow(/no leg 'run-b-2' -> 'run-c-1'/)
        expect(() => durationOf(['run-b-2', 'run-c-1'])).toThrow(/no leg/)
        // the optimiser cannot quietly prefer the sequence that uses the hole
        expect(() => suggestSequence(['run-b-2', 'run-c-1', 'run-a-1'])).toThrow(/no leg/)
      },
    )
  })
})

/* ------------------------------------------------------------- 2-opt limits -- */

describe('2-opt against travel times it was never tuned on', () => {
  it('terminates and never regresses on twenty hostile randomised matrices', () => {
    for (let trial = 0; trial < 20; trial++) {
      const r = rng(hashSeed(`hostile-matrix-${trial}`))
      withDamagedMatrix(
        () => {
          for (const key of LEG_KEYS) RAW.legs[key].duration_s = 1 + Math.floor(r() * 9_999)
        },
        () => {
          const start = seededPermutation(ELEVEN, `hostile-order-${trial}`)
          const before = totalDuration(start)
          const improved = improveSequence(start)

          // it came back at all (MAX_PASSES throws rather than hanging)
          expect(improved).toHaveLength(start.length)
          expect(improved.slice().sort()).toEqual(start.slice().sort())
          expect(totalDuration(improved)).toBeLessThanOrEqual(before)

          // and 2-opt actually reached a local optimum: no single reversal helps
          for (let i = 0; i < improved.length - 1; i++) {
            for (let j = i + 1; j < improved.length; j++) {
              const next = improved
                .slice(0, i)
                .concat(improved.slice(i, j + 1).reverse(), improved.slice(j + 1))
              expect(totalDuration(next)).toBeGreaterThanOrEqual(totalDuration(improved))
            }
          }
        },
      )
    }
  }, 60_000)

  it('does not thrash when every move is a tie — the worst case for a loop', () => {
    withDamagedMatrix(
      () => {
        for (const key of LEG_KEYS) RAW.legs[key].duration_s = 60
      },
      () => {
        const orders = [
          ELEVEN,
          ELEVEN.slice().reverse(),
          seededPermutation(ELEVEN, 'tie-a'),
          seededPermutation(ELEVEN, 'tie-b'),
        ]
        for (const order of orders) {
          // no reversal can ever be a STRICT improvement, so the input stands
          expect(improveSequence(order)).toEqual(order)
          expect(totalDuration(order)).toBe(60 * (ELEVEN.length + 1))
        }
        // and the proposal is the same one whichever way the stops arrived
        const first = suggestForSet(orders[0])
        for (const order of orders) {
          expect(suggestForSet(order).sequence).toEqual(first.sequence)
        }
      },
    )
  })
})

/* -------------------------------------------------- the proposal is a proposal -- */

describe('the number the screen calls "Suggested"', () => {
  it('depends on WHICH stops were picked, never on the order they were picked in', () => {
    let checked = 0
    for (let mask = 1; mask < 1 << ELEVEN.length; mask++) {
      const subset: string[] = []
      for (let i = 0; i < ELEVEN.length; i++) if (mask & (1 << i)) subset.push(ELEVEN[i])
      if (subset.length < 3 || subset.length > 6) continue
      if (mask % 7 !== 0) continue

      const canonical = suggestForSet(subset)
      for (const seed of ['a', 'b', 'c']) {
        const shuffled = seededPermutation(subset, `pick-${mask}-${seed}`)
        const other = suggestForSet(shuffled)
        expect(other.suggestedS, `pick order moved the proposal for ${subset.join(',')}`).toBe(
          canonical.suggestedS,
        )
        expect(other.sequence).toEqual(canonical.sequence)
        expect(other.naiveS).toBe(canonical.naiveS)
      }
      // duplicates are a UI slip, not a different selection
      expect(suggestForSet([...subset, subset[0], subset[1]]).sequence).toEqual(canonical.sequence)
      checked += 1
    }
    expect(checked).toBeGreaterThan(50)
  }, 60_000)

  it('is not the raw optimiser under another name — canonicalising is load-bearing', () => {
    /*
     * `suggestSequence` takes its argument as a search start as well as a set,
     * so it is order-sensitive BY DESIGN — that is what buys "never worse than
     * the order you handed in". This finds a selection where that shows, and
     * pins that `suggestForSet` is what removes it. If someone ever collapses
     * the two, this fails instead of the number on screen quietly wobbling.
     */
    let found: { subset: string[]; shuffled: string[] } | null = null
    for (let mask = 1; mask < 1 << ELEVEN.length && !found; mask++) {
      const subset: string[] = []
      for (let i = 0; i < ELEVEN.length; i++) if (mask & (1 << i)) subset.push(ELEVEN[i])
      if (subset.length < 3) continue
      for (const seed of ['x', 'y', 'z']) {
        const shuffled = seededPermutation(subset, `raw-${mask}-${seed}`)
        if (suggestSequence(shuffled).suggestedS !== suggestSequence(subset).suggestedS) {
          found = { subset, shuffled }
          break
        }
      }
    }

    expect(found, 'the raw optimiser is order-stable on this matrix — re-derive the fix').not.toBeNull()
    expect(suggestForSet(found!.shuffled).suggestedS).toBe(suggestForSet(found!.subset).suggestedS)
    expect(suggestForSet(found!.shuffled).sequence).toEqual(suggestForSet(found!.subset).sequence)
  }, 30_000)

  it('still never loses to plain nearest-neighbour once canonicalised', () => {
    for (let mask = 1; mask < 1 << ELEVEN.length; mask++) {
      const subset: string[] = []
      for (let i = 0; i < ELEVEN.length; i++) if (mask & (1 << i)) subset.push(ELEVEN[i])
      if (subset.length < 2 || mask % 5 !== 0) continue
      const result = suggestForSet(subset)
      expect(result.suggestedS).toBeLessThanOrEqual(result.naiveS)
      expect(result.sequence.slice().sort()).toEqual(subset.slice().sort())
    }
  }, 60_000)
})

/* ------------------------------------------------------------- feasibility -- */

const NOW = Date.parse('2026-08-02T17:00:00.000Z')
const at = (min: number) => formatClock(NOW + min * 60_000)
const win = (from: number, to: number): WindowPair => [at(from), at(to)]

function runWith(overrides: Partial<PlanRunInput>): PlanRunInput {
  const windows: Record<string, WindowPair> = {}
  for (const id of STOP_NODE_IDS) windows[id] = win(-60, 300)
  return {
    runId: 'adversary',
    fromNodeId: DEPOT_NODE,
    sequence: ['run-a-1', 'run-a-2'],
    shiftEndMs: NOW + 8 * 3_600_000,
    ...overrides,
    windows: { ...windows, ...(overrides.windows ?? {}) },
  }
}

describe('feasibility told the truth about who broke what', () => {
  it('does not blame a new order for a window that was already blown', () => {
    const run = runWith({
      sequence: ['run-a-1', 'run-a-2'],
      windows: { 'run-a-2': win(-240, -120) }, // shut two hours ago
      labels: { 'run-a-2': 'Luis H.', 'run-c-1': 'Priya N.' },
    })

    expect(projectSequence(run, run.sequence, NOW).feasible).toBe(false)

    const verdict = canFitToday('run-c-1', run, NOW)
    expect(verdict.fits).toBe(false)
    expect(verdict.insertAt).toBe(-1)

    // the fabricated cause, in the words it used to use
    expect(verdict.reason).not.toContain('squeezing it in')
    expect(verdict.reason).not.toContain('Priya N.')
    // the real one
    expect(verdict.reason).toContain('already misses')
    expect(verdict.reason).toContain('Luis H.')
    expect(verdict.reason).toContain('before any order is added')
  })

  it('says the same thing when the run is already past the depot cutoff', () => {
    const run = runWith({ sequence: ['run-a-3', 'run-b-1'], shiftEndMs: NOW + 60_000 })
    const verdict = canFitToday('run-c-1', run, NOW)
    expect(verdict.fits).toBe(false)
    expect(verdict.reason).toContain('already projected back')
    expect(verdict.reason).toContain('before any order is added')
  })

  it('handles a pool where every promised window shut hours ago without crashing', () => {
    const windows: Record<string, WindowPair> = {}
    for (const id of STOP_NODE_IDS) windows[id] = win(-600, -400)
    const run = runWith({ sequence: ['run-a-1'], windows })

    for (const id of STOP_NODE_IDS) {
      const verdict = canFitToday(id, run, NOW)
      expect(verdict.fits, `${id} must not fit into a run of shut windows`).toBe(false)
      expect(verdict.insertAt).toBe(-1)
      expect(verdict.addedS).toBe(0)
      expect(verdict.reason.length).toBeGreaterThan(0)
    }

    // an EMPTY run of shut windows still refuses the newcomer honestly, and
    // names the newcomer, because this time nothing predates it
    const empty = runWith({ sequence: [], windows })
    const verdict = canFitToday('run-c-1', empty, NOW)
    expect(verdict.fits).toBe(false)
    expect(verdict.reason).toContain('First window tomorrow')
  })
})

describe('window and shift boundaries, to the millisecond', () => {
  /*
   * `inTransitS` is used verbatim for the first hop, which is what makes an
   * exact-boundary arrival constructible: clock strings only carry minutes, so
   * the arrival has to be driven onto a minute rather than read off the matrix.
   */
  const oneHour = 3_600_000

  it('counts an arrival exactly ON the window close as made, and one millisecond later as missed', () => {
    const onTime = runWith({
      sequence: ['run-a-1'],
      inTransitS: 3600,
      windows: { 'run-a-1': [formatClock(NOW), formatClock(NOW + oneHour)] },
    })
    const onTimeProjection = projectSequence(onTime, onTime.sequence, NOW)
    expect(onTimeProjection.stops[0].arriveMs).toBe(NOW + oneHour)
    expect(onTimeProjection.stops[0].missed).toBe(false)

    const late = { ...onTime, inTransitS: 3600.001 }
    const lateProjection = projectSequence(late, late.sequence, NOW)
    expect(lateProjection.stops[0].arriveMs).toBe(NOW + oneHour + 1)
    expect(lateProjection.stops[0].missed).toBe(true)
    expect(lateProjection.failure).toEqual({ kind: 'window', nodeId: 'run-a-1' })
  })

  it('counts an arrival exactly ON the window open as no wait at all', () => {
    const run = runWith({
      sequence: ['run-a-1'],
      inTransitS: 3600,
      windows: { 'run-a-1': [formatClock(NOW + oneHour), formatClock(NOW + 2 * oneHour)] },
    })
    const projection = projectSequence(run, run.sequence, NOW)
    expect(projection.stops[0].waitS).toBe(0)
    expect(projection.stops[0].departMs).toBe(NOW + oneHour + SERVICE_TIME_S * 1000)

    // one millisecond early is a wait, not a miss
    const early = { ...run, inTransitS: 3599.999 }
    const earlyProjection = projectSequence(early, early.sequence, NOW)
    expect(earlyProjection.stops[0].missed).toBe(false)
    expect(earlyProjection.stops[0].waitS).toBeCloseTo(0.001, 9)
    expect(earlyProjection.stops[0].departMs).toBe(NOW + oneHour + SERVICE_TIME_S * 1000)
  })

  it('lets a van back at the depot exactly as the shift ends, and not a millisecond after', () => {
    const probe = runWith({ sequence: ['run-a-1'], shiftEndMs: NOW + 8 * 3_600_000 })
    const endsAtMs = projectSequence(probe, probe.sequence, NOW).endsAtMs

    expect(projectSequence({ ...probe, shiftEndMs: endsAtMs }, probe.sequence, NOW).feasible).toBe(
      true,
    )
    const short = projectSequence({ ...probe, shiftEndMs: endsAtMs - 1 }, probe.sequence, NOW)
    expect(short.feasible).toBe(false)
    expect(short.failure).toEqual({ kind: 'shift', nodeId: null })
  })
})
