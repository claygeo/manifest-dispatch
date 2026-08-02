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
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
})
