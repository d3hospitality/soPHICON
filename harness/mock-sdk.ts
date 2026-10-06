// ═══════════════════════════════════════════════════════════════════
// Test-only stand-in for @evenrealities/even_hub_sdk.
//
// Aliased in by harness/vite.config.ts so the REAL app code runs in a
// browser with no glasses: every page it sends is recorded, drawn on a
// 576×288 green "lens" canvas, and checked against the G2 limits. Tests
// drive input through window.__g2 (click / scroll / double / menu).
//
// Never shipped: the production build resolves the real SDK.
// ═══════════════════════════════════════════════════════════════════

type Any = Record<string, any>;

class Data { constructor(data?: Any) { if (data) Object.assign(this, data); } toJson() { return { ...this }; } }
export class CreateStartUpPageContainer extends Data {}
export class RebuildPageContainer extends Data {}
export class ListContainerProperty extends Data {}
export class TextContainerProperty extends Data {}
export class ImageContainerProperty extends Data {}
export class ListItemContainerProperty extends Data {}
export class MenuContainerProperty extends Data {}
export class MenuItemProperty extends Data {}
export class ImageRawDataUpdate extends Data {}
export class TextContainerUpgrade extends Data {}
export class EvenAppBridge {}
export type EvenHubEvent = Any;

export enum OsEventTypeList {
  CLICK_EVENT = 0, SCROLL_TOP_EVENT = 1, SCROLL_BOTTOM_EVENT = 2, DOUBLE_CLICK_EVENT = 3,
  FOREGROUND_ENTER_EVENT = 4, FOREGROUND_EXIT_EVENT = 5, ABNORMAL_EXIT_EVENT = 6,
  SYSTEM_EXIT_EVENT = 7, IMU_DATA_REPORT = 8, LONG_PRESS_EVENT = 9, LONG_PRESS_RELEASE_EVENT = 10,
}
export enum DeviceConnectType { None = 'none', Connecting = 'connecting', Connected = 'connected', Disconnected = 'disconnected', ConnectionFailed = 'connectionFailed' }
export enum AudioInputSource { Glasses = 'glasses', Phone = 'phone' }

// ─── Lens state ──────────────────────────────────────────────────────
interface Box { kind: 'text' | 'list' | 'image'; p: Any; }
const W = 576, H = 288;
const state = {
  boxes: [] as Box[],
  texts: new Map<number, string>(),
  images: new Map<number, ImageBitmap>(),
  listSel: new Map<number, number>(),
  menu: [] as Any[],
  pages: 0,
  log: [] as string[],
  violations: [] as string[],
  imageInflight: 0,
  mic: false,
  exitDialog: false,
};
let handler: ((e: Any) => void) | null = null;

function violation(msg: string) { state.violations.push(msg); console.warn('[G2 LIMIT]', msg); }
function note(msg: string) { state.log.push(`${(performance.now() / 1000).toFixed(2)} ${msg}`); }

function validate(page: Any, startup: boolean) {
  const lists = page.listObject || [], texts = page.textObject || [], images = page.imageObject || [];
  if (images.length > 4) violation(`page has ${images.length} image containers (max 4)`);
  if (lists.length + texts.length > 8) violation(`page has ${lists.length + texts.length} text/list containers (max 8)`);
  const capture = [...lists, ...texts].filter((c: Any) => c.isEventCapture === 1);
  if (capture.length !== 1) violation(`page has ${capture.length} event-capture containers (need exactly 1)`);
  for (const l of lists) {
    const items = l.itemContainer?.itemName || [];
    if (items.length > 20) violation(`list ${l.containerName} has ${items.length} items (max 20)`);
    for (const it of items) if (new TextEncoder().encode(it).length > 64) violation(`list item over 64 bytes: "${it}"`);
  }
  for (const t of texts) {
    const n = (t.content || '').length;
    if (n > (startup ? 1000 : 2000)) violation(`text ${t.containerName} has ${n} chars`);
  }
  for (const i of images) {
    if (i.width < 20 || i.width > 288 || i.height < 20 || i.height > 144) violation(`image ${i.containerName} is ${i.width}×${i.height}`);
  }
  for (const c of [...lists, ...texts, ...images]) {
    if (c.xPosition + c.width > W || c.yPosition + c.height > H) violation(`container ${c.containerName} spills off the lens`);
  }
}

function loadPage(page: Any, startup: boolean) {
  validate(page, startup);
  state.pages += 1;
  state.boxes = [
    ...(page.listObject || []).map((p: Any) => ({ kind: 'list' as const, p })),
    ...(page.textObject || []).map((p: Any) => ({ kind: 'text' as const, p })),
    ...(page.imageObject || []).map((p: Any) => ({ kind: 'image' as const, p })),
  ];
  state.texts.clear(); state.images.clear(); state.listSel.clear();
  for (const b of state.boxes) {
    if (b.kind === 'text') state.texts.set(b.p.containerID, b.p.content || '');
    if (b.kind === 'list') state.listSel.set(b.p.containerID, 0);
  }
  state.menu = page.menuObject?.menuItems || [];
  const names = state.boxes.map(b => `${b.kind}:${b.p.containerName}`).join(' ');
  note(`${startup ? 'CREATE' : 'REBUILD'} ${names}`);
  render();
}

// ─── Drawing ─────────────────────────────────────────────────────────
const GREEN = [61, 255, 79];
let canvas: HTMLCanvasElement | null = null;
function ensureCanvas() {
  if (canvas) return canvas;
  const wrap = document.createElement('div');
  wrap.id = 'g2-lens-wrap';
  wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;background:#000;padding:0;pointer-events:none;display:none';
  canvas = document.createElement('canvas');
  canvas.id = 'g2-lens'; canvas.width = W; canvas.height = H;
  wrap.appendChild(canvas);
  document.body.appendChild(wrap);
  return canvas;
}
function level(v: number | undefined, fallback = 15) { const n = v == null ? fallback : v; return Math.max(0, Math.min(15, n)) / 15; }
function rgba(a: number) { return `rgba(${GREEN[0]},${GREEN[1]},${GREEN[2]},${a})`; }

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const tryLine = line + word;
      if (ctx.measureText(tryLine).width > maxW && line.trim()) { out.push(line.trimEnd()); line = word.trimStart(); }
      else line = tryLine;
      while (ctx.measureText(line).width > maxW && line.length > 1) {   // a single word wider than the box
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxW) cut--;
        out.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

const FONT = '17px "DejaVu Sans", "Helvetica Neue", Arial, sans-serif';
const LINE_H = 25;

function render() {
  const cv = ensureCanvas();
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.font = FONT; ctx.textBaseline = 'top';
  const overflow: string[] = [];
  // Layer order: zOrderIndex when the page sets it (SDK 0.0.14), else lists, texts, images.
  const layered = state.boxes.map((b, i) => ({ b, z: b.p.zOrderIndex ?? (b.kind === 'image' ? 100 + i : i) }))
    .sort((a, c) => a.z - c.z).map(x => x.b);
  for (const b of layered) {
    const p = b.p, x = p.xPosition | 0, y = p.yPosition | 0, w = p.width | 0, h = p.height | 0;
    if (b.kind === 'image') {
      const bmp = state.images.get(p.containerID);
      if (bmp) ctx.drawImage(bmp, x, y, w, h);
      continue;
    }
    const pad = p.paddingLength ?? 4;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (p.borderWidth) {
      ctx.strokeStyle = rgba(level(p.borderColor, 8)); ctx.lineWidth = p.borderWidth;
      const r = p.borderRadius || 0;
      ctx.beginPath(); (ctx as any).roundRect?.(x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.stroke();
    }
    if (b.kind === 'text') {
      ctx.fillStyle = rgba(level(p.textColor));
      const lines = wrapLines(ctx, state.texts.get(p.containerID) || '', w - pad * 2);
      const fits = Math.max(1, Math.floor((h - pad * 2 + 4) / LINE_H));
      if (lines.length > fits && (state.texts.get(p.containerID) || '').trim()) overflow.push(`${p.containerName} (${lines.length}/${fits} lines)`);
      lines.slice(0, fits).forEach((ln, i) => ctx.fillText(ln, x + pad, y + pad + i * LINE_H));
    } else {
      const items: string[] = p.itemContainer?.itemName || [];
      const sel = state.listSel.get(p.containerID) ?? 0;
      const itemH = 32, visible = Math.max(1, Math.floor(h / itemH));
      const first = Math.max(0, Math.min(sel - visible + 1, items.length - visible));
      items.slice(first, first + visible).forEach((it, i) => {
        const iy = y + i * itemH;
        if (first + i === sel && p.itemContainer?.isItemSelectBorderEn) {
          ctx.strokeStyle = rgba(1); ctx.lineWidth = 1.5;
          ctx.beginPath(); (ctx as any).roundRect?.(x + 2, iy + 2, w - 4, itemH - 4, 6); ctx.stroke();
        }
        ctx.fillStyle = rgba(1);
        ctx.fillText(it, x + 10, iy + 7);
      });
    }
    ctx.restore();
  }
  (window as any).__g2.overflow = overflow;
}

/** Phone hosts get raw gray8 (one byte per pixel, container-sized);
    desktop hosts get a grayscale PNG. Decode either. */
async function decodeGray(bytes: Uint8Array, w: number, h: number): Promise<ImageBitmap> {
  const isPng = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  let img: ImageData;
  const off = new OffscreenCanvas(w, h);
  const c = off.getContext('2d')!;
  if (isPng) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    off.width = bmp.width; off.height = bmp.height;
    c.drawImage(bmp, 0, 0);
    img = c.getImageData(0, 0, bmp.width, bmp.height);
    for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = 255;
  } else {
    if (bytes.length !== w * h) violation(`raw image is ${bytes.length} bytes, container needs ${w}×${h}=${w * h}`);
    img = c.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = bytes[i] ?? 0; img.data[i * 4] = v; img.data[i * 4 + 3] = 255; }
  }
  for (let i = 0; i < img.data.length; i += 4) {
    const l = img.data[i] / 255;
    img.data[i] = GREEN[0] * l * 0.4; img.data[i + 1] = GREEN[1] * l; img.data[i + 2] = GREEN[2] * l * 0.4;
  }
  c.putImageData(img, 0, 0);
  return createImageBitmap(off);
}

// ─── The bridge ──────────────────────────────────────────────────────
const store = (k: string) => `g2mock:${k}`;
const bridge: Any = {
  async getUserInfo() { return { name: 'Romario', uid: 1 }; },
  async getDeviceInfo() { return { model: 'G2', sn: 'HARNESS', status: { isConnected: () => true, batteryLevel: 82 } }; },
  onDeviceStatusChanged(_cb: Any) { return () => {}; },
  async getLocalStorage(key: string) { return localStorage.getItem(store(key)) ?? ''; },
  async setLocalStorage(key: string, value: string) { localStorage.setItem(store(key), value); return true; },
  async createStartUpPageContainer(page: Any) { loadPage(page, true); return 0; },
  async rebuildPageContainer(page: Any) { loadPage(page, false); return true; },
  async textContainerUpgrade(u: Any) {
    const box = state.boxes.find(b => b.p.containerID === u.containerID);
    if (!box || box.kind !== 'text') { violation(`textContainerUpgrade to missing container ${u.containerID}/${u.containerName}`); return false; }
    if ((u.content || '').length > 2000) violation(`textContainerUpgrade over 2000 chars`);
    state.texts.set(u.containerID, u.content || '');
    note(`TEXT ${u.containerName}`);
    render();
    return true;
  },
  async updateImageRawData(u: Any) {
    if (state.imageInflight > 0) violation(`concurrent image push to ${u.containerName}`);
    state.imageInflight += 1;
    try {
      const box = state.boxes.find(b => b.p.containerID === u.containerID && b.kind === 'image');
      if (!box) { violation(`image push to missing container ${u.containerID}/${u.containerName}`); return false; }
      const raw = u.imageData;
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(Array.isArray(raw) ? raw : []);
      await new Promise(r => setTimeout(r, 40));        // a BLE push is not instant
      state.images.set(u.containerID, await decodeGray(bytes, box.p.width, box.p.height));
      note(`IMAGE ${u.containerName}`);
      render();
      return true;
    } finally { state.imageInflight -= 1; }
  },
  async audioControl(on: boolean) { state.mic = on; note(`MIC ${on ? 'on' : 'off'}`); return true; },
  async shutDownPageContainer(mode: number) { state.exitDialog = true; note(`EXIT dialog (${mode})`); return true; },
  onEvenHubEvent(cb: (e: Any) => void) { handler = cb; return () => { handler = null; }; },
};
const bridgeProxy = new Proxy(bridge, {
  get(t, k: string) {
    if (k in t) return t[k];
    if (k === 'then' || typeof k === 'symbol') return undefined;   // not a thenable
    return async (...args: any[]) => { note(`(unmocked) ${k}`); console.warn('[mock] unmocked bridge call', k, args); return undefined; };
  },
  set(t, k: string, v) { t[k] = v; return true; },
});

export async function waitForEvenAppBridge() { return bridgeProxy; }

// ─── Test controls ───────────────────────────────────────────────────
function capture(): Box | undefined {
  return state.boxes.find(b => b.kind !== 'image' && b.p.isEventCapture === 1);
}
function emit(e: Any) { handler?.(e); }
(window as any).__g2 = {
  state,
  show() { ensureCanvas().parentElement!.style.display = 'block'; render(); },
  hide() { ensureCanvas().parentElement!.style.display = 'none'; },
  click() {
    const c = capture();
    if (c?.kind === 'list') emit({ listEvent: { containerID: c.p.containerID, containerName: c.p.containerName, currentSelectItemIndex: state.listSel.get(c.p.containerID) ?? 0 } });
    else emit({ sysEvent: {} });
  },
  double() { emit({ sysEvent: { eventType: 3 } }); },
  scroll(dir: 'up' | 'down') {
    const c = capture();
    const type = dir === 'up' ? 1 : 2;
    if (c?.kind === 'list') {
      const n = (c.p.itemContainer?.itemName || []).length;
      const cur = state.listSel.get(c.p.containerID) ?? 0;
      const next = Math.max(0, Math.min(n - 1, cur + (dir === 'up' ? -1 : 1)));
      state.listSel.set(c.p.containerID, next); render();
      emit({ listEvent: { containerID: c.p.containerID, containerName: c.p.containerName, currentSelectItemIndex: next, eventType: type } });
    } else emit({ textEvent: { containerID: c?.p.containerID, containerName: c?.p.containerName, eventType: type } });
  },
  menu() { return state.menu.map((m: Any) => `${m.itemID}:${m.itemName}`); },
  pick(itemID: number) { emit({ menuItemClickEvent: { itemID } }); },
  audio(pcm: number[]) { emit({ audioEvent: { audioPcm: pcm } }); },
  texts() { return Object.fromEntries([...state.texts.entries()].map(([id, t]) => [String(id), t])); },
  items() {
    const c = state.boxes.find(b => b.kind === 'list');
    return c ? { items: c.p.itemContainer?.itemName || [], sel: state.listSel.get(c.p.containerID) ?? 0 } : null;
  },
  overflow: [] as string[],
};
