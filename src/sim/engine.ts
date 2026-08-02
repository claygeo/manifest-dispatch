/**
 * Sim engine — the heart of the demo.
 *
 * Drives the SAME store actions the live (Supabase) engine will call. The UI
 * cannot tell the difference; that is the whole point.
 *
 * Behaviour is fixed by SPEC.md "Sim engine":
 *  - advances each active run along its precomputed OSRM legs at the leg's real
 *    speed × DEMO_TIME_MULTIPLIER (8×), with ±15% seeded speed jitter
 *  - 20–75 s dwell per stop, played as arrive -> id_check -> delivered
 *  - runs are staggered: one mid-progress at load, one staged, one just starting
 *  - when the whole fleet completes it resets to staged and re-dispatches after
 *    a short beat, so an unattended tab always shows a living system
 *  - emits DeliveryEvents; ETAs recompute from remaining leg durations
 *
 * requestAnimationFrame-driven, pausable, and it cleans up after itself.
 */

import { useStore } from '../store'
import { legsFor } from '../data/seed'
import { pointOnLeg, hashSeed, rng, type PreparedLeg } from './geo'
import { DEMO_TIME_MULTIPLIER, dwellFor, etaMinutesTo, speedJitterFor } from './eta'
import { stepDriverRun } from '../driver/manualDrive'

/** Store writes per second. Mimics a 5 Hz GPS feed; the map lerps between them. */
const PUBLISH_INTERVAL_MS = 200

/** Clamp so a backgrounded tab does not teleport the fleet on resume. */
const MAX_FRAME_MS = 250

/** Real milliseconds a staged run waits before dispatching itself. */
const STAGED_AUTO_DISPATCH_MS = 45_000

/** Real milliseconds between "fleet complete" and the re-dispatch. */
const RESET_BEAT_MS = 6_000

/** Seeded odds that a stop fails its ID check — the honest source of amber. */
const ID_FAIL_ODDS = 0.08

export type Phase = 'idle' | 'driving' | 'dwell_arrive' | 'dwell_id' | 'dwell_close' | 'done'

export interface RunSim {
  runId: string
  legs: PreparedLeg[]
  stopCount: number
  phase: Phase
  legIndex: number
  progress: number
  dwellRemainingS: number
  stagedElapsedMs: number
  /** true when the current stop failed ID verification — skip the close step */
  currentFailed: boolean
}

export interface SimEngine {
  start: () => void
  stop: () => void
  setPaused: (paused: boolean) => void
  isRunning: () => boolean
}

function idFails(runId: string, stopIndex: number, generation: number): boolean {
  return rng(hashSeed(`${runId}#${stopIndex}#idcheck#${generation}`))() < ID_FAIL_ODDS
}

export function createSimEngine(): SimEngine {
  let raf = 0
  let running = false
  let paused = false
  let lastFrame = 0
  let sincePublish = 0
  let pendingSimMs = 0
  let generation = -1
  let sims: RunSim[] = []
  let completeSince: number | null = null

  const store = () => useStore.getState()

  function resync(): void {
    const s = store()
    generation = s.generation
    completeSince = null
    sims = s.runOrder.map((runId) => {
      const run = s.runs[runId]
      const legs = legsFor(runId)
      return {
        runId,
        legs,
        stopCount: run.stops.length,
        phase: run.status === 'active' ? 'driving' : run.status === 'complete' ? 'done' : 'idle',
        legIndex: run.currentLeg,
        progress: run.progress,
        dwellRemainingS: 0,
        stagedElapsedMs: 0,
        currentFailed: false,
      }
    })
  }

  function stopIdAt(runId: string, legIndex: number): string | null {
    const run = store().runs[runId]
    if (!run) return null
    return run.stops[legIndex] ?? null
  }

  function publish(): void {
    const s = store()
    const etas: Record<string, number | null> = {}
    for (const sim of sims) {
      const run = s.runs[sim.runId]
      if (!run) continue
      // A live run's position comes off a phone, not off a polyline. Publishing
      // pointOnLeg here would fight the GPS feed frame for frame; the live
      // engine recomputes this run's ETAs itself from the projected progress.
      if (s.liveRunId === sim.runId) continue
      if (run.status === 'active') {
        const leg = sim.legs[Math.min(sim.legIndex, sim.legs.length - 1)]
        const { position, heading } = pointOnLeg(leg, sim.progress)
        s.advanceRunPosition(sim.runId, {
          position,
          heading,
          currentLeg: sim.legIndex,
          progress: sim.progress,
        })
        run.stops.forEach((stopId, i) => {
          const stop = s.stops[stopId]
          if (!stop) return
          if (stop.status === 'delivered' || stop.status === 'exception') {
            etas[stopId] = null
            return
          }
          etas[stopId] = etaMinutesTo(sim.legs, sim.legIndex, sim.progress, i)
        })
      }
    }
    if (Object.keys(etas).length > 0) s.setStopEtas(etas)
  }

  /**
   * Roll the queue pointer to the next leg — the tail every dwell ends with,
   * and the whole of what a skipped stop gets.
   */
  function nextLeg(sim: RunSim): void {
    const s = store()
    sim.legIndex += 1
    if (sim.legIndex >= sim.legs.length) {
      s.completeRun(sim.runId)
      sim.phase = 'done'
      return
    }
    beginLeg(sim)
  }

  /**
   * SPEC edge case: an order cancelled after dispatch, or any stop a dispatcher
   * flagged while the van was still rolling toward it.
   *
   * Before this existed the engine drove to the stop and called
   * `setStopStatus(id, 'arrived')` regardless, which silently overwrote the
   * exception and then verified and closed a stop nobody was going to serve.
   * Now the van drives the leg it is already on — the polyline for the NEXT leg
   * starts at this stop's kerb, so there is no honest way to cut the corner —
   * and then rolls straight through without arriving, dwelling or logging.
   */
  function skipIfCancelled(sim: RunSim, stopId: string): boolean {
    const stop = store().stops[stopId]
    if (!stop || stop.status !== 'exception') return false
    nextLeg(sim)
    return true
  }

  function beginLeg(sim: RunSim): void {
    const s = store()
    sim.progress = 0
    sim.phase = 'driving'
    sim.currentFailed = false
    const stopId = stopIdAt(sim.runId, sim.legIndex)
    if (stopId) {
      const stop = s.stops[stopId]
      // Only a stop still waiting to be served becomes en route. A stop that
      // was cancelled (or flagged) before the van left the previous kerb must
      // keep its exception — writing `enroute` over it would resurrect an order
      // nobody is going to deliver, and the arrival guard downstream reads the
      // status to decide whether to skip.
      if (stop?.status === 'pending') s.setStopStatus(stopId, 'enroute')
      s.logEvent({
        runId: sim.runId,
        stopId,
        type: 'departed',
        meta: { to: stop?.orderCode ?? stopId },
      })
    } else {
      s.logEvent({ runId: sim.runId, stopId: null, type: 'departed', meta: { to: 'DEPOT' } })
    }
  }

  function stepRun(sim: RunSim, dtSimS: number, dtRealMs: number): void {
    const s = store()
    const run = s.runs[sim.runId]
    if (!run) return

    // A phone is publishing GPS for this run over a live session. Hands off
    // completely: position, ladder and events all arrive over the channel. Keep
    // this sim's mirror aligned with the store while it waits, so that when the
    // phone drops off the engine picks the run up where the driver left it
    // instead of teleporting it back to a stale leg.
    if (s.liveRunId === sim.runId) {
      sim.legIndex = run.currentLeg
      sim.progress = run.progress
      sim.phase = run.status === 'active' ? 'driving' : run.status === 'complete' ? 'done' : 'idle'
      return
    }

    // The driver app has claimed this run. It owns depart/arrive/verify/close;
    // the engine only rolls the van down the leg the driver departed on.
    if (s.driverRunId === sim.runId) {
      stepDriverRun(sim, dtSimS, generation, s)
      return
    }

    if (run.status === 'staged') {
      sim.stagedElapsedMs += dtRealMs
      if (sim.stagedElapsedMs >= STAGED_AUTO_DISPATCH_MS) {
        sim.stagedElapsedMs = 0
        s.startRun(sim.runId)
        sim.phase = 'driving'
        sim.legIndex = 0
        sim.progress = 0
      }
      return
    }

    if (run.status === 'complete') {
      sim.phase = 'done'
      return
    }

    // status is active — a dispatcher may have started it from the console
    if (sim.phase === 'idle') {
      sim.phase = 'driving'
      sim.legIndex = run.currentLeg
      sim.progress = run.progress
    }

    switch (sim.phase) {
      case 'driving': {
        const leg = sim.legs[sim.legIndex]
        if (!leg) {
          s.completeRun(sim.runId)
          sim.phase = 'done'
          return
        }
        const jitter = speedJitterFor(sim.runId, sim.legIndex, generation)
        sim.progress += (dtSimS * jitter) / Math.max(1, leg.duration_s)
        if (sim.progress < 1) return

        sim.progress = 1
        const stopId = stopIdAt(sim.runId, sim.legIndex)
        if (!stopId) {
          // last leg — back at the depot
          s.completeRun(sim.runId)
          sim.phase = 'done'
          return
        }
        if (skipIfCancelled(sim, stopId)) return
        // Window compliance is judged inside the action, once, and written to
        // the event log — see store.arriveStop.
        s.arriveStop(stopId)
        sim.dwellRemainingS = dwellFor(sim.runId, sim.legIndex, generation).arriveS
        sim.phase = 'dwell_arrive'
        return
      }

      case 'dwell_arrive': {
        sim.dwellRemainingS -= dtSimS
        if (sim.dwellRemainingS > 0) return
        const stopId = stopIdAt(sim.runId, sim.legIndex)
        if (!stopId) {
          sim.phase = 'driving'
          return
        }
        // Cancelled on the doorstep, between arriving and the ID check.
        if (skipIfCancelled(sim, stopId)) return
        const failed = idFails(sim.runId, sim.legIndex, generation)
        sim.currentFailed = failed
        s.verifyId(stopId, !failed)
        sim.dwellRemainingS = dwellFor(sim.runId, sim.legIndex, generation).idCheckS
        sim.phase = 'dwell_id'
        return
      }

      case 'dwell_id': {
        sim.dwellRemainingS -= dtSimS
        if (sim.dwellRemainingS > 0) return
        const stopId = stopIdAt(sim.runId, sim.legIndex)
        // A cancellation that lands after the ID check would otherwise close a
        // stop nobody served: `closeStop` only requires `idChecked`, which is
        // true by now. The ID-fail path keeps its own dwell — that exception is
        // this engine's own, and cutting it short would make the failure blink
        // past on the console.
        if (stopId && !sim.currentFailed && skipIfCancelled(sim, stopId)) return
        if (stopId && !sim.currentFailed) s.closeStop(stopId)
        sim.dwellRemainingS = dwellFor(sim.runId, sim.legIndex, generation).closeS
        sim.phase = 'dwell_close'
        return
      }

      case 'dwell_close': {
        sim.dwellRemainingS -= dtSimS
        if (sim.dwellRemainingS > 0) return
        nextLeg(sim)
        return
      }

      case 'done':
      default:
        return
    }
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame)
    const dtRealMs = Math.min(now - lastFrame, MAX_FRAME_MS)
    lastFrame = now
    if (dtRealMs <= 0) return

    const s = store()
    if (s.generation !== generation) resync()
    // Deliberately NOT gated on `mode`. A live session takes over exactly one
    // run (see `liveRunId` above); freezing the other two would leave a
    // dispatcher staring at a dead map the moment a real phone connects.
    if (paused || s.simPaused) return

    const dtSimS = (dtRealMs / 1000) * DEMO_TIME_MULTIPLIER

    for (const sim of sims) stepRun(sim, dtSimS, dtRealMs)

    sincePublish += dtRealMs
    pendingSimMs += dtSimS * 1000
    if (sincePublish >= PUBLISH_INTERVAL_MS) {
      sincePublish = 0
      const advanceBy = pendingSimMs
      pendingSimMs = 0
      useStore.setState((prev) => ({ simNowMs: prev.simNowMs + advanceBy }))
      publish()
    }

    // fleet reset loop — an unattended tab always shows a living system.
    // Suspended during a live session: re-seeding the fleet would throw away
    // the run a real driver is standing in the middle of.
    const allDone =
      s.liveRunId === null && s.runOrder.every((id) => s.runs[id]?.status === 'complete')
    if (allDone) {
      if (completeSince === null) completeSince = now
      else if (now - completeSince >= RESET_BEAT_MS) {
        completeSince = null
        s.resetFleet()
      }
    } else {
      completeSince = null
    }
  }

  return {
    start() {
      if (running) return
      running = true
      paused = false
      lastFrame = performance.now()
      sincePublish = 0
      pendingSimMs = 0
      resync()
      raf = requestAnimationFrame(frame)
    },
    stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      sims = []
    },
    setPaused(next: boolean) {
      paused = next
      lastFrame = performance.now()
    },
    isRunning() {
      return running && !paused
    },
  }
}
