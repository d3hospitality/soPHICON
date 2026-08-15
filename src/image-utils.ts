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

// ═══ Portrait halftone (blowout fix + bloom fix, 2026-08-15) ═══
//
// TWO hardware facts drive this, and they pull in opposite directions.
//
// 1. The panel DISCARDS requested grey. A solid mid-grey fill thresholds
//    to full brightness (measured: rgb(120,120,120) came back 255 on
//    every pixel). Sending continuous luminance — which the old soft-knee
//    tone curve did — collapses every midtone in a painted portrait to
//    maximum. Socrates rendered 47% lit with his robe one featureless
//    slab. So tone MUST be carried by dot density, not by grey value.
//
// 2. The display is EMISSIVE AND BLOOMS: bright pixels spread on-lens and
//    swallow their neighbours. So a DISPERSED screen (plain Bayer, single
//    pixels one apart, all at 255) is the worst possible choice — every
//    dot blooms into the gap beside it and the portrait turns to haze.
//    This is why the first halftone read fine in the simulator, which has
//    no bloom, and poorly on real glasses.
//
// The answer to both is a CLUSTERED-DOT screen at a capped brightness:
// lit pixels are grouped into blobs separated by genuine dark gaps, so
// bloom fills the gaps INSIDE a cluster (making it read as a solid dot)
// instead of merging separate clusters. DOT_VALUE stays under 255 for the
// same reason the old curve capped highlights at 216.
//
// Runtime A/B on real hardware — the only place this can be judged:
//   ?sprite=fine     dispersed Bayer 8x8            (default)
//   ?sprite=cluster  1x1 clustered dots
//   ?sprite=coarse   2x2 clustered dots, most bloom-resistant
//   ?sprite=tone     the old continuous-grey curve  (pre-1.8.1)

/** Clustered-dot 4x4: thresholds grow outward from a centre, so lit
 *  pixels form blobs rather than scattering. */
const CLUSTER4: number[] = [
  12,  5,  6, 13,
   4,  0,  1,  7,
  11,  3,  2,  8,
  15, 10,  9, 14,
];
/** Dispersed Bayer 8x8 — finer gradation, but only safe without bloom. */
const BAYER8: number[] = [
   0, 32,  8, 40,  2, 34, 10, 42,  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,  63, 31, 55, 23, 61, 29, 53, 21,
];

type SpriteMode = 'cluster' | 'coarse' | 'fine' | 'tone';
function spriteMode(): SpriteMode {
  try {
    const q = new URLSearchParams(location.search).get('sprite') || '';
    if (q === 'cluster' || q === 'coarse' || q === 'tone') return q;
  } catch { /* no location */ }
  return 'fine';
}
const SPRITE_MODE: SpriteMode = spriteMode();

// The background floor. Anything at or under this is treated as canvas
// and stays OFF, so auto-levels never stretches the black surround up
// into visible noise.
const BLACK_POINT = 24;
const GAMMA = 0.85;        // slight midtone lift; the source art is dark
// Under 255 on purpose: a dot at maximum blooms hardest, and bloom is
// what destroys a halftone on this emissive panel.
const DOT_VALUE = 216;

/** Per-sprite exposure normalisation, by TARGET COVERAGE.
 *
 * The source art is inconsistently exposed. Measured across the set, the
 * subject occupies 15%-55% of the frame above the black floor and p98
 * luminance ranges 86..161. With one fixed white point the bright
 * sprites blew out into a slab and the dark ones (Nagarjuna, Marcus/
 * defiance, Aristotle) rendered at 3-6% lit — a ghost that reads as "no
 * sprite attached", which is exactly how it was reported.
 *
 * Stretching each sprite to its own p98 was not enough: it lifts
 * proportionally, so a genuinely dim subject stays dim (it actually
 * WIDENED the spread, 22 -> 27 points). Instead, solve for the white
 * point that makes each sprite render at the same DOT COVERAGE. That is
 * the quantity the eye reads as "weight" on this display, and it brings
 * the set to 11%-21% (spread 10 points) — every portrait arriving with
 * comparable presence regardless of how it was painted.
 *
 * Bisection over a 256-bin histogram: ~24 iterations of a 232-bin sum,
 * once per sprite per size, and the result is cached with the encoded
 * bytes. */
const TARGET_COVERAGE = 0.20;

function solveWhitePoint(lum: Float32Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) hist[Math.max(0, Math.min(255, lum[i] | 0))]++;
  const n = lum.length;

  // Mean dot density if `white` were the top of the range. Monotonically
  // DECREASING in white, so plain bisection converges.
  const coverageAt = (white: number): number => {
    if (white <= BLACK_POINT) return 1;
    const span = white - BLACK_POINT;
    let sum = 0;
    for (let v = BLACK_POINT + 1; v < 256; v++) {
      const c = hist[v];
      if (c) sum += c * Math.pow(Math.min(1, (v - BLACK_POINT) / span), GAMMA);
    }
    return sum / n;
  };

  let lo = BLACK_POINT + 8, hi = 255;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (coverageAt(mid) > TARGET_COVERAGE) lo = mid; else hi = mid;
  }
  return Math.max(BLACK_POINT + 20, Math.min(255, (lo + hi) / 2));
}

/** Luminance → lit / unlit, by dot density rather than grey value.
 *  `white` comes from autoWhitePoint for this specific sprite. */
function halftone(lum: number, x: number, y: number, white: number): number {
  if (SPRITE_MODE === 'tone') {
    // Legacy continuous-grey curve, kept for A/B only.
    return lum <= 170 ? lum : 170 + (lum - 170) * (216 - 170) / (255 - 170);
  }
  if (lum <= BLACK_POINT) return 0;
  const norm = Math.min(1, (lum - BLACK_POINT) / (white - BLACK_POINT));
  let density = Math.pow(norm, GAMMA);

  if (SPRITE_MODE === 'fine') {
    // Highlights go SOLID rather than staying screened. With auto-levels
    // the top of the range is real subject, and leaving it dotted made
    // the whole portrait read as texture instead of a face.
    if (density >= 0.88) return DOT_VALUE;
    const t = (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
    return density > t ? DOT_VALUE : 0;
  }
  // Clustered screens. 'coarse' doubles the cell (each threshold covers a
  // 2x2 block), which survives heavier bloom at the cost of resolution.
  const cell = SPRITE_MODE === 'coarse' ? 2 : 1;
  const cx = ((x / cell) | 0) & 3;
  const cy = ((y / cell) | 0) & 3;
  const t = (CLUSTER4[cy * 4 + cx] + 0.5) / 16;
  // Hold the extremes fully off / fully on so highlights stay solid and
  // shadow stays clean; the screen only modulates the middle.
  if (density >= 0.94) return DOT_VALUE;
  density *= 0.92;
  return density > t ? DOT_VALUE : 0;
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
  // Two passes: luminance first, so auto-levels can see the whole
  // sprite's histogram before any pixel is thresholded.
  const lum = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i++) {
    const o = i * 4;
    lum[i] = 0.299 * px[o] + 0.587 * px[o+1] + 0.114 * px[o+2];
  }
  const white = solveWhitePoint(lum);
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = ghost
      ? ditherGray(lum[i], i % w, (i / w) | 0, ghost.coverage, ghost.dot)
      : halftone(lum[i], i % w, (i / w) | 0, white);
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

    // Auto-level across the WHOLE 200x200 figure before splitting: level
    // each half independently and the two halves land on different
    // exposures, which shows as a hard seam across the portrait's middle.
    const fullLum = new Float32Array(200 * 200);
    for (let i = 0; i < fullLum.length; i++) {
      const o = i * 4;
      fullLum[i] = 0.299*full[o] + 0.587*full[o+1] + 0.114*full[o+2];
    }
    const whiteFull = solveWhitePoint(fullLum);
    const gray = (i: number, x: number, y: number): number => {
      const l = fullLum[i];
      return ghost ? ditherGray(l, x, y, ghost.coverage, ghost.dot) : halftone(l, x, y, whiteFull);
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
