import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// UI: IBM Plex Sans 400/500/600. Data & identifiers: IBM Plex Mono 400/500.
// NOT Inter — Inter is the template tell (DESIGN.md).
// Latin subsets only: the full imports ship cyrillic/greek/vietnamese too and
// cost ~75 kB of CSS plus 20 unused font files against a mobile perf budget.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
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
