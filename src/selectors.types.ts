/**
 * The read-only slice of the store that selectors operate on. Keeping this
 * separate means selectors are pure functions over plain data — trivially
 * testable, and reusable by the live engine without touching React.
 */

import type { DeliveryEvent, Run, Stop, WindowState } from './types'

export interface ManifestFleetView {
  runs: Record<string, Run>
  runOrder: string[]
  stops: Record<string, Stop>
}

export type { DeliveryEvent, Run, Stop, WindowState }
