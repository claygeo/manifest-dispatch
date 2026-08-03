/**
 * App shell + routes.
 *
 * The sim engine is started once here and lives for the whole session, so the
 * fleet keeps moving while the user walks between the story page, the console,
 * the driver app and a tracking link. StrictMode double-mounts in dev; the
 * engine guards against a second start and cleans up on unmount.
 *
 * `/` is the scroll story (SPEC.md "Story page /"); the dispatch console moved
 * to `/dispatch` when the story took the front door.
 */

import { useEffect, useRef } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { createSimEngine, type SimEngine } from './sim/engine'
import StoryPage from './story/StoryPage'
import ConsolePage from './console/ConsolePage'
import DriverPage from './driver/DriverPage'
import TrackingPage from './tracking/TrackingPage'
import ManifestPage from './manifest/ManifestPage'
import { LazyRoute } from './plan/RouteBoundary'

/**
 * `/plan` is the one lazily-loaded surface.
 *
 * Not for tidiness — for weight. The route planner reads `data/matrix.json`,
 * the full directed leg matrix, which is 783 kB of road geometry. Statically
 * importing it would put all of that on the critical path of the story page,
 * where SPEC.md's definition of done asks for first paint under three seconds.
 * As a lazy route it becomes its own chunk that only a visitor who opens the
 * planner ever downloads.
 *
 * One factory, referenced from two places, on purpose: the route element and
 * the idle prefetch below have to resolve to the SAME chunk, or the prefetch
 * warms something the click never asks for.
 */
const loadPlanPage = () => import('./plan/PlanPage')

function useSimEngine(): void {
  const ref = useRef<SimEngine | null>(null)
  useEffect(() => {
    if (!ref.current) ref.current = createSimEngine()
    ref.current.start()
    return () => {
      ref.current?.stop()
    }
  }, [])
}

/**
 * Warm the planner chunk once the shell has stopped being busy.
 *
 * Lazy-loading `/plan` moved a 783 kB matrix off first paint, and it also moved
 * the fetch to click time — which is the one moment a connection is allowed to
 * be down and the visitor still expects a screen. Prefetching on idle closes
 * that window to the first few seconds of the session instead of leaving it
 * open for as long as the tab lives.
 *
 * Speculative, so it fails silently: a rejected prefetch is not an error the
 * visitor did anything to cause, and `RouteBoundary` is what handles the real
 * failure if they later click through anyway. `requestIdleCallback` is skipped
 * by Safari, hence the timeout fallback — and it never runs before the sim
 * engine and the map have had the main thread to themselves.
 */
function usePrefetchPlan(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    const warm = () => {
      if (!cancelled) void loadPlanPage().catch(() => undefined)
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 4_000 })
      return () => {
        cancelled = true
        window.cancelIdleCallback?.(id)
      }
    }
    const id = window.setTimeout(warm, 2_000)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [])
}

export function App() {
  useSimEngine()
  usePrefetchPlan()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dispatch" element={<ConsolePage />} />
        {/*
         * Boundary OUTSIDE the Suspense, not inside: a rejected chunk fetch is
         * thrown at the first boundary above the suspended tree, and a boundary
         * nested under the Suspense would never see it. Without one, this route
         * takes the entire app down with it — see RouteBoundary.tsx.
         */}
        <Route path="/plan" element={<LazyRoute load={loadPlanPage} what="The planner" />} />
        <Route path="/driver" element={<DriverPage />} />
        <Route path="/t/:orderCode" element={<TrackingPage />} />
        <Route path="/manifest/:runId" element={<ManifestPage />} />
        {/*
         * The story page owns `/` and, deliberately, everything unmatched: an
         * unknown URL lands on the front door rather than bouncing through a
         * redirect. The trailing splat is also what lets the story mount
         * `/t/:orderCode` and `/manifest/:runId` as figures via
         * `<Routes location>` without react-router warning that a descendant
         * <Routes> sits under a parent path that cannot go deeper.
         */}
        <Route path="/*" element={<StoryPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
