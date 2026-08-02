/**
 * Payment closeout — states only.
 *
 * SPEC: "CLOSE (payment method select: cash keypad-style confirm / debit
 * 'reader linked' state / digital)" and, twice over, "No real payments. Payment
 * closeout = states only (CASH / DEBIT / DIGITAL)."
 *
 * Nothing here touches a network, a card, or a wallet. The cash path is a real
 * tender/change calculation because that is the part a driver actually does in
 * their head at the door; the debit and digital paths are honest state ladders
 * with a SIMULATED banner, because faking an approval screen without saying so
 * is exactly the kind of thing this demo refuses to do.
 */

import { useEffect, useMemo, useState } from 'react'
import { formatMoney, PAYMENT_TEXT } from '../format'
import type { PaymentMethod, Stop } from '../types'

const METHODS: PaymentMethod[] = ['cash', 'debit', 'digital']

/** Reader / link ladders. The last entry is the one that unlocks the slab. */
const DEBIT_STEPS = ['Linking reader', 'Reader linked', 'Card presented', 'Approved — simulated']
const DIGITAL_STEPS = ['Request sent', 'Customer notified', 'Confirmed — simulated']
const STEP_MS = 750

export interface PaymentScreenProps {
  stop: Stop
  onConfirm: (method: PaymentMethod) => void
  onBack: () => void
}

export function PaymentScreen({ stop, onConfirm, onBack }: PaymentScreenProps) {
  const [method, setMethod] = useState<PaymentMethod>(stop.payment)
  const [tenderCents, setTenderCents] = useState(0)
  const [step, setStep] = useState(0)

  const dueCents = Math.round(stop.amountDue * 100)
  const ladder = method === 'debit' ? DEBIT_STEPS : method === 'digital' ? DIGITAL_STEPS : []

  /* Non-cash methods walk their ladder on a timer, then hand the slab over. */
  useEffect(() => {
    setStep(0)
    if (method === 'cash') return
    const steps = method === 'debit' ? DEBIT_STEPS.length : DIGITAL_STEPS.length
    let i = 0
    const timer = window.setInterval(() => {
      i += 1
      setStep(i)
      if (i >= steps - 1) window.clearInterval(timer)
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [method])

  const quickTenders = useMemo(() => {
    const out = [dueCents]
    for (const note of [2000, 5000, 10000, 20000]) {
      const up = Math.ceil(dueCents / note) * note
      if (up > dueCents && !out.includes(up)) out.push(up)
    }
    return out.slice(0, 4)
  }, [dueCents])

  const changeCents = tenderCents - dueCents
  const cashReady = method === 'cash' && tenderCents >= dueCents
  const ladderReady = method !== 'cash' && step >= ladder.length - 1
  const ready = cashReady || ladderReady

  function press(digit: string) {
    if (digit === 'CLR') {
      setTenderCents(0)
      return
    }
    if (digit === 'DEL') {
      setTenderCents((c) => Math.floor(c / 10))
      return
    }
    setTenderCents((c) => Math.min(9_999_99, c * 10 + Number(digit)))
  }

  return (
    <>
      <div className="dv-body">
        <div className="dv-screen">
          <section className="dv-block">
            <div className="plate">
              <span>Close out</span>
              <span className="plate-id">{stop.orderCode}</span>
            </div>

            <div className="dv-block-body">
              <div className="dv-due">
                <div className="dv-field">
                  <span className="label">Amount due</span>
                  {/* the ONE display numeral on this panel */}
                  <span className="numeral">{formatMoney(stop.amountDue)}</span>
                </div>
                <span className="chip chip--quiet">{stop.customer}</span>
              </div>
            </div>

            <div className="dv-tear" />
            <div className="dv-methods">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`dv-method${m === method ? ' dv-method--on' : ''}`}
                  onClick={() => setMethod(m)}
                  aria-pressed={m === method}
                >
                  {PAYMENT_TEXT[m]}
                </button>
              ))}
            </div>
          </section>

          {method === 'cash' ? (
            <section className="dv-block">
              <div className="plate">
                <span>Cash tendered</span>
                <span className="plate-id">
                  {changeCents >= 0 ? `Change ${formatMoney(changeCents / 100)}` : 'Short'}
                </span>
              </div>

              <div className="dv-block-body" style={{ paddingBottom: 0 }}>
                <div className="dv-due">
                  <div className="dv-field">
                    <span className="label">Tender</span>
                    {/* the ONE display numeral on this panel */}
                    <span
                      className={`numeral${tenderCents >= dueCents ? ' numeral--accent' : ''}`}
                    >
                      {formatMoney(tenderCents / 100)}
                    </span>
                  </div>
                  <span className="micro micro--dim">
                    {tenderCents >= dueCents
                      ? `Change due ${formatMoney(changeCents / 100)}`
                      : `Short ${formatMoney((dueCents - tenderCents) / 100)}`}
                  </span>
                </div>
              </div>

              <div className="dv-tenders" style={{ paddingTop: 12 }}>
                {quickTenders.map((cents, i) => (
                  <button
                    key={cents}
                    type="button"
                    className="dv-tender"
                    onClick={() => setTenderCents(cents)}
                  >
                    {i === 0 ? 'Exact' : formatMoney(cents / 100)}
                  </button>
                ))}
              </div>

              <div className="dv-pad" style={{ paddingTop: 0 }}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
                  <button key={k} type="button" className="dv-key" onClick={() => press(k)}>
                    {k}
                  </button>
                ))}
                <button type="button" className="dv-key dv-key--fn" onClick={() => press('CLR')}>
                  Clear
                </button>
                <button type="button" className="dv-key" onClick={() => press('0')}>
                  0
                </button>
                <button
                  type="button"
                  className="dv-key dv-key--fn"
                  onClick={() => press('DEL')}
                  aria-label="Delete last digit"
                >
                  Delete
                </button>
              </div>
            </section>
          ) : (
            <section className="dv-block">
              <div className="plate">
                <span>{method === 'debit' ? 'Card reader' : 'Digital request'}</span>
                <span className="plate-id">{`REF ${stop.orderCode.replace('MFST-', '')}`}</span>
              </div>
              <div className="dv-steps">
                {ladder.map((name, i) => (
                  <div
                    key={name}
                    className={`dv-tick${
                      i < step ? ' dv-tick--done' : i === step ? ' dv-tick--now' : ''
                    }`}
                  >
                    <i />
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="dv-note">
            Simulated closeout. No card is read, no funds move, nothing leaves this
            browser. The stop records the method only.
          </p>
        </div>
      </div>

      <footer className="dv-foot">
        <button
          type="button"
          className="btn btn--primary btn--driver dv-slab"
          disabled={!ready}
          onClick={() => onConfirm(method)}
        >
          {`Close — ${PAYMENT_TEXT[method]} ${formatMoney(stop.amountDue)}`}
          <span className="dv-slab-hint">
            {method === 'cash'
              ? cashReady
                ? `Change ${formatMoney(changeCents / 100)}`
                : 'Enter tender to continue'
              : ladderReady
                ? 'Ready'
                : (ladder[step] ?? '')}
          </span>
        </button>
        <button type="button" className="dv-quiet" onClick={onBack}>
          Back to ticket
        </button>
      </footer>
    </>
  )
}

export default PaymentScreen
