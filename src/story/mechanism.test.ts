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
  MECHANISM_HANDOFF,
  MECHANISM_RECORD,
  MECHANISM_SENTENCES,
  MECHANISM_STAGES,
  PLAN_TEASER,
} from './mechanism'

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

function allProse(): string[] {
  return [
    ...MECHANISM_STAGES.flatMap((s) => [s.kicker, s.title, ...s.lines]),
    MECHANISM_HANDOFF.label,
    MECHANISM_HANDOFF.body,
    MECHANISM_HANDOFF.caveat,
    MECHANISM_RECORD.label,
    MECHANISM_RECORD.body,
    ...MECHANISM_SENTENCES,
    PLAN_TEASER.title,
    PLAN_TEASER.lede,
    PLAN_TEASER.philosophy,
    PLAN_TEASER.cta,
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
  it('names the POS ingestion boundary as a boundary, not as a shipped feature', () => {
    // The demo seeds these records. Saying so next to the claim is the whole
    // honesty rail; burying it in a footnote would not be.
    const caveat = MECHANISM_HANDOFF.caveat.toLowerCase()
    expect(caveat).toContain('seeded')
    expect(caveat).toContain('gap list')
    expect(caveat).not.toContain('integrated with')
  })

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

describe('the three sentences', () => {
  it('is three sentences, each short enough to say in one breath', () => {
    expect(MECHANISM_SENTENCES).toHaveLength(3)
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
