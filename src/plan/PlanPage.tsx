/**
 * Route planning sandbox `/plan`.
 *
 * SPEC.md, "Route planning sandbox + sequencing philosophy":
 *
 *   "Suggest, allow bounded adjustment, quantify, log."
 *
 * The product argument this screen makes, in the operator's own words: stores
 * serve a zone, orders arrive from every corner, the suggested order is
 * sometimes wrong, and local drivers know shortcuts. Sweed allowed no route
 * adjustment at all, which is a real pain point. Free drag-and-drop is the other
 * failure — total freedom means nobody owns the outcome. So: the system
 * proposes, the dispatcher nudges within bounds, and the cost of every nudge is
 * shown in minutes rather than argued about.
 *
 * Everything on screen is measured, never asserted:
 *   - the suggested order comes from nearest-neighbour + 2-opt over the
 *     precomputed leg matrix (src/routing/optimize.ts)
 *   - "Yours" is recomputed from the same matrix on every nudge
 *   - the late-order verdict is the feasibility arithmetic in
 *     src/routing/feasibility.ts, windows and all
 *   - dispatch builds a REAL run that the same sim engine drives
 *
 * Honesty rail (DESIGN.md): the demo-fleet pill stays up, and the static-estimate
 * caveat sits next to the numbers it qualifies, not in a footnote.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import MapCanvas, { type MapPadding, type MapPreview } from '../map/MapCanvas'
import { DemoChip, ThemeToggle, Wordmark } from '../ui/controls'
import { ChevronDown, ChevronUp } from '../console/icons'
import { useStore } from '../store'
import { formatClock, shortName } from '../format'
import { nodePosition, pathCoords } from '../routing/matrix'
import { suggestForSet, totalDuration } from '../routing/optimize'
import { canFitToday, type FitResult } from '../routing/feasibility'
import {
  dispatchPlannedRun,
  planRunInput,
  poolOrders,
  shiftEndMs,
  windowRisks,
  type PlannedDispatch,
  type PoolOrder,
} from './planRun'
import { compare } from './display'
import './plan.css'

const RAIL_PADDING: MapPadding = { top: 64, bottom: 24, left: 24, right: 24 }

export function PlanPage() {
  /*
   * Deliberately NOT subscribed to `stops`: the sim engine republishes every ETA
   * five times a second, and this page would re-render the whole planner with
   * it. The pool only changes when the fleet is re-seeded, which `generation`
   * announces.
   */
  const generation = useStore((s) => s.generation)
  /*
   * The demo clock runs at eight times real time. Re-anchoring the pool every
   * fifteen sim-minutes (about two real minutes) keeps a tab that has been left
   * open from drifting into a state where every window has closed and the
   * planner can only ever say no. Selecting the bucket rather than the clock is
   * what keeps that from being a 5 Hz re-render.
   */
  const clockBucket = useStore((s) => Math.floor((s.simNowMs || Date.now()) / 900_000))
  /**
   * The planning moment every figure on this screen is measured from. Held for
   * the whole bucket on purpose: the pool's promised windows, the projected
   * arrivals and the depot cutoff all have to be anchored to the SAME instant,
   * or a stop could be flagged amber against a window that was computed two
   * minutes of sim-time ago.
   */
  const nowMs = useMemo(
    () => useStore.getState().simNowMs || Date.now(),
    [generation, clockBucket],
  )
  const pool = useMemo<PoolOrder[]>(() => poolOrders(nowMs), [nowMs])

  const [selected, setSelected] = useState<string[]>([])
  const [sequence, setSequence] = useState<string[]>([])
  const [lateIndex, setLateIndex] = useState(0)
  const [lateOrder, setLateOrder] = useState<{ order: PoolOrder; verdict: FitResult } | null>(null)
  const [dispatched, setDispatched] = useState<PlannedDispatch | null>(null)

  const selectedKey = selected.join('|')
  const selectedSet = useMemo(() => new Set(selected), [selectedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const byNode = useMemo(() => new Map(pool.map((o) => [o.nodeId, o])), [pool])

  /** The depot's closing time, in the sim's clock. */
  const cutoffLabel = useMemo(() => formatClock(shiftEndMs(nowMs)), [nowMs])

  /**
   * The proposal. A property of the SET of stops and nothing else — ticking the
   * same four orders in a different order must not move the number the screen
   * calls "Suggested". See `suggestForSet`.
   */
  const suggestion = useMemo(
    () => suggestForSet(selected),
    [selectedKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** The proposal this working order was last reconciled against. */
  const lastSuggestion = useRef<string[]>([])

  /**
   * Keep the working order in step with the selection WITHOUT throwing away
   * nudges.
   *
   * The distinction that matters is whether the dispatcher has actually MOVED
   * anything. If they have, their positions are held and newly picked orders
   * land at the end. If they have not, the working order is just the last
   * proposal with a stop added or removed, and it must become the new
   * proposal — otherwise the planner never once shows the sequence it is
   * recommending. Picking four orders would leave the screen displaying the
   * order they happened to be tapped in, scored against a suggestion the
   * dispatcher never saw and never rejected, amber and all.
   */
  useEffect(() => {
    const previous = lastSuggestion.current
    lastSuggestion.current = suggestion.sequence
    setSequence((prev) => {
      const keep = prev.filter((id) => selectedSet.has(id))
      if (keep.length === 0) return suggestion.sequence
      const untouched =
        keep.join('|') === previous.filter((id) => selectedSet.has(id)).join('|')
      if (untouched) return suggestion.sequence
      const added = suggestion.sequence.filter((id) => !keep.includes(id))
      return added.length === 0 ? keep : [...keep, ...added]
    })
    setLateOrder(null)
  }, [selectedKey, suggestion, selectedSet])

  const yoursS = useMemo(() => totalDuration(sequence), [sequence])
  const matchesSuggestion = sequence.join('|') === suggestion.sequence.join('|')
  /*
   * All three displayed figures come out of one rounding, so "Yours 47 ·
   * Suggested 35 · +11" — which is what independent roundings used to produce —
   * cannot happen. See display.ts.
   */
  const comparison = useMemo(
    () => compare(yoursS, suggestion.suggestedS),
    [yoursS, suggestion.suggestedS],
  )

  /**
   * SPEC's compliance surface: "stops outside their window flag amber on
   * console", and the story page promises amber BEFORE a miss. The late-order
   * path already refused window-breaking insertions; a manual reorder used to
   * report only the drive-time delta, so a dispatcher could demote a stop past
   * its own window and see nothing but "+11 min". Same arithmetic, both paths.
   */
  const risks = useMemo(() => windowRisks(sequence, pool, nowMs), [sequence, pool, nowMs])
  const riskByNode = useMemo(() => new Map(risks.map((r) => [r.nodeId, r])), [risks])

  /* ------------------------------------------------------------- preview -- */

  const preview = useMemo<MapPreview | null>(() => {
    if (dispatched) return null
    if (sequence.length === 0) return null
    return {
      coords: pathCoords(sequence),
      stops: sequence.map((nodeId) => ({ id: nodeId, lngLat: nodePosition(nodeId) })),
      fit: true,
    }
  }, [sequence, dispatched])

  /* ------------------------------------------------------------- actions -- */

  const toggleOrder = useCallback((nodeId: string) => {
    setSelected((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId],
    )
  }, [])

  /** SPEC: bounded adjustment. One position at a time, never a free drag. */
  const nudge = useCallback((nodeId: string, direction: -1 | 1) => {
    setSequence((prev) => {
      const index = prev.indexOf(nodeId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setLateOrder(null)
  }, [])

  const useSuggested = useCallback(() => {
    setSequence(suggestion.sequence)
    setLateOrder(null)
  }, [suggestion])

  const clearAll = useCallback(() => {
    setSelected([])
    setSequence([])
    setLateOrder(null)
  }, [])

  /**
   * "A late order just landed." Runs the real feasibility arithmetic against the
   * run as currently ordered and reports the verdict honestly — including the
   * verdicts that say no.
   */
  const testLateOrder = useCallback(() => {
    const candidates = pool.filter((o) => !selectedSet.has(o.nodeId))
    if (candidates.length === 0 || sequence.length === 0) {
      setLateOrder(null)
      return
    }
    const order = candidates[lateIndex % candidates.length]
    const run = planRunInput(sequence, pool, nowMs)
    setLateOrder({ order, verdict: canFitToday(order.nodeId, run, nowMs) })
    setLateIndex((i) => i + 1)
  }, [pool, selectedSet, sequence, lateIndex, nowMs])

  /** Accept the insertion the feasibility check found. */
  const acceptLateOrder = useCallback(() => {
    if (!lateOrder?.verdict.fits) return
    const { order, verdict } = lateOrder
    setSequence((prev) => [
      ...prev.slice(0, verdict.insertAt),
      order.nodeId,
      ...prev.slice(verdict.insertAt),
    ])
    setSelected((prev) => (prev.includes(order.nodeId) ? prev : [...prev, order.nodeId]))
    setLateOrder(null)
  }, [lateOrder])

  const dispatchRun = useCallback(() => {
    if (sequence.length === 0) return
    setDispatched(
      dispatchPlannedRun(sequence, pool, {
        suggestedS: suggestion.suggestedS,
        naiveS: suggestion.naiveS,
      }),
    )
  }, [sequence, pool, suggestion])

  const planAnother = useCallback(() => {
    setDispatched(null)
    setSelected([])
    setSequence([])
    setLateOrder(null)
  }, [])

  /* ------------------------------------------------- dispatched run watch -- */

  /**
   * One string, so this re-renders when the run's PROGRESS changes and not on
   * every 5 Hz position publish. Empty means the run is gone — the demo fleet
   * loops, and a reset takes planner builds with it.
   */
  const runWatch = useStore((s) => {
    if (!dispatched) return ''
    const run = s.runs[dispatched.runId]
    if (!run) return ''
    const done = run.stops.filter((id) => {
      const stop = s.stops[id]
      return stop?.status === 'delivered' || stop?.status === 'exception'
    }).length
    const current = run.stops.find((id) => {
      const stop = s.stops[id]
      return stop && stop.status !== 'delivered' && stop.status !== 'exception'
    })
    const eta = current ? s.stops[current]?.etaMin ?? null : null
    return `${run.status}|${done}|${run.stops.length}|${eta ?? '-'}`
  })

  const [watchStatus, watchDone, watchTotal, watchEta] = runWatch.split('|')

  /* -------------------------------------------------------------- render -- */

  const selectedOrders = sequence.map((id) => byNode.get(id)).filter(Boolean) as PoolOrder[]

  return (
    <div className="pl-root">
      <MapCanvas
        padding={RAIL_PADDING}
        initialFit="fleet"
        preview={preview}
        showRoutes={Boolean(dispatched)}
        showStops={Boolean(dispatched)}
        {...(dispatched ? { runIds: [dispatched.runId] } : {})}
      />

      <div className="pl-topbar">
        <div className="glass pl-strip">
          <Wordmark subtitle="Planner" />
          <DemoChip />
          <span className="chip chip--quiet pl-hide-sm">Static travel estimates</span>
        </div>
        <div className="glass pl-strip pl-strip--tools">
          <ThemeToggle />
          <Link className="btn" to="/dispatch">
            Console
          </Link>
        </div>
      </div>

      <div className="glass pl-rail">
        {dispatched ? (
          <section className="pl-section pl-watch">
            <div className="plate plate--accent">
              <span>Dispatched</span>
              <span className="plate-id">{dispatched.manifestId}</span>
            </div>
            <div className="pl-watch__body">
              {runWatch === '' ? (
                <>
                  <p className="display display--sm">That run is done.</p>
                  <p className="micro">
                    The demo fleet loops: when every run finishes it re-seeds itself, and planner
                    builds go with it. Nothing was lost — this board is a sandbox.
                  </p>
                </>
              ) : (
                <>
                  <p className="display display--sm">Your run is driving.</p>
                  <div className="pl-watch__stat">
                    <span className="numeral numeral--accent">{watchEta === '-' ? '—' : watchEta}</span>
                    <span className="label">{watchEta === '-' ? 'no eta' : 'min to next stop'}</span>
                  </div>
                  <div className="pl-chips">
                    <span className="chip chip--accent">{`Stop ${watchDone}/${watchTotal}`}</span>
                    <span className="chip">{dispatched.label}</span>
                    <span className="chip chip--quiet">{watchStatus}</span>
                  </div>
                  <p className="micro">
                    The same sim engine that drives the seeded fleet is driving this one, along the
                    matrix legs you sequenced. Watch it on the console, or work it as the driver.
                  </p>
                </>
              )}
              <div className="pl-actions">
                <Link className="btn btn--primary" to="/dispatch">
                  Watch it drive
                </Link>
                <Link className="btn" to="/driver">
                  Driver app
                </Link>
                <button type="button" className="btn" onClick={planAnother}>
                  Plan another
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="pl-section">
              <div className="plate">
                <span>Unrouted orders</span>
                {/* Sentence, not a ratio: "0/11" reads as zero orders available. */}
                <span className="pl-plate-count">{`${selected.length} of ${pool.length} picked`}</span>
              </div>
              <p className="micro pl-note">
                Packed and waiting on the POS handoff — pick the ones going out on this van. This is
                a practice pool of its own orders, separate from tonight's board on the console.
              </p>
              <ul className="pl-pool">
                {pool.map((order) => {
                  const on = selectedSet.has(order.nodeId)
                  return (
                    <li key={order.nodeId}>
                      <button
                        type="button"
                        className={`ticket pl-order${on ? ' ticket--active' : ''}`}
                        onClick={() => toggleOrder(order.nodeId)}
                        aria-pressed={on}
                      >
                        <span className="pl-order__head">
                          <span className="pl-order__name">{shortName(order.customer)}</span>
                          <span className="chip chip--mono">{order.orderCode}</span>
                        </span>
                        <span className="micro micro--dim pl-order__addr">{order.address}</span>
                        <span className="micro">{`${order.window[0]}–${order.window[1]}`}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="pl-section">
              <div className="plate">
                <span>Your run</span>
                <span className="plate-id">{`${sequence.length} STOPS`}</span>
              </div>

              {sequence.length === 0 ? (
                <p className="micro pl-note pl-empty">
                  Nothing picked yet. Choose a few orders above and the planner will propose a
                  sequence over real road times.
                </p>
              ) : (
                <>
                  <ol className="pl-seq">
                    {selectedOrders.map((order, i) => {
                      const risk = riskByNode.get(order.nodeId)
                      return (
                      <li
                        key={order.nodeId}
                        className={`pl-seqrow${risk ? ' pl-seqrow--late' : ''}`}
                      >
                        <span className="pl-seqrow__num">{i + 1}</span>
                        <span className="pl-seqrow__main">
                          <span className="pl-seqrow__name">{shortName(order.customer)}</span>
                          {risk ? (
                            <span className="micro pl-seqrow__risk">{risk.reason}</span>
                          ) : (
                            <span className="micro micro--dim">{`${order.window[0]}–${order.window[1]}`}</span>
                          )}
                        </span>
                        <span className="pl-nudge">
                          <button
                            type="button"
                            className="pl-nudge__btn"
                            onClick={() => nudge(order.nodeId, -1)}
                            disabled={i === 0}
                            aria-label={`Promote ${order.orderCode} in the run sequence`}
                            title="Promote"
                          >
                            <ChevronUp size={10} />
                          </button>
                          <button
                            type="button"
                            className="pl-nudge__btn"
                            onClick={() => nudge(order.nodeId, 1)}
                            disabled={i === sequence.length - 1}
                            aria-label={`Demote ${order.orderCode} in the run sequence`}
                            title="Demote"
                          >
                            <ChevronDown size={10} />
                          </button>
                        </span>
                      </li>
                      )
                    })}
                  </ol>
                  <p className="micro pl-note">
                    One position at a time, no free drag. A sequence nobody can explain is a
                    sequence nobody owns, so every move is measured and written to the manifest.
                  </p>
                </>
              )}
            </section>

            <section className="pl-section">
              <div className="plate">
                <span>Same-day feasibility</span>
                <span className="plate-id">ARITHMETIC</span>
              </div>
              <div className="pl-late">
                <button
                  type="button"
                  className="btn"
                  onClick={testLateOrder}
                  disabled={sequence.length === 0 || selected.length >= pool.length}
                >
                  A late order just landed
                </button>
                {lateOrder ? (
                  <div
                    className={`pl-verdict${lateOrder.verdict.fits ? ' pl-verdict--fits' : ' pl-verdict--no'}`}
                  >
                    <span className="pl-verdict__head">
                      <span className="pl-verdict__who">{shortName(lateOrder.order.customer)}</span>
                      <span className="chip chip--mono">{lateOrder.order.orderCode}</span>
                    </span>
                    <span className="micro micro--dim">
                      {`Window ${lateOrder.order.window[0]}–${lateOrder.order.window[1]}`}
                    </span>
                    <p className="micro pl-verdict__reason">{lateOrder.verdict.reason}</p>
                    {lateOrder.verdict.fits ? (
                      <button type="button" className="btn btn--primary" onClick={acceptLateOrder}>
                        {`Add as stop ${lateOrder.verdict.insertAt + 1}`}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="micro pl-note">
                    Remaining driver time, the leg matrix, a fixed service time per doorstep and
                    every delivery window already promised. An insertion that breaks any of them is
                    refused rather than absorbed.
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {dispatched ? null : (
        <div className="glass pl-footer">
          <div className="pl-compare">
            <span className="pl-compare__pair">
              <span className="label">Yours</span>
              <span className="pl-compare__value">
                {sequence.length === 0 ? '—' : comparison.yoursLabel}
              </span>
            </span>
            <span className="pl-compare__sep" aria-hidden="true">
              ·
            </span>
            <span className="pl-compare__pair">
              <span className="label">Suggested</span>
              <span className="pl-compare__value pl-compare__value--accent">
                {sequence.length === 0 ? '—' : comparison.suggestedLabel}
              </span>
            </span>
            {sequence.length > 0 ? (
              <span
                className={`chip${
                  matchesSuggestion ? ' chip--accent' : comparison.costsTime ? ' chip--amber' : ''
                }`}
              >
                {matchesSuggestion ? 'Matching' : comparison.deltaLabel}
              </span>
            ) : null}
            {risks.length > 0 ? (
              <span className="chip chip--amber">
                {risks.length === 1
                  ? '1 stop misses its window'
                  : `${risks.length} stops miss their window`}
              </span>
            ) : null}
          </div>

          <div className="pl-actions pl-actions--foot">
            <button
              type="button"
              className="btn"
              onClick={useSuggested}
              disabled={sequence.length === 0 || matchesSuggestion}
            >
              Use suggested order
            </button>
            <button
              type="button"
              className="btn"
              onClick={clearAll}
              disabled={sequence.length === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={dispatchRun}
              disabled={sequence.length === 0}
            >
              Dispatch run
            </button>
          </div>

          <p className="micro micro--dim pl-foot-note">
            {`Travel times are static estimates from a leg matrix measured once, not live traffic. Depot cutoff ${cutoffLabel}.`}
          </p>
        </div>
      )}
    </div>
  )
}

export default PlanPage
