/**
 * "How it works" — the mechanism, in words a director can repeat.
 *
 * SPEC.md, "Story page addendum": between the compliance section and the
 * measured-proof section the page owes the "okay but how does it actually
 * work" reader a plain-language answer — the POS hands off the packed order
 * (integration layer, not a POS replacement), Manifest owns dispatch,
 * tracking and compliant handoff, and every action becomes the audit record.
 *
 * The copy lives here rather than inline in the JSX for one reason: it is the
 * page's load-bearing positioning claim, and positioning claims drift. Here it
 * is a typed constant with a test file next to it that holds the line on the
 * things that must stay true — three stages, exactly one of them ours, the POS
 * never described as something we replace, the ingestion boundary named as a
 * boundary rather than as a shipped integration, and no jargon in the
 * sentences a non-engineer is supposed to be able to say out loud.
 */

export interface MechanismStage {
  id: string
  /** Small label above the stage title. */
  kicker: string
  title: string
  /** What happens here, one short line per item. */
  lines: readonly string[]
  /**
   * True only for the stage Manifest is. The whole positioning argument is
   * that this is one box in a line of three, so exactly one stage may claim it.
   */
  owned: boolean
}

/**
 * The diagram strip, left to right. Stage three is a fan rather than a single
 * box because the handoff genuinely produces three different artifacts for
 * three different audiences, and drawing it as one would flatter the product.
 */
export const MECHANISM_STAGES: readonly MechanismStage[] = [
  {
    id: 'pos',
    kicker: 'Stays yours',
    title: 'The point of sale',
    lines: [
      'Order taken and paid',
      'Compliance check at the counter',
      'Bag packed and labelled',
    ],
    owned: false,
  },
  {
    id: 'manifest',
    kicker: 'What we are',
    title: 'Manifest',
    lines: [
      'Sequence the run, assign the driver',
      'Track the van, keep the promise honest',
      'Gate the handoff on a verified ID',
      'Close the stop, log what happened',
    ],
    owned: true,
  },
  {
    id: 'out',
    kicker: 'What comes out',
    title: 'Three views of one run',
    lines: [
      'Driver: one action per state',
      'Customer: a link, no account',
      'Manifest: the document that rides along',
    ],
    owned: false,
  },
]

/**
 * The handoff itself. One record crosses the boundary, and in this demo the
 * record is seeded rather than received — which is said here in the same
 * breath as the claim, not in a footnote.
 */
export const MECHANISM_HANDOFF = {
  label: 'The handoff',
  body: 'One packed order crosses the line: who it is for, where it goes, what is in the bag, what is owed, and the window it was promised in. Manifest does not take payment, does not hold inventory, and does not want the counter. It takes the bag from the moment it is sealed to the moment it is handed over and logged.',
  caveat:
    'In this demo those records are seeded rather than received from a live POS. Reading them off a real one is the first item on the production gap list rather than a solved problem, and every section of this page that touches it says so.',
} as const

/**
 * Why the audit trail is a by-product rather than a chore. This is the part
 * that usually gets sold as "reporting"; it is more honest as arithmetic.
 */
export const MECHANISM_RECORD = {
  label: 'The record',
  body: 'There is no second system where the paperwork gets done. Departing, arriving, verifying an ID, closing a stop and flagging an exception are the only ways to move a delivery forward, and each one writes a timestamped line the moment the driver taps it. The compliance document is that log, ordered and printed.',
} as const

/**
 * Three sentences a director can repeat in a meeting without a slide.
 *
 * Constraints the test enforces: plain words only, short enough to say in one
 * breath, and no claim the product cannot back up on this page.
 */
export const MECHANISM_SENTENCES: readonly string[] = [
  'We keep the point of sale we already run. Manifest picks the order up once it is packed and owns everything after that.',
  'Every action the driver takes is the record, so nobody re-types a manifest at the end of the night.',
  'The ID check is a step the app will not let a driver skip, which means the compliance story reads the same on the worst day as on the best one.',
]

/**
 * The `/plan` teaser. SPEC's sequencing philosophy in one sentence: suggest,
 * allow bounded adjustment, quantify, log — the dispatcher may nudge, and the
 * nudge is measured rather than argued about.
 */
export const PLAN_TEASER = {
  step: 'Try it',
  title: 'Plan a run yourself.',
  lede: 'Pick stops from the pending pool, watch the suggested sequence land on the map, then nudge the order and see what your local knowledge actually costs.',
  philosophy:
    "Manifest proposes a sequence, lets you change it, and then prints your order's drive time next to its own — Yours against Suggested, on screen, every time you nudge — so a driver's shortcut is measured instead of argued about, and every resequence lands in the audit trail.",
  cta: 'Open the planner',
  path: '/plan',
} as const
