import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { requireEntitlement } from './_entitlements.js';
import { getVoice, activeProvider } from './_voices.js';

/**
 * Cloud TTS proxy — speaks a philosopher's reply out loud, in character.
 *
 * The web app (and any future surface with a speaker) posts the finished
 * reply text here; the provider renders it with the per-philosopher
 * voice + per-emotion delivery from api/_voices.js and we return raw
 * MP3 bytes. Clients that fail this call fall back to their local
 * system TTS (speechSynthesis on web) — this endpoint must therefore
 * fail FAST and CLEAN, never hang.
 *
 * Providers (TTS_PROVIDER env, default openai):
 *   openai      POST /v1/audio/speech, model gpt-4o-mini-tts,
 *               persona+emotion via `instructions`   (OPENAI_API_KEY)
 *   elevenlabs  POST /v1/text-to-speech/{voice}, model eleven_v3,
 *               emotion via inline audio tags        (ELEVENLABS_API_KEY)
 *   cartesia    POST /tts/bytes, model sonic-2, low-latency —
 *               meant for live on-glass conversation (CARTESIA_API_KEY)
 *
 * All keys live in Vercel env ONLY — never in any bundle (the G2
 * webview blocks direct API calls anyway; everything proxies here).
 *
 * Caching: Vercel KV (same store as entitlements), keyed on
 * sha256(text + voice + style) per provider, base64 MP3, 7-day TTL.
 * Re-speaking the same reply in the same emotion costs zero.
 *
 * Rate limiting: deliberately does NOT burn a 'speak' unit — a voice
 * turn already burned one in /api/speak, and TTS of that reply is the
 * same turn. Instead a private tts:rl counter caps runaway direct use.
 *
 * @description Synthesize philosopher speech audio
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.text - Reply text to speak (≤2000 chars)
 * @param {string} req.body.philosopherId - Canonical persona id (e.g. 'marcus_aurelius')
 * @param {string} [req.body.emotion] - One of the 23 taxonomy emotions
 * @returns {Buffer} audio/mpeg bytes (X-TTS-Provider / X-TTS-Voice / X-TTS-Cache headers)
 */

const MAX_TEXT_CHARS = 2000;
const TTS_PER_DAY = 80;            // 2× the sage speak cap — replays are legit
const CACHE_TTL_SECONDS = 7 * 86400;
const CACHE_MAX_B64 = 900_000;     // stay under KV value-size limits

export default async function handler(req, res) {
  // CORS — same policy as speak.js
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { text, philosopherId, emotion } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Missing text' });
    }
    if (!philosopherId) {
      return res.status(400).json({ error: 'Missing philosopherId' });
    }
    const input = text.trim().slice(0, MAX_TEXT_CHARS);

    // Identity + policy hook. 'tts' is not a gated feature, so this
    // never blocks and never increments the speak counter — it resolves
    // who is asking so the private rate limit below has a stable key.
    const gate = await requireEntitlement(req, res, 'tts');
    if (!gate) return;
    const overLimit = await overTtsDailyLimit(req, gate);
    if (overLimit) {
      return res.status(429).json({ error: 'daily_limit', feature: 'tts', limit: TTS_PER_DAY });
    }

    const requested = activeProvider();
    let provider = resolveConfiguredProvider(requested);
    if (!provider) {
      return res.status(500).json({ error: 'tts_unconfigured', provider: requested });
    }
    if (provider !== requested) {
      console.warn(`[/api/tts] ${requested} unconfigured — falling back to openai`);
    }
    // Cast for the engine that will actually render (voiceId is
    // provider-specific — an elevenlabs id is useless to openai).
    let v = getVoice(philosopherId, emotion, provider);
    if (!v.voiceId && provider !== 'openai' && process.env.OPENAI_API_KEY) {
      // Provider key exists but no voice id is mapped for anyone —
      // openai's built-in casting always resolves, so downgrade.
      console.warn(`[/api/tts] no ${provider} voice id for ${philosopherId} — falling back to openai`);
      provider = 'openai';
      v = getVoice(philosopherId, emotion, 'openai');
    }
    if (!v.voiceId) {
      return res.status(500).json({ error: 'tts_unconfigured', provider });
    }

    // ── Cache: sha256(text + voice + style), per provider ────────────
    const cacheKey = `tts:v1:${provider}:${v.voiceId}:${crypto
      .createHash('sha256')
      .update(`${input}|${v.voiceId}|${v.style}`)
      .digest('hex')}`;
    const cached = await kvGet(cacheKey);
    if (cached) {
      return sendAudio(res, Buffer.from(cached, 'base64'), provider, v.voiceId, 'hit');
    }

    console.log('[/api/tts]',
      'provider:', provider,
      '| phil:', philosopherId,
      '| emotion:', emotion || 'neutral',
      '| voice:', v.voiceId,
      '| chars:', input.length,
    );

    let audio;
    if (provider === 'elevenlabs') audio = await synthesizeElevenLabs(input, v);
    else if (provider === 'cartesia') audio = await synthesizeCartesia(input, v);
    else audio = await synthesizeOpenAI(input, v);

    // Best-effort cache write — KV outage must never take TTS down.
    const b64 = audio.toString('base64');
    if (b64.length <= CACHE_MAX_B64) {
      try { await kv.set(cacheKey, b64, { ex: CACHE_TTL_SECONDS }); } catch { /* noop */ }
    }

    return sendAudio(res, audio, provider, v.voiceId, 'miss');
  } catch (err) {
    console.error('TTS error:', err);
    return res.status(502).json({ error: 'tts_failed' });
  }
}

// ─── Provider adapters ──────────────────────────────────────────────
// Each takes (text, voice-from-getVoice) and returns a Buffer of MP3
// bytes, or throws. Keys are read from process.env HERE and nowhere
// else — never hardcoded, never logged.

/** OpenAI gpt-4o-mini-tts — the DEFAULT. Persona via `instructions`. */
async function synthesizeOpenAI(text, v) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: v.voiceId,
      input: text,
      instructions: v.instructions,
      response_format: 'mp3',
    }),
  });
  if (!r.ok) throw new Error(`openai tts ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}

/** ElevenLabs v3 — emotion rides as an inline audio tag on the text. */
async function synthesizeElevenLabs(text, v) {
  const transcript = v.tag ? `${v.tag} ${text}` : text;
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(v.voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({ text: transcript, model_id: 'eleven_v3' }),
    },
  );
  if (!r.ok) throw new Error(`elevenlabs tts ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Cartesia Sonic — low-latency, built for live on-glass conversation. */
async function synthesizeCartesia(text, v) {
  const voice = { mode: 'id', id: v.voiceId };
  if (v.cartesia) voice.__experimental_controls = { emotion: v.cartesia };
  const r = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.CARTESIA_API_KEY,
      'Cartesia-Version': '2024-11-13',
    },
    body: JSON.stringify({
      model_id: 'sonic-2',
      transcript: text,
      voice,
      output_format: { container: 'mp3', bit_rate: 128000, sample_rate: 44100 },
      language: 'en',
    }),
  });
  if (!r.ok) throw new Error(`cartesia tts ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}

// ─── Helpers ────────────────────────────────────────────────────────

const PROVIDER_KEYS = {
  openai: 'OPENAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
};

/**
 * The configured provider, downgraded to openai when its key is
 * missing (openai's key already powers everything else here). Returns
 * null only when NO usable key exists.
 */
function resolveConfiguredProvider(wanted) {
  if (process.env[PROVIDER_KEYS[wanted]]) return wanted;
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function sendAudio(res, buf, provider, voiceId, cache) {
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', buf.length);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-TTS-Provider', provider);
  res.setHeader('X-TTS-Voice', voiceId);
  res.setHeader('X-TTS-Cache', cache);
  return res.status(200).send(buf);
}

async function kvGet(key) {
  try { return await kv.get(key); } catch { return null; }
}

/**
 * Private daily cap — same kv.incr pattern as _entitlements.js
 * overDailyLimit, own key prefix so it never collides with speak's
 * counter. Fails open: a KV outage must never silence the voices.
 */
async function overTtsDailyLimit(req, gate) {
  const who = gate.userId
    || req.headers['x-device-id']
    || (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown');
  const day = new Date().toISOString().slice(0, 10);
  const key = `tts:rl:${who}:${day}`;
  try {
    const n = await kv.incr(key);
    if (n === 1) await kv.expire(key, 86400);
    return n > TTS_PER_DAY;
  } catch {
    return false;
  }
}
