/**
 * Story-page framing primitives.
 *
 * The rule from SPEC.md "Story page /": "Embedded surfaces are the REAL
 * components rendering the live sim from the same store — framed in a phone
 * bezel / minimal browser chrome, scaled. Never screenshots, never mockups."
 *
 * So an embed is not an image and not an iframe. It is the actual surface,
 * mounted into a fixed-size stage and shrunk to the column with a CSS
 * transform. Two things fall out of that choice and both matter:
 *
 *  - the stage keeps its own pixel dimensions no matter how narrow the page
 *    gets, so MapLibre and the console rails lay out at a real desktop size
 *    and are only ever scaled DOWN, never reflowed into a broken state
 *  - the embed is live DOM, so it is made `inert`: pointer-events off, out of
 *    the tab order, out of the accessibility tree. A visitor cannot half-drive
 *    a console they cannot see the edges of. The real thing is one link away
 *    and every section says so.
 *
 * Cost control: an embed mounts when it comes near the viewport and unmounts
 * when it leaves. That is what keeps the hero map's frame budget intact — at
 * most two MapLibre contexts are ever alive at once, and the printable
 * manifest (which re-renders with the fleet) is not running while you are
 * reading the hero.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'

/** Bezel thickness per side on a phone frame, in stage-independent pixels. */
const PHONE_BEZEL = 10

export type FrameKind = 'phone' | 'browser'

export interface StageSize {
  width: number
  height: number
}

export interface EmbedFrameProps {
  kind: FrameKind
  /** Size the real surface is mounted at, before scaling. */
  stage: StageSize
  /** Address-bar text on a browser frame. Ignored by phone frames. */
  address?: string
  /** What the frame contains, for the caption under it. */
  caption: ReactNode
  /**
   * Fade the bottom edge. For surfaces that are genuinely longer than any
   * frame (the manifest is a letter-size document), so the crop reads as "this
   * continues" instead of "this is cut off".
   */
  fade?: boolean
  /** Skip the observer and mount immediately (the hero, and only the hero). */
  eager?: boolean
  children: ReactNode
  className?: string
}

/**
 * Mount/unmount an embed as it approaches and leaves the viewport.
 *
 * Deliberately not mount-once: the console, the tracking card and the manifest
 * all re-render with the fleet, and three of those running behind the hero is
 * exactly the frame budget SPEC says the hero map must never lose.
 */
function useNearViewport(ref: RefObject<HTMLElement | null>, eager: boolean): boolean {
  const [near, setNear] = useState(eager)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '400px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref])

  return near
}

/** Scale factor that fits `width` stage pixels into the measured host. */
function useFitScale(ref: RefObject<HTMLElement | null>, width: number): number {
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const available = el.clientWidth
      if (available > 0) setScale(Math.min(1, available / width))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, width])

  return scale
}

export function EmbedFrame({
  kind,
  stage,
  address,
  caption,
  fade = false,
  eager = false,
  children,
  className,
}: EmbedFrameProps) {
  const screenRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const scale = useFitScale(screenRef, stage.width)
  const mounted = useNearViewport(screenRef, eager)

  /**
   * `inert` takes the whole live surface out of the tab order and the a11y
   * tree. Set imperatively because React 18 has no typed prop for it; the
   * `pointer-events: none` in story.css is the fallback for browsers that do
   * not implement it yet.
   */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    el.setAttribute('inert', '')
    el.setAttribute('aria-hidden', 'true')
  }, [mounted])

  const outerStyle: CSSProperties = {
    maxWidth: stage.width + (kind === 'phone' ? PHONE_BEZEL * 2 : 0),
  }
  const screenStyle: CSSProperties = { height: Math.round(stage.height * scale) }
  const stageStyle: CSSProperties = {
    width: stage.width,
    height: stage.height,
    transform: `scale(${scale})`,
  }

  return (
    <figure className={`st-frame st-frame--${kind}${className ? ` ${className}` : ''}`}>
      <div className="st-device" style={outerStyle}>
        {kind === 'browser' ? (
          <div className="st-chrome">
            <span className="st-chrome__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="st-chrome__url">{address}</span>
          </div>
        ) : (
          <span className="st-phone-slot" aria-hidden="true" />
        )}

        <div
          className={`st-screen${fade ? ' st-screen--fade' : ''}`}
          ref={screenRef}
          style={screenStyle}
        >
          <div className="st-stage" ref={stageRef} style={stageStyle}>
            {mounted ? children : null}
          </div>
          {mounted ? null : <span className="st-screen__idle" aria-hidden="true" />}
        </div>
      </div>

      <figcaption className="st-caption">{caption}</figcaption>
    </figure>
  )
}

/**
 * Same mount/unmount discipline without a device frame around it. The hero map
 * uses this: `eager` so the fleet is already moving on the first paint, and the
 * observer still takes it back down once the hero is far behind.
 */
export function LazyBlock({
  eager = false,
  className,
  children,
}: {
  eager?: boolean
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const near = useNearViewport(ref, eager)
  return (
    <div ref={ref} className={className}>
      {near ? children : null}
    </div>
  )
}

/* --------------------------------------------------------- disclosure ---- */

/**
 * A collapsed technical aside.
 *
 * ROUND-1 FIX. The page used to answer an operator's compliance question with a
 * TypeScript excerpt and a percentile table, inline, on the main path. Neither
 * was wrong and neither is deleted — they are behind this, one tap away, so the
 * reader who wants them can have them and the reader who does not is not asked
 * to step over them.
 *
 * Native `<details>` on purpose: it is closed on first paint with no JavaScript
 * involved, so nothing on the page reflows after it renders, it is keyboard
 * operable and announced correctly with no ARIA of our own, and it prints open
 * in browsers that expand details for print.
 */
export function Disclosure({
  summary,
  children,
  className,
}: {
  summary: string
  children: ReactNode
  className?: string
}) {
  return (
    <details className={`st-more${className ? ` ${className}` : ''}`}>
      <summary className="st-more__summary">{summary}</summary>
      <div className="st-more__body">{children}</div>
    </details>
  )
}

/* ------------------------------------------------------------- reveal ---- */

/**
 * The only motion the page adds on its own: an 8px rise and a fade, once, as a
 * block enters. No scroll-jacking, no parallax, no pinning — the scrollbar
 * always means what it says. Under `prefers-reduced-motion` story.css lands
 * every reveal in its final state.
 */
export function Reveal({
  children,
  className,
  delayMs,
}: {
  children: ReactNode
  className?: string
  delayMs?: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`st-reveal${shown ? ' is-in' : ''}${className ? ` ${className}` : ''}`}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  )
}
