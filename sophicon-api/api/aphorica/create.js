import { createClient } from '@supabase/supabase-js';
import { identify } from '../_auth.js';

/**
 * Publish a user-authored aphorism from a surface without a Supabase session
 * (Apple apps / G2 companion). Auth via _auth.js identify() — accepts either a
 * glasses/pairing JWT or a Supabase user JWT. Mirrors the web POST /api/aphorica
 * insert into the `aphorisms` table (server enforces the 1–240 char limit).
 *
 * POST { text, context?, tradition?, emotion?, archetype?, rarity?, ratingScore? }
 *   → 201 { id }
 */
let _admin = null;
function admin() {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const clamp = (v, n) => (v ? String(v).slice(0, n) : null);

// A valid, in-range coordinate or null (geo "wonderment mode" is opt-in).
function coord(v, max) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const id = await identify(req);
  if (!id?.userId) return res.status(401).json({ error: 'auth_required' });

  const text = String(req.body?.text || '').trim();
  if (text.length < 1 || text.length > 240) {
    return res.status(400).json({ error: 'text must be 1–240 characters' });
  }
  const rarityIn = String(req.body?.rarity || 'common').toLowerCase();
  const rarity = RARITIES.includes(rarityIn) ? rarityIn : 'common';
  const ratingScore = Number.isFinite(req.body?.ratingScore)
    ? Math.max(0, Math.min(100, Math.round(req.body.ratingScore)))
    : 0;

  // Opt-in geo tag: both coordinates must be present + valid, else neither is stored.
  const lat = coord(req.body?.latitude, 90);
  const lng = coord(req.body?.longitude, 180);
  const geo = lat !== null && lng !== null ? { latitude: lat, longitude: lng } : {};

  try {
    const { data, error } = await admin()
      .from('aphorisms')
      .insert({
        user_id: id.userId,
        text,
        context: clamp(req.body?.context, 80),
        tradition: clamp(req.body?.tradition, 40),
        emotion: clamp(req.body?.emotion, 40),
        archetype: clamp(req.body?.archetype, 40),
        rarity,
        rating_score: ratingScore,
        ...geo,
      })
      .select('id')
      .single();
    if (error) throw error;
    return res.status(201).json({ id: data.id });
  } catch (err) {
    console.error('[aphorica/create]', err);
    return res.status(500).json({ error: 'create_failed' });
  }
}
