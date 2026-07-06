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

async function fetchAsGrayscalePng(source: string, w: number, h: number): Promise<Uint8Array> {
  const key = `${source}@${w}x${h}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const resp = await fetch(source);
  if (!resp.ok) throw new Error(`Fetch ${resp.status}: ${source}`);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);

  const scale = Math.min(w / bmp.width, h / bmp.height);
  const fitW = Math.round(bmp.width * scale);
  const fitH = Math.round(bmp.height * scale);
  const offX = Math.round((w - fitW) / 2);
  const offY = Math.round((h - fitH) / 2);

  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, offX, offY, fitW, fitH);

  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = 0.299 * px[o] + 0.587 * px[o+1] + 0.114 * px[o+2];
  }
  const bytes = encodeGrayscalePng(w, h, gray);
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
export async function pushLogoToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  try {
    const topPng = await fetchAsGrayscalePng(assetUrl("assets/soPHICON-Top-Logo-200x100.png"), 200, 100);
    await pushImg(bridge, 3, "logo top", topPng);
    console.log("[soΦcon] Logo top ✓");
  } catch (e) { console.error("[soΦcon] Logo top FAILED:", e); }

  try {
    const botPng = await fetchAsGrayscalePng(assetUrl("assets/soPHICON-Bottom-Logo-200x100.png"), 200, 100);
    await pushImg(bridge, 10, "logo bottom", botPng);
    console.log("[soΦcon] Logo bottom ✓");
  } catch (e) { console.error("[soΦcon] Logo bottom FAILED:", e); }
}

/** Split a sprite into two halves for portrait display */
export async function pushSpritesSplit(
  bridge: EvenAppBridge, baseUrl: string, spritePath: string,
  topID: number, topName: string, botID: number, botName: string,
): Promise<void> {
  const url = assetUrl(`sprites/${spritePath}`);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    const cvs = document.createElement('canvas');
    cvs.width = 200; cvs.height = 200;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 200, 200);
    const scale = Math.min(200 / bmp.width, 200 / bmp.height);
    const fw = Math.round(bmp.width * scale);
    const fh = Math.round(bmp.height * scale);
    ctx.drawImage(bmp, Math.round((200-fw)/2), Math.round((200-fh)/2), fw, fh);
    const full = ctx.getImageData(0, 0, 200, 200).data;

    // Top half
    const topG = new Uint8Array(200 * 100);
    for (let i = 0; i < 200*100; i++) { const o = i*4; topG[i] = 0.299*full[o]+0.587*full[o+1]+0.114*full[o+2]; }
    await pushImg(bridge, topID, topName, encodeGrayscalePng(200, 100, topG));

    // Bottom half
    const botG = new Uint8Array(200 * 100);
    for (let i = 0; i < 200*100; i++) { const o = (i+200*100)*4; botG[i] = 0.299*full[o]+0.587*full[o+1]+0.114*full[o+2]; }
    await pushImg(bridge, botID, botName, encodeGrayscalePng(200, 100, botG));

    console.log(`[soΦcon] Sprite split ✓ ${spritePath}`);
  } catch (e) { console.warn(`[soΦcon] Sprite split FAILED: ${spritePath}`, e); }
}

/** Single sprite into one container */
export async function pushSpriteSingle(
  bridge: EvenAppBridge, baseUrl: string, spritePath: string,
  containerID: number, containerName: string, w: number, h: number,
): Promise<void> {
  try {
    const png = await fetchAsGrayscalePng(assetUrl(`sprites/${spritePath}`), w, h);
    await pushImg(bridge, containerID, containerName, png);
    console.log(`[soΦcon] Sprite ✓ ${spritePath}`);
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
