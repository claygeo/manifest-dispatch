/**
 * The identity record a driver checks at the door.
 *
 * SPEC: "ID verify = full-screen check screen (name + DOB confirm + 21+ big
 * yes/no) — no camera (cut by decision)." The Stop contract carries no DOB —
 * it is deliberately not fleet data, it belongs to the order record the POS
 * hands over. Rather than widen the shared type for one screen, the driver app
 * derives a stable fictional record from the stop id, exactly the way the seed
 * derives baskets and order codes.
 *
 * Deterministic: the same stop always shows the same person, so a driver can
 * re-open a ticket and see the same card. Every record is fictional — the ID
 * screen says so on its face.
 *
 * ROUND-1 FIX (age arithmetic). The first cut of this file picked an age and
 * then back-solved a birth year from it (`year = thisYear - age`), which meant
 * the card printed a date of birth and an age that disagreed with each other
 * for everybody whose birthday had not happened yet this year: 09 / 05 / 1957
 * rendered as "Age 69" on 2026-08-02, when that person is 68 until September.
 * On an age-gate screen that is the worst possible place to be off by one.
 *
 * The shape that cannot drift: the DATE OF BIRTH is the record, and the age is
 * DERIVED from it against the clock the app is running on. `ageOn` below is the
 * only thing that computes an age, it compares month and day and not just the
 * year, and the birth date it is handed depends only on the seed and on the
 * calendar YEAR — never on today's month or day — so a record does not quietly
 * change out from under a driver as the sim clock rolls past midnight.
 */

import { hashSeed, rng } from '../sim/geo'
import type { Stop } from '../types'

/** A calendar date, 1-indexed month, as it is printed on a licence. */
export interface BirthDate {
  year: number
  /** 1–12. */
  month: number
  /** 1–31. */
  day: number
}

export interface IdentityRecord {
  /** The record itself. Age is derived from this, never stored beside it. */
  birth: BirthDate
  /** '03 / 14 / 1991' — the register a driver reads off a licence. */
  dob: string
  /** Whole years old on the day of the check. Always `ageOn(birth, now)`. */
  age: number
  /** FL Medical Marijuana Use Registry number (fictional). */
  registryId: string
  /** 'EXP 09 / 2027' */
  cardExpiry: string
  /** Issuing state on the photo ID. */
  idState: string
  /** True when the customer clears 21 — always true in seeded data. */
  adult: boolean
}

const MONTHS = 12

/**
 * ROUND-1 FIX (issuing state). A Florida Medical Marijuana Use Registry card is
 * held by a Florida-registered patient, so an out-of-state licence next to an
 * OMMU registry number is a record that could not exist. The demo used to deal
 * GA / NY / OH into the mix for texture; texture is not worth a compliance
 * screen that contradicts itself in front of somebody who reads these for a
 * living.
 */
const ID_STATE = 'FL'

/** Youngest and oldest seeded customer, in whole years. */
export const MIN_SEEDED_AGE = 21
const AGE_SPREAD = 54

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Whole years old on `now` — month and day compared, not just the year.
 *
 * A 29 February birth date has no anniversary in a common year. This treats it
 * as falling on 1 March (the person is still 20 on 28 February), which is the
 * conservative reading and the only one an age gate should ever take: the
 * comparison below only says "has the (month, day) arrived yet", and (2, 29)
 * has not arrived on (2, 28).
 */
export function ageOn(birth: BirthDate, now: Date): number {
  const years = now.getFullYear() - birth.year
  const month = now.getMonth() + 1
  const day = now.getDate()
  const beforeBirthday = month < birth.month || (month === birth.month && day < birth.day)
  return beforeBirthday ? years - 1 : years
}

export function formatDob(birth: BirthDate): string {
  return `${pad(birth.month)} / ${pad(birth.day)} / ${birth.year}`
}

export function identityFor(stop: Stop, nowMs: number = Date.now()): IdentityRecord {
  const r = rng(hashSeed(`${stop.id}#${stop.orderCode}#identity`))
  const now = new Date(nowMs)
  const anchorYear = now.getFullYear()

  // 21–75. Nothing in the seeded fleet is under age: the demo's honest failure
  // mode is a driver's judgement call (CANNOT VERIFY), not a planted minor.
  //
  // The `- 1` is what makes that guarantee hold without consulting today's
  // date. Somebody born in `anchorYear - band - 1` has either already had this
  // year's birthday (age band + 1) or has not (age band), and both clear the
  // floor. Reading only the year keeps the printed date stable for the whole
  // session while the age underneath it is still computed honestly.
  const band = MIN_SEEDED_AGE + Math.floor(r() * AGE_SPREAD)
  const month = 1 + Math.floor(r() * MONTHS)
  const day = 1 + Math.floor(r() * 28)
  const birth: BirthDate = { year: anchorYear - band - 1, month, day }

  const registryId = `P${String(1000000 + Math.floor(r() * 8999999))}`
  const expMonth = 1 + Math.floor(r() * MONTHS)
  const expYear = anchorYear + 1 + Math.floor(r() * 2)

  const age = ageOn(birth, now)

  return {
    birth,
    dob: formatDob(birth),
    age,
    registryId,
    cardExpiry: `${pad(expMonth)} / ${expYear}`,
    idState: ID_STATE,
    adult: age >= MIN_SEEDED_AGE,
  }
}
