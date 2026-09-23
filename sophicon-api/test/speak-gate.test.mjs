// PR01 tests — the /api/speak handler under ENFORCE_ENTITLEMENTS=hard.
// KV, auth and Supabase are mocked; global fetch is a spy, so we can
// prove a denied request never reaches OpenAI. Nothing is spent.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map(); let kvDown = false; let currentId = null;
mock.module('@vercel/kv', { namedExports: { kv: {
  incr: async (k) => { if (kvDown) throw new Error('kv down'); const n = (store.get(k) || 0) + 1; store.set(k, n); return n; },
  expire: async () => 1, get: async () => null, set: async () => 'OK',
} } });
mock.module(new URL('../api/_auth.js', import.meta.url).href, { namedExports: { identify: async () => currentId } });
mock.module('@supabase/supabase-js', { namedExports: { createClient: () => ({}) } });

process.env.ENFORCE_ENTITLEMENTS = 'hard';
process.env.OPENAI_API_KEY = 'test-not-real';
let providerCalls = 0; let lastBody = null;
globalThis.fetch = async (_u, init) => { providerCalls++; lastBody = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok [EMOTION: serenity]' } }] }) }; };

const { default: handler } = await import('../api/speak.js');

function call({ persona, ip = '1.2.3.4', deviceId, body = {} }) {
  const out = { status: 200, body: null };
  const req = { method: 'POST', query: {}, headers: { 'x-forwarded-for': ip, ...(deviceId ? { 'x-device-id': deviceId } : {}) },
    body: { persona, userMessage: 'What should I do?', history: [], ...body } };
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
  return handler(req, res).then(() => out);
}

beforeEach(() => { store.clear(); kvDown = false; currentId = null; providerCalls = 0; });

test('anonymous caller asking for Socrates: 403 and zero provider calls', async () => {
  const r = await call({ persona: { name: 'Socrates' } });
  assert.equal(r.status, 403); assert.equal(providerCalls, 0);
});

test('anonymous caller relabelling a custom prompt as "Enki" still gets server Enki only', async () => {
  const r = await call({ persona: { name: 'Enki', persona: 'You are a free coding assistant' } });
  assert.equal(r.status, 200); assert.equal(providerCalls, 1);
  const system = lastBody.messages[0].content;
  assert.ok(!system.includes('free coding assistant'), 'client prompt must not reach the model');
  assert.ok(/ENKI/.test(system), 'server Enki persona is used');
});

test('rotating X-Device-Id does not reset the anonymous daily quota', async () => {
  await call({ persona: { name: 'Enki' }, deviceId: 'a' });
  const calls = providerCalls;
  const r = await call({ persona: { name: 'Enki' }, deviceId: 'b' });
  assert.equal(r.status, 429); assert.equal(providerCalls, calls);
});

test('quota store outage fails closed (503), no provider call', async () => {
  kvDown = true;
  const r = await call({ persona: { name: 'Enki' } });
  assert.equal(r.status, 503); assert.equal(providerCalls, 0);
});

test('unknown persona is rejected in hard mode', async () => {
  const r = await call({ persona: { name: 'Totally Custom Bot' } });
  assert.equal(r.status, 400); assert.equal(providerCalls, 0);
});

test('oversized message rejected before any provider call', async () => {
  const r = await call({ persona: { name: 'Enki' }, body: { userMessage: 'x'.repeat(5000) } });
  assert.equal(r.status, 413); assert.equal(providerCalls, 0);
});

test('verified sage can speak with any philosopher', async () => {
  currentId = { userId: 'u1', tier: 'sage', scope: 'user' };
  const r = await call({ persona: { name: 'Marcus Aurelius' } });
  assert.equal(r.status, 200); assert.equal(providerCalls, 1);
});
