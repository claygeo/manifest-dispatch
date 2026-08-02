/**
 * The phone's GPS pipeline.
 *
 * SPEC.md "Driver app": "GPS: in live mode uses `watchPosition` (high accuracy),
 * lerp-smoothed, accuracy ring, heading from movement vector; `SIM GPS` toggle
 * for dead interview rooms — plays the precomputed route instead."
 *
 * Both sources feed one pipeline, which is the point: whether the fix came off
 * a GNSS chip or off `routes.json`, it goes through the same smoother, the same
 * store action (`advanceRunPosition`, via applyGpsPing) and the same 1 Hz
 * broadcast. Nothing downstream — not the leg strip, not the dispatcher's map,
 * not the customer's tracking card — can tell which one is running, except by
 * reading the label we print on purpose.
 *
 *   raw fix (1 Hz-ish, jumpy)
 *     -> exponential lerp toward the target, every animation frame
 *     -> heading from the movement vector (a phone in a pocket has no compass
 *        worth trusting, and `coords.heading` is null on most desktop browsers)
 *     -> local store write at 5 Hz  (the sim engine's own publish cadence)
 *     -> channel broadcast at 1 Hz  (SPEC: "publishes GPS at 1Hz")
 *
 * Three real-world traps this handles, because a demo that dies in the room is
 * worth nothing: permission denied, no fix inside a building, and a laptop with
 * no GPS hardware at all. All three fall back to SIM GPS and say so.
 */

import { useStore } from '../store'
import { legsFor } from '../data/seed'
import { bearing, haversine, lerp, lerpAngle, pointOnLeg, type LngLat } from '../sim/geo'
import { DEMO_TIME_MULTIPLIER, speedJitterFor } from '../sim/eta'
import { applyGpsPing } from './apply'
import { sendGps } from './session'
import { GPS_PUBLISH_MS } from './config'

/** Store writes per second — matches the sim engine so the map lerps identically. */
const LOCAL_APPLY_MS = 200

/** Smoothing time constant. Long enough to eat GPS noise, short enough to feel live. */
const SMOOTH_TAU_S = 0.35

/** Below this the movement vector is noise, not a bearing — hold the last heading. */
const HEADING_MIN_MOVE_M = 4

/** Give the device this long to produce a first fix before falling back. */
const FIRST_FIX_TIMEOUT_MS = 12_000

export type GpsSource = 'device' | 'sim'

export type GpsHealth = 'pending' | 'ok' | 'denied' | 'unavailable' | 'timeout'

export interface GpsStatus {
  /** What is actually producing fixes right now. */
  source: GpsSource
  /** What the driver asked for — differs from `source` after a fallback. */
  requested: GpsSource
  health: GpsHealth
  /** Short mono line for the honesty rail. null when there is nothing to say. */
  note: string | null
}

export interface DriverGps {
  setSource: (source: GpsSource) => void
  stop: () => void
}

const NOTE: Record<GpsHealth, string | null> = {
  pending: 'WAITING FOR FIRST FIX',
  ok: null,
  denied: 'LOCATION BLOCKED — SIM GPS ENGAGED',
  unavailable: 'NO GPS ON THIS DEVICE — SIM GPS ENGAGED',
  timeout: 'NO FIX INDOORS — SIM GPS ENGAGED',
}

export function startDriverGps(
  runId: string,
  initialSource: GpsSource,
  onStatus: (status: GpsStatus) => void,
): DriverGps {
  let requested: GpsSource = initialSource
  let source: GpsSource = initialSource
  let health: GpsHealth = initialSource === 'sim' ? 'ok' : 'pending'
  let stopped = false

  /* ---- pipeline state ---- */
  let target: LngLat | null = null
  let targetAccuracy = 0
  let smoothed: LngLat | null = null
  let heading = useStore.getState().runs[runId]?.heading ?? 0
  let headingAnchor: LngLat | null = null

  let watchId: number | null = null
  let firstFixTimer = 0
  let raf = 0
  let lastFrame = 0
  let sinceApply = 0
  let sincePublish = 0

  /* ---- sim source state ---- */
  let simLeg = -1
  let simProgress = 0

  const emitStatus = () => {
    onStatus({ source, requested, health, note: NOTE[health] })
  }

  /* ------------------------------------------------------------ device -- */

  function acceptFix(position: GeolocationPosition): void {
    if (stopped || source !== 'device') return
    window.clearTimeout(firstFixTimer)
    target = [position.coords.longitude, position.coords.latitude]
    targetAccuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0
    if (!smoothed) smoothed = target
    if (health !== 'ok') {
      health = 'ok'
      emitStatus()
    }
  }

  function failDevice(next: GpsHealth): void {
    if (stopped) return
    stopDeviceWatch()
    health = next
    source = 'sim'
    resetSim()
    emitStatus()
  }

  function startDeviceWatch(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      failDevice('unavailable')
      return
    }
    health = 'pending'
    emitStatus()
    firstFixTimer = window.setTimeout(() => failDevice('timeout'), FIRST_FIX_TIMEOUT_MS)
    try {
      watchId = navigator.geolocation.watchPosition(
        acceptFix,
        (err) => failDevice(err.code === err.PERMISSION_DENIED ? 'denied' : 'timeout'),
        { enableHighAccuracy: true, maximumAge: 0, timeout: FIRST_FIX_TIMEOUT_MS },
      )
    } catch {
      failDevice('unavailable')
    }
  }

  function stopDeviceWatch(): void {
    window.clearTimeout(firstFixTimer)
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId)
    watchId = null
  }

  /* --------------------------------------------------------------- sim -- */

  function resetSim(): void {
    const run = useStore.getState().runs[runId]
    simLeg = run?.currentLeg ?? 0
    simProgress = run?.progress ?? 0
    target = null
  }

  /**
   * Plays the precomputed route. Same rule the driver-claimed sim uses in demo
   * mode (src/driver/manualDrive.ts): the van only rolls while the current stop
   * is EN ROUTE, so DEPART still starts the truck and ARRIVED still parks it.
   */
  function stepSim(dtRealS: number): void {
    const s = useStore.getState()
    const run = s.runs[runId]
    if (!run) return
    const legs = legsFor(runId)
    if (run.currentLeg !== simLeg) {
      simLeg = run.currentLeg
      simProgress = run.progress
    }
    const leg = legs[Math.min(simLeg, legs.length - 1)]
    if (!leg) return

    const stopId = run.stops[simLeg] ?? null
    const stop = stopId ? s.stops[stopId] : undefined
    const rolling = run.status === 'active' && (!stop || stop.status === 'enroute')

    if (rolling) {
      const jitter = speedJitterFor(runId, simLeg, s.generation)
      const dtSimS = dtRealS * DEMO_TIME_MULTIPLIER
      simProgress = Math.min(1, simProgress + (dtSimS * jitter) / Math.max(1, leg.duration_s))
    } else if (stop && stop.status !== 'pending') {
      simProgress = 1
    }

    const point = pointOnLeg(leg, simProgress)
    target = point.position
    targetAccuracy = 0
    if (!smoothed) smoothed = point.position
    // A simulated fix has a known-perfect bearing; take it rather than deriving
    // a movement vector from a position we already know exactly.
    heading = point.heading
    headingAnchor = point.position
  }

  /* ------------------------------------------------------------- frame -- */

  function frame(now: number): void {
    raf = requestAnimationFrame(frame)
    const dtMs = Math.min(now - (lastFrame || now), 250)
    lastFrame = now
    if (dtMs <= 0) return

    if (source === 'sim') stepSim(dtMs / 1000)

    if (!target) return
    if (!smoothed) smoothed = target

    const alpha = 1 - Math.exp(-(dtMs / 1000) / SMOOTH_TAU_S)
    const next: LngLat = [
      lerp(smoothed[0], target[0], alpha),
      lerp(smoothed[1], target[1], alpha),
    ]

    // SPEC: heading from the movement vector.
    if (source === 'device') {
      if (!headingAnchor) headingAnchor = next
      const moved = haversine(headingAnchor, next)
      if (moved >= HEADING_MIN_MOVE_M) {
        heading = lerpAngle(heading, bearing(headingAnchor, next), 0.5)
        headingAnchor = next
      }
    }

    smoothed = next

    sinceApply += dtMs
    sincePublish += dtMs

    if (sinceApply >= LOCAL_APPLY_MS) {
      sinceApply = 0
      applyGpsPing(ping())
    }
    if (sincePublish >= GPS_PUBLISH_MS) {
      sincePublish = 0
      sendGps(ping())
    }
  }

  function ping() {
    return {
      runId,
      lngLat: (smoothed ?? [0, 0]) as [number, number],
      heading,
      accuracy: source === 'sim' ? 0 : targetAccuracy,
      simulated: source === 'sim',
      at: Date.now(),
    }
  }

  /* -------------------------------------------------------------- boot -- */

  useStore.getState().setLiveRun(runId)
  if (initialSource === 'device') startDeviceWatch()
  else resetSim()
  emitStatus()
  raf = requestAnimationFrame(frame)

  return {
    setSource(next: GpsSource) {
      if (stopped || next === requested) return
      requested = next
      stopDeviceWatch()
      smoothed = null
      headingAnchor = null
      target = null
      if (next === 'device') {
        source = 'device'
        startDeviceWatch()
      } else {
        source = 'sim'
        health = 'ok'
        resetSim()
        emitStatus()
      }
    },
    stop() {
      stopped = true
      stopDeviceWatch()
      cancelAnimationFrame(raf)
      const s = useStore.getState()
      s.setLiveRun(null)
      s.setLiveFix(null)
    },
  }
}
