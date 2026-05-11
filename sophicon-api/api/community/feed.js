// GET /api/community/feed?sort=...&weekKey=...&cursor=...&limit=...
//
// Server-paged feed read. Cursor-based; an empty/null cursor returns
// page 1. Sort modes:
//   • WEEKLY_TOP — top-liked within weekKey (defaults to current ISO week)
//   • ALL_TIME   — top-liked all time
//   • RISING     — naive hot-score; likes/(age-in-hours)
//   • FRESH      — newest first
//
// Response (200 JSON):
//   {
//     quotes:     Quote[],   // page of records (see submit-quote response shape)
//     nextCursor: string?,   // null when no more pages
//     weekKey:    string,    // ISO week the feed is scoped to
//   }

import { readFeed } from './_store.js';

const ALLOWED_SORTS = new Set(['WEEKLY_TOP', 'ALL_TIME', 'RISING', 'FRESH']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const sort = String(req.query.sort || 'FRESH').toUpperCase();
    if (!ALLOWED_SORTS.has(sort)) {
      return res.status(400).json({ error: `sort must be one of ${[...ALLOWED_SORTS].join(', ')}` });
    }
    const weekKey = req.query.weekKey ? String(req.query.weekKey) : null;
    const cursor  = req.query.cursor  ? String(req.query.cursor)  : null;
    const limit   = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 20));

    const page = await readFeed({ sort, weekKey, cursor, limit });
    return res.status(200).json(page);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'feed failed' });
  }
}
