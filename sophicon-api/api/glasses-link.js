import { SignJWT } from 'jose';
import { createClient } from '@supabase/supabase-js';

/**
 * Exchange a short pairing code (minted by the web app while signed in)
 * for a long-lived glasses token. The G2 phone dashboard calls this once;
 * the token then rides every speak/transcribe request as a Bearer header.
 *
 * Tier is NOT baked into the token — _auth.js looks it up per request,
 * so Stripe upgrades/downgrades reach the glasses within a minute.
 *
 * @description Redeem a glasses pairing code
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.code - 6-character pairing code from enkiridion.com settings
 * @returns {object} { token: string, handle: string, tier: string }
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.GLASSES_TOKEN_SECRET) {
    return res.status(500).json({ error: 'Server configuration error: glasses linking not configured' });
  }

  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      return res.status(400).json({ error: 'invalid_code' });
    }

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: row } = await admin
      .from('glasses_link_codes')
      .select('code, user_id, expires_at, used_at')
      .eq('code', code)
      .single();

    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'invalid_code' });
    }

    await admin
      .from('glasses_link_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('code', code);

    const { data: profile } = await admin
      .from('profiles')
      .select('handle, tier')
      .eq('id', row.user_id)
      .single();

    const token = await new SignJWT({ scope: 'glasses' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(row.user_id)
      .setIssuedAt()
      .setExpirationTime('180d')
      .sign(new TextEncoder().encode(process.env.GLASSES_TOKEN_SECRET));

    return res.status(200).json({
      token,
      handle: profile?.handle || null,
      tier: profile?.tier === 'sage' ? 'sage' : 'seeker',
    });
  } catch (err) {
    console.error('[glasses-link]', err);
    return res.status(500).json({ error: 'link_failed' });
  }
}
