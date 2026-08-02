/**
 * Customer tracking — `/t/:orderCode`. No auth, one card + the map.
 *
 * SPEC.md: "Card: status ladder (packed → out for delivery → arriving →
 * delivered), `2 STOPS AWAY` chip, ETA window, driver first name, order
 * summary, map with driver dot once out for delivery."
 *
 * Design notes (DESIGN.md):
 *  - the map is still the page; the card floats over it as a glass panel
 *  - ONE display numeral: the arrival time. Everything else is 11px micro
 *  - the ladder is a segmented rail — filled segments, one accent segment.
 *    No bubbles, no checkmarks, no green "delivered!" celebration: a closed
 *    stop dims to field values
 *  - amber appears only when the customer actually has to do something
 *  - ETA drift renders inline as `4:12 → 4:19`, never as a diff badge
 *
 * Truth model: a stop is "out for delivery" the moment its run leaves the
 * depot — every order on the manifest is physically in the van, which is also
 * why `N STOPS AWAY` is meaningful before the driver is en route to you.
 *
 * ALL DATA IS FICTIONAL. Not affiliated with any licensed operator.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import MapCanvas from '../map/MapCanvas'
import { useStore } from '../store'
import LiveBanner from '../live/LiveBanner'
import { isValidSessionCode, normalizeSessionCode } from '../console/liveSession'
import { enterLive, leaveLive } from '../live/session'
import { DemoChip, ThemeToggle, Wordmark } from '../ui/controls'
import { findStopByOrderCode, runOfStop, runStops, stopsAway, windowLabel } from '../selectors'
import { driftLabel, etaClock, firstName, formatClock, formatMoney, PAYMENT_LABEL } from '../format'
import type { DeliveryEvent, Run, Stop } from '../types'
import './tracking.css'

/** Sim-minutes at which "out for delivery" becomes "arriving". */
const ARRIVING_MIN = 6

/** Only surface drift once it is worth a customer's attention. */
const DRIFT_MIN_MS = 120_000

const LADDER = ['PACKED', 'OUT FOR DELIVERY', 'ARRIVING', 'DELIVERED'] as const

/* ------------------------------------------------------------- helpers --- */

/** Index of the ladder rung the order currently sits on (0..3). */
function ladderIndex(stop: Stop, run: Run): number {
  if (stop.status === 'delivered') return 3
  if (stop.status === 'arrived' || stop.status === 'id_check') return 2
  if (stop.status === 'exception') return 2
  if (stop.status === 'enroute' && stop.etaMin !== null && stop.etaMin <= ARRIVING_MIN) return 2
  if (run.status === 'active' || run.status === 'complete') return 1
  return 0
}

function stepClass(i: number, current: number, flagged: boolean): string {
  if (i === current) return flagged ? 'tk-step tk-step--flag' : 'tk-step tk-step--now'
  return i < current ? 'tk-step tk-step--done' : 'tk-step'
}

/** Timestamp of the most recent event of a type for this stop, if any. */
function stampOf(events: DeliveryEvent[], stopId: string, type: DeliveryEvent['type']): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.stopId === stopId && e.type === type) return Date.parse(e.at)
  }
  return null
}

/** A tracking link is usually opened from a text message — name the tab. */
function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}

function useNarrow(breakpoint = 760): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpoint])
  return narrow
}

/* ----------------------------------------------------------- component --- */

export function TrackingPage() {
  const { orderCode = '' } = useParams()
  const runs = useStore((s) => s.runs)
  const runOrder = useStore((s) => s.runOrder)
  const stops = useStore((s) => s.stops)
  const events = useStore((s) => s.events)
  const simNowMs = useStore((s) => s.simNowMs)
  const generation = useStore((s) => s.generation)
  const narrow = useNarrow()
  useDocumentTitle(orderCode ? `${orderCode.toUpperCase()} — tracking` : 'Manifest — tracking')

  /**
   * SPEC: "console and tracking page render it exactly like sim data (same
   * store)". A tracking link carrying `?live=<code>` joins the session read-only
   * — it subscribes, it never publishes. Without the code the page is a pure
   * client-side demo and opens no socket at all.
   */
  const [search] = useSearchParams()
  const liveCode = useMemo(() => {
    const raw = search.get('live')
    if (!raw) return null
    const code = normalizeSessionCode(raw)
    return isValidSessionCode(code) ? code : null
  }, [search])

  useEffect(() => {
    if (!liveCode) return
    void enterLive(liveCode, 'tracking')
    return () => leaveLive()
  }, [liveCode])

  const view = useMemo(() => ({ runs, runOrder, stops }), [runs, runOrder, stops])
  const stop = findStopByOrderCode(view, orderCode)
  const run = stop ? runOfStop(view, stop.id) : undefined

  /**
   * The arrival time first quoted to this customer — the baseline for drift.
   * Keyed by fleet generation too: when the demo fleet loops and re-dispatches,
   * the old promise is void and quoting it would be a lie.
   */
  const promised = useRef<{ key: string; ms: number } | null>(null)
  const promiseKey = stop ? `${stop.id}#${generation}` : ''
  if (stop && stop.etaMin !== null && promised.current?.key !== promiseKey) {
    promised.current = { key: promiseKey, ms: simNowMs + stop.etaMin * 60_000 }
  }

  const runId = run?.id
  const mapRunIds = useMemo(() => (runId ? [runId] : []), [runId])
  const mapPadding = useMemo(
    () =>
      narrow
        ? { top: 96, right: 28, bottom: 300, left: 28 }
        : { top: 96, right: 48, bottom: 48, left: 452 },
    [narrow],
  )

  const rail = (
    <>
      <div className="tk-rail">
        <Wordmark subtitle="TRACKING" />
        <DemoChip />
        <div className="tk-rail-end">
          <ThemeToggle />
        </div>
      </div>
      <LiveBanner placement="float" />
    </>
  )

  if (!stop || !run) {
    const known = Object.values(stops)
      .map((s) => s.orderCode)
      .sort()
      .slice(0, 8)
    return (
      <div className="tk-root">
        {rail}
        <div className="tk-miss">
          <div className="panel tk-miss-card">
            <div className="plate">
              <span>ORDER NOT FOUND</span>
              <span>{orderCode ? orderCode.toUpperCase() : '—'}</span>
            </div>
            <div className="micro" style={{ padding: '14px 14px 10px' }}>
              No order on today&rsquo;s manifests matches that code. Tracking links stay live for
              the whole demo session — try one of these:
            </div>
            <div className="tk-codes">
              {known.map((code) => (
                <Link key={code} className="chip tk-code" to={`/t/${code}`}>
                  {code}
                </Link>
              ))}
            </div>
            <div className="micro micro--dim tk-fine">
              Demo uses fictional data. Not affiliated with any licensed operator.
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ---- derived state ---- */

  const rung = ladderIndex(stop, run)
  const exception = stop.status === 'exception'
  const delivered = stop.status === 'delivered'
  const atDoor = stop.status === 'arrived' || stop.status === 'id_check'
  const out = run.status === 'active' || run.status === 'complete'
  const away = stopsAway(view, stop.id)
  const list = runStops(view, run.id)
  const position = list.findIndex((s) => s.id === stop.id) + 1

  const closedAtMs = stop.closedAt
    ? Date.parse(stop.closedAt)
    : stampOf(events, stop.id, 'closed')
  const arrivedAtMs = stampOf(events, stop.id, 'arrived')

  let headLabel = 'ARRIVING BY'
  let headValue = etaClock(simNowMs, stop.etaMin)
  if (delivered) {
    headLabel = 'DELIVERED AT'
    headValue = closedAtMs ? formatClock(closedAtMs) : formatClock(simNowMs)
  } else if (exception) {
    headLabel = 'DELIVERY HELD'
    headValue = arrivedAtMs ? formatClock(arrivedAtMs) : formatClock(simNowMs)
  } else if (atDoor) {
    headLabel = 'DRIVER ARRIVED'
    headValue = arrivedAtMs ? formatClock(arrivedAtMs) : formatClock(simNowMs)
  } else if (stop.etaMin === null) {
    headLabel = 'SCHEDULED FOR'
    headValue = stop.window[0]
  }

  const numeralClass = exception
    ? 'numeral numeral--sm numeral--amber'
    : delivered
      ? 'numeral numeral--sm tk-numeral-done'
      : 'numeral numeral--sm numeral--accent'

  let statusChip: { text: string; tone: string } | null = null
  if (exception) statusChip = { text: 'COULD NOT COMPLETE', tone: 'chip chip--amber' }
  else if (delivered) statusChip = { text: 'HANDED OFF', tone: 'chip' }
  else if (atDoor) statusChip = { text: 'AT YOUR ADDRESS', tone: 'chip chip--accent' }
  else if (!out) statusChip = { text: 'AWAITING DISPATCH', tone: 'chip chip--quiet' }
  else if (away === 0) statusChip = { text: 'NEXT STOP', tone: 'chip chip--accent' }
  else if (away !== null)
    statusChip = { text: `${away} STOP${away === 1 ? '' : 'S'} AWAY`, tone: 'chip chip--accent' }

  /* ETA drift, inline: `4:12 → 4:19`. Only once it is worth mentioning. */
  let drift: string | null = null
  if (!delivered && !exception && stop.etaMin !== null && promised.current?.key === promiseKey) {
    const now = simNowMs + stop.etaMin * 60_000
    if (Math.abs(now - promised.current.ms) >= DRIFT_MIN_MS) {
      drift = driftLabel(promised.current.ms, now)
    }
  }

  const units = stop.items.reduce((n, item) => n + item.qty, 0)

  return (
    <div className="tk-root">
      <MapCanvas
        runIds={mapRunIds}
        interactive={false}
        showDepot={false}
        padding={mapPadding}
        onSelect={() => undefined}
      />
      {rail}

      <section className="glass tk-card">
        <div className="plate">
          <span>{stop.orderCode}</span>
          <span>{run.label.toUpperCase()}</span>
        </div>

        <div className="tk-scroll">
          <div className="tk-body">
            <div className="tk-head">
              <div>
                <div className="label">{headLabel}</div>
                <div className={numeralClass}>{headValue}</div>
                {drift ? <div className="tk-drift">{drift}</div> : null}
              </div>
              <div className="tk-chips">
                {statusChip ? <span className={statusChip.tone}>{statusChip.text}</span> : null}
                <span className="chip chip--quiet">{windowLabel(stop)}</span>
              </div>
            </div>

            <div className={delivered ? 'tk-ladder tk-ladder--closed' : 'tk-ladder'}>
              {LADDER.map((label, i) => (
                <div key={label} className={stepClass(i, rung, exception)}>
                  {exception && i === rung ? 'ON HOLD' : label}
                </div>
              ))}
            </div>

            {exception ? (
              <div className="tk-note">
                We could not complete this delivery. Your order is back with the driver — call the
                dispensary to reschedule.
              </div>
            ) : null}

            <hr className="rule" />

            <div className="tk-block">
              <div className="label">{delivered ? 'DELIVERED TO' : 'DELIVERING TO'}</div>
              <div className="tk-address">{stop.address}</div>
            </div>

            <div className="tk-block">
              <div className="label">YOUR DRIVER</div>
              <div className="tk-row">
                <span className="tk-address tk-row-name">{firstName(run.driver)}</span>
                <span className="tk-leader" />
                <span className="chip chip--quiet tk-qty">{`STOP ${position}/${list.length}`}</span>
              </div>
            </div>

            <div className="tk-block">
              <div className="label">{`ORDER — ${units} ITEM${units === 1 ? '' : 'S'}`}</div>
              {stop.items.map((item) => (
                <div key={item.name} className="tk-row micro">
                  <span className="tk-row-name">{item.name}</span>
                  <span className="tk-leader" />
                  <span className="micro--mono tk-qty">{`×${item.qty}`}</span>
                </div>
              ))}
              <div className="tk-total">
                <span className="label">
                  {delivered ? `PAID — ${PAYMENT_LABEL[stop.payment]}` : `DUE ON DELIVERY — ${PAYMENT_LABEL[stop.payment]}`}
                </span>
                <span className="tk-leader" />
                <span className="tk-total-value">{formatMoney(stop.amountDue)}</span>
              </div>
            </div>
          </div>

          <div className="micro micro--dim tk-fine">
            Demo uses fictional data. Not affiliated with any licensed operator.
          </div>
        </div>
      </section>
    </div>
  )
}

export default TrackingPage
