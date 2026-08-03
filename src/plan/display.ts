/**
 * The planner's minute arithmetic, in one place.
 *
 * The bug this file exists to make impossible: the footer used to render
 * "Yours 47 min · Suggested 35 min · +11 min". 47 − 35 is 12. Nothing was
 * wrong with the routing — the two labels each rounded their own raw seconds to
 * a minute, and the badge rounded the raw DIFFERENCE, so three independently
 * correct roundings produced a line that visibly does not add up. On a screen
 * whose entire argument is "these numbers are measurements, not assertions", a
 * dispatcher who catches the display contradicting itself has no reason to
 * believe the rest of it.
 *
 * The rule, therefore: seconds are rounded to minutes ONCE, and every number on
 * screen is derived from those rounded minutes. The delta is a subtraction of
 * two integers the reader can already see, so it reconciles by construction
 * rather than by luck. The cost is that the badge can be off by up to a minute
 * against the raw seconds — which is the right trade, because a visible
 * contradiction is a credibility failure and a sub-minute rounding is not.
 */

/**
 * Sim-seconds -> the whole number of minutes the planner displays.
 *
 * Floored at one: a run that exists takes time, and "0 min" reads as a bug even
 * when the arithmetic is honest. The floor applies to both figures, so it can
 * never make the delta disagree with the pair.
 */
export function displayMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

/** '38 min'. The planner's only unit. */
export function formatMinutes(minutes: number): string {
  return `${minutes} min`
}

/**
 * The delta badge, from the SAME integers the two figures render.
 * 'same' rather than '+0 min' — zero is a state, not a quantity.
 */
export function formatDeltaMinutes(deltaMinutes: number): string {
  if (deltaMinutes === 0) return 'same'
  return deltaMinutes > 0 ? `+${deltaMinutes} min` : `${deltaMinutes} min`
}

/** Every figure the comparison footer shows, reconciled. */
export interface Comparison {
  yoursMin: number
  suggestedMin: number
  /** `yoursMin - suggestedMin`, always. */
  deltaMin: number
  yoursLabel: string
  suggestedLabel: string
  deltaLabel: string
  /**
   * DESIGN.md: amber is "actionable only". An order that COSTS time is
   * actionable — "Use suggested order" is right there. An order that ties or
   * beats the suggestion is the local knowledge this screen exists to measure,
   * and flagging it would be scolding the dispatcher for winning.
   */
  costsTime: boolean
}

/** Build the whole footer line from raw seconds, once. */
export function compare(yoursS: number, suggestedS: number): Comparison {
  const yoursMin = displayMinutes(yoursS)
  const suggestedMin = displayMinutes(suggestedS)
  const deltaMin = yoursMin - suggestedMin
  return {
    yoursMin,
    suggestedMin,
    deltaMin,
    yoursLabel: formatMinutes(yoursMin),
    suggestedLabel: formatMinutes(suggestedMin),
    deltaLabel: formatDeltaMinutes(deltaMin),
    costsTime: deltaMin > 0,
  }
}
