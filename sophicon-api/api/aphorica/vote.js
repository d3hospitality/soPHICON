import { createClient } from '@supabase/supabase-js';
import { identify } from '../_auth.js';

/**
 * Vote gateway for surfaces without a Supabase session (G2 companion).
 * Mirrors the vote_aphorism RPC semantics: one vote per user, atomic
 * recount. POST { aphorismId, vote: 1 | -1 | 0 } → { upvotes, downvotes }
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const id = await identify(req);
  if (!id?.userId) return res.status(401).json({ error: 'auth_required' });

  const { aphorismId, vote } = req.body || {};
  if (!aphorismId || ![1, -1, 0].includes(vote)) {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    if (vote === 0) {
      await admin().from('aphorism_votes')
        .delete().eq('aphorism_id', aphorismId).eq('user_id', id.userId);
    } else {
      const { error } = await admin().from('aphorism_votes')
        .upsert({ aphorism_id: aphorismId, user_id: id.userId, vote },
                { onConflict: 'aphorism_id,user_id' });
      if (error) throw error;
    }

    const { count: up } = await admin().from('aphorism_votes')
      .select('*', { count: 'exact', head: true })
      .eq('aphorism_id', aphorismId).eq('vote', 1);
    const { count: down } = await admin().from('aphorism_votes')
      .select('*', { count: 'exact', head: true })
      .eq('aphorism_id', aphorismId).eq('vote', -1);

    const { error: updErr } = await admin().from('aphorisms')
      .update({ upvotes: up || 0, downvotes: down || 0 })
      .eq('id', aphorismId);
    if (updErr) throw updErr;

    return res.status(200).json({ upvotes: up || 0, downvotes: down || 0 });
  } catch (err) {
    console.error('[aphorica/vote]', err);
    return res.status(500).json({ error: 'vote_failed' });
  }
}
