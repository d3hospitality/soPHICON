// ═══════════════════════════════════════════════════════════════════
// G2 UX LAB — mock Even App bridge (src/lab/mockBridge.ts)
//
// In a plain browser (or the Even simulator before the WebView host
// attaches) `waitForEvenAppBridge()` never resolves, so the whole app
// hangs at boot. In lab mode we race the real bridge against a short
// timeout and fall back to this mock, which:
//
//   • implements every bridge method the app actually calls
//   • persists localStorage into window.localStorage under an ISOLATED
//     "g2lab::" prefix — fixtures can never touch real user data
//   • records a live model of what "the glasses" would be showing
//     (page containers + last image pushes) and publishes changes,
//     which powers the Lab tab's textual mirror + canvas preview
//   • lets the lab inject ring events (tap / double-tap / swipes) into
//     the app's ONE real event subscription, and flip paired/battery
//     state at will
//
// Unknown SDK methods resolve as async no-ops (Proxy fallback) so an
// SDK upgrade can't crash the lab.
// ═══════════════════════════════════════════════════════════════════

import { DeviceConnectType } from '@evenrealities/even_hub_sdk';

export interface MirrorContainer {
  id: number;
  name: string;
  kind: 'text' | 'list' | 'image';
  content: string;        // text content, list items joined, or image note
  isEventCapture: boolean;
}

export interface GlassMirrorModel {
  startupDone: boolean;
  rebuildCount: number;
  containers: MirrorContainer[];
  lastImagePush: string;
  lastCall: string;
}

type ModelListener = (m: GlassMirrorModel) => void;
type EventListener = (event: any) => void;
type StatusListener = (status: any) => void;

const STORE_PREFIX = 'g2lab::';

function readContainers(page: any): MirrorContainer[] {
  const out: MirrorContainer[] = [];
  if (!page) return out;
  for (const t of page.textObject ?? []) {
    out.push({
      id: t.containerID ?? -1, name: t.containerName ?? '?', kind: 'text',
      content: String(t.content ?? ''), isEventCapture: t.isEventCapture === 1,
    });
  }
  for (const l of page.listObject ?? []) {
    const items: string[] = l.itemContainer?.itemName ?? [];
    out.push({
      id: l.containerID ?? -1, name: l.containerName ?? '?', kind: 'list',
      content: items.join('\n'), isEventCapture: l.isEventCapture === 1,
    });
  }
  for (const im of page.imageObject ?? []) {
    out.push({
      id: im.containerID ?? -1, name: im.containerName ?? '?', kind: 'image',
      content: '(image container)', isEventCapture: false,
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

export function createMockBridge() {
  const model: GlassMirrorModel = {
    startupDone: false, rebuildCount: 0, containers: [], lastImagePush: '', lastCall: '',
  };
  let modelListeners: ModelListener[] = [];
  let eventListeners: EventListener[] = [];
  let statusListeners: StatusListener[] = [];
  let paired = true;
  let battery = 87;

  function publish(call: string): void {
    model.lastCall = call;
    for (const cb of modelListeners) { try { cb({ ...model, containers: [...model.containers] }); } catch { /* listener error */ } }
  }

  const core = {
    // ── identity / device ──
    async getUserInfo() { return { name: 'Lab Seeker', uid: 'lab-user' }; },
    async getDeviceInfo() {
      return {
        model: 'G2 (lab mock)', sn: 'LAB-0000',
        status: { isConnected: () => paired, batteryLevel: battery },
      };
    },
    onDeviceStatusChanged(cb: StatusListener) {
      statusListeners.push(cb);
      return () => { statusListeners = statusListeners.filter(l => l !== cb); };
    },

    // ── page lifecycle ──
    async createStartUpPageContainer(page: any) {
      model.startupDone = true;
      model.containers = readContainers(page);
      publish('createStartUpPageContainer');
      return 0;
    },
    async rebuildPageContainer(page: any) {
      model.rebuildCount += 1;
      model.containers = readContainers(page);
      publish('rebuildPageContainer');
      return 0;
    },
    async textContainerUpgrade(arg: any) {
      // Accepts either a bare {containerID, content} or an object with
      // a textObject array — mirror whatever content we can find.
      const items = arg?.textObject ?? (arg ? [arg] : []);
      for (const t of items) {
        const id = t.containerID ?? -1;
        const found = model.containers.find(c => c.id === id);
        if (found) found.content = String(t.content ?? '');
      }
      publish('textContainerUpgrade');
      return 0;
    },
    async updateImageRawData(obj: any) {
      const id = obj?.containerID ?? obj?.containerId ?? '?';
      const name = obj?.containerName ?? '';
      model.lastImagePush = `#${id} ${name}`.trim();
      const found = model.containers.find(c => c.id === Number(id));
      if (found) found.content = `(image pushed → ${name || id})`;
      publish('updateImageRawData');
      return 0;
    },
    async shutDownPageContainer(_arg: any) {
      publish('shutDownPageContainer');
      return 0;
    },

    // ── events ──
    onEvenHubEvent(cb: EventListener) {
      eventListeners.push(cb);
      return () => { eventListeners = eventListeners.filter(l => l !== cb); };
    },

    // ── storage (isolated) ──
    async getLocalStorage(key: string): Promise<string> {
      try { return window.localStorage.getItem(STORE_PREFIX + key) ?? ''; } catch { return ''; }
    },
    async setLocalStorage(key: string, value: string): Promise<boolean> {
      try { window.localStorage.setItem(STORE_PREFIX + key, value); return true; } catch { return false; }
    },

    // ── audio (no-op in the lab) ──
    async audioControl(_cmd: any) { return 0; },

    // ═══ Lab-only control surface (not part of the SDK) ═══
    __lab: {
      isMock: true,
      onModelChange(cb: ModelListener): () => void {
        modelListeners.push(cb);
        try { cb({ ...model, containers: [...model.containers] }); } catch { /* first paint */ }
        return () => { modelListeners = modelListeners.filter(l => l !== cb); };
      },
      getModel(): GlassMirrorModel { return { ...model, containers: [...model.containers] }; },
      emitEvent(event: any): void {
        for (const cb of eventListeners) { try { cb(event); } catch (e) { console.error('[g2lab] event cb', e); } }
      },
      setPaired(next: boolean, batteryLevel?: number): void {
        paired = next;
        if (batteryLevel !== undefined) battery = batteryLevel;
        const status = {
          connectType: next ? DeviceConnectType.Connected : DeviceConnectType.Disconnected,
          batteryLevel: battery,
        };
        for (const cb of statusListeners) { try { cb(status); } catch { /* status cb */ } }
      },
      isPaired(): boolean { return paired; },
      clearStore(): void {
        try {
          const doomed: string[] = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith(STORE_PREFIX)) doomed.push(k);
          }
          doomed.forEach(k => window.localStorage.removeItem(k));
        } catch { /* storage unavailable */ }
      },
    },
  };

  // Unknown SDK methods → async no-op, so newer call sites never crash the lab.
  return new Proxy(core, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return async () => 0;
    },
  }) as any;
}

/** True when the bridge in use is the lab mock. */
export function isMockBridge(bridge: any): boolean {
  return Boolean(bridge && bridge.__lab && bridge.__lab.isMock);
}
