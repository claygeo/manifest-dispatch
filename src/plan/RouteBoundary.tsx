/**
 * The guard around the one lazily-loaded surface.
 *
 * `/plan` is a separate chunk (see App.tsx for why — the leg matrix is 783 kB
 * and has no business on the story page's critical path). A separate chunk is
 * a second network fetch, made at click time, long after the shell was served.
 * If that fetch fails — a tunnel, a flaky café AP, a browser that went offline
 * between first paint and the click — the module factory rejects, React rethrows
 * the rejection at the nearest error boundary, and if there is no boundary it
 * unmounts the WHOLE tree. That is what "blank page" means here: not the route
 * failing, the app failing, `#root` empty, the fleet stopped, nothing to click.
 *
 * SPEC.md's production bar names this exact case — "the app never white-screens
 * on bad data (error boundaries on each surface)" — and DESIGN.md's honesty rail
 * decides what the boundary is allowed to say: what happened, what still works,
 * and one button that actually retries. No spinner, no apology, no reload-the-
 * page shrug.
 *
 * Retry has to mint a NEW lazy component. `React.lazy` memoises the promise it
 * was handed, rejection included, so re-rendering the same lazy element replays
 * the same failure forever. `attempt` is what buys a fresh factory, and it keys
 * the boundary so the caught error is cleared at the same moment.
 */

import { Component, Suspense, lazy, useCallback, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'

/** What `import('./PlanPage')` resolves to. */
export type LazyLoader = () => Promise<{ default: ComponentType }>

interface BoundaryProps {
  children: ReactNode
  /** Rendered in place of the children once something below has thrown. */
  fallback: (error: Error) => ReactNode
}

interface BoundaryState {
  error: Error | null
}

/**
 * Deliberately minimal, and deliberately NOT logging: React already reports a
 * caught error to the console, and SPEC's definition of done counts console
 * errors. Nothing here needs to fire twice.
 */
export class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override render(): ReactNode {
    const { error } = this.state
    return error ? this.props.fallback(error) : this.props.children
  }
}

/**
 * The honest inline fallback. It replaces the route, never the shell, so the
 * links out of here are ordinary anchors: a full document load is exactly the
 * right recovery when the thing that just failed was a chunk fetch.
 */
export function RouteFallback({
  what,
  attempt,
  onRetry,
}: {
  what: string
  /** How many retries have already been spent. 0 = this is the first failure. */
  attempt: number
  onRetry: () => void
}) {
  /*
   * Why a reload appears on the second failure, and only then.
   *
   * A re-import genuinely recovers the common case — the one in the report,
   * where the JS chunk was reachable and only its stylesheet preload failed:
   * the preload is skipped on the second pass and the module loads. It cannot
   * recover the harder case, where the module SCRIPT itself failed to fetch:
   * the HTML spec has the browser record that failure in the module map for
   * the life of the document, so every later `import()` of that specifier
   * replays it without touching the network. Measured, not assumed — a
   * puppeteer run that blocks the chunk shows zero requests on retry.
   *
   * A reload is the only thing that clears that map, so it is offered as soon
   * as retrying has actually been tried and did not work. Offering it first
   * would send everyone through a full page load for a failure a button press
   * fixes; never offering it would leave the harder case with a button that
   * cannot work, which is worse than no button.
   */
  const retried = attempt > 0
  return (
    <div className="app-fallback">
      <div className="app-fallback__card">
        <p className="app-fallback__line">
          This part of the demo could not load — connection hiccup. The rest keeps running.
        </p>
        <p className="micro app-fallback__note">
          {retried
            ? `${what} still will not load. Once a script fetch fails the browser remembers it for this page, so a reload is what clears it — everything else on the demo is unaffected either way.`
            : `${what} loads as its own chunk, and the browser could not fetch it. Nothing else stopped: the fleet is still driving on every other screen.`}
        </p>
        <div className="app-fallback__actions">
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            Try again
          </button>
          {retried ? (
            <button
              type="button"
              className="btn"
              onClick={() => window.location.reload()}
              data-role="reload"
            >
              Reload the page
            </button>
          ) : null}
          <a className="btn" href="/dispatch">
            Dispatch console
          </a>
          <a className="btn" href="/">
            Back to the demo
          </a>
        </div>
      </div>
    </div>
  )
}

export interface LazyRouteProps {
  /** The dynamic import. Kept as a prop so the test can hand it a failing one. */
  load: LazyLoader
  /** Sentence-case subject, e.g. 'The planner'. Used in both states' copy. */
  what: string
}

/** Suspense + boundary + retry, as one route element. */
export function LazyRoute({ load, what }: LazyRouteProps) {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  /* A fresh factory per attempt — see the note at the top of the file. */
  const Screen = useMemo(
    () => lazy(load),
    [attempt], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <RouteErrorBoundary
      key={attempt}
      fallback={() => <RouteFallback what={what} attempt={attempt} onRetry={retry} />}
    >
      <Suspense
        fallback={<div className="app-loading">{`Loading ${what.toLowerCase()}…`}</div>}
      >
        <Screen />
      </Suspense>
    </RouteErrorBoundary>
  )
}

export default LazyRoute
