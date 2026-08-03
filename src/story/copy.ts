/**
 * Every word the story page says to a non-engineer, in one file.
 *
 * ROUND-1 FIX. A cold read by an operations director failed the page on one
 * thing above all others: engineer-speak sitting on the operator's path. The
 * compliance section — the section aimed most squarely at the people who buy
 * this — answered "how do you stop a driver skipping the ID check" with a
 * TypeScript block, a file path, and the sentence "the invariant lives in the
 * store". The load numbers were column headers reading p50 and p95. Two screens
 * were described as neither "polled" nor "reconciled", which is a sentence that
 * only means something to the person who wrote it.
 *
 * None of that content was wrong. It was aimed at the wrong reader, in the one
 * place the wrong reader was standing. So the rule this file exists to hold:
 *
 *   The operator path says what the RULE is, in the words the rule is written
 *   in. Anything that is really about the implementation goes behind the
 *   "For the technical reader" disclosure, collapsed, unchanged, one tap away.
 *
 * Keeping the prose here rather than inline in the JSX is what makes that rule
 * testable: `mechanism.test.ts` sweeps every operator-visible string in this
 * file against a denylist that now includes `invariant`, `p50` and `p95`, and
 * separately asserts the technical disclosure still CONTAINS them — so the fix
 * cannot regress by drifting back up, and cannot be "passed" by deleting the
 * detail instead of relocating it.
 */

export interface SectionCopy {
  /** The eyebrow above the title — where in the lifecycle this is. */
  step: string
  title: string
  lede: string
}

/** One label for every collapsed technical aside on the page. */
export const TECHNICAL_SUMMARY = 'For the technical reader'

/* ------------------------------------------------------------- sections -- */

export const SECTIONS = {
  packed: {
    step: 'Packed',
    title: 'It starts where the POS stops.',
    lede: 'Manifest is not a point of sale and does not want to be. The order is taken, paid out and packed somewhere else. What crosses the boundary is one record.',
  },
  dispatched: {
    step: 'Dispatched',
    title: 'The map is the page.',
    lede: 'No app chrome hosting a map widget. The console is the map, with the run rails and the event feed floating over it. Runs start, stops resequence, ETAs drift, and a stop that will miss its window turns amber before it misses it.',
  },
  enRoute: {
    step: 'En route',
    title: 'Two screens, one state.',
    /**
     * ROUND-1 FIX: was "Nothing is polled, nothing is reconciled". Both words
     * describe the absence of work the reader never knew was possible. What
     * they were trying to say, in the words an operator would use: nobody
     * refreshes anything and nobody types anything twice.
     */
    lede: 'The driver’s ticket and the customer’s tracking link are two different products doing two different jobs, and they are reading the same delivery. When the van moves, both move — nobody refreshes a page and nobody re-types an address into a second system.',
  },
  idCheck: {
    step: 'At the door',
    title: 'The gate that cannot be skipped.',
    lede: 'Florida medical delivery turns on one thing: a verified 21+ ID at every handover. So it is not a box to tick on the way out, it is a step the stop has to pass through.',
  },
  closeout: {
    step: 'Closeout',
    title: 'Money is a state, not a transaction.',
    lede: 'No card is read and no funds move. Cash does the arithmetic a driver actually does at the door; debit and digital walk an honest ladder that says SIMULATED where a real terminal would say APPROVED.',
  },
  compliance: {
    step: 'Compliance',
    title: 'The document that rides with the van.',
    lede: 'Every run carries a printable manifest: transport record, ordered stops, custody log with an ID stamp per handover, signature rules. It is deliberately formal, because it is the artifact an inspector asks for and a friendly one would be worse.',
  },
  mechanism: {
    step: 'How it works',
    title: 'One layer, between the counter and the door.',
    /**
     * ROUND-1 FIX (length): this lede used to restate the hero's positioning
     * claim almost word for word, three quarters of the way down a very long
     * page, and a reviewer on a phone nearly bailed on the scroll here. The
     * diagram underneath already makes the argument. One line is enough to
     * introduce it.
     */
    lede: 'Three boxes. Manifest is only the middle one.',
  },
  measured: {
    step: 'Measured',
    title: 'Load is a number, not an adjective.',
    lede: 'The live mode behind the demo sends driver positions over a shared channel. Here is what that did when it was actually measured, on a dated run, with the script in this repo.',
  },
  explore: {
    step: 'Explore',
    title: 'Now open the real thing.',
    lede: 'No gate, no login, no contact form, nothing collected. Every surface below is the same running fleet you have been watching.',
  },
} as const satisfies Record<string, SectionCopy>

/* ---------------------------------------------------------- order record -- */

export const ORDER_RECORD = {
  plate: 'Packed order, as received',
  note: 'Seven fields and a delivery window. In this demo those records are seeded rather than read off a live point of sale, which is stated plainly at the foot of the page rather than buried in one.',
} as const

/* -------------------------------------------------------------- ID check -- */

/**
 * What the rule IS, for the compliance reader.
 *
 * Deliberately written the way a policy is written — the thing the driver
 * cannot do, and what happens instead when they cannot do the thing.
 */
export const ID_CHECK = {
  frameCaption: 'Full screen, no dismiss, verdict only.',
  rule: 'A driver cannot close a stop without checking the ID first. There is no button to close it early, no warning to tap past, and nothing left blank to tidy up at the end of the night. The stop stays open until the check has an answer.',
  fail: 'Answering "cannot verify" does not quietly close the stop either. It flags the stop as an exception, which is what the dispatcher sees on the board and what prints on the run manifest, with a time against it.',
  noHardware:
    'No camera and no scanner. That was cut on purpose: hardware the demo cannot honestly show is hardware it does not pretend to have.',
} as const

/**
 * The same claim for the reader who wants to know how it is held. Collapsed by
 * default. Nothing here was softened on the way down — this is the original
 * text and the original excerpt, moved rather than edited.
 */
export const ID_CHECK_TECHNICAL = {
  body: 'The invariant lives in the store, not in the screen. A stop cannot be closed against an unverified ID even by driving the state directly, and a failed check does not fall through to closed either: it lands the stop in exception, which the dispatcher and the manifest both see.',
  code: `closeStop: (stopId, payment) => {
  const stop = get().stops[stopId]
  if (!stop) return
  // the app enforces the law's shape: no close without a verified ID
  if (!stop.idChecked) return`,
  caption: 'src/store.ts',
} as const

/* -------------------------------------------------------------- measured -- */

/**
 * The load result in a sentence, for the reader who does not read percentile
 * tables. The numbers themselves are computed from the published rows at render
 * time — this file holds the sentence around them and nothing else, so the
 * prose and the table can never disagree.
 */
export const MEASURED = {
  lossLabel: 'Message loss at every fleet size tested.',
  latencyLead: 'Half of the driver position updates arrived within',
  latencyTail: 'of being sent, and nineteen in twenty within',
  technicalNote:
    'The full table — publishers, sent, received, loss, p50, p95, max and total deliveries per tier — with the command and the run date.',
} as const

/* ------------------------------------------------------------- next step -- */

/**
 * ROUND-1 FIX. The page argued its case and then stopped dead: it "sells like a
 * vendor and signs off like a resume", with nothing between the last claim and
 * the byline. This is the honest ending — what the demo actually is, what it
 * is missing, and where the person who built it is. No booking widget, no
 * pricing, no form. The brand here is that nothing on the page is oversold, and
 * a fake call to action would be the first thing that was.
 */
export const NEXT_STEP = {
  label: 'Where this actually stands',
  body: 'Everything on this page is running. The one thing that is not is the handover from the point of sale: the packed orders here are seeded rather than read from a live system, by design, so the demo has nothing behind it that can be down when you open the link. Wiring it to a real one is the first item on the production gap list, not a solved problem, and the same is true of accounts, roles and a payment terminal.',
  contact: 'If any of that is worth a conversation — running it, or how it was built —',
  linkText: 'claygeo.dev',
  href: 'https://claygeo.dev',
} as const
