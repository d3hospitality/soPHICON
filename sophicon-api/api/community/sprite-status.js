// GET /api/community/sprite-status?philId=...
//
// Poll-friendly read for the sprite-init pipeline. The Android client
// hits this every ~3 seconds while the loading screen is up so the UI
// can transition between the four states:
//
//   • 'pending'    — onboarding done, sprite gen not yet triggered.
//   • 'generating' — OpenAI call in flight (or queued).
//   • 'ready'      — sprite painted, base64 returned via sprite-init.
//   • 'failed'     — pipeline error; `spriteError` carries the reason.
//
// Response (200 JSON):
//   { spriteStatus: '...', spriteError: string | null }

import { getPhilosopherByPhilId } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const philId = String(req.query.philId || '').trim();
    if (!philId) return res.status(400).json({ error: 'philId required' });
    const phil = await getPhilosopherByPhilId(philId);
    if (!phil) return res.status(404).json({ error: 'philId not found' });
    return res.status(200).json({
      spriteStatus: phil.spriteStatus || 'pending',
      spriteError: phil.spriteError || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'sprite-status failed' });
  }
}
