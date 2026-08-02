/**
 * NEXT LEG — the driver app's mini-map.
 *
 * SPEC: "Mini-map strip shows next leg only." DESIGN: "The map is the mini
 * element here — inverted from the console."
 *
 * This draws the real OSRM road geometry of the current leg and nothing else:
 * where the van is, the road it is on, and the door it is heading to. It is not
 * a MapLibre instance — see the note in the report. Two reasons it is better
 * here than a basemap: a second GL context on a phone is the single most
 * expensive thing the driver route could do (and the driver route otherwise
 * never touches MapLibre at all), and a basemap cannot show "next leg only"
 * without a camera that is already framed on the whole run.
 *
 * The travelled overlay and the van glide between the store's 5 Hz publishes
 * via CSS transitions — metabolic motion, same as the console's lerp.
 */

import { useMemo } from 'react'
import { legsFor } from '../data/seed'
import { boundsOf, pointOnLeg, type LngLat } from '../sim/geo'
import type { Stop } from '../types'

const VB_W = 360
const VB_H = 128
const PAD = 20

export interface LegStripProps {
  runId: string
  legIndex: number
  progress: number
  /** null on the final leg — the run home to the depot. */
  stop: Stop | null
  /** Shown bottom-right in mono. */
  etaMin?: number | null
  label: string
  /**
   * Horizontal accuracy of the current live fix, metres. null in demo mode and
   * whenever the position is simulated — an accuracy ring around a number we
   * made up would be a lie with a radius.
   */
  accuracyM?: number | null
}

interface Projected {
  d: string
  origin: [number, number]
  destination: [number, number]
  distanceM: number
  toXY: (p: LngLat) => [number, number]
  /** viewBox units per metre — lets the accuracy ring be drawn to scale. */
  unitsPerMetre: number
}

function projectLeg(runId: string, legIndex: number): Projected | null {
  const leg = legsFor(runId)[legIndex]
  if (!leg || leg.coords.length < 2) return null

  const bb = boundsOf(leg.coords)
  if (!bb) return null

  const [w, s, e, n] = bb
  const kx = Math.cos((((s + n) / 2) * Math.PI) / 180)
  const spanX = Math.max((e - w) * kx, 1e-9)
  const spanY = Math.max(n - s, 1e-9)
  const scale = Math.min((VB_W - PAD * 2) / spanX, (VB_H - PAD * 2) / spanY)
  const offX = (VB_W - spanX * scale) / 2
  const offY = (VB_H - spanY * scale) / 2

  const toXY = (p: LngLat): [number, number] => [
    offX + (p[0] - w) * kx * scale,
    VB_H - (offY + (p[1] - s) * scale),
  ]

  let d = ''
  for (let i = 0; i < leg.coords.length; i++) {
    const [x, y] = toXY(leg.coords[i])
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }

  return {
    d,
    origin: toXY(leg.coords[0]),
    destination: toXY(leg.coords[leg.coords.length - 1]),
    distanceM: leg.distance_m,
    toXY,
    // `scale` is viewBox units per degree of latitude; ~111.32 km to the degree.
    unitsPerMetre: scale / 111_320,
  }
}

function formatDistance(metres: number): string {
  if (metres < 25) return 'At stop'
  const miles = metres / 1609.344
  if (miles < 0.1) return `${Math.round(metres / 0.3048 / 50) * 50} ft`
  return `${miles.toFixed(1)} mi`
}

export function LegStrip({
  runId,
  legIndex,
  progress,
  stop,
  etaMin,
  label,
  accuracyM = null,
}: LegStripProps) {
  const geo = useMemo(() => projectLeg(runId, legIndex), [runId, legIndex])
  const van = useMemo(() => {
    const leg = legsFor(runId)[legIndex]
    if (!leg || !geo) return null
    const point = pointOnLeg(leg, progress)
    const [x, y] = geo.toXY(point.position)
    return { x, y, heading: point.heading }
    // geo already keys on runId+legIndex; progress is the only live input
  }, [geo, runId, legIndex, progress])

  const clamped = Math.max(0, Math.min(1, progress))

  // Drawn to the leg's own scale, then floored so a 5 m fix is still visible
  // and capped so a 2 km fix does not swallow the whole strip.
  const accuracyRadius =
    geo && accuracyM !== null && accuracyM > 0
      ? Math.max(4, Math.min(52, accuracyM * geo.unitsPerMetre))
      : null

  return (
    <section className="dv-leg">
      <div className="plate">
        <span>Next leg</span>
        <span className="plate-id">{label}</span>
      </div>

      {geo && van ? (
        <div className="dv-leg-canvas">
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {/* instrument frame: corner ticks, never a full box */}
            <g stroke="var(--border-strong)" strokeWidth="1" fill="none">
              <path d="M8 18 L8 8 L18 8" />
              <path d={`M${VB_W - 18} 8 L${VB_W - 8} 8 L${VB_W - 8} 18`} />
              <path d={`M8 ${VB_H - 18} L8 ${VB_H - 8} L18 ${VB_H - 8}`} />
              <path d={`M${VB_W - 18} ${VB_H - 8} L${VB_W - 8} ${VB_H - 8} L${VB_W - 8} ${VB_H - 18}`} />
            </g>

            {/* road ahead */}
            <path
              d={geo.d}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* road already covered — dims back into the field, never a new colour */}
            <path
              className="dv-leg-travelled"
              d={geo.d}
              fill="none"
              stroke="var(--done)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={`${clamped} 1`}
            />

            {/* leg start */}
            <circle
              cx={geo.origin[0]}
              cy={geo.origin[1]}
              r="3"
              fill="var(--field-deep)"
              stroke="var(--done)"
              strokeWidth="1.5"
            />

            {/* the door */}
            <g transform={`translate(${geo.destination[0]} ${geo.destination[1]})`}>
              <rect
                x="-5"
                y="-5"
                width="10"
                height="10"
                fill="var(--field-deep)"
                stroke="var(--accent)"
                strokeWidth="2"
              />
              <rect x="-1.5" y="-1.5" width="3" height="3" fill="var(--accent)" />
            </g>

            {/* accuracy ring — how well the phone actually knows where it is */}
            {accuracyRadius !== null ? (
              <circle
                className="dv-leg-marker"
                r={accuracyRadius}
                fill="var(--accent)"
                fillOpacity="0.1"
                stroke="var(--accent)"
                strokeOpacity="0.4"
                strokeWidth="1"
                style={{
                  transformBox: 'view-box',
                  transformOrigin: '0 0',
                  transform: `translate(${van.x}px, ${van.y}px)`,
                }}
              />
            ) : null}

            {/* the van */}
            <g
              className="dv-leg-marker"
              style={{
                transformBox: 'view-box',
                transformOrigin: '0 0',
                transform: `translate(${van.x}px, ${van.y}px) rotate(${van.heading}deg)`,
              }}
            >
              <path
                d="M0 -8 L6 8 L0 4.5 L-6 8 Z"
                fill="var(--accent)"
                stroke="var(--field-deep)"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </g>
          </svg>

          <div className="dv-leg-read">
            <span className="chip chip--quiet">
              {formatDistance(geo.distanceM * (1 - clamped))}
            </span>
            <span className="chip chip--accent">
              {etaMin === null || etaMin === undefined ? 'ETA —' : `ETA ${etaMin} min`}
            </span>
          </div>
        </div>
      ) : (
        <div className="dv-leg-empty micro micro--dim">No leg geometry</div>
      )}

      <div className="dv-tick dv-tick--done" style={{ borderBottom: 'none' }}>
        <i />
        <span>
          {stop ? (
            <>
              {'To '}
              <span className="micro--mono">{stop.orderCode}</span>
            </>
          ) : (
            'Return to depot'
          )}
        </span>
      </div>
    </section>
  )
}

export default LegStrip
