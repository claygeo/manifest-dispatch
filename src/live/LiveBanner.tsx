/**
 * The honest failure state.
 *
 * SPEC.md: "If Supabase is unreachable, live mode degrades with an honest amber
 * banner; demo mode never touches the network." DESIGN.md reserves amber for
 * "things a dispatcher must act on" and explicitly lists "connectivity loss" —
 * so this is one of exactly three places in the product allowed to use it.
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
  const [dismissed, setDismissed] = useState(false)

  // A fresh failure always speaks up again, even if the last one was dismissed.
  useEffect(() => {
    if (liveStatus !== 'degraded') setDismissed(false)
  }, [liveStatus])

  if (liveStatus !== 'degraded' || dismissed) return null

  return (
    <div className={`lv-banner lv-banner--${placement}`} role="status" aria-live="polite">
      <span className="plate plate--amber lv-banner__tag">LIVE UNAVAILABLE</span>
      <span className="lv-banner__text">DEMO CONTINUES LOCALLY</span>
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
