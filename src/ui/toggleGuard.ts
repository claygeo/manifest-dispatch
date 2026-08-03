/**
 * Rate guard for controls whose handler is expensive and not cancellable.
 *
 * Written for exactly one of those: the theme toggle. A flip calls
 * `map.setStyle`, and maplibre's style rebuild holds the main thread for
 * 0.6–1.8s while it re-parses the basemap, re-uploads the tiles and re-installs
 * our overlays. That is not a bug to be optimised away here — a style swap is a
 * style swap. The bug is that a control which accepts a click every 80ms while
 * each click costs a second QUEUES those seconds: eight rapid clicks bought
 * eight sequential rebuilds and a UI that stopped answering for ten seconds.
 *
 * A debounce would be wrong — it delays the first flip, and the first flip is
 * the one the user asked for. This accepts the leading edge and drops
 * everything in the shadow of the work it just started.
 */

/**
 * How long a maplibre `setStyle` rebuild is assumed to own the main thread.
 *
 * Sits above the measured 0.6–1.8s range on purpose: undershooting re-opens the
 * queueing bug on a slow machine, overshooting only means a determined user
 * waits a beat before flipping back — and the theme they asked for is already
 * on screen by then.
 */
export const THEME_SWAP_COOLDOWN_MS = 2_000

/**
 * Should this click be acted on?
 *
 * @param lastAcceptedMs when the last accepted click was taken; 0 for "never"
 * @param nowMs          now, from the same clock
 */
export function acceptClick(
  lastAcceptedMs: number,
  nowMs: number,
  cooldownMs: number = THEME_SWAP_COOLDOWN_MS,
): boolean {
  // Never fired: always accept, whatever the clock says.
  if (lastAcceptedMs <= 0) return true
  const elapsed = nowMs - lastAcceptedMs
  // A clock that went backwards (tab restored from bfcache, a caller passing
  // wall time across a system adjustment) must not wedge the control shut.
  if (elapsed < 0) return true
  return elapsed >= cooldownMs
}
