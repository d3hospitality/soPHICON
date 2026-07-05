import { requireEntitlement } from '../_entitlements.js';
// POST /api/community/sprite-init
//
// Generate the NEUTRAL sprite for a community philosopher from their
// 4 onboarding reference photos.
//
// ┌─ THE LOAD-BEARING DETAIL ───────────────────────────────────────┐
// │                                                                  │
// │  The OpenAI image-edits call receives FIVE images, in order:    │
// │                                                                  │
// │    image[0]  →  master_neutral.png   (THE style anchor)         │
// │    image[1..4] → user's 4 selfies   (IDENTITY references)       │
// │                                                                  │
// │  The prompt explicitly tells the model:                          │
// │    • image[0] = match art style, pose, lighting, head size      │
// │      (IGNORE its clothing — placeholder)                        │
// │    • image[1..4] = match face shape, hair, skin tone             │
// │                                                                  │
// │  Without the master template at image[0], gpt-image-1 falls     │
// │  back to prose-only style direction and the results drift —    │
// │  different brushwork, different head sizes, different lighting  │
// │  per user. The master IS the consistency mechanism. Don't       │
// │  remove it. Don't reorder it.                                   │
// │                                                                  │
// │  Mirrors sophicon_server.py's `_call_with_references()` flow.   │
// └─────────────────────────────────────────────────────────────────┘
//
// Pipeline state-machine (KV-tracked, polled by /sprite-status):
//   pending → generating → ready    (happy path)
//                       ↘ failed    (moderation / network / empty)
//
// Future emotion sprites (compassion, fierce_clarity, etc.) reuse this
// shape but with the user's OWN neutral.png as image[0] — each user
// becomes their own style anchor downstream of master.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getPhilosopherByPhilId,
  setSpriteStatus,
} from './_store.js';

export const config = {
  maxDuration: 60,
};

// Mirrors STYLE_PROMPT in sophicon_server.py. Keep this aligned with
// the local pipeline so cloud-generated community sprites stack with
// the same visual language as the bundled philosopher sprites.
const STYLE_PROMPT = `Render a single character portrait in the soPHICON style:

- HEAD AND SHOULDERS portrait, centered on a plain dark gradient backdrop (deep slate / charcoal)
- Painterly digital illustration, RPG / video-game character portrait style
- Soft directional lighting from the upper left, warm rim light
- Realistic facial proportions, expressive but stylized — NOT a photograph
- Slightly stylized skin texture, hand-painted quality
- Gentle, neutral expression — relaxed and approachable
- This is a VIDEO GAME CHARACTER, not a real person — stylized and simplified

CLOTHING: Simple dark gray or charcoal tunic / collar at the shoulders. Plain, unadorned. Placeholder clothing — future variants will personalize it.

Expression: NEUTRAL. Calm, composed, no strong emotion. Resting face. Peaceful.`;

// The reference-order instruction — verbatim from sophicon_server.py
// (line 670-ish, `primary_prompt` builder in `_generate_emotion_for_philosopher`).
// Both pipelines speak the same words to the model so behavior matches.
const REFERENCE_ORDER_INSTRUCTION = `You are looking at reference images in this order:

1. MASTER TEMPLATE PORTRAIT — match EXACTLY for: art style, pose angle, lighting, head size,
   canvas position. IGNORE the template's clothing — it's just a placeholder.

2+ CHARACTER REFERENCE PHOTOS — use ONLY for character IDENTITY: face shape, bone structure,
   hair style, beard, skin tone, characteristic features.

Create the new character's portrait using the IDENTITY from the reference photos, rendered
in the EXACT same art style, pose, lighting, and framing as the master template.

CLOTHING: Match the master template's placeholder tunic/collar. Don't invent new garments.

Expression: NEUTRAL. Calm resting face. No strong emotion.

CRITICAL: this is a stylized VIDEO GAME CHARACTER portrait. Treat the reference photos as
an aesthetic brief, not as a photo to copy — your output must be a painterly RPG portrait,
NOT a photorealistic likeness.`;

// Resolve the bundled master_neutral.png path relative to this file.
// Vercel includes static assets sitting next to a serverless function
// in the function bundle, so __dirname (or import.meta.url) points at
// the deployed location at runtime.
const MASTER_NEUTRAL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'master_neutral.png',
);

let cachedMasterNeutral = null;
async function loadMasterNeutral() {
  if (cachedMasterNeutral) return cachedMasterNeutral;
  cachedMasterNeutral = await readFile(MASTER_NEUTRAL_PATH);
  return cachedMasterNeutral;
}

/**
 * Generate the NEUTRAL sprite for a community philosopher from up
 * to 4 reference selfies plus the master_neutral.png style anchor.
 * Uses gpt-image-1 via OpenAI's images/edits endpoint. Pipeline
 * state is tracked in KV and polled via /sprite-status.
 *
 * @description Generate a community philosopher's neutral sprite
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.userId - The user's anonymous UUID
 * @param {string} req.body.philId - The philosopher identity to generate for
 * @param {string[]} req.body.references - 1-4 base64-encoded reference selfie images
 * @returns {object} { spriteB64: string, spriteStatus: 'ready' }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const gate = await requireEntitlement(req, res, 'sprite');
  if (!gate) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  let philId, userId, references;
  try {
    const body = req.body || {};
    userId = String(body.userId || req.headers['x-user-id'] || '').trim();
    philId = String(body.philId || '').trim();
    references = Array.isArray(body.references) ? body.references : [];
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!philId) return res.status(400).json({ error: 'philId required' });
    if (references.length === 0) {
      return res.status(400).json({ error: 'no_references', details: 'at least one reference image required' });
    }
    if (references.length > 4) references = references.slice(0, 4);

    // ┌─ NEUTRAL-ONLY GUARDRAIL ───────────────────────────────────┐
    // │ This endpoint generates ONLY the neutral sprite for a     │
    // │ community user — never the 22 emotion variants. Reasons:  │
    // │   • Cost: each emotion is another $0.04 gpt-image-1 call. │
    // │     22 emotions × N users gets expensive fast.            │
    // │   • Pipeline: the user's neutral is the anchor for any    │
    // │     downstream emotion sprite (see soPHICON-Community-Hub │
    // │     -SDK §pipeline). Emotions belong in a separate        │
    // │     endpoint that takes the neutral as image[0].          │
    // │ If any client tries to sneak in an `emotion` field        │
    // │ asking for compassion / fierce_clarity / etc, we reject. │
    // └─────────────────────────────────────────────────────────────┘
    if (body.emotion && String(body.emotion).toLowerCase() !== 'neutral') {
      return res.status(400).json({
        error: 'neutral_only',
        details: 'This endpoint generates ONLY the neutral sprite. Other emotions live behind a separate (not-yet-built) endpoint and are not exposed to community users in v0.',
      });
    }

    const phil = await getPhilosopherByPhilId(philId);
    if (!phil) return res.status(404).json({ error: 'philId not found' });
  } catch (e) {
    console.error('sprite-init request validation failed:', e);
    return res.status(400).json({ error: 'bad_request' });
  }

  // Flip status immediately so a polling client sees the right state.
  await setSpriteStatus({ philId, status: 'generating' });

  try {
    // Load the master template. Cached after the first call so warm
    // function invocations skip the disk read.
    let masterBytes;
    try {
      masterBytes = await loadMasterNeutral();
    } catch (e) {
      await setSpriteStatus({ philId, status: 'failed', error: 'master_template_missing' });
      return res.status(500).json({
        error: 'master_template_missing',
        details: 'master_neutral.png not bundled with the function. Redeploy with the file present.',
      });
    }

    const fd = new FormData();
    fd.append('model', 'gpt-image-1');
    // Prompt = STYLE_PROMPT (sets the visual language) + the explicit
    // reference-order instruction (tells the model how to weight the
    // images we're about to attach).
    fd.append('prompt', `${STYLE_PROMPT}\n\n${REFERENCE_ORDER_INSTRUCTION}`);
    fd.append('n', '1');
    fd.append('size', '1024x1024');
    fd.append('quality', 'high');

    // image[0] = master template (style anchor). MUST be first — the
    // numbered prompt language assumes this ordering.
    fd.append(
      'image[]',
      new Blob([masterBytes], { type: 'image/png' }),
      'master_neutral.png',
    );

    // image[1..N] = user's selfies (identity refs). Sniff PNG vs JPEG
    // from the magic bytes so we set the right MIME type.
    for (let i = 0; i < references.length; i++) {
      const bytes = Buffer.from(references[i], 'base64');
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const mime = isPng ? 'image/png' : 'image/jpeg';
      fd.append(
        'image[]',
        new Blob([bytes], { type: mime }),
        `ref_${i + 1}.${isPng ? 'png' : 'jpg'}`,
      );
    }

    const resp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });

    if (!resp.ok) {
      const text = await resp.text();
      const lower = text.toLowerCase();
      const isModeration = lower.includes('safety') || lower.includes('moderation') || lower.includes('blocked');
      await setSpriteStatus({
        philId,
        status: 'failed',
        error: isModeration ? 'moderation' : `openai_${resp.status}`,
      });
      return res.status(502).json({
        error: isModeration ? 'moderation' : 'openai_error',
        details: text.slice(0, 400),
      });
    }

    const data = await resp.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      await setSpriteStatus({ philId, status: 'failed', error: 'empty_response' });
      return res.status(502).json({ error: 'openai_error', details: 'empty response from images/edits' });
    }

    await setSpriteStatus({ philId, status: 'ready' });
    return res.status(200).json({ spriteB64: b64, spriteStatus: 'ready' });
  } catch (e) {
    console.error('sprite-init failed:', e);
    await setSpriteStatus({ philId, status: 'failed', error: 'internal_error' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
