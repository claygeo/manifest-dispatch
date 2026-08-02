import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// DESIGN v2 register. UI: Familjen Grotesk 400/500/600/700 — every interface
// string. Display serif: Source Serif 4 500/600 — the warmth moments only
// (tracking headline, run-complete, empty states). Mono: IBM Plex Mono 400/500
// — compliance artifacts only (order codes, manifest ids, stamps, the printable
// document). NOT Inter — Inter is the template tell (DESIGN.md).
// Latin subsets only: the full imports ship cyrillic/greek/vietnamese too and
// cost ~75 kB of CSS plus 20 unused font files against a mobile perf budget.
import '@fontsource/familjen-grotesk/latin-400.css'
import '@fontsource/familjen-grotesk/latin-500.css'
import '@fontsource/familjen-grotesk/latin-600.css'
import '@fontsource/familjen-grotesk/latin-700.css'
import '@fontsource/source-serif-4/latin-500.css'
import '@fontsource/source-serif-4/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'

import 'maplibre-gl/dist/maplibre-gl.css'
import './theme.css'

import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Manifest: #root missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
