// /api/next-move — the gate, the "nothing said, nothing spent" rule, and
// the server-side checks on whatever the model returns. KV, auth and
// Supabase are mocked; fetch is a spy, so nothing is spent.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map(); let currentId = null;
mock.module(new URL('../api/_store.js', import.meta.url).href, { namedExports: { kv: {
  incr: async (k) => { const n = (store.get(k) || 0) + 1; store.set(k, n); return n; },
  expire: async () => 1, get: async () => null, set: async () => 'OK',
} } });
mock.module(new URL('../api/_auth.js', import.meta.url).href, { namedExports: { identify: async () => currentId } });
mock.module('@supabase/supabase-js', { namedExports: { createClient: () => ({}) } });

process.env.ENFORCE_ENTITLEMENTS = 'hard';
process.env.OPENAI_API_KEY = 'test-not-real';
let providerCalls = 0; let lastBody = null; let modelReply = {};
globalThis.fetch = async (_u, init) => {
  providerCalls++; lastBody = JSON.parse(init.body);
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(modelReply) } }] }) };
};

const { default: handler } = await import('../api/next-move.js');

const TALK = [
  { role: 'assistant', content: 'What weighs on you?' },
  { role: 'user', content: 'The landlord has not answered about the lease and I keep putting off calling.' },
  { role: 'assistant', content: 'Then the call is the thing.' },
];
function call(body, ip = '9.9.9.9') {
  const out = { status: 200, body: null };
  const req = { method: 'POST', query: {}, headers: { 'x-forwarded-for': ip }, body };
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
  return handler(req, res).then(() => out);
}

beforeEach(() => { store.clear(); currentId = null; providerCalls = 0; lastBody = null; modelReply = {}; });

test('a talk with nothing the person said returns no move and spends nothing', async () => {
  const r = await call({ philName: 'Enki', exchanges: [{ role: 'assistant', content: 'Welcome.' }] });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { move: null, goalId: null, suggestedGoal: null });
  assert.equal(providerCalls, 0); assert.equal(store.size, 0);
});

test('a real talk gets a move tied to the goal it serves; goals reach the prompt', async () => {
  modelReply = { move: '"Call the landlord about the lease this week"', goalId: 'g1', suggestedGoal: 'Open a restaurant' };
  const r = await call({ philName: 'Enki', exchanges: TALK, goals: [{ id: 'g1', title: 'Open my own restaurant' }], openMoves: [] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { move: 'Call the landlord about the lease this week', goalId: 'g1', suggestedGoal: null });
  assert.equal(lastBody.model, 'gpt-4o-mini');
  assert.match(lastBody.messages[0].content, /Open my own restaurant/);
  assert.match(lastBody.messages[1].content, /^Enki: What weighs on you\?\nPerson: The landlord/);
});

test('a goal id the client never sent is dropped, and a new goal may be suggested', async () => {
  modelReply = { move: 'Run three times this week', goalId: 'made-up', suggestedGoal: 'Run a marathon next spring' };
  const r = await call({ philName: 'Seneca', exchanges: TALK, goals: [] });
  assert.deepEqual(r.body, { move: 'Run three times this week', goalId: null, suggestedGoal: 'Run a marathon next spring' });
});

test('no goal is suggested once three are active, or when it repeats one', async () => {
  const goals = [{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }, { id: 'c', title: 'Three' }];
  modelReply = { move: 'Do the thing', goalId: null, suggestedGoal: 'Four' };
  assert.equal((await call({ philName: 'Enki', exchanges: TALK, goals })).body.suggestedGoal, null);
  modelReply = { move: 'Do the thing', goalId: null, suggestedGoal: 'one' };
  assert.equal((await call({ philName: 'Enki', exchanges: TALK, goals: [goals[0]] })).body.suggestedGoal, null);
});

test('small talk: the model says null, the client gets null', async () => {
  modelReply = { move: null, goalId: null, suggestedGoal: 'Ignored' };
  const r = await call({ philName: 'Enki', exchanges: TALK });
  assert.deepEqual(r.body, { move: null, goalId: null, suggestedGoal: null });
});

test('anonymous callers get two a day', async () => {
  modelReply = { move: 'Call the landlord' };
  assert.equal((await call({ philName: 'Enki', exchanges: TALK })).status, 200);
  assert.equal((await call({ philName: 'Enki', exchanges: TALK })).status, 200);
  const third = await call({ philName: 'Enki', exchanges: TALK });
  assert.equal(third.status, 429); assert.equal(providerCalls, 2);
});
