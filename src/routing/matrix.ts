/**
 * Leg matrix — the road distances the planner reasons about.
 *
 * `src/data/matrix.json` holds the full DIRECTED pairwise legs between the depot
 * and every seeded stop (12 nodes, 132 legs), pre-fetched once from OSRM at build
 * time. SPEC.md: "NEVER call OSRM at runtime". Everything the `/plan` sandbox
 * knows about travel time comes from this file and nowhere else.
 *
 * Directed matters. `depot -> run-a-3` and `run-a-3 -> depot` differ by up to
 * 144 s on this data (one-way pairs, ramp geometry, turn restrictions), so the
 * optimiser may never assume `d(a,b) === d(b,a)` and neither may anything here.
 *
 * The node id -> store stop id mapping is built EXPLICITLY, by position, against
 * the same `routes.json` structure `seed.ts` derives its stops from — not by
 * trusting that the two id schemes happen to spell the same string. If a stop
 * cannot be matched, or a node goes unclaimed, this module throws at import
 * time: a planner silently routing to the wrong doorstep is worse than a page
 * that refuses to load.
 */

import matrixRaw from '../data/matrix.json'
import { ROUTES } from '../data/seed'
import type { RouteLeg } from '../types'
import type { LngLat } from '../sim/geo'

export interface MatrixNode {
  /** Matrix-local id: 'depot' or a stop node such as 'run-a-1'. */
  id: string
  name: string
  lon: number
  lat: number
}

/** One directed leg. Same shape as a `RouteLeg`, so the sim engine can eat it. */
export type MatrixLeg = RouteLeg

interface MatrixFile {
  nodes: MatrixNode[]
  legs: Record<string, MatrixLeg>
}

const FILE = matrixRaw as unknown as MatrixFile

/** The one node every sequence starts and ends at. */
export const DEPOT_NODE = 'depot'

/** Key convention inside matrix.json. */
function legKey(from: string, to: string): string {
  return `${from}|${to}`
}

/**
 * Coordinates come from one source (routes.json feeds both the seed and the
 * matrix generator), so an exact match is expected. The tolerance is here so a
 * regenerated matrix that rounds differently still maps rather than throwing —
 * 1e-7 degrees is about a centimetre, far tighter than any two real doorsteps.
 */
const COORD_EPSILON = 1e-7

/* ------------------------------------------------------------- node index -- */

const NODE_BY_ID = new Map<string, MatrixNode>()
for (const node of FILE.nodes) {
  if (NODE_BY_ID.has(node.id)) {
    throw new Error(`[matrix] duplicate node id '${node.id}' in matrix.json`)
  }
  NODE_BY_ID.set(node.id, node)
}

if (!NODE_BY_ID.has(DEPOT_NODE)) {
  throw new Error(`[matrix] matrix.json has no '${DEPOT_NODE}' node — every sequence starts there`)
}

/** Stop nodes only (the depot is not a delivery), in file order. */
export const STOP_NODES: MatrixNode[] = FILE.nodes.filter((n) => n.id !== DEPOT_NODE)

/** Stop node ids only, in file order. */
export const STOP_NODE_IDS: string[] = STOP_NODES.map((n) => n.id)

/* ------------------------------------------------------ store-id mapping --- */

/**
 * Rebuild the store's stop ids the way `seed.ts#buildFleet` does — `${route.id}-${index + 1}`
 * — and pair each one with the matrix node standing at the same coordinates.
 *
 * Deliberately positional. The two id schemes agree today; matching on the
 * coordinate is what makes that agreement a verified fact rather than an
 * assumption that fails silently the day the matrix is regenerated.
 */
function buildMapping(): { nodeByStop: Map<string, string>; stopByNode: Map<string, string> } {
  const nodeByStop = new Map<string, string>()
  const stopByNode = new Map<string, string>()
  const problems: string[] = []

  for (const route of ROUTES.runs) {
    route.stops.forEach((seedStop, index) => {
      const stopId = `${route.id}-${index + 1}`
      const matches = STOP_NODES.filter(
        (n) =>
          Math.abs(n.lon - seedStop.lon) <= COORD_EPSILON &&
          Math.abs(n.lat - seedStop.lat) <= COORD_EPSILON,
      )
      if (matches.length !== 1) {
        problems.push(
          `stop '${stopId}' (${seedStop.lon}, ${seedStop.lat}) matched ${matches.length} matrix nodes`,
        )
        return
      }
      const node = matches[0]
      if (stopByNode.has(node.id)) {
        problems.push(`matrix node '${node.id}' claimed by both '${stopByNode.get(node.id)}' and '${stopId}'`)
        return
      }
      nodeByStop.set(stopId, node.id)
      stopByNode.set(node.id, stopId)
    })
  }

  for (const node of STOP_NODES) {
    if (!stopByNode.has(node.id)) {
      problems.push(`matrix node '${node.id}' has no seeded stop — the matrix is stale`)
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `[matrix] matrix.json does not line up with the seeded fleet:\n  - ${problems.join('\n  - ')}`,
    )
  }

  return { nodeByStop, stopByNode }
}

const { nodeByStop: NODE_BY_STOP, stopByNode: STOP_BY_NODE } = buildMapping()

/* ---------------------------------------------------------- leg integrity -- */

/**
 * Every directed pair present, and every leg actually drivable.
 *
 * The mapping check above proves the planner is routing to the right doorsteps.
 * This proves it can price the roads between them. Both run at import for the
 * same reason: a page that refuses to load is recoverable, a route that was
 * costed against a leg the matrix never measured is not.
 *
 * The specific failure this exists to catch: OSRM's table service emits `null`
 * for a pair it cannot route, and `total += null` is not `NaN` — JavaScript
 * coerces it to zero. A single null duration therefore scored that road as
 * FREE and made an undrivable sequence look like the cheapest one on the
 * screen, silently, with no error anywhere. Nothing downstream could have
 * noticed: the number was finite, positive and wrong.
 */
export function assertMatrixIntegrity(): void {
  const problems: string[] = []
  const ids = FILE.nodes.map((n) => n.id)

  for (const a of ids) {
    for (const b of ids) {
      if (a === b) {
        if (hasLeg(a, b)) problems.push(`'${a}' has a leg to itself`)
        continue
      }
      const leg = FILE.legs[legKey(a, b)] as MatrixLeg | undefined
      if (!leg) {
        problems.push(`no leg '${a}' -> '${b}'`)
        continue
      }
      if (!(typeof leg.duration_s === 'number' && Number.isFinite(leg.duration_s) && leg.duration_s > 0)) {
        problems.push(`leg '${a}' -> '${b}' has duration_s ${String(leg.duration_s)}`)
      }
      if (!(typeof leg.distance_m === 'number' && Number.isFinite(leg.distance_m) && leg.distance_m > 0)) {
        problems.push(`leg '${a}' -> '${b}' has distance_m ${String(leg.distance_m)}`)
      }
      if (!Array.isArray(leg.coords) || leg.coords.length < 2) {
        problems.push(`leg '${a}' -> '${b}' has no drivable geometry`)
      }
    }
  }

  const stray = Object.keys(FILE.legs).length - ids.length * (ids.length - 1)
  if (stray > 0) problems.push(`${stray} leg(s) reference a node the matrix does not declare`)

  if (problems.length > 0) {
    const shown = problems.slice(0, 8).join('\n  - ')
    const rest = problems.length > 8 ? `\n  - ...and ${problems.length - 8} more` : ''
    throw new Error(`[matrix] matrix.json is not a complete, drivable matrix:\n  - ${shown}${rest}`)
  }
}

/** Matrix node id for a store stop id, or null when the stop is not routable. */
export function nodeForStop(stopId: string): string | null {
  return NODE_BY_STOP.get(stopId) ?? null
}

/** Store stop id for a matrix node id, or null for the depot / unknown nodes. */
export function stopForNode(nodeId: string): string | null {
  return STOP_BY_NODE.get(nodeId) ?? null
}

/** Every store stop id the matrix can route to, in seeded order. */
export function routableStopIds(): string[] {
  return [...NODE_BY_STOP.keys()]
}

export function isMatrixNode(id: string): boolean {
  return NODE_BY_ID.has(id)
}

export function nodeOf(id: string): MatrixNode {
  const node = NODE_BY_ID.get(id)
  if (!node) throw new Error(`[matrix] unknown node '${id}'`)
  return node
}

export function nodePosition(id: string): LngLat {
  const node = nodeOf(id)
  return [node.lon, node.lat]
}

/* -------------------------------------------------------------- accessors -- */

/**
 * The directed leg `a -> b`. Throws rather than returning a fallback: a missing
 * leg means the matrix is incomplete, and a planner that quietly scores a
 * missing road as free would hand a dispatcher a route that cannot be driven.
 */
export function legBetween(a: string, b: string): MatrixLeg {
  const leg = FILE.legs[legKey(a, b)]
  if (!leg) {
    if (a === b) throw new Error(`[matrix] no leg from '${a}' to itself`)
    throw new Error(`[matrix] no leg '${a}' -> '${b}' in matrix.json`)
  }
  /*
   * One comparison, on the hottest path in the planner, because "missing" is
   * not the only way a road goes unmeasured. `null`, `undefined` and `NaN` all
   * fail `> 0`, and the first two would otherwise be summed as ZERO — a free
   * road, which is worse than a loud one.
   */
  if (!(leg.duration_s > 0)) {
    throw new Error(
      `[matrix] leg '${a}' -> '${b}' has an unusable duration (${String(leg.duration_s)}) — it cannot be priced`,
    )
  }
  return leg
}

export function hasLeg(a: string, b: string): boolean {
  return Object.prototype.hasOwnProperty.call(FILE.legs, legKey(a, b))
}

/** Every directed leg key in the file. Integrity tests read this. */
export function legKeys(): string[] {
  return Object.keys(FILE.legs)
}

/**
 * The ordered legs a sequence actually drives: depot -> stop 1 -> ... -> depot.
 * Index-aligned with `Run.stops` plus one closing leg, which is exactly the
 * shape `seed.ts#legsFor` returns for the seeded runs.
 */
export function legsForSequence(sequence: string[]): MatrixLeg[] {
  if (sequence.length === 0) return []
  const legs: MatrixLeg[] = []
  let prev = DEPOT_NODE
  for (const node of sequence) {
    legs.push(legBetween(prev, node))
    prev = node
  }
  legs.push(legBetween(prev, DEPOT_NODE))
  return legs
}

/**
 * Total driving seconds for `sequence`, depot out and depot back.
 * An empty sequence is zero — the van never leaves, so there is no round trip
 * to charge for.
 */
export function durationOf(sequence: string[]): number {
  let total = 0
  for (const leg of legsForSequence(sequence)) total += leg.duration_s
  return total
}

/** Total driving metres for `sequence`, depot out and depot back. */
export function distanceOf(sequence: string[]): number {
  let total = 0
  for (const leg of legsForSequence(sequence)) total += leg.distance_m
  return total
}

/**
 * One continuous polyline for the whole sequence, ready for the map.
 *
 * Consecutive legs meet at exactly the same snapped coordinate (OSRM resolves a
 * waypoint to one road position, every time), so the duplicate join points are
 * dropped and the result is contiguous.
 */
export function pathCoords(sequence: string[]): LngLat[] {
  const out: LngLat[] = []
  for (const leg of legsForSequence(sequence)) {
    for (const c of leg.coords as LngLat[]) {
      const last = out[out.length - 1]
      if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c)
    }
  }
  return out
}

/*
 * Runs last, with every accessor above it defined: the module either exports a
 * matrix the planner can trust end to end, or it does not load.
 */
assertMatrixIntegrity()
