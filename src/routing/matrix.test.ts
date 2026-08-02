/**
 * Leg matrix integrity.
 *
 * The planner's every number traces back to this file, so the file itself gets
 * audited: every directed pair present, nothing zero or negative, and the
 * geometry actually joining up where the arithmetic says it does. A matrix that
 * is quietly missing a leg, or whose polyline ends 400 m from the doorstep, is a
 * planner that lies confidently.
 */

import { describe, expect, it } from 'vitest'
import {
  DEPOT_NODE,
  distanceOf,
  durationOf,
  hasLeg,
  isMatrixNode,
  legBetween,
  legKeys,
  legsForSequence,
  nodeForStop,
  nodeOf,
  nodePosition,
  pathCoords,
  routableStopIds,
  stopForNode,
  STOP_NODE_IDS,
  STOP_NODES,
} from './matrix'
import { ROUTES } from '../data/seed'
import { haversine, type LngLat } from '../sim/geo'

const ALL_NODES = [DEPOT_NODE, ...STOP_NODE_IDS]

/**
 * How far a waypoint is allowed to sit from the road OSRM snapped it to.
 *
 * Measured on the shipped file: eleven of the twelve nodes land within 26 m,
 * and `run-a-3` is 185 m out because its seeded coordinate sits back off the
 * nearest routable road. That is a real property of address-to-road snapping,
 * not a defect, so the bar is set above it — with a second, tighter assertion
 * below to catch the day someone regenerates the matrix against the wrong
 * coordinates and every node drifts.
 */
const SNAP_TOLERANCE_M = 250
const SNAP_REGRESSION_M = 200

describe('matrix shape', () => {
  it('has the depot plus eleven stop nodes', () => {
    expect(STOP_NODES).toHaveLength(11)
    expect(ALL_NODES).toHaveLength(12)
    expect(new Set(ALL_NODES).size).toBe(12)
    expect(isMatrixNode(DEPOT_NODE)).toBe(true)
  })

  it('holds every directed pair and nothing else — 12 x 11 = 132 legs', () => {
    expect(legKeys()).toHaveLength(132)
    for (const a of ALL_NODES) {
      for (const b of ALL_NODES) {
        if (a === b) {
          expect(hasLeg(a, b)).toBe(false)
          continue
        }
        expect(hasLeg(a, b), `missing leg ${a} -> ${b}`).toBe(true)
      }
    }
  })

  it('never carries a leg from a node to itself', () => {
    for (const key of legKeys()) {
      const [from, to] = key.split('|')
      expect(from).not.toBe(to)
    }
  })

  it('has a positive duration, distance and a real polyline on every leg', () => {
    for (const key of legKeys()) {
      const [from, to] = key.split('|')
      const leg = legBetween(from, to)
      expect(leg.duration_s, `${key} duration`).toBeGreaterThan(0)
      expect(leg.distance_m, `${key} distance`).toBeGreaterThan(0)
      expect(leg.coords.length, `${key} coords`).toBeGreaterThanOrEqual(2)
      expect(Number.isFinite(leg.duration_s)).toBe(true)
      expect(Number.isFinite(leg.distance_m)).toBe(true)
    }
  })

  it('is DIRECTED — the optimiser may not assume d(a,b) === d(b,a)', () => {
    let asymmetric = 0
    for (const a of ALL_NODES) {
      for (const b of ALL_NODES) {
        if (a === b) continue
        if (legBetween(a, b).duration_s !== legBetween(b, a).duration_s) asymmetric += 1
      }
    }
    // 124 of 132 on the shipped file. If this ever hits zero the matrix has been
    // flattened to a symmetric one and 2-opt's cheap-gain shortcut becomes valid
    // — which would be a real change of contract, not a tidy-up.
    expect(asymmetric).toBeGreaterThan(0)
  })

  it('throws loudly rather than scoring a missing road as free', () => {
    expect(() => legBetween('depot', 'nope')).toThrow(/no leg/)
    expect(() => legBetween('depot', 'depot')).toThrow(/to itself/)
    expect(() => nodeOf('nope')).toThrow(/unknown node/)
  })
})

describe('matrix geometry', () => {
  it('snaps each node to exactly one road position across all 132 legs', () => {
    const starts = new Map<string, Set<string>>()
    const ends = new Map<string, Set<string>>()
    for (const key of legKeys()) {
      const [from, to] = key.split('|')
      const leg = legBetween(from, to)
      const first = leg.coords[0].join(',')
      const last = leg.coords[leg.coords.length - 1].join(',')
      if (!starts.has(from)) starts.set(from, new Set())
      if (!ends.has(to)) ends.set(to, new Set())
      starts.get(from)!.add(first)
      ends.get(to)!.add(last)
    }
    for (const node of ALL_NODES) {
      expect(starts.get(node)!.size, `${node} leaves from more than one point`).toBe(1)
      expect(ends.get(node)!.size, `${node} is reached at more than one point`).toBe(1)
      // and leaving is the same kerb as arriving
      expect([...starts.get(node)!][0]).toBe([...ends.get(node)!][0])
    }
  })

  it('starts and ends every leg at the node it claims to connect', () => {
    let worst = 0
    for (const key of legKeys()) {
      const [from, to] = key.split('|')
      const leg = legBetween(from, to)
      const startOff = haversine(nodePosition(from), leg.coords[0] as LngLat)
      const endOff = haversine(nodePosition(to), leg.coords[leg.coords.length - 1] as LngLat)
      expect(startOff, `${key} starts ${startOff.toFixed(0)}m from ${from}`).toBeLessThan(
        SNAP_TOLERANCE_M,
      )
      expect(endOff, `${key} ends ${endOff.toFixed(0)}m from ${to}`).toBeLessThan(SNAP_TOLERANCE_M)
      worst = Math.max(worst, startOff, endOff)
    }
    // the shipped file's worst snap is 184.7 m — anything past this means the
    // matrix and the seeded coordinates have drifted apart
    expect(worst).toBeLessThan(SNAP_REGRESSION_M)
  })

  it('joins consecutive legs at exactly the same coordinate', () => {
    const sequence = ['run-b-2', 'run-a-1', 'run-c-3']
    const legs = legsForSequence(sequence)
    for (let i = 0; i < legs.length - 1; i++) {
      const end = legs[i].coords[legs[i].coords.length - 1]
      const start = legs[i + 1].coords[0]
      expect(start[0]).toBe(end[0])
      expect(start[1]).toBe(end[1])
    }
  })
})

describe('store-id mapping', () => {
  it('maps every seeded stop to exactly one matrix node, and back', () => {
    const seededIds: string[] = []
    for (const route of ROUTES.runs) {
      route.stops.forEach((_, index) => seededIds.push(`${route.id}-${index + 1}`))
    }
    expect(seededIds).toHaveLength(11)
    expect(routableStopIds().sort()).toEqual(seededIds.slice().sort())

    for (const stopId of seededIds) {
      const node = nodeForStop(stopId)
      expect(node, `stop ${stopId} has no matrix node`).not.toBeNull()
      expect(stopForNode(node!)).toBe(stopId)
    }
    for (const nodeId of STOP_NODE_IDS) {
      const stopId = stopForNode(nodeId)
      expect(stopId, `node ${nodeId} has no seeded stop`).not.toBeNull()
      expect(nodeForStop(stopId!)).toBe(nodeId)
    }
  })

  it('maps by position, and that mapping agrees with the id convention', () => {
    // The mapping is built on coordinates so it survives a re-generated matrix.
    // Today the two schemes also spell the same string; assert that as a
    // separate fact rather than depending on it.
    for (const stopId of routableStopIds()) {
      expect(nodeForStop(stopId)).toBe(stopId)
    }
  })

  it('places every mapped node at its seeded coordinate', () => {
    for (const route of ROUTES.runs) {
      route.stops.forEach((seedStop, index) => {
        const node = nodeOf(`${route.id}-${index + 1}`)
        expect(node.lon).toBeCloseTo(seedStop.lon, 9)
        expect(node.lat).toBeCloseTo(seedStop.lat, 9)
      })
    }
  })

  it('does not map the depot to a delivery', () => {
    expect(stopForNode(DEPOT_NODE)).toBeNull()
    expect(nodeForStop('depot')).toBeNull()
  })
})

describe('sequence arithmetic', () => {
  it('charges nothing for an empty run', () => {
    expect(durationOf([])).toBe(0)
    expect(distanceOf([])).toBe(0)
    expect(legsForSequence([])).toEqual([])
    expect(pathCoords([])).toEqual([])
  })

  it('charges depot out and depot back for a single stop', () => {
    const out = legBetween(DEPOT_NODE, 'run-a-1').duration_s
    const back = legBetween('run-a-1', DEPOT_NODE).duration_s
    expect(durationOf(['run-a-1'])).toBe(out + back)
    expect(legsForSequence(['run-a-1'])).toHaveLength(2)
  })

  it('sums exactly the legs it drives', () => {
    const sequence = ['run-a-2', 'run-c-1', 'run-b-4']
    const legs = legsForSequence(sequence)
    expect(legs).toHaveLength(sequence.length + 1)
    expect(durationOf(sequence)).toBe(legs.reduce((t, l) => t + l.duration_s, 0))
    expect(distanceOf(sequence)).toBe(legs.reduce((t, l) => t + l.distance_m, 0))
  })

  it('reflects direction — reversing a sequence changes its cost', () => {
    const forward = ['run-a-1', 'run-b-3', 'run-c-2']
    const reverse = [...forward].reverse()
    expect(durationOf(forward)).not.toBe(durationOf(reverse))
  })

  it('builds one contiguous polyline with no repeated join points', () => {
    const sequence = ['run-a-3', 'run-b-1', 'run-c-2', 'run-a-4']
    const coords = pathCoords(sequence)
    const legs = legsForSequence(sequence)
    const rawCount = legs.reduce((n, l) => n + l.coords.length, 0)

    /*
     * At least one point goes at every internal join. It is usually more than
     * that: 58 of the 132 legs carry repeated vertices of their own (OSRM emits
     * them at some junctions), and those collapse here too — which is the whole
     * reason the map gets a de-duplicated line rather than the raw concatenation.
     */
    expect(coords.length).toBeLessThanOrEqual(rawCount - (legs.length - 1))
    expect(coords.length).toBeGreaterThan(rawCount / 2)

    // the property that actually matters: nothing repeats, anywhere
    for (let i = 1; i < coords.length; i++) {
      expect(coords[i][0] === coords[i - 1][0] && coords[i][1] === coords[i - 1][1]).toBe(false)
    }
    // starts and ends at the depot's road position
    const depotSnap = legBetween(DEPOT_NODE, sequence[0]).coords[0]
    expect(coords[0]).toEqual(depotSnap)
    expect(coords[coords.length - 1]).toEqual(depotSnap)
  })

  it('refuses to price a sequence containing an unknown stop', () => {
    expect(() => durationOf(['run-a-1', 'ghost'])).toThrow(/no leg/)
  })
})
