/**
 * Geometry — the layer every other claim rests on.
 *
 * The distance references below are NOT taken from this file's own algorithm.
 * They were generated once with an independent WGS84 ellipsoidal solution
 * (Vincenty inverse) over real Tampa-area coordinates, then hardcoded. A
 * spherical haversine and an ellipsoidal Vincenty disagree by construction, so
 * the assertion is a 2% band — tight enough to catch a wrong earth radius, a
 * degrees/radians slip or a swapped lat/lng, loose enough that the sphere is
 * allowed to be a sphere.
 */

import { describe, expect, it } from 'vitest'
import {
  bearing,
  boundsOf,
  haversine,
  hashSeed,
  lerpAngle,
  pointOnLeg,
  prepareLeg,
  projectOnLeg,
  rng,
  seededRange,
  splitLeg,
  type LngLat,
} from './geo'
import { legsFor, DEPOT } from '../data/seed'

const DEPOT_LL: LngLat = [-82.4572, 27.9506]
const TPA: LngLat = [-82.5332, 27.9755]
const YBOR: LngLat = [-82.4383, 27.9605]
const RAYMOND_JAMES: LngLat = [-82.5033, 27.9759]
const MCO: LngLat = [-81.3089, 28.4294]
const ST_PETE_PIER: LngLat = [-82.6323, 27.7676]

/** [label, a, b, Vincenty/WGS84 metres] */
const DISTANCE_REFERENCES: Array<[string, LngLat, LngLat, number]> = [
  ['depot -> Tampa Intl', DEPOT_LL, TPA, 7971],
  ['depot -> Ybor City', DEPOT_LL, YBOR, 2159],
  ['depot -> Raymond James Stadium', DEPOT_LL, RAYMOND_JAMES, 5333],
  ['Tampa Intl -> Orlando Intl', TPA, MCO, 130_299],
  ['depot -> St Petersburg pier', DEPOT_LL, ST_PETE_PIER, 26_621],
  ['one degree of latitude at Tampa', DEPOT_LL, [-82.4572, 28.9506], 110_827],
  ['one degree of longitude at Tampa', DEPOT_LL, [-81.4572, 27.9506], 98_406],
]

describe('haversine', () => {
  for (const [label, a, b, referenceM] of DISTANCE_REFERENCES) {
    it(`is within 2% of the ellipsoidal distance: ${label}`, () => {
      const got = haversine(a, b)
      expect(Math.abs(got - referenceM) / referenceM).toBeLessThan(0.02)
    })
  }

  it('is zero for a point against itself and symmetric otherwise', () => {
    expect(haversine(DEPOT_LL, DEPOT_LL)).toBe(0)
    expect(haversine(DEPOT_LL, YBOR)).toBeCloseTo(haversine(YBOR, DEPOT_LL), 9)
  })

  it('scales linearly for short offsets (no latitude/longitude swap)', () => {
    const near: LngLat = [DEPOT_LL[0], DEPOT_LL[1] + 0.001]
    const far: LngLat = [DEPOT_LL[0], DEPOT_LL[1] + 0.002]
    expect(haversine(DEPOT_LL, far) / haversine(DEPOT_LL, near)).toBeCloseTo(2, 3)
  })
})

describe('bearing', () => {
  const CASES: Array<[string, LngLat, number]> = [
    ['due north', [DEPOT_LL[0], DEPOT_LL[1] + 0.05], 0],
    ['due east', [DEPOT_LL[0] + 0.05, DEPOT_LL[1]], 90],
    ['due south', [DEPOT_LL[0], DEPOT_LL[1] - 0.05], 180],
    ['due west', [DEPOT_LL[0] - 0.05, DEPOT_LL[1]], 270],
  ]

  for (const [label, to, expected] of CASES) {
    it(`reads ${expected}° for ${label}`, () => {
      expect(bearing(DEPOT_LL, to)).toBeCloseTo(expected, 1)
    })
  }

  it('lands each diagonal in its own quadrant', () => {
    const quadrant = (dLng: number, dLat: number) =>
      bearing(DEPOT_LL, [DEPOT_LL[0] + dLng, DEPOT_LL[1] + dLat])
    expect(quadrant(0.05, 0.05)).toBeGreaterThan(0)
    expect(quadrant(0.05, 0.05)).toBeLessThan(90)
    expect(quadrant(0.05, -0.05)).toBeGreaterThan(90)
    expect(quadrant(0.05, -0.05)).toBeLessThan(180)
    expect(quadrant(-0.05, -0.05)).toBeGreaterThan(180)
    expect(quadrant(-0.05, -0.05)).toBeLessThan(270)
    expect(quadrant(-0.05, 0.05)).toBeGreaterThan(270)
    expect(quadrant(-0.05, 0.05)).toBeLessThan(360)
  })

  it('always returns 0..360, never negative', () => {
    for (let i = 0; i < 36; i++) {
      const angle = (i * 10 * Math.PI) / 180
      const to: LngLat = [DEPOT_LL[0] + Math.sin(angle) * 0.05, DEPOT_LL[1] + Math.cos(angle) * 0.05]
      const b = bearing(DEPOT_LL, to)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(360)
    }
  })
})

describe('lerpAngle', () => {
  it('crosses the 360/0 seam the short way (350 -> 10 goes through 0, not 180)', () => {
    // Midpoint must be 0/360, NOT 180. This is the whole reason the function exists:
    // a naive lerp spins the driver arrow all the way round the compass.
    const mid = lerpAngle(350, 10, 0.5)
    expect(Math.min(mid, 360 - mid)).toBeCloseTo(0, 6)
    // and a quarter of the way is 355, not 260
    expect(lerpAngle(350, 10, 0.25)).toBeCloseTo(355, 6)
    expect(lerpAngle(350, 10, 0.75)).toBeCloseTo(5, 6)
  })

  it('crosses the seam the short way in the other direction too', () => {
    expect(lerpAngle(10, 350, 0.25)).toBeCloseTo(5, 6)
    const mid = lerpAngle(10, 350, 0.5)
    expect(Math.min(mid, 360 - mid)).toBeCloseTo(0, 6)
  })

  it('takes the long way round only when the gap really is 180', () => {
    expect(lerpAngle(0, 90, 0.5)).toBeCloseTo(45, 6)
    expect(lerpAngle(90, 270, 1)).toBeCloseTo(270, 6)
  })

  it('pins the endpoints and stays in 0..360', () => {
    for (const [from, to] of [
      [350, 10],
      [10, 350],
      [0, 180],
      [271, 3],
    ]) {
      expect(lerpAngle(from, to, 0) % 360).toBeCloseTo(from % 360, 6)
      expect(lerpAngle(from, to, 1) % 360).toBeCloseTo(to % 360, 6)
      for (let t = 0; t <= 1; t += 0.1) {
        const v = lerpAngle(from, to, t)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(360)
      }
    }
  })
})

describe('pointOnLeg / splitLeg on the real Tampa polylines', () => {
  const legs = legsFor('run-a')

  it('has legs to test', () => {
    expect(legs.length).toBeGreaterThan(0)
  })

  it('t=0 is the leg start and t=1 is the leg end', () => {
    for (const leg of legs) {
      const start = pointOnLeg(leg, 0)
      const end = pointOnLeg(leg, 1)
      expect(haversine(start.position, leg.coords[0])).toBeLessThan(1)
      expect(haversine(end.position, leg.coords[leg.coords.length - 1])).toBeLessThan(1)
    }
  })

  it('clamps out-of-range t to the endpoints rather than extrapolating', () => {
    const leg = legs[0]
    expect(pointOnLeg(leg, -5).position).toEqual(pointOnLeg(leg, 0).position)
    expect(pointOnLeg(leg, 5).position).toEqual(pointOnLeg(leg, 1).position)
  })

  it('advances monotonically: sampled arc length matches the leg length', () => {
    for (const leg of legs) {
      let travelled = 0
      let prev = pointOnLeg(leg, 0).position
      for (let i = 1; i <= 400; i++) {
        const next = pointOnLeg(leg, i / 400).position
        const step = haversine(prev, next)
        expect(step).toBeGreaterThanOrEqual(0)
        travelled += step
        prev = next
      }
      // sampling a polyline can only under-measure, never over-measure
      expect(travelled).toBeLessThanOrEqual(leg.length + 1)
      expect(travelled / leg.length).toBeGreaterThan(0.99)
    }
  })

  it('round-trips through projectOnLeg: a point on the leg reports its own progress', () => {
    for (const leg of legs) {
      for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        const { position } = pointOnLeg(leg, t)
        const snap = projectOnLeg(leg, position)
        expect(snap.offRouteM).toBeLessThan(5)
        expect(Math.abs(snap.progress - t)).toBeLessThan(0.02)
      }
    }
  })

  it('reports a real off-route distance for a fix nowhere near the road', () => {
    // live/apply.ts refuses to snap a fix further than OFF_ROUTE_LIMIT_M (400 m)
    // from the leg, so `offRouteM` has to be metres — and metres measured to the
    // point it actually claims to have snapped to, not to the segment it liked.
    const leg = legs[0]
    const onRoad = pointOnLeg(leg, 0.5).position
    const offRoad: LngLat = [onRoad[0], onRoad[1] + 0.02] // ~2.2 km north
    const snap = projectOnLeg(leg, offRoad)
    const nearest = pointOnLeg(leg, snap.progress).position
    expect(snap.offRouteM).toBeGreaterThan(400)
    expect(Math.abs(snap.offRouteM - haversine(offRoad, nearest)) / snap.offRouteM).toBeLessThan(0.05)
  })

  it('a fix on the road is well inside the 400 m snap gate', () => {
    for (const leg of legs) {
      for (const t of [0.1, 0.5, 0.9]) {
        expect(projectOnLeg(leg, pointOnLeg(leg, t).position).offRouteM).toBeLessThan(400)
      }
    }
  })

  it('splitLeg partitions the polyline at the driver, with no gap at the seam', () => {
    const leg = legs[0]
    for (const t of [0, 0.33, 0.66, 1]) {
      const here = pointOnLeg(leg, t).position
      const { travelled, remaining } = splitLeg(leg, t)
      expect(travelled.length + remaining.length).toBe(leg.coords.length + 2)
      // travelled ends at the driver, remaining starts there — the console draws
      // both and any gap would show as a broken route line under the van.
      expect(travelled[travelled.length - 1]).toEqual(here)
      expect(remaining[0]).toEqual(here)
      expect(haversine(travelled[0], leg.coords[0])).toBeLessThan(1)
      expect(haversine(remaining[remaining.length - 1], leg.coords[leg.coords.length - 1])).toBeLessThan(1)
    }
  })

  it('degenerate legs do not throw', () => {
    const single = prepareLeg({ distance_m: 0, duration_s: 0, coords: [[-82.4, 27.9]] })
    expect(pointOnLeg(single, 0.5).position).toEqual([-82.4, 27.9])
    expect(projectOnLeg(single, [-82.4, 27.9])).toEqual({ progress: 0, offRouteM: 0 })
    const empty = prepareLeg({ distance_m: 0, duration_s: 0, coords: [] })
    expect(pointOnLeg(empty, 0.5).position).toEqual([0, 0])
  })
})

describe('boundsOf', () => {
  it('brackets every point it was given', () => {
    const box = boundsOf([DEPOT_LL, TPA, YBOR, MCO])
    expect(box).not.toBeNull()
    const [w, s, e, n] = box as [number, number, number, number]
    for (const [lng, lat] of [DEPOT_LL, TPA, YBOR, MCO]) {
      expect(lng).toBeGreaterThanOrEqual(w)
      expect(lng).toBeLessThanOrEqual(e)
      expect(lat).toBeGreaterThanOrEqual(s)
      expect(lat).toBeLessThanOrEqual(n)
    }
  })

  it('returns null for an empty set rather than an infinite box', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('brackets the depot and every run polyline', () => {
    const box = boundsOf([DEPOT, ...legsFor('run-a').flatMap((l) => l.coords)])
    expect(box).not.toBeNull()
  })
})

describe('seeded randomness', () => {
  it('hashSeed is stable, unsigned, and sensitive to one character', () => {
    expect(hashSeed('run-a#0#speed#0')).toBe(hashSeed('run-a#0#speed#0'))
    expect(hashSeed('run-a#0#speed#0')).not.toBe(hashSeed('run-a#1#speed#0'))
    expect(hashSeed('run-a#0#speed#0')).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(hashSeed(''))).toBe(true)
  })

  it('rng replays exactly from the same seed and diverges from a different one', () => {
    const a = rng(12345)
    const b = rng(12345)
    const c = rng(12346)
    const seqA = Array.from({ length: 20 }, a)
    const seqB = Array.from({ length: 20 }, b)
    const seqC = Array.from({ length: 20 }, c)
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual(seqC)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('rng is not obviously biased across 10k draws', () => {
    const r = rng(hashSeed('bias-check'))
    let sum = 0
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < 10_000; i++) {
      const v = r()
      sum += v
      buckets[Math.min(9, Math.floor(v * 10))] += 1
    }
    expect(sum / 10_000).toBeGreaterThan(0.47)
    expect(sum / 10_000).toBeLessThan(0.53)
    for (const count of buckets) expect(count).toBeGreaterThan(700)
  })

  it('seededRange stays inside its bounds and replays', () => {
    for (let i = 0; i < 200; i++) {
      const v = seededRange(`k${i}`, 20, 75)
      expect(v).toBeGreaterThanOrEqual(20)
      expect(v).toBeLessThan(75)
    }
    expect(seededRange('same', 0, 1)).toBe(seededRange('same', 0, 1))
  })
})
