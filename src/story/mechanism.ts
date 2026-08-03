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
 * never described as something we replace, and no jargon in the sentences a
 * non-engineer is supposed to be able to say out loud.
 *
 * The rest of the page's operator-facing prose lives next door in `copy.ts`,
 * and `mechanism.test.ts` sweeps both. The POS-handoff caveat that used to live
 * in this file now sits in `copy.ts`'s NEXT_STEP block, where the page ends.
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
 * Why the audit trail is a by-product rather than a chore. This is the part
 * that usually gets sold as "reporting"; it is more honest as arithmetic.
 *
 * ROUND-1 MOVE: this used to sit in the "how it works" section, which a phone
 * reviewer flagged as the place the scroll became unbearable. It reads better
 * under the manifest itself anyway — it is the claim that document is making.
 */
export const MECHANISM_RECORD = {
  label: 'The record',
  body: 'There is no second system where the paperwork gets done. Departing, arriving, verifying an ID, closing a stop and flagging an exception are the only ways to move a delivery forward, and each one writes a timestamped line the moment the driver taps it. The compliance document is that log, ordered and printed.',
} as const

/**
 * The sentences a director can repeat in a meeting without a slide.
 *
 * Constraints the test enforces: plain words only, short enough to say in one
 * breath, and no claim the product cannot back up on this page.
 *
 * ROUND-1 FIX (length): there were three, under a heading announcing that there
 * were three, in a section that had already spent four blocks restating the
 * hero. A phone reviewer measured the page at roughly thirteen thousand pixels
 * and nearly abandoned it here. The section is now its diagram plus these two
 * lines, and the third sentence's content is folded into the second rather than
 * dropped.
 */
export const MECHANISM_SENTENCES: readonly string[] = [
  'We keep the point of sale we already run. Manifest picks the order up once it is packed and owns everything after that.',
  'Every action the driver takes is the record, and the ID check is the one step the app will not let a driver skip.',
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
