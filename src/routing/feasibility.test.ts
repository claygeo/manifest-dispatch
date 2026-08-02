/**
 * Same-day feasibility.
 *
 * SPEC's testing bar: "feasibility rejects window-impossible insertions and
 * accepts provably-fitting ones (fixture cases both ways)". Both ways are here,
 * plus the third case that matters more than either: an insertion that fits the
 * NEW order fine but pushes an EXISTING customer out of the window they were
 * already promised. That has to be refused too, or the feature is a way to break
 * promises quietly.
 *
 * Every fixture derives its windows from a reference clock through `formatClock`,
 * so the suite means the same thing in every timezone the repo is cloned into.
 */

import { describe, expect, it } from 'vitest'
import {
  canFitToday,
  projectSequence,
  SERVICE_TIME_S,
  type PlanRunInput,
  type WindowPair,
} from './feasibility'
import { DEPOT_NODE, legBetween, STOP_NODE_IDS } from './matrix'
import { formatClock } from '../format'
import { DWELL_MAX_S, DWELL_MIN_S } from '../sim/eta'

/** Mid-shift, on an exact minute so clock-string round-trips are lossless. */
const NOW = Date.parse('2026-08-02T17:00:00.000Z')

/** A clock string `minutes` from the reference — always local-consistent. */
function at(minutes: number, ref: number = NOW): string {
  return formatClock(ref + minutes * 60_000)
}

function window(fromMin: number, toMin: number, ref: number = NOW): WindowPair {
  return [at(fromMin, ref), at(toMin, ref)]
}

/** Driving seconds a -> b, straight off the matrix. */
function drive(a: string, b: string): number {
  return legBetween(a, b).duration_s
}

const WIDE = window(-60, 300)

/**
 * A run with wide-open windows on every routable stop. Tests then tighten only
 * the window whose behaviour they are actually asserting on.
 */
function makeRun(overrides: Partial<PlanRunInput> = {}): PlanRunInput {
  const windows: Record<string, WindowPair> = {}
  for (const id of STOP_NODE_IDS) windows[id] = WIDE
  return {
    runId: 'run-fixture',
    fromNodeId: DEPOT_NODE,
    sequence: ['run-a-1', 'run-a-2'],
    shiftEndMs: NOW + 8 * 3_600_000,
    ...overrides,
    windows: { ...windows, ...(overrides.windows ?? {}) },
  }
}

describe('service time', () => {
  it('is the sim engine dwell midpoint, so the planner and the fleet agree', () => {
    expect(SERVICE_TIME_S).toBe((DWELL_MIN_S + DWELL_MAX_S) / 2)
    expect(SERVICE_TIME_S).toBe(47.5)
  })
})

describe('projection arithmetic', () => {
  it('charges driving plus service for each stop, and the trip home', () => {
    const run = makeRun({ sequence: ['run-a-1', 'run-c-2'] })
    const projection = projectSequence(run, run.sequence, NOW)

    const expected =
      NOW +
      (drive(DEPOT_NODE, 'run-a-1') +
        SERVICE_TIME_S +
        drive('run-a-1', 'run-c-2') +
        SERVICE_TIME_S +
        drive('run-c-2', DEPOT_NODE)) *
        1000

    expect(projection.endsAtMs).toBe(expected)
    expect(projection.feasible).toBe(true)
    expect(projection.stops).toHaveLength(2)
    expect(projection.stops[0].arriveMs).toBe(NOW + drive(DEPOT_NODE, 'run-a-1') * 1000)
    expect(projection.stops.every((s) => !s.missed)).toBe(true)
  })

  it('waits for a window that has not opened yet, and does not call that late', () => {
    const run = makeRun({ sequence: ['run-a-1'], windows: { 'run-a-1': window(120, 240) } })
    const projection = projectSequence(run, run.sequence, NOW)

    expect(projection.feasible).toBe(true)
    expect(projection.stops[0].missed).toBe(false)
    expect(projection.stops[0].waitS).toBeGreaterThan(0)
    // service starts when the window opens, not when the van pulls up
    expect(projection.stops[0].departMs).toBe(NOW + 120 * 60_000 + SERVICE_TIME_S * 1000)
  })

  it('records the first broken window and still reports a finishing time', () => {
    const run = makeRun({
      sequence: ['run-a-1', 'run-a-2'],
      windows: { 'run-a-2': window(-240, -120) },
    })
    const projection = projectSequence(run, run.sequence, NOW)

    expect(projection.feasible).toBe(false)
    expect(projection.failure).toEqual({ kind: 'window', nodeId: 'run-a-2' })
    expect(projection.stops[1].missed).toBe(true)
    // total-ness: a broken window does not stop the arithmetic
    expect(projection.endsAtMs).toBeGreaterThan(NOW)
  })

  it('flags a run that cannot be back before the depot closes', () => {
    const run = makeRun({ sequence: ['run-a-3', 'run-b-1'], shiftEndMs: NOW + 60_000 })
    const projection = projectSequence(run, run.sequence, NOW)
    expect(projection.feasible).toBe(false)
    expect(projection.failure).toEqual({ kind: 'shift', nodeId: null })
  })

  it('uses what is LEFT of the current leg for a van already rolling', () => {
    const run = makeRun({ sequence: ['run-a-1', 'run-a-2'], inTransitS: 12 })
    const projection = projectSequence(run, run.sequence, NOW)
    expect(projection.stops[0].arriveMs).toBe(NOW + 12_000)
    // and the full leg for a van still parked
    const parked = projectSequence(makeRun(), makeRun().sequence, NOW)
    expect(parked.stops[0].arriveMs).toBe(NOW + drive(DEPOT_NODE, 'run-a-1') * 1000)
  })
})

describe('canFitToday — the accepting case', () => {
  it('accepts a provably-fitting insertion, at the cheapest position, with sane added time', () => {
    const run = makeRun({ sequence: ['run-a-1', 'run-a-2', 'run-a-4'] })
    const result = canFitToday('run-c-1', run, NOW)

    expect(result.fits).toBe(true)
    expect(result.runId).toBe('run-fixture')
    expect(result.insertAt).toBeGreaterThanOrEqual(0)
    expect(result.insertAt).toBeLessThanOrEqual(3)
    expect(result.addedS).toBeGreaterThan(0)
    expect(result.reason).toMatch(/^Fits as stop \d+ — adds about \d+ min\.$/)

    // the reported cost is the real one...
    const baseline = projectSequence(run, run.sequence, NOW).endsAtMs
    const chosen = [
      ...run.sequence.slice(0, result.insertAt),
      'run-c-1',
      ...run.sequence.slice(result.insertAt),
    ]
    expect(result.addedS).toBeCloseTo(
      (projectSequence(run, chosen, NOW).endsAtMs - baseline) / 1000,
      6,
    )
    // ...and no other position is cheaper
    for (let k = 0; k <= run.sequence.length; k++) {
      const candidate = [...run.sequence.slice(0, k), 'run-c-1', ...run.sequence.slice(k)]
      const added = (projectSequence(run, candidate, NOW).endsAtMs - baseline) / 1000
      expect(result.addedS).toBeLessThanOrEqual(added + 1e-9)
    }
  })

  it('adds a first stop to an empty run', () => {
    const run = makeRun({ sequence: [] })
    const result = canFitToday('run-b-1', run, NOW)
    expect(result.fits).toBe(true)
    expect(result.insertAt).toBe(0)
    expect(result.addedS).toBeCloseTo(
      drive(DEPOT_NODE, 'run-b-1') + SERVICE_TIME_S + drive('run-b-1', DEPOT_NODE),
      6,
    )
  })

  it('treats a stop with no window at all as unconstrained, not impossible', () => {
    const run = makeRun({ sequence: ['run-a-1'] })
    delete run.windows['run-c-3']
    expect(canFitToday('run-c-3', run, NOW).fits).toBe(true)
  })
})

describe('canFitToday — the refusing cases', () => {
  it('refuses an order whose own window has already closed', () => {
    const run = makeRun({
      sequence: ['run-a-1', 'run-a-2'],
      windows: { 'run-c-1': window(-300, -180) },
      labels: { 'run-c-1': 'Priya N.' },
    })

    const result = canFitToday('run-c-1', run, NOW)

    expect(result.fits).toBe(false)
    expect(result.insertAt).toBe(-1)
    expect(result.addedS).toBe(0)
    expect(result.reason).toContain('Does not fit today')
    expect(result.reason).toContain('Priya N.')
    expect(result.reason).toContain('First window tomorrow')
  })

  it('refuses the positions that would push an EXISTING customer past their window', () => {
    /*
     * run-a-1's window closes a minute after the van could reach it directly, so
     * serving it first works and serving it second cannot. The new order's own
     * window is wide open — the only thing able to refuse position 0 here is the
     * promise already made to run-a-1.
     */
    const direct = drive(DEPOT_NODE, 'run-a-1')
    const run = makeRun({
      sequence: ['run-a-1', 'run-a-2'],
      windows: { 'run-a-1': window(-60, Math.ceil(direct / 60) + 1) },
    })

    const pushedIn = projectSequence(run, ['run-c-1', 'run-a-1', 'run-a-2'], NOW)
    expect(pushedIn.feasible).toBe(false)
    expect(pushedIn.failure).toEqual({ kind: 'window', nodeId: 'run-a-1' })

    const result = canFitToday('run-c-1', run, NOW)
    expect(result.fits).toBe(true)
    expect(result.insertAt).toBeGreaterThanOrEqual(1)
  })

  it('refuses outright when EVERY position breaks something', () => {
    const direct = drive(DEPOT_NODE, 'run-a-1')
    const run = makeRun({
      sequence: ['run-a-1'],
      // run-a-1 can only be made as the first stop, and nothing may follow it
      // before the depot closes
      windows: { 'run-a-1': window(-60, Math.ceil(direct / 60) + 1) },
      shiftEndMs: NOW + (direct + SERVICE_TIME_S + drive('run-a-1', DEPOT_NODE) + 60) * 1000,
      labels: { 'run-a-1': 'Dana W.' },
    })

    // the run as it stands is fine — it is the insertion that is impossible
    expect(projectSequence(run, run.sequence, NOW).feasible).toBe(true)

    const result = canFitToday('run-c-1', run, NOW)
    expect(result.fits).toBe(false)
    expect(result.insertAt).toBe(-1)
    expect(result.addedS).toBe(0)
    expect(result.reason).toContain('Does not fit today')
  })

  it('refuses to insert ahead of a van already committed to its next leg', () => {
    const parked = makeRun({ sequence: ['run-a-1', 'run-a-2'] })

    // find an order the parked van would genuinely serve first...
    const candidate = STOP_NODE_IDS.find(
      (id) => !parked.sequence.includes(id) && canFitToday(id, parked, NOW).insertAt === 0,
    )
    expect(candidate, 'no candidate is cheapest at position 0 — fixture is not exercising the rule')
      .toBeDefined()

    // ...and confirm a rolling van is not allowed to take that shortcut
    const rolling: PlanRunInput = { ...parked, inTransitS: 30 }
    const result = canFitToday(candidate!, rolling, NOW)
    expect(result.fits).toBe(true)
    expect(result.insertAt).toBeGreaterThanOrEqual(1)
  })

  it('refuses an order already on the run instead of routing to it twice', () => {
    const run = makeRun({ sequence: ['run-a-1', 'run-a-2'], labels: { 'run-a-1': 'Dana W.' } })
    const result = canFitToday('run-a-1', run, NOW)
    expect(result.fits).toBe(false)
    expect(result.insertAt).toBe(-1)
    expect(result.reason).toContain('already on this run')
  })

  it('refuses an address the fleet cannot route to, and refuses the depot', () => {
    const run = makeRun()
    expect(canFitToday('ghost', run, NOW).fits).toBe(false)
    expect(canFitToday('ghost', run, NOW).reason).toContain('not an address this fleet can route to')
    expect(canFitToday(DEPOT_NODE, run, NOW).fits).toBe(false)
  })
})

describe('window parsing edges', () => {
  it('reads a window crossing midnight as overnight, not as a negative span', () => {
    // A moment whose LOCAL clock reads 11:05 PM, whatever timezone this runs in.
    const marker = new Date('2026-08-02T12:00:00.000Z')
    marker.setHours(23, 0, 0, 0)
    const elevenPm = marker.getTime()
    const nowMs = elevenPm + 5 * 60_000

    const run: PlanRunInput = {
      runId: 'overnight',
      fromNodeId: DEPOT_NODE,
      sequence: ['run-a-1'],
      windows: { 'run-a-1': [formatClock(elevenPm), formatClock(elevenPm + 120 * 60_000)] },
      shiftEndMs: nowMs + 6 * 3_600_000,
    }

    expect(run.windows['run-a-1']).toEqual(['11:00 PM', '1:00 AM'])

    const projection = projectSequence(run, run.sequence, nowMs)
    // arrival is a few minutes after 11:05 PM — inside the window. Treating the
    // end as 1:00 AM on the SAME day would put it 22 hours in the past.
    expect(projection.stops[0].missed).toBe(false)
    expect(projection.feasible).toBe(true)
  })
})
