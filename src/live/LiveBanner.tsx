/**
 * The honest failure state.
 *
 * SPEC.md: "If Supabase is unreachable, live mode degrades with an honest amber
 * banner; demo mode never touches the network." DESIGN.md reserves amber for
 * "things a dispatcher must act on" and explicitly lists "connectivity loss" —
 * so this is one of exactly three places in the product allowed to use it.
 *
 * It says two things, and the second one is the point: the transport is down,
 * AND how much of the shift is still sitting in the local outbox waiting to be
 * written (see ./queue.ts). "N events queued" is the difference between an
 * outage you can reason about and one you have to trust.
 *
 * What it does NOT do: hide, retry silently, or pretend. The local sim keeps
 * running underneath and the banner says so in the same breath, because the
 * label is part of the credibility story rather than a disclaimer.
 */

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import './live.css'

export interface LiveBannerProps {
  /** `float` pins it over a map; `inline` lets it sit in a column. */
  placement?: 'float' | 'inline'
}

export function LiveBanner({ placement = 'float' }: LiveBannerProps) {
  const liveStatus = useStore((s) => s.liveStatus)
  const queued = useStore((s) => s.liveQueued)
  const [dismissed, setDismissed] = useState(false)

  const degraded = liveStatus === 'degraded'
  // A queue that is still draining after the socket came back is not a failure,
  // but it is unfinished business — the banner stays until the outbox is empty.
  const holding = queued > 0 && liveStatus !== 'off'
  const showing = degraded || holding

  // A fresh failure always speaks up again, even if the last one was dismissed,
  // and so does a fresh backlog.
  useEffect(() => {
    if (!showing) setDismissed(false)
  }, [showing])
  useEffect(() => {
    if (degraded) setDismissed(false)
  }, [degraded])

  if (!showing || dismissed) return null

  const tag = degraded ? 'Live unavailable' : 'Syncing'
  const backlog = queued > 0 ? `${queued} event${queued === 1 ? '' : 's'} queued` : null
  const text = degraded
    ? ['Demo continues locally', backlog].filter(Boolean).join(' · ')
    : `${backlog} — no data lost`

  return (
    <div className={`lv-banner lv-banner--${placement}`} role="status" aria-live="polite">
      <span className="plate plate--amber lv-banner__tag">{tag}</span>
      <span className="lv-banner__text">{text}</span>
      <button
        type="button"
        className="lv-banner__close"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        title="Dismiss"
      >
        &times;
      </button>
    </div>
  )
}

export default LiveBanner
