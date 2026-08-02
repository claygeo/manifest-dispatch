/**
 * Delivery-window maths — the FL-OMMU compliance surface.
 *
 * Two questions kept deliberately apart in window.ts, and the tests hold them
 * apart too: `windowState` is a projection (will the driver make it?) that
 * drives the console's amber, `arrivalWindowNote` is a judgement made once at
 * the door and written into the event log, where it survives the stop closing
 * and reaches the printed manifest.
 */

import { describe, expect, it } from 'vitest'
import { arrivalWindowNote, isLateArrivalNote, parseClock, windowLabel, windowState } from './window'
import { formatClock } from './format'
import type { Stop, StopStatus } from './types'

/** Local-time reference so the assertions never depend on the runner's zone. */
const REF = new Date(2026, 7, 2, 14, 0, 0, 0).getTime() // 2 PM local, 2026-08-02
const HOUR = 3_600_000

function stopAt(window: [string, string], patch: Partial<Stop> = {}): Stop {
  return {
    id: 'run-a-1',
    orderCode: 'MFST-4102',
    customer: 'Dana Whitlock',
    address: '1 Test St, Tampa FL',
    lngLat: [-82.4572, 27.9506],
    items: [{ name: 'Flower 3.5g — Gelato #33', qty: 1 }],
    amountDue: 84.5,
    payment: 'cash',
    status: 'enroute',
    window,
    etaMin: null,
    idChecked: false,
    closedAt: null,
    ...patch,
  }
}

describe('parseClock', () => {
  it('reads a 12-hour clock onto the reference day', () => {
    expect(new Date(parseClock('2:00 PM', REF)).getHours()).toBe(14)
    expect(new Date(parseClock('2:00 AM', REF)).getHours()).toBe(2)
    expect(new Date(parseClock('12:00 AM', REF)).getHours()).toBe(0)
    expect(new Date(parseClock('12:30 PM', REF)).getHours()).toBe(12)
    expect(new Date(parseClock('12:30 PM', REF)).getMinutes()).toBe(30)
  })

  it('round-trips whatever formatClock produced', () => {
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 15, 45]) {
        const ms = new Date(2026, 7, 2, h, m, 0, 0).getTime()
        expect(parseClock(formatClock(ms), ms)).toBe(ms)
      }
    }
  })

  it('is case- and whitespace-tolerant', () => {
    expect(parseClock('  4:05 pm ', REF)).toBe(parseClock('4:05 PM', REF))
  })

  it('picks the nearest day across midnight rather than the literal one', () => {
    const lateNight = new Date(2026, 7, 2, 23, 0, 0, 0).getTime()
    // 1 AM from 11 PM is two hours ahead, not twenty-two hours behind
    expect(parseClock('1:00 AM', lateNight)).toBe(lateNight + 2 * HOUR)

    const earlyMorning = new Date(2026, 7, 3, 1, 0, 0, 0).getTime()
    // 11 PM from 1 AM is two hours behind, not twenty-two ahead
    expect(parseClock('11:00 PM', earlyMorning)).toBe(earlyMorning - 2 * HOUR)
  })

  it('falls back to the reference rather than NaN on junk', () => {
    for (const junk of ['', 'later', '2:00', '2 PM', '2:0 PM', 'NaN:NaN PM']) {
      expect(parseClock(junk, REF)).toBe(REF)
    }
  })

  it('refuses an out-of-range clock instead of folding it mod 12', () => {
    // '25:00 PM' used to parse as 1 PM. A confident wrong time on a delivery
    // window is worse than an obvious fallback, because it reaches the manifest.
    for (const bad of ['25:00 PM', '13:00 PM', '0:30 PM', '2:60 PM', '2:99 AM']) {
      expect(parseClock(bad, REF)).toBe(REF)
    }
  })
})

describe('windowState', () => {
  it('is ok before the window opens', () => {
    const stop = stopAt(['4:00 PM', '6:00 PM'], { etaMin: 30 })
    expect(windowState(stop, REF)).toBe('ok')
  })

  it('is due once the window is open and the driver is still projected inside it', () => {
    const stop = stopAt(['1:00 PM', '5:00 PM'], { etaMin: 30 })
    expect(windowState(stop, REF)).toBe('due')
  })

  it('is late — the only amber state — when the projected arrival misses the window', () => {
    const stop = stopAt(['1:00 PM', '2:30 PM'], { etaMin: 45 })
    expect(windowState(stop, REF)).toBe('late')
  })

  it('is late on a stop with no ETA once the window has already closed', () => {
    const stop = stopAt(['11:00 AM', '1:00 PM'], { etaMin: null })
    expect(windowState(stop, REF)).toBe('late')
  })

  it('goes quiet the moment the stop is closed out — a delivered stop is never amber', () => {
    const stop = stopAt(['11:00 AM', '1:00 PM'], { etaMin: null, status: 'delivered' })
    expect(windowState(stop, REF)).toBe('closed')
  })

  it('only ever gets worse as the projected arrival slips', () => {
    const rank = { ok: 0, due: 1, late: 2, closed: 3 }
    const window: [string, string] = ['1:00 PM', '3:00 PM']
    let previous = -1
    for (const etaMin of [1, 15, 30, 45, 59, 61, 120]) {
      const state = windowState(stopAt(window, { etaMin }), REF)
      expect(rank[state]).toBeGreaterThanOrEqual(previous)
      previous = rank[state]
    }
    expect(previous).toBe(rank.late)
  })
})

describe('windowLabel', () => {
  it('renders the window as one en-dashed range', () => {
    expect(windowLabel(stopAt(['2:00 PM', '4:00 PM']))).toBe('2:00 PM–4:00 PM')
  })
})

describe('arrivalWindowNote', () => {
  it('says nothing when the driver made the window', () => {
    const stop = stopAt(['1:00 PM', '4:00 PM'])
    expect(arrivalWindowNote(stop, REF)).toBeNull()
  })

  it('says nothing for an EARLY arrival — waiting at the kerb is the job', () => {
    const stop = stopAt(['4:00 PM', '6:00 PM'])
    expect(arrivalWindowNote(stop, REF)).toBeNull()
  })

  it('flags a closed window, naming the time that was missed', () => {
    const stop = stopAt(['10:00 AM', '12:00 PM'])
    const note = arrivalWindowNote(stop, REF)
    expect(note).toBe('LATE — WINDOW CLOSED 12:00 PM')
    expect(isLateArrivalNote(note)).toBe(true)
  })

  it('is a note, never a veto: it does not depend on the stop being open', () => {
    // the whole point of SPEC's "flagged, logged, still completable"
    for (const status of ['enroute', 'arrived', 'id_check'] as StopStatus[]) {
      expect(arrivalWindowNote(stopAt(['10:00 AM', '12:00 PM'], { status }), REF)).not.toBeNull()
    }
  })
})

describe('isLateArrivalNote', () => {
  it('is false for everything that is not a late note', () => {
    expect(isLateArrivalNote(null)).toBe(false)
    expect(isLateArrivalNote(undefined)).toBe(false)
    expect(isLateArrivalNote('')).toBe(false)
    expect(isLateArrivalNote('RESEQUENCED TO POSITION 2')).toBe(false)
  })
})
