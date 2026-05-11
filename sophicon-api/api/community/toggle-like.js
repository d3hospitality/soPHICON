// POST /api/community/toggle-like
//
// Like/unlike a community quote. Idempotent: re-calling with the same
// state is a no-op. Returns the canonical post-update count + flag so
// the client doesn't need a separate read.
//
// Request body (POST JSON):
//   {
//     userId:  string,
//     quoteId: string,
//     liked:   boolean,   // true = like, false = unlike
//   }
//
// Response (200 JSON):
//   {
//     quoteId:   string,
//     likeCount: number,
//     likedByMe: boolean,
//   }

import { toggleLike } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const userId  = String(body.userId  || req.headers['x-user-id'] || '').trim();
    const quoteId = String(body.quoteId || '').trim();
    const liked   = Boolean(body.liked);
    if (!userId)  return res.status(400).json({ error: 'userId required' });
    if (!quoteId) return res.status(400).json({ error: 'quoteId required' });

    const result = await toggleLike({ userId, quoteId, liked });
    if (!result) return res.status(404).json({ error: 'quote not found' });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'toggle-like failed' });
  }
}
