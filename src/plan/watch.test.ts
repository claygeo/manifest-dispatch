/**
 * The planner's watch panel has three ends, not two.
 *
 * The bug: the panel branched on "is the run still in the store", so it said
 * "Your run is driving." from dispatch right through completion and only
 * changed when the demo fleet's loop deleted the run minutes later. The one
 * moment the planner had an outcome to report — every stop closed, the van back
 * at the depot — it reported motion instead.
 *
 * These tests drive the real run through the real sim engine and read the panel
 * off the same store the component reads, so a regression in the engine's
 * completion path fails here too. The pure derivation is then pinned separately
 * against hand-written keys, including the ones the engine is unlikely to
 * produce on demand.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '../store'
import { completionNote, describeWatch, watchKey } from './watch'
import { dispatchPlannedRun, poolOrders } from './planRun'
import { mountEngine, resetStore, type EngineHarness } from '../test/harness'

let harness: EngineHarness | null = null

afterEach(() => {
  harness?.dispose()
  harness = null
})

function watchFor(runId: string | null) {
  return describeWatch(watchKey(useStore.getState(), runId))
}

describe('the watch panel follows the run to its end', () => {
  it('says driving while the run is driving, and complete once it is', () => {
    resetStore()
    harness = mountEngine()

    const dispatched = dispatchPlannedRun(['run-a-1', 'run-b-1'], poolOrders(useStore.getState().simNowMs), {
      suggestedS: 0,
      naiveS: 0,
    })

    harness.run(4)
    const driving = watchFor(dispatched.runId)
    expect(driving.kind).toBe('driving')
    expect(driving.headline).toBe('Your run is driving.')
    expect(driving.total).toBe(2)

    const finished = harness.runUntil(
      () => useStore.getState().runs[dispatched.runId]?.status === 'complete',
      12_000,
    )
    expect(finished, 'the planned run never completed').toBe(true)

    const done = watchFor(dispatched.runId)
    expect(done.kind).toBe('complete')
    expect(done.headline).toBe('Run complete.')
    // every stop is accounted for, one way or the other
    expect(done.served).toBe(done.total)
    expect(done.closed + done.exceptions).toBe(2)
    // no stale ETA hanging off a finished run
    expect(done.etaMin).toBeNull()
  }, 30_000)

  it('counts closed as delivered — an exception is not a close', () => {
    resetStore()
    const dispatched = dispatchPlannedRun(['run-a-1', 'run-b-1', 'run-c-1'], poolOrders(useStore.getState().simNowMs), {
      suggestedS: 0,
      naiveS: 0,
    })
    const s = useStore.getState()

    // one delivered through the legal ladder, one refused, one left open
    s.arriveStop(dispatched.stopIds[0])
    s.verifyId(dispatched.stopIds[0], true)
    s.closeStop(dispatched.stopIds[0])
    s.flagException(dispatched.stopIds[1], 'no_answer')

    const watch = watchFor(dispatched.runId)
    expect(watch.closed).toBe(1)
    expect(watch.exceptions).toBe(1)
    expect(watch.served).toBe(2)
    expect(watch.total).toBe(3)
    expect(watch.kind).toBe('driving')
  })

  it('goes honest the moment the fleet reset takes the run away', () => {
    resetStore()
    const dispatched = dispatchPlannedRun(['run-a-1'], poolOrders(useStore.getState().simNowMs), {
      suggestedS: 0,
      naiveS: 0,
    })
    expect(watchFor(dispatched.runId).kind).toBe('driving')

    useStore.getState().resetFleet()

    const gone = watchFor(dispatched.runId)
    expect(gone.kind).toBe('gone')
    expect(gone.headline).toBe('The demo fleet reset — plan another?')
    expect(watchKey(useStore.getState(), dispatched.runId)).toBe('')
  })

  it('reports the next open stop, not a closed one', () => {
    resetStore()
    const dispatched = dispatchPlannedRun(['run-a-1', 'run-b-1'], poolOrders(useStore.getState().simNowMs), {
      suggestedS: 0,
      naiveS: 0,
    })
    const s = useStore.getState()
    s.setStopEta(dispatched.stopIds[0], 3)
    s.setStopEta(dispatched.stopIds[1], 17)
    expect(watchFor(dispatched.runId).etaMin).toBe(3)

    s.arriveStop(dispatched.stopIds[0])
    s.verifyId(dispatched.stopIds[0], true)
    s.closeStop(dispatched.stopIds[0])
    expect(watchFor(dispatched.runId).etaMin).toBe(17)
  })
})

describe('the watch key only moves when the panel would', () => {
  it('is stable across a position publish and changes on a real event', () => {
    resetStore()
    const dispatched = dispatchPlannedRun(['run-a-1', 'run-b-1'], poolOrders(useStore.getState().simNowMs), {
      suggestedS: 0,
      naiveS: 0,
    })
    const before = watchKey(useStore.getState(), dispatched.runId)

    // the 5 Hz publish the planner deliberately does not re-render for
    useStore.getState().advanceRunPosition(dispatched.runId, {
      position: [-82.46, 27.95],
      heading: 91,
      progress: 0.42,
    })
    expect(watchKey(useStore.getState(), dispatched.runId)).toBe(before)

    useStore.getState().setStopEta(dispatched.stopIds[0], 9)
    expect(watchKey(useStore.getState(), dispatched.runId)).not.toBe(before)
  })

  it('is empty for no run and for an id nothing on the board carries', () => {
    resetStore()
    expect(watchKey(useStore.getState(), null)).toBe('')
    expect(watchKey(useStore.getState(), 'plan-does-not-exist')).toBe('')
  })
})

describe('the derivation', () => {
  it('is total — every key it can be handed produces a state', () => {
    expect(describeWatch('').kind).toBe('gone')
    expect(describeWatch('active|0|0|4|12').kind).toBe('driving')
    expect(describeWatch('staged|0|0|4|-').kind).toBe('driving')
    expect(describeWatch('complete|4|0|4|-').kind).toBe('complete')
    // a key from a future status string still lands somewhere sane
    expect(describeWatch('nonsense|1|0|2|-').kind).toBe('driving')
    expect(describeWatch('active|0|0|1|-').etaMin).toBeNull()
  })

  it('never prints a celebration, and never hides an exception', () => {
    const clean = describeWatch('complete|4|0|4|-')
    expect(clean.headline).toBe('Run complete.')
    expect(completionNote(clean)).toContain('4 of 4 stops closed')
    expect(completionNote(clean)).not.toMatch(/!|congrat|nice work|great/i)

    const messy = describeWatch('complete|3|1|4|-')
    expect(messy.closed).toBe(3)
    expect(messy.exceptions).toBe(1)
    expect(completionNote(messy)).toContain('3 of 4 stops closed')
    expect(completionNote(messy)).toContain('1 came back undelivered')
  })

  it('counts a single stop in the singular', () => {
    expect(completionNote(describeWatch('complete|1|0|1|-'))).toContain('1 of 1 stop closed')
    expect(completionNote(describeWatch('complete|0|2|2|-'))).toContain('2 came back undelivered')
  })
})
