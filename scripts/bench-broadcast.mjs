/**
 * bench-broadcast — Supabase Realtime Broadcast fan-out, measured against the
 * REAL project (SPEC.md "Measured load proof").
 *
 * What it does
 *   For each tier N: open one broadcast channel, join N publisher clients and
 *   one subscriber client, have every publisher send a GPS-shaped payload at
 *   1 Hz for `--seconds`, and timestamp delivery at the subscriber.
 *
 * How latency is measured — and why it is trustworthy
 *   Every ping carries `t0`, a `performance.now()` reading taken by the
 *   publisher immediately before `channel.send`. The subscriber takes a second
 *   `performance.now()` reading in its broadcast handler and subtracts.
 *   Publishers and subscriber run in the SAME node process, so both readings
 *   come off the same monotonic clock: there is no clock skew to correct for
 *   and no NTP assumption baked into the numbers. The cost of that choice is
 *   that the figure is a round trip through Supabase from one machine, not a
 *   phone-to-console wall-clock latency — a real deployment adds each device's
 *   own network leg. Said plainly in BENCHMARKS.md rather than papered over.
 *
 * Topology caveat (also in BENCHMARKS.md)
 *   Publishers JOIN the channel over a WebSocket, exactly like the driver app
 *   does (src/live/session.ts), rather than posting over the HTTP broadcast
 *   endpoint. That is faithful to the client, and it means the server also
 *   fans every ping out to the other N-1 publishers. The script counts that
 *   inbound volume and reports it, because it is the difference between the
 *   50 msg/s this test asks Supabase to accept and the ~2.5k msg/s it asks
 *   Supabase to deliver. Manifest's own topology is one channel per session
 *   (one phone + console + tracking page); N publishers on ONE channel is a
 *   deliberate stress shape, not the product's shape.
 *
 * Usage
 *   npm run bench:broadcast
 *   node scripts/bench-broadcast.mjs --tiers 10,25,50 --seconds 25
 *
 * Credentials are read out of src/live/config.ts so this file never becomes a
 * second place the project URL and publishable key can drift.
 */

import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/* ------------------------------------------------------------------ args -- */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const TIERS = arg('tiers', '10,25,50')
  .split(',')
  .map((n) => parseInt(n.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0)
const SECONDS = parseInt(arg('seconds', '25'), 10)
const PUBLISH_MS = parseInt(arg('hz-ms', '1000'), 10)
/** Grace after the last send, so in-flight messages are counted, not lost. */
const DRAIN_MS = 3_000
/** Channel joins are batched so a tier does not open 50 sockets in one tick. */
const JOIN_WAVE = 10
const JOIN_WAVE_GAP_MS = 250
const SUBSCRIBE_TIMEOUT_MS = 20_000

/* ---------------------------------------------------------- credentials -- */

function readConfig() {
  const src = readFileSync(resolve(ROOT, 'src/live/config.ts'), 'utf8')
  const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(src)?.[1]
  const key = /SUPABASE_KEY\s*=\s*'([^']+)'/.exec(src)?.[1]
  if (!url || !key) throw new Error('bench: could not read SUPABASE_URL/KEY from src/live/config.ts')
  return { url, key }
}

const { url: SUPABASE_URL, key: SUPABASE_KEY } = readConfig()

/* ----------------------------------------------------------------- util -- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

function round(n) {
  return n === null ? null : Math.round(n * 10) / 10
}

function newClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Same client-side throttle the app ships with (src/live/client.ts).
    realtime: { params: { eventsPerSecond: 10 } },
  })
}

/** Join a channel and resolve on SUBSCRIBED, or reject on error/timeout. */
function join(channel) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('SUBSCRIBE_TIMEOUT')), SUBSCRIBE_TIMEOUT_MS)
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        resolvePromise(channel)
        return
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timer)
        reject(new Error(`${status}${err ? `: ${err.message ?? err}` : ''}`))
      }
    })
  })
}

/** Tampa-ish coordinates, so payload size matches a real GpsPing. */
function fakeFix(i, seq) {
  const lon = -82.4572 + Math.sin((i + seq) / 7) * 0.02
  const lat = 27.9506 + Math.cos((i + seq) / 9) * 0.02
  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))]
}

/* ------------------------------------------------------------------ tier -- */

async function runTier(n) {
  const topic = `session:bench-${n}-${Math.random().toString(36).slice(2, 10)}`
  process.stdout.write(`\n[N=${n}] topic ${topic}\n`)

  const latencies = []
  const seen = new Set()
  let duplicates = 0
  let malformed = 0
  let publisherInbound = 0

  /* --- subscriber first: nothing should be on the wire before it listens --- */
  const subClient = newClient()
  const subChannel = subClient.channel(topic, { config: { broadcast: { self: false, ack: false } } })
  subChannel.on('broadcast', { event: 'gps' }, ({ payload }) => {
    const t1 = performance.now()
    if (!payload || typeof payload.t0 !== 'number') {
      malformed += 1
      return
    }
    const key = `${payload.p}:${payload.s}`
    if (seen.has(key)) {
      duplicates += 1
      return
    }
    seen.add(key)
    latencies.push(t1 - payload.t0)
  })

  const clients = [subClient]
  const channels = [subChannel]

  try {
    await join(subChannel)
  } catch (err) {
    await teardown(clients, channels)
    return { n, topic, ok: false, error: `subscriber join failed: ${err.message}` }
  }

  /* --- publishers, joined in waves like N phones coming online --- */
  const publishers = []
  const joinErrors = []
  for (let base = 0; base < n; base += JOIN_WAVE) {
    const wave = []
    for (let i = base; i < Math.min(base + JOIN_WAVE, n); i += 1) {
      const client = newClient()
      const channel = client.channel(topic, { config: { broadcast: { self: false, ack: false } } })
      // Counter only. The client parses every inbound frame whether or not a
      // handler exists, so this makes the fan-out visible for ~free.
      channel.on('broadcast', { event: 'gps' }, () => {
        publisherInbound += 1
      })
      clients.push(client)
      channels.push(channel)
      wave.push(
        join(channel).then(
          () => publishers.push({ i, channel }),
          (err) => joinErrors.push(`pub ${i}: ${err.message}`),
        ),
      )
    }
    await Promise.all(wave)
    if (base + JOIN_WAVE < n) await sleep(JOIN_WAVE_GAP_MS)
  }

  if (publishers.length === 0) {
    await teardown(clients, channels)
    return { n, topic, ok: false, error: `no publisher joined (${joinErrors[0] ?? 'unknown'})` }
  }

  process.stdout.write(
    `[N=${n}] joined ${publishers.length}/${n} publishers` +
      `${joinErrors.length ? ` (${joinErrors.length} failed)` : ''} — publishing ${SECONDS}s\n`,
  )

  /* --- 1 Hz publish, staggered across the second like independent phones --- */
  let sent = 0
  let sendErrors = 0
  const timers = []
  const startedAt = performance.now()

  for (const pub of publishers) {
    const offset = Math.round((pub.i / publishers.length) * PUBLISH_MS)
    let seq = 0
    const kick = setTimeout(() => {
      const tick = () => {
        seq += 1
        const s = seq
        const payload = {
          // GpsPing shape — src/live/protocol.ts
          runId: `run-bench-${pub.i}`,
          lngLat: fakeFix(pub.i, s),
          heading: (pub.i * 7 + s * 3) % 360,
          accuracy: 8,
          simulated: true,
          at: Date.now(),
          // bench-only fields
          p: pub.i,
          s,
          t0: performance.now(),
        }
        sent += 1
        Promise.resolve(pub.channel.send({ type: 'broadcast', event: 'gps', payload })).then(
          (res) => {
            if (res !== 'ok') sendErrors += 1
          },
          () => {
            sendErrors += 1
          },
        )
      }
      tick()
      const interval = setInterval(tick, PUBLISH_MS)
      timers.push(() => clearInterval(interval))
    }, offset)
    timers.push(() => clearTimeout(kick))
  }

  await sleep(SECONDS * 1000)
  for (const clear of timers) clear()
  const publishWindowMs = performance.now() - startedAt
  await sleep(DRAIN_MS)

  const received = latencies.length
  const sorted = latencies.slice().sort((a, b) => a - b)
  const result = {
    n,
    topic,
    ok: true,
    publishersJoined: publishers.length,
    joinFailures: joinErrors.length,
    windowSeconds: Math.round(publishWindowMs) / 1000,
    sent,
    received,
    duplicates,
    malformed,
    sendErrors,
    lossPct: sent === 0 ? null : Math.round(((sent - received) / sent) * 10000) / 100,
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    p99Ms: round(percentile(sorted, 99)),
    maxMs: round(sorted[sorted.length - 1] ?? null),
    minMs: round(sorted[0] ?? null),
    meanMs: received === 0 ? null : round(latencies.reduce((a, b) => a + b, 0) / received),
    /** Messages Supabase delivered to the OTHER publishers — the fan-out tax. */
    publisherInbound,
    deliveredTotal: received + publisherInbound,
  }

  await teardown(clients, channels)
  return result
}

async function teardown(clients, channels) {
  for (let i = 0; i < channels.length; i += 1) {
    try {
      await clients[i].removeChannel(channels[i])
    } catch {
      /* socket already gone */
    }
  }
  for (const client of clients) {
    try {
      client.realtime.disconnect()
    } catch {
      /* already disconnected */
    }
  }
  await sleep(500)
}

/* ------------------------------------------------------------------ main -- */

function fmtRow(r) {
  if (!r.ok) return `  N=${String(r.n).padStart(2)}  FAILED — ${r.error}`
  return (
    `  N=${String(r.n).padStart(2)}` +
    `  sent ${String(r.sent).padStart(5)}` +
    `  recv ${String(r.received).padStart(5)}` +
    `  loss ${String(r.lossPct).padStart(5)}%` +
    `  p50 ${String(r.p50Ms).padStart(6)}ms` +
    `  p95 ${String(r.p95Ms).padStart(6)}ms` +
    `  max ${String(r.maxMs).padStart(7)}ms`
  )
}

async function main() {
  console.log('bench-broadcast — Supabase Realtime Broadcast fan-out')
  console.log(`  project : ${SUPABASE_URL}`)
  console.log(`  tiers   : ${TIERS.join(', ')} publishers @ ${1000 / PUBLISH_MS} Hz`)
  console.log(`  window  : ${SECONDS}s per tier (+${DRAIN_MS / 1000}s drain)`)
  console.log(`  node    : ${process.version} on ${process.platform}`)
  console.log(`  started : ${new Date().toISOString()}`)

  const results = []
  for (const n of TIERS) {
    try {
      results.push(await runTier(n))
    } catch (err) {
      results.push({ n, ok: false, error: err?.message ?? String(err) })
    }
    // Let the project's connection accounting settle between tiers.
    await sleep(2_000)
  }

  console.log('\nRESULTS')
  for (const r of results) console.log(fmtRow(r))
  console.log('\nJSON')
  console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, results }, null, 2))

  // A tier that could not run at all is a failed benchmark, not a passing one.
  if (results.some((r) => !r.ok)) process.exitCode = 1
}

main().then(
  () => {
    // Realtime keeps timers alive; nothing left to wait for once results printed.
    setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref()
  },
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
