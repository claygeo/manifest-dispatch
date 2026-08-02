/**
 * Live-mode transport constants.
 *
 * SPEC.md "Live mode": Supabase project ref `fzmbemnmcfaesrhdtwop` (us-east-1),
 * Realtime broadcast channels, gated by an unguessable session code in the URL.
 *
 * The key below is the project's **publishable** key. Publishing it is the
 * design, not an oversight: it is the anon-role credential every browser client
 * needs, and the schema behind it exposes exactly three SECURITY DEFINER RPCs
 * over two throwaway tables (`live_sessions`, `live_events`) holding no PII.
 * Reading or writing anything in a session still requires knowing the session
 * code, which is 16 random characters and never leaves the dispatcher's screen.
 *
 * Nothing in this file is imported by demo mode. The Supabase client itself is
 * loaded through a dynamic import (see ./client.ts) so a visitor who never
 * touches LIVE does not download the SDK, let alone open a socket.
 */

export const SUPABASE_URL = 'https://fzmbemnmcfaesrhdtwop.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_TCbFykoATmigwvDfDHIDIg_fj41oRcC'

/** SPEC: "phone publishes GPS at 1Hz". */
export const GPS_PUBLISH_MS = 1000

/** How long to wait for the channel to subscribe before calling it degraded. */
export const CONNECT_TIMEOUT_MS = 9_000

/** A fix older than this stops counting as live — the phone went quiet. */
export const FIX_STALE_MS = 12_000

/** Debounce on run-state snapshots so a burst of store writes sends once. */
export const SYNC_DEBOUNCE_MS = 120

/** Tail of the run's event log carried on every snapshot, for lossy-broadcast catch-up. */
export const SYNC_EVENT_TAIL = 40

/* ------------------------------------------------------- offline outbox --- */

/** Where the unsent dispatch events live across a reload. See ./queue.ts. */
export const QUEUE_STORAGE_KEY = 'manifest.live.outbox'

/**
 * Hard ceiling on queued events. A whole demo shift is ~40 events per run, so
 * 500 covers an outage far longer than any session while keeping the
 * localStorage slot small enough to write on every change.
 */
export const QUEUE_MAX = 500

/** First retry delay after a failed flush; doubles to the cap. */
export const QUEUE_BACKOFF_MS = 2_000
export const QUEUE_BACKOFF_MAX_MS = 30_000

/** SPEC: "creates `session:<code>` broadcast channel". */
export function channelFor(code: string): string {
  return `session:${code}`
}
