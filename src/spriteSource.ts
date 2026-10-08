// ═══════════════════════════════════════════════════════════════════
// spriteSource.ts — where philosopher sprites come from.
//
// The EHPK used to bundle all 414 sprites (~32 MB). Now only each
// philosopher's NEUTRAL portrait ships in the package (offline floor);
// every emotion is pulled from the backend (Supabase Storage, public
// bucket `sprites`, already in app.json's network whitelist) and cached
// by the WebView like any image.
//
// Resolution order for any sprite path "socrates/socrates-joy.png":
//   1. backend   SPRITE_CDN + path
//   2. bundled   ./sprites/<path>              (web builds still ship all)
//   3. bundled   ./sprites/<phil>/<phil>-neutral.png  (always in the EHPK)
//
// Bump SPRITE_VERSION when sprites are re-uploaded: paths are versioned
// so long cache lifetimes are safe.
// ═══════════════════════════════════════════════════════════════════

export const SPRITE_VERSION = 'v1';
export const SPRITE_CDN =
  `https://afdrjzhcfltsngyxaqhb.supabase.co/storage/v1/object/public/sprites/${SPRITE_VERSION}/`;

function localBase(): string {
  const b = import.meta.env.BASE_URL || './';
  return (b.endsWith('/') ? b : b + '/') + 'sprites/';
}

/** Normalise "sprites/x/y.png", "/x/y.png", "./sprites/x/y.png" → "x/y.png". */
export function spriteRel(path: string): string {
  return path.replace(/^\.?\/*/, '').replace(/^sprites\//, '');
}

/** "socrates/socrates-joy.png" → "socrates/socrates-neutral.png" (or null). */
export function neutralFor(rel: string): string | null {
  const m = rel.match(/^([^/]+)\/\1-[^/]+\.png$/);
  return m ? `${m[1]}/${m[1]}-neutral.png` : null;
}

/** Ordered URLs to try for one sprite. */
export function spriteCandidates(path: string): string[] {
  const rel = spriteRel(path);
  const out = [SPRITE_CDN + rel, localBase() + rel];
  const n = neutralFor(rel);
  if (n && n !== rel) out.push(localBase() + n);
  return out;
}

/** Primary URL for <img src>; the phone's global error handler falls back. */
export function spriteImgUrl(path: string): string {
  return SPRITE_CDN + spriteRel(path);
}

/** Bundled fallback for an <img> whose backend URL failed. */
export function spriteLocalFallback(url: string): string | null {
  if (!url.startsWith(SPRITE_CDN)) return null;
  const rel = url.slice(SPRITE_CDN.length);
  return localBase() + (neutralFor(rel) || rel);
}

/** If `url` points at a sprite (backend or bundled), return its relative path. */
export function spritePathFromUrl(url: string): string | null {
  if (url.startsWith(SPRITE_CDN)) return url.slice(SPRITE_CDN.length);
  const m = url.match(/(?:^|\/)sprites\/(.+\.png)(?:\?.*)?$/);
  return m ? m[1] : null;
}

/** fetch() a sprite trying each candidate in order. Throws if all fail. */
export async function fetchSprite(path: string): Promise<Response> {
  let last = '';
  for (const url of spriteCandidates(path)) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return resp;
      last = `${resp.status} ${url}`;
    } catch (e) {
      last = `${(e as Error)?.message || e} ${url}`;
    }
  }
  throw new Error(`sprite unavailable: ${spriteRel(path)} (${last})`);
}

/** fetch() for any asset URL: sprites go through the fallback chain. */
export function fetchAsset(url: string): Promise<Response> {
  const sp = spritePathFromUrl(url);
  return sp ? fetchSprite(sp) : fetch(url);
}
