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

// Canonical taxonomy values — keep in lockstep with the Android client's
// CANONICAL_EMOTIONS and the bundled corpus's archetype/blend/tag sets.
const EMOTIONS = [
  'acceptance','authority','awe','compassion','contemplation',
  'conviction','defiance','devotion','doubt','grief',
  'honor','joy','liberation','neutral','peace',
  'rage','resolve','serenity','sorrow','teaching',
  'transcendence','urgency','wonder',
];

const ARCHETYPES = [
  'the_sage','the_smith','the_mirror','the_warrior','the_witness',
  'the_wanderer','the_oracle','the_gardener','the_architect',
  'the_outsider','the_lover','the_skeptic',
];

const BLENDS = [
  'fierce_clarity','quiet_fire','soft_steel','heavy_grace',
  'patient_storm','grieving_resolve','tender_authority',
  'restless_peace','austere_devotion','wry_compassion',
  'urgent_acceptance','luminous_doubt','wounded_conviction',
  'sober_wonder','disciplined_joy','exhausted_hope',
  'severe_tenderness','laughing_sorrow','ironic_reverence','silent_rage',
];

const MOD_FLAGS = ['hate','self_harm','harassment','minors','spam','fake_deep'];

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

    const systemPrompt = `You are a classifier for Aphorica — a status-economy platform for short philosophical aphorisms (≤240 chars). For each draft you classify it against a fixed taxonomy and rate its quality.

YOUR JOB:
1. Pick the single best EMOTION (one of: ${EMOTIONS.join(', ')})
2. Pick the single best ARCHETYPE (one of: ${ARCHETYPES.join(', ')})
3. Pick the single best BLEND (one of: ${BLENDS.join(', ')})
4. Rate 1-10 on aphorism quality:
   • 10 — extraordinary. Crystalline, surprising, true. Rare.
   • 9  — excellent. Sharp, fresh framing. Memorable.
   • 7-8 — good. Clear thought, well-compressed.
   • 5-6 — okay. Coherent but conventional.
   • 1-4 — weak. Rambling, fake-deep, or pedestrian.
5. Extract 0-5 short tag words (lowercase, no underscores in your output — single words only).
6. Apply moderation. Flag if any of:
   • hate           — explicit hate speech against a protected group
   • harassment     — targeted attacks or threats against a person
   • self_harm      — encourages or romanticizes self-harm (vs. discusses)
   • minors         — sexual content involving minors
   • spam           — advertising / promotional / repetitive
   • fake_deep      — strings together vague abstractions with no real thought ("Time is the river of dreams that flow into eternity") — flag with low ratingScore (≤4)
   Otherwise moderationFlag is null.

OUTPUT FORMAT — JSON only. No prose:
{
  "emotion": "<one>",
  "archetype": "<one>",
  "blend": "<one>",
  "ratingScore": <int 1-10>,
  "tags": ["word1", "word2", ...],
  "moderationFlag": "<one of the above>" | null,
  "rejectReason": "<short human sentence if flagged>" | null
}

BE HONEST about quality. Most posts will be 5-6. Reserve 9-10 for genuinely sharp work. Reserve fake_deep generously — the platform dies if it floods with mock-philosophical word soup.`;

    const userPrompt = context
      ? `DRAFT:\n${text}\n\nAUTHOR'S CONTEXT (the "why I thought of that" line, ≤60 chars):\n${context}`
      : `DRAFT:\n${text}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 240,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      console.error('[/api/aphorica/classify] OpenAI error:', err);
      return res.status(502).json({ error: 'classifier upstream failed' });
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    // Constrain to known enums; gpt-4o-mini is reliable here but defend
    // against drift / typos.
    const emotion   = EMOTIONS.includes(parsed.emotion)     ? parsed.emotion   : 'contemplation';
    const archetype = ARCHETYPES.includes(parsed.archetype) ? parsed.archetype : 'the_witness';
    const blend     = BLENDS.includes(parsed.blend)         ? parsed.blend     : 'sober_wonder';
    const ratingScore = Math.max(1, Math.min(10, parseInt(parsed.ratingScore || 5, 10) || 5));
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter(t => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 5)
      : [];
    let moderationFlag = MOD_FLAGS.includes(parsed.moderationFlag) ? parsed.moderationFlag : null;
    let rejectReason = parsed.rejectReason && typeof parsed.rejectReason === 'string'
      ? parsed.rejectReason.slice(0, 160) : null;

    // Belt-and-suspenders: low rating + low entropy → fake_deep, even
    // if the model didn't flag it.
    if (!moderationFlag && ratingScore <= 4) {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      const unique = new Set(words);
      const lowEntropy = unique.size < words.length * 0.6 || words.length < 6;
      if (lowEntropy) {
        moderationFlag = 'fake_deep';
        rejectReason = rejectReason || "This reads like vague abstraction. Aphorica rewards specificity over sweep.";
      }
    }

    return res.status(200).json({
      emotion,
      archetype,
      blend,
      ratingScore,
      tags,
      moderationFlag,
      rejectReason,
    });
  } catch (err) {
    console.error('[/api/aphorica/classify] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
