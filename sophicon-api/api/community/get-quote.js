// GET /api/community/get-quote?quoteId=...
//
// Single-quote read for polling status changes after submit. The
// Android client uses this to detect when a quote flips from
// status='rating' to status='published' after the classifier finishes.
//
// Response (200 JSON): the full Quote record (or 404 if not found).

import { getQuoteById } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const quoteId = String(req.query.quoteId || '').trim();
    if (!quoteId) return res.status(400).json({ error: 'quoteId required' });
    const q = await getQuoteById(quoteId);
    if (!q) return res.status(404).json({ error: 'quote not found' });
    return res.status(200).json(q);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'get-quote failed' });
  }
}
