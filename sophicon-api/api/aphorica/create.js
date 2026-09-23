import { createClient } from '@supabase/supabase-js';
import { classifyAphorism, rarityFromScore, BLOCKING_FLAGS } from './_classify.js';
import { requireEntitlement } from '../_entitlements.js';
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

const clamp = (v, n) => (v ? String(v).slice(0, n) : null);

// A valid, in-range coordinate or null (geo "wonderment mode" is opt-in).
const round3 = (n) => (n === null ? null : Math.round(n * 1000) / 1000);

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
  const gate = await requireEntitlement(req, res, 'aphorica-post');
  if (!gate) return;

  const text = String(req.body?.text || '').trim();
  if (text.length < 1 || text.length > 240) {
    return res.status(400).json({ error: 'text must be 1–240 characters' });
  }
  // PR-A1: the grade is the server's, never the client's. Any rarity,
  // ratingScore, emotion or archetype in the body is ignored — the post is
  // classified here, which also moderates it before it goes public.
  const context = clamp(req.body?.context, 80);
  let grade;
  try {
    grade = await classifyAphorism({ text, context: (context || '').slice(0, 60) });
  } catch {
    return res.status(502).json({ error: 'grading_unavailable', retryable: true });
  }
  if (BLOCKING_FLAGS.has(grade.moderationFlag)) {
    return res.status(422).json({ error: 'rejected', flag: grade.moderationFlag, reason: grade.rejectReason });
  }
  const rarity = grade.moderationFlag === 'fake_deep' ? 'common' : rarityFromScore(grade.ratingScore);
  const ratingScore = grade.ratingScore;

  // Opt-in geo tag: both coordinates must be present + valid, else neither
  // is stored. PR-A1: stored at ~110 m precision, never the exact spot.
  const lat = round3(coord(req.body?.latitude, 90));
  const lng = round3(coord(req.body?.longitude, 180));
  const geo = lat !== null && lng !== null ? { latitude: lat, longitude: lng } : {};

  try {
    const { data, error } = await admin()
      .from('aphorisms')
      .insert({
        user_id: id.userId,
        text,
        context,
        tradition: clamp(req.body?.tradition, 40),
        emotion: grade.emotion,
        archetype: grade.archetype,
        rarity,
        rating_score: ratingScore,
        ...geo,
      })
      .select('id')
      .single();
    if (error) throw error;
    return res.status(201).json({ id: data.id, rarity, ratingScore, emotion: grade.emotion, archetype: grade.archetype });
  } catch (err) {
    console.error('[aphorica/create]', err);
    return res.status(500).json({ error: 'create_failed' });
  }
}
