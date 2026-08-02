/**
 * Small shared controls every surface needs. Deliberately tiny — the real
 * component vocabulary lives in theme.css as classes (.plate, .glass,
 * .ticket, .chip, .numeral, .micro, .btn), so surfaces stay consistent
 * without importing a component library.
 */

import { useStore } from '../store'

/** Honesty rail (DESIGN.md): demo state is labelled, always visible. */
export function DemoChip({ label }: { label?: string }) {
  const mode = useStore((s) => s.mode)
  const liveStatus = useStore((s) => s.liveStatus)
  if (mode === 'live') {
    return (
      <span className={liveStatus === 'degraded' ? 'chip chip--amber' : 'chip chip--accent'}>
        {liveStatus === 'degraded' ? 'LIVE — DEGRADED' : 'LIVE SESSION'}
      </span>
    )
  }
  return <span className="chip chip--accent">{label ?? 'DEMO FLEET'}</span>
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
      {theme === 'dark' ? 'NIGHT' : 'PAPER'}
    </button>
  )
}

/** Product wordmark, rendered as a plate — never as a logo image. */
export function Wordmark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="plate plate--accent" style={{ gap: 10 }}>
      <span>MANIFEST</span>
      {subtitle ? <span style={{ opacity: 0.72 }}>{subtitle}</span> : null}
    </div>
  )
}
