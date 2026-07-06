import { createClient } from '@supabase/supabase-js';
import { identify } from '../_auth.js';

/**
 * Aphorica feed from the CANONICAL store (Supabase `aphorisms`) — the
 * same rows the web and Android read. Exists so the G2 companion (no
 * Supabase session) sees the same community as every other surface.
 * NOTE: distinct from the legacy KV-backed community/feed.js.
 *
 * GET ?sort=hot|new&limit=50 → { posts: [...] }
 * Open endpoint (the table is public-read); when a Bearer identity is
 * present, each post carries likedByMe from aphorism_votes.
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

const STAR_WEIGHT = 2;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const sort = req.query.sort === 'new' ? 'new' : 'hot';

    const { data: rows, error } = await admin()
      .from('aphorisms')
      .select('id, user_id, text, tradition, emotion, archetype, rarity, rating_score, stars_received, upvotes, downvotes, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;

    const authorIds = [...new Set((rows || []).map(r => r.user_id))];
    const authors = {};
    if (authorIds.length) {
      const { data: profs } = await admin()
        .from('public_profiles')
        .select('id, handle, tier, sprite_path')
        .in('id', authorIds);
      for (const p of profs || []) authors[p.id] = p;
    }

    const me = await identify(req);
    const myVotes = {};
    if (me?.userId && rows?.length) {
      const { data: votes } = await admin()
        .from('aphorism_votes')
        .select('aphorism_id, vote')
        .eq('user_id', me.userId)
        .in('aphorism_id', rows.map(r => r.id));
      for (const v of votes || []) myVotes[v.aphorism_id] = v.vote;
    }

    const scored = (rows || []).map(r => {
      const clout = (r.upvotes - r.downvotes) + r.stars_received * STAR_WEIGHT;
      const ageHrs = Math.max(1, (Date.now() - new Date(r.created_at).getTime()) / 3.6e6);
      return {
        id: r.id,
        text: r.text,
        tradition: r.tradition,
        emotion: r.emotion,
        archetype: r.archetype,
        rarity: r.rarity,
        stars: r.stars_received,
        upvotes: r.upvotes,
        downvotes: r.downvotes,
        createdAt: r.created_at,
        author: authors[r.user_id]
          ? { handle: authors[r.user_id].handle, tier: authors[r.user_id].tier, spritePath: authors[r.user_id].sprite_path }
          : { handle: 'seeker', tier: 'seeker', spritePath: null },
        myVote: myVotes[r.id] || 0,
        _hot: clout / Math.pow(ageHrs, 0.8),
      };
    });

    if (sort === 'hot') scored.sort((a, b) => b._hot - a._hot);
    const posts = scored.slice(0, limit).map(({ _hot, ...p }) => p);
    return res.status(200).json({ posts });
  } catch (err) {
    console.error('[aphorica/supafeed]', err);
    return res.status(500).json({ error: 'feed_failed' });
  }
}
