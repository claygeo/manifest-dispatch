/**
 * The "how it works" section is the page's positioning claim in prose, which
 * makes it the easiest thing on the site to quietly overstate. This file is
 * the guard: it holds the shape of the diagram (one box in a line of three),
 * checks the sentences are still sayable by somebody who does not write code,
 * and — the part that actually matters — cross-checks the two places the copy
 * makes a factual claim against the code it is describing.
 *
 * Two of these assertions are wired to the real product rather than to a
 * fixture: the driver verbs the section says "are the only ways to move a
 * delivery forward" are looked up on the live store, and the `/plan` link the
 * teaser points at is looked up in the router. If either moves, the copy
 * starts lying and this file fails before anybody deploys it.
 */

import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import { useStore } from '../store'
import {
  MECHANISM_RECORD,
  MECHANISM_SENTENCES,
  MECHANISM_STAGES,
  PLAN_TEASER,
} from './mechanism'
import {
  ID_CHECK,
  ID_CHECK_TECHNICAL,
  MEASURED,
  NEXT_STEP,
  ORDER_RECORD,
  SECTIONS,
  TECHNICAL_SUMMARY,
} from './copy'

/** Words that turn a plain sentence into a slide. */
const JARGON = [
  'api',
  'webhook',
  'middleware',
  'orchestrat',
  'state machine',
  'real-time',
  'realtime',
  'end-to-end',
  'leverage',
  'seamless',
  'synergy',
  'holistic',
  'best-in-class',
  'frictionless',
  'solution',
  'platform',
  'stack',
  'pipeline',
  'ingest',
]

/**
 * ROUND-1 ADDITION. The words above are marketing noise; these are engineering
 * notation, which is a different failure and the one that actually cost the
 * page a review. An operations director read a compliance section that answered
 * her question with "the invariant lives in the store" over a TypeScript block,
 * and a load section whose column headers were `p50` and `p95`. None of it was
 * wrong and none of it is deleted — it is behind the "For the technical reader"
 * disclosure, and the pair of sweeps below is what keeps it there: operator
 * copy may not contain these, and the disclosure has to still contain them, so
 * this cannot be "fixed" by quietly dropping the detail instead of moving it.
 */
const ENGINEER_NOTATION = [
  'invariant',
  'p50',
  'p95',
  'closestop',
  'idchecked',
  'src/',
  'zustand',
  'typescript',
  'polled',
  'reconciled',
]

/** Everything a visitor reads without opening a disclosure. */
function allProse(): string[] {
  return [
    ...MECHANISM_STAGES.flatMap((s) => [s.kicker, s.title, ...s.lines]),
    MECHANISM_RECORD.label,
    MECHANISM_RECORD.body,
    ...MECHANISM_SENTENCES,
    PLAN_TEASER.title,
    PLAN_TEASER.lede,
    PLAN_TEASER.philosophy,
    PLAN_TEASER.cta,
    ...operatorCopy(),
  ]
}

/** The page's own section copy, which is where the round-1 failure lived. */
function operatorCopy(): string[] {
  return [
    ...Object.values(SECTIONS).flatMap((s) => [s.step, s.title, s.lede]),
    ORDER_RECORD.plate,
    ORDER_RECORD.note,
    ID_CHECK.frameCaption,
    ID_CHECK.rule,
    ID_CHECK.fail,
    ID_CHECK.noHardware,
    MEASURED.lossLabel,
    MEASURED.latencyLead,
    MEASURED.latencyTail,
    NEXT_STEP.label,
    NEXT_STEP.body,
    NEXT_STEP.contact,
  ]
}

describe('the mechanism strip', () => {
  it('draws three stages in the order the order actually travels', () => {
    expect(MECHANISM_STAGES.map((s) => s.id)).toEqual(['pos', 'manifest', 'out'])
  })

  it('claims exactly one of them, and it is the middle one', () => {
    const ours = MECHANISM_STAGES.filter((s) => s.owned)
    expect(ours).toHaveLength(1)
    expect(ours[0].id).toBe('manifest')
    // The positioning argument is that we are a layer, not the whole line.
    expect(MECHANISM_STAGES[0].owned).toBe(false)
    expect(MECHANISM_STAGES[2].owned).toBe(false)
  })

  it('never describes the POS as something Manifest replaces', () => {
    // SPEC.md: "Sits ON TOP of any POS ... Not a POS replacement."
    for (const line of allProse()) {
      expect(line.toLowerCase()).not.toMatch(/replace|rip (it )?out|instead of your/)
    }
  })

  it('gives every stage enough substance to be worth a box, and no line too long to fit one', () => {
    for (const stage of MECHANISM_STAGES) {
      expect(stage.lines.length).toBeGreaterThanOrEqual(3)
      expect(stage.title.length).toBeGreaterThan(0)
      expect(stage.kicker.length).toBeGreaterThan(0)
      for (const line of stage.lines) {
        // A stage card is roughly 300px wide at the desktop breakpoint. Past
        // ~52 characters the lines wrap and the strip stops reading as a
        // diagram, so this is a layout constraint, not a style preference.
        expect(line.length).toBeLessThanOrEqual(52)
        expect(line.trim()).toBe(line)
      }
    }
  })

  it('lists the outputs the app actually has, all three of them', () => {
    const outs = MECHANISM_STAGES[2].lines.join(' ').toLowerCase()
    expect(outs).toContain('driver')
    expect(outs).toContain('customer')
    expect(outs).toContain('manifest')
  })
})

describe('the mechanism prose', () => {
  it('only claims the verbs the store actually implements', () => {
    // "Departing, arriving, verifying an ID, closing a stop and flagging an
    // exception are the only ways to move a delivery forward."
    const store = useStore.getState()
    for (const action of ['startRun', 'arriveStop', 'verifyId', 'closeStop', 'flagException']) {
      expect(typeof (store as unknown as Record<string, unknown>)[action]).toBe('function')
    }

    const body = MECHANISM_RECORD.body.toLowerCase()
    for (const verb of ['arriv', 'verif', 'clos', 'exception']) {
      expect(body).toContain(verb)
    }
    // And it must say the log is written as it happens, not compiled later.
    expect(body).toMatch(/timestamp/)
  })

  it('does not promise a second system that does not exist', () => {
    expect(MECHANISM_RECORD.body.toLowerCase()).toContain('no second system')
  })
})

describe('the repeatable sentences', () => {
  it('is two sentences, each short enough to say in one breath', () => {
    // Round 1 cut this from three. The section is now its diagram plus these,
    // because a phone reviewer measured the page at ~13,000px and named this
    // section as the place he nearly stopped scrolling.
    expect(MECHANISM_SENTENCES).toHaveLength(2)
    for (const line of MECHANISM_SENTENCES) {
      expect(line.length).toBeGreaterThan(40)
      expect(line.length).toBeLessThanOrEqual(200)
      expect(line.endsWith('.')).toBe(true)
    }
  })

  it('is free of the words that make a sentence unrepeatable', () => {
    for (const line of MECHANISM_SENTENCES) {
      const lower = line.toLowerCase()
      for (const word of JARGON) {
        expect(lower, `"${word}" in: ${line}`).not.toContain(word)
      }
    }
  })

  it('covers the three things the page spent six sections proving', () => {
    const all = MECHANISM_SENTENCES.join(' ').toLowerCase()
    expect(all).toContain('point of sale') // the integration-layer position
    expect(all).toContain('record') // the audit trail as a by-product
    expect(all).toContain('id check') // the gate that cannot be skipped
  })

  it('keeps jargon out of the diagram and the teaser too', () => {
    for (const line of allProse()) {
      const lower = line.toLowerCase()
      for (const word of JARGON) {
        expect(lower, `"${word}" in: ${line}`).not.toContain(word)
      }
    }
  })
})

/* ------------------------------------------------- round-1 operator path -- */

describe('the operator path speaks operator', () => {
  it('carries no engineering notation anywhere a visitor reads by default', () => {
    for (const line of allProse()) {
      const lower = line.toLowerCase()
      for (const word of ENGINEER_NOTATION) {
        expect(lower, `"${word}" in: ${line}`).not.toContain(word)
      }
    }
  })

  it('keeps the marketing denylist over the section copy too', () => {
    for (const line of operatorCopy()) {
      const lower = line.toLowerCase()
      for (const word of JARGON) {
        expect(lower, `"${word}" in: ${line}`).not.toContain(word)
      }
    }
  })

  it('states the ID rule as a rule a driver cannot get around', () => {
    const rule = ID_CHECK.rule.toLowerCase()
    expect(rule).toContain('cannot close')
    // The mechanism, in the operator's terms: the stop stays open. Not "the
    // state machine refuses the transition".
    expect(rule).toMatch(/stays open|until the check/)
  })

  it('says what a failed check actually does, and to whom', () => {
    const fail = ID_CHECK.fail.toLowerCase()
    expect(fail).toContain('exception')
    expect(fail).toContain('dispatcher')
    expect(fail).toContain('manifest')
  })

  it('did not fix the section by deleting the detail', () => {
    // The whole point of the disclosure. If somebody "passes" the sweep above
    // by dropping the excerpt instead of relocating it, this fails.
    const technical = `${ID_CHECK_TECHNICAL.body} ${ID_CHECK_TECHNICAL.code} ${ID_CHECK_TECHNICAL.caption}`.toLowerCase()
    expect(technical).toContain('invariant')
    expect(technical).toContain('closestop')
    expect(technical).toContain('idchecked')
    expect(technical).toContain('src/store.ts')
    expect(MEASURED.technicalNote.toLowerCase()).toContain('p50')
    expect(MEASURED.technicalNote.toLowerCase()).toContain('p95')
  })

  it('labels every disclosure the same way, in sentence case', () => {
    expect(TECHNICAL_SUMMARY).toBe('For the technical reader')
    expect(TECHNICAL_SUMMARY).not.toBe(TECHNICAL_SUMMARY.toUpperCase())
  })

  it('has an honest closing note with a real contact path and no invented one', () => {
    // Round 1: the page "sells like a vendor and signs off like a resume".
    const body = NEXT_STEP.body.toLowerCase()
    expect(body).toContain('seeded')
    expect(body).toContain('by design')
    expect(body).toContain('gap list')
    expect(NEXT_STEP.href).toBe('https://claygeo.dev')
    // No fake demand generation on a page whose argument is that nothing here
    // is oversold.
    const closing = `${NEXT_STEP.label} ${NEXT_STEP.body} ${NEXT_STEP.contact}`.toLowerCase()
    expect(closing).not.toMatch(/book a demo|schedule a call|request a quote|pricing|free trial|get started today/)
  })

  it('never lets the seeded-POS caveat drop off the page', () => {
    // It used to live in the "how it works" section, which round 1 cut down.
    // Losing the caveat with the prose around it would be the bad version of
    // that fix, so the claim is pinned here rather than to a location.
    const everywhere = [...allProse()].join(' ').toLowerCase()
    expect(everywhere).toContain('seeded')
    expect(everywhere).not.toContain('integrated with')
  })
})

describe('the section copy', () => {
  it('gives every section a step, a title and a lede', () => {
    for (const [key, section] of Object.entries(SECTIONS)) {
      expect(section.step.length, key).toBeGreaterThan(2)
      expect(section.title.endsWith('.'), key).toBe(true)
      expect(section.lede.length, key).toBeGreaterThan(20)
    }
  })

  it('keeps the how-it-works lede short enough not to restate the hero', () => {
    // Round 1, phone: that section's lede repeated the hero's positioning claim
    // almost verbatim three quarters of the way down a very long page. The
    // diagram under it already makes the argument.
    expect(SECTIONS.mechanism.lede.length).toBeLessThanOrEqual(90)
  })

  it('describes two screens without describing the plumbing between them', () => {
    const lede = SECTIONS.enRoute.lede.toLowerCase()
    expect(lede).toContain('both move')
    expect(lede).toMatch(/refresh|type|typed|re-type/)
  })
})

describe('the /plan teaser', () => {
  it('points at a route the router actually serves', () => {
    // Read from App.tsx itself rather than from a copy of the string, so a
    // renamed route breaks the teaser here instead of in production.
    expect(appSource.length).toBeGreaterThan(200)
    expect(appSource).toContain('<Route')
    expect(appSource).toContain(`path="${PLAN_TEASER.path}"`)
  })

  it('states the sequencing philosophy in the product\'s own terms', () => {
    // SPEC.md: "The UI always shows the human order's total drive time NEXT TO
    // the suggested order's ... so local knowledge is measured, not argued."
    expect(PLAN_TEASER.philosophy).toContain('Yours')
    expect(PLAN_TEASER.philosophy).toContain('Suggested')
    expect(PLAN_TEASER.philosophy.toLowerCase()).toContain('audit trail')
    expect(PLAN_TEASER.philosophy.toLowerCase()).toMatch(/measured/)
  })

  it('is one sentence, because that was the brief', () => {
    const sentences = PLAN_TEASER.philosophy.split('. ').filter(Boolean)
    expect(sentences).toHaveLength(1)
  })

  it('offers a real call to action', () => {
    expect(PLAN_TEASER.cta.length).toBeGreaterThan(4)
    expect(PLAN_TEASER.title.endsWith('.')).toBe(true)
  })
})
