/**
 * Dispatch console `/`.
 *
 * The map IS the page (DESIGN.md): a full-bleed MapCanvas with every control
 * floating over it as a boxed glass panel. Nothing here owns a "content area".
 *
 * Layout
 *   top-left     wordmark plate + DEMO FLEET honesty chip + fleet counts
 *   top-right    theme toggle + LIVE session entry
 *   left rail    one run panel per run — plate header, STOP x/y, ONE display
 *                ETA numeral, window compliance, stop tickets
 *   right rail   collapsible event feed, chat-transcript, newest on top
 *
 * Selection is bidirectional: clicking a driver or a stop on the map selects it
 * here (the store is the only channel), and clicking a panel flies the map to
 * it and pulses the accent on the selected driver.
 *
 * Demo dispatch actions, all local and instant: start a staged run, mark a stop
 * as an exception, promote/demote stops on staged runs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapCanvas, { type MapPadding } from '../map/MapCanvas'
import { EXCEPTION_LABEL, runIdOf, useStore } from '../store'
import { DemoChip, ThemeToggle, Wordmark } from '../ui/controls'
import { cancelledStopIds, fleetCounts, recentEvents, runStops } from '../selectors'
import type { DeliveryEvent, ExceptionReason } from '../types'
import RunPanel from './RunPanel'
import EventFeed from './EventFeed'
import LiveEntryModal from './LiveEntryModal'
import LiveBanner from '../live/LiveBanner'
import { defaultEnterLive, exitLive } from './liveSession'
import './console.css'

const FEED_LIMIT = 60

/** Gap between a floating rail and the map viewport edge it must clear. */
const RAIL_CLEARANCE = 28

/** Below this the feed starts folded — a tablet needs its map back. */
const FEED_AUTOFOLD_PX = 1000

/**
 * Padding used for the map's one-shot opening fit, before the rails have been
 * measured. It has to be right on the first frame or the fleet lands under a
 * panel, so it mirrors the CSS widths rather than guessing.
 */
function openingPadding(): MapPadding {
  const w = typeof window === 'undefined' ? 1440 : window.innerWidth
  const railW = w <= 900 ? 288 : w <= 1180 ? 306 : 344
  const feedW = w < FEED_AUTOFOLD_PX ? 34 : w <= 1180 ? 272 : 312
  return { top: 66, bottom: 24, left: railW + RAIL_CLEARANCE, right: feedW + RAIL_CLEARANCE }
}

/**
 * The LIVE control never overstates the transport. `connecting` means a code is
 * armed and the console is waiting for a phone, not that anything is flowing.
 */
const LIVE_BTN_LABEL: Record<string, string> = {
  off: 'LIVE',
  connecting: 'LIVE · ARMED',
  connected: 'LIVE · ON',
  degraded: 'LIVE · DEGRADED',
}

export interface ConsolePageProps {
  /**
   * Live-mode seam. Called with a validated session code when the dispatcher
   * arms a session. Defaults to the console-local stub in `liveSession.ts`,
   * which records the code and waits; the live agent replaces it with the
   * Supabase broadcast channel.
   */
  onEnterLive?: (code: string) => void
}

export function ConsolePage({ onEnterLive = defaultEnterLive }: ConsolePageProps) {
  const runOrder = useStore((s) => s.runOrder)
  const runs = useStore((s) => s.runs)
  const stops = useStore((s) => s.stops)
  const events = useStore((s) => s.events)
  const selection = useStore((s) => s.selection)
  const simNowMs = useStore((s) => s.simNowMs)
  const generation = useStore((s) => s.generation)
  const liveStatus = useStore((s) => s.liveStatus)
  const liveCode = useStore((s) => s.liveCode)
  const liveRunId = useStore((s) => s.liveRunId)

  const [feedCollapsed, setFeedCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < FEED_AUTOFOLD_PX,
  )
  const [feedScoped, setFeedScoped] = useState(false)
  const [collapsedRuns, setCollapsedRuns] = useState<Record<string, boolean>>({})
  const [liveOpen, setLiveOpen] = useState(false)
  const [padding, setPadding] = useState<MapPadding>(openingPadding)

  const rootRef = useRef<HTMLDivElement | null>(null)

  const view = useMemo(() => ({ runs, runOrder, stops }), [runs, runOrder, stops])
  const fleet = fleetCounts(view)

  const delivered = useMemo(() => {
    const all = Object.values(stops)
    return { done: all.filter((s) => s.status === 'delivered').length, total: all.length }
  }, [stops])

  const selectedRunId =
    selection?.kind === 'run'
      ? selection.id
      : selection?.kind === 'stop'
        ? runIdOf(selection.id)
        : null

  /** Which exceptions are cancellations — `Stop` has no reason field, the log does. */
  const cancelledIds = useMemo(
    () => cancelledStopIds(events, EXCEPTION_LABEL.cancelled),
    [events],
  )

  const scopeRunId = feedScoped ? selectedRunId : null
  const feed = useMemo(
    () =>
      recentEvents(events, scopeRunId ? { runId: scopeRunId, limit: FEED_LIMIT } : { limit: FEED_LIMIT }),
    [events, scopeRunId],
  )

  /* ------------------------------------------------------------ actions -- */

  const selectRun = useCallback((runId: string) => {
    const store = useStore.getState()
    const already = store.selection?.kind === 'run' && store.selection.id === runId
    store.selectEntity(already ? null : { kind: 'run', id: runId })
  }, [])

  const selectStop = useCallback((stopId: string) => {
    const store = useStore.getState()
    const already = store.selection?.kind === 'stop' && store.selection.id === stopId
    store.selectEntity(already ? null : { kind: 'stop', id: stopId })
  }, [])

  const startRun = useCallback((runId: string) => {
    useStore.getState().startRun(runId)
  }, [])

  const reorder = useCallback((stopId: string, direction: -1 | 1) => {
    useStore.getState().reorderStop(runIdOf(stopId), stopId, direction)
  }, [])

  const flagException = useCallback((stopId: string, reason: ExceptionReason) => {
    useStore.getState().flagException(stopId, reason)
  }, [])

  /** SPEC edge case: order cancelled after dispatch. The run skips the stop. */
  const cancelStop = useCallback((stopId: string) => {
    useStore.getState().cancelStop(stopId)
  }, [])

  const toggleRunCollapse = useCallback((runId: string) => {
    setCollapsedRuns((prev) => ({ ...prev, [runId]: !prev[runId] }))
  }, [])

  const selectEventTarget = useCallback((event: DeliveryEvent) => {
    useStore
      .getState()
      .selectEntity(
        event.stopId ? { kind: 'stop', id: event.stopId } : { kind: 'run', id: event.runId },
      )
  }, [])

  const toggleFeed = useCallback(() => setFeedCollapsed((v) => !v), [])
  const toggleScope = useCallback(() => setFeedScoped((v) => !v), [])

  const enterLive = useCallback(
    (code: string) => {
      onEnterLive(code)
    },
    [onEnterLive],
  )

  const disarmLive = useCallback(() => {
    exitLive()
  }, [])

  /* ---------------------------------------------------------- behaviour -- */

  /** A fresh dispatch re-opens every run panel and drops the feed scope. */
  useEffect(() => {
    setCollapsedRuns({})
    setFeedScoped(false)
  }, [generation])

  /** Selection sync, panel side: reveal and scroll the selected item into view. */
  useEffect(() => {
    if (!selection) return
    if (selection.kind === 'stop') {
      const runId = runIdOf(selection.id)
      setCollapsedRuns((prev) => (prev[runId] ? { ...prev, [runId]: false } : prev))
    }
    const key = `${selection.kind}:${selection.id}`
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const id = window.setTimeout(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-sel-id="${key}"]`)
      el?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    }, 20)
    return () => window.clearTimeout(id)
  }, [selection])

  /** Escape clears the selection (the modal handles its own Escape). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || liveOpen) return
      if (useStore.getState().selection) useStore.getState().selectEntity(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [liveOpen])

  /**
   * Keep the fleet clear of the floating rails. Measured from the DOM rather
   * than hard-coded, so the CSS breakpoints stay the single source of width.
   */
  useEffect(() => {
    let raf = 0
    const measure = () => {
      const root = rootRef.current
      if (!root) return
      const rail = root.querySelector<HTMLElement>('.dc-rail')
      const feedEl = root.querySelector<HTMLElement>('.dc-feed')
      const left = rail ? rail.getBoundingClientRect().width + RAIL_CLEARANCE : 0
      const right = feedEl ? feedEl.getBoundingClientRect().width + RAIL_CLEARANCE : 0
      setPadding((prev) =>
        prev.left === left && prev.right === right ? prev : { top: 66, bottom: 24, left, right },
      )
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    schedule()
    // the feed animates its width over 250ms — settle, then measure again
    const settle = window.setTimeout(measure, 280)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(settle)
      window.removeEventListener('resize', schedule)
    }
  }, [feedCollapsed])

  /* ------------------------------------------------------------- render -- */

  const liveArmed = liveStatus !== 'off' && Boolean(liveCode)
  const liveBtnClass =
    liveStatus === 'degraded'
      ? 'btn btn--amber'
      : liveStatus === 'connected'
        ? 'btn btn--primary'
        : 'btn'

  return (
    <div className="dc-root" ref={rootRef}>
      <MapCanvas padding={padding} initialFit="fleet" />

      <div className="dc-topbar">
        <div className="glass dc-strip">
          <Wordmark subtitle="DISPATCH" />
          <DemoChip />
          {/* Honesty rail: one real phone does not make the whole board real.
              While a live run is publishing, say plainly how much of what is
              moving out there is still the simulation. */}
          {liveRunId ? (
            <span className="chip chip--quiet">
              {`SIM FLEET ${Math.max(0, fleet.total - 1)}/${fleet.total}`}
            </span>
          ) : null}
          <span className="chip">{`RUNS ${fleet.active}/${fleet.total} ACTIVE`}</span>
          <span className="chip chip--quiet dc-hide-sm">
            {`DELIVERED ${delivered.done}/${delivered.total}`}
          </span>
          {fleet.exceptions > 0 ? (
            <span className="chip chip--amber">{`EXCEPTIONS ${fleet.exceptions}/${delivered.total}`}</span>
          ) : null}
        </div>

        <div className="glass dc-strip dc-strip--tools">
          {liveArmed ? (
            <span className="chip dc-hide-sm">{`SESSION ${liveCode}`}</span>
          ) : null}
          <ThemeToggle />
          <button
            type="button"
            className={liveBtnClass}
            onClick={() => setLiveOpen(true)}
            aria-haspopup="dialog"
            title="Pair a driver phone over a private session"
          >
            {liveArmed ? (LIVE_BTN_LABEL[liveStatus] ?? 'LIVE') : 'LIVE'}
          </button>
        </div>
      </div>

      <LiveBanner placement="float" />

      <div className="dc-rail">
        {runOrder.map((runId) => {
          const run = runs[runId]
          if (!run) return null
          return (
            <RunPanel
              key={runId}
              run={run}
              view={view}
              stops={runStops(view, runId)}
              simNowMs={simNowMs}
              selection={selection}
              collapsed={Boolean(collapsedRuns[runId])}
              generation={generation}
              cancelledIds={cancelledIds}
              onToggleCollapse={toggleRunCollapse}
              onSelectRun={selectRun}
              onSelectStop={selectStop}
              onStartRun={startRun}
              onReorder={reorder}
              onException={flagException}
              onCancel={cancelStop}
            />
          )
        })}
      </div>

      <EventFeed
        events={feed}
        totalCount={events.length}
        stops={stops}
        runs={runs}
        collapsed={feedCollapsed}
        scopeRunId={scopeRunId}
        scopableRunId={selectedRunId}
        onToggleCollapse={toggleFeed}
        onToggleScope={toggleScope}
        onSelectEvent={selectEventTarget}
      />

      <LiveEntryModal
        open={liveOpen}
        armedCode={liveCode}
        liveStatus={liveStatus}
        onClose={() => setLiveOpen(false)}
        onEnter={enterLive}
        onDisarm={disarmLive}
      />
    </div>
  )
}

export default ConsolePage
