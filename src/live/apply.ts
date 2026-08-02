/**
 * Receiving half of live mode.
 *
 * The rule from store.ts: "the sim engine and the live engine call the SAME
 * actions. Nothing in the UI is allowed to ask which engine is driving." So
 * everything below lands through `advanceRunPosition` / `setStopStatus` /
 * `setStopEtas` / `setRunStatus` / `logEvent` — the exact set src/sim/engine.ts
 * uses. There is no live-only field on Stop, no live-only branch in a component.
 *
 * Two deliberate choices:
 *
 *  - a GPS fix is snapped onto the current leg (`projectOnLeg`) before it is
 *    stored, so `run.progress` keeps meaning what it means in demo mode and the
 *    console's travelled/ahead route split, the driver's leg strip and every
 *    ETA all keep working without knowing where the position came from.
 *
 *  - state deltas are applied WITHOUT the logging actions (`verifyId`,
 *    `closeStop`, `flagException` all emit their own events). The driver's real
 *    events arrive in the snapshot with their own ids and timestamps and are
 *    replayed verbatim, so the dispatcher's feed is the driver's feed rather
 *    than a locally-reconstructed guess at it.
 */

import { useStore } from '../store'
import { legsFor } from '../data/seed'
import { projectOnLeg } from '../sim/geo'
import { etaMinutesTo } from '../sim/eta'
import type { DeliveryEvent } from '../types'
import type { GpsPing, RunSnapshot } from './protocol'

/**
 * Beyond this the fix is not on the leg we think it is (driver detoured, or the
 * phone is nowhere near Tampa because it is a real phone in a real city). Keep
 * the true position on the map, leave `progress` where it was rather than
 * snapping the van to a wildly wrong point on the polyline.
 */
const OFF_ROUTE_LIMIT_M = 400

/**
 * Remote event ids already folded into the local feed. Seeded from whatever the
 * store already holds when the session opens: both devices build the same
 * deterministic fleet, so the driver's back-dated `seed-*` history is history
 * this tab already has and must not print twice.
 */
let appliedEventIds = new Set<string>()

export function beginLiveApply(): void {
  appliedEventIds = new Set(useStore.getState().events.map((e) => e.id))
}

export function endLiveApply(): void {
  appliedEventIds = new Set()
}

/* --------------------------------------------------------------- gps ----- */

export function applyGpsPing(ping: GpsPing): void {
  const s = useStore.getState()
  const run = s.runs[ping.runId]
  if (!run) return

  s.setLiveRun(ping.runId)

  const legs = legsFor(ping.runId)
  const legIndex = Math.max(0, Math.min(run.currentLeg, legs.length - 1))
  const leg = legs[legIndex]

  let progress = run.progress
  if (leg) {
    const snap = projectOnLeg(leg, ping.lngLat)
    if (snap.offRouteM <= OFF_ROUTE_LIMIT_M) progress = snap.progress
  }

  s.advanceRunPosition(ping.runId, {
    position: ping.lngLat,
    heading: ping.heading,
    progress,
  })

  s.setLiveFix({
    accuracyM: Math.max(0, ping.accuracy),
    simulated: Boolean(ping.simulated),
    atMs: ping.at,
  })

  // SPEC: "ETAs recompute from remaining leg durations" — same maths as the sim.
  if (!leg) return
  const etas: Record<string, number | null> = {}
  run.stops.forEach((stopId, i) => {
    const stop = s.stops[stopId]
    if (!stop) return
    etas[stopId] =
      stop.status === 'delivered' || stop.status === 'exception'
        ? null
        : etaMinutesTo(legs, legIndex, progress, i)
  })
  s.setStopEtas(etas)
}

/* ---------------------------------------------------------- snapshot ----- */

export function applyRunSnapshot(snapshot: RunSnapshot): void {
  const s = useStore.getState()
  const run = s.runs[snapshot.runId]
  if (!run) return

  s.setLiveRun(snapshot.runId)

  for (const remote of snapshot.stops) {
    const local = s.stops[remote.id]
    if (!local) continue
    const changed =
      local.status !== remote.status ||
      local.idChecked !== remote.idChecked ||
      local.closedAt !== remote.closedAt ||
      local.payment !== remote.payment ||
      local.etaMin !== remote.etaMin
    if (!changed) continue
    s.setStopStatus(remote.id, remote.status, {
      idChecked: remote.idChecked,
      closedAt: remote.closedAt,
      payment: remote.payment,
      etaMin: remote.etaMin,
    })
  }

  if (run.status !== snapshot.status) s.setRunStatus(snapshot.runId, snapshot.status)

  s.advanceRunPosition(snapshot.runId, {
    position: snapshot.position,
    heading: snapshot.heading,
    currentLeg: snapshot.currentLeg,
    progress: snapshot.progress,
  })

  applyRemoteEvents(snapshot.events)
}

/**
 * Fold remote DeliveryEvents into the feed, once each. The store mints its own
 * id (it has no idea these are replays), so dedupe is tracked here against the
 * publisher's id — which is what makes an unordered, lossy broadcast plus a
 * `api_get_events` replay of the same shift converge on one clean transcript.
 */
export function applyRemoteEvents(events: DeliveryEvent[]): void {
  const s = useStore.getState()
  const fresh = events.filter((e) => e && e.id && !appliedEventIds.has(e.id))
  if (fresh.length === 0) return
  fresh.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  for (const event of fresh) {
    appliedEventIds.add(event.id)
    s.logEvent({
      runId: event.runId,
      stopId: event.stopId,
      type: event.type,
      at: event.at,
      ...(event.meta ? { meta: event.meta } : {}),
    })
  }
}

/** Remember an id the local tab produced, so its echo back is not printed twice. */
export function noteLocalEvent(id: string): void {
  appliedEventIds.add(id)
}
