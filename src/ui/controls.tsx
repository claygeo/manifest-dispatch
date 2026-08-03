/**
 * Small shared controls every surface needs. Deliberately tiny — the real
 * component vocabulary lives in theme.css as classes (.plate, .glass,
 * .ticket, .chip, .numeral, .micro, .btn), so surfaces stay consistent
 * without importing a component library.
 *
 * v2 register: sentence case everywhere. The honesty labels say exactly what
 * they said before — only the shouting is gone.
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { acceptClick, THEME_SWAP_COOLDOWN_MS } from './toggleGuard'

/** Honesty rail (DESIGN.md): demo state is labelled, always visible. */
export function DemoChip({ label }: { label?: string }) {
  const mode = useStore((s) => s.mode)
  const liveStatus = useStore((s) => s.liveStatus)
  if (mode === 'live') {
    return (
      <span className={liveStatus === 'degraded' ? 'chip chip--amber' : 'chip chip--accent'}>
        {liveStatus === 'degraded' ? 'Live — degraded' : 'Live session'}
      </span>
    )
  }
  return <span className="chip chip--accent">{label ?? 'Demo fleet'}</span>
}

/**
 * Theme toggle.
 *
 * A flip re-styles the map, which means `maplibre.setStyle` and a 0.6–1.8s
 * main-thread rebuild. Clicks arrive far faster than that, and an ungated
 * handler queued them: mashing the control bought one rebuild per click and a
 * UI that stopped answering for seconds at a time. So the control accepts the
 * leading edge and ignores the rest until the swap it started has had time to
 * land — the rebuild itself is not made faster, because it cannot be.
 *
 * The button stays enabled while it is busy rather than going `disabled`: a
 * control that vanishes from the tab order under your finger is worse than one
 * that visibly does not answer yet. It dims and reports `aria-busy` instead.
 */
export function ThemeToggle() {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const lastAcceptedRef = useRef(0)
  const [swapping, setSwapping] = useState(false)

  useEffect(() => {
    if (!swapping) return
    const id = window.setTimeout(() => setSwapping(false), THEME_SWAP_COOLDOWN_MS)
    return () => window.clearTimeout(id)
  }, [swapping])

  const onClick = () => {
    const now = Date.now()
    if (!acceptClick(lastAcceptedRef.current, now)) return
    lastAcceptedRef.current = now
    setSwapping(true)
    toggleTheme()
  }

  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="btn"
      onClick={onClick}
      aria-busy={swapping}
      aria-label={`Switch to ${next} theme`}
      title={swapping ? 'Restyling the map…' : `Switch to ${next} theme`}
      style={swapping ? { opacity: 0.55, cursor: 'progress' } : undefined}
    >
      {theme === 'dark' ? 'Night' : 'Paper'}
    </button>
  )
}

/**
 * Product wordmark — a filled fern block in the UI grotesk, never a logo image.
 * DESIGN v2 keeps the wordmark in Familjen rather than the display serif.
 */
export function Wordmark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="wordmark">
      <span>Manifest</span>
      {subtitle ? <span className="wordmark__sub">{subtitle}</span> : null}
    </div>
  )
}
