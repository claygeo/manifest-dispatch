import { defineConfig } from 'vitest/config'

/**
 * Manifest test config.
 *
 * `environment: 'node'` on purpose. Everything under test — the store, the sim
 * engine, the geo/ETA maths, the seed — is deliberately DOM-free (the store
 * guards `typeof window`/`typeof document` so it can boot headless), so jsdom
 * would only add startup cost and a second, less honest runtime. The sim engine
 * needs `requestAnimationFrame`, which src/test/harness.ts supplies as a
 * hand-driven clock — which is stronger than jsdom's, because it makes frame
 * timing an input to the test rather than a source of flake.
 *
 * `css: true` is on for one reason: src/readability.test.ts imports the app's
 * stylesheets as source text (`./theme.css?raw`) to enforce the DESIGN.md v2
 * ink contract across every surface. Vitest's default is to replace CSS
 * imports with an empty string, which would silently hand that sweep nothing
 * to check. No component tests exist, so nothing else pays for this.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    css: true,
  },
})
