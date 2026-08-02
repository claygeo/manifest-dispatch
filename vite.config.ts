import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Manifest — dispatch demo. Single-page app, client-side routing.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
})
