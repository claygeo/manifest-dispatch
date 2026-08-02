/**
 * Manifest — shared data model.
 *
 * The block below is the contract from SPEC.md "Data model", verbatim in
 * semantics. Every surface (console, driver, tracking, manifest) speaks these
 * types and nothing else. Do not widen or rename fields without updating SPEC.md.
 */

export type StopStatus = 'pending' | 'enroute' | 'arrived' | 'id_check' | 'delivered' | 'exception'
export type RunStatus = 'staged' | 'active' | 'complete'
export type PaymentMethod = 'cash' | 'debit' | 'digital'

export interface Stop {
  id: string // 'run-a-1'
  orderCode: string // 'MFST-4102' (mono, shown everywhere)
  customer: string // first name + last initial on driver/console; full only on ticket
  address: string
  lngLat: [number, number]
  items: { name: string; qty: number }[] // e.g. 'Flower 3.5g — Gelato'
  amountDue: number
  payment: PaymentMethod
  status: StopStatus
  window: [string, string] // delivery window '2:00 PM'–'4:00 PM'
  etaMin: number | null // live-updated
  idChecked: boolean
  closedAt: string | null
}

export interface Run {
  id: string
  label: string
  driver: string
  status: RunStatus
  stops: string[] // ordered stop ids
  currentLeg: number // index into legs
  progress: number // 0..1 along current leg
  position: [number, number]
  heading: number
  manifestId: string // 'MAN-2026-0802-A' — the compliance document id
}

export type DeliveryEventType =
  | 'run_started'
  | 'departed'
  | 'arrived'
  | 'id_verified'
  | 'id_failed'
  | 'closed'
  | 'exception'
  | 'note'

export interface DeliveryEvent {
  id: string
  runId: string
  stopId: string | null
  type: DeliveryEventType
  at: string
  meta?: Record<string, string>
}

/* ------------------------------------------------------------------------- *
 * Supporting types (route geometry, app-level state). These are additive —
 * they describe things the spec's data model references but does not spell
 * out (the precomputed OSRM geometry, theme/mode, selection).
 * ------------------------------------------------------------------------- */

/** One precomputed OSRM leg: depot -> stop 1, stop 1 -> stop 2, ..., last stop -> depot. */
export interface RouteLeg {
  distance_m: number
  duration_s: number
  /** [lng, lat] positions along the road. */
  coords: [number, number][]
}

export interface RouteStopSeed {
  name: string
  address: string
  lon: number
  lat: number
}

export interface RouteRun {
  id: string
  label: string
  driver: string
  stops: RouteStopSeed[]
  legs: RouteLeg[]
}

export interface RouteData {
  depot: { name: string; lon: number; lat: number }
  runs: RouteRun[]
}

export type Theme = 'dark' | 'light'

/** 'demo' = client-side sim engine. 'live' = Supabase realtime. UI never branches on this. */
export type Mode = 'demo' | 'live'

export type SelectionKind = 'run' | 'stop'

export interface Selection {
  kind: SelectionKind
  id: string
}

/**
 * Quality of the most recent live GPS fix. App-level state only: this is never
 * written to a manifest, never persisted to Supabase, and never part of the
 * SPEC data model above — it exists so the map can draw an honest accuracy
 * ring and the driver rail can say whether the fix is real or simulated.
 */
export interface LiveFix {
  /** Reported horizontal accuracy in metres. 0 when the fix is simulated. */
  accuracyM: number
  /** true when the phone is playing the precomputed route instead of a real fix. */
  simulated: boolean
  /** Wall-clock ms the fix was taken. */
  atMs: number
}

/** Window compliance for a stop, derived — never stored. Amber = dispatcher must act. */
export type WindowState = 'ok' | 'due' | 'late' | 'closed'

/** Reasons a stop can go undeliverable. Drives the exception event meta. */
export type ExceptionReason = 'no_answer' | 'cannot_verify' | 'refused' | 'address_issue'
