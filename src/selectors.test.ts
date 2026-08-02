/**
 * Selectors — the shared reading of the fleet.
 *
 * The console, the driver app, the tracking card and the printed manifest all
 * read through this module so they cannot disagree about what "current stop"
 * or "2 STOPS AWAY" means. These tests run the selectors against the real store
 * (not a fixture object) so a change to the store's shape breaks here first.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { EXCEPTION_LABEL, useStore } from './store'
import {
  cancelledStopIds,
  currentStop,
  exceptionReasons,
  findStopByOrderCode,
  fleetCounts,
  recentEvents,
  runCounts,
  runOfStop,
  runStops,
  stopsAway,
} from './selectors'
import { resetStore } from './test/harness'

const s = () => useStore.getState()
const STAGED_RUN = 'run-b'

beforeEach(() => {
  resetStore()
})

describe('runStops', () => {
  it('follows the run’s own sequence, not the id order', () => {
    const original = [...s().runs[STAGED_RUN].stops]
    s().reorderStop(STAGED_RUN, original[2], -1)
    expect(runStops(s(), STAGED_RUN).map((stop) => stop.id)).toEqual(s().runs[STAGED_RUN].stops)
    expect(runStops(s(), STAGED_RUN)[1].id).toBe(original[2])
  })

  it('returns an empty list for an unknown run rather than throwing', () => {
    expect(runStops(s(), 'run-zzz')).toEqual([])
  })
})

describe('runOfStop', () => {
  it('recovers the run a stop belongs to', () => {
    expect(runOfStop(s(), 'run-a-1')?.id).toBe('run-a')
    expect(runOfStop(s(), 'run-zzz-1')).toBeUndefined()
  })
})

describe('currentStop', () => {
  it('is the first stop not yet closed out', () => {
    const stops = s().runs[STAGED_RUN].stops
    expect(currentStop(s(), STAGED_RUN)?.id).toBe(stops[0])
  })

  it('skips delivered AND excepted stops alike', () => {
    const stops = s().runs[STAGED_RUN].stops
    s().setStopStatus(stops[0], 'delivered')
    expect(currentStop(s(), STAGED_RUN)?.id).toBe(stops[1])
    s().setStopStatus(stops[1], 'exception')
    expect(currentStop(s(), STAGED_RUN)?.id).toBe(stops[2])
  })

  it('is null once every stop is off the queue', () => {
    for (const stopId of s().runs[STAGED_RUN].stops) s().setStopStatus(stopId, 'delivered')
    expect(currentStop(s(), STAGED_RUN)).toBeNull()
  })
})

describe('runCounts — the STOP 3/5 chip', () => {
  it('counts closed-out stops against the whole manifest', () => {
    const stops = s().runs[STAGED_RUN].stops
    expect(runCounts(s(), STAGED_RUN)).toEqual({ done: 0, total: stops.length })
    s().setStopStatus(stops[0], 'delivered')
    s().setStopStatus(stops[1], 'exception')
    expect(runCounts(s(), STAGED_RUN)).toEqual({ done: 2, total: stops.length })
  })

  it('never counts a stop the driver is still working', () => {
    const stops = s().runs[STAGED_RUN].stops
    for (const status of ['pending', 'enroute', 'arrived', 'id_check'] as const) {
      s().setStopStatus(stops[0], status)
      expect(runCounts(s(), STAGED_RUN).done).toBe(0)
    }
  })
})

describe('fleetCounts — the RUNS 2/3 ACTIVE chip', () => {
  it('reports active runs and open exceptions across the whole fleet', () => {
    const opening = fleetCounts(s())
    expect(opening.total).toBe(s().runOrder.length)
    expect(opening.active).toBe(2) // the SPEC opening stagger
    expect(opening.exceptions).toBe(0)

    s().startRun(STAGED_RUN)
    s().flagException(s().runs[STAGED_RUN].stops[1], 'no_answer')
    const after = fleetCounts(s())
    expect(after.active).toBe(3)
    expect(after.exceptions).toBe(1)
  })
})

describe('stopsAway — the tracking page chip', () => {
  it('counts the stops still to be served before this one', () => {
    const stops = s().runs[STAGED_RUN].stops
    expect(stopsAway(s(), stops[0])).toBe(0)
    expect(stopsAway(s(), stops[2])).toBe(2)
  })

  it('shrinks as stops are served, and floors at zero', () => {
    const stops = s().runs[STAGED_RUN].stops
    s().setStopStatus(stops[0], 'delivered')
    expect(stopsAway(s(), stops[2])).toBe(1)
    s().setStopStatus(stops[1], 'exception')
    expect(stopsAway(s(), stops[2])).toBe(0)
    s().setStopStatus(stops[2], 'delivered')
    expect(stopsAway(s(), stops[2])).toBe(0)
  })

  it('is null for a stop that belongs to nothing', () => {
    expect(stopsAway(s(), 'run-zzz-1')).toBeNull()
  })
})

describe('recentEvents — the console feed', () => {
  it('reads newest first', () => {
    s().logEvent({ runId: STAGED_RUN, stopId: null, type: 'note', meta: { message: 'first' } })
    s().logEvent({ runId: STAGED_RUN, stopId: null, type: 'note', meta: { message: 'second' } })
    const feed = recentEvents(s().events)
    expect(feed[0].meta?.message).toBe('second')
    expect(feed[1].meta?.message).toBe('first')
  })

  it('honours the limit and scopes to one run', () => {
    for (let i = 0; i < 30; i++) {
      s().logEvent({ runId: i % 2 === 0 ? 'run-a' : 'run-b', stopId: null, type: 'note' })
    }
    expect(recentEvents(s().events, { limit: 5 })).toHaveLength(5)
    const scoped = recentEvents(s().events, { runId: 'run-a', limit: 100 })
    expect(scoped.every((e) => e.runId === 'run-a')).toBe(true)
    expect(scoped.length).toBeGreaterThan(0)
  })

  it('is empty for a run with no history rather than undefined', () => {
    expect(recentEvents([], { runId: 'run-a' })).toEqual([])
  })
})

describe('findStopByOrderCode — the /t/:orderCode entry point', () => {
  it('resolves any seeded order code, case- and whitespace-insensitively', () => {
    const stop = Object.values(s().stops)[3]
    expect(findStopByOrderCode(s(), stop.orderCode)?.id).toBe(stop.id)
    expect(findStopByOrderCode(s(), `  ${stop.orderCode.toLowerCase()} `)?.id).toBe(stop.id)
  })

  it('returns null for a code that is not in this fleet', () => {
    expect(findStopByOrderCode(s(), 'MFST-0000')).toBeNull()
  })

  it('resolves every order code in the fleet — no tracking link is a dead link', () => {
    for (const stop of Object.values(s().stops)) {
      expect(findStopByOrderCode(s(), stop.orderCode)?.id).toBe(stop.id)
    }
  })
})

describe('exceptionReasons / cancelledStopIds', () => {
  it('reads the reason off the event log, since Stop carries no reason field', () => {
    s().startRun(STAGED_RUN)
    const [first, second] = s().runs[STAGED_RUN].stops
    s().flagException(first, 'no_answer')
    s().cancelStop(second)

    const reasons = exceptionReasons(s().events)
    expect(reasons[first]).toBe(EXCEPTION_LABEL.no_answer)
    expect(reasons[second]).toBe(EXCEPTION_LABEL.cancelled)

    const cancelled = cancelledStopIds(s().events, EXCEPTION_LABEL.cancelled)
    expect(cancelled.has(second)).toBe(true)
    expect(cancelled.has(first)).toBe(false)
  })

  it('picks up a failed ID check as well as a dispatcher flag', () => {
    s().startRun(STAGED_RUN)
    const stopId = s().runs[STAGED_RUN].stops[0]
    s().arriveStop(stopId)
    s().verifyId(stopId, false)
    expect(exceptionReasons(s().events)[stopId]).toBe(EXCEPTION_LABEL.cannot_verify)
  })

  it('lets the last flag win', () => {
    s().startRun(STAGED_RUN)
    const stopId = s().runs[STAGED_RUN].stops[0]
    s().flagException(stopId, 'no_answer')
    s().flagException(stopId, 'refused')
    expect(exceptionReasons(s().events)[stopId]).toBe(EXCEPTION_LABEL.refused)
  })

  it('ignores run-level events that carry no stop', () => {
    s().logEvent({ runId: STAGED_RUN, stopId: null, type: 'exception', meta: { reason: 'X' } })
    expect(Object.keys(exceptionReasons(s().events))).toHaveLength(0)
  })
})
