/**
 * Measured proof — every number the story page prints, with its provenance.
 *
 * SPEC.md's production-adaptability bar: "'Handles load' is a number, not an
 * adjective." So this file is the one place the marketing surface is allowed to
 * state a figure, and nothing lands here that was not produced by a script in
 * this repo on a dated run. No rounding up, no "sub-100ms" summaries, no
 * dropping the tier whose max was ugly.
 *
 * Sources
 *   BROADCAST_*  `npm run bench:broadcast` (scripts/bench-broadcast.mjs) against
 *                the real Supabase project, run 2026-08-02T18:39:33Z. Figures
 *                copied verbatim from that run's JSON block.
 *   TEST_COUNTS  `npm test` (vitest, 8 files) and `npm run test:rpc`
 *                (scripts/test-rpcs.mjs, 25 contract checks against the live
 *                project).
 *
 * If a bench is re-run, this file changes with it or the page starts lying.
 */

export interface BroadcastTier {
  /** Simulated driver phones publishing GPS at 1 Hz over one channel. */
  publishers: number
  /** Pings sent during the measurement window. */
  sent: number
  /** Pings the subscriber received. Equal to `sent` means zero loss. */
  received: number
  lossPct: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  /**
   * Every send is fanned out to every other client on the channel, so this is
   * what the server actually delivered in the window. It is the difference
   * between what the test asks Supabase to accept and what it asks Supabase
   * to deliver.
   */
  deliveries: number
}

export const BROADCAST_TIERS: readonly BroadcastTier[] = [
  {
    publishers: 10,
    sent: 246,
    received: 246,
    lossPct: 0,
    p50Ms: 46.4,
    p95Ms: 359.7,
    maxMs: 522,
    deliveries: 2460,
  },
  {
    publishers: 25,
    sent: 612,
    received: 612,
    lossPct: 0,
    p50Ms: 74.9,
    p95Ms: 154.9,
    maxMs: 2330,
    deliveries: 15300,
  },
  {
    publishers: 50,
    sent: 1245,
    received: 1245,
    lossPct: 0,
    p50Ms: 75.9,
    p95Ms: 117.1,
    maxMs: 394.1,
    deliveries: 62250,
  },
]

export const BROADCAST_RUN = {
  date: '2026-08-02',
  command: 'npm run bench:broadcast',
  windowSeconds: 25,
  rateHz: 1,
  runtime: 'Node 22.13.0, Windows, one consumer machine',
} as const

export const TEST_COUNTS = {
  /** `npm test` — vitest, green. */
  unit: 242,
  unitFiles: 8,
  /** `npm run test:rpc` — contract checks fired at the real Supabase RPCs. */
  rpc: 25,
} as const

/**
 * The caveats travel with the numbers. Taking these off the page would make
 * the table worth less, not more.
 */
export const BROADCAST_CAVEATS: readonly string[] = [
  'Publishers and the subscriber run in one Node process on one consumer machine, so both timestamps come off the same monotonic clock. That removes clock skew and it also means this is a round trip through Supabase from one machine, not phone-to-console wall clock. A real deployment adds each device network leg.',
  "Publishers join over a WebSocket exactly like the driver app does, so the server also fans every ping out to the other publishers. N publishers on one channel is a deliberate stress shape. Manifest's own topology is one channel per session: one phone, one console, one tracking page.",
  'Free-tier project, single region, 25 second window per tier. The 2,330 ms max at N=25 was a single outlier in that window and it stays in the table.',
]
