/**
 * What goes inside the frames.
 *
 * Every export here renders REAL app components against the REAL store. There
 * is no story-only copy of a ticket, no mocked stop, no frozen snapshot: the
 * order code, the customer, the amount and the state you read on the front
 * page are the same objects the console and the driver app are rendering at
 * that instant, because there is only one fleet in the tab.
 *
 * Two constructions need explaining.
 *
 * 1. The driver embeds mount `StopTicket` / `IdCheckScreen` / `PaymentScreen`
 *    directly inside the driver app's own shell markup instead of mounting
 *    `DriverPage`. That is not a shortcut — it is the correct call. Claiming a
 *    run in `DriverPage` sets `store.driverRunId`, which by design hands that
 *    run's ladder from the sim engine to the human holding the phone (see
 *    src/driver/manualDrive.ts). A story page that mounted DriverPage would
 *    therefore stall a third of the fleet the moment you scrolled past it, and
 *    two driver embeds would fight over the claim. The screens themselves are
 *    pure functions of a Stop and a Run, so they embed truthfully with no
 *    side effect on the shift.
 *
 * 2. `TrackingPage` and `ManifestPage` read their subject from the URL. They
 *    are mounted through `<Routes location=...>`, which matches an overridden
 *    path without touching the address bar — the supported react-router way to
 *    render a route's element out of place. Nesting a second Router would
 *    throw, and both pages keep their real `useParams` contract this way.
 */

import { useCallback, type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { runIdOf, useStore, type ManifestState } from '../store'
import { DemoChip, Wordmark } from '../ui/controls'
import { formatLngLat } from '../format'
import { runCounts } from '../selectors'
import type { PaymentMethod, Stop } from '../types'

import ConsolePage from '../console/ConsolePage'
import TrackingPage from '../tracking/TrackingPage'
import ManifestPage from '../manifest/ManifestPage'
import DriverStopTicket from '../driver/StopTicket'
import IdCheckScreen from '../driver/IdCheckScreen'
import PaymentScreen from '../driver/PaymentScreen'
import '../driver/driver.css'

/* --------------------------------------------------------- store picks --- */

/**
 * The stop the story follows: the door the fleet is actually working.
 *
 * Selectors here return ids and other primitives on purpose. The fleet
 * publishes positions at 5 Hz, so a selector that returned an object would
 * re-render the whole story page five times a second and drag every mounted
 * embed with it. A string id compares equal and the render stops there.
 */
export function featureStopId(s: ManifestState): string | null {
  const open = (id: string) => {
    const stop = s.stops[id]
    return stop && stop.status !== 'delivered' && stop.status !== 'exception' ? stop : null
  }
  for (const runId of s.runOrder) {
    if (s.runs[runId]?.status !== 'active') continue
    for (const id of s.runs[runId].stops) if (open(id)) return id
  }
  for (const runId of s.runOrder) {
    for (const id of s.runs[runId]?.stops ?? []) if (open(id)) return id
  }
  return s.runOrder.flatMap((runId) => s.runs[runId]?.stops ?? [])[0] ?? null
}

/** Prefer a stop genuinely standing at a door; otherwise the followed stop. */
export function idCheckStopId(s: ManifestState): string | null {
  for (const runId of s.runOrder) {
    for (const id of s.runs[runId]?.stops ?? []) {
      const stop = s.stops[id]
      if (stop && (stop.status === 'arrived' || stop.status === 'id_check')) return id
    }
  }
  return featureStopId(s)
}

/** First stop on the board taking each tender type. Stable across resets. */
export function stopIdForPayment(s: ManifestState, method: PaymentMethod): string | null {
  for (const runId of s.runOrder) {
    for (const id of s.runs[runId]?.stops ?? []) {
      if (s.stops[id]?.payment === method) return id
    }
  }
  return null
}

/** The run whose manifest the story prints: the one that is out on the road. */
export function featureRunId(s: ManifestState): string {
  const active = s.runOrder.find((id) => s.runs[id]?.status === 'active')
  return active ?? s.runOrder[0] ?? 'run-a'
}

export function useStop(stopId: string | null): Stop | null {
  return useStore(useCallback((s) => (stopId ? (s.stops[stopId] ?? null) : null), [stopId]))
}

/* ------------------------------------------------------- driver shell ---- */

/**
 * The driver app's chrome, honesty rail included. `DemoChip` and the coordinate
 * readout are the same components the phone shows, and the coordinate really is
 * the van's position this frame — the readout is subscribed at four decimal
 * places so it re-renders when the number changes rather than when the store
 * ticks.
 */
function GpsReadout({ runId }: { runId: string }) {
  const read = useStore(
    useCallback(
      (s) => {
        const position = s.runs[runId]?.position
        return position ? formatLngLat(position) : null
      },
      [runId],
    ),
  )
  return (
    <span className="dv-rail-gps">
      <i className="dv-rail-dot pulse" />
      {read ? `Sim GPS ${read}` : 'Sim GPS standby'}
    </span>
  )
}

function DriverShell({ runId, children }: { runId: string; children: ReactNode }) {
  return (
    <div className="dv-shell">
      <div className="dv-app">
        <header className="dv-head">
          <Wordmark subtitle="Driver" />
          <span className="dv-head-spacer" />
        </header>
        <div className="dv-rail">
          <DemoChip />
          <GpsReadout runId={runId} />
        </div>
        {children}
      </div>
    </div>
  )
}

const NOOP = () => undefined

/* ------------------------------------------------------------ embeds ----- */

/** The console, whole, at desktop size. Same component `/dispatch` renders. */
export function ConsoleEmbed() {
  return <ConsolePage />
}

/** The driver's current ticket, with the real state ladder and slab. */
export function DriverTicketEmbed({ stopId }: { stopId: string | null }) {
  const stop = useStop(stopId)
  const runId = stopId ? runIdOf(stopId) : ''
  const run = useStore(useCallback((s) => (runId ? (s.runs[runId] ?? null) : null), [runId]))
  const simNowMs = useStore((s) => s.simNowMs)
  const counts = useStore(
    useCallback((s) => (runId ? runCounts(s, runId).total : 0), [runId]),
  )
  if (!stop || !run) return null

  return (
    <DriverShell runId={run.id}>
      <DriverStopTicket
        run={run}
        stop={stop}
        seq={Math.min(run.currentLeg + 1, counts)}
        total={counts}
        simNowMs={simNowMs}
        action={{
          label: 'Arrived',
          hint: 'Tap when you pull up',
          onPress: NOOP,
        }}
        onReportIssue={null}
      />
    </DriverShell>
  )
}

/** The mandatory ID gate. Identity record is derived from the live stop. */
export function DriverIdEmbed({ stopId }: { stopId: string | null }) {
  const stop = useStop(stopId)
  if (!stop) return null
  return (
    <DriverShell runId={runIdOf(stop.id)}>
      <IdCheckScreen stop={stop} onPass={NOOP} onFail={NOOP} />
    </DriverShell>
  )
}

/** Closeout. The screen picks its ladder off the stop's real tender type. */
export function DriverPaymentEmbed({ stopId }: { stopId: string | null }) {
  const stop = useStop(stopId)
  if (!stop) return null
  return (
    <DriverShell runId={runIdOf(stop.id)}>
      {/* Keyed on the stop so switching tender type replays the real ladder. */}
      <PaymentScreen key={stop.id} stop={stop} onConfirm={NOOP} onBack={NOOP} />
    </DriverShell>
  )
}

/** The customer's link, rendered by the page `/t/:orderCode` renders. */
export function TrackingEmbed({ orderCode }: { orderCode: string }) {
  return (
    <Routes location={`/t/${orderCode}`}>
      <Route path="/t/:orderCode" element={<TrackingPage />} />
    </Routes>
  )
}

/** The compliance document, rendered by the page `/manifest/:runId` renders. */
export function ManifestEmbed({ runId }: { runId: string }) {
  return (
    <Routes location={`/manifest/${runId}`}>
      <Route path="/manifest/:runId" element={<ManifestPage />} />
    </Routes>
  )
}
