// ═══════════════════════════════════════════════════════════════════
// api/_store.js — tiny KV adapter backed by Supabase (public.api_kv).
// Same surface the code already used from @vercel/kv (incr, expire,
// get, set), so callers only swap their import. The old Vercel KV host
// no longer resolves; see supabase/2026-09-23_api_kv.sql.
//
// Errors are thrown, exactly like @vercel/kv, so each caller keeps its
// own fail-open / fail-closed decision.
// ═══════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

let _db = null;
function db() {
  if (!_db) {
    _db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _db;
}

export const kv = {
  /** Atomic +1. New or expired keys start at 1 with a 24h TTL (expire() can shorten it). */
  async incr(key) {
    const { data, error } = await db().rpc('api_kv_incr', { p_key: key, p_ttl_seconds: 86400 });
    if (error) throw error;
    return Number(data);
  },
  async expire(key, seconds) {
    const { error } = await db().rpc('api_kv_expire', { p_key: key, p_ttl_seconds: seconds });
    if (error) throw error;
    return 1;
  },
  async get(key) {
    const { data, error } = await db().from('api_kv').select('value, expires_at').eq('key', key).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (data.expires_at && new Date(data.expires_at) <= new Date()) return null;
    return data.value ?? null;
  },
  async set(key, value, opts = {}) {
    const expires_at = opts.ex ? new Date(Date.now() + opts.ex * 1000).toISOString() : null;
    const { error } = await db().from('api_kv')
      .upsert({ key, value, expires_at, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return 'OK';
  },
};
