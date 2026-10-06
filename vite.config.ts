import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// The one version number: app.json (what Even Hub ships). Shown in the
// phone's Account section and written to storage at boot.
const APP_VERSION = JSON.parse(readFileSync(new URL('./app.json', import.meta.url), 'utf8')).version

// `base: './'` makes ALL bundle paths (assets in index.html AND
// import.meta.env.BASE_URL at runtime) RELATIVE to the document URL.
// This is the universal fix for serving the same build from:
//   • GitHub Pages           https://d3hospitality.github.io/soPHICON/
//   • Even Hub WebView       (packaged locally on the phone — file:// or
//                              custom origin, no internet required)
//   • Local preview          http://localhost:4173/soPHICON/
// All three resolve `./sprites/foo.png` against the current page URL,
// which always points at the bundled copy beside index.html.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
})
