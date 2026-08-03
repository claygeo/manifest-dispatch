/**
 * Console discipline for map errors.
 *
 * MapLibre swallows GL and network errors unless you listen for `error`, so the
 * map canvas listens and prints them. That is right for a broken style or a bad
 * layer id and wrong for tiles: pull the network cable and a single viewport
 * fires one `AJAXError` per outstanding tile request, and every camera move
 * fires a fresh batch. Hands-off, offline, this filled the console with dozens
 * of identical `[map] AJAXError` lines within seconds — which is how a real
 * error two lines above gets scrolled into oblivion.
 *
 * So resource-fetch failures are summarised and everything else stays loud:
 *
 *   1. the FIRST failure of a burst prints in full — the outage is news, and
 *      the message carries the URL and status that make it diagnosable
 *   2. every failure after that is counted, and at most one summary line is
 *      printed per window while the condition persists
 *   3. the first success afterwards closes the burst and says how many lines
 *      were withheld, so the count is never quietly lost
 *
 * Nothing here throttles by message text: two different tile servers failing is
 * still one outage, and the summary names the latest message either way.
 */

/** One summary line at most per this long, while tiles keep failing. */
export const TILE_ERROR_WINDOW_MS = 5_000

/** The parts of a maplibre error event this module reasons about. */
export interface MapErrorReport {
  /** Error constructor name — maplibre's network failures are `AJAXError`. */
  name?: string | undefined
  message: string
  /** HTTP status, when the failure carried one. */
  status?: number | undefined
  url?: string | undefined
}

/**
 * Is this a failed resource fetch (tile, glyph, sprite) rather than a real
 * defect in the map we built?
 *
 * Deliberately generous: a style that 404s is also an `AJAXError`, and it is
 * still printed in full because it is the first of its burst. Being wrong in
 * this direction costs one summary line; being wrong the other way costs the
 * console.
 */
export function isResourceFetchError(report: MapErrorReport): boolean {
  if (report.name === 'AJAXError') return true
  if (typeof report.status === 'number' && report.status > 0) return true
  return /^AJAXError\b/.test(report.message)
}

export interface MapErrorLog {
  /** The line to print for this error, or `null` to stay quiet. */
  error(report: MapErrorReport, nowMs: number): string | null
  /** Call when a source loads successfully. Returns a recovery line, or `null`. */
  success(nowMs: number): string | null
  /** Failures counted but not printed since the last line. Test hook. */
  withheld(): number
}

export function createMapErrorLog(windowMs: number = TILE_ERROR_WINDOW_MS): MapErrorLog {
  let burstOpen = false
  let lastPrintedMs = 0
  let withheld = 0
  let withheldInBurst = 0
  let latest = ''

  return {
    error(report, nowMs) {
      // A layer id that does not exist, a bad expression, a lost GL context:
      // these are defects, they do not repeat by the dozen, and they must never
      // be summarised away.
      if (!isResourceFetchError(report)) return `[map] ${report.message}`

      latest = report.message
      if (!burstOpen) {
        burstOpen = true
        lastPrintedMs = nowMs
        withheld = 0
        withheldInBurst = 0
        return `[map] ${report.message}`
      }

      withheld += 1
      withheldInBurst += 1
      if (nowMs - lastPrintedMs < windowMs) return null

      const seconds = Math.max(1, Math.round((nowMs - lastPrintedMs) / 1000))
      const line =
        `[map] ${withheld} more resource request${withheld === 1 ? '' : 's'} failed ` +
        `in the last ${seconds}s (latest: ${latest})`
      lastPrintedMs = nowMs
      withheld = 0
      return line
    },

    success(nowMs) {
      if (!burstOpen) return null
      const total = withheldInBurst
      burstOpen = false
      withheld = 0
      withheldInBurst = 0
      lastPrintedMs = nowMs
      if (total === 0) return null
      return `[map] resource requests recovered — ${total} failure${total === 1 ? '' : 's'} not printed`
    },

    withheld: () => withheld,
  }
}
