// Explicit opt-in integration test: disposable auth users and posts are removed in finally.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import {
  validatePost,
  countText,
  pairCode,
} from "../lib/aphorica-contract.mjs";
process.env.GLASSES_TOKEN_SECRET ||=
  "local-social-integration-key-never-deployed";
const realFetch = globalThis.fetch;
// Only model IO is stubbed; identity, RLS, SQL transactions and pairing hit the real DB.
globalThis.fetch = async (url, options) =>
  String(url).startsWith("https://api.openai.com/")
    ? new Response(
        JSON.stringify({
          results: [{ flagged: false }],
          choices: [{ message: { content: "A test reflection [1]." } }],
        }),
        { status: 200 },
      )
    : realFetch(url, options);
process.env.OPENAI_API_KEY ||= "integration-stub";
const { default: handler } = await import("../api/social.js");
const { default: pair } = await import("../api/social-pair.js");
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const users = [];
const tag = randomUUID().slice(0, 8);
const posts = [];
let pairCodeCreated;
async function invoke(fn, body, token, query = {}) {
  let status = 200;
  let data;
  await fn(
    {
      method: body ? "POST" : "GET",
      body,
      query,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "x-forwarded-for": "192.0.2.244",
      },
    },
    {
      setHeader() {},
      status(n) {
        status = n;
        return this;
      },
      json(d) {
        data = d;
        return this;
      },
      end() {
        return this;
      },
    },
  );
  return { status, data };
}
async function call(body, token, query = {}) {
  return invoke(handler, body, token, query);
}
async function ok(body, token, query) {
  const r = await call(body, token, query);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
try {
  assert.equal(countText("e\u0301"), 1);
  assert.equal(countText("😀"), 1);
  validatePost("Title", "😀".repeat(800));
  assert.throws(() => validatePost("Title", "😀".repeat(801)));
  assert.equal(
    pairCode("https://enkiridion.com/link?pair=abcd-2345"),
    "ABCD2345",
  );
  for (let i = 0; i < 3; i++) {
    const { data, error } = await db.auth.admin.createUser({
      email: `aph-test-${tag}-${i}@example.com`,
      password: randomUUID() + "Aa!",
      email_confirm: true,
    });
    assert.ifError(error);
    users.push(data.user.id);
  }
  const tokens = await Promise.all(
    users.map((id) =>
      new SignJWT({ scope: "glasses" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(id)
        .setAudience("enki-glasses")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(new TextEncoder().encode(process.env.GLASSES_TOKEN_SECRET)),
    ),
  );
  const channels = (await ok(null, null, { view: "channels" })).channels;
  assert.ok(channels.length >= 9);
  const channel = channels.find((c) => c.slug === "questions").id;
  for (let i = 0; i < users.length; i++)
    await ok(
      {
        action: "profile",
        username: `aph_test_${tag}_${i}`,
        birthday: "1990-01-01",
      },
      tokens[i],
    );
  const d = await ok(
    {
      action: "draft",
      id: randomUUID(),
      revision: 0,
      title: "Integration test: a private thought",
      body: "😀".repeat(800),
      channel_id: channel,
      region: null,
    },
    tokens[0],
  );
  assert.equal(
    (await call(null, tokens[1], { view: "draft", id: d.id })).data.draft,
    null,
  );
  assert.equal(
    (await call({ action: "draft", ...d, revision: 0 }, tokens[0])).status,
    400,
  );
  const publication = await ok(
    { action: "publish", id: d.id, revision: d.revision },
    tokens[0],
  );
  posts.push(publication.id);
  assert.equal(
    (await ok({ action: "publish", id: d.id, revision: d.revision }, tokens[0]))
      .id,
    publication.id,
  );
  const votes = await Promise.all([
    ok({ action: "vote", post_id: publication.id, vote: 1 }, tokens[1]),
    ok({ action: "vote", post_id: publication.id, vote: -1 }, tokens[2]),
  ]);
  let detail = await ok(null, tokens[1], { view: "post", id: publication.id });
  assert.equal(detail.post.upvotes, 1);
  assert.equal(detail.post.downvotes, 1);
  assert.equal(detail.post.vote, 1);
  assert.equal(countText(detail.post.body), 800);
  await ok({ action: "vote", post_id: publication.id, vote: -1 }, tokens[1]);
  detail = await ok(null, tokens[1], { view: "post", id: publication.id });
  assert.equal(detail.post.upvotes, 0);
  assert.equal(detail.post.downvotes, 2);
  assert.equal(
    (
      await call(
        { action: "vote", post_id: publication.id, vote: 1 },
        tokens[0],
      )
    ).status,
    400,
  );
  const reply = {
    action: "comment",
    post_id: publication.id,
    body: "A useful discussion.",
    request_id: randomUUID(),
  };
  await ok(reply, tokens[1]);
  await ok(reply, tokens[1]);
  detail = await ok(null, null, { view: "post", id: publication.id });
  assert.equal(detail.comments.length, 1);
  assert.ok(!("birthday" in detail.post));
  assert.ok(!("email" in detail.post));
  await ok(
    { action: "follow", channel_id: channel, following: true },
    tokens[1],
  );
  assert.equal(
    (await ok(null, tokens[1], { view: "channels" })).channels.find(
      (c) => c.id === channel,
    ).following,
    true,
  );
  const invalid = await ok(
    {
      action: "draft",
      id: randomUUID(),
      revision: 0,
      title: "Too long",
      body: "x".repeat(801),
      channel_id: channel,
    },
    tokens[0],
  );
  assert.equal(
    (
      await call(
        { action: "publish", id: invalid.id, revision: invalid.revision },
        tokens[0],
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        {
          action: "edit",
          post_id: publication.id,
          revision: 1,
          title: "Hijack",
          body: "No",
        },
        tokens[1],
      )
    ).status,
    400,
  );
  await ok({ action: "block", user_id: users[0] }, tokens[2]);
  assert.equal(
    (await call(null, tokens[2], { view: "post", id: publication.id })).status,
    400,
  );
  const pr = await invoke(pair, { action: "start" });
  assert.equal(pr.status, 200);
  pairCodeCreated = pr.data.code;
  // A scoped glasses token must not claim a browser account pairing.
  assert.equal(
    (await invoke(pair, { action: "claim", code: pairCodeCreated }, tokens[0]))
      .status,
    401,
  );
  const claim = await db
    .from("aph_pair_requests")
    .update({ user_id: users[0], claimed_at: new Date().toISOString() })
    .eq("code", pairCodeCreated)
    .is("user_id", null);
  assert.ifError(claim.error);
  const status = await invoke(pair, {
    action: "status",
    code: pairCodeCreated,
    poll: pr.data.poll,
  });
  assert.equal(status.data.state, "linked");
  assert.ok(status.data.token);
  const badPoll = await invoke(pair, {
    action: "status",
    code: pairCodeCreated,
    poll: "x".repeat(43),
  });
  assert.equal(badPoll.data.state, "expired");
  const {
    data: { user: authUser },
  } = await db.auth.admin.getUserById(users[0]);
  assert.ok(authUser);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey) {
    const anonymous = createClient(process.env.SUPABASE_URL, anonKey, {
      auth: { persistSession: false },
    });
    const denied = await anonymous.from("aph_members").select("*");
    assert.ok(denied.error || !denied.data?.length);
    const rpc = await anonymous.rpc("aph_mutate", {
      actor: users[0],
      action: "delete",
      payload: { post_id: publication.id },
    });
    assert.ok(rpc.error);
  }
  console.log(
    "PASS: Unicode 800/801; verified profiles; private drafts; stale revisions; idempotent publish/replies; concurrent vote counts; switch/self-vote; follow; ownership; block; private identity projection; pairing credential and scope; anonymous RLS. Model calls stubbed.",
  );
} finally {
  if (pairCodeCreated)
    await db.from("aph_pair_requests").delete().eq("code", pairCodeCreated);
  if (posts.length) await db.from("aphorisms").delete().in("id", posts);
  for (const id of users) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) console.error("Cleanup failed:", error.message);
  }
  globalThis.fetch = realFetch;
}
