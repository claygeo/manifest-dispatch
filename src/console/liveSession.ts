/**
 * LIVE session entry — console side.
 *
 * SPEC.md "Live mode": the console enters or generates a session code, which
 * becomes the `session:<code>` Supabase broadcast channel; the phone joins at
 * `/driver?live=<code>` and publishes GPS; console and tracking page render it
 * through the same store.
 *
 * This module owns the console-side half that does not depend on the transport:
 * code shape, code generation, the join URL, and the hand-off into
 * `src/live/session.ts`, which owns the socket.
 *
 * On code length: 16 characters, drawn from `crypto.getRandomValues`. The code
 * IS the authorisation — there is no account, no token, no RLS predicate richer
 * than "you knew the string" — so it has to be unguessable on its own. 26^16 is
 * about 4.3e22; a six-character code would have been 3e8, which a laptop walks
 * through over lunch. The server enforces a 12-character floor for the same
 * reason. Nobody is expected to read this down a phone: the modal hands over a
 * copyable join link, and that is the intended path.
 *
 * Honesty rail: arming a session does NOT flip `store.mode` to 'live'. Until a
 * phone actually publishes a fix, the console keeps saying DEMO FLEET and the
 * sim keeps driving, because that is what is on the map.
 */

import { enterLive, leaveLive } from '../live/session'

/** Crockford-ish: no I/O/S/Z/0/1/2/5/8 — the code still has to survive being read aloud. */
export const LIVE_CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679'

/**
 * 16 characters. Also the server's contract: `live_sessions.code` carries a
 * `char_length between 12 and 64` check, so a shorter code is rejected at the
 * database rather than silently accepted.
 */
export const LIVE_CODE_LENGTH = 16

const CODE_RE = new RegExp(`^[${LIVE_CODE_ALPHABET}]{${LIVE_CODE_LENGTH}}$`)

/** Uppercase, strip separators, drop anything outside the alphabet, clamp. */
export function normalizeSessionCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .split('')
    .filter((ch) => LIVE_CODE_ALPHABET.includes(ch))
    .join('')
  return cleaned.slice(0, LIVE_CODE_LENGTH)
}

export function isValidSessionCode(code: string): boolean {
  return CODE_RE.test(code)
}

/**
 * Unguessable by construction. Rejection sampling keeps the draw uniform: a
 * plain `byte % 26` would quietly favour the first four letters of the alphabet,
 * which is exactly the kind of detail that turns a credential into a decoration.
 */
export function generateSessionCode(): string {
  const alphabet = LIVE_CODE_ALPHABET
  const limit = 256 - (256 % alphabet.length)
  const crypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined

  let out = ''
  const buffer = new Uint8Array(LIVE_CODE_LENGTH * 2)
  while (out.length < LIVE_CODE_LENGTH) {
    if (crypto?.getRandomValues) crypto.getRandomValues(buffer)
    else for (let i = 0; i < buffer.length; i++) buffer[i] = Math.floor(Math.random() * 256)
    for (let i = 0; i < buffer.length && out.length < LIVE_CODE_LENGTH; i++) {
      if (buffer[i] < limit) out += alphabet[buffer[i] % alphabet.length]
    }
  }
  return out
}

/** The URL a driver phone opens to join. Absolute so it can be read off a screen. */
export function driverJoinUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/driver?live=${code}`
}

/**
 * Arm a session from the console: register the code (so the phone's event
 * inserts pass the foreign key) and open the broadcast channel. Everything
 * after this point is `src/live/session.ts`'s problem, including failing
 * honestly — a rejected promise here would be a bug, not a network error.
 */
export function defaultEnterLive(code: string): void {
  void enterLive(code, 'console', { create: true })
}

/** Drop the armed session and return the console to plain demo mode. */
export function exitLive(): void {
  leaveLive()
}
