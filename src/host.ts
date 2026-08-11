// ═══════════════════════════════════════════════════════════════════
// Host capability fork — desktop simulator vs phone host.
//
// The 0.8.0 DESKTOP SIMULATOR speaks a pre-2.2.9 protocol: it rejects
// the whole page payload on any field it does not know, with
//   "unknown field `textColor`, expected one of `xPosition`, ..."
// (verified 2026-08-11 — same failure mode as the SDK-0.0.12 textSize
// incident: one unknown field on one container blanks every page).
//
// There is deliberately NO feature detection against real hosts — the
// early-access doc forbids it and provides no probe. This fork keys on
// the same desktop-UA heuristic image-utils.ts already uses for the
// image wire format: phone host (Even Hub on iOS/Android) → full 2.2.9
// payload; desktop context (simulator, dev browser) → 0.0.12-safe
// payload with the new fields stripped.
//
// DELETE THIS MODULE when the simulator ships 2.2.9 protocol support —
// grep for hostSupports214 to find every fork.
// ═══════════════════════════════════════════════════════════════════

function detectDesktop(): boolean {
  try {
    const ua = navigator.userAgent || '';
    const touches = navigator.maxTouchPoints || 0;
    return /Macintosh|Windows NT|X11; Linux/i.test(ua) && touches === 0;
  } catch { return false; }
}

/** True when the host accepts SDK 0.0.14 page fields
 *  (menuObject, textColor). Phone hosts: yes. Desktop simulator: no. */
export const hostSupports214: boolean = !detectDesktop();

if (!hostSupports214) {
  console.log('[soΦcon] desktop host: stripping 0.0.14 page fields (menuObject, textColor) — simulator protocol is pre-2.2.9');
}
