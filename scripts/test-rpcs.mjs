#!/usr/bin/env node
/**
 * Supabase RPC contract tests — run against the REAL project.
 *
 * `npm run test:rpc`
 *
 * The vitest suite (`npm test`) covers everything that is pure: the store, the
 * sim engine, the geo/ETA maths, the seed. None of that can tell you whether
 * the server half of live mode is what src/live/session.ts believes it is. This
 * script does, by talking to the actual project with the actual publishable key
 * the browser ships — no mocks, no local Postgres, no fixtures.
 *
 * The contract under test (SPEC.md "Live mode", src/live/session.ts header):
 *
 *   api_create_session(p_code text)                          -> void
 *   api_log_event(p_code text, p_type text, p_payload jsonb)  -> void
 *   api_get_events(p_code text)                              -> setof live_events
 *
 * ...plus the property the whole design rests on: the publishable key is safe
 * to ship ONLY because the anon role has no table grants at all. If someone
 * ever runs `GRANT SELECT ON live_events TO anon` to debug something, this
 * script is what says so out loud.
 *
 * Config is read out of src/live/config.ts rather than duplicated here, so the
 * script cannot drift from what the app actually connects to.
 *
 * Exit code 0 = every check passed. Non-zero = the server contract moved.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

/* ----------------------------------------------------------------- config -- */

const CONFIG_PATH = new URL('../src/live/config.ts', import.meta.url)
const configSource = readFileSync(CONFIG_PATH, 'utf8')

function fromConfig(name) {
  const match = new RegExp(`export const ${name} = '([^']+)'`).exec(configSource)
  if (!match) {
    throw new Error(
      `Could not read ${name} from src/live/config.ts. The script reads the real ` +
        `client config on purpose — fix the regex rather than hardcoding a copy.`,
    )
  }
  return match[1]
}

const SUPABASE_URL = fromConfig('SUPABASE_URL')
const SUPABASE_KEY = fromConfig('SUPABASE_KEY')

/** Same shape the console mints (src/console/liveSession.ts). */
const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679'
const CODE_LENGTH = 16
/** The server's own floor: `char_length(p_code) between 12 and 64`. */
const SERVER_CODE_FLOOR = 12

function sessionCode() {
  let out = ''
  const bytes = new Uint8Array(CODE_LENGTH)
  globalThis.crypto.getRandomValues(bytes)
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Every code this run created, so cleanup knows exactly what it owns. */
const createdCodes = []

/* ------------------------------------------------------------- assertions -- */

let passed = 0
const failures = []
const notes = []

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failures.push(label)
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

function note(text) {
  notes.push(text)
}

const rpc = (fn, args) => client.rpc(fn, args)

/** A DeliveryEvent exactly as src/live/session.ts puts it on the wire. */
function deliveryEvent(seq, type = 'note') {
  return {
    id: `test-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    runId: 'run-a',
    stopId: 'run-a-1',
    type,
    at: new Date().toISOString(),
    meta: { order: 'MFST-4102', seq: String(seq) },
  }
}

/* ------------------------------------------------------------------ tests -- */

async function testCreateSession() {
  section('api_create_session')

  const code = sessionCode()
  const { error } = await rpc('api_create_session', { p_code: code })
  check('creates a session with a fresh 16-character code', !error, error?.message)
  if (!error) createdCodes.push(code)

  const { data, error: readError } = await rpc('api_get_events', { p_code: code })
  check('a brand-new session has an empty event log', !readError && Array.isArray(data) && data.length === 0, readError?.message ?? `got ${JSON.stringify(data)}`)

  const { error: again } = await rpc('api_create_session', { p_code: code })
  check('is idempotent — re-arming the same code does not error', !again, again?.message)

  return code
}

async function testCodeFloor() {
  section('session-code gating (the 12-character server floor)')

  const short = sessionCode().slice(0, SERVER_CODE_FLOOR - 1)
  const { error } = await rpc('api_create_session', { p_code: short })
  check('a too-short code is refused silently, not with an error', !error, error?.message)

  // The refusal has to be observable, or it is indistinguishable from success.
  const { error: logError } = await rpc('api_log_event', {
    p_code: short,
    p_type: 'note',
    p_payload: deliveryEvent('short'),
  })
  check('writing to the refused code is also a silent no-op', !logError, logError?.message)

  const { data } = await rpc('api_get_events', { p_code: short })
  check(
    'nothing was actually written under the too-short code',
    Array.isArray(data) && data.length === 0,
    `got ${JSON.stringify(data)}`,
  )
}

async function testLogAndReadEvents(code) {
  section('api_log_event / api_get_events')

  const sent = []
  for (const [seq, type] of [
    [1, 'run_started'],
    [2, 'departed'],
    [3, 'arrived'],
    [4, 'id_verified'],
    [5, 'closed'],
  ]) {
    const event = deliveryEvent(seq, type)
    sent.push(event)
    const { error } = await rpc('api_log_event', {
      p_code: code,
      p_type: event.type,
      p_payload: event,
    })
    if (error) {
      check(`logs ${type}`, false, error.message)
      return
    }
  }
  check('logs a five-event shift without error', true)

  const { data, error } = await rpc('api_get_events', { p_code: code })
  check('reads the shift back', !error && Array.isArray(data), error?.message)
  if (error || !Array.isArray(data)) return

  check('returns exactly what was written, nothing more', data.length === sent.length, `expected ${sent.length}, got ${data.length}`)

  check(
    'returns them in the order they happened',
    data.map((row) => row.payload?.meta?.seq).join(',') === sent.map((e) => e.meta.seq).join(','),
    `got ${data.map((row) => row.payload?.meta?.seq).join(',')}`,
  )

  const times = data.map((row) => Date.parse(row.at))
  check(
    'server timestamps are non-decreasing (the ORDER BY is real)',
    times.every((t, i) => i === 0 || t >= times[i - 1]),
  )

  check(
    'the event type is stored alongside the payload',
    data.map((row) => row.type).join(',') === sent.map((e) => e.type).join(','),
    data.map((row) => row.type).join(','),
  )

  const first = data[0]
  check(
    'the jsonb payload round-trips a whole DeliveryEvent',
    first.payload?.id === sent[0].id &&
      first.payload?.runId === sent[0].runId &&
      first.payload?.stopId === sent[0].stopId &&
      first.payload?.at === sent[0].at &&
      first.payload?.meta?.order === 'MFST-4102',
    JSON.stringify(first.payload),
  )

  check(
    'every row is stamped with its own session code',
    data.every((row) => row.code === code),
  )
}

async function testUnknownCodeIsANoOp() {
  section('unknown-code writes (the gate that makes a public key safe)')

  // Never registered. This is the shape of a drive-by write from someone who
  // found the publishable key in the bundle and guessed at a session.
  const unknown = sessionCode()

  const { error } = await rpc('api_log_event', {
    p_code: unknown,
    p_type: 'closed',
    p_payload: deliveryEvent('intruder', 'closed'),
  })
  check('the write returns no error — it is a silent no-op, not a rejection', !error, error?.message)

  const { data, error: readError } = await rpc('api_get_events', { p_code: unknown })
  check(
    'and nothing was written: the unknown session is still empty',
    !readError && Array.isArray(data) && data.length === 0,
    readError?.message ?? `got ${JSON.stringify(data)}`,
  )
}

async function testSessionIsolation() {
  section('session isolation')

  const codeA = sessionCode()
  const codeB = sessionCode()
  for (const code of [codeA, codeB]) {
    const { error } = await rpc('api_create_session', { p_code: code })
    if (error) {
      check('arms two sessions', false, error.message)
      return
    }
    createdCodes.push(code)
  }

  const marker = deliveryEvent('isolation', 'exception')
  await rpc('api_log_event', { p_code: codeA, p_type: marker.type, p_payload: marker })

  const { data: fromA } = await rpc('api_get_events', { p_code: codeA })
  const { data: fromB } = await rpc('api_get_events', { p_code: codeB })

  check('session A sees its own event', Array.isArray(fromA) && fromA.length === 1)
  check(
    "session B cannot see session A's events — the code IS the authorisation",
    Array.isArray(fromB) && fromB.length === 0,
    `got ${JSON.stringify(fromB)}`,
  )
}

async function testDirectTableAccessIsLockedDown() {
  section('direct table access with the publishable key')

  // SPEC.md ships this key in the browser bundle. That is only defensible if the
  // anon role can reach NOTHING except the three RPCs above.
  const attempts = [
    ['SELECT live_sessions', () => client.from('live_sessions').select('*').limit(1)],
    ['SELECT live_events', () => client.from('live_events').select('*').limit(1)],
    ['INSERT live_sessions', () => client.from('live_sessions').insert({ code: sessionCode() })],
    [
      'INSERT live_events',
      () => client.from('live_events').insert({ code: createdCodes[0] ?? sessionCode(), type: 'note', payload: {} }),
    ],
    ['UPDATE live_events', () => client.from('live_events').update({ type: 'note' }).eq('type', 'closed')],
    ['DELETE live_events', () => client.from('live_events').delete().neq('id', 0)],
    ['DELETE live_sessions', () => client.from('live_sessions').delete().neq('code', '')],
  ]

  for (const [label, run] of attempts) {
    const { error } = await run()
    check(`${label} is REJECTED`, Boolean(error), error ? undefined : 'the call succeeded — the table is exposed')
    if (error && error.code !== '42501') {
      note(`${label} was rejected with ${error.code} (${error.message}) rather than 42501 permission-denied`)
    }
  }
}

/* ---------------------------------------------------------------- cleanup -- */

/**
 * Tear down what this run created.
 *
 * There is deliberately no anon-callable delete: the three RPCs in SPEC.md are
 * the whole public surface, and handing the anon role a DELETE would mean anyone
 * who learned a live session's code could erase that shift's event log — the
 * exact "silent data loss" the offline outbox exists to prevent. So cleanup runs
 * only when a privileged key is supplied out-of-band:
 *
 *   SUPABASE_SERVICE_KEY=... npm run test:rpc
 *
 * Without it the script says what it left behind rather than pretending.
 */
async function cleanup() {
  section('cleanup')

  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) {
    console.log(
      `  SKIP  ${createdCodes.length} throwaway session(s) left in place ` +
        `(${createdCodes.join(', ')})`,
    )
    note(
      `Cleanup skipped: set SUPABASE_SERVICE_KEY to delete the ${createdCodes.length} test session(s) ` +
        `this run created. They hold no PII and count against the 2000-per-session event cap only ` +
        `within their own code.`,
    )
    return
  }

  const admin = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: eventsError } = await admin.from('live_events').delete().in('code', createdCodes)
  check('deletes the test events', !eventsError, eventsError?.message)

  const { error: sessionsError } = await admin.from('live_sessions').delete().in('code', createdCodes)
  check('deletes the test sessions', !sessionsError, sessionsError?.message)

  for (const code of createdCodes) {
    const { data } = await rpc('api_get_events', { p_code: code })
    check(`session ${code} is gone`, Array.isArray(data) && data.length === 0)
  }
}

/* ------------------------------------------------------------------- main -- */

async function main() {
  console.log(`Manifest — Supabase RPC contract tests`)
  console.log(`project: ${SUPABASE_URL}`)
  console.log(`key:     ${SUPABASE_KEY.slice(0, 20)}… (publishable, as shipped)`)
  console.log(`date:    ${new Date().toISOString()}`)

  const started = Date.now()
  const code = await testCreateSession()
  await testCodeFloor()
  await testLogAndReadEvents(code)
  await testUnknownCodeIsANoOp()
  await testSessionIsolation()
  await testDirectTableAccessIsLockedDown()
  await cleanup()

  // Honest about what this script does NOT prove.
  note(
    'NOT exercised: the 2000-event-per-session cap inside api_log_event, and the 500-row ' +
      'LIMIT inside api_get_events. Both would need thousands of sequential round trips ' +
      'against the shared project; they are asserted by reading the function bodies, not by this run.',
  )

  section('summary')
  console.log(`  ${passed} passed, ${failures.length} failed, ${((Date.now() - started) / 1000).toFixed(1)}s`)
  for (const failure of failures) console.log(`  FAILED: ${failure}`)
  if (notes.length > 0) {
    console.log('')
    for (const text of notes) console.log(`  NOTE: ${text}`)
  }

  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('\n  FATAL:', error?.message ?? error)
  process.exit(1)
})
