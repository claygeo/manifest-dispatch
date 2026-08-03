/**
 * Per-surface browser tab titles.
 *
 * Every surface used to inherit index.html's `Manifest — delivery dispatch`, so
 * a dispatcher with the console, a driver phone view and a tracking link open in
 * three tabs got three identical tab labels and had to click through to find the
 * one they wanted. The tracking page and the printable manifest already named
 * themselves after their subject; this hook is the shared mechanism, and the
 * four routes now agree on one format: `<subject> — Manifest`.
 *
 * Two details that are easy to get wrong:
 *
 *  - Restore on unmount. A single-page app that leaves a stale title behind
 *    means walking from `/t/ABC` back to `/dispatch` keeps advertising someone
 *    else's order number.
 *  - Do NOT restore over a title somebody else has since set. The story page
 *    embeds the tracking and manifest surfaces as figures and holds its own
 *    title over them (`useHeldTitle` in StoryPage). If those embedded pages
 *    blindly wrote their captured `previous` value back on unmount, they would
 *    stomp the holder after its MutationObserver had already gone away.
 */

import { useEffect } from 'react'

/**
 * index.html's title, captured before any surface has had a chance to change
 * it. This is what "the default" means — not whatever happened to be in the tab
 * when a given component mounted.
 */
const INDEX_HTML_TITLE = 'Manifest — delivery dispatch'

export const DEFAULT_DOC_TITLE =
  typeof document === 'undefined' ? INDEX_HTML_TITLE : document.title || INDEX_HTML_TITLE

/** `<subject> — Manifest`, the one tab-title format the app uses. */
export function docTitle(subject: string, fallback: string = DEFAULT_DOC_TITLE): string {
  const trimmed = subject.trim()
  return trimmed ? `${trimmed} — Manifest` : fallback
}

/**
 * What a surface should put back when it unmounts, or `null` for "leave it".
 *
 * Split out from the hook so the one rule with a sharp edge on it is testable
 * without a DOM: a surface only gives back what it took. If the title moved on
 * while it was mounted, whoever moved it owns the tab now and outranks the
 * restore — which is what keeps an embedded tracking figure from stomping the
 * story page's held title on its way out.
 */
export function titleToRestore(
  current: string,
  ours: string,
  previous: string,
  fallback: string = DEFAULT_DOC_TITLE,
): string | null {
  if (current !== ours) return null
  const back = previous || fallback
  return back === current ? null : back
}

export function useDocTitle(title: string): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const previous = document.title
    document.title = title
    return () => {
      const back = titleToRestore(document.title, title, previous)
      if (back !== null) document.title = back
    }
  }, [title])
}

export default useDocTitle
