/**
 * MapCanvas — the map IS the page.
 *
 * Full-bleed MapLibre canvas carrying our own basemap style plus four overlay
 * layers: route polylines (travelled dim / ahead accent), stop markers with
 * status treatments, driver arrows that glide by lerp with heading rotation,
 * and the depot.
 *
 * Deliberate choices:
 *  - the store publishes positions at ~5 Hz (a GPS cadence); this component
 *    lerps between them every frame, so motion is metabolic, not steppy
 *  - React never re-renders on fleet motion — the map subscribes to the store
 *    imperatively and pushes GeoJSON straight into the sources
 *  - a theme flip calls setStyle and re-installs the overlays; no page reload
 */

import { useEffect, useRef } from 'react'
import { Map as MlMap, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec'
import { useStore } from '../store'
import type { ManifestState } from '../store'
import type { Selection, Theme } from '../types'
import { DEPOT, DEPOT_NAME, legsFor, routeLineFor } from '../data/seed'
import { boundsOf, lerp, lerpAngle, splitLeg, type LngLat } from '../sim/geo'
import { BASEMAP, buildMapStyle, OVERLAY } from './style'

const SRC_ROUTES = 'mf-routes'
const SRC_STOPS = 'mf-stops'
const SRC_DRIVERS = 'mf-drivers'
const SRC_DEPOT = 'mf-depot'
const IMG_ARROW = 'mf-driver-arrow'

const TAMPA_CENTER: LngLat = DEPOT
const DEFAULT_ZOOM = 11.4

export interface MapPadding {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export interface MapCanvasProps {
  /** Runs to render. Defaults to every run in the store. */
  runIds?: string[]
  /** Fit the camera to these runs once, on first load. */
  initialFit?: 'fleet' | 'none'
  /** Keep the camera on this run as it moves (driver mini-map). */
  followRunId?: string
  showStops?: boolean
  showRoutes?: boolean
  showDepot?: boolean
  interactive?: boolean
  /** Keeps the fleet clear of floating panels. */
  padding?: MapPadding
  /** Fired when a stop or driver is clicked. Defaults to store.selectEntity. */
  onSelect?: (selection: Selection | null) => void
  className?: string
}

/* ------------------------------------------------------------- imagery --- */

/** Driver arrow, drawn at runtime — no sprite sheet, no external asset. */
function makeArrowImage(fill: string, ink: string): ImageData | null {
  if (typeof document === 'undefined') return null
  const size = 44
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const cx = size / 2

  ctx.beginPath()
  ctx.moveTo(cx, 5)
  ctx.lineTo(cx + 13, size - 8)
  ctx.lineTo(cx, size - 15)
  ctx.lineTo(cx - 13, size - 8)
  ctx.closePath()

  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.strokeStyle = ink
  ctx.stroke()

  return ctx.getImageData(0, 0, size, size)
}

/* -------------------------------------------------------------- shapes --- */

type FC = GeoJSON.FeatureCollection

function emptyFC(): FC {
  return { type: 'FeatureCollection', features: [] }
}

function routeFC(state: ManifestState, runIds: string[], selection: Selection | null): FC {
  const features: GeoJSON.Feature[] = []
  for (const runId of runIds) {
    const run = state.runs[runId]
    if (!run) continue
    const selected = selection?.kind === 'run' && selection.id === runId
    if (run.status === 'active') {
      const legs = legsFor(runId)
      const idx = Math.min(run.currentLeg, legs.length - 1)
      const travelled: LngLat[] = []
      for (let i = 0; i < idx; i++) travelled.push(...legs[i].coords)
      const split = splitLeg(legs[idx], run.progress)
      travelled.push(...split.travelled)
      const ahead: LngLat[] = [...split.remaining]
      for (let i = idx + 1; i < legs.length; i++) ahead.push(...legs[i].coords)

      if (travelled.length > 1) {
        features.push({
          type: 'Feature',
          properties: { runId, phase: 'done', selected },
          geometry: { type: 'LineString', coordinates: travelled },
        })
      }
      if (ahead.length > 1) {
        features.push({
          type: 'Feature',
          properties: { runId, phase: 'ahead', selected },
          geometry: { type: 'LineString', coordinates: ahead },
        })
      }
    } else {
      features.push({
        type: 'Feature',
        properties: { runId, phase: run.status === 'complete' ? 'done' : 'idle', selected },
        geometry: { type: 'LineString', coordinates: routeLineFor(runId) },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

function stopFC(state: ManifestState, runIds: string[], selection: Selection | null): FC {
  const features: GeoJSON.Feature[] = []
  for (const runId of runIds) {
    const run = state.runs[runId]
    if (!run) continue
    run.stops.forEach((stopId, i) => {
      const stop = state.stops[stopId]
      if (!stop) return
      features.push({
        type: 'Feature',
        properties: {
          stopId,
          runId,
          status: stop.status,
          seq: String(i + 1),
          orderCode: stop.orderCode,
          selected: selection?.kind === 'stop' && selection.id === stopId,
        },
        geometry: { type: 'Point', coordinates: stop.lngLat },
      })
    })
  }
  return { type: 'FeatureCollection', features }
}

function depotFC(): FC {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: DEPOT_NAME },
        geometry: { type: 'Point', coordinates: DEPOT },
      },
    ],
  }
}

/* --------------------------------------------------------- expressions --- */

function stopFillExpr(theme: Theme): ExpressionSpecification {
  const o = OVERLAY[theme]
  const b = BASEMAP[theme]
  return [
    'match',
    ['get', 'status'],
    'delivered',
    o.stopDelivered,
    'exception',
    o.amber,
    'enroute',
    o.accent,
    'arrived',
    o.accent,
    'id_check',
    o.accent,
    theme === 'dark' ? b.building : '#FFFFFF',
  ] as ExpressionSpecification
}

function stopTextExpr(theme: Theme): ExpressionSpecification {
  const o = OVERLAY[theme]
  return [
    'match',
    ['get', 'status'],
    'pending',
    o.stopPending,
    o.markerInk,
  ] as ExpressionSpecification
}

/* ------------------------------------------------------------ overlays --- */

function installOverlays(map: MlMap, theme: Theme): void {
  const o = OVERLAY[theme]

  /** style.load can fire more than once per style; adding twice throws. */
  const addLayer = (layer: Parameters<MlMap['addLayer']>[0]) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer)
  }

  const arrow = makeArrowImage(o.accent, o.driverInk)
  if (arrow) {
    if (map.hasImage(IMG_ARROW)) map.removeImage(IMG_ARROW)
    map.addImage(IMG_ARROW, arrow, { pixelRatio: 2 })
  }

  if (!map.getSource(SRC_ROUTES)) map.addSource(SRC_ROUTES, { type: 'geojson', data: emptyFC() })
  if (!map.getSource(SRC_STOPS)) map.addSource(SRC_STOPS, { type: 'geojson', data: emptyFC() })
  if (!map.getSource(SRC_DRIVERS)) map.addSource(SRC_DRIVERS, { type: 'geojson', data: emptyFC() })
  if (!map.getSource(SRC_DEPOT)) map.addSource(SRC_DEPOT, { type: 'geojson', data: depotFC() })

  // ---- routes: travelled dims out, the road ahead carries the accent
  addLayer({
    id: 'mf-route-idle',
    type: 'line',
    source: SRC_ROUTES,
    filter: ['!=', ['get', 'phase'], 'ahead'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': o.routeIdle,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 16, 3.2],
      'line-opacity': 0.75,
    },
  })

  addLayer({
    id: 'mf-route-ahead-glow',
    type: 'line',
    source: SRC_ROUTES,
    filter: ['all', ['==', ['get', 'phase'], 'ahead'], ['==', ['get', 'selected'], true]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': o.accent,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 12],
      'line-opacity': 0.16,
      'line-blur': 5,
    },
  })

  addLayer({
    id: 'mf-route-ahead',
    type: 'line',
    source: SRC_ROUTES,
    filter: ['==', ['get', 'phase'], 'ahead'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': o.accent,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['case', ['==', ['get', 'selected'], true], 2.6, 1.8],
        16,
        ['case', ['==', ['get', 'selected'], true], 5, 3.4],
      ],
      'line-opacity': 0.95,
    },
  })

  // ---- depot
  addLayer({
    id: 'mf-depot',
    type: 'circle',
    source: SRC_DEPOT,
    paint: {
      'circle-radius': 4,
      'circle-color': o.markerInk,
      'circle-stroke-color': BASEMAP[theme].labelSecondary,
      'circle-stroke-width': 2,
    },
  })

  addLayer({
    id: 'mf-depot-label',
    type: 'symbol',
    source: SRC_DEPOT,
    minzoom: 11,
    layout: {
      'text-field': 'DEPOT',
      'text-font': ['Noto Sans Bold'],
      'text-size': 9,
      'text-letter-spacing': 0.2,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': BASEMAP[theme].labelSecondary,
      'text-halo-color': BASEMAP[theme].halo,
      'text-halo-width': 1.4,
    },
  })

  // ---- stops
  addLayer({
    id: 'mf-stop-halo',
    type: 'circle',
    source: SRC_STOPS,
    filter: ['match', ['get', 'status'], ['enroute', 'arrived', 'id_check'], true, false],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 16, 16],
      'circle-color': o.accentSoft,
      'circle-blur': 0.35,
    },
  })

  addLayer({
    id: 'mf-stop',
    type: 'circle',
    source: SRC_STOPS,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 10],
      'circle-color': stopFillExpr(theme),
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 2.5, 1.4],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'selected'], true],
        o.accent,
        ['==', ['get', 'status'], 'pending'],
        o.stopPending,
        o.markerInk,
      ],
    },
  })

  addLayer({
    id: 'mf-stop-seq',
    type: 'symbol',
    source: SRC_STOPS,
    minzoom: 10.5,
    layout: {
      'text-field': ['get', 'seq'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 8, 16, 11],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': stopTextExpr(theme) },
  })

  // ---- drivers
  /**
   * Live GPS accuracy ring. Only ever drawn for a run whose position is coming
   * off a real device (`live` is false for simulated fixes), because a ring
   * around a number we invented would be theatre. Radius is metres, so it is
   * recomputed in pixels every frame against the current zoom and latitude.
   */
  addLayer({
    id: 'mf-driver-accuracy',
    type: 'circle',
    source: SRC_DRIVERS,
    filter: ['==', ['get', 'live'], true],
    paint: {
      'circle-radius': 0,
      'circle-color': o.accentSoft,
      'circle-stroke-color': o.accent,
      'circle-stroke-width': 1,
      'circle-stroke-opacity': 0.45,
    },
  })

  addLayer({
    id: 'mf-driver-pulse',
    type: 'circle',
    source: SRC_DRIVERS,
    filter: ['==', ['get', 'selected'], true],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 16, 16, 30],
      'circle-color': o.accent,
      'circle-opacity': 0.18,
      'circle-blur': 0.5,
    },
  })

  addLayer({
    id: 'mf-driver',
    type: 'symbol',
    source: SRC_DRIVERS,
    layout: {
      'icon-image': IMG_ARROW,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 0.8],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
}

/* ------------------------------------------------------------ component -- */

interface DriverRender {
  position: LngLat
  heading: number
}

export function MapCanvas({
  runIds,
  initialFit = 'fleet',
  followRunId,
  showStops = true,
  showRoutes = true,
  showDepot = true,
  interactive = true,
  padding,
  onSelect,
  className,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const readyRef = useRef(false)
  /** Theme whose basemap is actually installed in the map right now. */
  const styleThemeRef = useRef<Theme>(useStore.getState().theme)
  const rafRef = useRef(0)
  const renderRef = useRef<Record<string, DriverRender>>({})
  const shapeSigRef = useRef('')
  const lastFrameRef = useRef(0)
  const pulseRef = useRef(0)

  const propsRef = useRef({ runIds, showStops, showRoutes, showDepot, onSelect, followRunId })
  propsRef.current = { runIds, showStops, showRoutes, showDepot, onSelect, followRunId }

  const theme = useStore((s) => s.theme)
  const selection = useStore((s) => s.selection)

  /* ---- create the map once ---- */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new MlMap({
      container: containerRef.current,
      style: buildMapStyle(useStore.getState().theme),
      center: TAMPA_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
      interactive,
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 120,
      maxZoom: 18,
      minZoom: 8,
    })
    mapRef.current = map
    map.touchZoomRotate?.disableRotation()

    // E2E/bench handle + surfaced GL errors (maplibre swallows them otherwise).
    ;(window as unknown as Record<string, unknown>).__MANIFEST_MAP__ = map
    map.on('error', (e) => console.error('[map]', e.error?.message ?? e))

    /**
     * Runs on a microtask, not inside the 'style.load' dispatch: honouring a
     * queued flip means calling setStyle again, and re-entering setStyle while
     * maplibre is still walking that event's listener list swaps the style out
     * from under the listeners behind us. A microtask is late enough to be off
     * the stack and early enough that the browser cannot paint the gap.
     */
    const settleStyle = () => {
      if (mapRef.current !== map) return
      // A flip that arrived while this style was loading is honoured rather than
      // dropped — otherwise the panels sit in one theme and the map in the
      // other, permanently, and the only way back is another click.
      const wanted = useStore.getState().theme
      if (styleThemeRef.current !== wanted) {
        applyMapTheme(map, wanted)
        return
      }
      installOverlays(map, wanted)
      readyRef.current = true
      shapeSigRef.current = ''
      syncShapes(true)
    }

    const onStyleLoad = () => queueMicrotask(settleStyle)

    map.on('style.load', onStyleLoad)

    const clickable = ['mf-stop', 'mf-stop-seq', 'mf-driver']
    const onClick = (ev: MapMouseEvent) => {
      if (!readyRef.current) return
      const present = clickable.filter((id) => map.getLayer(id))
      const hits = map.queryRenderedFeatures(ev.point, { layers: present })
      const hit = hits[0]
      const store = useStore.getState()
      const handler = propsRef.current.onSelect ?? store.selectEntity
      if (!hit) {
        handler(null)
        return
      }
      const props = hit.properties ?? {}
      if (props.stopId) handler({ kind: 'stop', id: String(props.stopId) })
      else if (props.runId) handler({ kind: 'run', id: String(props.runId) })
    }
    map.on('click', onClick)

    const onEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
    }
    map.on('mouseenter', 'mf-stop', onEnter)
    map.on('mouseleave', 'mf-stop', onLeave)
    map.on('mouseenter', 'mf-driver', onEnter)
    map.on('mouseleave', 'mf-driver', onLeave)

    return () => {
      /**
       * Disown the map BEFORE tearing it down, not after.
       *
       * Every guard in this file is `mapRef.current`/`readyRef.current`, and
       * `remove()` is not a quiet call: it destroys the style, drains the
       * render queue and fires listeners on the way out. Nulling the refs
       * afterwards leaves a window in which a queued frame or a settling
       * style callback can still reach a map whose style is already gone,
       * which surfaces as `getSource of null`. The story page mounts and
       * unmounts map-bearing surfaces as you scroll, so that window gets
       * opened far more often here than anywhere else in the app.
       */
      mapRef.current = null
      readyRef.current = false
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Swap the basemap for `next`, holding the camera exactly where it is.
   *
   * On the camera: maplibre v5 does NOT move it here. `setStyle` with an object
   * takes the diff path, and `Style.setState` explicitly skips the
   * setCenter/setZoom/setBearing/setPitch/setRoll operations; the full-rebuild
   * fallback keeps the map's transform because a Style has never owned it; and
   * the one camera write on 'style.load' only fires for a stylesheet that
   * declares `center`/`zoom` (ours declares neither). The snapshot below is
   * therefore a no-op today and a guard tomorrow — the restore is synchronous,
   * inside the same call, so it cannot fight a later flyTo, fitBounds or a
   * user's own pan.
   */
  function applyMapTheme(map: MlMap, next: Theme): void {
    styleThemeRef.current = next
    readyRef.current = false
    const before = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    }
    map.setStyle(buildMapStyle(next))
    // 'style.load' re-installs the overlays and re-pushes the fleet data.
    const after = map.getCenter()
    if (
      map.getZoom() !== before.zoom ||
      map.getBearing() !== before.bearing ||
      map.getPitch() !== before.pitch ||
      after.lng !== before.center.lng ||
      after.lat !== before.center.lat
    ) {
      map.jumpTo(before)
    }
  }

  /* ---- theme flip: restyle without a reload ---- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleThemeRef.current === theme) return
    // Deliberately NOT gated on readyRef: a click during the opening style load
    // is still a click, and applyMapTheme/onStyleLoad coalesce the flips.
    applyMapTheme(map, theme)
  }, [theme])

  /* ---- imperative data pump: routes + stops on change, drivers every frame -- */
  useEffect(() => {
    function syncNow() {
      syncShapes(false)
    }
    const unsub = useStore.subscribe(syncNow)

    function frame(now: number) {
      rafRef.current = requestAnimationFrame(frame)
      const map = mapRef.current
      if (!map || !readyRef.current) return
      if ((map as unknown as { _removed?: boolean })._removed) return

      const dt = Math.min((now - (lastFrameRef.current || now)) / 1000, 0.25)
      lastFrameRef.current = now
      const alpha = 1 - Math.exp(-dt / 0.18)

      const state = useStore.getState()
      const ids = propsRef.current.runIds ?? state.runOrder
      const features: GeoJSON.Feature[] = []
      const rendered = renderRef.current

      for (const runId of ids) {
        const run = state.runs[runId]
        if (!run || run.status !== 'active') {
          delete rendered[runId]
          continue
        }
        const target = run.position
        const current = rendered[runId]
        const next: DriverRender = current
          ? {
              position: [
                lerp(current.position[0], target[0], alpha),
                lerp(current.position[1], target[1], alpha),
              ],
              heading: lerpAngle(current.heading, run.heading, alpha),
            }
          : { position: target, heading: run.heading }
        rendered[runId] = next

        const liveHere =
          state.liveRunId === runId && state.liveFix !== null && !state.liveFix.simulated

        features.push({
          type: 'Feature',
          properties: {
            runId,
            heading: next.heading,
            selected: state.selection?.kind === 'run' && state.selection.id === runId,
            live: liveHere,
          },
          geometry: { type: 'Point', coordinates: next.position },
        })
      }

      const src = map.getSource(SRC_DRIVERS) as GeoJSONSource | undefined
      src?.setData({ type: 'FeatureCollection', features })

      // Accuracy ring: metres -> screen pixels at this zoom and latitude.
      const fix = state.liveFix
      if (map.getLayer('mf-driver-accuracy')) {
        let radius = 0
        if (fix && !fix.simulated && fix.accuracyM > 0) {
          const centre = map.getCenter()
          const metresPerPixel =
            (156543.03392 * Math.cos((centre.lat * Math.PI) / 180)) / 2 ** map.getZoom()
          radius = Math.max(0, Math.min(160, fix.accuracyM / metresPerPixel))
        }
        map.setPaintProperty('mf-driver-accuracy', 'circle-radius', radius)
      }

      // DESIGN: the accent pulses ONLY on the current selection
      if (map.getLayer('mf-driver-pulse') && state.selection?.kind === 'run') {
        pulseRef.current += dt
        const wave = 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(pulseRef.current * 2.6))
        map.setPaintProperty('mf-driver-pulse', 'circle-opacity', wave)
      }

      const follow = propsRef.current.followRunId
      if (follow) {
        const r = rendered[follow]
        if (r) map.easeTo({ center: r.position, duration: 220, easing: (t) => t })
      }
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      unsub()
      cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Routes + stops only change on status/leg transitions — signature-gated. */
  function syncShapes(force: boolean) {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if ((map as unknown as { _removed?: boolean })._removed) return
    const state = useStore.getState()
    const ids = propsRef.current.runIds ?? state.runOrder

    const sig = ids
      .map((id) => {
        const run = state.runs[id]
        if (!run) return `${id}:x`
        const stopSig = run.stops.map((sid) => state.stops[sid]?.status ?? '?').join('')
        const sel =
          state.selection?.kind === 'run' && state.selection.id === id
            ? 'R'
            : state.selection?.kind === 'stop' && run.stops.includes(state.selection.id)
              ? 'S'
              : '-'
        return `${id}:${run.status}:${run.currentLeg}:${Math.round(run.progress * 120)}:${stopSig}:${sel}`
      })
      .join('|')

    if (!force && sig === shapeSigRef.current) return
    shapeSigRef.current = sig

    const routes = map.getSource(SRC_ROUTES) as GeoJSONSource | undefined
    const stops = map.getSource(SRC_STOPS) as GeoJSONSource | undefined
    routes?.setData(
      propsRef.current.showRoutes ? routeFC(state, ids, state.selection) : emptyFC(),
    )
    stops?.setData(propsRef.current.showStops ? stopFC(state, ids, state.selection) : emptyFC())

    for (const layerId of ['mf-depot', 'mf-depot-label']) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(
          layerId,
          'visibility',
          propsRef.current.showDepot ? 'visible' : 'none',
        )
      }
    }
  }

  /* ---- initial fit ---- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || initialFit === 'none') return
    let done = false
    const fit = () => {
      if (done) return
      const state = useStore.getState()
      const ids = propsRef.current.runIds ?? state.runOrder
      const pts: LngLat[] = [DEPOT]
      for (const id of ids) {
        const run = state.runs[id]
        run?.stops.forEach((sid) => {
          const stop = state.stops[sid]
          if (stop) pts.push(stop.lngLat)
        })
      }
      const bb = boundsOf(pts)
      if (!bb) return
      // The panel padding is already on the transform (setPadding effect), so
      // only a small margin here — and verify the camera math actually
      // succeeded: cameraForBounds returns undefined when padding exceeds the
      // (possibly not-yet-laid-out) canvas, and fitBounds would no-op silently.
      const cam = map.cameraForBounds(
        [
          [bb[0], bb[1]],
          [bb[2], bb[3]],
        ],
        { padding: 24, maxZoom: 14 },
      )
      if (!cam) return
      done = true
      map.jumpTo(cam)
    }
    /**
     * Two failure modes while layout settles: a zero-size canvas clamps the
     * constructor zoom to minZoom, and camera math no-ops against a canvas
     * smaller than its padding. Retry on render frames until the fit lands.
     */
    let attempts = 0
    const fitWhenSized = () => {
      // The re-arm below outlives an unmount if one lands between frames.
      if (done || mapRef.current !== map || attempts++ > 240) return
      const c = map.getCanvas()
      if (c.width >= 200 && c.height >= 200) {
        map.resize()
        fit()
      }
      if (!done) map.once('render', fitWhenSized)
    }
    if (map.isStyleLoaded()) fitWhenSized()
    else map.once('style.load', fitWhenSized)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFit])

  /* ---- selection: fly to it, once per selection identity ---- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selection) return
    const state = useStore.getState()
    if (selection.kind === 'stop') {
      const stop = state.stops[selection.id]
      if (stop) map.flyTo({ center: stop.lngLat, zoom: Math.max(map.getZoom(), 14.5), duration: 900 })
    } else {
      const run = state.runs[selection.id]
      if (run) {
        const center = run.status === 'active' ? run.position : DEPOT
        map.flyTo({ center, zoom: Math.max(map.getZoom(), 13), duration: 900 })
      }
    }
  }, [selection])

  /* ---- keep panels from covering the fleet ---- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !padding) return
    map.setPadding({
      top: padding.top ?? 0,
      right: padding.right ?? 0,
      bottom: padding.bottom ?? 0,
      left: padding.left ?? 0,
    })
  }, [padding])

  return <div ref={containerRef} className={className ?? 'map-root'} aria-label="Fleet map" />
}

export default MapCanvas
