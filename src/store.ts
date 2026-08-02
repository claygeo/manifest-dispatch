/**
 * Manifest store — the single source of truth for every surface.
 *
 * The rule from SPEC.md: the sim engine and the live (Supabase realtime)
 * engine call the SAME actions. Nothing in the UI is allowed to ask which
 * engine is driving. If you find yourself branching on `mode` inside a
 * component, the action set is missing something — add the action instead.
 */

import { create } from 'zustand'
import type {
  DeliveryEvent,
  DeliveryEventType,
  ExceptionReason,
  LiveFix,
  Mode,
  PaymentMethod,
  Run,
  RunStatus,
  Selection,
  Stop,
  StopStatus,
  Theme,
} from './types'
import { buildFleet, type Fleet } from './data/seed'
import { formatMoney, PAYMENT_LABEL } from './format'
import { arrivalWindowNote } from './window'

const EVENT_CAP = 300
const THEME_KEY = 'manifest.theme'

let eventSeq = 0
function nextEventId(): string {
  eventSeq += 1
  return `ev-${eventSeq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export const EXCEPTION_LABEL: Record<ExceptionReason, string> = {
  no_answer: 'NO ANSWER',
  cannot_verify: 'CANNOT VERIFY',
  refused: 'REFUSED',
  address_issue: 'ADDRESS ISSUE',
  cancelled: 'CANCELLED',
}

/** Partial position update pushed by whichever engine is driving. */
export interface RunMotion {
  position: [number, number]
  heading: number
  currentLeg?: number
  progress?: number
}

export type LiveStatus = 'off' | 'connecting' | 'connected' | 'degraded'

export interface ManifestState {
  /* ---- fleet data ---- */
  runs: Record<string, Run>
  runOrder: string[]
  stops: Record<string, Stop>
  /** Chronological (oldest first). Use `recentEvents()` for the newest-on-top feed. */
  events: DeliveryEvent[]

  /* ---- clock ---- */
  /** Sim wall-clock at session/fleet start (ms). */
  simEpoch: number
  /** Current sim wall-clock (ms). Advances DEMO_TIME_MULTIPLIER× real time. */
  simNowMs: number
  /** Increments on every fleet reset — seeds jitter so replays are not identical. */
  generation: number

  /* ---- session ---- */
  selection: Selection | null
  theme: Theme
  mode: Mode
  simPaused: boolean
  liveStatus: LiveStatus
  liveCode: string | null
  /**
   * Dispatch events written while the transport was down, still waiting to be
   * flushed to Supabase (see src/live/queue.ts). Surfaced by the banner: SPEC
   * requires connectivity loss to mean "events queue locally, honest reconnect
   * banner, no silent data loss", and a count is the only honest way to say how
   * much is still in the pipe.
   */
  liveQueued: number
  /**
   * Run currently claimed by the driver app. While set, the sim engine yields
   * that run's stop ladder (arrive -> id_check -> delivered) to the driver and
   * only rolls the van down the leg the driver departed on. `null` = every run
   * is engine-autonomous. Additive: nothing else in the app reads it.
   */
  driverRunId: string | null
  /**
   * Run whose position is coming off a real (or phone-simulated) GPS feed in a
   * live session. The sim engine skips this run entirely — the phone is the
   * only thing allowed to move it — while the rest of the demo fleet keeps
   * driving, so a live session never freezes the map it is embedded in.
   */
  liveRunId: string | null
  /** Quality of the most recent live fix. Drives the accuracy ring + GPS rail. */
  liveFix: LiveFix | null

  /* ---- fleet lifecycle ---- */
  hydrateFleet: (fleet: Fleet, generation: number) => void
  resetFleet: () => void
  addRun: (run: Run, stops: Stop[]) => void

  /* ---- run mutations ---- */
  startRun: (runId: string) => void
  advanceRunPosition: (runId: string, motion: RunMotion) => void
  setRunStatus: (runId: string, status: RunStatus) => void
  completeRun: (runId: string) => void
  reorderStop: (runId: string, stopId: string, direction: -1 | 1) => void

  /* ---- stop mutations ---- */
  setStopStatus: (stopId: string, status: StopStatus, patch?: Partial<Stop>) => void
  setStopEta: (stopId: string, etaMin: number | null) => void
  setStopEtas: (etas: Record<string, number | null>) => void
  arriveStop: (stopId: string) => void
  verifyId: (stopId: string, passed: boolean) => void
  closeStop: (stopId: string, payment?: PaymentMethod) => void
  flagException: (stopId: string, reason: ExceptionReason) => void
  cancelStop: (stopId: string) => void

  /* ---- events + session ---- */
  logEvent: (
    event: Omit<DeliveryEvent, 'id' | 'at'> & { at?: string },
  ) => void
  selectEntity: (selection: Selection | null) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setMode: (mode: Mode) => void
  setSimPaused: (paused: boolean) => void
  setSimNow: (ms: number) => void
  setLive: (status: LiveStatus, code?: string | null) => void
  setLiveQueued: (count: number) => void
  setDriverRun: (runId: string | null) => void
  setLiveRun: (runId: string | null) => void
  setLiveFix: (fix: LiveFix | null) => void
}

function indexById<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {}
  for (const item of list) out[item.id] = item
  return out
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage?.getItem(THEME_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
  return prefersLight ? 'light' : 'dark'
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
  try {
    window.localStorage?.setItem(THEME_KEY, theme)
  } catch {
    /* private mode — theme just won't persist */
  }
}

const bootFleet = buildFleet(0, Date.now())
const bootTheme = readStoredTheme()
applyTheme(bootTheme)

export const useStore = create<ManifestState>((set, get) => ({
  runs: indexById(bootFleet.runs),
  runOrder: bootFleet.runs.map((r) => r.id),
  stops: indexById(bootFleet.stops),
  events: bootFleet.events,

  simEpoch: bootFleet.simEpoch,
  simNowMs: bootFleet.simEpoch,
  generation: 0,

  selection: null,
  theme: bootTheme,
  mode: 'demo',
  simPaused: false,
  liveStatus: 'off',
  liveCode: null,
  liveQueued: 0,
  driverRunId: null,
  liveRunId: null,
  liveFix: null,

  /* ------------------------------------------------------- lifecycle ---- */

  hydrateFleet: (fleet, generation) =>
    set({
      runs: indexById(fleet.runs),
      runOrder: fleet.runs.map((r) => r.id),
      stops: indexById(fleet.stops),
      events: fleet.events,
      simEpoch: fleet.simEpoch,
      simNowMs: fleet.simEpoch,
      generation,
      selection: null,
    }),

  resetFleet: () => {
    const generation = get().generation + 1
    const fleet = buildFleet(generation, get().simNowMs || Date.now())
    get().hydrateFleet(fleet, generation)
  },

  /**
   * Put one more run on the board without disturbing the ones already driving.
   *
   * The `/plan` sandbox is the only caller: a visitor builds a sequence, hits
   * dispatch, and the result has to become a REAL run — same store, same
   * actions, same sim engine, same console. Additive on purpose. It never
   * touches `generation` (that number means "the fleet was re-seeded", and the
   * engine tears its whole simulation state down when it changes), and it
   * refuses an id that already exists rather than overwriting a live run.
   *
   * The run's legs must be registered with `registerRunLegs` BEFORE this lands,
   * or the engine will adopt a run with nowhere to drive.
   */
  addRun: (run, stops) =>
    set((s) => {
      if (s.runs[run.id]) return {}
      const nextStops = { ...s.stops }
      for (const stop of stops) nextStops[stop.id] = stop
      return {
        runs: { ...s.runs, [run.id]: run },
        runOrder: [...s.runOrder, run.id],
        stops: nextStops,
      }
    }),

  /* ------------------------------------------------------------- runs --- */

  startRun: (runId) => {
    const run = get().runs[runId]
    if (!run || run.status !== 'staged') return
    set((s) => ({ runs: { ...s.runs, [runId]: { ...run, status: 'active' } } }))
    const firstStopId = run.stops[0] ?? null
    get().logEvent({
      runId,
      stopId: null,
      type: 'run_started',
      meta: { manifest: run.manifestId, driver: run.driver },
    })
    if (firstStopId) {
      const first = get().stops[firstStopId]
      // An order cancelled before the run was dispatched keeps its exception —
      // see the same guard in the sim engine's beginLeg. The departure event
      // still fires: the van really does roll toward that kerb, because the
      // next leg's polyline starts there.
      if (first?.status === 'pending') get().setStopStatus(firstStopId, 'enroute')
      get().logEvent({
        runId,
        stopId: firstStopId,
        type: 'departed',
        meta: { to: first?.orderCode ?? firstStopId },
      })
    }
  },

  advanceRunPosition: (runId, motion) =>
    set((s) => {
      const run = s.runs[runId]
      if (!run) return {}
      return {
        runs: {
          ...s.runs,
          [runId]: {
            ...run,
            position: motion.position,
            heading: motion.heading,
            currentLeg: motion.currentLeg ?? run.currentLeg,
            progress: motion.progress ?? run.progress,
          },
        },
      }
    }),

  setRunStatus: (runId, status) =>
    set((s) => {
      const run = s.runs[runId]
      if (!run || run.status === status) return {}
      return { runs: { ...s.runs, [runId]: { ...run, status } } }
    }),

  completeRun: (runId) => {
    const run = get().runs[runId]
    if (!run || run.status === 'complete') return
    get().setRunStatus(runId, 'complete')
    get().logEvent({
      runId,
      stopId: null,
      type: 'note',
      meta: { message: 'RUN COMPLETE — RETURNED TO DEPOT', manifest: run.manifestId },
    })
  },

  /** SPEC: promote/demote stop order — staged runs only. */
  reorderStop: (runId, stopId, direction) => {
    const state = get()
    const run = state.runs[runId]
    if (!run || run.status !== 'staged') return
    const idx = run.stops.indexOf(stopId)
    const target = idx + direction
    if (idx < 0 || target < 0 || target >= run.stops.length) return
    const stops = run.stops.slice()
    ;[stops[idx], stops[target]] = [stops[target], stops[idx]]
    set((s) => ({ runs: { ...s.runs, [runId]: { ...run, stops } } }))
    const stop = state.stops[stopId]
    get().logEvent({
      runId,
      stopId,
      type: 'note',
      meta: {
        message: `RESEQUENCED TO POSITION ${target + 1}`,
        order: stop?.orderCode ?? stopId,
      },
    })
  },

  /* ------------------------------------------------------------ stops --- */

  setStopStatus: (stopId, status, patch) =>
    set((s) => {
      const stop = s.stops[stopId]
      if (!stop) return {}
      return { stops: { ...s.stops, [stopId]: { ...stop, ...patch, status } } }
    }),

  setStopEta: (stopId, etaMin) =>
    set((s) => {
      const stop = s.stops[stopId]
      if (!stop || stop.etaMin === etaMin) return {}
      return { stops: { ...s.stops, [stopId]: { ...stop, etaMin } } }
    }),

  setStopEtas: (etas) =>
    set((s) => {
      let changed = false
      const stops = { ...s.stops }
      for (const [stopId, etaMin] of Object.entries(etas)) {
        const stop = stops[stopId]
        if (!stop || stop.etaMin === etaMin) continue
        stops[stopId] = { ...stop, etaMin }
        changed = true
      }
      return changed ? { stops } : {}
    }),

  /**
   * The driver pulled up. One action for both engines so the window judgement
   * is made in exactly one place.
   *
   * SPEC edge case: "out-of-window arrival (flagged, logged, still completable
   * — reality beats theory in the field)". The note goes on the event, which is
   * what makes it survive the stop closing and reach the printed manifest. It
   * is a record, never a veto: nothing below or downstream can refuse the
   * arrival, and the close ladder is untouched.
   */
  arriveStop: (stopId) => {
    const stop = get().stops[stopId]
    if (!stop) return
    const atMs = get().simNowMs || Date.now()
    const note = arrivalWindowNote(stop, atMs)
    get().setStopStatus(stopId, 'arrived')
    get().logEvent({
      runId: runIdOf(stopId),
      stopId,
      type: 'arrived',
      meta: { order: stop.orderCode, ...(note ? { window: note } : {}) },
    })
  },

  /**
   * SPEC/compliance: ID verification is a mandatory state between arrived and
   * closed. A failed check pushes the stop into `exception`, never to closed.
   */
  verifyId: (stopId, passed) => {
    const stop = get().stops[stopId]
    if (!stop) return
    // Same rule as `flagException` below: a closed-out stop is history. Re-running
    // the check would drag a delivered order back to `id_check` and leave the
    // manifest claiming money was collected against a verification that, on the
    // record, had not happened yet.
    if (stop.status === 'delivered') return
    if (passed) {
      get().setStopStatus(stopId, 'id_check', { idChecked: true })
      get().logEvent({
        runId: runIdOf(stopId),
        stopId,
        type: 'id_verified',
        meta: { order: stop.orderCode },
      })
    } else {
      get().setStopStatus(stopId, 'exception', { idChecked: false })
      get().logEvent({
        runId: runIdOf(stopId),
        stopId,
        type: 'id_failed',
        meta: { order: stop.orderCode, reason: EXCEPTION_LABEL.cannot_verify },
      })
    }
  },

  closeStop: (stopId, payment) => {
    const stop = get().stops[stopId]
    if (!stop) return
    // the app enforces the law's shape: no close without a verified ID
    if (!stop.idChecked) return
    // ...and exactly one close per stop. `idChecked` stays true forever once the
    // licence has been read, so without this a second call would re-stamp
    // `closedAt` and put a second "CLOSED — CASH $84.50" line in the event log,
    // which is the manifest's record of custody and money. One delivery, one line.
    if (stop.status === 'delivered') return
    const method = payment ?? stop.payment
    const at = new Date(get().simNowMs || Date.now()).toISOString()
    get().setStopStatus(stopId, 'delivered', { closedAt: at, payment: method, etaMin: null })
    get().logEvent({
      runId: runIdOf(stopId),
      stopId,
      type: 'closed',
      at,
      meta: {
        order: stop.orderCode,
        payment: PAYMENT_LABEL[method],
        amount: formatMoney(stop.amountDue),
      },
    })
  },

  flagException: (stopId, reason) => {
    const stop = get().stops[stopId]
    if (!stop) return
    // A closed-out stop is history: money was collected against a verified ID.
    // Reopening it as an exception would put the manifest and the custody log
    // in disagreement, so the action refuses rather than rewriting the record.
    if (stop.status === 'delivered') return
    get().setStopStatus(stopId, 'exception', { etaMin: null })
    get().logEvent({
      runId: runIdOf(stopId),
      stopId,
      type: 'exception',
      meta: { order: stop.orderCode, reason: EXCEPTION_LABEL[reason] },
    })
  },

  /**
   * SPEC edge case: "order cancelled after dispatch (stop drops from run,
   * manifest annotated)".
   *
   * The stop keeps its slot in `run.stops` — that array is index-aligned with
   * the precomputed OSRM legs, so splicing it would desync every leg after it.
   * What drops is the stop's place in the DELIVERY queue: `exception` is
   * already the state every consumer reads as "not to be served" (the driver's
   * queue, `currentStop`, `runCounts`, the ETA publisher), and the sim engine
   * now drives past it without dwelling. The manifest annotates it as
   * CANCELLED off this event's reason.
   */
  cancelStop: (stopId) => {
    const stop = get().stops[stopId]
    if (!stop || stop.status === 'exception') return
    get().flagException(stopId, 'cancelled')
  },

  /* --------------------------------------------------- events + session -- */

  logEvent: (event) =>
    set((s) => {
      const full: DeliveryEvent = {
        id: nextEventId(),
        at: event.at ?? new Date(s.simNowMs || Date.now()).toISOString(),
        runId: event.runId,
        stopId: event.stopId,
        type: event.type as DeliveryEventType,
        ...(event.meta ? { meta: event.meta } : {}),
      }
      const events = s.events.length >= EVENT_CAP ? s.events.slice(-EVENT_CAP + 1) : s.events.slice()
      events.push(full)
      return { events }
    }),

  selectEntity: (selection) => set({ selection }),

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },

  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  setMode: (mode) => set({ mode }),

  setSimPaused: (simPaused) => set({ simPaused }),

  setSimNow: (ms) => set({ simNowMs: ms }),

  setLive: (liveStatus, code) =>
    set((s) => ({ liveStatus, liveCode: code === undefined ? s.liveCode : code })),

  setLiveQueued: (liveQueued) =>
    set((s) => (s.liveQueued === liveQueued ? {} : { liveQueued })),

  setDriverRun: (driverRunId) => set({ driverRunId }),

  setLiveRun: (liveRunId) =>
    set((s) => (s.liveRunId === liveRunId ? {} : { liveRunId, liveFix: null })),

  setLiveFix: (liveFix) => set({ liveFix }),
}))

/** Stop ids are `${runId}-${n}` by construction — cheap reverse lookup. */
function runIdOf(stopId: string): string {
  const idx = stopId.lastIndexOf('-')
  return idx > 0 ? stopId.slice(0, idx) : stopId
}

export { runIdOf }
