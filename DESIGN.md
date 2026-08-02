# Manifest — Design System

Manifest is delivery dispatch software for dispensaries. The design register is
**instrument, not dashboard** — a piece of ops equipment the way a POS terminal or a
two-way radio is equipment. Every decision below exists to kill the default
"AI-styled admin template" look. Deviations require explicit approval.

## The one big idea: the map is the page

The dispatch console has NO app chrome hosting a map widget. The map IS the viewport,
full-bleed, and every control floats over it as a translucent panel. (Clayton's own
words about the best delivery UI he used: "the whole page was the map and the menu
where filled out stuff was there and mini.")

**The map must wear our palette.** MapLibre basemap style is custom-authored in our
restricted values — light mode reads as ink-on-paper cartography, dark mode as a
single-phosphor night console. If the basemap looks like Google Maps or default OSM,
it is wrong. Roads, water, parks, labels: all re-shaded through the ramps below.

## Palette

Two themes, same logic: a desaturated field, ONE live accent, ONE deviation color.
Nothing else is allowed to carry chroma. If everything glows, nothing glows.

### Dark (night console — default when OS prefers dark)
- Field: `#0D1214` (page/map water), `#131A1D` (land), `#1A2327` (panels), `#243036` (borders)
- Ink: `#E8F1F2` primary, `#8FA6AB` secondary, `#54696F` disabled
- Live accent (teal phosphor): `#39D0C4` — moving drivers, active routes, live ETAs, primary buttons
- Deviation (amber): `#E8A33D` — exceptions ONLY: late stops, failed ID checks, connectivity loss
- Delivered/complete: dim to field values, never green-celebrate

### Light (paper manifest)
- Field: `#F4F2EC` (page/map land), `#E9E6DD` (water/parks), `#FFFFFF` (panels), `#D8D3C4` (borders)
- Ink: `#1C2326` primary, `#5C6A6E` secondary, `#9AA6A9` disabled
- Live accent: `#0E8C82` (deep teal — same hue family, print-legible)
- Deviation: `#B26F1D`

State is never a new color: pending/active/complete render as border + fill treatments
of the SAME component (BotW rule). Amber is reserved for things a dispatcher must act on.

## Typography

- UI: **IBM Plex Sans** (weights 400/500/600). NOT Inter — Inter is the template tell.
- Data & identifiers: **IBM Plex Mono** — order numbers, manifest IDs, timestamps,
  coordinates, plate-header labels. Manifests are legal documents; monospace is the
  document register.
- Scale is bimodal (Psycho-Pass rule): each panel gets AT MOST ONE display-size number
  (28–40px). Everything else is 11–13px micro rows. No middle sizes. Sweeping the
  console reads system state as a row of big numerals.

## Components

- **Plate headers** (Signalis): every panel/section title is an inverted plate — filled
  bar, background-color text, mono, uppercase, letterspaced. `RUN A — SOUTH TAMPA`.
  Panels are boxed; nothing floats unboxed over the map.
- **Stop tickets** (BotW neutral shelf): identical geometry for every stop card. Status
  = left border weight + fill tint + a small mono chip. Never resize, never re-color
  the whole card, no badges piling up.
- **Dual-resolution metrics** (Umamusume): every count shows chip + value/ceiling:
  `STOP 3/5`, `RUNS 2/3 ACTIVE`. No naked numerals.
- **Event feed**: delivery events (departed, arrived, ID VERIFIED, closed — CASH) as a
  chat-transcript-style timeline, newest on top, mono timestamps.
- **ETA drift** rendered inline as `4:12 → 4:19` with an arrow — no red/green diff badges.
- **Glass panels**: translucent (backdrop-blur) over the map, opaque plate headers.
  Radius 6px, hairline borders. No shadows deeper than 1px hairline + subtle ambient.

## Motion

Metabolic, not performative (the machine breathing): drivers glide via lerp between
GPS/sim points with heading rotation; ETA numerals tick; the live accent pulses ONLY
on the currently-selected driver. No entrance animations, no bouncing, no confetti on
delivery. 150ms ease-out on panel state changes, nothing longer than 250ms.

## Driver app (phone)

Same system, but ticket-first instead of map-first: the current stop is a full-screen
POS ticket (one glance = who, address, items, amount due, payment method). The map is
the mini element here — inverted from the console. Buttons are 56px min height,
thumb-reach bottom cluster, one primary action per screen state. A driver who has
never seen software must never wonder what to press next.

## Customer tracking page

One card + the map. Driver position, stops-away chip (`2 STOPS AWAY`), ETA window,
order summary. No account, no chrome, loads in under a second on 4G.

## Honesty rail

Demo state is labeled `DEMO FLEET` in a mono chip, top-left, always visible in demo
mode. Simulated GPS in the driver app shows `SIM GPS`. We never dress simulation as
production traffic — the label is part of the credibility story, not a disclaimer.

## Anti-slop checklist (QA gate)

- [ ] Basemap re-shaded through our values (NieR rule) — zero default-OSM colors
- [ ] One display-size numeral max per panel
- [ ] Zero gradient buttons, zero emoji in UI, zero purple-on-white template look
- [ ] Amber appears ONLY on actionable exceptions
- [ ] Plate headers everywhere a section starts
- [ ] Mono for every identifier and timestamp
- [ ] Dark AND light verified on the actual map, not just panels
