/**
 * Story page `/` — the front door.
 *
 * SPEC.md: "The audience is a director who will never take the call but might
 * tap a link." So the root of this app is not the console. It is one order's
 * lifecycle, top to bottom, readable by scrolling and nothing else, in about a
 * minute, on a phone or a desktop.
 *
 * Everything framed below is the live product. The map behind the hero is the
 * same MapLibre canvas the console flies; the ticket, the tracking card, the
 * ID gate, the closeout screen and the printable manifest are the same
 * components under `/driver`, `/t/:orderCode` and `/manifest/:runId`, mounted
 * against the same zustand store and the same running sim. There is not one
 * screenshot on this page. If an embed could not be live it would not ship.
 *
 * Register (DESIGN.md v2): this is the one marketing surface, so Source Serif 4
 * is allowed to carry the headlines instead of appearing only at display
 * moments. Everything else holds: one fern accent, amber reserved for
 * exceptions, dual radius, mono for identifiers, and the honesty rail visible
 * throughout — `Demo fleet` on every embed that has one, fictional-data
 * disclaimer in the footer, measured numbers with their caveats attached.
 *
 * Motion: plain document scroll. No scroll-jacking, no pinning, no parallax.
 * The only page-authored motion is a short fade-and-rise per block, which
 * `prefers-reduced-motion` removes entirely.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import MapCanvas from '../map/MapCanvas'
import { useStore } from '../store'
import { DemoChip } from '../ui/controls'
import { formatMoney, PAYMENT_TEXT } from '../format'
import { windowLabel } from '../selectors'
import type { PaymentMethod } from '../types'
import { EmbedFrame, LazyBlock, Reveal, type StageSize } from './Frame'
import {
  BROADCAST_CAVEATS,
  BROADCAST_RUN,
  BROADCAST_TIERS,
  TEST_COUNTS,
} from './proof'
import {
  ConsoleEmbed,
  DriverIdEmbed,
  DriverPaymentEmbed,
  DriverTicketEmbed,
  featureRunId,
  featureStopId,
  idCheckStopId,
  ManifestEmbed,
  stopIdForPayment,
  TrackingEmbed,
  useStop,
} from './embeds'
import './story.css'

const PAGE_TITLE = 'Manifest — delivery dispatch'

/** Matches TrackingPage's own `useNarrow`, so an embed never straddles it. */
const NARROW_QUERY = '(max-width: 760px)'

const TENDERS: PaymentMethod[] = ['cash', 'debit', 'digital']

/* --------------------------------------------------------------- hooks --- */

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true,
  )
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/**
 * The app's other surfaces are pinned panes; this one scrolls. theme.css locks
 * html/body/#root to the viewport height for them, so the story asks for the
 * document back while it is mounted and hands it straight back on the way out.
 */
function useScrollableDocument(): void {
  useEffect(() => {
    document.documentElement.classList.add('st-scroll')
    return () => document.documentElement.classList.remove('st-scroll')
  }, [])
}

/**
 * Two embedded pages (tracking and the manifest) name the browser tab after
 * their subject, which is right when they ARE the page and wrong when they are
 * a figure inside one. Rather than fork those components, the story holds the
 * title and puts it back if anything else writes it.
 */
function useHeldTitle(title: string): void {
  useEffect(() => {
    const node = document.querySelector('title')
    document.title = title
    if (!node || typeof MutationObserver === 'undefined') return
    const mo = new MutationObserver(() => {
      if (document.title !== title) document.title = title
    })
    mo.observe(node, { childList: true, characterData: true, subtree: true })
    return () => mo.disconnect()
  }, [title])
}

/** Show the return control once the hero is well behind you. */
function useScrolledPast(px: number): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    let raf = 0
    const read = () => {
      raf = 0
      setPast(window.scrollY > px)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [px])
  return past
}

/* ------------------------------------------------------------ fragments -- */

function SectionHead({
  step,
  title,
  lede,
}: {
  step: string
  title: string
  lede: string
}) {
  return (
    <header className="st-head">
      <p className="st-eyebrow">{step}</p>
      <h2 className="st-title">{title}</h2>
      <p className="st-lede">{lede}</p>
    </header>
  )
}

/** The order record as Manifest accepts it, straight off the live store. */
function OrderRecord({ stopId }: { stopId: string | null }) {
  const stop = useStop(stopId)
  if (!stop) return null
  const rows: { field: string; value: string }[] = [
    { field: 'orderCode', value: stop.orderCode },
    { field: 'customer', value: stop.customer },
    { field: 'address', value: stop.address },
    { field: 'window', value: windowLabel(stop) },
    { field: 'items', value: stop.items.map((i) => `${i.qty} × ${i.name}`).join(', ') },
    { field: 'amountDue', value: formatMoney(stop.amountDue) },
    { field: 'payment', value: PAYMENT_TEXT[stop.payment] },
  ]
  return (
    <div className="panel st-record">
      <div className="plate">
        <span>Packed order, as received</span>
        <span className="plate-id">{stop.orderCode}</span>
      </div>
      <dl className="st-record__grid">
        {rows.map((row) => (
          <div className="st-record__row" key={row.field}>
            <dt className="st-record__field">{row.field}</dt>
            <dd className="st-record__value">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="st-record__note">
        Seven fields and a delivery window. In the demo these records are seeded; in
        production this is the POS ingestion boundary, and it is the first item on the
        gap list rather than a solved problem.
      </p>
    </div>
  )
}

function ProofTable() {
  return (
    <div className="panel st-table-card">
      <div className="plate">
        <span>Realtime fan-out, one channel</span>
        <span className="plate-id">{BROADCAST_RUN.date}</span>
      </div>
      <div className="st-table-scroll">
        <table className="st-table">
          <thead>
            <tr>
              <th scope="col">Publishers</th>
              <th scope="col">Sent</th>
              <th scope="col">Received</th>
              <th scope="col">Lost</th>
              <th scope="col">p50</th>
              <th scope="col">p95</th>
              <th scope="col">Max</th>
              <th scope="col">Deliveries</th>
            </tr>
          </thead>
          <tbody>
            {BROADCAST_TIERS.map((tier) => (
              <tr key={tier.publishers}>
                <th scope="row">{tier.publishers}</th>
                <td>{tier.sent.toLocaleString()}</td>
                <td>{tier.received.toLocaleString()}</td>
                <td className="st-table__zero">{`${tier.lossPct}%`}</td>
                <td>{`${tier.p50Ms} ms`}</td>
                <td>{`${tier.p95Ms} ms`}</td>
                <td>{`${tier.maxMs.toLocaleString()} ms`}</td>
                <td>{tier.deliveries.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="st-table-card__foot">
        {`${BROADCAST_RUN.command} · ${BROADCAST_RUN.windowSeconds}s per tier at ${BROADCAST_RUN.rateHz} Hz · ${BROADCAST_RUN.runtime}`}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------- the page -- */

export function StoryPage() {
  useScrollableDocument()
  useHeldTitle(PAGE_TITLE)

  const narrow = useMediaQuery(NARROW_QUERY)
  const showTop = useScrolledPast(900)

  const stopId = useStore(featureStopId)
  const idStopId = useStore(idCheckStopId)
  const runId = useStore(featureRunId)
  const stop = useStop(stopId)

  /* Cash is the default because it is the fullest closeout screen — keypad,
     quick tenders, live change arithmetic — so the frame opens on the state
     with something in it rather than on a three-line ladder. */
  const [tender, setTender] = useState<PaymentMethod>('cash')
  const payStopId = useStore(useCallback((s) => stopIdForPayment(s, tender), [tender]))

  const orderCode = stop?.orderCode ?? 'MFST-4119'

  const toTop = useCallback(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }, [])

  /* Stage sizes. Narrow viewports get phone-sized stages for every embed, so
     each surface renders in the register it was designed for at that width
     instead of being shrunk to an unreadable desktop thumbnail. */
  const consoleStage: StageSize = narrow ? { width: 560, height: 760 } : { width: 1280, height: 800 }
  const phoneStage: StageSize = { width: 390, height: 760 }
  const trackStage: StageSize = narrow ? { width: 430, height: 780 } : { width: 760, height: 680 }
  const manifestStage: StageSize = narrow ? { width: 430, height: 820 } : { width: 1000, height: 760 }

  return (
    <div className="st-root">
      {/* ------------------------------------------------------------ hero */}
      <section className="st-hero">
        {/* The hero map is mounted before the observer has said anything, so
            the fleet is moving on the first paint. It still unmounts once it
            is well behind you: a MapLibre context painting behind six screens
            of copy is exactly the frame budget SPEC asks us to protect. */}
        <LazyBlock eager className="st-hero__map">
          <MapCanvas interactive={false} initialFit="fleet" />
        </LazyBlock>
        <div className="st-hero__scrim" />
        <div className="st-hero__inner">
          <div className="st-hero__rail">
            <DemoChip />
            <span className="chip chip--quiet">Tampa · 3 runs · 11 stops</span>
          </div>
          <h1 className="st-hero__name">Manifest</h1>
          <p className="st-hero__claim">
            Last-mile delivery dispatch for dispensaries. It sits on top of the POS you
            already run and owns everything after the order is packed: dispatch, live
            tracking, the ID check, and the manifest that travels with the van.
          </p>
          <p className="st-hero__sub">
            The fleet moving behind this text is running in your browser right now. Every
            screen below is that same fleet, live. Scroll.
          </p>
        </div>
        <span className="st-hero__cue" aria-hidden="true" />
      </section>

      {/* ---------------------------------------------------------- packed */}
      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <SectionHead
              step="Packed"
              title="It starts where the POS stops."
              lede="Manifest is not a point of sale and does not want to be. The order is taken, paid out and packed somewhere else. What crosses the boundary is one record."
            />
          </Reveal>
          <Reveal delayMs={60}>
            <OrderRecord stopId={stopId} />
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------ dispatched */}
      <section className="st-section st-section--tint">
        <div className="st-wrap">
          <Reveal>
            <SectionHead
              step="Dispatched"
              title="The map is the page."
              lede="No app chrome hosting a map widget. The console is the map, with the run rails and the event feed floating over it. Runs start, stops resequence, ETAs drift, and a stop that will miss its window turns amber before it misses it."
            />
          </Reveal>
          <Reveal delayMs={60}>
            <EmbedFrame
              kind="browser"
              address="manifest.claygeo.dev/dispatch"
              stage={consoleStage}
              caption={
                <>
                  The live dispatch console, running. <Link to="/dispatch">Open it full size</Link>
                </>
              }
            >
              <ConsoleEmbed />
            </EmbedFrame>
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------------- en route */}
      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <SectionHead
              step="En route"
              title="Two screens, one state."
              lede="The driver's ticket and the customer's tracking link are different products with different jobs, and they are reading the same store. When the van moves, both move. Nothing is polled, nothing is reconciled, and neither screen knows whether a simulation or a real phone is driving it."
            />
          </Reveal>
          <div className="st-pair">
            <Reveal delayMs={60}>
              <EmbedFrame
                kind="phone"
                stage={phoneStage}
                caption={
                  <>
                    Driver, one action per state. <Link to="/driver">Open the driver app</Link>
                  </>
                }
              >
                <DriverTicketEmbed stopId={stopId} />
              </EmbedFrame>
            </Reveal>
            <Reveal delayMs={120}>
              <EmbedFrame
                kind={narrow ? 'phone' : 'browser'}
                address={`manifest.claygeo.dev/t/${orderCode}`}
                stage={trackStage}
                caption={
                  <>
                    Customer, no account and no app.{' '}
                    <Link to={`/t/${orderCode}`}>{`Open /t/${orderCode}`}</Link>
                  </>
                }
              >
                <TrackingEmbed orderCode={orderCode} />
              </EmbedFrame>
            </Reveal>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- ID check */}
      <section className="st-section st-section--tint">
        <div className="st-wrap">
          <Reveal>
            <SectionHead
              step="At the door"
              title="The gate that cannot be skipped."
              lede="Florida medical delivery turns on one thing: a verified 21+ ID at every transfer. So it is not a checkbox on the closeout screen, it is a state the stop has to pass through."
            />
          </Reveal>
          <div className="st-split">
            <Reveal delayMs={60}>
              <EmbedFrame
                kind="phone"
                stage={{ width: 390, height: 660 }}
                caption="Full screen, no dismiss, verdict only."
              >
                <DriverIdEmbed stopId={idStopId} />
              </EmbedFrame>
            </Reveal>
            <Reveal delayMs={120} className="st-split__aside">
              <p className="st-note">
                The invariant lives in the store, not in the screen. A stop cannot be closed
                against an unverified ID even by driving the state directly, and a failed
                check does not fall through to closed either: it lands the stop in{' '}
                <code className="st-code">exception</code>, which the dispatcher and the
                manifest both see.
              </p>
              <figure className="st-snippet">
                <pre>
                  <code>{`closeStop: (stopId, payment) => {
  const stop = get().stops[stopId]
  if (!stop) return
  // the app enforces the law's shape: no close without a verified ID
  if (!stop.idChecked) return`}</code>
                </pre>
                <figcaption>src/store.ts</figcaption>
              </figure>
              <p className="st-note st-note--dim">
                No camera and no scanner. That was cut on purpose: hardware the demo cannot
                honestly show is hardware it does not pretend to have.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- closeout */}
      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <SectionHead
              step="Closeout"
              title="Money is a state, not a transaction."
              lede="No card is read and no funds move. Cash does the arithmetic a driver actually does at the door; debit and digital walk an honest ladder that says SIMULATED where a real terminal would say APPROVED."
            />
          </Reveal>
          <div className="st-split">
            <Reveal delayMs={60}>
              <EmbedFrame
                kind="phone"
                stage={{ width: 390, height: 880 }}
                caption="Closeout, live order, real tender arithmetic."
              >
                <DriverPaymentEmbed stopId={payStopId} />
              </EmbedFrame>
            </Reveal>
            <Reveal delayMs={120} className="st-split__aside">
              <div className="st-switch" role="group" aria-label="Payment method">
                {TENDERS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={`chip${tender === method ? ' chip--accent' : ''}`}
                    aria-pressed={tender === method}
                    onClick={() => setTender(method)}
                  >
                    {PAYMENT_TEXT[method]}
                  </button>
                ))}
              </div>
              <p className="st-note">
                Pick a tender type and the frame swaps to a real order on today&rsquo;s board
                that is taking it. Closing a stop is the only place money is recorded, and
                what it records is three fields:
              </p>
              <dl className="st-writes">
                <div>
                  <dt>payment</dt>
                  <dd>cash, debit or digital. A state, never a charge.</dd>
                </div>
                <div>
                  <dt>closedAt</dt>
                  <dd>The custody timestamp the manifest reconciles against.</dd>
                </div>
                <div>
                  <dt>closed</dt>
                  <dd>
                    An event carrying the order code, method and amount, into the same feed
                    the dispatcher is watching.
                  </dd>
                </div>
              </dl>
              <p className="st-note st-note--dim">
                A payment-terminal integration is deliberately out of scope. The closeout
                interface is shaped for one; the reader itself is somebody else&rsquo;s
                certification problem.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- manifest */}
      <section className="st-section st-section--tint">
        <div className="st-wrap">
          <Reveal>
            <SectionHead
              step="Compliance"
              title="The document that rides with the van."
              lede="Every run carries a printable manifest: transport record, ordered stops, custody log with an ID stamp per transfer, signature rules. It is deliberately formal, because it is the artifact an inspector asks for and a friendly one would be worse."
            />
          </Reveal>
          <Reveal delayMs={60}>
            <EmbedFrame
              kind={narrow ? 'phone' : 'browser'}
              address={`manifest.claygeo.dev/manifest/${runId}`}
              stage={manifestStage}
              fade
              caption={
                <>
                  Generated from the live run, printable to letter paper.{' '}
                  <Link to={`/manifest/${runId}`}>Open the manifest</Link>
                </>
              }
            >
              <ManifestEmbed runId={runId} />
            </EmbedFrame>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------ proof */}
      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <SectionHead
              step="Measured"
              title="Load is a number, not an adjective."
              lede="The live mode behind the demo publishes driver GPS over Supabase Realtime. Here is what that transport did when it was actually measured, on a dated run, with the script in this repo."
            />
          </Reveal>
          <Reveal delayMs={60}>
            <ProofTable />
          </Reveal>
          <Reveal delayMs={90}>
            <div className="st-stats">
              <div className="st-stat">
                <span className="numeral numeral--sm">0%</span>
                <span className="st-stat__label">
                  Message loss at every tier. 2,103 pings sent, 2,103 received.
                </span>
              </div>
              <div className="st-stat">
                <span className="numeral numeral--sm">{TEST_COUNTS.unit}</span>
                <span className="st-stat__label">
                  {`Passing unit tests across ${TEST_COUNTS.unitFiles} files: sim determinism, store actions, the driver flow's legal ordering, ETA math.`}
                </span>
              </div>
              <div className="st-stat">
                <span className="numeral numeral--sm">{TEST_COUNTS.rpc}</span>
                <span className="st-stat__label">
                  Contract checks fired at the real Supabase RPCs: session-code gating, event
                  cap, unknown-code writes rejected.
                </span>
              </div>
            </div>
          </Reveal>
          <Reveal delayMs={120}>
            <div className="st-caveats">
              <p className="st-caveats__head">What these numbers are not</p>
              <ul>
                {BROADCAST_CAVEATS.map((line) => (
                  <li key={line.slice(0, 24)}>{line}</li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------------- explore */}
      <section className="st-section st-section--tint">
        <div className="st-wrap">
          <Reveal>
            <SectionHead
              step="Explore"
              title="Now open the real thing."
              lede="No gate, no login, no contact form, nothing collected. Every surface below is the same running fleet you have been watching."
            />
          </Reveal>
          <Reveal delayMs={60}>
            <nav className="st-links" aria-label="Live surfaces">
              <Link className="st-link" to="/dispatch">
                <span className="st-link__title">Dispatch console</span>
                <span className="st-link__path">/dispatch</span>
                <span className="st-link__note">
                  The full-bleed map, run rails, event feed, and the dispatch actions.
                </span>
              </Link>
              <Link className="st-link" to="/driver">
                <span className="st-link__title">Driver app</span>
                <span className="st-link__path">/driver</span>
                <span className="st-link__note">
                  Claim a run and walk a stop start to finish with your thumbs.
                </span>
              </Link>
              <Link className="st-link" to={`/t/${orderCode}`}>
                <span className="st-link__title">Customer tracking</span>
                <span className="st-link__path">{`/t/${orderCode}`}</span>
                <span className="st-link__note">
                  The link a customer gets by text. No account, no app.
                </span>
              </Link>
              <Link className="st-link" to={`/manifest/${runId}`}>
                <span className="st-link__title">Printable manifest</span>
                <span className="st-link__path">{`/manifest/${runId}`}</span>
                <span className="st-link__note">
                  The compliance document for the run that is out right now.
                </span>
              </Link>
            </nav>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------------------------------------- footer */}
      <footer className="st-footer">
        <div className="st-wrap st-footer__inner">
          <div className="st-footer__left">
            <p className="st-footer__by">
              Built by{' '}
              <a href="https://claygeo.dev" target="_blank" rel="noreferrer noopener">
                Clayton George
              </a>
            </p>
            <p className="st-footer__fine">
              Demo uses fictional data. Not affiliated with any licensed operator. Customers,
              addresses, orders and drivers are invented; the road geometry is real Tampa
              routing, precomputed once and shipped as static JSON.
            </p>
          </div>
          <button type="button" className="btn st-footer__top" onClick={toTop}>
            Back to top
          </button>
        </div>
      </footer>

      <button
        type="button"
        className={`btn st-totop${showTop ? ' is-in' : ''}`}
        onClick={toTop}
        aria-label="Back to top"
        tabIndex={showTop ? 0 : -1}
      >
        <span aria-hidden="true">&uarr;</span>
      </button>
    </div>
  )
}

export default StoryPage
