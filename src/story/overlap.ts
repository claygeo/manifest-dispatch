/**
 * Keeping the floating return control off the embedded surfaces.
 *
 * ROUND-1 FIX. At a 390px viewport the story page's floating "back to top"
 * button — fixed at the bottom-right corner — landed directly on top of the
 * right-hand column of the ID-check card inside the phone embed, hiding the
 * Age value and the card expiry. Those are the two fields the section exists to
 * show. A control that obscures the thing it is floating over is worse than no
 * control, and on a 390px screen there is no corner to move it to: the embeds
 * are as wide as the page.
 *
 * So the button yields. While any embedded surface is under it, it fades out;
 * as soon as the reader has scrolled the embed clear, it comes back. The footer
 * carries a second, non-floating "back to top" for the whole way down, so the
 * affordance is never actually absent.
 *
 * The geometry is here, pure and unit-tested, rather than inline in the page:
 * an overlap check is exactly the kind of thing that gets written in a hurry
 * with one comparison reversed and then looks fine in whichever direction it
 * was scrolled during the check.
 */

/** A viewport-relative rectangle. Same field names `DOMRect` uses. */
export interface Box {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Grow a box by `pad` on every side.
 *
 * Used on the button so it does not merely avoid touching an embed but keeps a
 * visible gap from it — a control sitting flush against the bezel of a phone
 * frame still reads as being on the phone.
 */
export function padBox(box: Box, pad: number): Box {
  return {
    top: box.top - pad,
    right: box.right + pad,
    bottom: box.bottom + pad,
    left: box.left - pad,
  }
}

/**
 * Do two rectangles share any area?
 *
 * Edge-touching is NOT an overlap: two boxes whose edges are equal share zero
 * area, and treating that as a collision makes the button flicker as an embed
 * scrolls up to meet it.
 */
export function overlaps(a: Box, b: Box): boolean {
  if (a.right <= b.left || b.right <= a.left) return false
  if (a.bottom <= b.top || b.bottom <= a.top) return false
  return true
}

/** True when `target` is clear of every box in `boxes`. */
export function isClearOf(target: Box, boxes: readonly Box[]): boolean {
  return !boxes.some((box) => overlaps(target, box))
}

/**
 * A zero-area or negative-area rectangle covers nothing and must never hide the
 * button. Elements that are unmounted, display-none or not yet laid out report
 * exactly that, and there are several on this page at any moment.
 */
export function isRealBox(box: Box): boolean {
  return box.right > box.left && box.bottom > box.top
}

/** Gap the control keeps from any embed, in CSS pixels. */
export const EMBED_CLEARANCE = 12

/**
 * The whole decision in one call, so the page has no geometry of its own.
 * Returns true when the control may be shown.
 */
export function controlIsClear(control: Box, embeds: readonly Box[]): boolean {
  if (!isRealBox(control)) return true
  return isClearOf(padBox(control, EMBED_CLEARANCE), embeds.filter(isRealBox))
}
