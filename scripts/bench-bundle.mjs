/**
 * bench-bundle — what the browser actually downloads.
 *
 * Walks dist/ after a build and reports raw + gzip sizes per asset, plus the
 * critical-path total (the entry HTML and everything it loads eagerly) versus
 * the lazy chunks a visitor only pays for if they open that surface. The
 * split matters here: SPEC.md's whole "zero backend dependency for the
 * recruiter first-click" claim rests on the Supabase SDK NOT being in the
 * entry graph, and this is the check that keeps that honest.
 *
 * gzip (level 9) is what Netlify serves for these types. Brotli is reported
 * alongside because Netlify prefers it when the client advertises it — the
 * gzip column is the conservative number and the one quoted in BENCHMARKS.md.
 *
 * Usage: npm run build && npm run bench:bundle
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist')

/** Types Netlify compresses. Fonts (woff2) and images are already compressed. */
const COMPRESSIBLE = /\.(js|css|html|json|svg|webmanifest|txt|map)$/i

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`
}

let files
try {
  files = walk(DIST)
} catch {
  console.error('bench-bundle: dist/ not found — run `npm run build` first')
  process.exit(2)
}

const entryHtml = readFileSync(resolve(DIST, 'index.html'), 'utf8')
/** Assets the entry HTML references directly: script src, stylesheet href, modulepreload. */
const eagerRefs = new Set(
  [...entryHtml.matchAll(/(?:src|href)="\/([^"]+)"/g)].map((m) => m[1]),
)

const rows = files
  .map((full) => {
    const rel = relative(DIST, full).replace(/\\/g, '/')
    const buf = readFileSync(full)
    const compressible = COMPRESSIBLE.test(rel)
    return {
      file: rel,
      raw: statSync(full).size,
      gzip: compressible ? gzipSync(buf, { level: 9 }).length : buf.length,
      brotli: compressible
        ? brotliCompressSync(buf, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
          }).length
        : buf.length,
      eager: rel === 'index.html' || eagerRefs.has(rel),
      kind: rel.split('.').pop().toLowerCase(),
    }
  })
  .sort((a, b) => b.gzip - a.gzip)

const sum = (list, key) => list.reduce((n, r) => n + r[key], 0)
const code = rows.filter((r) => /^(js|css|html)$/.test(r.kind))
const eager = code.filter((r) => r.eager)
const lazy = code.filter((r) => !r.eager)
// @fontsource emits both formats. Every browser Manifest targets takes the
// woff2 (it is listed first in the @font-face src), so the woff files are dead
// weight on disk that no visitor downloads — counted separately, not summed
// into anything a user pays for.
const woff2 = rows.filter((r) => r.kind === 'woff2')
const woffLegacy = rows.filter((r) => r.kind === 'woff' || r.kind === 'ttf')

console.log(`bench-bundle — ${DIST}`)
console.log(`  files: ${rows.length}   generated: ${new Date().toISOString()}\n`)
console.log('  ' + 'asset'.padEnd(42) + 'raw'.padStart(11) + 'gzip'.padStart(11) + 'brotli'.padStart(11))
for (const r of rows) {
  if (r.raw < 2048 && !/^(js|css|html)$/.test(r.kind)) continue
  console.log(
    '  ' +
      `${r.eager ? '*' : ' '}${r.file}`.padEnd(42) +
      kb(r.raw).padStart(11) +
      kb(r.gzip).padStart(11) +
      kb(r.brotli).padStart(11),
  )
}

console.log('\n  (* = referenced by index.html, i.e. on the first-paint critical path)')
console.log('\nTOTALS (js + css + html)')
console.log(`  critical path : ${kb(sum(eager, 'raw'))} raw  ${kb(sum(eager, 'gzip'))} gzip  ${kb(sum(eager, 'brotli'))} brotli`)
console.log(`  lazy chunks   : ${kb(sum(lazy, 'raw'))} raw  ${kb(sum(lazy, 'gzip'))} gzip  ${kb(sum(lazy, 'brotli'))} brotli`)
console.log(`  all code      : ${kb(sum(code, 'raw'))} raw  ${kb(sum(code, 'gzip'))} gzip  ${kb(sum(code, 'brotli'))} brotli`)
console.log(
  `  fonts woff2   : ${kb(sum(woff2, 'raw'))} in ${woff2.length} files — already compressed, served as-is`,
)
console.log(
  `  fonts woff    : ${kb(sum(woffLegacy, 'raw'))} in ${woffLegacy.length} files — on disk only, no modern browser fetches these`,
)
console.log(`  first visit   : ~${kb(sum(eager, 'gzip') + sum(woff2, 'raw'))} over the wire (critical code gzipped + woff2)`)
console.log(`  dist total    : ${kb(sum(rows, 'raw'))} raw`)

console.log('\nJSON')
console.log(
  JSON.stringify(
    {
      at: new Date().toISOString(),
      criticalPath: { raw: sum(eager, 'raw'), gzip: sum(eager, 'gzip'), brotli: sum(eager, 'brotli') },
      lazy: { raw: sum(lazy, 'raw'), gzip: sum(lazy, 'gzip'), brotli: sum(lazy, 'brotli') },
      allCode: { raw: sum(code, 'raw'), gzip: sum(code, 'gzip'), brotli: sum(code, 'brotli') },
      fontsWoff2: { raw: sum(woff2, 'raw'), count: woff2.length },
      fontsWoffLegacy: { raw: sum(woffLegacy, 'raw'), count: woffLegacy.length },
      firstVisitBytes: sum(eager, 'gzip') + sum(woff2, 'raw'),
      distTotalRaw: sum(rows, 'raw'),
      assets: rows.map(({ file, raw, gzip, brotli, eager: e }) => ({ file, raw, gzip, brotli, eager: e })),
    },
    null,
    2,
  ),
)
