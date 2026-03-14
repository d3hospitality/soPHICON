// ═══════════════════════════════════════════════════════════════════
// soΦcon — Image Utilities v6
// Logo: container IDs 3 (top) and 10 (bottom)
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import { encodeGrayscalePng } from './pngEncoder';

async function fetchAsGrayscalePng(source: string, w: number, h: number): Promise<Uint8Array> {
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
  return encodeGrayscalePng(w, h, gray);
}

async function pushImg(bridge: EvenAppBridge, id: number, name: string, data: Uint8Array): Promise<void> {
  await bridge.updateImageRawData(new ImageRawDataUpdate({
    containerID: id, containerName: name, imageData: Array.from(data),
  }));
}

/** Logo: container 3 = top, container 10 = bottom */
export async function pushLogoToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  try {
    const topPng = await fetchAsGrayscalePng(baseUrl + "assets/soPHICON-Top-Logo-200x100.png", 200, 100);
    await pushImg(bridge, 3, "logo top", topPng);
    console.log("[soΦcon] Logo top ✓");
  } catch (e) { console.error("[soΦcon] Logo top FAILED:", e); }

  try {
    const botPng = await fetchAsGrayscalePng(baseUrl + "assets/soPHICON-Bottom-Logo-200x100.png", 200, 100);
    await pushImg(bridge, 10, "logo bottom", botPng);
    console.log("[soΦcon] Logo bottom ✓");
  } catch (e) { console.error("[soΦcon] Logo bottom FAILED:", e); }
}

/** Split a sprite into two halves for portrait display */
export async function pushSpritesSplit(
  bridge: EvenAppBridge, baseUrl: string, spritePath: string,
  topID: number, topName: string, botID: number, botName: string,
): Promise<void> {
  const url = `${baseUrl}sprites/${spritePath}`;
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
    const png = await fetchAsGrayscalePng(`${baseUrl}sprites/${spritePath}`, w, h);
    await pushImg(bridge, containerID, containerName, png);
    console.log(`[soΦcon] Sprite ✓ ${spritePath}`);
  } catch (e) { console.warn(`[soΦcon] Sprite FAILED: ${spritePath}`, e); }
}
