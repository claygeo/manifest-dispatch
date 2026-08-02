/**
 * Store — the compliance boundary.
 *
 * SPEC.md: "ID verification is a mandatory state between arrived and closed —
 * the driver cannot close a stop without it (the app enforces the law's shape)."
 * The store is where that enforcement lives, because the sim engine, the driver
 * app and the live Supabase engine all reach the fleet through these actions and
 * nothing else. A rule enforced in a component is a rule the other two engines
 * do not have.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { EXCEPTION_LABEL, runIdOf, useStore } from './store'
import { cancelledStopIds, currentStop, exceptionReasons, runCounts, stopsAway } from './selectors'
import { formatMoney, PAYMENT_LABEL } from './format'
import { FIXED_NOW, ladderFor, resetStore } from './test/harness'
import type { ExceptionReason, StopStatus } from './types'

const s = () => useStore.getState()

/** The staged run in the opening plan — the clean slate for ladder tests. */
const STAGED_RUN = 'run-b'

function stagedFirstStopId(): string {
  return s().runs[STAGED_RUN].stops[0]
}

/** Walk a stop all the way to delivered. Returns its id. */
function deliverFirstStop(payment?: 'cash' | 'debit' | 'digital'): string {
  const stopId = stagedFirstStopId()
  s().startRun(STAGED_RUN)
  s().arriveStop(stopId)
  s().verifyId(stopId, true)
  s().closeStop(stopId, payment)
  return stopId
}

beforeEach(() => {
  resetStore()
})

describe('the fleet boots consistently', () => {
  it('indexes every run and stop and keeps runOrder in step', () => {
    expect(s().runOrder).toEqual(Object.keys(s().runs))
    for (const runId of s().runOrder) {
      for (const stopId of s().runs[runId].stops) {
        expect(s().stops[stopId]).toBeDefined()
        expect(runIdOf(stopId)).toBe(runId)
      }
    }
  })

  it('anchors the sim clock to the fleet epoch', () => {
    expect(s().simNowMs).toBe(FIXED_NOW)
    expect(s().simEpoch).toBe(FIXED_NOW)
  })
})

describe('startRun', () => {
  it('opens a staged run, marks the first stop en route and logs the manifest', () => {
    const stopId = stagedFirstStopId()
    s().startRun(STAGED_RUN)
    expect(s().runs[STAGED_RUN].status).toBe('active')
    expect(s().stops[stopId].status).toBe('enroute')
    const events = s().events.filter((e) => e.runId === STAGED_RUN)
    expect(events.map((e) => e.type)).toEqual(['run_started', 'departed'])
    expect(events[0].meta?.manifest).toBe(s().runs[STAGED_RUN].manifestId)
    expect(events[1].meta?.to).toBe(s().stops[stopId].orderCode)
  })

  it('refuses to re-open a run that is already rolling', () => {
    s().startRun(STAGED_RUN)
    const before = s().events.length
    s().startRun(STAGED_RUN)
    expect(s().events.length).toBe(before)
  })

  it('refuses an unknown run rather than throwing', () => {
    expect(() => s().startRun('run-zzz')).not.toThrow()
    expect(s().events.filter((e) => e.runId === 'run-zzz')).toHaveLength(0)
  })

  it('does not resurrect a stop cancelled before dispatch', () => {
    const stopId = stagedFirstStopId()
    s().cancelStop(stopId)
    s().startRun(STAGED_RUN)
    // the van still rolls to that kerb — the next leg's polyline starts there —
    // but the order stays dead
    expect(s().stops[stopId].status).toBe('exception')
  })
})

describe('closeStop — the compliance invariant', () => {
  it('REFUSES to close a stop whose ID was never checked', () => {
    const stopId = stagedFirstStopId()
    s().startRun(STAGED_RUN)
    s().arriveStop(stopId)
    expect(s().stops[stopId].idChecked).toBe(false)

    s().closeStop(stopId, 'cash')

    expect(s().stops[stopId].status).toBe('arrived')
    expect(s().stops[stopId].closedAt).toBeNull()
    expect(ladderFor(stopId)).not.toContain('closed')
  })

  it('refuses at every point on the ladder before the ID check', () => {
    const stopId = stagedFirstStopId()
    for (const status of ['pending', 'enroute', 'arrived'] as StopStatus[]) {
      resetStore()
      s().setStopStatus(stopId, status)
      s().closeStop(stopId)
      expect(s().stops[stopId].status).toBe(status)
      expect(ladderFor(stopId)).not.toContain('closed')
    }
  })

  it('refuses forever after a FAILED ID check', () => {
    const stopId = stagedFirstStopId()
    s().startRun(STAGED_RUN)
    s().arriveStop(stopId)
    s().verifyId(stopId, false)

    s().closeStop(stopId, 'cash')
    s().closeStop(stopId, 'debit')

    expect(s().stops[stopId].status).toBe('exception')
    expect(s().stops[stopId].closedAt).toBeNull()
    expect(ladderFor(stopId)).not.toContain('closed')
  })

  it('closes once the ID is verified, and records money + method on the event', () => {
    const stopId = deliverFirstStop('debit')
    const stop = s().stops[stopId]
    expect(stop.status).toBe('delivered')
    expect(stop.payment).toBe('debit')
    expect(stop.closedAt).toBe(new Date(FIXED_NOW).toISOString())
    expect(stop.etaMin).toBeNull()

    const closed = s().events.find((e) => e.stopId === stopId && e.type === 'closed')!
    expect(closed.meta?.payment).toBe(PAYMENT_LABEL.debit)
    expect(closed.meta?.amount).toBe(formatMoney(stop.amountDue))
    expect(closed.at).toBe(stop.closedAt)
  })

  it('defaults to the order’s own payment method when none is passed', () => {
    const stopId = stagedFirstStopId()
    const original = s().stops[stopId].payment
    deliverFirstStop()
    expect(s().stops[stopId].payment).toBe(original)
  })

  it('will not close the same stop twice — one delivery, one line on the manifest', () => {
    const stopId = deliverFirstStop('cash')
    const closedAt = s().stops[stopId].closedAt

    s().closeStop(stopId, 'digital')

    expect(s().stops[stopId].closedAt).toBe(closedAt)
    expect(s().stops[stopId].payment).toBe('cash')
    expect(ladderFor(stopId).filter((t) => t === 'closed')).toHaveLength(1)
  })

  it('ignores an unknown stop id', () => {
    expect(() => s().closeStop('run-b-99')).not.toThrow()
  })
})

describe('verifyId', () => {
  it('pass: moves arrived -> id_check, sets idChecked and logs id_verified', () => {
    const stopId = stagedFirstStopId()
    s().startRun(STAGED_RUN)
    s().arriveStop(stopId)
    s().verifyId(stopId, true)

    expect(s().stops[stopId].status).toBe('id_check')
    expect(s().stops[stopId].idChecked).toBe(true)
    const event = s().events.find((e) => e.stopId === stopId && e.type === 'id_verified')!
    expect(event.meta?.order).toBe(s().stops[stopId].orderCode)
  })

  it('fail: moves the stop to exception, never to closed, and logs id_failed', () => {
    const stopId = stagedFirstStopId()
    s().startRun(STAGED_RUN)
    s().arriveStop(stopId)
    s().verifyId(stopId, false)

    expect(s().stops[stopId].status).toBe('exception')
    expect(s().stops[stopId].idChecked).toBe(false)
    const event = s().events.find((e) => e.stopId === stopId && e.type === 'id_failed')!
    expect(event.meta?.reason).toBe(EXCEPTION_LABEL.cannot_verify)
    expect(ladderFor(stopId)).toEqual(['departed', 'arrived', 'id_failed'])
  })

  it('cannot re-open a delivered stop', () => {
    const stopId = deliverFirstStop('cash')
    s().verifyId(stopId, false)
    expect(s().stops[stopId].status).toBe('delivered')
    expect(s().stops[stopId].idChecked).toBe(true)
    expect(ladderFor(stopId)).not.toContain('id_failed')
  })

  it('ignores an unknown stop id', () => {
    expect(() => s().verifyId('nope-1', true)).not.toThrow()
  })
})

describe('the full legal ladder', () => {
  it('emits departed -> arrived -> id_verified -> closed, in that order', () => {
    const stopId = deliverFirstStop('cash')
    expect(ladderFor(stopId)).toEqual(['departed', 'arrived', 'id_verified', 'closed'])
  })

  it('walks statuses pending -> enroute -> arrived -> id_check -> delivered', () => {
    const stopId = stagedFirstStopId()
    const seen: StopStatus[] = [s().stops[stopId].status]
    const record = () => seen.push(s().stops[stopId].status)

    s().startRun(STAGED_RUN)
    record()
    s().arriveStop(stopId)
    record()
    s().verifyId(stopId, true)
    record()
    s().closeStop(stopId, 'cash')
    record()

    expect(seen).toEqual(['pending', 'enroute', 'arrived', 'id_check', 'delivered'])
  })

  it('stamps every event on the sim clock, oldest last', () => {
    deliverFirstStop('cash')
    const times = s().events.map((e) => Date.parse(e.at))
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

describe('arriveStop and the delivery window', () => {
  it('logs a plain arrival while the window is still open', () => {
    const stopId = stagedFirstStopId()
    s().startRun(STAGED_RUN)
    s().arriveStop(stopId)
    const event = s().events.find((e) => e.stopId === stopId && e.type === 'arrived')!
    expect(event.meta?.window).toBeUndefined()
  })

  it('flags a late arrival on the event, and still lets the stop close', () => {
    const stopId = stagedFirstStopId()
    s().startRun(STAGED_RUN)
    // three hours past the two-hour window — reality beats theory in the field
    s().setSimNow(FIXED_NOW + 5 * 60 * 60_000)
    s().arriveStop(stopId)

    const event = s().events.find((e) => e.stopId === stopId && e.type === 'arrived')!
    expect(event.meta?.window).toMatch(/^LATE — WINDOW CLOSED /)

    s().verifyId(stopId, true)
    s().closeStop(stopId, 'cash')
    expect(s().stops[stopId].status).toBe('delivered')
  })
})

describe('reorderStop — staged runs only', () => {
  it('promotes a stop on a staged run and logs the resequence', () => {
    const before = [...s().runs[STAGED_RUN].stops]
    s().reorderStop(STAGED_RUN, before[1], -1)
    const after = s().runs[STAGED_RUN].stops
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[0])
    expect(after.slice(2)).toEqual(before.slice(2))

    const note = s().events.at(-1)!
    expect(note.type).toBe('note')
    expect(note.meta?.message).toBe('RESEQUENCED TO POSITION 1')
    expect(note.meta?.order).toBe(s().stops[before[1]].orderCode)
  })

  it('demotes in the other direction', () => {
    const before = [...s().runs[STAGED_RUN].stops]
    s().reorderStop(STAGED_RUN, before[0], 1)
    expect(s().runs[STAGED_RUN].stops[1]).toBe(before[0])
  })

  it('REFUSES once the run is active — the manifest is out with the driver', () => {
    const before = [...s().runs[STAGED_RUN].stops]
    s().startRun(STAGED_RUN)
    const eventCount = s().events.length

    s().reorderStop(STAGED_RUN, before[2], -1)

    expect(s().runs[STAGED_RUN].stops).toEqual(before)
    expect(s().events.length).toBe(eventCount)
  })

  it('refuses on a complete run', () => {
    const before = [...s().runs[STAGED_RUN].stops]
    s().startRun(STAGED_RUN)
    s().completeRun(STAGED_RUN)
    s().reorderStop(STAGED_RUN, before[1], -1)
    expect(s().runs[STAGED_RUN].stops).toEqual(before)
  })

  it('no-ops at the ends of the queue rather than wrapping or dropping', () => {
    const before = [...s().runs[STAGED_RUN].stops]
    const eventCount = s().events.length
    s().reorderStop(STAGED_RUN, before[0], -1)
    s().reorderStop(STAGED_RUN, before[before.length - 1], 1)
    expect(s().runs[STAGED_RUN].stops).toEqual(before)
    expect(s().events.length).toBe(eventCount)
  })

  it('no-ops for a stop that is not on that run, and for an unknown run', () => {
    const before = [...s().runs[STAGED_RUN].stops]
    s().reorderStop(STAGED_RUN, 'run-a-1', -1)
    s().reorderStop('run-zzz', before[0], 1)
    expect(s().runs[STAGED_RUN].stops).toEqual(before)
  })

  it('keeps the run’s stop set intact — a reorder never loses an order', () => {
    const before = [...s().runs[STAGED_RUN].stops]
    s().reorderStop(STAGED_RUN, before[1], -1)
    s().reorderStop(STAGED_RUN, before[3], -1)
    s().reorderStop(STAGED_RUN, before[0], 1)
    expect([...s().runs[STAGED_RUN].stops].sort()).toEqual([...before].sort())
  })
})

describe('order cancelled after dispatch', () => {
  it('drops the stop from the delivery queue and annotates why', () => {
    s().startRun(STAGED_RUN)
    const [first, second] = s().runs[STAGED_RUN].stops
    s().setStopEta(second, 12)

    s().cancelStop(second)

    const stop = s().stops[second]
    expect(stop.status).toBe('exception')
    expect(stop.etaMin).toBeNull()
    expect(exceptionReasons(s().events)[second]).toBe(EXCEPTION_LABEL.cancelled)
    expect(cancelledStopIds(s().events, EXCEPTION_LABEL.cancelled).has(second)).toBe(true)
    // the queue pointer is untouched: the driver is still working the first stop
    expect(currentStop(s(), STAGED_RUN)?.id).toBe(first)
  })

  it('keeps its slot in run.stops so the precomputed legs stay index-aligned', () => {
    const before = [...s().runs[STAGED_RUN].stops]
    s().startRun(STAGED_RUN)
    s().cancelStop(before[1])
    expect(s().runs[STAGED_RUN].stops).toEqual(before)
  })

  it('is skipped by every consumer that reads the queue', () => {
    s().startRun(STAGED_RUN)
    const stops = s().runs[STAGED_RUN].stops
    const total = stops.length

    s().cancelStop(stops[0])
    expect(currentStop(s(), STAGED_RUN)?.id).toBe(stops[1])
    expect(runCounts(s(), STAGED_RUN)).toEqual({ done: 1, total })
    expect(stopsAway(s(), stops[2])).toBe(1)

    s().cancelStop(stops[1])
    expect(currentStop(s(), STAGED_RUN)?.id).toBe(stops[2])
    expect(runCounts(s(), STAGED_RUN)).toEqual({ done: 2, total })
    expect(stopsAway(s(), stops[2])).toBe(0)
  })

  it('is idempotent — a second cancellation adds no second line', () => {
    s().startRun(STAGED_RUN)
    const stopId = s().runs[STAGED_RUN].stops[1]
    s().cancelStop(stopId)
    const count = s().events.length
    s().cancelStop(stopId)
    s().cancelStop(stopId)
    expect(s().events.length).toBe(count)
  })

  it('cannot cancel an order that was already delivered', () => {
    const stopId = deliverFirstStop('cash')
    s().cancelStop(stopId)
    expect(s().stops[stopId].status).toBe('delivered')
    expect(ladderFor(stopId)).not.toContain('exception')
  })

  it('leaves the run completable — cancelling every stop still closes the run', () => {
    s().startRun(STAGED_RUN)
    for (const stopId of s().runs[STAGED_RUN].stops) s().cancelStop(stopId)
    expect(currentStop(s(), STAGED_RUN)).toBeNull()
    s().completeRun(STAGED_RUN)
    expect(s().runs[STAGED_RUN].status).toBe('complete')
  })
})

describe('exception paths land in a consistent state', () => {
  const REASONS: ExceptionReason[] = ['no_answer', 'cannot_verify', 'refused', 'address_issue']

  for (const reason of REASONS) {
    it(`${reason}: exception status, no ETA, reason on the record`, () => {
      s().startRun(STAGED_RUN)
      const stopId = s().runs[STAGED_RUN].stops[0]
      s().setStopEta(stopId, 9)
      s().flagException(stopId, reason)

      const stop = s().stops[stopId]
      expect(stop.status).toBe('exception')
      expect(stop.etaMin).toBeNull()
      expect(stop.closedAt).toBeNull()
      expect(exceptionReasons(s().events)[stopId]).toBe(EXCEPTION_LABEL[reason])
      // an undeliverable stop is never money collected
      expect(ladderFor(stopId)).not.toContain('closed')
    })
  }

  it('can be flagged from anywhere on the ladder except delivered', () => {
    for (const status of ['pending', 'enroute', 'arrived', 'id_check'] as StopStatus[]) {
      resetStore()
      const stopId = stagedFirstStopId()
      s().setStopStatus(stopId, status)
      s().flagException(stopId, 'no_answer')
      expect(s().stops[stopId].status).toBe('exception')
    }
  })

  it('refuses to reopen a delivered stop — money was collected against a verified ID', () => {
    const stopId = deliverFirstStop('cash')
    const before = s().events.length
    s().flagException(stopId, 'no_answer')
    expect(s().stops[stopId].status).toBe('delivered')
    expect(s().events.length).toBe(before)
  })

  it('last reason wins when a stop is re-flagged', () => {
    s().startRun(STAGED_RUN)
    const stopId = s().runs[STAGED_RUN].stops[0]
    s().flagException(stopId, 'no_answer')
    s().flagException(stopId, 'address_issue')
    expect(exceptionReasons(s().events)[stopId]).toBe(EXCEPTION_LABEL.address_issue)
  })
})

describe('ETA writes', () => {
  it('setStopEtas applies a batch and skips unchanged stops', () => {
    const [a, b] = s().runs[STAGED_RUN].stops
    s().setStopEtas({ [a]: 4, [b]: 11, 'nope-1': 3 })
    expect(s().stops[a].etaMin).toBe(4)
    expect(s().stops[b].etaMin).toBe(11)

    const before = s().stops
    s().setStopEtas({ [a]: 4, [b]: 11 })
    expect(s().stops).toBe(before) // identity preserved — no wasted React render
  })

  it('setStopEta is a no-op when the value has not moved', () => {
    const stopId = stagedFirstStopId()
    s().setStopEta(stopId, 7)
    const before = s().stops
    s().setStopEta(stopId, 7)
    expect(s().stops).toBe(before)
  })
})

describe('event log', () => {
  it('caps at 300 events and keeps the newest', () => {
    for (let i = 0; i < 420; i++) {
      s().logEvent({ runId: STAGED_RUN, stopId: null, type: 'note', meta: { message: `n${i}` } })
    }
    const events = s().events
    expect(events.length).toBeLessThanOrEqual(300)
    expect(events.at(-1)?.meta?.message).toBe('n419')
    expect(events.some((e) => e.meta?.message === 'n0')).toBe(false)
  })

  it('mints a unique id for every event', () => {
    for (let i = 0; i < 200; i++) {
      s().logEvent({ runId: STAGED_RUN, stopId: null, type: 'note' })
    }
    const ids = s().events.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('honours an explicit timestamp — replayed live events keep their own clock', () => {
    const at = new Date(FIXED_NOW - 90_000).toISOString()
    s().logEvent({ runId: STAGED_RUN, stopId: null, type: 'note', at })
    expect(s().events.at(-1)?.at).toBe(at)
  })
})

describe('run lifecycle', () => {
  it('completeRun stamps the depot return once', () => {
    s().startRun(STAGED_RUN)
    s().completeRun(STAGED_RUN)
    s().completeRun(STAGED_RUN)
    const notes = s().events.filter(
      (e) => e.runId === STAGED_RUN && e.meta?.message?.startsWith('RUN COMPLETE'),
    )
    expect(notes).toHaveLength(1)
    expect(s().runs[STAGED_RUN].status).toBe('complete')
  })

  it('resetFleet bumps the generation and re-stages everything', () => {
    s().startRun(STAGED_RUN)
    const generation = s().generation
    s().resetFleet()

    expect(s().generation).toBe(generation + 1)
    expect(s().selection).toBeNull()
    for (const runId of s().runOrder) expect(s().runs[runId].status).toBe('staged')
    for (const stop of Object.values(s().stops)) {
      expect(stop.status).toBe('pending')
      expect(stop.idChecked).toBe(false)
    }
  })

  it('advanceRunPosition ignores an unknown run', () => {
    const before = s().runs
    s().advanceRunPosition('run-zzz', { position: [0, 0], heading: 0 })
    expect(s().runs).toBe(before)
  })
})

describe('session state', () => {
  it('toggleTheme flips between the two themes', () => {
    const first = s().theme
    s().toggleTheme()
    expect(s().theme).not.toBe(first)
    s().toggleTheme()
    expect(s().theme).toBe(first)
  })

  it('handing a run to a live phone drops the stale fix', () => {
    s().setLiveFix({ accuracyM: 12, simulated: false, atMs: FIXED_NOW })
    s().setLiveRun('run-a')
    expect(s().liveFix).toBeNull()
    expect(s().liveRunId).toBe('run-a')
  })

  it('setLiveQueued is a no-op at the same count', () => {
    s().setLiveQueued(3)
    const before = s().liveQueued
    s().setLiveQueued(3)
    expect(s().liveQueued).toBe(before)
  })
})

describe('runIdOf', () => {
  it('recovers the run from a stop id', () => {
    expect(runIdOf('run-a-1')).toBe('run-a')
    expect(runIdOf('run-c-12')).toBe('run-c')
  })
})
