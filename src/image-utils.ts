// ═══════════════════════════════════════════════════════════════════
// soΦcon — Image Utilities v6
// Logo: container IDs 3 (top) and 10 (bottom)
//
// ▸ Sprite + logo fetches go through assetUrl() which resolves paths
//   RELATIVE to the current document URL via import.meta.env.BASE_URL.
//   With vite.config.ts `base: './'`, BASE_URL is `./` everywhere, so
//   `./sprites/socrates/socrates-neutral.png` resolves against whatever
//   origin the page was loaded from:
//     • GitHub Pages     → https://d3hospitality.github.io/soPHICON/sprites/...
//     • Phone WebView    → file://(packaged-app-dir)/sprites/...
//     • Vite dev server  → http://localhost:5173/sprites/...
//   This means the phone WebView fetches the LOCALLY-bundled sprites
//   (copied from public/sprites/ → dist/sprites/ → installed on the
//   phone alongside index.html) — no external network hop required.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import { encodeGrayscalePng } from './pngEncoder';

// ═══ Image wire format (SDK 0.0.12 regression fix, 2026-07-14) ═══
// SDK 0.0.12 stamps `compressMode: 2` on every updateImageRawData payload
// (verified by executing dist/index.cjs — the JS SDK itself compresses
// nothing and sniffs nothing; 0.0.11 sent no such flag). Under that flag
// the REAL Even App host takes the raw-blit path: payload = RAW 8-bit
// grayscale pixels (w×h bytes, row-major), host converts to gray4 and
// LZ4-compresses for BLE. Our historic custom PNG (required on 0.0.7–
// 0.0.11) is now blitted as raw bytes on real hardware → the per-scanline
// filter byte shears the image exactly 1px/row ("skewed as fuck").
// The 0.8.0 DESKTOP SIMULATOR is the opposite: it decodes PNG and renders
// raw bytes as nothing (verified 2026-07-14). So the wire format forks on
// the runtime: phone hosts (Even Hub on iOS/Android) → raw-gray8; desktop
// contexts (simulator, dev browser) → png. iPadOS masquerades as
// Macintosh in the UA, hence the maxTouchPoints check.
function detectWireFormat(): 'raw-gray8' | 'png' {
  try {
    const ua = navigator.userAgent || '';
    const touches = navigator.maxTouchPoints || 0;
    const desktop = /Macintosh|Windows NT|X11; Linux/i.test(ua) && touches === 0;
    return desktop ? 'png' : 'raw-gray8';
  } catch { return 'raw-gray8'; }
}
const IMAGE_WIRE_FORMAT: 'raw-gray8' | 'png' = detectWireFormat();
console.log(`[soΦcon] image wire: ${IMAGE_WIRE_FORMAT} (ua: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'})`);

/** Encode a gray8 buffer for the wire per IMAGE_WIRE_FORMAT. */
function encodeWire(gray: Uint8Array, w: number, h: number): Uint8Array {
  return IMAGE_WIRE_FORMAT === 'raw-gray8' ? gray : encodeGrayscalePng(w, h, gray);
}

/** Build an asset URL relative to the document. `relPath` should NOT
 * start with a slash (e.g. 'sprites/socrates/socrates-neutral.png'). */
function assetUrl(relPath: string): string {
  const baseUrl = import.meta.env.BASE_URL || './';
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const rel = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return base + rel;
}

// ═══ Sprite encoded-PNG cache ═══
// Keyed by "<spritePath>@<w>x<h>". Hits skip fetch + canvas + encode.
// Typical entry is ~2–8 KB; capacity 120 covers all 391 sprites × 2 common
// sizes without pressuring memory on the WebView.
const SPRITE_CACHE_CAP = 120;
const spriteCache = new Map<string, Uint8Array>();
const pushLog: { ts: number; key: string; ms: number; ok: boolean; err?: string }[] = [];
const PUSH_LOG_CAP = 50;

export function getSpritePushLog(): ReadonlyArray<{ ts: number; key: string; ms: number; ok: boolean; err?: string }> {
  return pushLog;
}
export function clearSpriteCache(): void {
  spriteCache.clear();
}
function cacheSet(key: string, bytes: Uint8Array) {
  if (spriteCache.size >= SPRITE_CACHE_CAP) {
    // Drop oldest (insertion-ordered Map)
    const firstKey = spriteCache.keys().next().value;
    if (firstKey !== undefined) spriteCache.delete(firstKey);
  }
  spriteCache.set(key, bytes);
}

// ═══ Ghost layers: halftone dithering, NOT value-dimming ═══
// The G2 firmware normalizes/stretches grayscale during its 4-bit
// conversion (observed on hardware 2026-07-14: encode-side dimmed pixels
// rendered at full brightness — the simulator renders values as-is, which
// hid this). There is also no opacity/alpha property anywhere in the SDK.
// So perceived brightness for background "ghost" layers is carried by DOT
// DENSITY (ordered Bayer 4×4 halftone): normalization can brighten the
// dots, but it cannot add dots. `dim` (0–1) is the halftone coverage —
// ~0.45 reads as a watermark behind text on-glass.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const GHOST_DOT = 150; // mid-bright dot; density does the real dimming
function ditherGray(lum: number, x: number, y: number, coverage: number, dot: number = GHOST_DOT): number {
  const threshold = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
  return (lum / 255) * coverage > threshold ? dot : 0;
}

// ═══ Highlight tone curve (hardware bloom fix, 2026-07-14) ═══
// The G2 is an emissive green display: near-full-luminance pixels bloom
// on-lens and swallow neighbouring detail. A flat gain (×0.62) fixed the
// bloom but crushed the whole ramp into ~9 of the 16 gray4 levels —
// sprites went flat/undetailed. This soft-knee curve instead keeps
// shadows + midtones at FULL resolution (identity below the knee, where
// sprite detail lives) and only compresses the highlights into a
// non-blooming ceiling. Applies to NORMAL sprites only — ghost dots carry
// their own explicit value. Tune: knee 150–190, ceiling 200–230.
const TONE_KNEE = 170; // identity below this
const TONE_MAX = 216;  // highlight ceiling (≈ gray4 level 13/15)
function toneMap(lum: number): number {
  return lum <= TONE_KNEE
    ? lum
    : TONE_KNEE + (lum - TONE_KNEE) * (TONE_MAX - TONE_KNEE) / (255 - TONE_KNEE);
}

// ═══ Ghost depth presets (perceived-z tuning) ═══
// Depth is faked with dot density + dot brightness (contrast) and source
// blur (atmospheric perspective). Hardware A/B (2026-07-14): the faint
// dithered look won; the occlusion x-shift preset died on-glass —
// overlapping image containers are the suspect, so ghost planes never
// overlap other images anymore. 'jumble' stacks a THIRD image plane: a
// small sharper "echo" of the emotion at its own z-depth between the far
// ghost and the text. Select at runtime with ?ghost=dense|jumble on the
// app URL (default = the tuned faint look).
export type GhostStyle = { coverage: number; dot: number; blur?: number };
export type GhostEcho = { x: number; y: number; size: number; style: GhostStyle };
export function ghostPreset(): { style: GhostStyle; echo?: GhostEcho; label: string } {
  let q = '';
  try { q = new URLSearchParams(location.search).get('ghost') || ''; } catch { /* no-op */ }
  switch (q) {
    case 'dense':  return { style: { coverage: 0.85, dot: 220 }, label: 'dense' };
    case 'jumble': return {
      style: { coverage: 0.18, dot: 70, blur: 64 },
      echo: { x: 420, y: 160, size: 100, style: { coverage: 0.38, dot: 115 } },
      label: 'jumble',
    };
    // Default = the hardware-approved faint look, with a gentler blur
    // (72-px source keeps more figure detail than the A/B's 48) and a
    // touch more coverage so the mood stays present.
    default: return { style: { coverage: 0.24, dot: 80, blur: 72 }, label: 'faint' };
  }
}

// Optional `ghost` style renders the image as a halftone ghost layer
// (coverage/dot per ditherGray; `blur` = downscale-then-upscale source
// size for soft focus). Without it, normal sprites get DISPLAY_GAIN.
// Cache key includes the style so variants coexist.
async function fetchAsGrayscalePng(source: string, w: number, h: number, ghost?: GhostStyle): Promise<Uint8Array> {
  const gkey = ghost ? `g${ghost.coverage}-${ghost.dot}-${ghost.blur || 0}` : 'n';
  const key = `${source}@${w}x${h}@${gkey}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const resp = await fetch(source);
  if (!resp.ok) throw new Error(`Fetch ${resp.status}: ${source}`);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);

  // Optional soft focus (see pushSpritesSplit) — bounce through a tiny
  // canvas so the upscale interpolation blurs the source.
  let src: CanvasImageSource = bmp;
  let srcW = bmp.width, srcH = bmp.height;
  if (ghost?.blur) {
    const small = document.createElement('canvas');
    small.width = ghost.blur; small.height = ghost.blur;
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(bmp, 0, 0, ghost.blur, ghost.blur);
    src = small; srcW = ghost.blur; srcH = ghost.blur;
  }

  const scale = Math.min(w / srcW, h / srcH);
  const fitW = Math.round(srcW * scale);
  const fitH = Math.round(srcH * scale);
  const offX = Math.round((w - fitW) / 2);
  const offY = Math.round((h - fitH) / 2);

  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, offX, offY, fitW, fitH);

  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    const lum = 0.299 * px[o] + 0.587 * px[o+1] + 0.114 * px[o+2];
    gray[i] = ghost
      ? ditherGray(lum, i % w, (i / w) | 0, ghost.coverage, ghost.dot)
      : toneMap(lum);
  }
  const bytes = encodeWire(gray, w, h);
  cacheSet(key, bytes);
  return bytes;
}

/**
 * Top-level sprite push helper. Takes a sprite path relative to
 * `public/sprites/` (e.g. "socrates/socrates-warm.png") plus target
 * container + size. Uses the encoded-PNG cache. Logs every push to
 * the debug ring buffer so the dashboard can display them.
 *
 * Caller is responsible for serialization — never call this concurrently
 * with another image push on the same bridge.
 */
export async function pushSprite(
  bridge: EvenAppBridge, baseUrl: string, spritePath: string,
  containerID: number, containerName: string, w: number, h: number,
): Promise<void> {
  const key = `${spritePath}@${w}x${h} → #${containerID}`;
  const t0 = Date.now();
  try {
    const bytes = await fetchAsGrayscalePng(assetUrl(`sprites/${spritePath}`), w, h);
    await pushImg(bridge, containerID, containerName, bytes);
    pushLog.unshift({ ts: t0, key, ms: Date.now() - t0, ok: true });
    if (pushLog.length > PUSH_LOG_CAP) pushLog.length = PUSH_LOG_CAP;
    console.log(`[soΦcon] pushSprite ✓ ${key} (${Date.now() - t0}ms)`);
  } catch (e: any) {
    pushLog.unshift({ ts: t0, key, ms: Date.now() - t0, ok: false, err: String(e?.message || e) });
    if (pushLog.length > PUSH_LOG_CAP) pushLog.length = PUSH_LOG_CAP;
    console.warn(`[soΦcon] pushSprite FAILED ${key}:`, e);
    throw e;
  }
}

async function pushImg(bridge: EvenAppBridge, id: number, name: string, data: Uint8Array): Promise<void> {
  await bridge.updateImageRawData(new ImageRawDataUpdate({
    containerID: id, containerName: name, imageData: Array.from(data),
  }));
}

/** Logo: container 3 = top, container 10 = bottom */
/** Dither density for the home watermark.
 *
 * The mark is LINE ART, not a photograph, and it dithers badly at low
 * density: 0.30 coverage with a 96px blur ate the figure alive and left
 * a narrow smear of its densest core. Line art has almost no mid-tones
 * for the dither to sample, so it needs high coverage and a sharp
 * source to keep its detail.
 *
 * 0.88 keeps the figure fully legible while still breaking it into
 * dots, which is the only way to make it sit back from the menu text:
 * requested grey is discarded by this panel, so density is the only
 * available dim. */
const HOME_GHOST: GhostStyle = { coverage: 0.88, dot: 235 };

export async function pushLogoToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  try {
    const topPng = await fetchAsGrayscalePng(assetUrl("assets/soPHICON-Top-Logo-200x100.png"), 200, 100, HOME_GHOST);
    await pushImg(bridge, 3, "logo top", topPng);
    console.log("[soΦcon] Logo top (ghosted) ✓");
  } catch (e) { console.error("[soΦcon] Logo top FAILED:", e); }

  try {
    const botPng = await fetchAsGrayscalePng(assetUrl("assets/soPHICON-Bottom-Logo-200x100.png"), 200, 100, HOME_GHOST);
    await pushImg(bridge, 10, "logo bottom", botPng);
    console.log("[soΦcon] Logo bottom (ghosted) ✓");
  } catch (e) { console.error("[soΦcon] Logo bottom FAILED:", e); }
}

/** Split a sprite into two halves for portrait display. Optional `ghost`
 * style renders both halves as a halftone ghost layer (see ditherGray;
 * `blur` = downscale-then-upscale source size for a soft out-of-focus
 * look) — this reuses the 200×100 image size proven on hardware, so
 * ghost layers ride the exact same push path as the portraits. */
export async function pushSpritesSplit(
  bridge: EvenAppBridge, baseUrl: string, spritePath: string,
  topID: number, topName: string, botID: number, botName: string,
  ghost?: GhostStyle,
): Promise<void> {
  const url = assetUrl(`sprites/${spritePath}`);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    // Optional soft focus: bounce the sprite through a tiny canvas so the
    // upscale interpolation blurs it (atmospheric perspective — distant
    // layers are soft). Runs before the letterbox draw below.
    let src: CanvasImageSource = bmp;
    if (ghost?.blur) {
      const small = document.createElement('canvas');
      small.width = ghost.blur; small.height = ghost.blur;
      const sctx = small.getContext('2d')!;
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(bmp, 0, 0, ghost.blur, ghost.blur);
      src = small;
    }
    const srcW = ghost?.blur || bmp.width;
    const srcH = ghost?.blur || bmp.height;

    const cvs = document.createElement('canvas');
    cvs.width = 200; cvs.height = 200;
    const ctx = cvs.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 200, 200);
    const scale = Math.min(200 / srcW, 200 / srcH);
    const fw = Math.round(srcW * scale);
    const fh = Math.round(srcH * scale);
    ctx.drawImage(src, Math.round((200-fw)/2), Math.round((200-fh)/2), fw, fh);
    const full = ctx.getImageData(0, 0, 200, 200).data;

    const gray = (i: number, x: number, y: number): number => {
      const o = i * 4;
      const lum = 0.299*full[o] + 0.587*full[o+1] + 0.114*full[o+2];
      return ghost ? ditherGray(lum, x, y, ghost.coverage, ghost.dot) : toneMap(lum);
    };

    // Top half
    const topG = new Uint8Array(200 * 100);
    for (let i = 0; i < 200*100; i++) topG[i] = gray(i, i % 200, (i / 200) | 0);
    await pushImg(bridge, topID, topName, encodeWire(topG, 200, 100));

    // Bottom half (Bayer y continues at 100 so the pattern doesn't seam)
    const botG = new Uint8Array(200 * 100);
    for (let i = 0; i < 200*100; i++) botG[i] = gray(i + 200*100, i % 200, 100 + ((i / 200) | 0));
    await pushImg(bridge, botID, botName, encodeWire(botG, 200, 100));

    console.log(`[soΦcon] Sprite split ✓ ${spritePath}${ghost ? ` (ghost ×${ghost.coverage} dot ${ghost.dot}${ghost.blur ? ` blur ${ghost.blur}` : ''})` : ''}`);
  } catch (e) { console.warn(`[soΦcon] Sprite split FAILED: ${spritePath}`, e); }
}

/** Single sprite into one container. Optional `ghost` style renders it
 * as a halftone layer for zOrderIndex depth composition. */
export async function pushSpriteSingle(
  bridge: EvenAppBridge, baseUrl: string, spritePath: string,
  containerID: number, containerName: string, w: number, h: number,
  ghost?: GhostStyle,
): Promise<void> {
  try {
    const png = await fetchAsGrayscalePng(assetUrl(`sprites/${spritePath}`), w, h, ghost);
    await pushImg(bridge, containerID, containerName, png);
    console.log(`[soΦcon] Sprite ✓ ${spritePath}${ghost ? ` (ghost ×${ghost.coverage} dot ${ghost.dot})` : ''}`);
  } catch (e) { console.warn(`[soΦcon] Sprite FAILED: ${spritePath}`, e); }
}

/** Push a sprite from an ARBITRARY source — an absolute http(s) URL (e.g. a
 * community member's avatar in Supabase storage) OR an asset-relative path
 * like "sprites/enki/enki-neutral.png". Non-throwing: a missing/blocked
 * avatar just leaves the slot empty. */
export async function pushSpriteFromUrl(
  bridge: EvenAppBridge, source: string,
  containerID: number, containerName: string, w: number, h: number,
): Promise<void> {
  try {
    const url = /^https?:\/\//.test(source) ? source : assetUrl(source);
    const png = await fetchAsGrayscalePng(url, w, h);
    await pushImg(bridge, containerID, containerName, png);
    console.log(`[soΦcon] Member sprite ✓ ${source}`);
  } catch (e) { console.warn(`[soΦcon] Member sprite FAILED: ${source}`, e); }
}
