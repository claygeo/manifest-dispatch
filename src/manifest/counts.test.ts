/**
 * The compliance header has to agree with the custody log below it.
 *
 * The bug, exactly as reported: a run with four stops, one of them an
 * undelivered exception, printed `STOPS CLOSED 4/4` — because the shared
 * `runCounts` selector treats "delivered" and "exception" alike (correctly, for
 * the console: both mean the driver has finished with the stop). On a document
 * whose whole claim is custody, that header says product was handed over four
 * times while the custody log two inches down shows three signature rules and
 * one CANCELLED row with no transfer.
 *
 * These tests build fixtures from the real seeded fleet driven through the real
 * store actions, so the states under test are states the app can actually
 * reach, not hand-made objects that agree with the implementation by
 * construction.
 */

import { describe, expect, it } from 'vitest'
import { useStore } from '../store'
import { runStops } from '../selectors'
import { manifestCounts, manifestTotals } from './counts'
import { resetStore } from '../test/harness'
import type { Stop } from '../types'

/**
 * The staged run: four stops, all pending at generation 0, so every fixture
 * below starts from a clean board and drives it with real store actions. (The
 * seeded fleet deliberately opens mid-shift — run A is already part-delivered —
 * which is exactly the state that would make these counts untestable.)
 */
const RUN_ID = 'run-b'

function view() {
  const s = useStore.getState()
  return { runs: s.runs, runOrder: s.runOrder, stops: s.stops }
}

function stops(): Stop[] {
  return runStops(view(), RUN_ID)
}

/** Deliver a stop the only way the app allows: arrive, verify, close. */
function deliver(stopId: string): void {
  const s = useStore.getState()
  s.arriveStop(stopId)
  s.verifyId(stopId, true)
  s.closeStop(stopId)
}

describe('closed means delivered', () => {
  it('does not count an exception as a closed stop', () => {
    resetStore()
    const ids = useStore.getState().runs[RUN_ID].stops
    // exactly the reported shape: a four-stop run, three handed over, one not
    expect(ids).toHaveLength(4)
    deliver(ids[0])
    deliver(ids[1])
    deliver(ids[2])
    useStore.getState().flagException(ids[3], 'no_answer')

    const counts = manifestCounts(stops())

    expect(counts.total).toBe(4)
    expect(counts.closed).toBe(3)
    expect(counts.exceptions).toBe(1)
    expect(counts.open).toBe(0)
    // the header line the document actually prints
    expect(counts.label).toBe('3/4 CLOSED · 1 EXCEPTION')
    expect(counts.screenLabel).toBe('3/4 closed · 1 exception')
    // and never the old claim
    expect(counts.label).not.toContain('4/4')
  })

  it('says nothing about exceptions when there are none', () => {
    resetStore()
    const ids = useStore.getState().runs[RUN_ID].stops
    for (const id of ids) deliver(id)

    const counts = manifestCounts(stops())
    expect(counts.closed).toBe(counts.total)
    expect(counts.exceptions).toBe(0)
    expect(counts.label).toBe(`${counts.total}/${counts.total} CLOSED`)
    expect(counts.screenLabel).not.toContain('exception')
  })

  it('pluralises an exception count without inventing one', () => {
    resetStore()
    const ids = useStore.getState().runs[RUN_ID].stops
    useStore.getState().flagException(ids[0], 'no_answer')
    useStore.getState().cancelStop(ids[1])

    const counts = manifestCounts(stops())
    expect(counts.exceptions).toBe(2)
    expect(counts.label).toContain('2 EXCEPTIONS')
  })

  it('leaves stops still in progress out of both counts', () => {
    resetStore()
    const ids = useStore.getState().runs[RUN_ID].stops
    deliver(ids[0])
    useStore.getState().arriveStop(ids[1])
    useStore.getState().verifyId(ids[2], true) // mid-ladder, not closed

    const counts = manifestCounts(stops())
    expect(counts.closed).toBe(1)
    expect(counts.exceptions).toBe(0)
    expect(counts.open).toBe(counts.total - 1)
    expect(counts.closed + counts.exceptions + counts.open).toBe(counts.total)
  })

  it('handles a run with no stops without dividing by anything', () => {
    const counts = manifestCounts([])
    expect(counts).toMatchObject({ closed: 0, exceptions: 0, open: 0, total: 0 })
    expect(counts.label).toBe('0/0 CLOSED')
  })
})

describe('the totals row agrees with the header', () => {
  it('collects money only from the stops the header calls closed', () => {
    resetStore()
    const ids = useStore.getState().runs[RUN_ID].stops
    deliver(ids[0])
    deliver(ids[1])
    useStore.getState().flagException(ids[2], 'cannot_verify')

    const list = stops()
    const counts = manifestCounts(list)
    const totals = manifestTotals(list)

    const delivered = list.filter((s) => s.status === 'delivered')
    expect(delivered).toHaveLength(counts.closed)
    expect(totals.collected).toBeCloseTo(
      delivered.reduce((sum, s) => sum + s.amountDue, 0),
      6,
    )
    // what left the building is every order on the sheet, not just the closed ones
    expect(totals.amount).toBeCloseTo(
      list.reduce((sum, s) => sum + s.amountDue, 0),
      6,
    )
    expect(totals.collected).toBeLessThan(totals.amount)
    expect(totals.orders).toBe(counts.total)
    expect(totals.units).toBe(
      list.reduce((n, s) => n + s.items.reduce((q, i) => q + i.qty, 0), 0),
    )
  })

  it('collects nothing from a run where nothing was handed over', () => {
    resetStore()
    for (const id of useStore.getState().runs[RUN_ID].stops) {
      useStore.getState().cancelStop(id)
    }
    const list = stops()
    expect(manifestCounts(list).closed).toBe(0)
    expect(manifestTotals(list).collected).toBe(0)
    expect(manifestTotals(list).amount).toBeGreaterThan(0)
  })

  it('collects everything from a fully delivered run', () => {
    resetStore()
    for (const id of useStore.getState().runs[RUN_ID].stops) deliver(id)
    const list = stops()
    const totals = manifestTotals(list)
    expect(manifestCounts(list).closed).toBe(list.length)
    expect(totals.collected).toBeCloseTo(totals.amount, 6)
  })
})
