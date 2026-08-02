/**
 * Readability contract for every stylesheet in the app.
 *
 * DESIGN.md v2 names three inks and assigns them roles:
 *   "Ink: #262521 primary · #6E6759 secondary · #A69E8F disabled"
 *
 * The third one is the DISABLED tone. Measured against the fields it is
 * actually painted on, `--ink-3` lands at 2.13–2.66:1 on the paper theme and
 * 3.09–3.83:1 on moss night — under the 4.5:1 AA floor for body copy on every
 * surface in the app, and under the 3:1 large-text floor on most of them.
 * `--ink-2` measures 6.41–9.58:1 across the same set. So the rule this file
 * enforces is not a preference, it is the design system read literally: text a
 * person has to READ uses ink-2, and ink-3 is reserved for controls that
 * cannot be operated and marks that carry no information.
 *
 * The same logic covers opacity. A translucent text node is an unreviewable
 * contrast value — it depends on whatever happens to be behind it — so text
 * dims by picking a different token, never by fading. Opacity survives on
 * three things: hairlines and bezel details that are decoration, an SVG icon
 * whose hover affordance IS its opacity, and animation states.
 *
 * SELF-TEST: the checkers below are run against planted violations at the
 * bottom of this file, and the parser is required to find a plausible number
 * of rules in every real file it opens. A sweep test that cannot fail is worth
 * less than no test, and a sweep test that silently reads zero bytes is worse.
 */

import { describe, expect, it } from 'vitest'
import themeCss from './theme.css?raw'
import consoleCss from './console/console.css?raw'
import driverCss from './driver/driver.css?raw'
import trackingCss from './tracking/tracking.css?raw'
import liveCss from './live/live.css?raw'
import planCss from './plan/plan.css?raw'
import manifestCss from './manifest/manifest.css?raw'
import storyCss from './story/story.css?raw'

/* ------------------------------------------------------------- parsing --- */

interface CssRule {
  selector: string
  body: string
}

/**
 * Enough of a CSS parser for this job: comments out, then every innermost
 * `selector { declarations }` pair. At-rule headers never match because their
 * bodies contain braces, so `@media` wrappers dissolve and leave the rules
 * inside them — which is what we want, since the check is per-declaration and
 * does not care which breakpoint a rule lives at.
 */
function parseRules(css: string): CssRule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: CssRule[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    if (!selector || selector.startsWith('@')) continue
    out.push({ selector, body: m[2] })
  }
  return out
}

/** `0%, 100% { … }` inside a @keyframes block. Not a selector, not text. */
function isKeyframeStep(selector: string): boolean {
  return /^[\d.%,\sfromto]+$/i.test(selector)
}

/** Rules that paint text with the disabled ink. */
function faintTextRules(rules: CssRule[]): CssRule[] {
  return rules.filter((r) => /(^|;)\s*color\s*:[^;]*var\(--ink-3\)/.test(r.body))
}

/**
 * Rules that fade something to a partial opacity. `opacity: 0` is excluded on
 * purpose: a node at zero is hidden and about to be animated in, which is a
 * motion state rather than an under-contrasted one. Anything strictly between
 * 0 and 0.9 is the pattern this sweep exists to remove.
 */
function partialOpacityRules(rules: CssRule[]): CssRule[] {
  return rules.filter((r) => {
    if (isKeyframeStep(r.selector)) return false
    const m = /(^|;)\s*opacity\s*:\s*([0-9.]+)/.exec(r.body)
    if (!m) return false
    const value = Number(m[2])
    return value > 0 && value < 0.9
  })
}

/* --------------------------------------------------------- the contract -- */

/** Selectors allowed to paint text with `--ink-3`, and why each one is. */
const DISABLED_INK_ALLOWED: Record<string, string> = {
  '.btn:disabled': 'a control that cannot be pressed',
  '.dc-nudge:disabled': 'stop reorder at the end of its range',
  '.dc-feed__scope .chip:disabled': 'feed scope with nothing to scope to',
  '.dc-code-input::placeholder': 'bullets standing in for an absent value',
  '.pl-nudge__btn:disabled': 'stop reorder at the end of its range',
  '.pl-compare__sep': 'an aria-hidden middot between two figures',
}

/** Selectors allowed to fade below 0.9, and why each one is not text. */
const PARTIAL_OPACITY_ALLOWED: Record<string, string> = {
  '.dc-plate-btn': 'an SVG chevron whose hover affordance is its opacity',
  '.st-hero__cue': 'a 1px gradient hairline',
  '.st-phone-slot': 'the speaker slot drawn on a phone bezel',
  '.tk-leader': 'the dotted leader rule between a label and a value',
}

/**
 * Every stylesheet the app ships, pulled in as source text through Vite's
 * `?raw` loader. Importing rather than reading from disk means a renamed or
 * deleted stylesheet is a resolution error at collection time — the sweep can
 * never quietly start covering fewer files than it claims to.
 */
const SOURCES: readonly (readonly [string, string])[] = [
  ['theme.css', themeCss],
  ['console/console.css', consoleCss],
  ['driver/driver.css', driverCss],
  ['tracking/tracking.css', trackingCss],
  ['live/live.css', liveCss],
  ['plan/plan.css', planCss],
  ['manifest/manifest.css', manifestCss],
  ['story/story.css', storyCss],
]

/**
 * Floors that make an unreadable input fail loudly instead of passing empty.
 * The smallest real stylesheet here (live.css) carries 17 rules over ~3.5KB,
 * so these sit just under it: a stubbed file, a truncated read or a parser
 * that stopped matching all land well below both.
 */
const MIN_RULES = 12
const MIN_BYTES = 1_000

function load(rel: string, css: string): CssRule[] {
  if (css.trim().length < MIN_BYTES) {
    throw new Error(`only ${css.length} bytes read from ${rel} — file is empty or stubbed`)
  }
  const rules = parseRules(css)
  if (rules.length < MIN_RULES) {
    throw new Error(`only ${rules.length} rules parsed from ${rel} — the parser is wrong`)
  }
  return rules
}

const STYLESHEETS = SOURCES.map(([rel]) => rel)
const SHEETS = new Map(SOURCES.map(([rel, css]) => [rel, load(rel, css)]))

/* ------------------------------------------------------------- the tests - */

describe('the parser is reading real stylesheets', () => {
  it('finds a plausible rule count in every file it was pointed at', () => {
    expect(SHEETS.size).toBe(STYLESHEETS.length)
    for (const [rel, rules] of SHEETS) {
      expect(rules.length, rel).toBeGreaterThanOrEqual(MIN_RULES)
    }
  })

  it('unwraps media queries instead of swallowing them', () => {
    const story = SHEETS.get('story/story.css')!
    // `.st-flow` is declared once at the top level and again inside a
    // (min-width: 900px) block. Both have to come back.
    expect(story.filter((r) => r.selector === '.st-flow').length).toBeGreaterThanOrEqual(2)
  })

  it('does not mistake a token definition for a text colour', () => {
    // `:root { --ink-3: #767b6e }` must not read as "text painted with ink-3".
    const theme = SHEETS.get('theme.css')!
    const roots = theme.filter((r) => r.selector.includes(':root') && r.body.includes('--ink-3:'))
    expect(roots.length).toBeGreaterThan(0)
    expect(faintTextRules(roots)).toEqual([])
  })
})

describe('ink-3 is the disabled tone and nothing else', () => {
  for (const rel of STYLESHEETS) {
    it(`${rel} paints no readable copy with the disabled ink`, () => {
      const offenders = faintTextRules(SHEETS.get(rel)!)
        .map((r) => r.selector)
        .filter((sel) => !(sel in DISABLED_INK_ALLOWED))
      expect(offenders, `${rel}: promote these to --ink-2`).toEqual([])
    })
  }

  it('keeps the allowlist honest — every exemption is still a real rule', () => {
    const live = new Set(
      [...SHEETS.values()].flatMap((rules) => faintTextRules(rules).map((r) => r.selector)),
    )
    for (const selector of Object.keys(DISABLED_INK_ALLOWED)) {
      expect(live.has(selector), `${selector} is exempted but no longer exists`).toBe(true)
    }
  })
})

describe('text dims by token, never by opacity', () => {
  for (const rel of STYLESHEETS) {
    it(`${rel} fades nothing that a person has to read`, () => {
      const offenders = partialOpacityRules(SHEETS.get(rel)!)
        .map((r) => r.selector)
        .filter((sel) => !(sel in PARTIAL_OPACITY_ALLOWED))
      expect(offenders, `${rel}: use a solid ink token instead`).toEqual([])
    })
  }

  it('keeps that allowlist honest too', () => {
    const live = new Set(
      [...SHEETS.values()].flatMap((rules) => partialOpacityRules(rules).map((r) => r.selector)),
    )
    for (const selector of Object.keys(PARTIAL_OPACITY_ALLOWED)) {
      expect(live.has(selector), `${selector} is exempted but no longer fades`).toBe(true)
    }
  })

  it('leaves animation states alone', () => {
    // `.st-reveal { opacity: 0 }` and the pulse keyframes are motion, not
    // contrast, and the checker has to know the difference.
    const story = SHEETS.get('story/story.css')!
    expect(story.some((r) => r.selector === '.st-reveal' && /opacity:\s*0;/.test(r.body))).toBe(true)
    expect(partialOpacityRules(story).map((r) => r.selector)).not.toContain('.st-reveal')

    const theme = SHEETS.get('theme.css')!
    expect(theme.some((r) => isKeyframeStep(r.selector))).toBe(true)
    expect(partialOpacityRules(theme)).toEqual([])
  })
})

/* ----------------------------------------------------------- self-test --- */

/**
 * The checkers above only prove something if they can fail. These plant known
 * violations and require both to be caught, so a refactor that quietly breaks
 * the regexes turns the whole sweep green for the wrong reason.
 */
describe('the sweep can actually fail', () => {
  const PLANTED = `
    /* a comment mentioning color: var(--ink-3) that must be ignored */
    .planted-note { color: var(--ink-3); font-size: 12px; }
    .planted-ghost { opacity: 0.62; }
    @media (min-width: 900px) {
      .planted-nested { color: var(--ink-3); }
    }
    .planted-fine { color: var(--ink-2); opacity: 1; }
    .planted-hidden { opacity: 0; }
    :root { --ink-3: #a69e8f; }
  `

  const rules = parseRules(PLANTED)

  it('catches faint copy, including inside a media query', () => {
    expect(faintTextRules(rules).map((r) => r.selector).sort()).toEqual([
      '.planted-nested',
      '.planted-note',
    ])
  })

  it('catches a faded node without flagging hidden or solid ones', () => {
    expect(partialOpacityRules(rules).map((r) => r.selector)).toEqual(['.planted-ghost'])
  })

  it('ignores violations that only appear inside comments', () => {
    expect(faintTextRules(rules).map((r) => r.selector)).not.toContain('')
    expect(parseRules(PLANTED).some((r) => r.selector.includes('comment'))).toBe(false)
  })

  it('refuses to pass on a stylesheet it could not really read', () => {
    // Empty, whitespace-only, and "parsed fine but found almost nothing" are
    // the three ways a sweep like this goes green for the wrong reason.
    expect(() => load('stub.css', '')).toThrow(/empty or stubbed/)
    expect(() => load('stub.css', '   \n  \n')).toThrow(/empty or stubbed/)
    expect(() => load('stub.css', `/* ${'x'.repeat(2000)} */\n.a { color: red; }`)).toThrow(
      /the parser is wrong/,
    )
  })
})
