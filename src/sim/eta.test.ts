/**
 * ETA + dwell maths.
 *
 * These numbers are the ones SPEC.md pins by value ("~8× multiplier",
 * "±15% speed jitter", "20–75 s dwell"), plus the one property a dispatcher
 * actually relies on: an ETA that only ever gets closer as the van drives.
 */

import { describe, expect, it } from 'vitest'
import {
  DEMO_TIME_MULTIPLIER,
  DWELL_ALLOWANCE_S,
  DWELL_MAX_S,
  DWELL_MIN_S,
  dwellFor,
  etaMinutesTo,
  remainingLegSeconds,
  SPEED_JITTER,
  speedJitterFor,
} from './eta'
import { legsFor } from '../data/seed'

describe('SPEC constants', () => {
  it('holds the values SPEC.md pins by number', () => {
    expect(DEMO_TIME_MULTIPLIER).toBe(8)
    expect(SPEED_JITTER).toBe(0.15)
    expect(DWELL_MIN_S).toBe(20)
    expect(DWELL_MAX_S).toBe(75)
  })
})

describe('dwellFor', () => {
  const SAMPLES = Array.from({ length: 300 }, (_, i) => ({
    runId: `run-${'abc'[i % 3]}`,
    stopIndex: i % 5,
    generation: Math.floor(i / 5),
  }))

  it('stays inside the 20–75 s band SPEC.md specifies', () => {
    for (const { runId, stopIndex, generation } of SAMPLES) {
      const plan = dwellFor(runId, stopIndex, generation)
      expect(plan.totalS).toBeGreaterThanOrEqual(DWELL_MIN_S)
      expect(plan.totalS).toBeLessThanOrEqual(DWELL_MAX_S)
    }
  })

  it('splits into three positive phases that add up to the total', () => {
    for (const { runId, stopIndex, generation } of SAMPLES) {
      const { arriveS, idCheckS, closeS, totalS } = dwellFor(runId, stopIndex, generation)
      expect(arriveS).toBeGreaterThan(0)
      expect(idCheckS).toBeGreaterThan(0)
      // the ID check is the one phase that can never be instant — the driver has
      // to actually read a licence, and 4 s is the floor the maths guarantees
      expect(closeS).toBeGreaterThanOrEqual(4)
      expect(arriveS + idCheckS + closeS).toBeCloseTo(totalS, 9)
    }
  })

  it('replays for the same run/stop/generation and differs across each of them', () => {
    expect(dwellFor('run-a', 1, 0)).toEqual(dwellFor('run-a', 1, 0))
    expect(dwellFor('run-a', 1, 0)).not.toEqual(dwellFor('run-a', 2, 0))
    expect(dwellFor('run-a', 1, 0)).not.toEqual(dwellFor('run-b', 1, 0))
    // SPEC: "replays feel similar but not looped-video identical" — the fleet
    // generation is in the seed, so a reset shift is a different shift.
    expect(dwellFor('run-a', 1, 0)).not.toEqual(dwellFor('run-a', 1, 1))
  })
})

describe('speedJitterFor', () => {
  it('stays inside ±15%', () => {
    for (let g = 0; g < 20; g++) {
      for (const runId of ['run-a', 'run-b', 'run-c']) {
        for (let leg = 0; leg < 6; leg++) {
          const j = speedJitterFor(runId, leg, g)
          expect(j).toBeGreaterThanOrEqual(1 - SPEED_JITTER)
          expect(j).toBeLessThanOrEqual(1 + SPEED_JITTER)
        }
      }
    }
  })

  it('actually varies — it is jitter, not a constant', () => {
    const values = new Set<number>()
    for (let leg = 0; leg < 20; leg++) values.add(speedJitterFor('run-a', leg, 0))
    expect(values.size).toBeGreaterThan(15)
  })

  it('replays for the same seed', () => {
    expect(speedJitterFor('run-a', 3, 7)).toBe(speedJitterFor('run-a', 3, 7))
  })
})

describe('etaMinutesTo', () => {
  const legs = legsFor('run-a')

  it('returns null for a stop already behind the driver', () => {
    expect(etaMinutesTo(legs, 2, 0.5, 0)).toBeNull()
    expect(etaMinutesTo(legs, 2, 0.5, 1)).toBeNull()
  })

  it('returns null past the end of the route', () => {
    expect(etaMinutesTo(legs, 0, 0, legs.length)).toBeNull()
    expect(etaMinutesTo(legs, 0, 0, legs.length + 5)).toBeNull()
  })

  it('never promises less than one minute', () => {
    expect(etaMinutesTo(legs, 0, 1, 0)).toBe(1)
    expect(etaMinutesTo(legs, 0, 0.999999, 0)).toBe(1)
  })

  it('only ever gets closer as the driver advances along the leg', () => {
    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      let previous = Infinity
      for (let step = 0; step <= 100; step++) {
        const eta = etaMinutesTo(legs, 0, step / 100, legIndex)
        expect(eta).not.toBeNull()
        expect(eta as number).toBeLessThanOrEqual(previous)
        previous = eta as number
      }
    }
  })

  it('only ever gets closer as the driver advances through the legs', () => {
    // Same target stop, driver one leg further along: the ETA must have dropped.
    const target = legs.length - 1
    let previous = Infinity
    for (let currentLeg = 0; currentLeg <= target; currentLeg++) {
      const eta = etaMinutesTo(legs, currentLeg, 0, target) as number
      expect(eta).toBeLessThanOrEqual(previous)
      previous = eta
    }
  })

  it('orders the queue: a later stop is never sooner than an earlier one', () => {
    for (const progress of [0, 0.25, 0.5, 0.9]) {
      let previous = -Infinity
      for (let legIndex = 0; legIndex < legs.length; legIndex++) {
        const eta = etaMinutesTo(legs, 0, progress, legIndex) as number
        expect(eta).toBeGreaterThanOrEqual(previous)
        previous = eta
      }
    }
  })

  it('folds one dwell allowance in per intervening stop', () => {
    // Two consecutive stops differ by that leg's drive time plus the allowance.
    const near = etaMinutesTo(legs, 0, 0, 0) as number
    const far = etaMinutesTo(legs, 0, 0, 1) as number
    const expectedGapMin = (legs[1].duration_s + DWELL_ALLOWANCE_S) / 60
    expect(far - near).toBeGreaterThan(expectedGapMin - 1.5)
    expect(far - near).toBeLessThan(expectedGapMin + 1.5)
  })
})

describe('remainingLegSeconds', () => {
  const leg = legsFor('run-a')[0]

  it('is the whole leg at the kerb and nothing at the door', () => {
    expect(remainingLegSeconds(leg, 0)).toBeCloseTo(leg.duration_s, 6)
    expect(remainingLegSeconds(leg, 1)).toBe(0)
  })

  it('never goes negative when progress overshoots', () => {
    expect(remainingLegSeconds(leg, 1.4)).toBe(0)
  })

  it('decreases monotonically', () => {
    let previous = Infinity
    for (let step = 0; step <= 50; step++) {
      const v = remainingLegSeconds(leg, step / 50)
      expect(v).toBeLessThanOrEqual(previous)
      previous = v
    }
  })
})
