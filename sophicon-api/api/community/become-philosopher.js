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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
    return res.status(500).json({ error: e.message || 'become-philosopher failed' });
  }
}
