import { identify } from './_auth.js';

/**
 * Who am I, and what tier am I right now? Lets the glasses refresh the
 * tier they cached at pairing time (it goes stale after upgrades,
 * trials, cancellations). Display only — every billable route still
 * checks the tier itself. No provider cost.
 *
 * @method GET
 * @returns {object} { tier: 'seeker'|'sage', scope: 'user'|'glasses' }  (401 if no valid token)
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const id = await identify(req).catch(() => null);
  if (!id?.userId) return res.status(401).json({ error: 'auth_required' });
  return res.status(200).json({ tier: id.tier, scope: id.scope });
}
