/**
 * ID verification — full screen, mandatory.
 *
 * SPEC: "ID verify = full-screen check screen (name + DOB confirm + 21+ big
 * yes/no) — no camera (cut by decision)." Compliance surface: "ID verification
 * is a mandatory state between arrived and closed — the driver cannot close a
 * stop without it (the app enforces the law's shape)."
 *
 * So this is a screen, not a modal: there is no dismiss affordance, only a
 * verdict. The store enforces the same rule underneath — `closeStop` refuses a
 * stop whose `idChecked` is false — which means the law's shape survives even
 * if someone drives the store directly.
 */

import { identityFor } from './identity'
import type { Stop } from '../types'

export interface IdCheckScreenProps {
  stop: Stop
  onPass: () => void
  onFail: () => void
}

export function IdCheckScreen({ stop, onPass, onFail }: IdCheckScreenProps) {
  const id = identityFor(stop)

  return (
    <>
      <div className="dv-body">
        <div className="dv-screen">
          <section className="dv-block">
            <div className="plate">
              <span>ID check — required</span>
              <span className="plate-id">{stop.orderCode}</span>
            </div>

            <div className="dv-block-body">
              <div className="dv-field">
                <span className="label">Name on ID</span>
                <span className="dv-name">{stop.customer}</span>
              </div>

              <div className="dv-tear" />

              <div className="dv-due">
                <div className="dv-field">
                  <span className="label">Date of birth</span>
                  <span className="dv-value-mono">{id.dob}</span>
                </div>
                {/* the ONE display numeral on this panel */}
                <div style={{ textAlign: 'right' }}>
                  <div className="label">Age</div>
                  <div className="numeral numeral--sm">{id.age}</div>
                </div>
              </div>

              <div className="dv-tear" />

              <div className="dv-row">
                <div className="dv-field">
                  <span className="label">MMU registry</span>
                  <span className="dv-value-mono">{id.registryId}</span>
                </div>
                <div className="dv-field" style={{ textAlign: 'right' }}>
                  <span className="label">Expires</span>
                  <span className="dv-value-mono">{id.cardExpiry}</span>
                </div>
              </div>

              <div className="dv-row">
                <div className="dv-field">
                  <span className="label">Photo ID</span>
                  <span className="dv-value-mono">{`${id.idState} driver license`}</span>
                </div>
                <span className="chip chip--quiet">No camera</span>
              </div>
            </div>
          </section>

          <p className="dv-note">
            Compare the card in your hand to the record above. This stop cannot be
            closed until you answer. Fictional record — demo data.
          </p>
        </div>
      </div>

      <footer className="dv-foot">
        <div className="dv-verdict">
          <button type="button" className="btn btn--primary btn--driver dv-yes" onClick={onPass}>
            21+ confirmed — matches
            <span className="dv-slab-hint">ID verified, proceed to payment</span>
          </button>
          <button type="button" className="btn btn--amber btn--driver dv-no" onClick={onFail}>
            Cannot verify
          </button>
        </div>
      </footer>
    </>
  )
}

export default IdCheckScreen
