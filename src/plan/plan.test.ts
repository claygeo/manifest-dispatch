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
import { formatClock, shortName } from '../format'
import { parseClock } from '../window'
import { legsFor, hasRegisteredLegs } from '../data/seed'
import {
  DEPOT_NODE,
  legBetween,
  legsForSequence,
  durationOf,
  nodePosition,
  stopForNode,
} from '../routing/matrix'
import { suggestForSet, suggestSequence, totalDuration } from '../routing/optimize'
import { SERVICE_TIME_S } from '../routing/feasibility'
import {
  dispatchPlannedRun,
  poolOrders,
  restorePlannedRun,
  shiftEndMs,
  windowRisks,
  windowsOf,
  labelsOf,
  type PoolOrder,
} from './planRun'
import { compare, displayMinutes, formatDeltaMinutes, formatMinutes } from './display'
import { mountEngine, resetStore, FIXED_NOW, type EngineHarness } from '../test/harness'

let harness: EngineHarness | null = null

afterEach(() => {
  harness?.dispose()
  harness = null
})

function pool(nowMs: number = useStore.getState().simNowMs) {
  return poolOrders(nowMs)
}

/** Every order code currently on the dispatch board. */
function boardCodes(): Set<string> {
  return new Set(Object.values(useStore.getState().stops).map((s) => s.orderCode))
}

describe('the order pool', () => {
  it('offers one practice order per routable doorstep', () => {
    resetStore()
    const orders = pool()
    expect(orders).toHaveLength(11)
    for (const order of orders) {
      // routable: every node the pool offers is one the matrix can price
      expect(stopForNode(order.nodeId)).toBeTruthy()
      expect(order.lngLat).toEqual(nodePosition(order.nodeId))
      expect(order.orderCode).toMatch(/^MFST-\d+$/)
      expect(order.window[0]).toBeTruthy()
      expect(order.window[1]).toBeTruthy()
      expect(order.customer.length).toBeGreaterThan(0)
      expect(order.address.length).toBeGreaterThan(0)
    }
    expect(new Set(orders.map((o) => o.nodeId)).size).toBe(orders.length)
  })

  /**
   * The credibility bug this pool was rebuilt for: it used to be a READ of the
   * seeded fleet, so MFST-4105 could be "Delivered, cash $79.25" on /dispatch
   * and "unrouted, packed" on /plan at the same moment, in a different delivery
   * window. Two states for one order, on a product whose claim is that there is
   * only ever one.
   */
  it('is disjoint from the dispatch board — no shared codes, no shared customers', () => {
    resetStore()
    const orders = pool()
    const codes = boardCodes()
    const customers = new Set(Object.values(useStore.getState().stops).map((s) => s.customer))

    // the board is actually populated, or this test proves nothing
    expect(codes.size).toBeGreaterThanOrEqual(11)

    for (const order of orders) {
      expect(codes.has(order.orderCode), `${order.orderCode} is on the board too`).toBe(false)
      expect(customers.has(order.customer), `${order.customer} is on the board too`).toBe(false)
      // and short names too — "Dana W." twice would put the confusion straight back
      expect([...customers].some((c) => shortName(c) === shortName(order.customer))).toBe(false)
    }

    // unique within the pool as well
    expect(new Set(orders.map((o) => o.orderCode)).size).toBe(orders.length)
  })

  it('keeps the two code series apart by construction, not by luck', () => {
    resetStore()
    // the fleet seeds MFST-41xx/42xx...
    for (const code of boardCodes()) {
      expect(code).toMatch(/^MFST-4[12]\d\d$/)
    }
    // ...and the practice pool lives in its own MFST-43xx block
    for (const order of pool()) {
      expect(order.orderCode).toMatch(/^MFST-43\d\d$/)
    }
  })

  it('survives a fleet reset without inheriting the new generation of codes', () => {
    resetStore()
    const first = pool(FIXED_NOW).map((o) => o.orderCode)
    resetStore(1, FIXED_NOW)
    const second = pool(FIXED_NOW).map((o) => o.orderCode)

    expect(second).toEqual(first)
    const codes = boardCodes()
    for (const code of second) expect(codes.has(code)).toBe(false)
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

/* ------------------------------------------------- window risk on reorder -- */

/** Replace the promised windows on named nodes; every other order stays as-is. */
function poolWithWindows(
  overrides: Record<string, [string, string]>,
  nowMs: number,
): PoolOrder[] {
  return poolOrders(nowMs).map((o) => (overrides[o.nodeId] ? { ...o, window: overrides[o.nodeId] } : o))
}

/**
 * Kerb arrival times, re-derived BY HAND from the leg matrix and the service
 * constant rather than by calling `projectSequence` — so these tests check the
 * projection instead of restating it. Valid only while no window opens after
 * its own arrival (no waiting), which every fixture below guarantees by opening
 * each window an hour in the past.
 */
function arrivalsBySequence(sequence: string[], nowMs: number): number[] {
  const out: number[] = []
  let t = nowMs
  let prev = DEPOT_NODE
  for (const node of sequence) {
    t += legBetween(prev, node).duration_s * 1000
    out.push(t)
    t += SERVICE_TIME_S * 1000
    prev = node
  }
  return out
}

describe('a manual reorder that blows a window says so', () => {
  /**
   * The gap this closes: the late-order path already refused a window-breaking
   * insertion, and the front page promises "amber before miss" — but a manual
   * nudge reported only the drive-time delta. A dispatcher could demote a stop
   * past its own promised window and the screen's entire response was "+11 min".
   */
  const PICKS = ['run-a-3', 'run-b-4', 'run-c-2']

  /** Windows that the SUGGESTED order keeps, with two minutes of slack each. */
  function tightFixture(nowMs: number) {
    const suggested = suggestForSet(PICKS).sequence
    const arrivals = arrivalsBySequence(suggested, nowMs)
    const opens = formatClock(nowMs - 60 * 60_000)
    const overrides: Record<string, [string, string]> = {}
    suggested.forEach((node, i) => {
      overrides[node] = [opens, formatClock(arrivals[i] + 120_000)]
    })
    return { suggested, overrides, pool: poolWithWindows(overrides, nowMs) }
  }

  it('leaves the suggested order clean — the proposal keeps the promises', () => {
    const { suggested, pool: fixture } = tightFixture(FIXED_NOW)
    expect(windowRisks(suggested, fixture, FIXED_NOW)).toEqual([])
  })

  it('flags exactly the stops a hand-computed projection says are late', () => {
    const { suggested, overrides, pool: fixture } = tightFixture(FIXED_NOW)

    // the dispatcher's own order: the proposal, reversed
    const mine = [...suggested].reverse()
    const arrivals = arrivalsBySequence(mine, FIXED_NOW)
    const expected = mine.filter(
      (node, i) => arrivals[i] > parseClock(overrides[node][1], FIXED_NOW),
    )

    // the fixture has to actually bite, or this asserts nothing
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(mine.length)

    expect(windowRisks(mine, fixture, FIXED_NOW).map((r) => r.nodeId)).toEqual(expected)
  })

  it('names both clock times, projection first', () => {
    const closes = formatClock(FIXED_NOW - 30 * 60_000)
    const fixture = poolWithWindows(
      { 'run-a-1': [formatClock(FIXED_NOW - 120 * 60_000), closes] },
      FIXED_NOW,
    )
    const risks = windowRisks(['run-a-1'], fixture, FIXED_NOW)

    expect(risks).toHaveLength(1)
    expect(risks[0].closes).toBe(closes)
    expect(risks[0].reason).toBe(`projected ${risks[0].projected} — window ends ${closes}`)
    // and the projection really is after the promise
    expect(parseClock(risks[0].projected, FIXED_NOW)).toBeGreaterThan(
      parseClock(closes, FIXED_NOW),
    )
  })

  it('treats arriving early as a wait, not a miss', () => {
    // a window that opens in two hours and closes in four: the van waits
    const fixture = poolWithWindows(
      {
        'run-a-1': [
          formatClock(FIXED_NOW + 120 * 60_000),
          formatClock(FIXED_NOW + 240 * 60_000),
        ],
      },
      FIXED_NOW,
    )
    expect(windowRisks(['run-a-1'], fixture, FIXED_NOW)).toEqual([])
  })

  it('has nothing to say about an empty run', () => {
    expect(windowRisks([], poolOrders(FIXED_NOW), FIXED_NOW)).toEqual([])
  })

  it('leaves the drive-time comparison alone — the two readings are independent', () => {
    const { suggested, pool: fixture } = tightFixture(FIXED_NOW)
    const mine = [...suggested].reverse()
    const suggestedS = suggestForSet(PICKS).suggestedS

    const flagged = compare(totalDuration(mine), suggestedS)
    const clean = compare(totalDuration(suggested), suggestedS)

    // the flagged order still reports its real cost, and it still adds up
    expect(windowRisks(mine, fixture, FIXED_NOW).length).toBeGreaterThan(0)
    expect(flagged.deltaMin).toBe(flagged.yoursMin - flagged.suggestedMin)
    expect(clean.deltaMin).toBe(0)

    // widening every window changes the flags and nothing else about the figures
    const loose = poolWithWindows(
      Object.fromEntries(
        suggested.map((node) => [
          node,
          [formatClock(FIXED_NOW - 60 * 60_000), formatClock(FIXED_NOW + 300 * 60_000)] as [
            string,
            string,
          ],
        ]),
      ),
      FIXED_NOW,
    )
    expect(windowRisks(mine, loose, FIXED_NOW)).toEqual([])
    expect(compare(totalDuration(mine), suggestedS)).toEqual(flagged)
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

  it('carries the practice order onto the board without touching the seeded one', () => {
    resetStore()
    const orders = pool()
    const source = orders.find((o) => o.nodeId === 'run-b-1')!
    const seededStopId = stopForNode('run-b-1')!
    const before = { ...useStore.getState().stops[seededStopId] }

    const dispatched = dispatchPlannedRun(['run-b-1'], orders, { suggestedS: 0, naiveS: 0 })

    const state = useStore.getState()
    const planned = state.stops[dispatched.stopIds[0]]

    // it is the PRACTICE order that got dispatched, not the board's
    expect(planned.customer).toBe(source.customer)
    expect(planned.address).toBe(source.address)
    expect(planned.window).toEqual(source.window)
    expect(planned.customer).not.toBe(before.customer)
    expect(planned.orderCode).not.toBe(before.orderCode)
    // and it gets its own code even so — the pool code never lands on the board
    expect(planned.orderCode).not.toBe(source.orderCode)
    expect(Object.values(state.stops).some((s) => s.orderCode === source.orderCode)).toBe(false)

    // the seeded stop is untouched, in place, same everything
    expect(state.stops[seededStopId]).toEqual(before)
    expect(state.runs['run-b'].stops).toContain(seededStopId)
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

/* --------------------------------------------- the planner's own bookmark -- */

/**
 * The bug: `/plan` held its dispatched run in component state only. Click
 * through to `/dispatch` to watch the run drive, come back, and the planner
 * remounted blank — a fresh order pool and no watch panel — while the run it
 * had just built was still crossing the map behind it. The run was never lost;
 * the pointer to it was.
 *
 * A component test would prove the panel renders. What actually has to hold is
 * that the pointer survives an unmount (it is store state, so it does), that it
 * round-trips back into the same handle `dispatchPlannedRun` returned, and that
 * a fleet reset takes it with the run rather than leaving the planner holding
 * an id nothing answers to.
 */
describe('the dispatched run survives leaving the planner', () => {
  it('bookmarks the run in the store, not in the component', () => {
    resetStore()
    expect(useStore.getState().plannedRunId).toBeNull()

    const dispatched = dispatchPlannedRun(['run-a-1', 'run-b-2'], pool(), {
      suggestedS: 0,
      naiveS: 0,
    })

    expect(useStore.getState().plannedRunId).toBe(dispatched.runId)
  })

  it('round-trips into the same handle the dispatch returned', () => {
    resetStore()
    const dispatched = dispatchPlannedRun(['run-c-1', 'run-a-3'], pool(), {
      suggestedS: 0,
      naiveS: 0,
    })

    // what PlanPage does on mount
    const restored = restorePlannedRun(useStore.getState())

    expect(restored).toEqual(dispatched)
  })

  it('follows the newest build when a second run is dispatched', () => {
    resetStore()
    dispatchPlannedRun(['run-a-1'], pool(), { suggestedS: 0, naiveS: 0 })
    const second = dispatchPlannedRun(['run-b-1'], pool(), { suggestedS: 0, naiveS: 0 })

    expect(useStore.getState().plannedRunId).toBe(second.runId)
    expect(restorePlannedRun(useStore.getState())?.runId).toBe(second.runId)
  })

  it('is cleared by a fleet reset, along with the run it pointed at', () => {
    resetStore()
    const dispatched = dispatchPlannedRun(['run-a-1'], pool(), { suggestedS: 0, naiveS: 0 })

    useStore.getState().resetFleet()

    expect(useStore.getState().runs[dispatched.runId]).toBeUndefined()
    expect(useStore.getState().plannedRunId).toBeNull()
    expect(restorePlannedRun(useStore.getState())).toBeNull()
  })

  it('refuses to restore a pointer whose run is gone, rather than half a panel', () => {
    resetStore()
    // the state a reset between visits would leave behind if the store field
    // and the run were ever cleared separately
    useStore.getState().setPlannedRun('plan-vanished')

    expect(restorePlannedRun(useStore.getState())).toBeNull()
    expect(restorePlannedRun({ plannedRunId: null, runs: useStore.getState().runs })).toBeNull()
  })

  it('lets the planner drop the bookmark when the visitor plans another', () => {
    resetStore()
    dispatchPlannedRun(['run-a-1'], pool(), { suggestedS: 0, naiveS: 0 })

    useStore.getState().setPlannedRun(null)

    expect(useStore.getState().plannedRunId).toBeNull()
    expect(restorePlannedRun(useStore.getState())).toBeNull()
    // the run itself is untouched — it is still driving on every other surface
    expect(useStore.getState().runOrder).toHaveLength(4)
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

/* ------------------------------------------------ the comparison footer -- */

/** Read a rendered '38 min' back as the integer a person sees. */
function readMinutes(label: string): number {
  const m = /^(\d+) min$/.exec(label)
  if (!m) throw new Error(`'${label}' is not a minutes figure`)
  return Number(m[1])
}

/** Read a rendered '+12 min' / '-3 min' / 'same' back as the integer a person sees. */
function readDelta(label: string): number {
  if (label === 'same') return 0
  const m = /^([+-]\d+) min$/.exec(label)
  if (!m) throw new Error(`'${label}' is not a delta badge`)
  const value = Number(m[1])
  if (value === 0) throw new Error(`'${label}' renders zero as a signed quantity`)
  return value
}

describe('the comparison line reconciles', () => {
  it('renders a delta that is exactly the difference of the two figures it sits beside', () => {
    // a full sweep across the range the planner can actually produce: a
    // single-stop hop is ~5 min, eleven stops is a bit over an hour.
    // Mismatches are collected rather than asserted in the loop — one `expect`
    // per pair is what turns a fast sweep into a slow one.
    const broken: string[] = []
    let checked = 0
    for (let yoursS = 0; yoursS <= 4_500; yoursS += 7) {
      for (let suggestedS = 0; suggestedS <= 4_500; suggestedS += 11) {
        const c = compare(yoursS, suggestedS)
        const yours = readMinutes(c.yoursLabel)
        const suggested = readMinutes(c.suggestedLabel)
        const delta = readDelta(c.deltaLabel)
        if (delta !== yours - suggested) {
          broken.push(`${yoursS}s/${suggestedS}s -> ${yours} - ${suggested} = ${delta}`)
        }
        checked++
      }
    }
    expect(broken.slice(0, 5)).toEqual([])
    // the sweep really ran — an empty loop would pass silently
    expect(checked).toBeGreaterThan(100_000)
  })

  /**
   * The exact shape of the reported bug, pinned. Rounded independently these
   * seconds render 47 / 35 / +11; rounded once they render 47 / 35 / +12.
   */
  it('pins the reported case: 47 and 35 can only ever be 12 apart', () => {
    const yoursS = 2_795 // 46.58 min -> 47
    const suggestedS = 2_110 // 35.17 min -> 35
    // what the old code did: round the raw difference on its own
    expect(Math.round((yoursS - suggestedS) / 60)).toBe(11)

    const c = compare(yoursS, suggestedS)
    expect(c.yoursLabel).toBe('47 min')
    expect(c.suggestedLabel).toBe('35 min')
    expect(c.deltaLabel).toBe('+12 min')
    expect(c.deltaMin).toBe(c.yoursMin - c.suggestedMin)
  })

  it('calls a tie a tie rather than +0 min', () => {
    const c = compare(2_400, 2_390)
    expect(c.yoursLabel).toBe(c.suggestedLabel)
    expect(c.deltaLabel).toBe('same')
    expect(c.costsTime).toBe(false)
  })

  it('flags amber only when the dispatcher order costs whole displayed minutes', () => {
    // beating the suggestion is the point of the screen, never a warning
    expect(compare(2_100, 2_800).costsTime).toBe(false)
    expect(compare(2_100, 2_100).costsTime).toBe(false)
    expect(compare(2_800, 2_100).costsTime).toBe(true)
    // a difference too small to show is not something to act on
    expect(compare(2_410, 2_400).costsTime).toBe(false)
  })
})

describe('the minute helpers', () => {
  it('never renders a run that exists as zero minutes', () => {
    expect(displayMinutes(0)).toBe(1)
    expect(displayMinutes(29)).toBe(1)
    expect(displayMinutes(31)).toBe(1)
    expect(displayMinutes(90)).toBe(2)
    expect(formatMinutes(displayMinutes(0))).toBe('1 min')
  })

  it('keeps the floor from ever splitting a pair', () => {
    // both figures under a minute means both render 1 min and the delta is a tie
    const c = compare(12, 41)
    expect(c.yoursMin).toBe(1)
    expect(c.suggestedMin).toBe(1)
    expect(c.deltaLabel).toBe('same')
  })

  it('signs the delta the way a reader expects', () => {
    expect(formatDeltaMinutes(4)).toBe('+4 min')
    expect(formatDeltaMinutes(-4)).toBe('-4 min')
    expect(formatDeltaMinutes(0)).toBe('same')
  })
})
