/**
 * LIVE entry — session-code modal.
 *
 * SPEC.md "Live mode": "Console: enter/generate session code → creates
 * `session:<code>` broadcast channel. Phone `/driver?live=<code>` publishes GPS
 * over the channel."
 *
 * This dialog owns the console half of that handshake and hands the code to
 * `onEnterLive`. It never claims a connection it does not have: until a real
 * transport reports back, the armed state reads "Waiting for driver phone", and
 * the honesty rail keeps saying "Demo fleet" because the sim is still what is
 * on the map.
 */

import { useEffect, useRef, useState } from 'react'
import type { LiveStatus } from '../store'
import {
  CLOSED_SLOT,
  editCodeSlot,
  regenerateCodeSlot,
  seedCodeSlot,
} from '../live/codeSlot'
import {
  driverJoinUrl,
  generateSessionCode,
  isValidSessionCode,
  LIVE_CODE_LENGTH,
  normalizeSessionCode,
} from './liveSession'
import { Cross } from './icons'

export interface LiveEntryModalProps {
  open: boolean
  /** Code already armed on the console, if any. */
  armedCode: string | null
  liveStatus: LiveStatus
  onClose: () => void
  onEnter: (code: string) => void
  onDisarm: () => void
}

const STATUS_LINE: Record<LiveStatus, string> = {
  off: 'No session armed',
  connecting: 'Waiting for driver phone',
  connected: 'Driver publishing GPS',
  degraded: 'Transport unreachable — demo data still shown',
}

/** Sentence-case mirror of the store's status enum, for the status pill. */
const STATUS_CHIP: Record<LiveStatus, string> = {
  off: 'Off',
  connecting: 'Connecting',
  connected: 'Connected',
  degraded: 'Degraded',
}

export function LiveEntryModal({
  open,
  armedCode,
  liveStatus,
  onClose,
  onEnter,
  onDisarm,
}: LiveEntryModalProps) {
  const [slot, setSlot] = useState(CLOSED_SLOT)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  /**
   * The parent re-creates `onClose` on every render and the console re-renders
   * on every sim tick, so it must never reach a dependency list. Held in a ref
   * instead: the Escape listener is installed once per opening and always calls
   * the current handler.
   */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  /**
   * A 16-character credential is generated, not typed. Opening the dialog with
   * one already drawn means the dispatcher's job is "copy the link", and the
   * input stays there for the other half of the story — joining a session a
   * phone already started.
   *
   * Drawn ONCE per opening. `seedCodeSlot` returns the previous slot by identity
   * when the session has not changed, so the code survives every re-render the
   * store pushes through the console underneath this dialog — and survives the
   * dispatcher typing into it, which the render-time draw did not.
   */
  useEffect(() => {
    setSlot((prev) => seedCodeSlot(prev, open, armedCode, generateSessionCode))
    if (!open) return
    setCopied(false)
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open, armedCode])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const code = slot.code
  const armed = Boolean(armedCode) && liveStatus !== 'off'
  const valid = isValidSessionCode(code)
  const joinUrl = armedCode ? driverJoinUrl(armedCode) : ''

  const submit = () => {
    if (!valid) return
    onEnter(code)
  }

  const copyJoinUrl = () => {
    if (!joinUrl) return
    void navigator.clipboard
      ?.writeText(joinUrl)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  return (
    <div
      className="dc-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="panel dc-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Enter live session"
      >
        <div className="plate">
          <span>Live session</span>
          <button
            type="button"
            className="dc-plate-btn"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <Cross size={11} />
          </button>
        </div>

        <div className="dc-modal__body">
          <p className="micro micro--dim" style={{ margin: 0 }}>
            A session code pairs this console with a driver phone over a private
            channel. Anyone without the code sees the demo fleet and nothing else.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <input
              ref={inputRef}
              className="dc-code-input"
              value={code}
              onChange={(e) => {
                const next = normalizeSessionCode(e.target.value)
                setSlot((prev) => editCodeSlot(prev, next))
              }}
              placeholder={'•'.repeat(LIVE_CODE_LENGTH)}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              aria-label="Session code"
              disabled={armed}
            />
          </form>

          <div className="dc-modal__row">
            <button
              type="button"
              className="btn"
              onClick={() => setSlot((prev) => regenerateCodeSlot(prev, generateSessionCode))}
              disabled={armed}
            >
              Generate
            </button>
            {armed ? (
              <button type="button" className="btn" onClick={onDisarm}>
                Disarm
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={submit} disabled={!valid}>
                Arm session
              </button>
            )}
          </div>

          <div className="rule" />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className={
                liveStatus === 'degraded'
                  ? 'chip chip--amber'
                  : liveStatus === 'connected'
                    ? 'chip chip--accent'
                    : 'chip chip--quiet'
              }
            >
              {STATUS_CHIP[liveStatus]}
            </span>
            <span className="micro micro--dim">{STATUS_LINE[liveStatus]}</span>
          </div>

          {armed && joinUrl ? (
            <>
              <div className="dc-joinlink">
                <span className="micro micro--mono">{joinUrl}</span>
                <button type="button" className="btn dc-btn-xs" onClick={copyJoinUrl}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="micro micro--dim" style={{ margin: 0 }}>
                Open this on the driver phone. It publishes GPS over the session; this
                console and any <span className="micro--mono">/t/</span> tracking link
                render it through the same store the simulation uses.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default LiveEntryModal
