/**
 * Basemap styles — authored, not borrowed.
 *
 * DESIGN.md: "The map must wear our palette. If the basemap looks like Google
 * Maps or default OSM, it is wrong." So: OpenFreeMap serves the vector tiles
 * (OpenMapTiles schema, free, no key) and every paint value below comes from
 * our own ramps. DESIGN v2 derives the whole UI palette FROM these values, so
 * panels and cartography read as one object: light is "Paper" (warm paper land,
 * white road ramps, sage water), dark is "Moss night" (deep neutral with a faint
 * green undertone — not blue-black, not phosphor). No sprite is loaded at all —
 * default OSM iconography never enters the frame.
 *
 * Layer count is deliberately lean (18): the map is a field for the fleet to
 * move over, not a reference atlas.
 */

import type { FilterSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { Theme } from '../types'

const TILE_SOURCE_URL = 'https://tiles.openfreemap.org/planet'
const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

/**
 * OpenFreeMap only serves the Noto Sans stacks, so map labels cannot be
 * Familjen Grotesk. They are compensated by being painted in our own warm-grey
 * ink ramp and letterspaced lightly. v2 drops v1's wall-to-wall uppercase: the
 * caps register now lives only inside the printable compliance manifest.
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

/**
 * Field/ink values, mirrored from DESIGN.md v2 and theme.css.
 *
 * Light "Paper": land #F2EEE4, water #DDE3DE, parks #E6EBDF, roads ramp to
 * white, labels warm grey. Dark "Moss night": land #232622, water #1C1F1B, and
 * road/building ramps derived off those — each step warms and lifts by a few
 * points with a trace of green in it, so the night map never goes blue.
 */
export const BASEMAP: Record<Theme, BasemapRamp> = {
  dark: {
    land: '#232622',
    water: '#1C1F1B',
    waterEdge: '#272C26',
    park: '#272C26',
    landcover: '#252925',
    building: '#2A2E29',
    buildingEdge: '#333830',
    roadMinor: '#2E332D',
    roadSecondary: '#363C34',
    roadPrimary: '#3E453C',
    roadMotorway: '#485044',
    roadCasing: '#1A1D19',
    rail: '#2C312B',
    boundary: '#3B4239',
    labelPrimary: '#EDEEE7',
    labelSecondary: '#AEB2A6',
    labelTertiary: '#767B6E',
    labelWater: '#4F5A50',
    halo: '#232622',
  },
  light: {
    land: '#F2EEE4',
    water: '#DDE3DE',
    waterEdge: '#CBD3CC',
    park: '#E6EBDF',
    landcover: '#EAEDE2',
    building: '#EAE5D9',
    buildingEdge: '#DED8C9',
    roadMinor: '#FBF9F4',
    roadSecondary: '#FFFFFF',
    roadPrimary: '#FFFFFF',
    roadMotorway: '#FFFFFF',
    roadCasing: '#DCD5C6',
    rail: '#CFC8B7',
    boundary: '#C6BFAC',
    labelPrimary: '#262521',
    labelSecondary: '#6E6759',
    labelTertiary: '#A69E8F',
    labelWater: '#8FA096',
    halo: '#F2EEE4',
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
    accent: '#8FBF9A',
    accentSoft: 'rgba(143, 191, 154, 0.26)',
    amber: '#E0A24A',
    routeIdle: '#3A4038',
    routeDone: '#2B302A',
    stopPending: '#AEB2A6',
    stopDelivered: '#767B6E',
    markerInk: '#1C1F1B',
    driverInk: '#16211A',
  },
  light: {
    accent: '#4E7A5A',
    accentSoft: 'rgba(78, 122, 90, 0.2)',
    amber: '#B57023',
    routeIdle: '#C6BFAC',
    routeDone: '#DCD5C6',
    stopPending: '#6E6759',
    stopDelivered: '#A69E8F',
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
    name: `Manifest ${theme === 'dark' ? 'Moss Night' : 'Paper'}`,
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
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9.5, 17, 11.5],
          'text-letter-spacing': 0.04,
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
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 14, 12.5],
          'text-letter-spacing': 0.06,
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
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 15, 12.5],
          'text-letter-spacing': 0.04,
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
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11.5, 10, 14.5, 15, 17.5],
          'text-letter-spacing': 0.05,
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
