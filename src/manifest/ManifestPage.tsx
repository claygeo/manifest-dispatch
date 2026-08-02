/**
 * Printable delivery manifest — `/manifest/:runId`. The compliance surface.
 *
 * SPEC.md: "Every run carries a manifest: `/manifest/:runId` printable
 * document — mono/document styling, dispensary + vehicle + driver, ordered
 * stops with orderCodes, window times, signature lines."
 *
 * This is deliberately a document and not a dashboard: ruled field blocks,
 * plate headers opening every section, a stop table that itemises what is in
 * the van, a custody log with a signature rule per order, and signature lines
 * for the people who are accountable for the product. It prints to letter
 * paper with 0.5in margins and survives a browser that refuses to print
 * background graphics (see manifest.css).
 *
 * Vehicle, seal, agent id and facility address are deterministic fictional
 * values derived from the run id — stable across fleet resets so a printed
 * page and the screen never disagree.
 *
 * ALL DATA IS FICTIONAL. Not affiliated with any licensed operator.
 */

import { Fragment, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EXCEPTION_LABEL, useStore } from '../store'
import { DemoChip, ThemeToggle, Wordmark } from '../ui/controls'
import { isLateArrivalNote, runCounts, runStops, windowLabel, windowState } from '../selectors'
import { DEPOT_NAME } from '../data/seed'
import { seededRange } from '../sim/geo'
import {
  formatClock,
  formatDocDate,
  formatMoney,
  formatStamp,
  PAYMENT_LABEL,
  RUN_STATUS_LABEL,
  STOP_STATUS_LABEL,
} from '../format'
import type { DeliveryEvent, Stop } from '../types'
import './manifest.css'

/* Fictional facility record. The demo has one origin; it is invented. */
const FACILITY_ADDRESS = '1400 N FRANKLIN ST · TAMPA, FL 33602'
const FACILITY_LICENSE = 'MMTC LICENSE DEMO-0000 · FL OMMU DELIVERY'

const NOTES = [
  'Product remains in the locked transport compartment between stops. This manifest travels with the vehicle for the duration of the run.',
  'Government-issued photo ID is verified at every transfer. The dispatch app cannot close a stop without a recorded ID verification.',
  'Deliveries are made inside the scheduled window shown for each stop. Stops projected outside their window are flagged to the dispatcher and annotated below.',
  'Undelivered product returns to the origin facility and is reconciled against this manifest at check-in.',
  'This document is a demonstration artifact produced by a portfolio build. It is not a filed regulatory record.',
]

/* -------------------------------------------------------------- helpers -- */

interface Stamps {
  arrived: number | null
  verified: number | null
  closed: number | null
  /**
   * Window note recorded AT the arrival, e.g. 'LATE — WINDOW CLOSED 4:00 PM'.
   * The projected `windowState` cannot answer this after the fact: it reports
   * 'closed' for a delivered stop, so a late delivery would print clean.
   */
  arrivedNote: string | null
  /** Exception reason label, when the stop went undeliverable or was cancelled. */
  exception: string | null
}

/** Event timestamps per stop, folded once per render. */
function buildStamps(events: DeliveryEvent[]): Record<string, Stamps> {
  const out: Record<string, Stamps> = {}
  for (const e of events) {
    if (!e.stopId) continue
    const s =
      out[e.stopId] ??
      (out[e.stopId] = {
        arrived: null,
        verified: null,
        closed: null,
        arrivedNote: null,
        exception: null,
      })
    const t = Date.parse(e.at)
    if (e.type === 'arrived') {
      s.arrived = t
      s.arrivedNote = e.meta?.window ?? null
    } else if (e.type === 'id_verified') s.verified = t
    else if (e.type === 'closed') s.closed = t
    else if (e.type === 'exception' || e.type === 'id_failed') s.exception = e.meta?.reason ?? null
  }
  return out
}

/** Deterministic fictional transport record for a run. */
function transportFor(runId: string): {
  plate: string
  vehicle: string
  seal: string
  agentId: string
} {
  const plate = Math.floor(seededRange(`${runId}#plate`, 1000, 9999))
  const seal = Math.floor(seededRange(`${runId}#seal`, 100000, 999999))
  const agent = Math.floor(seededRange(`${runId}#agent`, 100, 999))
  return {
    plate: `MFT-${plate}`,
    vehicle: '2024 FORD TRANSIT 250 — WHITE',
    seal: `TS-${seal}`,
    agentId: `FL-AGT-${agent}`,
  }
}

/**
 * Browsers print `document.title` in the page header, so naming the tab after
 * the manifest id is what puts the document id on every printed sheet.
 */
function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}

function unitsOf(stop: Stop): number {
  return stop.items.reduce((n, item) => n + item.qty, 0)
}

function clockOr(ms: number | null | undefined): string {
  return ms ? formatClock(ms) : '—'
}

/* ------------------------------------------------------------ component -- */

export function ManifestPage() {
  const { runId = '' } = useParams()
  const runs = useStore((s) => s.runs)
  const runOrder = useStore((s) => s.runOrder)
  const stops = useStore((s) => s.stops)
  const events = useStore((s) => s.events)
  const simNowMs = useStore((s) => s.simNowMs)

  const view = useMemo(() => ({ runs, runOrder, stops }), [runs, runOrder, stops])
  const stamps = useMemo(() => buildStamps(events), [events])

  const run = runs[runId]
  useDocumentTitle(run ? `${run.manifestId} — delivery manifest` : 'Delivery manifest')

  if (!run) {
    return (
      <div className="mf-root">
        <div className="panel mf-miss">
          <div className="plate">
            <span>MANIFEST NOT FOUND</span>
            <span>{runId ? runId.toUpperCase() : '—'}</span>
          </div>
          <div className="micro mf-miss-body">
            No run on today&rsquo;s board carries that id. Open a manifest from the dispatch
            console, or pick one here:
          </div>
          <div className="mf-runs">
            {runOrder.map((id) => (
              <Link key={id} className="chip mf-run-link" to={`/manifest/${id}`}>
                {runs[id]?.manifestId ?? id}
              </Link>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const index = runOrder.indexOf(run.id)
  const letter = String.fromCharCode(65 + Math.max(0, index))
  const list = runStops(view, run.id)
  const counts = runCounts(view, run.id)
  const transport = transportFor(run.id)

  const dispatched = events.find((e) => e.runId === run.id && e.type === 'run_started')
  const totalAmount = list.reduce((sum, s) => sum + s.amountDue, 0)
  const totalUnits = list.reduce((sum, s) => sum + unitsOf(s), 0)
  const collected = list
    .filter((s) => s.status === 'delivered')
    .reduce((sum, s) => sum + s.amountDue, 0)
  /* Window compliance, split honestly: one number is a projection about stops
     still open, the other is a recorded fact about stops already served. */
  const projectedLate = list.filter(
    (s) => s.status !== 'delivered' && windowState(s, simNowMs) === 'late',
  ).length
  const arrivedLate = list.filter((s) => isLateArrivalNote(stamps[s.id]?.arrivedNote)).length
  const cancelledCount = list.filter(
    (s) => s.status === 'exception' && stamps[s.id]?.exception === EXCEPTION_LABEL.cancelled,
  ).length

  const exceptionParts: string[] = []
  if (arrivedLate > 0) exceptionParts.push(`${arrivedLate} ARRIVED LATE`)
  if (projectedLate > 0) exceptionParts.push(`${projectedLate} PROJECTED LATE`)
  if (cancelledCount > 0) exceptionParts.push(`${cancelledCount} CANCELLED`)

  return (
    <div className="mf-root">
      <div className="mf-bar no-print">
        <Wordmark subtitle="COMPLIANCE" />
        <DemoChip />
        <span className="chip">{`STOPS ${counts.done}/${counts.total} CLOSED`}</span>
        <div className="mf-bar-end">
          <Link className="btn" to="/">
            BACK TO DISPATCH
          </Link>
          <ThemeToggle />
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            PRINT MANIFEST
          </button>
        </div>
      </div>

      <article className="mf-sheet">
        <div className="plate">
          <span>DELIVERY MANIFEST</span>
          <span>{run.manifestId}</span>
        </div>

        <header className="mf-masthead">
          <div>
            <div className="mf-org">{DEPOT_NAME}</div>
            <div className="micro micro--mono micro--dim mf-org-line">{FACILITY_ADDRESS}</div>
            <div className="micro micro--mono micro--dim mf-org-line">{FACILITY_LICENSE}</div>
          </div>
          <div className="mf-metric">
            <div className="label">STOPS CLOSED</div>
            {/* the ONE display numeral this document is allowed */}
            <div className="numeral numeral--sm">{`${counts.done}/${counts.total}`}</div>
          </div>
        </header>

        <div className="plate plate--quiet">
          <span>TRANSPORT RECORD</span>
          <span>{formatDocDate(simNowMs)}</span>
        </div>

        <div className="mf-grid">
          <Field label="RUN" value={`RUN ${letter} — ${run.label.toUpperCase()}`} />
          <Field label="DRIVER OF RECORD" value={run.driver} />
          <Field label="AGENT ID" value={transport.agentId} dim />
          <Field label="VEHICLE" value={transport.vehicle} />
          <Field label="PLATE (FL)" value={transport.plate} />
          <Field label="TRANSPORT SEAL" value={transport.seal} dim />
          <Field
            label="DISPATCHED"
            value={dispatched ? formatClock(Date.parse(dispatched.at)) : 'NOT YET DISPATCHED'}
          />
          <Field label="RUN STATUS" value={RUN_STATUS_LABEL[run.status]} />
          <Field
            label="WINDOW EXCEPTIONS"
            value={exceptionParts.length === 0 ? 'NONE' : exceptionParts.join(' · ')}
            amber={exceptionParts.length > 0}
          />
        </div>

        <div className="plate plate--quiet">
          <span>MANIFEST STOPS</span>
          <span>{`${list.length} ORDERS · ${totalUnits} UNITS`}</span>
        </div>

        <div className="mf-scroll">
          <table className="mf-table">
            <thead>
              <tr>
                <th>#</th>
                <th>ORDER</th>
                <th>CUSTOMER</th>
                <th>ADDRESS</th>
                <th>WINDOW</th>
                <th className="mf-num">AMOUNT</th>
                <th>PAY</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {list.map((stop, i) => {
                const stamp = stamps[stop.id]
                const lateArrival = isLateArrivalNote(stamp?.arrivedNote)
                const late =
                  lateArrival || (stop.status !== 'delivered' && windowState(stop, simNowMs) === 'late')
                const flagged = late || stop.status === 'exception'
                const cancelled =
                  stop.status === 'exception' && stamp?.exception === EXCEPTION_LABEL.cancelled
                return (
                  <Fragment key={stop.id}>
                    <tr className="mf-stop">
                      <td className="mf-num">{i + 1}</td>
                      <td className="mf-nowrap">{stop.orderCode}</td>
                      <td>{stop.customer}</td>
                      <td>{stop.address}</td>
                      <td className={`mf-nowrap${late ? ' mf-flag' : ''}`}>{windowLabel(stop)}</td>
                      <td className="mf-num">{formatMoney(stop.amountDue)}</td>
                      <td className="mf-nowrap">{PAYMENT_LABEL[stop.payment]}</td>
                      <td className={`mf-nowrap${flagged ? ' mf-flag' : ''}`}>
                        {cancelled
                          ? EXCEPTION_LABEL.cancelled
                          : late && stop.status !== 'exception'
                            ? stop.status === 'delivered'
                              ? 'DELIVERED LATE'
                              : 'LATE'
                            : STOP_STATUS_LABEL[stop.status]}
                      </td>
                    </tr>
                    <tr className="mf-items">
                      <td />
                      <td colSpan={7}>
                        {stop.items.map((item) => `${item.qty} × ${item.name}`).join('   ·   ')}
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
              <tr className="mf-totals">
                <td colSpan={5}>{`TOTALS — ${list.length} STOPS · ${totalUnits} UNITS`}</td>
                <td className="mf-num">{formatMoney(totalAmount)}</td>
                <td colSpan={2}>{`COLLECTED ${formatMoney(collected)}`}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="plate plate--quiet">
          <span>CUSTODY LOG</span>
          <span>ID VERIFIED AT EVERY TRANSFER</span>
        </div>

        <div className="mf-scroll">
          <table className="mf-table">
            <thead>
              <tr>
                <th>ORDER</th>
                <th>ARRIVED</th>
                <th>ID VERIFIED</th>
                <th>CLOSED</th>
                <th className="mf-num">COLLECTED</th>
                <th className="mf-sign-cell">RECIPIENT SIGNATURE</th>
              </tr>
            </thead>
            <tbody>
              {list.map((stop) => {
                const s = stamps[stop.id]
                const delivered = stop.status === 'delivered'
                const lateArrival = isLateArrivalNote(s?.arrivedNote)
                const cancelled =
                  stop.status === 'exception' && s?.exception === EXCEPTION_LABEL.cancelled
                return (
                  <tr key={stop.id}>
                    <td className="mf-nowrap">{stop.orderCode}</td>
                    {/* The arrival stamp carries its own window verdict: once a
                        stop closes, nothing else in the record remembers that
                        the driver got there after the window shut. */}
                    <td className={`mf-nowrap${lateArrival ? ' mf-flag' : ''}`}>
                      {clockOr(s?.arrived)}
                      {lateArrival ? ' LATE' : ''}
                    </td>
                    <td className="mf-nowrap">
                      {stop.idChecked ? `[X] ${clockOr(s?.verified)}` : '[ ]'}
                    </td>
                    <td className={`mf-nowrap${cancelled ? ' mf-flag' : ''}`}>
                      {cancelled
                        ? EXCEPTION_LABEL.cancelled
                        : clockOr(stop.closedAt ? Date.parse(stop.closedAt) : s?.closed)}
                    </td>
                    <td className="mf-num">{delivered ? formatMoney(stop.amountDue) : '—'}</td>
                    <td className="mf-sign-cell">
                      {/* A cancelled order was never handed over; a signature
                          rule there would invite a signature for a transfer
                          that did not happen. */}
                      {cancelled ? (
                        <span className="micro micro--dim">NO TRANSFER — ORDER CANCELLED</span>
                      ) : (
                        <div className="mf-sign-rule" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="plate plate--quiet">
          <span>SIGNATURES</span>
          <span>{run.manifestId}</span>
        </div>

        <div className="mf-sigs">
          <Signature label="DRIVER OF RECORD" hint={run.driver} />
          <Signature label="FACILITY AGENT — RELEASE" hint="DATE / TIME" />
          <Signature label="FACILITY AGENT — RETURN CHECK-IN" hint="DATE / TIME" />
          <Signature label="COMPLIANCE REVIEW" hint="DATE / TIME" />
        </div>

        <div className="plate plate--quiet">
          <span>COMPLIANCE NOTES</span>
        </div>

        <ol className="mf-notes">
          {NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ol>

        <footer className="mf-foot">
          <span className="micro micro--dim">
            Demo uses fictional data. Not affiliated with any licensed operator.
          </span>
          <span className="micro micro--mono micro--dim">
            {`GENERATED ${formatDocDate(simNowMs)} ${formatStamp(simNowMs)}`}
          </span>
        </footer>
      </article>
    </div>
  )
}

/* ----------------------------------------------------------- fragments --- */

function Field({
  label,
  value,
  dim,
  amber,
}: {
  label: string
  value: string
  dim?: boolean
  amber?: boolean
}) {
  const cls = amber ? 'mf-value mf-value--amber' : dim ? 'mf-value mf-value--dim' : 'mf-value'
  return (
    <div className="mf-field">
      <div className="label">{label}</div>
      <div className={cls}>{value}</div>
    </div>
  )
}

function Signature({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="mf-sig">
      <div className="mf-sig-rule" />
      <div className="mf-sig-label">
        <span className="label">{label}</span>
        <span className="label">{hint.toUpperCase()}</span>
      </div>
    </div>
  )
}

export default ManifestPage
