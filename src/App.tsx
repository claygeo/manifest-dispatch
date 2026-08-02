/**
 * App shell + routes.
 *
 * The sim engine is started once here and lives for the whole session, so the
 * fleet keeps moving while the user walks between the console, the driver app
 * and a tracking link. StrictMode double-mounts in dev; the engine guards
 * against a second start and cleans up on unmount.
 */

import { useEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { createSimEngine, type SimEngine } from './sim/engine'
import ConsolePage from './console/ConsolePage'
import DriverPage from './driver/DriverPage'
import TrackingPage from './tracking/TrackingPage'
import ManifestPage from './manifest/ManifestPage'

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
        <Route path="/" element={<ConsolePage />} />
        <Route path="/driver" element={<DriverPage />} />
        <Route path="/t/:orderCode" element={<TrackingPage />} />
        <Route path="/manifest/:runId" element={<ManifestPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
