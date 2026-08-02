/**
 * Driver app — phone-first.
 *
 * DESIGN.md: "Same system, but ticket-first instead of map-first... A driver
 * who has never seen software must never wonder what to press next."
 *
 * The whole surface is one column: identity plate, honesty rail, a screen, and
 * a single 56px+ slab at thumb height. There is exactly one primary action per
 * state and the state ladder above the ticket says which one it is.
 *
 * Demo mode: claiming a run hands the sim engine's stop ladder to the driver
 * (`store.driverRunId` — see ./manualDrive.ts). DEPART sets the stop en route
 * and that is literally what rolls the van down the road on the dispatch
 * console; ARRIVED parks it; CLOSE files the money state. The console is
 * watching the same store, so the two screens are one system, not two demos.
 * Releasing the run hands it back and the engine finishes the shift on its own.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store'
import { DemoChip, ThemeToggle, Wordmark } from '../ui/controls'
import { formatLngLat, formatMoney, PAYMENT_LABEL } from '../format'
import { runCounts } from '../selectors'
import type { ExceptionReason, PaymentMethod } from '../types'

import RunPicker from './RunPicker'
import StopTicket, { type TicketAction } from './StopTicket'
import IdCheckScreen from './IdCheckScreen'
import PaymentScreen from './PaymentScreen'
import ExceptionScreen from './ExceptionScreen'
import { ReturningToDepot, RunClosed } from './RunEnd'
import { handOffRun } from './manualDrive'
import { isValidSessionCode, normalizeSessionCode } from '../console/liveSession'
import { enterLive, leaveLive } from '../live/session'
import { startDriverGps, type DriverGps, type GpsSource, type GpsStatus } from '../live/driverGps'
import LiveBanner from '../live/LiveBanner'
import './driver.css'

type Screen = 'picker' | 'ticket' | 'id' | 'pay' | 'exception'

export function DriverPage() {
  const runOrder = useStore((s) => s.runOrder)
  const runs = useStore((s) => s.runs)
  const stops = useStore((s) => s.stops)
  const simNowMs = useStore((s) => s.simNowMs)
  const driverRunId = useStore((s) => s.driverRunId)

  const setDriverRun = useStore((s) => s.setDriverRun)
  const startRun = useStore((s) => s.startRun)
  const setStopStatus = useStore((s) => s.setStopStatus)
  const advanceRunPosition = useStore((s) => s.advanceRunPosition)
  const logEvent = useStore((s) => s.logEvent)
  const arriveStop = useStore((s) => s.arriveStop)
  const verifyId = useStore((s) => s.verifyId)
  const closeStop = useStore((s) => s.closeStop)
  const flagException = useStore((s) => s.flagException)

  const liveFix = useStore((s) => s.liveFix)

  const [screen, setScreen] = useState<Screen>('picker')
  const [params] = useSearchParams()

  const view = useMemo(() => ({ runs, runOrder, stops }), [runs, runOrder, stops])

  /* ---- live session ------------------------------------------------------ */

  /**
   * SPEC: "Phone `/driver?live=<code>`: publishes GPS at 1Hz over the channel."
   * A malformed code is treated as no code at all — the phone quietly stays a
   * demo, rather than opening a socket to a session that cannot exist.
   */
  const liveCode = useMemo(() => {
    const raw = params.get('live')
    if (!raw) return null
    const code = normalizeSessionCode(raw)
    return isValidSessionCode(code) ? code : null
  }, [params])

  const [gpsSource, setGpsSource] = useState<GpsSource>('device')
  const [gps, setGps] = useState<GpsStatus | null>(null)
  const gpsRef = useRef<DriverGps | null>(null)

  useEffect(() => {
    if (!liveCode) return
    void enterLive(liveCode, 'driver')
    return () => leaveLive()
  }, [liveCode])

  /**
   * The GPS pipeline starts when there is both a session and a claimed run —
   * there is nothing to publish a position *for* until the driver picks a run.
   * Deliberately not keyed on `gpsSource`: switching source swaps the feed in
   * place (below) instead of tearing the pipeline down mid-shift.
   */
  useEffect(() => {
    if (!liveCode || !driverRunId) return
    const controller = startDriverGps(driverRunId, gpsSource, setGps)
    gpsRef.current = controller
    return () => {
      controller.stop()
      gpsRef.current = null
      setGps(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCode, driverRunId])

  useEffect(() => {
    gpsRef.current?.setSource(gpsSource)
  }, [gpsSource])

  const run = driverRunId ? (runs[driverRunId] ?? null) : null
  const stopId = run ? (run.stops[run.currentLeg] ?? null) : null
  const stop = stopId ? (stops[stopId] ?? null) : null

  /* ---- claim / release -------------------------------------------------- */

  function claim(runId: string): void {
    handOffRun(useStore.getState().driverRunId)
    setDriverRun(runId)
    setScreen('ticket')
  }

  function release(): void {
    handOffRun(useStore.getState().driverRunId)
    setDriverRun(null)
    setScreen('picker')
  }

  /** Deep link: /driver?run=run-a walks straight into that run's queue. */
  const deepLinked = useRef(false)
  useEffect(() => {
    if (deepLinked.current) return
    deepLinked.current = true
    const wanted = params.get('run')
    if (wanted && useStore.getState().runs[wanted]) {
      useStore.getState().setDriverRun(wanted)
      setScreen('ticket')
    }
    // StrictMode double-mounts: the release cleanup below drops the claim, so
    // let the re-run re-take it rather than landing on an empty picker.
    return () => {
      deepLinked.current = false
    }
  }, [params])

  /** Leaving the app hands the run back to the engine, mid-shift or not. */
  useEffect(
    () => () => {
      const s = useStore.getState()
      handOffRun(s.driverRunId)
      s.setDriverRun(null)
    },
    [],
  )

  /* ---- the one action this state allows --------------------------------- */

  function depart(): void {
    if (!run || !stop) return
    // A staged run has no manifest history yet: startRun opens it, marks the
    // first stop en route and logs the departure in one move.
    if (run.status === 'staged') {
      startRun(run.id)
      return
    }
    setStopStatus(stop.id, 'enroute')
    logEvent({ runId: run.id, stopId: stop.id, type: 'departed', meta: { to: stop.orderCode } })
  }

  function arrive(): void {
    if (!run || !stop) return
    // Same action the sim engine calls: it stamps the arrival and, when the
    // window has already closed, logs that too. Never blocks — SPEC keeps an
    // out-of-window stop completable.
    arriveStop(stop.id)
  }

  function advanceQueue(): void {
    if (!run) return
    advanceRunPosition(run.id, {
      position: stop ? stop.lngLat : run.position,
      heading: run.heading,
      currentLeg: run.currentLeg + 1,
      progress: 0,
    })
    setScreen('ticket')
  }

  function onVerdict(passed: boolean): void {
    if (!stop) return
    verifyId(stop.id, passed)
    setScreen(passed ? 'pay' : 'ticket')
  }

  function onCloseOut(method: PaymentMethod): void {
    if (!stop) return
    closeStop(stop.id, method)
    setScreen('ticket')
  }

  function onFlag(reason: ExceptionReason): void {
    if (!stop) return
    flagException(stop.id, reason)
    setScreen('ticket')
  }

  function ticketAction(): TicketAction {
    if (!run || !stop) return { label: 'NO STOP', onPress: () => {}, disabled: true }

    const lastStop = run.currentLeg >= run.stops.length - 1

    if (run.status === 'staged') {
      return {
        label: `DEPART — ${stop.orderCode}`,
        hint: 'OPENS THE MANIFEST AND STARTS THE RUN',
        onPress: depart,
      }
    }

    switch (stop.status) {
      case 'pending':
        return { label: `DEPART — ${stop.orderCode}`, hint: 'ROLLING TO THE NEXT DOOR', onPress: depart }
      case 'enroute':
        return { label: 'ARRIVED', hint: 'TAP WHEN YOU PULL UP', onPress: arrive }
      case 'arrived':
        return {
          label: 'VERIFY ID — 21+',
          hint: 'REQUIRED BEFORE THIS STOP CAN CLOSE',
          onPress: () => setScreen('id'),
        }
      case 'id_check':
        return {
          label: `CLOSE — ${PAYMENT_LABEL[stop.payment]}`,
          hint: `COLLECT ${formatMoney(stop.amountDue)}`,
          onPress: () => setScreen('pay'),
        }
      case 'delivered':
        return {
          label: lastStop ? 'RETURN TO DEPOT' : 'NEXT STOP',
          hint: `${stop.orderCode} CLOSED — ${PAYMENT_LABEL[stop.payment]} ${formatMoney(
            stop.amountDue,
          )}`,
          onPress: advanceQueue,
        }
      case 'exception':
        return {
          label: lastStop ? 'RETURN TO DEPOT' : 'NEXT STOP',
          hint: `${stop.orderCode} FLAGGED UNDELIVERABLE`,
          onPress: advanceQueue,
        }
      default:
        return { label: 'NO ACTION', onPress: () => {}, disabled: true }
    }
  }

  /* ---- screen resolution ------------------------------------------------ */

  const canExcept =
    stop !== null && (stop.status === 'enroute' || stop.status === 'arrived' || stop.status === 'id_check')

  /* ---- honesty rail readout --------------------------------------------- */

  /**
   * The rail reports what is ACTUALLY feeding the map, not what was asked for.
   * A phone that was told to use its GPS and then had permission refused reads
   * SIM GPS here, with the reason on the line underneath — never a live label
   * over a simulated position.
   */
  const simFeed = !liveCode || (gps?.source ?? 'sim') === 'sim'
  const acquiring = Boolean(liveCode) && !simFeed && gps?.health === 'pending'
  const realFix = Boolean(liveCode) && !simFeed && gps?.health === 'ok'
  const accuracyM = liveFix && !liveFix.simulated ? Math.round(liveFix.accuracyM) : null

  const gpsReadout = !run
    ? liveCode
      ? 'GPS STANDBY — PICK A RUN'
      : 'SIM GPS STANDBY'
    : acquiring
      ? 'GPS ACQUIRING'
      : `${simFeed ? 'SIM GPS' : 'LIVE GPS'} ${formatLngLat(run.position)}${
          realFix && accuracyM !== null ? ` ±${accuracyM}M` : ''
        }`

  const gpsNote = liveCode ? (gps?.note ?? null) : null

  function body() {
    if (!run) return <RunPickerScreen view={view} onPick={claim} />
    if (run.status === 'complete') {
      return (
        <RunClosed
          run={run}
          stops={run.stops.map((id) => stops[id]).filter(Boolean)}
          onPickAnother={release}
        />
      )
    }
    if (!stop) return <ReturningToDepot run={run} onHandBack={release} />

    if (screen === 'id' && stop.status === 'arrived') {
      return <IdCheckScreen stop={stop} onPass={() => onVerdict(true)} onFail={() => onVerdict(false)} />
    }
    if (screen === 'pay' && stop.status === 'id_check' && stop.idChecked) {
      return <PaymentScreen stop={stop} onConfirm={onCloseOut} onBack={() => setScreen('ticket')} />
    }
    if (screen === 'exception' && canExcept) {
      return <ExceptionScreen stop={stop} onFlag={onFlag} onBack={() => setScreen('ticket')} />
    }

    const counts = runCounts(view, run.id)
    return (
      <StopTicket
        run={run}
        stop={stop}
        seq={Math.min(run.currentLeg + 1, counts.total)}
        total={counts.total}
        simNowMs={simNowMs}
        action={ticketAction()}
        onReportIssue={canExcept ? () => setScreen('exception') : null}
      />
    )
  }

  return (
    <div className="dv-shell">
      <div className="dv-app">
        <header className="dv-head">
          {run ? (
            <button
              type="button"
              className="btn dv-back"
              onClick={release}
              aria-label="Back to run list"
            >
              &lsaquo; RUNS
            </button>
          ) : null}
          <Wordmark subtitle="DRIVER" />
          <span className="dv-head-spacer" />
          <ThemeToggle />
        </header>

        {/* Honesty rail — DESIGN.md: demo state and simulated GPS are never
            hidden, and on a phone there is no header room for them. In a live
            session this is also where the driver switches the feed between the
            device's own GPS and the precomputed route. */}
        <div className="dv-rail">
          <DemoChip />
          <span className="lv-gps">
            <span className={`dv-rail-gps lv-gps__read${realFix ? ' lv-gps__read--live' : ''}`}>
              <i className="dv-rail-dot pulse" />
              {gpsReadout}
            </span>
            {/* The switch shows what was REQUESTED; the readout beside it and
                the note below show what the device actually delivered. When
                those disagree the note says why, and the switch still toggles
                — so a driver who was refused location once can ask again. */}
            {liveCode ? (
              <button
                type="button"
                className={`lv-gps__toggle${gpsSource === 'sim' ? ' lv-gps__toggle--on' : ''}`}
                onClick={() => setGpsSource(gpsSource === 'sim' ? 'device' : 'sim')}
                aria-pressed={gpsSource === 'sim'}
                title="Play the precomputed route instead of the device's GPS"
              >
                SIM GPS
              </button>
            ) : null}
          </span>
        </div>

        {gpsNote ? (
          <div className={`lv-note${gps?.health === 'pending' ? ' lv-note--quiet' : ''}`}>
            {gpsNote}
          </div>
        ) : null}

        <LiveBanner placement="inline" />

        {body()}
      </div>
    </div>
  )
}

/** The picker needs the scroll container the other screens bring themselves. */
function RunPickerScreen({
  view,
  onPick,
}: {
  view: Parameters<typeof RunPicker>[0]['view']
  onPick: (runId: string) => void
}) {
  return (
    <div className="dv-body">
      <RunPicker view={view} onPick={onPick} />
    </div>
  )
}

export default DriverPage
