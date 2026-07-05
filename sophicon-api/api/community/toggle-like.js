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

/**
 * Like or unlike a community quote. Idempotent -- re-calling with
 * the same state is a no-op. Updates sorted-set scores so feed
 * orderings stay accurate.
 *
 * @description Toggle like on a community quote
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.userId - The liking user's anonymous UUID
 * @param {string} req.body.quoteId - The quote to like/unlike
 * @param {boolean} req.body.liked - true to like, false to unlike
 * @returns {object} { quoteId: string, likeCount: number, likedByMe: boolean }
 */
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
    console.error('toggle-like failed:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
