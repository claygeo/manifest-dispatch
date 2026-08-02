/**
 * Small shared controls every surface needs. Deliberately tiny — the real
 * component vocabulary lives in theme.css as classes (.plate, .glass,
 * .ticket, .chip, .numeral, .micro, .btn), so surfaces stay consistent
 * without importing a component library.
 *
 * v2 register: sentence case everywhere. The honesty labels say exactly what
 * they said before — only the shouting is gone.
 */

import { useStore } from '../store'

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

export function ThemeToggle() {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  return (
    <button
      type="button"
      className="btn"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
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
