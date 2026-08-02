/**
 * Geometry helpers for the sim engine and the map.
 * Pure functions, no state, no imports — safe to use anywhere.
 */

import type { RouteLeg } from '../types'

export type LngLat = [number, number]

const R_EARTH = 6371008.8 // mean earth radius, metres
const DEG = Math.PI / 180

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG
  const dLng = (b[0] - a[0]) * DEG
  const lat1 = a[1] * DEG
  const lat2 = b[1] * DEG
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Compass bearing a -> b, degrees clockwise from north (0..360). */
export function bearing(a: LngLat, b: LngLat): number {
  const lat1 = a[1] * DEG
  const lat2 = b[1] * DEG
  const dLng = (b[0] - a[0]) * DEG
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) / DEG + 360) % 360
}

/** Shortest-path interpolation between two compass angles (handles the 360/0 seam). */
export function lerpAngle(from: number, to: number, t: number): number {
  let delta = ((to - from + 540) % 360) - 180
  return (from + delta * t + 360) % 360
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

export interface PreparedLeg {
  coords: LngLat[]
  /** cumulative metres at each coordinate index; cum[0] === 0 */
  cum: number[]
  /** measured length in metres (may differ slightly from OSRM's distance_m) */
  length: number
  /** OSRM's own numbers, kept for honest ETA maths */
  distance_m: number
  duration_s: number
}

/** Precompute cumulative distances so position lookups are O(log n). */
export function prepareLeg(leg: RouteLeg): PreparedLeg {
  const coords = leg.coords as LngLat[]
  const cum: number[] = new Array(coords.length)
  cum[0] = 0
  for (let i = 1; i < coords.length; i++) {
    cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i])
  }
  return {
    coords,
    cum,
    length: cum[cum.length - 1] || 1,
    distance_m: leg.distance_m,
    duration_s: leg.duration_s,
  }
}

export interface LegPoint {
  position: LngLat
  heading: number
}

/**
 * Position + heading at fraction `t` (0..1) along a prepared leg.
 * Heading looks ahead along the polyline so the driver arrow points where the
 * road goes, not where the last GPS sample was.
 */
export function pointOnLeg(leg: PreparedLeg, t: number): LegPoint {
  const coords = leg.coords
  if (coords.length === 0) return { position: [0, 0], heading: 0 }
  if (coords.length === 1) return { position: coords[0], heading: 0 }

  const clamped = Math.max(0, Math.min(1, t))
  const target = clamped * leg.length

  // binary search for the segment containing `target`
  let lo = 0
  let hi = leg.cum.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (leg.cum[mid] <= target) lo = mid
    else hi = mid
  }

  const segStart = coords[lo]
  const segEnd = coords[Math.min(lo + 1, coords.length - 1)]
  const segLen = leg.cum[lo + 1] - leg.cum[lo] || 1
  const f = Math.max(0, Math.min(1, (target - leg.cum[lo]) / segLen))

  const position: LngLat = [lerp(segStart[0], segEnd[0], f), lerp(segStart[1], segEnd[1], f)]

  // look ahead ~40m for a stable heading
  const ahead = Math.min(leg.length, target + 40)
  let j = lo
  while (j < leg.cum.length - 1 && leg.cum[j] < ahead) j++
  const headTarget = coords[j]
  const heading =
    haversine(position, headTarget) < 1 ? bearing(segStart, segEnd) : bearing(position, headTarget)

  return { position, heading }
}

export interface LegProjection {
  /** Fraction 0..1 along the leg of the nearest point on the polyline. */
  progress: number
  /** Metres from `point` to that nearest point — how far off-route the fix is. */
  offRouteM: number
}

/**
 * Snap an arbitrary point (a real GPS fix) onto a leg.
 *
 * Live mode needs this: a phone reports where it actually is, but the console's
 * travelled/ahead route split and every ETA are expressed as `progress` along
 * the leg. Projecting the fix keeps one representation for both engines instead
 * of forking the map on where the position came from.
 *
 * Planar approximation with a longitude scale factor — legs are a few km at
 * most, so the error is far below GPS accuracy.
 */
export function projectOnLeg(leg: PreparedLeg, point: LngLat): LegProjection {
  const coords = leg.coords
  if (coords.length < 2) return { progress: 0, offRouteM: 0 }

  const kx = Math.cos(point[1] * DEG)
  const METRES_PER_DEG = 111_320

  let bestD2 = Infinity
  let bestAlong = 0

  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0] * kx
    const ay = coords[i][1]
    const bx = coords[i + 1][0] * kx
    const by = coords[i + 1][1]
    const px = point[0] * kx
    const py = point[1]

    const vx = bx - ax
    const vy = by - ay
    const len2 = vx * vx + vy * vy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2))
    const cx = ax + vx * t
    const cy = ay + vy * t
    const d2 = (px - cx) ** 2 + (py - cy) ** 2

    if (d2 < bestD2) {
      bestD2 = d2
      const segLen = leg.cum[i + 1] - leg.cum[i]
      bestAlong = leg.cum[i] + segLen * t
    }
  }

  return {
    progress: Math.max(0, Math.min(1, bestAlong / (leg.length || 1))),
    offRouteM: Math.sqrt(bestD2) * METRES_PER_DEG,
  }
}

/** Slice a leg's polyline into [travelled, remaining] at fraction `t`. */
export function splitLeg(leg: PreparedLeg, t: number): { travelled: LngLat[]; remaining: LngLat[] } {
  const { position } = pointOnLeg(leg, t)
  const target = Math.max(0, Math.min(1, t)) * leg.length
  const travelled: LngLat[] = []
  const remaining: LngLat[] = []
  for (let i = 0; i < leg.coords.length; i++) {
    if (leg.cum[i] <= target) travelled.push(leg.coords[i])
    else remaining.push(leg.coords[i])
  }
  travelled.push(position)
  remaining.unshift(position)
  return { travelled, remaining }
}

/** Bounding box [w, s, e, n] over a set of points. */
export function boundsOf(points: LngLat[]): [number, number, number, number] | null {
  if (points.length === 0) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [lng, lat] of points) {
    if (lng < w) w = lng
    if (lng > e) e = lng
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  return [w, s, e, n]
}

/* --------------------------------------------------------------------- *
 * Deterministic pseudo-randomness. Seeded from stable strings so replays
 * feel similar but not looped-video identical (SPEC: "deterministic-ish").
 * --------------------------------------------------------------------- */

export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** mulberry32 — small, fast, good enough for jitter and seeding. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic value in [min, max) from a string key. */
export function seededRange(key: string, min: number, max: number): number {
  return min + rng(hashSeed(key))() * (max - min)
}
