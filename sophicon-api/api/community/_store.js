// Vercel KV-backed store for the Community Hub.
//
// Persistent. Data survives cold starts, function-instance hops,
// and redeploys — the only way to lose it is to deliberately wipe
// the KV instance from the Vercel dashboard.
//
// Connection: `@vercel/kv` reads `KV_REST_API_URL` + `KV_REST_API_TOKEN`
// from environment variables — Vercel injects these automatically when
// the project is linked to a KV instance through the dashboard. No
// manual env setup needed.
//
// ┌─ KEY LAYOUT ──────────────────────────────────────────────────┐
// │                                                                │
// │  phil:<userId>           → philosopher record (JSON)          │
// │  philId:<philId>         → userId (reverse lookup)            │
// │                                                                │
// │  quote:<quoteId>         → quote record (JSON)                │
// │  quotes:by-time          → ZSET, score=createdAt, member=qid  │
// │  quotes:by-likes         → ZSET, score=likeCount, member=qid  │
// │  quotes:week:<weekKey>   → ZSET, score=likeCount, member=qid  │
// │                                                                │
// │  like:<userId>:<quoteId> → "1" if user has liked the quote    │
// │                                                                │
// │  Sorted sets (ZSETs) live next to per-record JSON so feed     │
// │  reads stay O(limit) instead of scanning every quote on every │
// │  request. The trade is one extra write per submit/like.       │
// └───────────────────────────────────────────────────────────────┘

import { kv } from '@vercel/kv';

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Philosophers ────────────────────────────────────────────────

export async function upsertPhilosopher({
  userId, handle, tradition, personaTone, personaApproach, personaSpeechStyle,
}) {
  const existing = await kv.get(`phil:${userId}`);
  if (existing) {
    const updated = {
      ...existing,
      handle: handle || existing.handle,
      tradition: tradition || existing.tradition,
      personaTone: personaTone ?? existing.personaTone,
      personaApproach: personaApproach ?? existing.personaApproach,
      personaSpeechStyle: personaSpeechStyle ?? existing.personaSpeechStyle,
      updatedAt: Date.now(),
    };
    await kv.set(`phil:${userId}`, updated);
    return updated;
  }
  const created = {
    philId: genId('phil'),
    userId,
    handle,
    tradition,
    personaTone: personaTone || '',
    personaApproach: personaApproach || '',
    personaSpeechStyle: personaSpeechStyle || '',
    spriteStatus: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Two writes: the primary record + a reverse index so we can look
  // up a philosopher by philId without scanning every key.
  await kv.set(`phil:${userId}`, created);
  await kv.set(`philId:${created.philId}`, userId);
  return created;
}

export async function getPhilosopherByUserId(userId) {
  return (await kv.get(`phil:${userId}`)) || null;
}

export async function getPhilosopherByPhilId(philId) {
  const userId = await kv.get(`philId:${philId}`);
  if (!userId) return null;
  return (await kv.get(`phil:${userId}`)) || null;
}

/** Update the sprite-generation status on a philosopher's record.
 *  Called from /api/community/sprite-init at each stage of the
 *  pipeline so a polling client can render the right loading state.
 *  No-op when the philId isn't found — the caller already returned
 *  404 to the user. */
export async function setSpriteStatus({ philId, status, error = null }) {
  const userId = await kv.get(`philId:${philId}`);
  if (!userId) return;
  const phil = await kv.get(`phil:${userId}`);
  if (!phil) return;
  phil.spriteStatus = status;
  phil.spriteError = error;
  phil.updatedAt = Date.now();
  await kv.set(`phil:${userId}`, phil);
}

// ─── Quotes ──────────────────────────────────────────────────────

export async function submitQuote({ userId, philId, text, source }) {
  const id = genId('q');
  const now = Date.now();
  const isoWeek = toIsoWeekKey(new Date(now));
  const record = {
    id,
    userId,
    philId,
    text: String(text).trim(),
    source: String(source || '').trim(),
    status: 'published',
    likeCount: 0,
    weekKey: isoWeek,
    createdAt: now,
    updatedAt: now,
    emotion: null,
    archetype: null,
    blend: null,
    ratingScore: null,
    tags: [],
  };
  // Four writes — one primary record + three sorted-set memberships
  // so the four feed sort modes can read O(limit) instead of O(N).
  await kv.set(`quote:${id}`, record);
  await kv.zadd('quotes:by-time',           { score: now, member: id });
  await kv.zadd('quotes:by-likes',          { score: 0,   member: id });
  await kv.zadd(`quotes:week:${isoWeek}`,   { score: 0,   member: id });
  return record;
}

export async function getQuoteById(quoteId) {
  return (await kv.get(`quote:${quoteId}`)) || null;
}

// ─── Feed read ───────────────────────────────────────────────────
// Cursor is base-64 of the integer offset. Production should switch
// to a stable composite (timestamp + id) so insertions don't shift
// the window mid-scroll.

export async function readFeed({
  sort = 'FRESH', weekKey = null, cursor = null, limit = 20,
}) {
  const offset = cursor
    ? (parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10) || 0)
    : 0;
  const wk = weekKey || toIsoWeekKey(new Date());

  let zsetKey;
  switch (sort) {
    case 'WEEKLY_TOP': zsetKey = `quotes:week:${wk}`;  break;
    case 'ALL_TIME':   zsetKey = 'quotes:by-likes';    break;
    case 'RISING':     zsetKey = 'quotes:by-time';     break; // TODO: real hot-score
    case 'FRESH':
    default:           zsetKey = 'quotes:by-time';     break;
  }

  // ZRANGE rev=true → highest scores first (so the latest / most-liked
  // bubble to the top of the page).
  const ids = await kv.zrange(zsetKey, offset, offset + limit - 1, { rev: true });
  const total = await kv.zcard(zsetKey);

  // KV doesn't have a multi-get in the official client, so we fan out.
  // For limit=20 this is acceptable; bigger limits would want a Lua
  // script or batched HMGET equivalent.
  const quotes = [];
  for (const id of ids) {
    const q = await kv.get(`quote:${id}`);
    if (q) quotes.push(q);
  }

  const nextOffset = offset + quotes.length;
  const nextCursor = nextOffset < total
    ? Buffer.from(String(nextOffset)).toString('base64')
    : null;

  return { quotes, nextCursor, weekKey: wk };
}

// ─── Likes ───────────────────────────────────────────────────────

export async function toggleLike({ userId, quoteId, liked }) {
  const quote = await kv.get(`quote:${quoteId}`);
  if (!quote) return null;

  const likeKey = `like:${userId}:${quoteId}`;
  const wasLiked = (await kv.get(likeKey)) === '1';

  if (liked && !wasLiked) {
    await kv.set(likeKey, '1');
    quote.likeCount += 1;
  } else if (!liked && wasLiked) {
    await kv.del(likeKey);
    quote.likeCount = Math.max(0, quote.likeCount - 1);
  }
  quote.updatedAt = Date.now();
  await kv.set(`quote:${quoteId}`, quote);
  // Re-score the sorted sets so feed orderings stay accurate.
  await kv.zadd('quotes:by-likes',                  { score: quote.likeCount, member: quoteId });
  await kv.zadd(`quotes:week:${quote.weekKey}`,     { score: quote.likeCount, member: quoteId });

  return {
    quoteId,
    likeCount: quote.likeCount,
    likedByMe: liked,
  };
}

// ─── ISO week helper ─────────────────────────────────────────────
// YYYY-WW (Monday-anchored), matches the Android client's IsoWeek.

function toIsoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(weekNum).padStart(2, '0')}`;
}
