/**
 * Sim engine — the thing a recruiter watches for the first three seconds.
 *
 * Every test here drives a hand-cranked frame clock (src/test/harness.ts), so
 * "after 25 seconds" is an exact statement rather than a race with the event
 * loop. That also makes the determinism claim testable: SPEC.md asks for
 * "deterministic-ish — seed jitter from stop index so replays feel similar but
 * not looped-video identical", which only means anything if the same seed
 * really does replay and a different one really does not.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '../store'
import { currentStop } from '../selectors'
import { dwellFor } from './eta'
import {
  framesForSimSeconds,
  ladderFor,
  ladderSnapshot,
  mountEngine,
  positionsSnapshot,
  resetStore,
  type EngineHarness,
} from '../test/harness'
import type { DeliveryEventType } from '../types'

const s = () => useStore.getState()

let harness: EngineHarness | null = null

function boot(generation = 0): EngineHarness {
  harness?.dispose()
  resetStore(generation)
  harness = mountEngine()
  return harness
}

afterEach(() => {
  harness?.dispose()
  harness = null
})

/* ------------------------------------------------------------ determinism -- */

describe('determinism', () => {
  it('replays the same fleet exactly from the same seed', () => {
    boot(0).run(400)
    const positionsA = positionsSnapshot()
    const laddersA = ladderSnapshot()

    boot(0).run(400)

    expect(positionsSnapshot()).toBe(positionsA)
    expect(ladderSnapshot()).toBe(laddersA)
  })

  it('is not a looped video — a different fleet generation drives differently', () => {
    boot(0).run(400)
    const positionsA = positionsSnapshot()

    boot(1).run(400)

    expect(positionsSnapshot()).not.toBe(positionsA)
  })

  it('is frame-rate independent in sim time: the clamp stops a backgrounded tab teleporting', () => {
    const h = boot(0)
    const before = s().simNowMs
    h.run(1, 100_000) // tab was hidden for a minute and a half
    // MAX_FRAME_MS (250 ms) × DEMO_TIME_MULTIPLIER (8) = 2 s of sim time, no more
    expect(s().simNowMs - before).toBe(2_000)
  })

  it('advances the sim clock at the demo multiplier', () => {
    const h = boot(0)
    const before = s().simNowMs
    h.run(40) // 40 × 250 ms = 10 real seconds
    expect(s().simNowMs - before).toBe(80_000) // 80 sim-seconds
  })
})

/* ------------------------------------------------------------- movement ---- */

describe('leg advancement', () => {
  it('rolls active runs along their polylines and leaves staged ones at the depot', () => {
    const h = boot(0)
    const staged = s().runOrder.find((id) => s().runs[id].status === 'staged')!
    const active = s().runOrder.find((id) => s().runs[id].status === 'active')!
    const stagedStart = s().runs[staged].position
    const activeStart = s().runs[active].position

    h.run(40) // 10 real seconds, well under the 45 s auto-dispatch

    expect(s().runs[active].position).not.toEqual(activeStart)
    expect(s().runs[staged].position).toEqual(stagedStart)
    expect(s().runs[staged].status).toBe('staged')
  })

  it('auto-dispatches a staged run after its beat, so the map never goes quiet', () => {
    const h = boot(0)
    const staged = s().runOrder.find((id) => s().runs[id].status === 'staged')!

    h.run(160) // 40 real seconds — still staged
    expect(s().runs[staged].status).toBe('staged')

    h.run(40) // past 45 real seconds
    expect(s().runs[staged].status).toBe('active')
    expect(ladderFor(s().runs[staged].stops[0])).toContain('departed')
  })

  it('keeps progress inside 0..1 and never runs off the end of the legs', () => {
    const h = boot(0)
    h.run(3_000)
    for (const runId of s().runOrder) {
      const run = s().runs[runId]
      expect(run.progress).toBeGreaterThanOrEqual(0)
      expect(run.progress).toBeLessThanOrEqual(1)
      expect(run.currentLeg).toBeGreaterThanOrEqual(0)
    }
  })

  it('stops dead when paused, and picks up where it left off', () => {
    const h = boot(0)
    h.run(20)
    const position = s().runs['run-c'].position
    const simNow = s().simNowMs

    h.engine.setPaused(true)
    h.run(200)
    expect(s().runs['run-c'].position).toEqual(position)
    expect(s().simNowMs).toBe(simNow)

    h.engine.setPaused(false)
    h.run(20)
    expect(s().runs['run-c'].position).not.toEqual(position)
  })

  it('honours the store-level pause too (the console pause control)', () => {
    const h = boot(0)
    h.run(20)
    const position = s().runs['run-c'].position
    s().setSimPaused(true)
    h.run(200)
    expect(s().runs['run-c'].position).toEqual(position)
  })
})

/* ------------------------------------------------------- the dwell ladder -- */

describe('dwell state machine', () => {
  /** Ladders the engine is allowed to produce for one stop. */
  const SUCCESS: DeliveryEventType[] = ['departed', 'arrived', 'id_verified', 'closed']
  const ID_FAILED: DeliveryEventType[] = ['departed', 'arrived', 'id_failed']

  it('plays every stop as arrive -> verify -> close, in order, with nothing skipped', () => {
    const h = boot(0)
    const runId = 'run-c'
    h.runUntil(() => s().runs[runId].status === 'complete', 6_000)
    expect(s().runs[runId].status).toBe('complete')

    for (const stopId of s().runs[runId].stops) {
      const ladder = ladderFor(stopId)
      expect([SUCCESS, ID_FAILED]).toContainEqual(ladder)
      // whichever branch it took, the law's shape held
      expect(ladder.indexOf('arrived')).toBeGreaterThan(ladder.indexOf('departed'))
      if (ladder.includes('closed')) {
        expect(ladder.indexOf('closed')).toBeGreaterThan(ladder.indexOf('id_verified'))
        expect(s().stops[stopId].idChecked).toBe(true)
        expect(s().stops[stopId].closedAt).not.toBeNull()
      } else {
        expect(s().stops[stopId].status).toBe('exception')
        expect(s().stops[stopId].idChecked).toBe(false)
      }
    }
  })

  it('honours the seeded dwell budget between arriving and verifying', () => {
    const h = boot(0)
    const runId = 'run-c'
    h.runUntil(() => s().runs[runId].status === 'complete', 6_000)

    s().runs[runId].stops.forEach((stopId, index) => {
      const events = s().events.filter((e) => e.stopId === stopId)
      const arrived = events.find((e) => e.type === 'arrived')
      const verdict = events.find((e) => e.type === 'id_verified' || e.type === 'id_failed')
      if (!arrived || !verdict) return
      const measuredS = (Date.parse(verdict.at) - Date.parse(arrived.at)) / 1000
      const planned = dwellFor(runId, index, 0).arriveS
      // the sim clock only publishes every 200 real ms (2 sim-seconds), so the
      // measurement is quantised — the assertion is that the dwell was real and
      // roughly the length the plan asked for, not that it was frame-exact
      expect(measuredS).toBeGreaterThan(0)
      expect(Math.abs(measuredS - planned)).toBeLessThan(4)
    })
  })

  it('closes the run out at the depot, once', () => {
    const h = boot(0)
    const runId = 'run-c'
    h.runUntil(() => s().runs[runId].status === 'complete', 6_000)
    const completions = s().events.filter(
      (e) => e.runId === runId && e.meta?.message?.startsWith('RUN COMPLETE'),
    )
    expect(completions).toHaveLength(1)
    expect(currentStop(s(), runId)).toBeNull()
  })

  it('logs a departure for the empty leg home', () => {
    const h = boot(0)
    const runId = 'run-c'
    h.runUntil(() => s().runs[runId].status === 'complete', 6_000)
    const depot = s().events.filter((e) => e.runId === runId && e.meta?.to === 'DEPOT')
    expect(depot).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ ETA ---- */

describe('ETA recompute', () => {
  it('only ever gets closer as the run progresses', () => {
    const h = boot(0)
    const runId = 'run-c'
    const target = s().runs[runId].stops[s().runs[runId].stops.length - 1]

    let previous = Infinity
    for (let i = 0; i < 1_200; i++) {
      h.run(1)
      const eta = s().stops[target].etaMin
      if (eta === null) break // the stop is served — ETA is retired, not raised
      expect(eta).toBeLessThanOrEqual(previous)
      previous = eta
    }
    expect(previous).toBeLessThan(Infinity)
  })

  it('retires the ETA the moment a stop leaves the queue', () => {
    const h = boot(0)
    const runId = 'run-c'
    const stopId = s().runs[runId].stops[0]
    h.runUntil(() => s().stops[stopId].status === 'delivered' || s().stops[stopId].status === 'exception', 4_000)
    h.run(5)
    expect(s().stops[stopId].etaMin).toBeNull()
  })

  it('publishes an ETA for every unserved stop on an active run', () => {
    const h = boot(0)
    h.run(framesForSimSeconds(120))
    for (const runId of s().runOrder) {
      if (s().runs[runId].status !== 'active') continue
      for (const stopId of s().runs[runId].stops) {
        const stop = s().stops[stopId]
        if (stop.status === 'delivered' || stop.status === 'exception') continue
        expect(stop.etaMin).not.toBeNull()
      }
    }
  })
})

/* -------------------------------------------------------- cancelled stop --- */

describe('order cancelled after dispatch', () => {
  it('drives past the stop without arriving, dwelling or logging', () => {
    const h = boot(0)
    const runId = 'run-c'
    const stopId = s().runs[runId].stops[0]
    expect(s().runs[runId].status).toBe('active')

    s().cancelStop(stopId)
    h.runUntil(() => s().runs[runId].currentLeg > 0, 2_000)

    expect(s().runs[runId].currentLeg).toBeGreaterThan(0)
    expect(s().stops[stopId].status).toBe('exception')
    expect(ladderFor(stopId)).not.toContain('arrived')
    expect(ladderFor(stopId)).not.toContain('id_verified')
    expect(ladderFor(stopId)).not.toContain('closed')
  })

  it('cancelled on the doorstep still never closes', () => {
    const h = boot(0)
    const runId = 'run-c'
    const stopId = s().runs[runId].stops[0]

    h.runUntil(() => s().stops[stopId].status === 'arrived', 2_000)
    expect(s().stops[stopId].status).toBe('arrived')

    s().cancelStop(stopId)
    h.runUntil(() => s().runs[runId].currentLeg > 0, 2_000)

    expect(s().stops[stopId].status).toBe('exception')
    expect(s().stops[stopId].closedAt).toBeNull()
    expect(ladderFor(stopId)).not.toContain('closed')
  })

  it('a run whose every order is cancelled still drives home and completes', () => {
    const h = boot(0)
    const runId = 'run-c'
    for (const stopId of s().runs[runId].stops) s().cancelStop(stopId)

    h.runUntil(() => s().runs[runId].status === 'complete', 6_000)

    expect(s().runs[runId].status).toBe('complete')
    for (const stopId of s().runs[runId].stops) {
      expect(ladderFor(stopId)).not.toContain('closed')
    }
  })
})

/* --------------------------------------------------------------- yields ---- */

describe('yielding a run to another engine', () => {
  it('never moves a run a live phone is publishing — and keeps the rest of the fleet alive', () => {
    const h = boot(0)
    s().setLiveRun('run-c')
    const liveStart = s().runs['run-c'].position
    const otherStart = s().runs['run-a'].position

    h.run(200)

    expect(s().runs['run-c'].position).toEqual(liveStart)
    expect(s().runs['run-a'].position).not.toEqual(otherStart)
  })

  it('never snaps a phone-reported position back onto the polyline', () => {
    const h = boot(0)
    s().setLiveRun('run-c')
    // A real phone in a real city is not on our precomputed Tampa route. The
    // engine must leave it exactly where the phone says it is — publishing
    // `pointOnLeg` here would fight the GPS feed frame for frame.
    const realWorld: [number, number] = [-82.301, 27.842]
    s().advanceRunPosition('run-c', { position: realWorld, heading: 42 })

    h.run(200)

    expect(s().runs['run-c'].position).toEqual(realWorld)
    expect(s().runs['run-c'].heading).toBe(42)
  })

  it('picks a released run back up where the phone left it, not where the sim last saw it', () => {
    const h = boot(0)
    s().setLiveRun('run-c')
    h.run(50)
    // the phone reports a position further down the leg
    s().advanceRunPosition('run-c', {
      position: s().runs['run-c'].position,
      heading: 90,
      currentLeg: 1,
      progress: 0.6,
    })
    h.run(10)
    s().setLiveRun(null)
    h.run(4)

    expect(s().runs['run-c'].currentLeg).toBe(1)
    expect(s().runs['run-c'].progress).toBeGreaterThan(0.6)
  })

  it('lets the driver app own the ladder: the engine arrives at nothing on a claimed run', () => {
    const h = boot(0)
    const runId = 'run-c'
    const stopId = s().runs[runId].stops[0]
    s().setDriverRun(runId)

    h.run(1_500)

    // the van rolls (the stop is en route from the opening plan) but the engine
    // must not press ARRIVED / VERIFY ID / CLOSE on the driver's behalf
    expect(ladderFor(stopId)).not.toContain('arrived')
    expect(s().stops[stopId].status).toBe('enroute')
    expect(s().runs[runId].progress).toBe(1)
  })

  it('parks a driver-claimed van at the door once the driver says they arrived', () => {
    const h = boot(0)
    const runId = 'run-c'
    const stopId = s().runs[runId].stops[0]
    s().setDriverRun(runId)
    s().arriveStop(stopId)

    h.run(200)

    expect(s().runs[runId].progress).toBe(1)
    expect(s().stops[stopId].status).toBe('arrived')
  })

  it('holds a driver-claimed van still while the next stop is only pending', () => {
    const h = boot(0)
    const runId = 'run-b' // staged in the opening plan
    s().setDriverRun(runId)
    const start = s().runs[runId].position

    h.run(400) // well past the 45 s auto-dispatch beat

    // no auto-dispatch while a human holds the run
    expect(s().runs[runId].status).toBe('staged')
    expect(s().runs[runId].position).toEqual(start)
  })
})

/* ---------------------------------------------------------- reset loop ----- */

describe('fleet reset loop', () => {
  it('re-stages the whole fleet a beat after the last run completes', () => {
    const h = boot(0)
    const generation = s().generation
    for (const runId of s().runOrder) s().completeRun(runId)

    h.run(8) // 2 real seconds — inside the 6 s beat
    expect(s().generation).toBe(generation)

    h.run(24) // past the beat
    expect(s().generation).toBe(generation + 1)
    for (const runId of s().runOrder) {
      expect(s().runs[runId].status).toBe('staged')
      expect(s().runs[runId].currentLeg).toBe(0)
      expect(s().runs[runId].progress).toBe(0)
    }
    for (const stop of Object.values(s().stops)) expect(stop.status).toBe('pending')
  })

  it('re-dispatches itself after the reset — an unattended tab keeps living', () => {
    const h = boot(0)
    for (const runId of s().runOrder) s().completeRun(runId)
    h.runUntil(() => s().generation > 0, 200)
    expect(s().generation).toBe(1)

    h.run(200) // past the staged auto-dispatch beat
    expect(s().runOrder.some((id) => s().runs[id].status === 'active')).toBe(true)
  })

  it('never resets under a live session — a real driver is standing in that run', () => {
    const h = boot(0)
    const generation = s().generation
    for (const runId of s().runOrder) s().completeRun(runId)
    s().setLiveRun('run-c')

    h.run(200)

    expect(s().generation).toBe(generation)
  })
})

/* --------------------------------------------------------------- teardown -- */

describe('engine lifecycle', () => {
  it('reports its own running state and stops cleanly', () => {
    const h = boot(0)
    expect(h.engine.isRunning()).toBe(true)
    h.engine.setPaused(true)
    expect(h.engine.isRunning()).toBe(false)
    h.engine.setPaused(false)
    h.engine.stop()
    expect(h.engine.isRunning()).toBe(false)
  })

  it('stops writing to the store once stopped', () => {
    const h = boot(0)
    h.run(10)
    h.engine.stop()
    const position = s().runs['run-c'].position
    h.run(100)
    expect(s().runs['run-c'].position).toEqual(position)
  })
})
