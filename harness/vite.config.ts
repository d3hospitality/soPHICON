import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const APP_VERSION = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).version

// Test harness only: the same app, with the Even SDK swapped for
// harness/mock-sdk.ts so it runs (and can be driven) in a plain browser.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  base: './',
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  resolve: {
    alias: {
      '@evenrealities/even_hub_sdk': fileURLToPath(new URL('./mock-sdk.ts', import.meta.url)),
    },
  },
  server: { port: 5199, strictPort: true },
})
