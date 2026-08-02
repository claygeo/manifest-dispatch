/**
 * Offline outbox.
 *
 * SPEC.md's edge-case list: "driver connectivity loss in live mode (events queue
 * locally, honest reconnect banner, no silent data loss)." Those three clauses
 * are three testable claims, and the third is the one that is easy to get wrong
 * quietly — a fire-and-forget write that fails leaves a hole in an audit trail
 * and nothing on screen says so.
 *
 * `flushQueue` takes its transport as an argument specifically so this can be
 * tested without a socket, which is the whole reason Supabase does not appear
 * anywhere in queue.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUEUE_BACKOFF_MS, QUEUE_MAX, QUEUE_STORAGE_KEY } from './config'
import { enqueueEvent, flushQueue, queueStats, retainQueue, stopFlush, type QueuedEvent } from './queue'
import { useStore } from '../store'
import type { DeliveryEvent } from '../types'

/* --------------------------------------------------------- window stub ---- */

const slots = new Map<string, string>()

/**
 * queue.ts reaches for `window.localStorage` and `window.setTimeout`. Rather
 * than pull in jsdom for two properties, stand up exactly those two — and route
 * the timers through globalThis so vitest's fake timers still work on them.
 */
const windowStub = {
  localStorage: {
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => void slots.set(key, value),
    removeItem: (key: string) => void slots.delete(key),
  },
  setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => globalThis.clearTimeout(id),
}

beforeEach(() => {
  ;(globalThis as unknown as { window: typeof windowStub }).window = windowStub
  slots.clear()
  retainQueue(null)
  stopFlush()
})

afterEach(() => {
  stopFlush()
  vi.useRealTimers()
})

/* -------------------------------------------------------------- helpers --- */

let seq = 0
function event(overrides: Partial<DeliveryEvent> = {}): DeliveryEvent {
  seq += 1
  return {
    id: `ev-${seq}`,
    runId: 'run-a',
    stopId: 'run-a-1',
    type: 'closed',
    at: new Date(1_785_000_000_000 + seq * 1_000).toISOString(),
    ...overrides,
  }
}

/**
 * Let the flush's promise chain settle. A zero-delay macrotask, so every
 * pending microtask in the flush loop has drained by the time it resolves.
 * (Only used in the real-timer tests; the backoff tests drive vitest's fake
 * timers directly.)
 */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const CODE = 'ACDEFGHJKLMNPQRT'

/* ---------------------------------------------------------------- tests --- */

describe('enqueueEvent', () => {
  it('accepts events and reports how many are still in the pipe', () => {
    enqueueEvent(CODE, event())
    enqueueEvent(CODE, event())
    expect(queueStats()).toEqual({ pending: 2, dropped: 0 })
  })

  it('mirrors the count into the store, which is what the banner reads', () => {
    enqueueEvent(CODE, event())
    enqueueEvent(CODE, event())
    expect(useStore.getState().liveQueued).toBe(2)
    retainQueue(null)
    expect(useStore.getState().liveQueued).toBe(0)
  })

  it('is idempotent per event id — the same event never goes out twice', () => {
    const duplicate = event()
    enqueueEvent(CODE, duplicate)
    enqueueEvent(CODE, duplicate)
    enqueueEvent(CODE, { ...duplicate })
    expect(queueStats().pending).toBe(1)
  })

  it('persists to localStorage, so closing the tab in a dead zone loses nothing', () => {
    enqueueEvent(CODE, event({ id: 'survives-a-reload' }))
    const raw = slots.get(QUEUE_STORAGE_KEY)
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw as string) as QueuedEvent[]
    expect(parsed).toHaveLength(1)
    expect(parsed[0].code).toBe(CODE)
    expect(parsed[0].event.id).toBe('survives-a-reload')
  })

  it('drops the OLDEST at the cap and counts what it dropped — never silently', () => {
    for (let i = 0; i < QUEUE_MAX + 5; i++) enqueueEvent(CODE, event({ id: `capped-${i}` }))
    const stats = queueStats()
    expect(stats.pending).toBe(QUEUE_MAX)
    expect(stats.dropped).toBe(5)

    const parsed = JSON.parse(slots.get(QUEUE_STORAGE_KEY) as string) as QueuedEvent[]
    expect(parsed[0].event.id).toBe('capped-5') // the first five went, in order
    expect(parsed[parsed.length - 1].event.id).toBe(`capped-${QUEUE_MAX + 4}`)
  })
})

describe('recovering the outbox after a reload', () => {
  it('picks up what the previous tab left behind', async () => {
    slots.set(
      QUEUE_STORAGE_KEY,
      JSON.stringify([
        { code: CODE, event: event({ id: 'from-the-tunnel' }) },
        { code: CODE, event: event({ id: 'also-from-the-tunnel' }) },
      ]),
    )
    vi.resetModules()
    const fresh = await import('./queue')
    expect(fresh.queueStats().pending).toBe(2)
  })

  it('starts clean on a corrupt slot rather than throwing on boot', async () => {
    slots.set(QUEUE_STORAGE_KEY, '{not json at all')
    vi.resetModules()
    const fresh = await import('./queue')
    expect(fresh.queueStats().pending).toBe(0)
  })

  it('discards entries that are not queued events', async () => {
    slots.set(
      QUEUE_STORAGE_KEY,
      JSON.stringify([{ code: CODE, event: event() }, null, 42, { code: CODE }, { event: {} }]),
    )
    vi.resetModules()
    const fresh = await import('./queue')
    expect(fresh.queueStats().pending).toBe(1)
  })
})

describe('retainQueue', () => {
  it('keeps only the session it was given', () => {
    enqueueEvent(CODE, event({ id: 'mine' }))
    enqueueEvent('SOMEOTHERSESSION', event({ id: 'theirs' }))
    retainQueue(CODE)
    expect(queueStats().pending).toBe(1)
    const parsed = JSON.parse(slots.get(QUEUE_STORAGE_KEY) as string) as QueuedEvent[]
    expect(parsed[0].event.id).toBe('mine')
  })

  it('empties everything when given no code', () => {
    enqueueEvent(CODE, event())
    retainQueue(null)
    expect(queueStats()).toEqual({ pending: 0, dropped: 0 })
  })
})

describe('flushQueue', () => {
  it('sends oldest-first — an audit trail must replay in order', async () => {
    const sent: string[] = []
    for (const id of ['a', 'b', 'c']) enqueueEvent(CODE, event({ id }))

    flushQueue(async (item) => {
      sent.push(item.event.id)
      return true
    })
    await settle()

    expect(sent).toEqual(['a', 'b', 'c'])
    expect(queueStats().pending).toBe(0)
  })

  it('calls onDrain once everything written during the outage is on record', async () => {
    const onDrain = vi.fn()
    enqueueEvent(CODE, event())
    flushQueue(async () => true, { onDrain })
    await settle()
    expect(onDrain).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onDrain when there was nothing waiting — silence is not recovery', async () => {
    const onDrain = vi.fn()
    flushQueue(async () => true, { onDrain })
    await settle()
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('stops at the first failure and keeps the rest — no silent data loss', async () => {
    const onStall = vi.fn()
    for (const id of ['a', 'b', 'c']) enqueueEvent(CODE, event({ id }))

    const attempted: string[] = []
    flushQueue(
      async (item) => {
        attempted.push(item.event.id)
        return item.event.id === 'a'
      },
      { onStall },
    )
    await settle()

    expect(attempted).toEqual(['a', 'b'])
    expect(queueStats().pending).toBe(2) // b and c are still owed
    expect(onStall).toHaveBeenCalledTimes(1)
    expect(onStall.mock.calls[0][0]).toEqual({ pending: 2, dropped: 0 })
  })

  it('treats a throwing transport as a failure, not a crash', async () => {
    enqueueEvent(CODE, event())
    const onStall = vi.fn()
    flushQueue(async () => {
      throw new Error('socket died')
    }, { onStall })
    await settle()
    expect(queueStats().pending).toBe(1)
    expect(onStall).toHaveBeenCalled()
  })

  it('resumes exactly where it stalled when the radio comes back', async () => {
    for (const id of ['a', 'b', 'c']) enqueueEvent(CODE, event({ id }))

    let online = false
    const attempted: string[] = []
    const send = async (item: QueuedEvent) => {
      attempted.push(item.event.id)
      return online
    }

    flushQueue(send)
    await settle()
    expect(queueStats().pending).toBe(3)

    online = true
    stopFlush()
    flushQueue(send)
    await settle()

    expect(queueStats().pending).toBe(0)
    // 'a' was retried rather than assumed sent
    expect(attempted.filter((id) => id === 'a').length).toBeGreaterThanOrEqual(2)
  })

  it('is a no-op while a flush is already in flight', async () => {
    enqueueEvent(CODE, event())
    let calls = 0
    const send = async () => {
      calls += 1
      await settle()
      return true
    }
    flushQueue(send)
    flushQueue(send)
    await settle()
    await settle()
    expect(calls).toBe(1)
  })

  it('retries on a backoff ladder rather than hammering a dead socket', async () => {
    vi.useFakeTimers()
    enqueueEvent(CODE, event())

    let attempts = 0
    const send = async () => {
      attempts += 1
      return false
    }

    flushQueue(send)
    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)

    // nothing happens before the first backoff elapses
    await vi.advanceTimersByTimeAsync(QUEUE_BACKOFF_MS - 1)
    expect(attempts).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(attempts).toBe(2)

    // ...and the next wait is longer than the first
    await vi.advanceTimersByTimeAsync(QUEUE_BACKOFF_MS)
    expect(attempts).toBe(2)
    await vi.advanceTimersByTimeAsync(QUEUE_BACKOFF_MS)
    expect(attempts).toBe(3)

    stopFlush()
    expect(queueStats().pending).toBe(1) // still owed, still on the record
  })

  it('stopFlush halts the ladder but keeps the queue', async () => {
    vi.useFakeTimers()
    enqueueEvent(CODE, event())
    let attempts = 0
    flushQueue(async () => {
      attempts += 1
      return false
    })
    await vi.advanceTimersByTimeAsync(0)
    stopFlush()
    await vi.advanceTimersByTimeAsync(QUEUE_BACKOFF_MS * 8)
    expect(attempts).toBe(1)
    expect(queueStats().pending).toBe(1)
  })
})
