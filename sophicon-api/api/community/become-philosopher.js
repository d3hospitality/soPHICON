import { requireEntitlement } from '../_entitlements.js';
// POST /api/community/become-philosopher
//
// Claim a philosopher row in the Community Hub. Idempotent on userId:
// same user re-calling with the same handle gets back the existing
// record; different handle = rename (server enforces uniqueness in v1).
//
// Request body (POST JSON):
//   {
//     userId: string,              // anonymous local UUID from Android
//     handle: string,              // ≤24 chars, alphanumeric + underscore
//     tradition: string,           // matches the canonical tradition enum
//     personaTone?: string,        // tone hint for sprite + classifier
//     personaApproach?: string,
//     personaSpeechStyle?: string,
//   }
//
// Response (200 JSON):
//   {
//     philId: string,
//     handle: string,
//     tradition: string,
//     spriteStatus: 'pending' | 'generating' | 'ready' | 'failed',
//   }

import { upsertPhilosopher } from './_store.js';

/**
 * Register or update a community philosopher identity. Idempotent
 * on userId -- re-calling with the same user updates the record.
 *
 * @description Claim a philosopher identity in the Community Hub
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.userId - Anonymous local UUID from the client
 * @param {string} req.body.handle - Display handle, max 24 chars, alphanumeric + underscore
 * @param {string} req.body.tradition - Canonical tradition enum value
 * @param {string} [req.body.personaTone] - Tone hint for sprite and classifier
 * @param {string} [req.body.personaApproach] - Approach hint
 * @param {string} [req.body.personaSpeechStyle] - Speech style hint
 * @returns {object} { philId: string, handle: string, tradition: string, spriteStatus: string }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const gate = await requireEntitlement(req, res, 'become-philosopher');
  if (!gate) return;

  try {
    const body = req.body || {};
    const userId = String(body.userId || req.headers['x-user-id'] || '').trim();
    const handle = String(body.handle || '').trim();
    const tradition = String(body.tradition || '').trim();
    if (!userId)    return res.status(400).json({ error: 'userId required' });
    if (!handle)    return res.status(400).json({ error: 'handle required' });
    if (handle.length > 24) return res.status(400).json({ error: 'handle exceeds 24 chars' });
    if (!/^[a-zA-Z0-9_]+$/.test(handle)) {
      return res.status(400).json({ error: 'handle must be alphanumeric + underscore' });
    }

    const rec = await upsertPhilosopher({
      userId,
      handle,
      tradition,
      personaTone: body.personaTone,
      personaApproach: body.personaApproach,
      personaSpeechStyle: body.personaSpeechStyle,
    });

    return res.status(200).json({
      philId: rec.philId,
      handle: rec.handle,
      tradition: rec.tradition,
      spriteStatus: rec.spriteStatus,
    });
  } catch (e) {
    console.error('become-philosopher failed:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
