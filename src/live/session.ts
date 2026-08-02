/**
 * Live session transport — one per tab.
 *
 * SPEC.md "Live mode":
 *   Console: enter/generate session code -> creates `session:<code>` broadcast
 *   channel. Phone `/driver?live=<code>`: publishes GPS at 1 Hz over the
 *   channel; console and tracking page render it exactly like sim data (same
 *   store). Supabase tables (thin, for session continuity): `live_sessions`,
 *   `live_events`. If Supabase is unreachable, live mode degrades with an
 *   honest amber banner; demo mode never touches the network.
 *
 * Server contract (SECURITY DEFINER RPCs, anon-callable, code-gated):
 *   api_create_session(p_code text)                       -> void
 *   api_log_event(p_code text, p_type text, p_payload jsonb) -> void
 *   api_get_events(p_code text)                           -> setof live_events
 *
 * What is persisted and what is not, deliberately:
 *   GPS pings   broadcast only, never written. They are worthless in five
 *               seconds and writing 1 Hz location rows would be the one part of
 *               this demo that actually deserved a privacy review.
 *   Dispatch    departed / arrived / id_verified / closed / exception go
 *   events      through api_log_event as well, so a console that opens the link
 *               late — or reloads — replays the shift instead of starting blind.
 *
 * Failure is a first-class state. Every network call is wrapped; anything that
 * fails puts the store in `degraded`, which raises the amber LIVE UNAVAILABLE
 * banner and leaves the local sim running underneath. Nothing here can throw
 * into a component.
 */

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { useStore } from '../store'
import type { DeliveryEvent } from '../types'
import { getLiveClient } from './client'
import {
  channelFor,
  CONNECT_TIMEOUT_MS,
  FIX_STALE_MS,
  SYNC_DEBOUNCE_MS,
  SYNC_EVENT_TAIL,
} from './config'
import {
  applyGpsPing,
  applyRemoteEvents,
  applyRunSnapshot,
  beginLiveApply,
  endLiveApply,
  noteLocalEvent,
} from './apply'
import {
  isGpsPing,
  isRunSnapshot,
  MSG_GPS,
  MSG_HELLO,
  MSG_SYNC,
  type GpsPing,
  type LiveRole,
  type RunSnapshot,
  type StopSnapshot,
} from './protocol'

interface ActiveSession {
  code: string
  role: LiveRole
  client: SupabaseClient
  channel: RealtimeChannel
  /** Cleared on teardown. */
  disposers: Array<() => void>
  closed: boolean
  /** Wall-clock of the last GPS ping seen or sent. */
  lastTrafficMs: number
}

let active: ActiveSession | null = null
/** Guards against a second enterLive racing the first through its awaits. */
let openToken = 0

const store = () => useStore.getState()

/* ------------------------------------------------------------- status ---- */

function degrade(): void {
  const s = store()
  s.setLive('degraded', s.liveCode)
}

/**
 * Give the run back to the sim engine. Called when a phone goes quiet or the
 * transport dies: the moment nothing live is driving that van, the local
 * simulation is the honest thing to show.
 */
function releaseLiveRun(session: ActiveSession): void {
  session.lastTrafficMs = 0
  const s = store()
  s.setLiveRun(null)
  s.setLiveFix(null)
}

/** Channel is open but nothing is flowing yet — "WAITING FOR DRIVER PHONE". */
function waiting(): void {
  const s = store()
  if (s.liveStatus !== 'connected') return
  s.setLive('connecting', s.liveCode)
}

/** First real traffic. Only now does the console earn the LIVE label. */
function markTraffic(): void {
  if (!active) return
  active.lastTrafficMs = Date.now()
  const s = store()
  if (s.liveStatus !== 'connected') s.setLive('connected', s.liveCode)
  if (s.mode !== 'live') s.setMode('live')
}

export function isLiveActive(): boolean {
  return active !== null && !active.closed
}

/* ------------------------------------------------------------- enter ----- */

export interface EnterLiveOptions {
  /** Console only: register the code so the phone's inserts pass the FK check. */
  create?: boolean
}

export async function enterLive(
  code: string,
  role: LiveRole,
  options: EnterLiveOptions = {},
): Promise<void> {
  if (active && !active.closed && active.code === code && active.role === role) return

  leaveLive()
  const token = ++openToken

  const s = store()
  s.setLive('connecting', code)
  beginLiveApply()

  let client: SupabaseClient
  try {
    client = await getLiveClient()
  } catch {
    if (token === openToken) degrade()
    return
  }
  if (token !== openToken) return

  if (options.create) {
    const created = await callRpc(client, 'api_create_session', { p_code: code })
    if (!created) {
      if (token === openToken) degrade()
      return
    }
  }
  if (token !== openToken) return

  // Session continuity: whatever this shift already logged, before we listen.
  await replayLoggedEvents(client, code)
  if (token !== openToken) return

  const channel = client.channel(channelFor(code), {
    config: { broadcast: { self: false, ack: false } },
  })

  const session: ActiveSession = {
    code,
    role,
    client,
    channel,
    disposers: [],
    closed: false,
    lastTrafficMs: 0,
  }
  active = session

  channel.on('broadcast', { event: MSG_GPS }, ({ payload }) => {
    if (session.closed || !isGpsPing(payload)) return
    applyGpsPing(payload)
    markTraffic()
  })

  channel.on('broadcast', { event: MSG_SYNC }, ({ payload }) => {
    if (session.closed || !isRunSnapshot(payload)) return
    applyRunSnapshot(payload)
  })

  channel.on('broadcast', { event: MSG_HELLO }, () => {
    // Someone just joined. Only the publisher answers, with a full snapshot —
    // that is how a console opened mid-shift converges in one message.
    if (session.closed || session.role !== 'driver') return
    publishSnapshot(true)
  })

  let channelOpen = false

  // The socket never came up within the budget. Say so, and keep the local sim
  // running underneath — a dead transport must not take the demo with it.
  const connectTimer = window.setTimeout(() => {
    if (session.closed || channelOpen) return
    degrade()
  }, CONNECT_TIMEOUT_MS)
  session.disposers.push(() => window.clearTimeout(connectTimer))

  channel.subscribe((status) => {
    if (session.closed) return
    if (status === 'SUBSCRIBED') {
      channelOpen = true
      if (session.role === 'driver') startDriverPublisher(session)
      else void safeSend(session, MSG_HELLO, { role: session.role })
      return
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      channelOpen = false
      // The transport is gone. Hand the run back to the sim engine immediately
      // rather than leaving a dead van parked on the map behind an amber
      // banner — "demo continues locally" has to be literally true.
      if (session.role !== 'driver') releaseLiveRun(session)
      degrade()
    }
  })

  // Watchdog: a phone that goes quiet hands its run back to the sim engine
  // rather than leaving a dead van parked on the dispatcher's map.
  const watchdog = window.setInterval(() => {
    if (session.closed) return
    if (session.lastTrafficMs === 0) return
    if (Date.now() - session.lastTrafficMs < FIX_STALE_MS) return
    if (session.role === 'driver') return
    releaseLiveRun(session)
    waiting()
  }, 2_000)
  session.disposers.push(() => window.clearInterval(watchdog))
}

/* -------------------------------------------------------------- leave ---- */

export function leaveLive(): void {
  const session = active
  openToken += 1
  active = null
  if (session) {
    session.closed = true
    for (const dispose of session.disposers) dispose()
    session.disposers = []
    try {
      void session.client.removeChannel(session.channel)
    } catch {
      /* the socket is already gone — nothing left to unwind */
    }
  }
  endLiveApply()
  const s = store()
  s.setLiveRun(null)
  s.setLiveFix(null)
  s.setLive('off', null)
  if (s.mode !== 'demo') s.setMode('demo')
}

/* ------------------------------------------------------------ publish ---- */

/**
 * Put one GPS fix on the wire. The phone applies its own fixes locally at the
 * sim engine's 5 Hz cadence (see ./driverGps.ts) and only broadcasts at 1 Hz —
 * the channel carries what the console needs, not what the phone renders.
 */
export function sendGps(ping: GpsPing): void {
  const session = active
  if (!session || session.closed) return
  session.lastTrafficMs = Date.now()
  markTraffic()
  void safeSend(session, MSG_GPS, ping)
}

/** Snapshot of the driver's claimed run — the convergence message. */
function buildSnapshot(runId: string): RunSnapshot | null {
  const s = store()
  const run = s.runs[runId]
  if (!run) return null

  const stops: StopSnapshot[] = run.stops.flatMap((stopId) => {
    const stop = s.stops[stopId]
    if (!stop) return []
    return [
      {
        id: stop.id,
        status: stop.status,
        idChecked: stop.idChecked,
        closedAt: stop.closedAt,
        payment: stop.payment,
        etaMin: stop.etaMin,
      },
    ]
  })

  const events = s.events.filter((e) => e.runId === runId).slice(-SYNC_EVENT_TAIL)

  return {
    runId,
    status: run.status,
    currentLeg: run.currentLeg,
    progress: run.progress,
    position: run.position,
    heading: run.heading,
    stops,
    events,
    at: Date.now(),
  }
}

let syncTimer = 0

function publishSnapshot(immediate = false): void {
  const session = active
  if (!session || session.closed || session.role !== 'driver') return
  const runId = store().driverRunId
  if (!runId) return

  const send = () => {
    const current = active
    if (!current || current.closed) return
    const snapshot = buildSnapshot(runId)
    if (!snapshot) return
    void safeSend(current, MSG_SYNC, snapshot)
  }

  window.clearTimeout(syncTimer)
  if (immediate) send()
  else syncTimer = window.setTimeout(send, SYNC_DEBOUNCE_MS)
}

/**
 * Watches the driver's own store and mirrors its claimed run to the channel.
 *
 * The driver app calls plain store actions — it has no idea it is being
 * broadcast. That is the same contract the sim engine works under, one level up.
 */
function startDriverPublisher(session: ActiveSession): void {
  let lastSignature = ''
  const logged = new Set<string>()

  const signatureOf = (runId: string): string => {
    const s = store()
    const run = s.runs[runId]
    if (!run) return ''
    const ladder = run.stops
      .map((id) => {
        const stop = s.stops[id]
        return stop ? `${stop.status}${stop.idChecked ? 1 : 0}${stop.payment}${stop.closedAt ?? ''}` : '?'
      })
      .join('|')
    return `${run.status}:${run.currentLeg}:${ladder}:${s.events.length}`
  }

  const flushEventLog = (runId: string) => {
    const s = store()
    for (const event of s.events) {
      if (event.runId !== runId) continue
      // `seed-*` is the deterministic back-dated history every tab builds for
      // itself. Persisting it would burn the row budget on data the receiver
      // already has.
      if (event.id.startsWith('seed-') || logged.has(event.id)) continue
      logged.add(event.id)
      noteLocalEvent(event.id)
      void logDispatchEvent(session, event)
    }
  }

  const onChange = () => {
    if (session.closed) return
    const runId = store().driverRunId
    if (!runId) return
    const signature = signatureOf(runId)
    if (signature === lastSignature) return
    lastSignature = signature
    flushEventLog(runId)
    publishSnapshot()
  }

  const unsubscribe = useStore.subscribe(onChange)
  session.disposers.push(unsubscribe)
  session.disposers.push(() => window.clearTimeout(syncTimer))
  onChange()
  publishSnapshot(true)
}

/* ------------------------------------------------------------- server ---- */

async function callRpc(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { error } = await client.rpc(fn, args)
    return !error
  } catch {
    return false
  }
}

async function logDispatchEvent(session: ActiveSession, event: DeliveryEvent): Promise<void> {
  const ok = await callRpc(session.client, 'api_log_event', {
    p_code: session.code,
    p_type: event.type,
    p_payload: event as unknown as Record<string, unknown>,
  })
  if (!ok && !session.closed) degrade()
}

/** Rebuild the feed from `live_events` — session continuity across reloads. */
async function replayLoggedEvents(client: SupabaseClient, code: string): Promise<void> {
  try {
    const { data, error } = await client.rpc('api_get_events', { p_code: code })
    if (error || !Array.isArray(data)) return
    const events: DeliveryEvent[] = []
    for (const row of data as Array<{ payload?: unknown }>) {
      const payload = row?.payload as DeliveryEvent | undefined
      if (payload && typeof payload.id === 'string' && typeof payload.at === 'string') {
        events.push(payload)
      }
    }
    if (events.length > 0) applyRemoteEvents(events)
  } catch {
    /* replay is a nicety; the live channel is the product */
  }
}

async function safeSend(session: ActiveSession, event: string, payload: unknown): Promise<void> {
  try {
    // Resolves 'ok' | 'timed out' | 'error' — a rejected socket does not throw,
    // it answers, and answering "error" quietly is how a demo lies on stage.
    const result = await session.channel.send({ type: 'broadcast', event, payload })
    if (result !== 'ok' && !session.closed) degrade()
  } catch {
    if (!session.closed) degrade()
  }
}
