/**
 * LIVE entry — session-code modal.
 *
 * SPEC.md "Live mode": "Console: enter/generate session code → creates
 * `session:<code>` broadcast channel. Phone `/driver?live=<code>` publishes GPS
 * over the channel."
 *
 * This dialog owns the console half of that handshake and hands the code to
 * `onEnterLive`. It never claims a connection it does not have: until a real
 * transport reports back, the armed state reads WAITING FOR DRIVER, and the
 * honesty rail keeps saying DEMO FLEET because the sim is still what is on the
 * map.
 */

import { useEffect, useRef, useState } from 'react'
import type { LiveStatus } from '../store'
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
  off: 'NO SESSION ARMED',
  connecting: 'WAITING FOR DRIVER PHONE',
  connected: 'DRIVER PUBLISHING GPS',
  degraded: 'TRANSPORT UNREACHABLE — DEMO DATA STILL SHOWN',
}

export function LiveEntryModal({
  open,
  armedCode,
  liveStatus,
  onClose,
  onEnter,
  onDisarm,
}: LiveEntryModalProps) {
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setCopied(false)
    // A 16-character credential is generated, not typed. Opening the dialog with
    // one already drawn means the dispatcher's job is "copy the link", and the
    // input stays there for the other half of the story — joining a session a
    // phone already started.
    setCode(armedCode ?? generateSessionCode())
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, armedCode, onClose])

  if (!open) return null

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
          <span>LIVE SESSION</span>
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
              onChange={(e) => setCode(normalizeSessionCode(e.target.value))}
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
              onClick={() => setCode(generateSessionCode())}
              disabled={armed}
            >
              GENERATE
            </button>
            {armed ? (
              <button type="button" className="btn" onClick={onDisarm}>
                DISARM
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={submit} disabled={!valid}>
                ARM SESSION
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
              {liveStatus.toUpperCase()}
            </span>
            <span className="micro micro--dim">{STATUS_LINE[liveStatus]}</span>
          </div>

          {armed && joinUrl ? (
            <>
              <div className="dc-joinlink">
                <span className="micro micro--mono">{joinUrl}</span>
                <button type="button" className="btn dc-btn-xs" onClick={copyJoinUrl}>
                  {copied ? 'COPIED' : 'COPY'}
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
