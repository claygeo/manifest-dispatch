/**
 * Plan -> run -> driving.
 *
 * The claim the `/plan` page makes is that dispatch produces a REAL run, not a
 * mock-up: same store, same actions, same sim engine, same console. This file is
 * what makes that claim checkable — it dispatches a sequence and then drives it
 * to completion through the actual engine, on the same hand-cranked frame clock
 * the rest of the suite uses.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { useStore, runIdOf } from '../store'
import { shortName } from '../format'
import { parseClock } from '../window'
import { legsFor, hasRegisteredLegs } from '../data/seed'
import { legsForSequence, durationOf, stopForNode } from '../routing/matrix'
import { suggestSequence } from '../routing/optimize'
import { dispatchPlannedRun, poolOrders, shiftEndMs, windowsOf, labelsOf } from './planRun'
import { mountEngine, resetStore, FIXED_NOW, type EngineHarness } from '../test/harness'

let harness: EngineHarness | null = null

afterEach(() => {
  harness?.dispose()
  harness = null
})

function pool(nowMs: number = useStore.getState().simNowMs) {
  return poolOrders(useStore.getState().stops, nowMs)
}

describe('the order pool', () => {
  it('offers every routable stop, read from the seeded fleet', () => {
    resetStore()
    const orders = pool()
    expect(orders).toHaveLength(11)
    for (const order of orders) {
      expect(stopForNode(order.nodeId)).toBe(order.sourceStopId)
      expect(order.orderCode).toMatch(/^MFST-\d+$/)
      expect(order.window[0]).toBeTruthy()
      expect(order.window[1]).toBeTruthy()
      expect(order.customer.length).toBeGreaterThan(0)
    }
  })

  it('anchors promised windows to the planning moment, not to fleet-seed time', () => {
    resetStore()
    const early = pool(FIXED_NOW)
    const later = pool(FIXED_NOW + 3 * 3_600_000)

    // same customers, moved-on promises
    expect(later.map((o) => o.customer)).toEqual(early.map((o) => o.customer))
    expect(later.map((o) => o.window)).not.toEqual(early.map((o) => o.window))

    // deterministic: the same planning moment always yields the same windows
    expect(pool(FIXED_NOW).map((o) => o.window)).toEqual(early.map((o) => o.window))

    // every window opens before it closes, measured through the real parser
    for (const order of early) {
      const open = parseClock(order.window[0], FIXED_NOW)
      const close = parseClock(order.window[1], FIXED_NOW)
      expect(close).toBeGreaterThan(open)
    }
  })

  it('spreads the windows so feasibility can honestly answer both ways', () => {
    resetStore()
    const orders = pool(FIXED_NOW)
    const spans = orders.map(
      (o) => parseClock(o.window[1], FIXED_NOW) - parseClock(o.window[0], FIXED_NOW),
    )
    const closesFromNow = orders.map((o) => parseClock(o.window[1], FIXED_NOW) - FIXED_NOW)

    expect(new Set(spans).size).toBeGreaterThan(1)
    // at least one window is tight enough that a full run cannot absorb it...
    expect(Math.min(...closesFromNow)).toBeLessThan(90 * 60_000)
    // ...and at least one is comfortably open
    expect(Math.max(...closesFromNow)).toBeGreaterThan(150 * 60_000)
  })

  it('exposes windows and labels keyed the way the feasibility check wants them', () => {
    resetStore()
    const orders = pool()
    const windows = windowsOf(orders)
    const labels = labelsOf(orders)
    for (const order of orders) {
      expect(windows[order.nodeId]).toEqual(order.window)
      // shortened — a planning screen never carries a full surname
      expect(labels[order.nodeId]).toBe(shortName(order.customer))
      expect(labels[order.nodeId]).not.toBe(order.customer)
    }
  })

  it('puts the depot cutoff at least three hours out, whenever the demo is opened', () => {
    const lateNight = Date.parse('2026-08-02T23:45:00.000Z')
    expect(shiftEndMs(lateNight)).toBeGreaterThanOrEqual(lateNight + 3 * 3_600_000)
    expect(shiftEndMs(FIXED_NOW)).toBeGreaterThan(FIXED_NOW)
  })
})

describe('dispatching a planned run', () => {
  it('creates a real run with real stops and leaves the seeded fleet alone', () => {
    resetStore()
    const before = useStore.getState()
    const seededRunIds = [...before.runOrder]
    const seededStopCount = Object.keys(before.stops).length

    const sequence = suggestSequence(['run-a-1', 'run-c-2', 'run-b-3']).sequence
    const dispatched = dispatchPlannedRun(sequence, pool(), { suggestedS: 0, naiveS: 0 })

    const state = useStore.getState()
    const run = state.runs[dispatched.runId]

    expect(run).toBeDefined()
    expect(state.runOrder).toEqual([...seededRunIds, dispatched.runId])
    expect(run.stops).toHaveLength(3)
    expect(Object.keys(state.stops)).toHaveLength(seededStopCount + 3)

    // the seeded runs are untouched
    for (const id of seededRunIds) {
      expect(state.runs[id].stops).toEqual(before.runs[id].stops)
    }

    // stop ids follow the `${runId}-${n}` convention the whole app reverses
    run.stops.forEach((stopId, i) => {
      expect(stopId).toBe(`${dispatched.runId}-${i + 1}`)
      expect(runIdOf(stopId)).toBe(dispatched.runId)
      expect(state.stops[stopId].status).not.toBe('delivered')
    })

    expect(run.manifestId).toMatch(/^MAN-\d{4}-\d{4}-P\d+$/)
  })

  it('copies the pooled order rather than hijacking the one already on the board', () => {
    resetStore()
    const orders = pool()
    const source = orders.find((o) => o.nodeId === 'run-b-1')!
    const dispatched = dispatchPlannedRun(['run-b-1'], orders, { suggestedS: 0, naiveS: 0 })

    const state = useStore.getState()
    const planned = state.stops[dispatched.stopIds[0]]
    const original = state.stops[source.sourceStopId]

    expect(planned.customer).toBe(original.customer)
    expect(planned.address).toBe(original.address)
    // the planned order carries the window it was promised in the planner
    expect(planned.window).toEqual(source.window)
    expect(planned.id).not.toBe(original.id)
    expect(planned.orderCode).not.toBe(original.orderCode)
    // the original order is still exactly where it was
    expect(state.runs['run-b'].stops).toContain(source.sourceStopId)
  })

  it('mints order codes that are unique across the whole board', () => {
    resetStore()
    dispatchPlannedRun(['run-a-1', 'run-a-2'], pool(), { suggestedS: 0, naiveS: 0 })
    dispatchPlannedRun(['run-a-1', 'run-a-2'], pool(), { suggestedS: 0, naiveS: 0 })

    const codes = Object.values(useStore.getState().stops).map((s) => s.orderCode)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('registers matrix legs for the run, index-aligned with its stops', () => {
    resetStore()
    const sequence = ['run-c-1', 'run-a-4', 'run-b-2']
    const dispatched = dispatchPlannedRun(sequence, pool(), { suggestedS: 0, naiveS: 0 })

    expect(hasRegisteredLegs(dispatched.runId)).toBe(true)

    const legs = legsFor(dispatched.runId)
    const expected = legsForSequence(sequence)

    expect(legs).toHaveLength(sequence.length + 1)
    expect(legs.map((l) => l.duration_s)).toEqual(expected.map((l) => l.duration_s))
    expect(legs.reduce((t, l) => t + l.duration_s, 0)).toBe(durationOf(sequence))
    // prepared legs carry usable geometry, not empty stubs
    for (const leg of legs) {
      expect(leg.coords.length).toBeGreaterThanOrEqual(2)
      expect(leg.length).toBeGreaterThan(0)
    }
  })

  it('writes the audit line SPEC asks for — what was suggested, what was sent', () => {
    resetStore()
    const suggestion = suggestSequence(['run-a-1', 'run-c-2', 'run-b-3'])
    // deliberately override the suggestion: swap the first two stops
    const mine = [suggestion.sequence[1], suggestion.sequence[0], ...suggestion.sequence.slice(2)]

    const dispatched = dispatchPlannedRun(mine, pool(), {
      suggestedS: suggestion.suggestedS,
      naiveS: suggestion.naiveS,
    })

    const note = useStore
      .getState()
      .events.find((e) => e.runId === dispatched.runId && e.type === 'note')

    expect(note).toBeDefined()
    expect(note!.meta?.message).toContain('PLANNED')
    expect(note!.meta?.manifest).toBe(dispatched.manifestId)
    expect(note!.meta?.stops).toBe('3')
    expect(note!.meta?.suggested).toMatch(/^\d+ MIN$/)
    expect(note!.meta?.planned).toMatch(/^\d+ MIN$/)
  })

  it('records an accepted suggestion as accepted', () => {
    resetStore()
    const suggestion = suggestSequence(['run-a-1', 'run-c-2', 'run-b-3'])
    const dispatched = dispatchPlannedRun(suggestion.sequence, pool(), {
      suggestedS: suggestion.suggestedS,
      naiveS: suggestion.naiveS,
    })
    const note = useStore
      .getState()
      .events.find((e) => e.runId === dispatched.runId && e.type === 'note')
    expect(note!.meta?.message).toBe('PLANNED — DISPATCHER ACCEPTED SUGGESTED ORDER')
  })

  it('rolls the run immediately — dispatched means dispatched', () => {
    resetStore()
    const dispatched = dispatchPlannedRun(['run-a-1', 'run-b-4'], pool(), {
      suggestedS: 0,
      naiveS: 0,
    })
    const state = useStore.getState()
    expect(state.runs[dispatched.runId].status).toBe('active')
    expect(state.stops[dispatched.stopIds[0]].status).toBe('enroute')
    expect(
      state.events.some((e) => e.runId === dispatched.runId && e.type === 'run_started'),
    ).toBe(true)
  })

  it('refuses to dispatch nothing', () => {
    resetStore()
    expect(() => dispatchPlannedRun([], pool(), { suggestedS: 0, naiveS: 0 })).toThrow(
      /cannot dispatch an empty run/,
    )
  })
})

describe('the sim engine drives it', () => {
  it('adopts a run that appears mid-session without disturbing the ones already moving', () => {
    resetStore()
    harness = mountEngine()
    harness.run(4)

    const beforeIds = [...useStore.getState().runOrder]
    const movingBefore = beforeIds.map((id) => useStore.getState().runs[id].progress)

    const dispatched = dispatchPlannedRun(['run-a-1', 'run-c-3'], pool(), {
      suggestedS: 0,
      naiveS: 0,
    })

    harness.run(8)
    const state = useStore.getState()

    // the newcomer is being driven
    expect(state.runs[dispatched.runId].progress).toBeGreaterThan(0)
    // and none of the incumbents were thrown back to the start
    beforeIds.forEach((id, i) => {
      const run = state.runs[id]
      if (run.status !== 'active') return
      expect(run.currentLeg > 0 || run.progress >= movingBefore[i]).toBe(true)
    })
  })

  it('drives a planned run to completion along its matrix legs', () => {
    resetStore()
    harness = mountEngine()

    const sequence = ['run-a-1', 'run-b-1']
    const dispatched = dispatchPlannedRun(sequence, pool(), { suggestedS: 0, naiveS: 0 })

    const finished = harness.runUntil(
      () => useStore.getState().runs[dispatched.runId]?.status === 'complete',
      12_000,
    )

    expect(finished, 'the planned run never completed').toBe(true)

    const state = useStore.getState()
    for (const stopId of dispatched.stopIds) {
      // every stop is closed out one way or the other — delivered, or a handled
      // exception (the engine's seeded ID-check failures are real outcomes)
      expect(['delivered', 'exception']).toContain(state.stops[stopId].status)
    }
    // it drove the legs it was given, in order
    expect(
      state.events.filter((e) => e.runId === dispatched.runId && e.type === 'departed'),
    ).toHaveLength(sequence.length + 1)
  }, 30_000)

  it('keeps the run drivable through the ladder the compliance rules require', () => {
    resetStore()
    harness = mountEngine()

    const dispatched = dispatchPlannedRun(['run-c-2'], pool(), { suggestedS: 0, naiveS: 0 })
    const stopId = dispatched.stopIds[0]

    harness.runUntil(() => {
      const status = useStore.getState().stops[stopId].status
      return status === 'delivered' || status === 'exception'
    }, 12_000)

    const events = useStore
      .getState()
      .events.filter((e) => e.stopId === stopId)
      .map((e) => e.type)

    expect(events[0]).toBe('departed')
    if (useStore.getState().stops[stopId].status === 'delivered') {
      // no close without a verified ID — the ladder, in order
      expect(events).toEqual(['departed', 'arrived', 'id_verified', 'closed'])
    } else {
      expect(events).toContain('id_failed')
      expect(events).not.toContain('closed')
    }
  }, 30_000)
})
