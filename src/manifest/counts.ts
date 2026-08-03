/**
 * What the manifest is allowed to call "closed".
 *
 * The bug: the document's header read `STOPS CLOSED 4/4` on a run where one
 * order came back undelivered, because the shared `runCounts` selector counts
 * `delivered` and `exception` together. That is the right count for the console
 * and the driver — both are asking "has the driver finished with this stop" —
 * and it is the wrong count for a compliance document, where a stop is closed
 * when product changed hands and money was collected. The custody log two
 * inches below the header already printed CANCELLED and an empty signature rule
 * for that same order, so the sheet contradicted itself on its own front page.
 *
 * Here, closed means DELIVERED, exceptions are counted separately and printed,
 * and the totals row is derived from the same pass so the money at the bottom
 * cannot disagree with the count at the top.
 *
 * These live in their own module rather than in the page because the page is a
 * 400-line document and this arithmetic is the part that has to be provably
 * right — see counts.test.ts.
 */

import type { Stop } from '../types'

export interface ManifestCounts {
  /** Handed over and signed for. */
  closed: number
  /** Ended undelivered — failed ID, no answer, refused, cancelled. */
  exceptions: number
  /** Still open: pending, en route, arrived, mid ID check. */
  open: number
  total: number
  /** '3/4 CLOSED · 1 EXCEPTION' — the document voice, ALL CAPS per DESIGN. */
  label: string
  /** '3/4 closed · 1 exception' — the screen chrome above the sheet. */
  screenLabel: string
}

export interface ManifestTotals {
  orders: number
  units: number
  /** Every order on the manifest, delivered or not — what left the building. */
  amount: number
  /** Money actually taken, which is delivered orders only. */
  collected: number
}

function unitsOf(stop: Stop): number {
  return stop.items.reduce((n, item) => n + item.qty, 0)
}

export function manifestCounts(stops: Stop[]): ManifestCounts {
  let closed = 0
  let exceptions = 0
  for (const stop of stops) {
    if (stop.status === 'delivered') closed += 1
    else if (stop.status === 'exception') exceptions += 1
  }
  const total = stops.length
  const ratio = `${closed}/${total}`
  const exceptionPart =
    exceptions === 0 ? '' : ` · ${exceptions} exception${exceptions === 1 ? '' : 's'}`
  return {
    closed,
    exceptions,
    open: total - closed - exceptions,
    total,
    label: `${ratio} CLOSED${exceptionPart.toUpperCase()}`,
    screenLabel: `${ratio} closed${exceptionPart}`,
  }
}

export function manifestTotals(stops: Stop[]): ManifestTotals {
  let units = 0
  let amount = 0
  let collected = 0
  for (const stop of stops) {
    units += unitsOf(stop)
    amount += stop.amountDue
    if (stop.status === 'delivered') collected += stop.amountDue
  }
  return { orders: stops.length, units, amount, collected }
}
