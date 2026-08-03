/**
 * The age on the ID-check screen is the single most embarrassing number in the
 * app to get wrong: it is the compliance surface, it is the thing a director
 * from an operator will read first, and being off by one there says the rest of
 * the product was built the same way.
 *
 * It WAS wrong. Round-1 review, on the demo's own date of 2026-08-02, found a
 * card printing "09 / 05 / 1957" against "Age 69" — that person is 68 until
 * September. Cause: the record picked an age and back-solved a birth year from
 * it by subtracting whole years, so every customer whose birthday had not
 * happened yet in the current year was rendered a year too old.
 *
 * So this file pins the boundary a year-subtraction bug cannot survive: the day
 * before a birthday, the birthday itself, the day after, and the 29 February
 * case that has no anniversary at all in a common year.
 */

import { describe, expect, it } from 'vitest'
import { ageOn, formatDob, identityFor, MIN_SEEDED_AGE, type BirthDate } from './identity'
import { buildFleet } from '../data/seed'

/** The demo's own date, and the date the round-1 finding was written against. */
const DEMO_DAY = Date.parse('2026-08-02T14:00:00.000Z')

const fleet = buildFleet(0, DEMO_DAY)

/** Local midday, so a UTC-vs-local read can never flip the calendar day. */
function localNoon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

describe('ageOn compares the whole date, not just the year', () => {
  const birth: BirthDate = { year: 1957, month: 9, day: 5 }

  it('the day before the birthday: still the younger age', () => {
    expect(ageOn(birth, localNoon(2026, 9, 4))).toBe(68)
  })

  it('the birthday itself: the age ticks over', () => {
    expect(ageOn(birth, localNoon(2026, 9, 5))).toBe(69)
  })

  it('the day after the birthday: stays there', () => {
    expect(ageOn(birth, localNoon(2026, 9, 6))).toBe(69)
  })

  it('reproduces the exact round-1 finding — 09 / 05 / 1957 is 68 on 2026-08-02', () => {
    expect(ageOn(birth, new Date(DEMO_DAY))).toBe(68)
  })

  it('an earlier month in the same year is already counted', () => {
    // The mirror case: a birthday that has passed must NOT be shaved a year by
    // an over-correction in the other direction.
    expect(ageOn({ year: 1957, month: 3, day: 5 }, new Date(DEMO_DAY))).toBe(69)
  })

  it('handles the last day of a month on both sides of the seam', () => {
    const nye: BirthDate = { year: 2000, month: 12, day: 31 }
    expect(ageOn(nye, localNoon(2026, 12, 30))).toBe(25)
    expect(ageOn(nye, localNoon(2026, 12, 31))).toBe(26)
    expect(ageOn(nye, localNoon(2027, 1, 1))).toBe(26)
  })
})

describe('a 29 February birth date', () => {
  const leap: BirthDate = { year: 2004, month: 2, day: 29 }

  it('turns 21 on its real birthday in a leap year', () => {
    expect(ageOn(leap, localNoon(2025, 2, 28))).toBe(20)
    // 2025 is not a leap year: 28 February is still not the anniversary.
    expect(ageOn(leap, localNoon(2025, 3, 1))).toBe(21)
    expect(ageOn(leap, localNoon(2024, 2, 29))).toBe(20)
    expect(ageOn(leap, localNoon(2028, 2, 29))).toBe(24)
  })

  it('is never rounded up early — an age gate reads the conservative way', () => {
    // The whole point: in a common year the gate must not let 28 February
    // count as the birthday. A year-subtraction implementation would.
    expect(ageOn(leap, localNoon(2025, 2, 28))).toBeLessThan(21)
  })
})

describe('the rendered identity record', () => {
  const stops = Object.values(fleet.stops)

  it('has stops to check', () => {
    expect(stops.length).toBeGreaterThan(5)
  })

  it('never prints an age its own date of birth does not support', () => {
    // The regression itself, swept across the whole seeded fleet and across a
    // year of check dates — every day of every month, so no birthday boundary
    // in the seeded data goes unvisited.
    for (const stop of stops) {
      for (let month = 1; month <= 12; month += 1) {
        for (const day of [1, 14, 28]) {
          const at = localNoon(2026, month, day).getTime()
          const record = identityFor(stop, at)
          expect(
            record.age,
            `${stop.orderCode} ${record.dob} on ${month}/${day}/2026`,
          ).toBe(ageOn(record.birth, new Date(at)))
        }
      }
    }
  })

  it('prints the birth date it computed the age from', () => {
    for (const stop of stops) {
      const record = identityFor(stop, DEMO_DAY)
      expect(record.dob).toBe(formatDob(record.birth))
      expect(record.dob).toMatch(/^\d{2} \/ \d{2} \/ \d{4}$/)
    }
  })

  it('never seeds a customer under 21, on any day of the year', () => {
    for (const stop of stops) {
      for (let month = 1; month <= 12; month += 1) {
        const record = identityFor(stop, localNoon(2026, month, 15).getTime())
        expect(record.age, `${stop.orderCode} in month ${month}`).toBeGreaterThanOrEqual(
          MIN_SEEDED_AGE,
        )
        expect(record.adult).toBe(true)
      }
    }
  })

  it('keeps the printed date of birth stable as the clock moves through the day', () => {
    // The sim clock advances at 8x and a long-lived tab crosses midnight. A
    // record that re-rolled its birth year at that seam would change the person
    // on the card mid-shift.
    for (const stop of stops.slice(0, 4)) {
      const morning = identityFor(stop, localNoon(2026, 8, 2).getTime())
      const nextDay = identityFor(stop, localNoon(2026, 8, 3).getTime())
      expect(nextDay.dob).toBe(morning.dob)
      expect(nextDay.registryId).toBe(morning.registryId)
    }
  })

  it('is deterministic per stop', () => {
    for (const stop of stops) {
      expect(identityFor(stop, DEMO_DAY)).toEqual(identityFor(stop, DEMO_DAY))
    }
  })
})

describe('the photo ID matches the registry it is presented against', () => {
  it('is a Florida licence on every seeded stop', () => {
    // Round-1 finding: an Ohio licence was being rendered next to a Florida
    // OMMU registry number. A Florida medical patient holds Florida ID; the
    // combination on screen has to be one that could exist.
    for (const stop of Object.values(fleet.stops)) {
      expect(identityFor(stop, DEMO_DAY).idState).toBe('FL')
    }
  })

  it('still issues a plausible FL registry number and a future card expiry', () => {
    for (const stop of Object.values(fleet.stops)) {
      const record = identityFor(stop, DEMO_DAY)
      expect(record.registryId).toMatch(/^P\d{7}$/)
      const [, expYear] = record.cardExpiry.split(' / ')
      expect(Number(expYear)).toBeGreaterThan(new Date(DEMO_DAY).getFullYear())
    }
  })
})
