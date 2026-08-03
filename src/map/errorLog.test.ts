/**
 * Regression cover for the map console flood.
 *
 * Reproduced hands-off: with tiles unreachable, dozens of identical
 * `[map] AJAXError` lines landed in the console within seconds and buried
 * everything else. The contract asserted here is the one the fix promises —
 * the outage is announced once, summarised at most once per window while it
 * persists, closed out with the count that was withheld, and NON-tile errors
 * are never touched.
 */

import { describe, expect, it } from 'vitest'
import { createMapErrorLog, isResourceFetchError, TILE_ERROR_WINDOW_MS } from './errorLog'

const tile = (n = 1): { name: string; message: string; status: number; url: string } => ({
  name: 'AJAXError',
  message: `AJAXError: Failed to fetch (0): https://tiles.example/12/34/${n}.pbf`,
  status: 0,
  url: `https://tiles.example/12/34/${n}.pbf`,
})

describe('isResourceFetchError', () => {
  it('recognises maplibre network failures by class', () => {
    expect(isResourceFetchError({ name: 'AJAXError', message: 'whatever' })).toBe(true)
  })

  it('recognises them by message when the class is lost across a boundary', () => {
    expect(isResourceFetchError({ message: 'AJAXError: Not Found (404): /x.pbf' })).toBe(true)
  })

  it('recognises them by carried status', () => {
    expect(isResourceFetchError({ message: 'Not Found', status: 404 })).toBe(true)
  })

  it('does not swallow real defects', () => {
    expect(isResourceFetchError({ name: 'Error', message: 'Layer "mf-stop" does not exist' })).toBe(
      false,
    )
    expect(isResourceFetchError({ message: 'WebGL context lost' })).toBe(false)
  })
})

describe('createMapErrorLog — tile bursts', () => {
  it('THE BUG: a burst of tile failures produces one line, not dozens', () => {
    const log = createMapErrorLog()
    const t0 = 1_000_000
    const printed: string[] = []

    // Two seconds of an offline viewport at maplibre's request rate.
    for (let i = 0; i < 48; i++) {
      const line = log.error(tile(i), t0 + i * 40)
      if (line) printed.push(line)
    }

    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('AJAXError')
  })

  it('prints one summary per window while the outage persists', () => {
    const log = createMapErrorLog(TILE_ERROR_WINDOW_MS)
    const t0 = 0
    const printed: string[] = []

    // 30 seconds offline, a failure every 100ms.
    for (let i = 0; i < 300; i++) {
      const line = log.error(tile(i), t0 + i * 100)
      if (line) printed.push(line)
    }

    // 1 opening line + one summary per 5s window across 30s.
    expect(printed).toHaveLength(1 + 5)
    for (const line of printed.slice(1)) {
      expect(line).toMatch(/more resource requests? failed in the last \d+s/)
      expect(line).toContain('latest:')
    }
  })

  it('counts every withheld failure into the next summary', () => {
    const log = createMapErrorLog(1_000)
    log.error(tile(), 0) // opening line
    for (let i = 1; i <= 9; i++) expect(log.error(tile(i), i * 50)).toBeNull()
    expect(log.withheld()).toBe(9)
    const summary = log.error(tile(99), 1_000)
    expect(summary).toContain('10 more resource requests failed')
    expect(log.withheld()).toBe(0)
  })

  it('says how many lines it withheld once tiles come back', () => {
    const log = createMapErrorLog()
    log.error(tile(), 0)
    for (let i = 1; i < 20; i++) log.error(tile(i), i * 10)
    const recovery = log.success(500)
    expect(recovery).toContain('recovered')
    expect(recovery).toContain('19 failures not printed')
  })

  it('stays silent on a success that follows no failures', () => {
    const log = createMapErrorLog()
    expect(log.success(0)).toBeNull()
    log.error(tile(), 0)
    log.error(tile(2), 10) // one withheld, so the close-out has something to say
    expect(log.success(20)).not.toBeNull()
    expect(log.success(30)).toBeNull() // nothing left to close
  })

  it('treats a recovered-then-failed-again outage as a fresh burst', () => {
    const log = createMapErrorLog()
    expect(log.error(tile(), 0)).toContain('AJAXError')
    log.success(100)
    expect(log.error(tile(), 200)).toContain('AJAXError')
  })

  it('does not print a recovery line when nothing was withheld', () => {
    const log = createMapErrorLog()
    log.error(tile(), 0)
    expect(log.success(50)).toBeNull()
  })
})

describe('createMapErrorLog — everything else stays loud', () => {
  it('never throttles a non-resource error', () => {
    const log = createMapErrorLog()
    const printed: string[] = []
    for (let i = 0; i < 10; i++) {
      const line = log.error({ name: 'Error', message: 'WebGL context lost' }, i)
      if (line) printed.push(line)
    }
    expect(printed).toHaveLength(10)
    expect(printed[0]).toBe('[map] WebGL context lost')
  })

  it('prints a real defect in full even in the middle of a tile outage', () => {
    const log = createMapErrorLog()
    log.error(tile(), 0)
    for (let i = 1; i < 30; i++) log.error(tile(i), i * 10)
    expect(log.error({ message: 'Layer "mf-stop" does not exist' }, 310)).toBe(
      '[map] Layer "mf-stop" does not exist',
    )
  })
})
