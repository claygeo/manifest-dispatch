/**
 * Test harness — a deterministic world for the store and the sim engine.
 *
 * Two jobs:
 *
 *  1. `resetStore()` — the store is a module singleton (one fleet, built at
 *     import time). Tests need a known fleet at a known clock, so this rebuilds
 *     it from `buildFleet(generation, nowMs)` and clears every session field.
 *     Same inputs, same fleet, every run.
 *
 *  2. `mountEngine()` — the sim engine is requestAnimationFrame-driven. Rather
 *     than letting a real rAF decide how much sim time passes (which would make
 *     every timing assertion a race), this swaps in a hand-cranked frame pump
 *     and a fake `performance.now`. `run(frames, stepMs)` is then an exact
 *     statement about elapsed time: 100 frames of 250 ms is 25 real seconds,
 *     which at DEMO_TIME_MULTIPLIER is 200 sim-seconds. Nothing here is flaky.
 */

import { vi } from 'vitest'
import { useStore } from '../store'
import { buildFleet, type Fleet } from '../data/seed'
import { createSimEngine, type SimEngine } from '../sim/engine'
import { DEMO_TIME_MULTIPLIER } from '../sim/eta'
import type { DeliveryEventType } from '../types'

/** Fixed wall clock for every test. Mid-shift, well clear of a DST seam. */
export const FIXED_NOW = Date.parse('2026-08-02T14:00:00.000Z')

/** The engine's own frame clamp — the largest useful step per frame. */
export const MAX_STEP_MS = 250

/** Real milliseconds needed to burn `simSeconds` of sim time at max step. */
export function framesForSimSeconds(simSeconds: number, stepMs = MAX_STEP_MS): number {
  const simSecondsPerFrame = (stepMs / 1000) * DEMO_TIME_MULTIPLIER
  return Math.ceil(simSeconds / simSecondsPerFrame)
}

/**
 * Rebuild the fleet deterministically and clear session state.
 * Returns the fleet so a test can assert against the seed it was given.
 */
export function resetStore(generation = 0, nowMs: number = FIXED_NOW): Fleet {
  const fleet = buildFleet(generation, nowMs)
  useStore.setState({
    selection: null,
    mode: 'demo',
    simPaused: false,
    liveStatus: 'off',
    liveCode: null,
    liveQueued: 0,
    driverRunId: null,
    liveRunId: null,
    liveFix: null,
  })
  useStore.getState().hydrateFleet(fleet, generation)
  return fleet
}

export interface EngineHarness {
  engine: SimEngine
  /** Pump `frames` animation frames of `stepMs` real ms each. */
  run: (frames: number, stepMs?: number) => void
  /** Pump until `predicate` holds or the frame budget runs out. Returns whether it held. */
  runUntil: (predicate: () => boolean, maxFrames?: number, stepMs?: number) => boolean
  dispose: () => void
}

interface RafGlobals {
  requestAnimationFrame?: (cb: (t: number) => void) => number
  cancelAnimationFrame?: (id: number) => void
}

/**
 * Start the sim engine against a hand-cranked frame pump.
 * ALWAYS pair with `dispose()` (an `afterEach`) — the engine re-registers a
 * frame callback on every tick and would otherwise leak into the next test.
 */
export function mountEngine(): EngineHarness {
  const g = globalThis as unknown as RafGlobals
  const prevRaf = g.requestAnimationFrame
  const prevCancel = g.cancelAnimationFrame

  let pending: ((t: number) => void) | null = null
  let clock = 0

  g.requestAnimationFrame = (cb) => {
    pending = cb
    return 1
  }
  g.cancelAnimationFrame = () => {
    pending = null
  }

  const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock)

  const engine = createSimEngine()
  engine.start()

  function pump(stepMs: number): boolean {
    const cb = pending
    if (!cb) return false
    clock += stepMs
    cb(clock)
    return true
  }

  return {
    engine,
    run(frames, stepMs = MAX_STEP_MS) {
      for (let i = 0; i < frames; i++) if (!pump(stepMs)) break
    },
    runUntil(predicate, maxFrames = 20_000, stepMs = MAX_STEP_MS) {
      for (let i = 0; i < maxFrames; i++) {
        if (predicate()) return true
        if (!pump(stepMs)) break
      }
      return predicate()
    },
    dispose() {
      engine.stop()
      nowSpy.mockRestore()
      g.requestAnimationFrame = prevRaf
      g.cancelAnimationFrame = prevCancel
      pending = null
    },
  }
}

/* ------------------------------------------------------------- readers ---- */

/** Event types logged against one stop, oldest first. The delivery ladder. */
export function ladderFor(stopId: string): DeliveryEventType[] {
  return useStore
    .getState()
    .events.filter((e) => e.stopId === stopId)
    .map((e) => e.type)
}

/** Every run position in the fleet, as a comparable snapshot. */
export function positionsSnapshot(): string {
  const s = useStore.getState()
  return s.runOrder
    .map((id) => {
      const r = s.runs[id]
      return `${id}:${r.status}:${r.currentLeg}:${r.progress.toFixed(9)}:${r.position[0].toFixed(
        9,
      )},${r.position[1].toFixed(9)}:${r.heading.toFixed(6)}`
    })
    .join('|')
}

/** Every stop's compliance-relevant state, as a comparable snapshot. */
export function ladderSnapshot(): string {
  const s = useStore.getState()
  return Object.keys(s.stops)
    .sort()
    .map((id) => {
      const stop = s.stops[id]
      return `${id}:${stop.status}:${stop.idChecked ? 1 : 0}:${stop.etaMin ?? '-'}`
    })
    .join('|')
}
