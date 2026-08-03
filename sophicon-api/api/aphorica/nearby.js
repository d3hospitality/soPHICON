import { createClient } from '@supabase/supabase-js';

/**
 * Geo "wonderment mode" — the aphorisms that were anchored to a place, near a
 * given point. Public read (no auth): the client passes its coarse location and
 * gets back thoughts left within `radius` metres, nearest first. The device
 * geofences these and buzzes when you physically wander close.
 *
 * GET /api/aphorica/nearby?lat=..&lng=..&radius=1500&limit=25 → { posts: [...] }
 * Each post: { id, text, tradition, rarity, latitude, longitude, distance,
 *              author, authorSprite, createdAt }
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

// Haversine distance in metres.
function metres(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'valid lat & lng required' });
  }
  const radius = Math.min(20000, Math.max(100, Number(req.query.radius) || 1500));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));

  // Bounding box in degrees (a cheap prefilter; exact distance is computed below).
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));

  try {
    const { data, error } = await admin()
      .from('aphorisms')
      .select('id, text, tradition, rarity, latitude, longitude, created_at, profiles(handle, sprite_path)')
      .is('deleted_at', null)
      .not('latitude', 'is', null)
      .gte('latitude', lat - dLat)
      .lte('latitude', lat + dLat)
      .gte('longitude', lng - dLng)
      .lte('longitude', lng + dLng)
      .limit(200);
    if (error) throw error;

    const posts = (data || [])
      .map((r) => ({
        id: r.id,
        text: r.text,
        tradition: r.tradition,
        rarity: r.rarity || 'common',
        latitude: r.latitude,
        longitude: r.longitude,
        distance: Math.round(metres(lat, lng, r.latitude, r.longitude)),
        author: r.profiles?.handle || 'a wanderer',
        authorSprite: r.profiles?.sprite_path || null,
        createdAt: r.created_at ? new Date(r.created_at).getTime() / 1000 : null,
      }))
      .filter((p) => p.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);

    return res.status(200).json({ posts });
  } catch (err) {
    console.error('[aphorica/nearby]', err);
    return res.status(500).json({ error: 'nearby_failed' });
  }
}
