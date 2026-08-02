# Manifest — Design System v2 ("warm professional")

v2 direction (operator call, 2026-08-02): v1's instrument/control-room register read
as technical-heavy. Manifest should feel like the Claude desktop app feels — warm
paper, friendly type, soft edges — while staying a credible tool for a
controlled-substance delivery operation. The rule that governs every decision:

**Friendliness is a surface, not a density.** Chrome, cards, customer pages, and
empty states are soft and warm. Operational data (stop lists, tables, tickets,
the event feed) stays tight, scannable, and calm. No pastel data fills, no
playful motion, no emoji, no toy energy.

## The one big idea: the map is still the page

Unchanged from v1: the dispatch console has no app chrome hosting a map widget —
the map IS the viewport, controls float over it. The basemap must wear OUR
palette (re-authored MapLibre style, both themes). If it looks like default OSM
or Google Maps, it is wrong.

## Typography

Claude's actual faces (Styrene B, Tiempos) are commercial and cannot ship. We use
their closest open twins, self-hosted via Fontsource:

- **UI: Familjen Grotesk** (400/500/600/700) — all interface text. Sentence case
  by default; the v1 wall-to-wall ALL-CAPS mono headers are gone.
- **Display serif: Source Serif 4** (500/600) — the warmth register, used
  sparingly and deliberately: page/wordmark moments, the customer tracking
  headline ("Arriving by 1:01 PM"), empty states, the run panel's one display
  numeral may pair with a serif label. Never for dense data.
- **Mono: IBM Plex Mono** (400/500) — compliance artifacts only: order codes,
  manifest IDs, timestamps, coordinates, the printable manifest document. Mono is
  the *document* voice, not the UI voice.

Scale keeps v1's glance-anchor discipline (each panel: at most ONE display-size
number, supporting data small) — that's information design, not styling, and it
stays. Weights and case do the softening.

## Palette

One warm neutral field, ONE primary action hue (sage/forest — quietly right for
the industry without leaf cliché), terracotta as brand warmth, amber reserved for
actionable exceptions. Teal is dead.

### Light — "Sunrise paper" (default)
- Field: `#F5F1EA` page/land · cards `#FFFFFF` · borders `#E4DCCE`
- Map: land `#F3EEE5`, water `#DFE5E0`, parks `#E8EDE2`, roads white ramps,
  labels warm grey — cream cartography, softer than v1's ink-and-paper
- Ink: `#2A2620` primary · `#6B6459` secondary · `#A39B8D` disabled
- **Primary action (sage/forest): `#3F6F51`** — buttons, active routes, live
  drivers, en-route states. Hover `#356044`. Positive/delivered: `#7A9B76`.
- **Terracotta warmth: `#D97757`** — wordmark, customer-facing accents, selected
  driver/stop glow, secondary CTAs. Never the ops primary.
- Exceptions: `#B26F1D` amber, actionable only.

### Dark — "Warm charcoal" (Claude dark, not phosphor night)
- Field: `#262624` page/land · cards `#30302E` · borders `#3E3C38` · map water `#1E1E1C`
- Ink: `#F0EDE6` / `#B8B2A6` / `#807A6E`
- Primary sage `#7FB08A` · terracotta `#E08B6D` · amber `#E8A33D`

State on identical components stays border+fill treatment (never new shapes or
extra colors). Delivered dims to field values — no celebration green.

## Shape & depth

Dual radius, per the density rule:
- **Soft (14px):** cards, panels, modals, customer tracking card, driver primary
  buttons, empty states. Chips are full pills.
- **Tight (8px):** dense ops rows — stop tickets, table rows, feed entries,
  small controls.
- Shadows: two soft layers (ambient + key), low opacity, warm-tinted. No hairline
  1px-only austerity, no heavy drops.

## Components

- **Section headers:** sentence-case Familjen 600 with a small mono suffix where
  an ID belongs ("Run A — South Tampa" + `MAN-2026-0802-A`). The v1 inverted
  black plate bars survive ONLY in the printable manifest document.
- **Stop tickets:** unchanged geometry discipline (identical cards, status =
  left border + tint + one pill chip), re-toned to the new palette, 8px radius.
- **Dual-resolution metrics:** keep (`Stop 3/4`, value/ceiling pairs), pills now.
- **Event feed:** stays a tight transcript; mono timestamps stay.
- **ETA drift:** inline `4:12 → 4:19` stays.
- **Buttons:** primary = sage fill, white text, 14px radius, 56px+ on driver.
  Secondary = warm outline. Terracotta only on customer surface CTAs.
- **Glass panels:** slightly warmer translucency over the map; opaque headers.

## Motion

Unchanged: metabolic, not performative. Lerped driver glide, ticking numerals,
150–250ms ease-out transitions. Softness comes from color and shape, not bounce.

## Driver app & customer page

Driver: same POS ticket-first flow; the friendliest surfaces in the app —
sentence-case microcopy ("Tap when you pull up"), big soft primary button,
serif moment on the run-complete screen. Customer tracking: the most
Claude-like surface — cream card, serif "Arriving by" headline, terracotta
accents, zero chrome.

## Compliance manifest document

Deliberately formal: mono, plate headers, signature rules — it is a legal
artifact and its seriousness is diegetic. Warm the paper tone, change nothing
else. The contrast between friendly app and formal document is the point.

## Honesty rail

Unchanged: `Demo fleet` pill always visible in demo mode, `Sim GPS` labeled,
fictional-data footer on customer surface. Friendlier casing, same honesty.

## Anti-slop checklist (QA gate)

- [ ] Basemap re-shaded through v2 values — zero default-OSM colors, zero v1 teal
- [ ] One display-size numeral max per panel (unchanged)
- [ ] Terracotta appears on ZERO ops primary actions; sage owns actions
- [ ] Amber only on actionable exceptions
- [ ] ALL-CAPS mono headers only inside the printable manifest
- [ ] Serif only at display moments — never in dense data
- [ ] Dual radius respected (soft cards / tight data)
- [ ] No emoji, no pastel data fills, no bounce
- [ ] Dark AND light verified ON the map, not just panels
