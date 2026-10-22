// PR-A1 tests — server-owned Aphorica grades + location privacy. All mocked.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

mock.module(new URL('../api/_store.js', import.meta.url).href, { namedExports: { kv: {
  incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK' } } });
let who = { userId: 'u1', tier: 'seeker', scope: 'user' };
mock.module(new URL('../api/_auth.js', import.meta.url).href, { namedExports: { identify: async () => who } });

let inserted = null; let geoRows = [];
mock.module('@supabase/supabase-js', { namedExports: { createClient: () => ({
  from: (t) => {
    const q = {
      insert(row) { inserted = row; return q; },
      select() { return q; }, single: async () => ({ data: { id: 'post-1' }, error: null }),
      not() { return q; }, is() { return q; }, eq() { return q; }, order() { return q; }, gte() { return q; }, lte() { return q; },
      limit: async () => ({ data: geoRows, error: null }),
    };
    return q;
  },
}) } });

process.env.OPENAI_API_KEY = 'test'; process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.ENFORCE_ENTITLEMENTS = 'hard';
let modelReply = {}; let modelDown = false;
globalThis.fetch = async () => modelDown
  ? { ok: false, text: async () => 'down' }
  : { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(modelReply) } }] }) };

const { default: create } = await import('../api/aphorica/create.js');
const { default: nearby } = await import('../api/aphorica/nearby.js');

const run = (h, { method = 'POST', body, query }) => new Promise((resolve) => {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; resolve(out); return this; }, end() { resolve(out); return this; } };
  h({ method, headers: { authorization: 'Bearer x', 'x-forwarded-for': '1.1.1.1' }, body, query }, res);
});

beforeEach(() => { inserted = null; modelDown = false; who = { userId: 'u1', tier: 'seeker', scope: 'user' };
  modelReply = { emotion: 'serenity', archetype: 'the_sage', blend: 'fierce_clarity', ratingScore: 6, tags: [], moderationFlag: null }; });

test('legacy publication retires without accepting a forged grade or precise location', async () => {
 const r=await run(create,{body:{text:'A thought',rarity:'legendary',ratingScore:100,latitude:51.513456,longitude:-.131987}});
 assert.equal(r.status,410);assert.equal(inserted,null);assert.equal(r.body.url,'https://enkiridion.com/aphorica');
});

test('nearby never returns exact spot or exact time', async () => {
  geoRows = [{ id: 'a', text: 't', tradition: null, rarity: 'rare', latitude: 51.513456, longitude: -0.131987,
    created_at: '2026-09-23T14:37:12Z', profiles: { handle: 'someone', sprite_path: null } }];
  const r = await run(nearby, { method: 'GET', query: { lat: '51.5134', lng: '-0.1320', radius: '1500' } });
  const p = r.body.posts[0];
  assert.equal(p.latitude, 51.513); assert.equal(p.longitude, -0.132);
  assert.equal(p.distance % 50, 0);
  assert.equal(p.createdAt % 86400, 0);
});
