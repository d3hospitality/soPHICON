import { classifyAphorism } from './_classify.js';
import { requireEntitlement } from '../_entitlements.js';
// /api/aphorica/classify
//
// Classify a draft aphorism using GPT-4o-mini and return the taxonomy
// fields the client needs to:
//   - render the right sprite (emotion → user's <philId>-<emotion>.png)
//   - assign a rarity tier (ratingScore drives this client-side via
//     AphoricaRarity.fromRatingScore)
//   - populate tag chips on the post card
//   - flag moderation issues before commit
//
// Same taxonomy vocabulary as the bundled Quote.kt corpus — emotion
// (23), archetype (12), blend (20), tags (30+). The classifier is
// constrained to those exact enums so the client's existing rendering
// pipeline maps without translation.
//
// Cost: ~$0.0002 per call (gpt-4o-mini, ~600 tokens in, ~120 out).
// Runs on every post submit; cheap enough.
//
// Request body (POST JSON):
//   {
//     text:         string,    // ≤240 chars; server enforces too
//     context:      string?,   // ≤60 chars; optional
//     authorPhilId: string,    // for telemetry / dedup; not classified
//   }
//
// Response (200 JSON):
//   {
//     emotion:        string,         // 23 canonical emotions
//     archetype:      string,         // 12 archetype enum
//     blend:          string,         // 20 blend enum
//     ratingScore:    number,         // 1-10
//     tags:           string[],       // 0-5 of the canonical tag set
//     moderationFlag: string|null,    // null = clean; "hate" | "self_harm" | "harassment" | "minors" | "spam" | "fake_deep" otherwise
//     rejectReason:   string|null,    // human-readable, surfaced in compose UI when flagged
//   }
//
// On failure (network, OpenAI 5xx) the server returns 502 with
// { error }; client should surface a "try again" state and NOT commit
// the post locally.

/**
 * Classify a draft aphorism against the Aphorica taxonomy using
 * GPT-4o-mini. Returns emotion, archetype, blend, quality rating,
 * tags, and moderation flags. Each submission is classified before
 * being committed to the feed.
 *
 * @description Classify and rate a draft aphorism
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.text - Aphorism text, max 240 chars
 * @param {string} [req.body.context] - Author's "why I thought of that" line, max 60 chars
 * @param {string} [req.body.authorPhilId] - Author's philosopher ID (for telemetry)
 * @returns {object} { emotion: string, archetype: string, blend: string, ratingScore: number, tags: string[], moderationFlag: string|null, rejectReason: string|null }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const gate = await requireEntitlement(req, res, 'aphorica-classify');
  if (!gate) return;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  try {
    const body = req.body || {};
    const text = String(body.text || '').trim();
    const context = String(body.context || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    if (text.length > 240) return res.status(400).json({ error: 'text exceeds 240 chars' });
    if (context.length > 60) return res.status(400).json({ error: 'context exceeds 60 chars' });

    const result = await classifyAphorism({ text, context });
    return res.status(200).json(result);
  } catch (err) {
    if (err && err.status === 502) return res.status(502).json({ error: 'classifier upstream failed' });
    console.error('[/api/aphorica/classify] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
