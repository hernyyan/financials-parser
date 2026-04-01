import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Polyfills for ExcelJS browser compatibility (xlsx parsing only — no crypto)
      stream: 'stream-browserify',
      events: 'events',
      buffer: 'buffer',
      path: 'path-browserify',
    },
  },
  define: {
    global: 'globalThis',
  },
  server: {
    port: 5173,
  },
})
