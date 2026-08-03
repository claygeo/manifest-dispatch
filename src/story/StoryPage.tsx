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

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import MapCanvas from '../map/MapCanvas'
import { useStore } from '../store'
import { DemoChip } from '../ui/controls'
import { formatMoney, PAYMENT_TEXT } from '../format'
import { windowLabel } from '../selectors'
import type { PaymentMethod } from '../types'
import { Disclosure, EmbedFrame, LazyBlock, Reveal, type StageSize } from './Frame'
import {
  BROADCAST_CAVEATS,
  BROADCAST_RUN,
  BROADCAST_TIERS,
  BROADCAST_WORST,
  TEST_COUNTS,
} from './proof'
import {
  MECHANISM_RECORD,
  MECHANISM_SENTENCES,
  MECHANISM_STAGES,
  PLAN_TEASER,
} from './mechanism'
import {
  ID_CHECK,
  ID_CHECK_TECHNICAL,
  MEASURED,
  NEXT_STEP,
  ORDER_RECORD,
  SECTIONS,
  TECHNICAL_SUMMARY,
} from './copy'
import { controlIsClear } from './overlap'
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

/* Summed from the published rows rather than typed out beside them, so the
   headline and the table can never disagree after a re-run. */
const pingsSent = BROADCAST_TIERS.reduce((n, t) => n + t.sent, 0)
const pingsReceived = BROADCAST_TIERS.reduce((n, t) => n + t.received, 0)

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

/**
 * ROUND-1 FIX: the floating return control is not allowed to sit on an embed.
 *
 * At 390px it landed on the ID-check card and covered the Age and Expires
 * values — the two fields that section is there to show. There is no corner to
 * move it to on a phone, because the embeds are as wide as the page, so the
 * control yields instead: it fades while an embedded surface is under it and
 * comes back the moment the reader scrolls clear. The footer's own "Back to
 * top" is always there, so the affordance is never missing.
 *
 * The geometry is in `overlap.ts` and unit-tested there. This hook only reads
 * rectangles, rAF-throttled, on scroll and resize — a handful of
 * `getBoundingClientRect` calls per frame at most, and none at all while the
 * control is hidden by the scroll-depth rule above it.
 */
function useClearOfEmbeds(ref: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [clear, setClear] = useState(true)

  useEffect(() => {
    if (!active) {
      setClear(true)
      return
    }
    let raf = 0
    const read = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const embeds = Array.from(document.querySelectorAll('.st-device')).map((node) =>
        node.getBoundingClientRect(),
      )
      setClear(controlIsClear(el.getBoundingClientRect(), embeds))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ref, active])

  return clear
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
        <span>{ORDER_RECORD.plate}</span>
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
      <p className="st-record__note">{ORDER_RECORD.note}</p>
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

/**
 * The mechanism strip: POS -> Manifest -> driver / customer / manifest.
 *
 * Pure HTML and CSS. No SVG, no icon set, no illustration — the shape is three
 * bordered stages in a row with a connector between them, and the middle one is
 * the only one wearing the accent, which is the entire positioning argument
 * drawn rather than argued. The connectors are decorative and marked as such;
 * the list markup underneath is what a screen reader reads.
 */
function MechanismStrip() {
  return (
    <ol className="st-flow" aria-label="How an order moves through Manifest">
      {MECHANISM_STAGES.map((stage, i) => (
        <li
          className={`st-flow__stage${stage.owned ? ' st-flow__stage--ours' : ''}`}
          key={stage.id}
        >
          {i > 0 ? <span className="st-flow__link" aria-hidden="true" /> : null}
          <div className="st-flow__card">
            <p className="st-flow__kicker">{stage.kicker}</p>
            <p className="st-flow__title">{stage.title}</p>
            <ul className="st-flow__lines">
              {stage.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------- the page -- */

export function StoryPage() {
  useScrollableDocument()
  useHeldTitle(PAGE_TITLE)

  const narrow = useMediaQuery(NARROW_QUERY)
  const showTop = useScrolledPast(900)

  /* The floating return control is shown when the reader is deep enough to want
     it AND no embedded surface is underneath it. See `useClearOfEmbeds`. */
  const toTopRef = useRef<HTMLButtonElement | null>(null)
  const clearOfEmbeds = useClearOfEmbeds(toTopRef, showTop)
  const topVisible = showTop && clearOfEmbeds

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
            <SectionHead {...SECTIONS.packed} />
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
            <SectionHead {...SECTIONS.dispatched} />
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
            <SectionHead {...SECTIONS.enRoute} />
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
            <SectionHead {...SECTIONS.idCheck} />
          </Reveal>
          <div className="st-split">
            <Reveal delayMs={60}>
              <EmbedFrame
                kind="phone"
                stage={{ width: 390, height: 660 }}
                caption={ID_CHECK.frameCaption}
              >
                <DriverIdEmbed stopId={idStopId} />
              </EmbedFrame>
            </Reveal>
            {/* ROUND-1 FIX: this column used to answer a compliance question
                with a TypeScript excerpt and the phrase "the invariant lives in
                the store". It now states the rule the way the rule is written,
                and the implementation is intact one tap down. */}
            <Reveal delayMs={120} className="st-split__aside">
              <p className="st-note">{ID_CHECK.rule}</p>
              <p className="st-note">{ID_CHECK.fail}</p>
              <p className="st-note st-note--dim">{ID_CHECK.noHardware}</p>
              <Disclosure summary={TECHNICAL_SUMMARY}>
                <p className="st-note">{ID_CHECK_TECHNICAL.body}</p>
                <figure className="st-snippet">
                  <pre>
                    <code>{ID_CHECK_TECHNICAL.code}</code>
                  </pre>
                  <figcaption>{ID_CHECK_TECHNICAL.caption}</figcaption>
                </figure>
              </Disclosure>
            </Reveal>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- closeout */}
      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <SectionHead {...SECTIONS.closeout} />
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
            <SectionHead {...SECTIONS.compliance} />
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
          {/* The audit-trail claim, moved down from "how it works" in round 1.
              It belongs under the document it is a claim about, and moving it
              is half of what shortened the section below. */}
          <Reveal delayMs={90}>
            <p className="st-note st-under">{MECHANISM_RECORD.body}</p>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------------------------------- how it works */}
      {/* SPEC addendum: the plain-language mechanism section, deliberately
          placed after the compliance document and before the numbers. By here
          the reader has seen the whole lifecycle and is entitled to ask what
          Manifest actually is; the numbers only mean something once they know.

          ROUND-1 FIX (length). This section was a one-line eyebrow, a lede that
          restated the hero almost verbatim, the diagram, two prose blocks, and
          a numbered list under a heading announcing how many items it had —
          three quarters of the way down a page a phone reviewer measured at
          about thirteen thousand pixels, and the place he nearly stopped
          reading. It is now the diagram and two sentences. Nothing that was
          only said here was deleted: the audit-trail block moved up under the
          manifest, and the seeded-POS caveat moved down to the closing note,
          which is the honest place for it. */}
      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <SectionHead {...SECTIONS.mechanism} />
          </Reveal>

          <Reveal delayMs={60}>
            <MechanismStrip />
          </Reveal>

          {/* Sentences rather than bullets, because the job of this block is to
              be repeated out loud by somebody who will not have the page open. */}
          <Reveal delayMs={90}>
            <ol className="st-repeat__list st-repeat__list--bare">
              {MECHANISM_SENTENCES.map((line) => (
                <li key={line.slice(0, 28)}>{line}</li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------ proof */}
      <section className="st-section st-section--tint">
        <div className="st-wrap">
          <Reveal>
            <SectionHead {...SECTIONS.measured} />
          </Reveal>
          {/* ROUND-1 FIX: the eight-column percentile table used to be the first
              thing in this section. `p50` and `p95` are not words, they are
              notation, and an operations reader was asked to parse them before
              being told what they meant. The finding leads in plain language
              now; the table is unchanged, one tap below. */}
          <Reveal delayMs={90}>
            <div className="st-stats">
              <div className="st-stat">
                <span className="numeral numeral--sm">0%</span>
                <span className="st-stat__label">
                  {`${MEASURED.lossLabel} ${pingsSent.toLocaleString()} position updates sent, ${pingsReceived.toLocaleString()} received.`}
                </span>
              </div>
              <div className="st-stat">
                <span className="numeral numeral--sm">
                  {`${Math.round(BROADCAST_WORST.p50Ms)} ms`}
                </span>
                <span className="st-stat__label">
                  {`${MEASURED.latencyLead} ${Math.round(BROADCAST_WORST.p50Ms)} ms ${MEASURED.latencyTail} ${Math.round(BROADCAST_WORST.p95Ms)} ms, at the worst of the three fleet sizes.`}
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
          <Reveal delayMs={110}>
            <Disclosure summary={TECHNICAL_SUMMARY} className="st-more--wide">
              <p className="st-note">{MEASURED.technicalNote}</p>
              <ProofTable />
            </Disclosure>
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

      {/* ------------------------------------------------------ plan teaser */}
      {/* The only section on the page that asks the reader to do something.
          It sits here on purpose: after the argument is finished and before the
          directory of links, so the invitation is the last thing said rather
          than an interruption in the middle of the lifecycle. */}
      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <div className="st-teaser">
              <div className="st-teaser__copy">
                <p className="st-eyebrow">{PLAN_TEASER.step}</p>
                <h2 className="st-title st-title--sm">{PLAN_TEASER.title}</h2>
                <p className="st-lede">{PLAN_TEASER.lede}</p>
                <p className="st-note st-teaser__rule">{PLAN_TEASER.philosophy}</p>
              </div>
              <Link className="btn btn--primary st-teaser__cta" to={PLAN_TEASER.path}>
                {PLAN_TEASER.cta}
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------------- explore */}
      <section className="st-section st-section--tint">
        <div className="st-wrap">
          <Reveal>
            <SectionHead {...SECTIONS.explore} />
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
              <Link className="st-link" to={PLAN_TEASER.path}>
                <span className="st-link__title">Route planner</span>
                <span className="st-link__path">{PLAN_TEASER.path}</span>
                <span className="st-link__note">
                  Build a run out of the pending pool, argue with the suggested order, and
                  dispatch it into the fleet you have been watching.
                </span>
              </Link>
            </nav>
          </Reveal>

          {/* ROUND-1 FIX. The page used to argue its case and then simply stop:
              a reviewer's words were that it "sells like a vendor and signs off
              like a resume", with no next step of any kind. This is the whole
              next step — what the demo actually is, what it is missing, and
              where the person who built it is. No booking widget and no pricing:
              on a page whose entire argument is that nothing is oversold, a fake
              call to action would be the first thing that was. */}
          <Reveal delayMs={90}>
            <div className="st-standing">
              <p className="st-standing__label">{NEXT_STEP.label}</p>
              <p className="st-note">{NEXT_STEP.body}</p>
              <p className="st-note st-standing__contact">
                {`${NEXT_STEP.contact} `}
                <a href={NEXT_STEP.href} target="_blank" rel="noreferrer noopener">
                  {NEXT_STEP.linkText}
                </a>
                .
              </p>
            </div>
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
        ref={toTopRef}
        type="button"
        className={`btn st-totop${topVisible ? ' is-in' : ''}`}
        onClick={toTop}
        aria-label="Back to top"
        tabIndex={topVisible ? 0 : -1}
      >
        <span aria-hidden="true">&uarr;</span>
      </button>
    </div>
  )
}

export default StoryPage
