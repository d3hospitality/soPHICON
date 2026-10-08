// Waitlist: counts anonymous taps, requires sign-in to join, never spends.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const kvStore = new Map();
mock.module(new URL('../api/_store.js', import.meta.url).href, { namedExports: { kv: {
  incr: async (k) => { const n = (kvStore.get(k) || 0) + 1; kvStore.set(k, n); return n; },
  expire: async () => 1, get: async () => null, set: async () => 'OK',
} } });
let who = null;
mock.module(new URL('../api/_auth.js', import.meta.url).href, { namedExports: { identify: async () => who } });

const taps = []; const signups = new Map();
function table(name) {
  const f = {};
  const b = {
    insert: async (row) => { taps.push(row); return { error: null }; },
    upsert: async (row) => { const k = `${row.feature}:${row.user_id}`; signups.set(k, { ...signups.get(k), ...row }); return { error: null }; },
    select() { return b; }, eq(c, v) { f[c] = v; return b; },
    maybeSingle: async () => ({ data: signups.get(`${f.feature}:${f.user_id}`) || null }),
  };
  return b;
}
mock.module('@supabase/supabase-js', { namedExports: { createClient: () => ({ from: table }) } });
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';

const { default: wl, cleanText } = await import('../api/waitlist.js');
const call = (body, method = 'POST', query = {}) => new Promise((resolve) => {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; resolve(out); return this; }, end() { resolve(out); return this; } };
  wl({ method, headers: { 'x-forwarded-for': '1.2.3.4' }, body, query }, res);
});
beforeEach(() => { kvStore.clear(); taps.length = 0; signups.clear(); who = null; });

test('anonymous tap is counted without storing the IP', async () => {
  const r = await call({ feature: 'paint-me', action: 'tap', surface: 'g2' });
  assert.equal(r.status, 200);
  assert.equal(taps.length, 1);
  assert.ok(!JSON.stringify(taps[0]).includes('1.2.3.4'));
  assert.equal(taps[0].visitor.length, 24);
});

test('unknown feature, action or surface is refused', async () => {
  assert.equal((await call({ feature: 'clone-me', surface: 'g2' })).status, 400);
  assert.equal((await call({ feature: 'summon', action: 'buy', surface: 'g2' })).status, 400);
  assert.equal((await call({ feature: 'summon', surface: 'tv' })).status, 400);
});

test('anonymous join asks for sign-up but still counts the intent', async () => {
  const r = await call({ feature: 'summon', action: 'join', surface: 'web' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'auth_required');
  assert.equal(taps.length, 1);
  assert.equal(signups.size, 0);
});

test('signed-in join stores one row per user and keeps the philosopher', async () => {
  who = { userId: 'u1', tier: 'seeker', scope: 'user' };
  await call({ feature: 'summon', action: 'join', surface: 'web', philosopher: '  <b>Hypatia</b>\n of Alexandria ' });
  await call({ feature: 'summon', action: 'join', surface: 'g2' });
  assert.equal(signups.size, 1);
  assert.equal(signups.get('summon:u1').philosopher, 'bHypatia/b of Alexandria');
  const g = await call(undefined, 'GET', { feature: 'summon' });
  assert.equal(g.body.joined, true);
});

test('paint-me ignores a philosopher field', async () => {
  who = { userId: 'u2', tier: 'sage', scope: 'glasses' };
  await call({ feature: 'paint-me', action: 'join', surface: 'g2', philosopher: 'Me' });
  assert.equal(signups.get('paint-me:u2').philosopher, undefined);
});

test('per-IP brake kicks in', async () => {
  let last;
  for (let i = 0; i < 61; i++) last = await call({ feature: 'paint-me', action: 'view', surface: 'web' });
  assert.equal(last.status, 429);
});

test('cleanText caps length and drops control chars', () => {
  assert.equal(cleanText('a\u0000b', 10), 'ab');
  assert.equal(cleanText('x'.repeat(100), 60).length, 60);
  assert.equal(cleanText(42, 10), null);
});
