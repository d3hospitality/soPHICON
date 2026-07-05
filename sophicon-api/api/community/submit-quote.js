import { requireEntitlement } from '../_entitlements.js';
// POST /api/community/submit-quote
//
// Submit a community quote for taxonomy rating + publish. Returns the
// quote record with status='published' in v0; once the classifier
// pipeline lands here, this will return status='rating' and the client
// will poll /api/community/get-quote until status flips.
//
// Request body (POST JSON):
//   {
//     userId: string,
//     philId: string,
//     text:   string,        // ≤240 chars
//     source: string?,       // optional attribution / origin note
//   }
//
// Response (200 JSON): a Quote record matching the CommunityQuoteEntity
// shape (see soPHICON-Community-Hub-SDK §4.2).

import { submitQuote, getPhilosopherByPhilId } from './_store.js';

/**
 * Submit a community aphorism for publication. Validates the philId
 * exists, creates the quote record, and indexes it in sorted sets
 * for feed retrieval.
 *
 * @description Publish a community quote
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.userId - Submitter's anonymous UUID
 * @param {string} req.body.philId - Submitter's philosopher identity ID
 * @param {string} req.body.text - Quote text, max 240 chars
 * @param {string} [req.body.source] - Optional attribution or origin note
 * @returns {object} Full quote record (CommunityQuoteEntity shape)
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const gate = await requireEntitlement(req, res, 'community-submit');
  if (!gate) return;

  try {
    const body = req.body || {};
    const userId = String(body.userId || req.headers['x-user-id'] || '').trim();
    const philId = String(body.philId || '').trim();
    const text   = String(body.text || '').trim();
    const source = String(body.source || '').trim();
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!philId) return res.status(400).json({ error: 'philId required' });
    if (!text)   return res.status(400).json({ error: 'text required' });
    if (text.length > 240) return res.status(400).json({ error: 'text exceeds 240 chars' });

    // Sanity: the philId should exist. We don't enforce strict ownership
    // here because in v0 anyone with a philId can post; future versions
    // tie philId → userId via auth and reject mismatches.
    const phil = await getPhilosopherByPhilId(philId);
    if (!phil) return res.status(404).json({ error: 'philId not found' });

    const quote = await submitQuote({ userId, philId, text, source });
    return res.status(200).json(quote);
  } catch (e) {
    console.error('submit-quote failed:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
