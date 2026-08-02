/**
 * Basemap styles — authored, not borrowed.
 *
 * DESIGN.md: "The map must wear our palette. If the basemap looks like Google
 * Maps or default OSM, it is wrong." So: OpenFreeMap serves the vector tiles
 * (OpenMapTiles schema, free, no key) and every paint value below comes from
 * our own ramps. Dark reads as a single-phosphor night console; light reads as
 * ink-on-paper cartography. No sprite is loaded at all — default OSM iconography
 * never enters the frame.
 *
 * Layer count is deliberately lean (18): the map is a field for the fleet to
 * move over, not a reference atlas.
 */

import type { FilterSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { Theme } from '../types'

const TILE_SOURCE_URL = 'https://tiles.openfreemap.org/planet'
const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

/**
 * OpenFreeMap only serves the Noto Sans stacks, so map labels cannot be IBM
 * Plex. They are compensated: uppercase, letterspaced, and painted in our ink
 * ramp, so they read as instrument labels rather than atlas typography.
 */
const FONT_REGULAR = ['Noto Sans Regular']
const FONT_BOLD = ['Noto Sans Bold']

export interface BasemapRamp {
  land: string
  water: string
  waterEdge: string
  park: string
  landcover: string
  building: string
  buildingEdge: string
  roadMinor: string
  roadSecondary: string
  roadPrimary: string
  roadMotorway: string
  roadCasing: string
  rail: string
  boundary: string
  labelPrimary: string
  labelSecondary: string
  labelTertiary: string
  labelWater: string
  halo: string
}

/** Field/ink values, mirrored from DESIGN.md and theme.css. */
export const BASEMAP: Record<Theme, BasemapRamp> = {
  dark: {
    land: '#131A1D',
    water: '#0D1214',
    waterEdge: '#1B2429',
    park: '#161E1F',
    landcover: '#151C1D',
    building: '#1B2429',
    buildingEdge: '#222E33',
    roadMinor: '#202A2E',
    roadSecondary: '#26333A',
    roadPrimary: '#2D3C43',
    roadMotorway: '#35464E',
    roadCasing: '#0B1012',
    rail: '#1E282C',
    boundary: '#2A373D',
    labelPrimary: '#E8F1F2',
    labelSecondary: '#8FA6AB',
    labelTertiary: '#54696F',
    labelWater: '#3C5157',
    halo: '#0D1214',
  },
  light: {
    land: '#F4F2EC',
    water: '#E9E6DD',
    waterEdge: '#DCD7C9',
    park: '#ECE9E0',
    landcover: '#EFECE4',
    building: '#EAE7DE',
    buildingEdge: '#DDD8CA',
    roadMinor: '#FBFAF6',
    roadSecondary: '#FFFFFF',
    roadPrimary: '#FFFFFF',
    roadMotorway: '#FFFFFF',
    roadCasing: '#D8D3C4',
    rail: '#CFC9B8',
    boundary: '#C9C2AF',
    labelPrimary: '#1C2326',
    labelSecondary: '#5C6A6E',
    labelTertiary: '#9AA6A9',
    labelWater: '#A8A08C',
    halo: '#F4F2EC',
  },
}

/** Colours for our own overlay layers (routes, drivers, stops). ONE accent. */
export interface OverlayRamp {
  accent: string
  accentSoft: string
  amber: string
  routeIdle: string
  routeDone: string
  stopPending: string
  stopDelivered: string
  markerInk: string
  driverInk: string
}

export const OVERLAY: Record<Theme, OverlayRamp> = {
  dark: {
    accent: '#39D0C4',
    accentSoft: 'rgba(57, 208, 196, 0.28)',
    amber: '#E8A33D',
    routeIdle: '#2C3B41',
    routeDone: '#1F2A2F',
    stopPending: '#8FA6AB',
    stopDelivered: '#54696F',
    markerInk: '#0D1214',
    driverInk: '#04090A',
  },
  light: {
    accent: '#0E8C82',
    accentSoft: 'rgba(14, 140, 130, 0.22)',
    amber: '#B26F1D',
    routeIdle: '#BFB9A6',
    routeDone: '#D6D1C2',
    stopPending: '#5C6A6E',
    stopDelivered: '#9AA6A9',
    markerInk: '#FFFFFF',
    driverInk: '#FFFFFF',
  },
}

const isClass = (...classes: string[]): FilterSpecification => [
  'match',
  ['get', 'class'],
  classes,
  true,
  false,
]

/** Build the basemap style for a theme. Called on load and on every theme flip. */
export function buildMapStyle(theme: Theme): StyleSpecification {
  const c = BASEMAP[theme]

  return {
    version: 8,
    name: `Manifest ${theme === 'dark' ? 'Night Console' : 'Paper Manifest'}`,
    glyphs: GLYPHS_URL,
    sources: {
      openmaptiles: { type: 'vector', url: TILE_SOURCE_URL },
    },
    layers: [
      {
        id: 'field',
        type: 'background',
        paint: { 'background-color': c.land },
      },
      {
        id: 'landcover',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: isClass('wood', 'grass', 'scrub', 'farmland'),
        paint: { 'fill-color': c.landcover, 'fill-opacity': 0.9 },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        paint: { 'fill-color': c.park, 'fill-opacity': 0.85 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': c.water },
      },
      {
        id: 'water-edge',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'water',
        minzoom: 9,
        paint: { 'line-color': c.waterEdge, 'line-width': 0.7 },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        minzoom: 10,
        paint: {
          'line-color': c.water,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 3],
        },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-color': c.building,
          'fill-outline-color': c.buildingEdge,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1],
        },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: isClass('rail', 'transit'),
        paint: {
          'line-color': c.rail,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 1.6],
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'road-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: isClass('motorway', 'trunk', 'primary', 'secondary'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.roadCasing,
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            8,
            1.4,
            12,
            4,
            16,
            13,
            20,
            34,
          ],
        },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: isClass('minor', 'service', 'track', 'residential'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.roadMinor,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 16, 3.4, 20, 14],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 14, 1],
        },
      },
      {
        id: 'road-secondary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 10,
        filter: isClass('secondary', 'tertiary'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.roadSecondary,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 0.7, 14, 3, 20, 20],
        },
      },
      {
        id: 'road-primary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: isClass('primary', 'trunk'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.roadPrimary,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 0.9, 14, 4, 20, 26],
        },
      },
      {
        id: 'road-motorway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 6,
        filter: isClass('motorway'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.roadMotorway,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 6, 0.8, 12, 3.4, 20, 30],
        },
      },
      {
        id: 'boundary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['all', ['has', 'admin_level'], ['<=', ['get', 'admin_level'], 6]],
        paint: {
          'line-color': c.boundary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 12, 1.2],
          'line-dasharray': [4, 3],
        },
      },
      {
        id: 'label-road',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        filter: isClass('motorway', 'trunk', 'primary', 'secondary', 'tertiary'),
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': FONT_REGULAR,
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 17, 11],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.14,
          'text-padding': 6,
        },
        paint: {
          'text-color': c.labelTertiary,
          'text-halo-color': c.halo,
          'text-halo-width': 1.1,
        },
      },
      {
        id: 'label-water',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        minzoom: 9,
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': FONT_REGULAR,
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 12],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.2,
          'text-max-width': 7,
        },
        paint: { 'text-color': c.labelWater, 'text-halo-color': c.halo, 'text-halo-width': 0.8 },
      },
      {
        id: 'label-place-minor',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 11,
        filter: isClass('suburb', 'neighbourhood', 'village', 'hamlet'),
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': FONT_REGULAR,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 12],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.18,
          'text-max-width': 8,
        },
        paint: {
          'text-color': c.labelSecondary,
          'text-halo-color': c.halo,
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'label-place-major',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: isClass('city', 'town', 'state', 'country'),
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 14, 15, 17],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.22,
          'text-max-width': 8,
        },
        paint: {
          'text-color': c.labelPrimary,
          'text-halo-color': c.halo,
          'text-halo-width': 1.4,
        },
      },
    ],
  } as StyleSpecification
}
