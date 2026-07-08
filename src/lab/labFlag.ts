// ═══════════════════════════════════════════════════════════════════
// G2 UX LAB — mode flag (src/lab/labFlag.ts)
//
// Dev-only. The lab activates ONLY when explicitly requested:
//   • URL query:  ?lab=1
//   • URL hash:   #lab            (doubles as the deep-link to the Lab tab)
//   • Build env:  VITE_G2_UX_LAB=1
//
// Everything lab-related is gated behind isLabMode() and dynamically
// imported, so a normal production boot never loads lab code and
// behavior outside lab mode is byte-for-byte unchanged.
// ═══════════════════════════════════════════════════════════════════

let cached: boolean | null = null;

export function isLabMode(): boolean {
  if (cached !== null) return cached;
  let on = false;
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('lab') === '1') on = true;
    if (window.location.hash.replace('#', '').split(/[&/]/).includes('lab')) on = true;
  } catch { /* non-browser context */ }
  try {
    if ((import.meta as any).env?.VITE_G2_UX_LAB === '1') on = true;
  } catch { /* env not available */ }
  cached = on;
  return on;
}
