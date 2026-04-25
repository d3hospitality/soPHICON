import { defineConfig } from 'vite'

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
})
