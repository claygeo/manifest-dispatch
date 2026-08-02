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

import { lazy, Suspense, useEffect, useRef } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { createSimEngine, type SimEngine } from './sim/engine'
import StoryPage from './story/StoryPage'
import ConsolePage from './console/ConsolePage'
import DriverPage from './driver/DriverPage'
import TrackingPage from './tracking/TrackingPage'
import ManifestPage from './manifest/ManifestPage'

/**
 * `/plan` is the one lazily-loaded surface.
 *
 * Not for tidiness — for weight. The route planner reads `data/matrix.json`,
 * the full directed leg matrix, which is 783 kB of road geometry. Statically
 * importing it would put all of that on the critical path of the story page,
 * where SPEC.md's definition of done asks for first paint under three seconds.
 * As a lazy route it becomes its own chunk that only a visitor who opens the
 * planner ever downloads.
 */
const PlanPage = lazy(() => import('./plan/PlanPage'))

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

export function App() {
  useSimEngine()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dispatch" element={<ConsolePage />} />
        <Route
          path="/plan"
          element={
            <Suspense fallback={<div className="app-loading">Loading the planner…</div>}>
              <PlanPage />
            </Suspense>
          }
        />
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
