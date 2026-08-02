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
 */

import { hashSeed, rng } from '../sim/geo'
import type { Stop } from '../types'

export interface IdentityRecord {
  /** '03 / 14 / 1991' — the register a driver reads off a licence. */
  dob: string
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
const ID_STATES = ['FL', 'FL', 'FL', 'FL', 'GA', 'NY', 'OH']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function identityFor(stop: Stop): IdentityRecord {
  const r = rng(hashSeed(`${stop.id}#${stop.orderCode}#identity`))

  // 21–74. Nothing in the seeded fleet is under age: the demo's honest failure
  // mode is a driver's judgement call (CANNOT VERIFY), not a planted minor.
  const age = 21 + Math.floor(r() * 54)
  const month = 1 + Math.floor(r() * MONTHS)
  const day = 1 + Math.floor(r() * 28)
  const year = new Date().getFullYear() - age

  const registryId = `P${String(1000000 + Math.floor(r() * 8999999))}`
  const expMonth = 1 + Math.floor(r() * MONTHS)
  const expYear = new Date().getFullYear() + 1 + Math.floor(r() * 2)

  return {
    dob: `${pad(month)} / ${pad(day)} / ${year}`,
    age,
    registryId,
    cardExpiry: `${pad(expMonth)} / ${expYear}`,
    idState: ID_STATES[Math.floor(r() * ID_STATES.length)] ?? 'FL',
    adult: age >= 21,
  }
}
