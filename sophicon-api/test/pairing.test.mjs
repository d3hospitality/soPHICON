// PR04 tests — glasses pairing + revocation. Supabase/KV mocked, real JWTs.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const kvStore = new Map(); let kvDown = false;
mock.module('@vercel/kv', { namedExports: { kv: {
  incr: async (k) => { if (kvDown) throw new Error('down'); const n = (kvStore.get(k) || 0) + 1; kvStore.set(k, n); return n; },
  expire: async () => 1,
  get: async (k) => { if (kvDown) throw new Error('down'); return kvStore.get(k) ?? null; },
  set: async (k, v) => { if (kvDown) throw new Error('down'); kvStore.set(k, v); return 'OK'; },
} } });

// Minimal Supabase query-builder fake. update().eq().is().gt().select()
// applies the conditions atomically, like the real single UPDATE.
const codes = new Map();
function table(name) {
  const f = { ops: [], op: 'select' };
  const b = {
    select() { return name === 'glasses_link_codes' && f.op === 'update' ? Promise.resolve(run()) : b; },
    update(v) { f.op = 'update'; f.val = v; return b; },
    eq(c, v) { f.ops.push((r) => r[c] === v); return b; },
    is(c, v) { f.ops.push((r) => r[c] === v); return b; },
    gt(c, v) { f.ops.push((r) => r[c] > v); return b; },
    single: async () => ({ data: name === 'profiles' ? { handle: 'romario', tier: 'sage' } : null }),
  };
  function run() {
    const hits = [...codes.values()].filter((r) => f.ops.every((fn) => fn(r)));
    hits.forEach((r) => Object.assign(r, f.val));
    return { data: hits.map((r) => ({ user_id: r.user_id })) };
  }
  return b;
}
mock.module('@supabase/supabase-js', { namedExports: { createClient: () => ({ from: table }) } });

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.GLASSES_TOKEN_SECRET = 'test-secret-for-unit-tests-only-000000';

const { default: link } = await import('../api/glasses-link.js');
const { default: unlink } = await import('../api/glasses-unlink.js');
const { identify } = await import('../api/_auth.js');

const call = (h, body, headers = {}) => new Promise((resolve) => {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; resolve(out); return this; }, end() { resolve(out); return this; } };
  h({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9', ...headers }, body }, res);
});
const future = () => new Date(Date.now() + 600000).toISOString();

beforeEach(() => { kvStore.clear(); codes.clear(); kvDown = false; });

test('a code can only be redeemed once, even concurrently', async () => {
  codes.set('ABC123', { code: 'ABC123', user_id: 'u1', expires_at: future(), used_at: null });
  const [a, b] = await Promise.all([call(link, { code: 'ABC123' }), call(link, { code: 'abc123' })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
});

test('expired codes are refused', async () => {
  codes.set('OLD000', { code: 'OLD000', user_id: 'u1', expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null });
  assert.equal((await call(link, { code: 'OLD000' })).status, 400);
});

test('brute force is throttled per IP', async () => {
  for (let i = 0; i < 10; i++) await call(link, { code: 'ZZZZZ' + i });
  assert.equal((await call(link, { code: 'ZZZZZZ' })).status, 429);
});

test('KV outage refuses pairing instead of allowing unlimited guesses', async () => {
  kvDown = true;
  assert.equal((await call(link, { code: 'ABC123' })).status, 503);
});

test('new tokens identify as glasses; unpair-all revokes them', async () => {
  codes.set('PAIR01', { code: 'PAIR01', user_id: 'u1', expires_at: future(), used_at: null });
  const { body } = await call(link, { code: 'PAIR01' });
  const auth = { authorization: `Bearer ${body.token}` };
  const who = await identify({ headers: auth });
  assert.equal(who.userId, 'u1'); assert.equal(who.scope, 'glasses');

  // Glasses cannot unpair themselves; only a user session can.
  assert.equal((await call(unlink, {}, auth)).status, 403);

  kvStore.set('gl:revokedBefore:u1', Math.floor(Date.now() / 1000) + 1);
  assert.equal(await identify({ headers: auth }), null);
});
