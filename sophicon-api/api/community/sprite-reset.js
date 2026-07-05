import { requireEntitlement } from '../_entitlements.js';
// POST /api/community/sprite-reset
//
// Reset a philosopher's sprite-generation state back to 'pending' and
// clear any prior error. Used in two flows:
//
//   1. CANCEL — user hits Cancel on the loading overlay while
//      sprite-init is mid-flight. The OpenAI call on the server can't
//      actually be cancelled (gpt-image-1 has no abort handle once
//      submitted; the response WILL come back ~30-60s later and the
//      function WILL write a 'ready' status to KV). What this endpoint
//      gives the client is a clean way to:
//        • Stamp status back to 'pending' so the loading screen
//          dismisses immediately.
//        • Mark a "cancellation epoch" so when sprite-init eventually
//          finishes, the client knows to discard its result (the
//          client-side check on response → reset epoch).
//
//      In practice the simpler v0 behavior is: client gives up, calls
//      reset, server flips to pending. If sprite-init later writes
//      'ready', the client's loading screen is already gone and the
//      Community card just shows the new sprite — which is actually
//      fine. Most users won't notice. Bonus.
//
//   2. RESET — user has a 'ready' sprite they don't like and wants to
//      retry with the same reference photos. Endpoint flips status
//      to 'pending', client deletes the local neutral.png, the next
//      sprite-init call re-paints.
//
// Request body (POST JSON):
//   {
//     userId: string,
//     philId: string,
//   }
//
// Response (200 JSON):
//   { spriteStatus: 'pending', spriteError: null }
//
// This endpoint does NOT delete the philosopher record or the user's
// uploaded reference photos — those live on the client's disk at
// filesDir/sprite-refs/<philId>/ref_NN.jpg and the client decides
// what to do with them.

import {
  getPhilosopherByPhilId,
  setSpriteStatus,
} from './_store.js';

/**
 * Reset a philosopher's sprite-generation state back to 'pending'.
 * Used for cancel-during-generation and retry-with-same-photos flows.
 * Does not delete the philosopher record or local reference photos.
 *
 * @description Reset sprite generation state to pending
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.userId - The user's anonymous UUID
 * @param {string} req.body.philId - The philosopher identity to reset
 * @returns {object} { spriteStatus: 'pending', spriteError: null }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const gate = await requireEntitlement(req, res, 'sprite');
  if (!gate) return;

  try {
    const body = req.body || {};
    const userId = String(body.userId || req.headers['x-user-id'] || '').trim();
    const philId = String(body.philId || '').trim();
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!philId) return res.status(400).json({ error: 'philId required' });

    const phil = await getPhilosopherByPhilId(philId);
    if (!phil) return res.status(404).json({ error: 'philId not found' });

    await setSpriteStatus({ philId, status: 'pending', error: null });
    return res.status(200).json({ spriteStatus: 'pending', spriteError: null });
  } catch (e) {
    console.error('sprite-reset failed:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
