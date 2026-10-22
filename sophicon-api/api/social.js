import { createClient } from "@supabase/supabase-js";
import { identify } from "./_auth.js";
import { kv } from "./_store.js";
import {
  validatePost,
  cleanText,
  countText,
  REGIONS,
  publicPost,
} from "../lib/aphorica-contract.mjs";
import { oratorPrompt } from "../prompts/aphorica.mjs";
import { WONDER_MOMENTS } from "../lib/wonder.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let db;
const admin = () =>
  db ||
  (db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  ));
const checked = async (q) => {
  const { data, error } = await q;
  if (error) throw Error(error.message);
  return data;
};
async function moderate(text) {
  if (!process.env.OPENAI_API_KEY)
    throw Error("Publishing is temporarily unavailable. Your draft is safe.");
  const r = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    throw Error("Content check unavailable. Your draft is safe; try again.");
  const d = await r.json();
  if (!d.results?.length) throw Error("Content check unavailable.");
  if (d.results[0].flagged)
    throw Error(
      "This post needs revision before publication. Review the community rules and try again.",
    );
}
async function names(ids) {
  if (!ids.length) return {};
  const rows = await checked(
    admin()
      .from("public_profiles")
      .select("id,handle")
      .in("id", [...new Set(ids)]),
  );
  return Object.fromEntries(rows.map((p) => [p.id, p.handle]));
}
async function blocked(actor) {
  if (!actor) return [];
  const rows = await checked(
    admin().from("aph_blocks").select("blocked_id").eq("user_id", actor),
  );
  return rows.map((p) => p.blocked_id);
}
async function read(req, actor) {
  const q = req.query || {},
    view = q.view || "feed";
  const size = Math.max(1, Math.min(30, parseInt(q.limit, 10) || 30));
  if (view === "me") {
    if (!actor) return { user: null };
    const member = await checked(
      admin()
        .from("aph_members")
        .select("username")
        .eq("user_id", actor)
        .maybeSingle(),
    );
    return {
      user: {
        id: actor,
        username: member?.username || null,
        complete: !!member,
      },
    };
  }
  if (view === "drafts" || view === "draft") {
    if (!actor) throw Error("Sign in to open your private drafts.");
    let query = admin()
      .from("aph_drafts")
      .select("*")
      .eq("user_id", actor)
      .is("published_id", null);
    if (view === "draft")
      return { draft: await checked(query.eq("id", q.id).maybeSingle()) };
    return {
      drafts: await checked(
        query.order("updated_at", { ascending: false }).limit(30),
      ),
    };
  }
  if (view === "channels") {
    return {
      channels: await checked(admin().rpc("aph_channels_for", { actor })),
    };
  }
  if (view === "globe") return await checked(admin().rpc("aph_globe"));
  const muted = await blocked(actor);
  const fields =
    "id,user_id,title,text,channel_id,created_at,edited_at,revision,upvotes,downvotes";
  if (view === "post") {
    if (!UUID.test(q.id || "")) throw Error("Post not found.");
    const p = await checked(
      admin()
        .from("aphorisms")
        .select(fields)
        .eq("id", q.id)
        .is("deleted_at", null)
        .maybeSingle(),
    );
    if (!p || muted.includes(p.user_id)) throw Error("Post not found.");
    const comments = (
      await checked(
        admin()
          .from("aph_comments")
          .select("id,user_id,body,created_at")
          .eq("post_id", p.id)
          .is("deleted_at", null)
          .order("created_at")
          .limit(100),
      )
    ).filter((c) => !muted.includes(c.user_id));
    const handles = await names([p.user_id, ...comments.map((c) => c.user_id)]);
    const vote = actor
      ? await checked(
          admin()
            .from("aphorism_votes")
            .select("vote")
            .eq("aphorism_id", p.id)
            .eq("user_id", actor)
            .maybeSingle(),
        )
      : null;
    return {
      post: publicPost(p, handles[p.user_id], vote?.vote),
      comments: comments.map((c) => ({
        ...c,
        username: handles[c.user_id] || "member",
      })),
    };
  }
  let query = admin()
    .from("aphorisms")
    .select(fields)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(size + 1);
  if (q.region && REGIONS.includes(q.region)) {
    const globe = await checked(admin().rpc("aph_globe"));
    if (!globe.regions.some((r) => r.region === q.region))
      return { posts: [], next: null };
    query = query.eq("region", q.region);
  }
  if (q.channel && UUID.test(q.channel))
    query = query.eq("channel_id", q.channel);
  if (muted.length) query = query.not("user_id", "in", `(${muted.join(",")})`);
  if (q.following === "1") {
    if (!actor) return { posts: [], next: null };
    const fs = await checked(
      admin()
        .from("aph_channel_follows")
        .select("channel_id")
        .eq("user_id", actor),
    );
    if (!fs.length) return { posts: [], next: null };
    query = query.in(
      "channel_id",
      fs.map((f) => f.channel_id),
    );
  }
  if (q.before) {
    const [date, id] = String(q.before).split("|");
    if (!UUID.test(id) || !Number.isFinite(Date.parse(date)))
      throw Error("Invalid page cursor");
    query = query.or(
      `created_at.lt.${new Date(date).toISOString()},and(created_at.eq.${new Date(date).toISOString()},id.lt.${id})`,
    );
  }
  let rows = await checked(query);
  const more = rows.length > size;
  rows = rows.slice(0, size);
  const handles = await names(rows.map((p) => p.user_id));
  const votes =
    actor && rows.length
      ? await checked(
          admin()
            .from("aphorism_votes")
            .select("aphorism_id,vote")
            .eq("user_id", actor)
            .in(
              "aphorism_id",
              rows.map((p) => p.id),
            ),
        )
      : [];
  const posts = rows.map((p) =>
    publicPost(
      p,
      handles[p.user_id],
      votes.find((v) => v.aphorism_id === p.id)?.vote,
    ),
  );
  // Ranking only within the explicit recent page; never silently change cursor order.
  if (q.sort === "top")
    posts.sort((a, b) => b.upvotes - b.downvotes - (a.upvotes - a.downvotes));
  return {
    posts,
    next: more ? `${rows.at(-1).created_at}|${rows.at(-1).id}` : null,
  };
}
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!["GET", "POST"].includes(req.method))
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const identity = await identify(req);
    const actor = identity?.userId || null;
    if (req.method === "GET")
      return res.status(200).json(await read(req, actor));
    if (!actor)
      return res
        .status(401)
        .json({ error: "Sign in or link your free account first." });
    const key = `aph:burst:${actor}:${Math.floor(Date.now() / 60000)}`;
    const uses = await kv.incr(key);
    if (uses === 1) await kv.expire(key, 120);
    if (uses > 30)
      return res
        .status(429)
        .json({ error: "Please wait a minute before trying again." });
    const { data: account, error: accountError } =
      await admin().auth.admin.getUserById(actor);
    if (
      accountError ||
      !(account.user?.email_confirmed_at || account.user?.phone_confirmed_at)
    )
      return res
        .status(403)
        .json({ error: "Verify your account before participating." });
    const { action, ...payload } = req.body || {};
    if (action === "publish") {
      if (!UUID.test(payload.id || "") || !Number.isInteger(payload.revision))
        throw Error("Reload and review your draft.");
      const draft = await checked(
        admin()
          .from("aph_drafts")
          .select("*")
          .eq("id", payload.id)
          .eq("user_id", actor)
          .single(),
      );
      if (draft.published_id)
        return res.status(200).json({ id: draft.published_id });
      if (draft.revision !== payload.revision)
        throw Error("Draft changed. Review the latest version.");
      validatePost(draft.title, draft.body);
      await moderate(`${draft.title}\n${draft.body}`);
    }
    if (action === "edit") {
      validatePost(payload.title, payload.body);
      if (!Number.isInteger(payload.revision)) throw Error("Reload this post.");
      await moderate(`${payload.title}\n${payload.body}`);
    }
    if (action === "comment") {
      payload.body = cleanText(payload.body);
      if (countText(payload.body) < 1 || countText(payload.body) > 800)
        throw Error("Replies must be 1–800 characters.");
      if (!UUID.test(payload.request_id || ""))
        throw Error("A retry ID is required.");
      await moderate(payload.body);
    }
    if (action === "suggest_channel")
      await moderate(`${payload.name}\n${payload.description || ""}`);
    if (action === "draft") {
      if (!UUID.test(payload.id || "")) throw Error("Invalid draft ID.");
      if (payload.region && !REGIONS.includes(payload.region))
        throw Error("Choose a broad region or no location.");
    }
    if (action === "enki") {
      const { post } = await read(
        { query: { view: "post", id: payload.post_id } },
        actor,
      );
      const question = cleanText(
        payload.question ||
          "What can philosophy help us notice about this thought?",
      );
      if (countText(question) > 800)
        throw Error("Keep your question under 800 characters.");
      const unique = [
        ...new Map(WONDER_MOMENTS.map((m) => [m.quote.text, m.quote])).values(),
      ];
      const terms = new Set(
        `${question} ${post.title} ${post.body}`
          .toLowerCase()
          .match(/[a-z]{4,}/g) || [],
      );
      const sources = unique
        .map((q) => ({
          ...q,
          rank: [...terms].filter((w) =>
            `${q.text} ${q.philName} ${q.source}`.toLowerCase().includes(w),
          ).length,
        }))
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 4)
        .map((s, i) => ({
          id: i + 1,
          text: s.text,
          author: s.philName,
          source: s.source,
        }));
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 350,
            messages: [
              { role: "system", content: oratorPrompt() },
              {
                role: "user",
                content: JSON.stringify({
                  post: {
                    title: post.title,
                    body: post.body,
                    author: post.username,
                  },
                  question,
                  sources,
                }),
              },
            ],
          }),
          signal: AbortSignal.timeout(25000),
        },
      );
      if (!response.ok) throw Error("Enki is unavailable. Please try again.");
      const d = await response.json();
      return res
        .status(200)
        .json({
          text: d.choices?.[0]?.message?.content || "",
          sources,
          ai: true,
          revision: post.revision,
        });
    }
    const allowed = [
      "profile",
      "draft",
      "publish",
      "follow",
      "channel_vote",
      "suggest_channel",
      "vote",
      "comment",
      "edit",
      "delete",
      "delete_draft",
      "report",
      "block",
      "unblock",
    ];
    if (!allowed.includes(action)) throw Error("Unknown action.");
    const data = await checked(
      admin().rpc("aph_mutate", { actor, action, payload }),
    );
    return res.status(200).json(data);
  } catch (e) {
    const message = e?.message || "Please try again.";
    const safe = /duplicate key/i.test(message)
      ? "That name is already in use."
      : message;
    return res.status(400).json({ error: safe });
  }
}
