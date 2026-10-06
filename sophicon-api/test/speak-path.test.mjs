// The person's path (goals + kept moves) reaches the philosopher's
// system prompt, capped, and is absent when the client sends none.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

mock.module(new URL('../api/_store.js', import.meta.url).href, { namedExports: { kv: {
  incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK',
} } });
mock.module(new URL('../api/_auth.js', import.meta.url).href, { namedExports: { identify: async () => null } });
mock.module('@supabase/supabase-js', { namedExports: { createClient: () => ({}) } });
// The real persona prompts are private (gitignored _personas.js); a stub
// Enki is enough to prove where the path lands in the prompt.
mock.module(new URL('../api/_persona.js', import.meta.url).href, { namedExports: {
  resolvePersona: () => ({ id: 'enki', persona: { name: 'Enki', tradition: 'Primordial', persona: 'stub' } }),
  PERSONA_IDS: ['enki'],
} });

process.env.ENFORCE_ENTITLEMENTS = 'hard';
process.env.OPENAI_API_KEY = 'test-not-real';
let lastBody = null;
globalThis.fetch = async (_u, init) => { lastBody = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok [EMOTION: serenity]' } }] }) }; };
const { default: handler } = await import('../api/speak.js');

function call(body) {
  const out = { status: 200 };
  const req = { method: 'POST', query: {}, headers: { 'x-forwarded-for': '5.5.5.5' }, body: { persona: { name: 'Enki' }, userMessage: 'Hi', history: [], ...body } };
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
  return handler(req, res).then(() => out);
}
beforeEach(() => { lastBody = null; });

test('goals and open moves reach the system prompt', async () => {
  const r = await call({ pathContext: 'Goals:\n- Open my own restaurant\nOpen moves:\n- Call the landlord (kept Oct 5)' });
  assert.equal(r.status, 200);
  const system = lastBody.messages[0].content;
  assert.match(system, /THEIR PATH/); assert.match(system, /Call the landlord/);
});

test('no path, no block; an oversized path is capped', async () => {
  await call({});
  assert.doesNotMatch(lastBody.messages[0].content, /THEIR PATH/);
  await call({ pathContext: 'x'.repeat(5000) });
  const block = lastBody.messages[0].content.split('THEIR PATH')[1];
  assert.ok(block && !block.includes('x'.repeat(1201)));
});
