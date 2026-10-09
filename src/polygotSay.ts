// ═══════════════════════════════════════════════════════════════════
// polygotSay.ts — the "say it" moments of the Try PolyGot tour.
//
// The glasses mic listens for up to 4 seconds, then PolyGot's own demo
// endpoint (lingua-franca-api /api/demo-say) scores the line. That endpoint
// needs no account and only ever accepts the tour's own lines, so it can't
// be used as free transcription. Any failure is "offline", never a fake score.
// ═══════════════════════════════════════════════════════════════════

import { AudioInputSource, type EvenAppBridge } from '@evenrealities/even_hub_sdk';

export type SayResult = 'hit' | 'close' | 'miss' | 'silent' | 'offline';
export interface SayGrade { result: SayResult; heard: string }

const DEMO_SAY_URL = 'https://lingua-franca-api.vercel.app/api/demo-say';
/** 4 s of 16 kHz mono PCM16, the endpoint's limit. */
export const SAY_MAX_PCM = 4 * 16_000 * 2;
export const SAY_LISTEN_MS = 3800;

let open = false;
let chunks: Uint8Array[] = [];
let bytes = 0;

export function isDemoMicOpen(): boolean { return open; }

export async function openDemoMic(bridge: EvenAppBridge): Promise<boolean> {
  if (open) return true;
  chunks = []; bytes = 0;
  try {
    const ok = await bridge.audioControl(true, AudioInputSource.Glasses);
    open = ok !== false;
  } catch { open = false; }
  return open;
}

/** Audio events route here while the tour's mic is open. */
export function demoMicChunk(pcm: Uint8Array): void {
  if (!open || bytes >= SAY_MAX_PCM) return;
  const take = pcm.subarray(0, Math.min(pcm.length, SAY_MAX_PCM - bytes));
  chunks.push(new Uint8Array(take)); bytes += take.length;
}

/** Close the mic and hand back what it heard (even-length PCM16). */
export async function closeDemoMic(bridge: EvenAppBridge): Promise<Uint8Array> {
  const was = open;
  open = false;
  if (was) { try { await bridge.audioControl(false, AudioInputSource.Glasses); } catch { /* already closed */ } }
  const out = new Uint8Array(bytes - (bytes % 2));
  let at = 0;
  for (const c of chunks) { const n = Math.min(c.length, out.length - at); out.set(c.subarray(0, n), at); at += n; }
  chunks = []; bytes = 0;
  return out;
}

function base64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function gradeSay(lang: string, word: string, pcm: Uint8Array): Promise<SayGrade> {
  if (pcm.length < 3200) return { result: 'silent', heard: '' };   // under 0.1 s
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12_000);
  try {
    const r = await fetch(DEMO_SAY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, word, audio: base64(pcm) }), signal: ctl.signal,
    });
    if (!r.ok) return { result: 'offline', heard: '' };
    const body = await r.json() as { result?: unknown; heard?: unknown };
    const result = (['hit', 'close', 'miss', 'silent'] as const).find((v) => v === body?.result);
    return result ? { result, heard: typeof body.heard === 'string' ? body.heard.slice(0, 32) : '' } : { result: 'offline', heard: '' };
  } catch { return { result: 'offline', heard: '' }; }
  finally { clearTimeout(timer); }
}
