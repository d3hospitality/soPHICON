# Community Hub endpoints (v0, in-memory)

Five Vercel serverless functions that implement the Community Hub
wire format (see `soPHICON-Community-Hub-SDK.md` §4). All routes live
under `/api/community/*` on the existing `sophicon-api` deployment.

| Route                                     | Method | Purpose                                            |
|-------------------------------------------|--------|----------------------------------------------------|
| `/api/community/become-philosopher`       | POST   | Claim a handle; returns `philId` + sprite status  |
| `/api/community/submit-quote`             | POST   | Submit a quote for rating + publish               |
| `/api/community/feed?sort=...&...`        | GET    | Paged feed read (WEEKLY_TOP / ALL_TIME / RISING / FRESH) |
| `/api/community/toggle-like`              | POST   | Like / unlike a quote                              |
| `/api/community/get-quote?quoteId=...`    | GET    | Single-quote poll for status changes              |

## Storage

`_store.js` is an **in-memory `Map`** — data resets on every cold start
and isn't shared across Vercel function instances. Good for click-around
demos; bad for users. Before going live, swap `_store.js` to one of:

- **Vercel KV** (`@vercel/kv`) — Redis-compatible, namespaced keys, free
  on hobby tier. Fastest path to durable persistence; ~10 LOC swap.
- **Vercel Postgres** (`@vercel/postgres`) — relational tables, supports
  JOINs (e.g. "all quotes by philosopher X with their like counts").
- **Supabase / Neon / PlanetScale** — equivalent options if you want a
  managed Postgres outside Vercel.

Every endpoint reads/writes through the exports in `_store.js` only,
so the wire shape stays identical after the swap.

## Deploy

From `~/Desktop/soPHICON ER-G2/sophicon-api/`:

```bash
vercel --prod
```

The new functions are auto-discovered (Vercel scans `api/**/*.js`).
No `vercel.json` edits needed.

## Local test

```bash
# Start the dev server (binds to localhost:3000)
vercel dev

# Claim a handle
curl -X POST http://localhost:3000/api/community/become-philosopher \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u_test","handle":"marcus_jr","tradition":"roman"}'

# Submit a quote (use the philId from the previous response)
curl -X POST http://localhost:3000/api/community/submit-quote \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u_test","philId":"phil_xxx","text":"The obstacle is the way."}'

# Read the feed
curl 'http://localhost:3000/api/community/feed?sort=FRESH'

# Like a quote (use the quoteId from submit-quote)
curl -X POST http://localhost:3000/api/community/toggle-like \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u_test","quoteId":"q_xxx","liked":true}'
```

## Wire it into the Android client

The Android app already has a `CommunityClient` interface with a NoOp
implementation. To swap it for real backend calls:

1. **`app/src/main/java/app/enkispeaks/net/EnkiApi.kt`** — add the five
   community methods on the existing Retrofit interface (no new base URL
   needed; reuse `BuildConfig.API_BASE_URL = "https://sophicon-api.vercel.app"`).
2. **`app/src/main/java/app/enkispeaks/net/CommunityClient.kt`** — write
   a Retrofit-backed implementation that calls the EnkiApi methods.
3. **`app/src/main/java/app/enkispeaks/di/NetworkModule.kt`** — bind the
   real implementation instead of the NoOp.
4. Flip `BuildConfig.COMMUNITY_HUB_ENABLED = true` in `app/build.gradle.kts`.

The `BecomePhilosopherResult` / `CommunityQuoteEntity` / `FeedPage` /
`LikeResult` data classes on the Android side already match the wire
shapes these endpoints return — no DTO translation needed.

## When you actually want `community.enkispeaks.app` as a separate domain

Right now everything lives under `sophicon-api.vercel.app/api/community/*`.
When you want to flip to a vanity domain:

1. In Vercel dashboard → sophicon-api project → Domains → add
   `community.enkispeaks.app`.
2. Cloudflare/your DNS: CNAME `community` → `cname.vercel-dns.com`.
3. (Optional) Update the Android Retrofit base URL to point at the new
   host instead of the shared one.

No code changes required to ship the endpoints under a different domain
— Vercel routes the same functions to both hosts automatically.
