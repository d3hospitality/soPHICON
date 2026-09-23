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

test('client cannot self-grade: forged Legendary becomes the server grade', async () => {
  const r = await run(create, { body: { text: 'What you tend, grows. What you avoid, waits.', rarity: 'legendary', ratingScore: 100 } });
  assert.equal(r.status, 201);
  assert.equal(inserted.rarity, 'uncommon'); assert.equal(inserted.rating_score, 6);
  assert.equal(r.body.rarity, 'uncommon');
});

test('a genuinely great line earns Legendary from the server', async () => {
  modelReply.ratingScore = 10;
  const r = await run(create, { body: { text: 'The obstacle is the way.' } });
  assert.equal(inserted.rarity, 'legendary');
});

test('hateful posts are rejected before they reach the feed', async () => {
  modelReply.moderationFlag = 'hate'; modelReply.rejectReason = 'no';
  const r = await run(create, { body: { text: 'something hateful' } });
  assert.equal(r.status, 422); assert.equal(inserted, null);
});

test('grader down → nothing published, retryable', async () => {
  modelDown = true;
  const r = await run(create, { body: { text: 'A thought.' } });
  assert.equal(r.status, 502); assert.equal(inserted, null);
});

test('geo posts are stored at ~110 m precision', async () => {
  await run(create, { body: { text: 'Here I stood.', latitude: 51.513456, longitude: -0.131987 } });
  assert.equal(inserted.latitude, 51.513); assert.equal(inserted.longitude, -0.132);
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
