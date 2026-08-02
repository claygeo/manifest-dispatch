/**
 * routes.json integrity + fleet seeding.
 *
 * routes.json is the one asset in this repo that cannot be regenerated at
 * runtime (SPEC.md: "pre-fetched once from OSRM — NEVER call OSRM at runtime").
 * If it is silently wrong — a leg dropped, a seam that jumps a block, a stop
 * count out of step with the legs — the demo does not crash, it just quietly
 * teleports vans. So the file gets checked as data, not trusted as an asset.
 */

import { describe, expect, it } from 'vitest'
import { buildFleet, DEPOT, legsFor, ROUTES, routeLineFor, RUN_IDS } from './seed'
import { haversine } from '../sim/geo'
import { parseClock } from '../window'
import type { PaymentMethod } from '../types'

/** Generous box around the Tampa Bay service area. Catches a swapped lat/lng instantly. */
const TAMPA_BBOX = { west: -82.8, east: -82.2, south: 27.6, north: 28.3 }

const FIXED_NOW = Date.parse('2026-08-02T14:00:00.000Z')

describe('routes.json — geometry', () => {
  it('has a depot inside the service area', () => {
    expect(ROUTES.depot.lon).toBeGreaterThan(TAMPA_BBOX.west)
    expect(ROUTES.depot.lon).toBeLessThan(TAMPA_BBOX.east)
    expect(ROUTES.depot.lat).toBeGreaterThan(TAMPA_BBOX.south)
    expect(ROUTES.depot.lat).toBeLessThan(TAMPA_BBOX.north)
  })

  it('has three runs with distinct ids, labels and drivers', () => {
    expect(RUN_IDS).toHaveLength(3)
    expect(new Set(RUN_IDS).size).toBe(3)
    expect(new Set(ROUTES.runs.map((r) => r.label)).size).toBe(3)
    expect(new Set(ROUTES.runs.map((r) => r.driver)).size).toBe(3)
  })

  for (const route of ROUTES.runs) {
    describe(route.id, () => {
      const legs = legsFor(route.id)

      it('has one leg per stop plus the run home to the depot', () => {
        expect(route.stops.length).toBeGreaterThan(0)
        expect(legs).toHaveLength(route.stops.length + 1)
      })

      it('every leg is a real polyline with a real duration', () => {
        for (const leg of legs) {
          expect(leg.coords.length).toBeGreaterThan(1)
          expect(leg.distance_m).toBeGreaterThan(0)
          expect(leg.duration_s).toBeGreaterThan(0)
          // implied speed has to be road traffic, not a teleport or a walk
          const speed = leg.distance_m / leg.duration_s
          expect(speed).toBeGreaterThan(2)
          expect(speed).toBeLessThan(35)
        }
      })

      it("the measured polyline length agrees with OSRM's own distance", () => {
        for (const leg of legs) {
          expect(Math.abs(leg.length - leg.distance_m) / leg.distance_m).toBeLessThan(0.02)
        }
      })

      it('legs are contiguous: leg N ends exactly where leg N+1 starts', () => {
        for (let i = 1; i < legs.length; i++) {
          const seam = haversine(legs[i - 1].coords[legs[i - 1].coords.length - 1], legs[i].coords[0])
          expect(seam).toBeLessThan(1)
        }
      })

      it('starts and ends at the depot', () => {
        expect(haversine(legs[0].coords[0], DEPOT)).toBeLessThan(25)
        const last = legs[legs.length - 1]
        expect(haversine(last.coords[last.coords.length - 1], DEPOT)).toBeLessThan(25)
      })

      it('leg N ends at the kerb of stop N', () => {
        route.stops.forEach((stop, i) => {
          const end = legs[i].coords[legs[i].coords.length - 1]
          // OSRM snaps the requested address to the nearest routable road, so
          // this is a kerb-vs-doorstep gap, not a routing error.
          expect(haversine(end, [stop.lon, stop.lat])).toBeLessThan(250)
        })
      })

      it('every coordinate is inside the service area', () => {
        for (const leg of legs) {
          for (const [lng, lat] of leg.coords) {
            expect(lng).toBeGreaterThan(TAMPA_BBOX.west)
            expect(lng).toBeLessThan(TAMPA_BBOX.east)
            expect(lat).toBeGreaterThan(TAMPA_BBOX.south)
            expect(lat).toBeLessThan(TAMPA_BBOX.north)
          }
        }
      })

      it('every stop has a name and an address', () => {
        for (const stop of route.stops) {
          expect(stop.name.trim().length).toBeGreaterThan(0)
          expect(stop.address.trim().length).toBeGreaterThan(0)
        }
      })

      it('routeLineFor stitches the legs into one deduped line', () => {
        const line = routeLineFor(route.id)
        expect(line.length).toBeGreaterThan(legs[0].coords.length)
        for (let i = 1; i < line.length; i++) {
          expect(line[i]).not.toEqual(line[i - 1])
        }
      })
    })
  }

  it('memoises prepared legs rather than re-parsing per frame', () => {
    expect(legsFor('run-a')).toBe(legsFor('run-a'))
  })
})

describe('buildFleet', () => {
  const fleet = buildFleet(0, FIXED_NOW)

  it('is deterministic for the same generation and clock', () => {
    expect(buildFleet(0, FIXED_NOW)).toEqual(buildFleet(0, FIXED_NOW))
    expect(buildFleet(3, FIXED_NOW)).toEqual(buildFleet(3, FIXED_NOW))
  })

  it('produces one run per route and one stop per route stop', () => {
    expect(fleet.runs).toHaveLength(ROUTES.runs.length)
    let expectedStops = 0
    fleet.runs.forEach((run, i) => {
      const route = ROUTES.runs[i]
      expect(run.id).toBe(route.id)
      expect(run.stops).toHaveLength(route.stops.length)
      expectedStops += route.stops.length
      run.stops.forEach((stopId, n) => expect(stopId).toBe(`${route.id}-${n + 1}`))
    })
    expect(fleet.stops).toHaveLength(expectedStops)
  })

  it('mints unique order codes, and keeps them stable across fleet resets', () => {
    const codes = fleet.stops.map((s) => s.orderCode)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code).toMatch(/^MFST-\d{4}$/)
    // SPEC/tracking: `/t/MFST-4102` has to keep resolving for the whole session,
    // and the sim resets the fleet every few minutes.
    for (const generation of [1, 2, 7]) {
      expect(buildFleet(generation, FIXED_NOW).stops.map((s) => s.orderCode)).toEqual(codes)
    }
  })

  it('prices every order inside the spec band, rounded to the quarter', () => {
    for (const stop of fleet.stops) {
      expect(stop.amountDue).toBeGreaterThanOrEqual(45)
      expect(stop.amountDue).toBeLessThanOrEqual(180)
      expect((stop.amountDue * 4) % 1).toBe(0)
    }
  })

  it('gives every order a non-empty basket with positive quantities', () => {
    for (const stop of fleet.stops) {
      expect(stop.items.length).toBeGreaterThan(0)
      expect(stop.items.length).toBeLessThanOrEqual(3)
      for (const item of stop.items) {
        expect(item.name.trim().length).toBeGreaterThan(0)
        expect(item.qty).toBeGreaterThan(0)
        expect(Number.isInteger(item.qty)).toBe(true)
      }
    }
  })

  it('uses only the three payment methods in the data model', () => {
    const allowed: PaymentMethod[] = ['cash', 'debit', 'digital']
    for (const stop of fleet.stops) expect(allowed).toContain(stop.payment)
  })

  it('gives every stop a parseable two-hour delivery window', () => {
    for (const stop of fleet.stops) {
      const start = parseClock(stop.window[0], FIXED_NOW)
      const end = parseClock(stop.window[1], FIXED_NOW)
      expect(stop.window[0]).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
      expect(stop.window[1]).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
      expect(end - start).toBe(120 * 60_000)
    }
  })

  it('places every stop at its route coordinates', () => {
    fleet.stops.forEach((stop) => {
      const [runId] = [stop.id.slice(0, stop.id.lastIndexOf('-'))]
      const route = ROUTES.runs.find((r) => r.id === runId)
      expect(route).toBeDefined()
      const index = Number(stop.id.slice(stop.id.lastIndexOf('-') + 1)) - 1
      expect(stop.lngLat).toEqual([route!.stops[index].lon, route!.stops[index].lat])
    })
  })

  describe('generation 0 — the opening stagger', () => {
    it('opens with two active runs and one staged, per SPEC', () => {
      const statuses = fleet.runs.map((r) => r.status)
      expect(statuses.filter((s) => s === 'active')).toHaveLength(2)
      expect(statuses.filter((s) => s === 'staged')).toHaveLength(1)
    })

    it('puts one run mid-route and one just leaving, so the map is never static', () => {
      const active = fleet.runs.filter((r) => r.status === 'active')
      expect(active.some((r) => r.currentLeg > 0)).toBe(true)
      expect(active.some((r) => r.currentLeg === 0 && r.progress < 0.1)).toBe(true)
    })

    it('back-dates a coherent history for the mid-route run', () => {
      const midRun = fleet.runs.find((r) => r.status === 'active' && r.currentLeg > 0)!
      const own = fleet.events.filter((e) => e.runId === midRun.id)
      expect(own[0].type).toBe('run_started')
      // one closed event per stop already behind the driver
      const closed = own.filter((e) => e.type === 'closed')
      expect(closed).toHaveLength(midRun.currentLeg)
      for (const event of closed) {
        const stop = fleet.stops.find((s) => s.id === event.stopId)!
        expect(stop.status).toBe('delivered')
        expect(stop.idChecked).toBe(true)
        expect(stop.closedAt).not.toBeNull()
      }
    })

    it('sorts the seeded event log oldest-first and back-dates it', () => {
      const times = fleet.events.map((e) => Date.parse(e.at))
      expect(times).toEqual([...times].sort((a, b) => a - b))
      for (const t of times) expect(t).toBeLessThanOrEqual(FIXED_NOW + 1)
    })

    it('gives every not-yet-served stop on an active run a live ETA', () => {
      for (const run of fleet.runs) {
        if (run.status !== 'active') continue
        run.stops.forEach((stopId, i) => {
          const stop = fleet.stops.find((s) => s.id === stopId)!
          if (i < run.currentLeg) {
            expect(stop.status).toBe('delivered')
            expect(stop.etaMin).toBeNull()
          } else {
            expect(stop.etaMin).not.toBeNull()
            expect(stop.etaMin as number).toBeGreaterThanOrEqual(1)
          }
        })
      }
    })

    it('marks exactly the stop the driver is rolling toward as en route', () => {
      for (const run of fleet.runs) {
        if (run.status !== 'active') continue
        const enroute = run.stops.filter(
          (id) => fleet.stops.find((s) => s.id === id)!.status === 'enroute',
        )
        expect(enroute).toHaveLength(1)
        expect(enroute[0]).toBe(run.stops[run.currentLeg])
      }
    })
  })

  describe('generation > 0 — the reset re-stage', () => {
    const reset = buildFleet(4, FIXED_NOW)

    it('re-stages every run at the depot with a clean ladder', () => {
      for (const run of reset.runs) {
        expect(run.status).toBe('staged')
        expect(run.currentLeg).toBe(0)
        expect(run.progress).toBe(0)
        expect(run.position).toEqual(DEPOT)
      }
      for (const stop of reset.stops) {
        expect(stop.status).toBe('pending')
        expect(stop.idChecked).toBe(false)
        expect(stop.closedAt).toBeNull()
        expect(stop.etaMin).toBeNull()
      }
    })

    it('starts with an empty event log and a fresh manifest id', () => {
      expect(reset.events).toEqual([])
      for (const run of reset.runs) expect(run.manifestId).toMatch(/^MAN-\d{4}-\d{4}-[A-Z]-R4$/)
    })
  })

  it('stamps a compliance manifest id on the opening fleet too', () => {
    for (const run of fleet.runs) expect(run.manifestId).toMatch(/^MAN-\d{4}-\d{4}-[A-Z]$/)
    expect(new Set(fleet.runs.map((r) => r.manifestId)).size).toBe(fleet.runs.length)
  })
})
