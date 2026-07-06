import { createClient } from '@supabase/supabase-js';
import { identify } from './_auth.js';

/**
 * Device-sync gateway for surfaces that can't hold a Supabase session —
 * primarily the G2 companion webview, whose pairing token is a scoped
 * glasses JWT, not a Supabase JWT. Verifies identity via _auth.js and
 * proxies the same `device_sync` rows Android's SyncEngine and the web's
 * lib/deviceSync.js use. Wire contract (entity_type strings, payload
 * shapes, LWW on updated_at) is documented in enkispeaks-web
 * lib/deviceSync.js — this endpoint is shape-agnostic on purpose.
 *
 * GET  ?since=<ms>&types=habit,checklist_item   → { rows: [...], now }
 * POST { upserts: [{ entityType, entityId, payload, deletedAt? }] }
 *      → { upserted, now }
 */
const MAX_BATCH = 200;
const MAX_ROWS = 1000;

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const id = await identify(req);
  if (!id?.userId) return res.status(401).json({ error: 'auth_required' });

  try {
    if (req.method === 'GET') {
      const since = Number(req.query.since || 0);
      const sinceIso = new Date(Number.isFinite(since) ? since : 0).toISOString();
      let q = admin()
        .from('device_sync')
        .select('entity_type, entity_id, payload, deleted_at, updated_at')
        .eq('user_id', id.userId)
        .gt('updated_at', sinceIso)
        .order('updated_at', { ascending: true })
        .limit(MAX_ROWS);
      const types = String(req.query.types || '').split(',').map(s => s.trim()).filter(Boolean);
      if (types.length) q = q.in('entity_type', types);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ rows: data || [], now: Date.now() });
    }

    if (req.method === 'POST') {
      const upserts = Array.isArray(req.body?.upserts) ? req.body.upserts : [];
      if (!upserts.length) return res.status(400).json({ error: 'no_upserts' });
      if (upserts.length > MAX_BATCH) return res.status(400).json({ error: 'batch_too_large', max: MAX_BATCH });

      const nowIso = new Date().toISOString();
      const rows = [];
      for (const u of upserts) {
        if (!u?.entityType || !u?.entityId || typeof u.payload !== 'object' || u.payload === null) {
          return res.status(400).json({ error: 'bad_upsert_shape' });
        }
        rows.push({
          user_id: id.userId,
          entity_type: String(u.entityType),
          entity_id: String(u.entityId),
          payload: u.payload,
          deleted_at: u.deletedAt ? new Date(u.deletedAt).toISOString() : null,
          updated_at: nowIso,
        });
      }
      const { error } = await admin()
        .from('device_sync')
        .upsert(rows, { onConflict: 'user_id,entity_type,entity_id' });
      if (error) throw error;
      return res.status(200).json({ upserted: rows.length, now: Date.now() });
    }

    return res.status(405).json({ error: 'GET or POST only' });
  } catch (err) {
    console.error('[device-sync]', err);
    return res.status(500).json({ error: 'sync_failed' });
  }
}
