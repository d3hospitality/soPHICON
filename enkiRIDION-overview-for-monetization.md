# enkiRIDION — App Overview for Monetization Analysis

## What it is, in one paragraph

**enkiRIDION** is a philosophy companion app for Android. The product treats philosophy as a daily practice rather than a reading subject: the user holds voice and text conversations with historical philosophers (Marcus Aurelius, Lao Tzu, Krishnamurti, Nietzsche, etc.), reflects through structured journaling rituals, and over time builds a personal "philosopher profile" that defines their own register. The unique mechanic is a **stylized RPG-portrait sprite system**: every bundled philosopher has ~23 hand-painted emotion sprites, and the user themselves gets a painted "neutral" sprite generated from 4 selfies through OpenAI gpt-image-1 anchored to a master template. The user's sprite becomes their identity across the app — replacing the generic avatar in conversations, posts, comments, and a public quote-feed called **Aphorica**.

## Core architecture

Native Android, Kotlin + Jetpack Compose, Hilt DI, Room (SQLite), Retrofit. Backend is a Node.js Vercel project (`sophicon-api`) that wraps OpenAI (Whisper for transcription, GPT-4o for chat + classification, gpt-image-1 for sprite generation) and uses Upstash Redis (sold as Vercel KV) for community data. SSE streaming for live philosopher replies. All on-device data is also tracked for sync via tombstone soft-delete + dirty-flag + last-write-wins, ready for a future multi-device sync engine.

## Major surfaces

### Today (Cockpit)
A 1-3-5 daily checklist (1 main task, 3 secondary, 5 minor) with **rollover** — uncompleted items carry forward, anchored by their original `firstSeenDate` so the UI can show "Day N pending" tags. A mini Eisenhower quadrant card sits next to the list, and each todo gets a contextual quote pulled from the user's chosen tradition. Mood-aware suggest card surfaces a recommended reflection on entry.

### Speak (Conversations)
Voice or text conversation with any of ~80 bundled philosophers across 12+ traditions (Stoicism, Pragmatism, Mysticism, Existentialism, Animism, Skepticism, etc.). Streams the reply token-by-token via SSE, with a typewriter reveal animation and **word-follow TTS highlighting** that paints a gold-tinted span over the spoken word in real time. User can pin a specific TTS voice from a curated picker. The user's own painted sprite renders next to their "YOU" label so conversations feel like two characters talking, not user-vs-bot. The philosopher's sprite **reactively swaps emotions** during the exchange based on classified content.

### Journal
Two views: a calendar showing every day with a session or contemplation, and a **Constellation map** where each philosopher the user has spoken with becomes a node, with edges drawn between philosophers the user moved between within a 3-day window. Tap a node to filter the calendar to that philosopher's history. Daily detail shows three bands — contemplations (quote-tethered notes), conversations (full exchange history), and action items auto-extracted from the conversations.

Soft-delete + trash bin throughout. Manual re-sync re-runs action-item extraction on demand.

### Weekly Eisenhower
2×2 Important/Urgent grid. Each quadrant holds actions and quotes. Long-press an action to **promote it to a habit** (instant streak tracking). Bubble buttons toggle on retap to un-add.

### Habits
Streak tracker with daily check-in. Habits feed back into the Today suggestion engine.

### Quotes Browser
~10,000-entry quote corpus across all traditions, browsed via an accordion sorted by tradition popularity. Per-quote viewer with painted image of speaker, meta (tradition + dates), and an inline contemplation note the user can attach.

### Daily Ritual (Morning + Evening)
Structured reflection prompts twice a day with **audio journaling** on the evening rite — Whisper transcribes voice memos, the transcript and audio path are cached so the Journal can render the words even after the file is pruned. Notifications + scheduled rituals via AlarmManager.

### Symposium
A multi-philosopher debate mode — pick two philosophers, give them a topic, watch them debate each other in a threaded session view. They reference each other's points and stay in their tradition's register.

### Photo × Philosopher
Upload a photo, get a philosopher's reflection on it (analysis through their tradition's lens). Downscales client-side before upload.

### Memory Bank (Sage tier)
Persistent memory that survives across conversations. Auto-extracts the user's recurring themes, beliefs, projects, and values from conversation history. Editable + viewable in Settings.

### Wisdom Drops
Geotagged contemplation moments — tie a thought to a place. Builds a personal map over time.

### Quote-of-the-Day Widget
Home-screen widget that surfaces a quote keyed to the user's current habits and intentions. The "keep me in check" pattern.

## The community layer: Aphorica + Community Hub

### Become a Philosopher
A 4-step onboarding wizard: pick a public handle, upload 4 reference selfies, fill out a persona block (tradition / tone / approach / speech-style / archetype), and the server paints a stylized neutral portrait of the user via OpenAI gpt-image-1 against a master template. The painted sprite becomes the user's avatar everywhere — conversations, posts, comments.

The Sprite Maker has a **recovery path** that detects orphaned painted sprites on disk (from prior installs) and lets the user reuse them, skipping the 60s OpenAI repaint.

### Philosophy Profile Editor
Edit your persona block from Settings. Includes a **copy-pastable ChatGPT prompt** that instructs ChatGPT to use prior context about the user and produce JSON with `tradition`, `tone`, `approach`, `speech_style`, `archetype` — the user pastes it back and the form auto-fills. Archetype field is a dropdown of 16 evocative roles (Clown World Pioneer, Outlaw Sage, Wandering Monk, Mythic Builder, Quiet Radical, Street Prophet, Stoic Operator, Modern Hermit, Trickster, Sacred Engineer, Romantic Skeptic, Absurd Patriot, Severe Optimist, Tender Brawler, Mystic Pragmatist, Patient Iconoclast) plus a Custom field.

### Aphorica (public quote economy)
The user composes short aphorisms (≤240 chars). The server **classifies** each one through GPT-4 — assigns it an emotion (compassion, fierce_clarity, awe, dread, etc.), an archetype, an emotion blend, and a rarity score 1-10 that maps to tiers: Common, Uncommon, Rare, Epic, Legendary. The classification happens BEFORE the user commits, so they see the rarity preview and can decide if they want this to be how they're seen this week.

Once published, the aphorism enters three public feeds: **Resonance** (score-weighted, hides Common rarity), **Followed** (reverse-chrono of philosophers you follow), and **Fresh** (last 24h, all visible posts). Each post card shows the author's painted sprite, their @handle, the aphorism in serif italic, rarity ribbon, emotion tag, vote cluster, replies count, optimistic-flip heart with a spring-bounce animation, and a follow chip (or delete chip if it's your own post). Tap into any post for a threaded reply view — replies are classified too, with up to 3 levels of nesting.

### Stars / Tokens (specced, partially built)
A planned in-app economy: users buy tokens to "Star" or pump quotes that resonate, similar to Twitter's super-likes but with a creator kickback. Tiered: **Bronze** creators (low engagement) get 5% kickback on tokens spent on their quotes, **Silver** 10%, **Gold** 15%. Bundle treatments tie tokens to sprite-bundle unlocks. Pro-tier subscribers get bonus features comparable to Twitter Premium (verified handle, larger compose, archive search).

## Tier system

Two tiers today: **Seeker** (free) and **Sage** (paid). Some features are Sage-gated (Memory Bank, advanced reminders, community publishing, audio journaling beyond a quota). The QA spec has a full Free-vs-Pro classification for every feature, designed to support upgrade prompts at the friction point.

## Tech polish + safety nets

- 12 languages: English, Spanish, French, German, Italian, Portuguese, Dutch, Japanese, Korean, Chinese, Hindi, Arabic. Locale-aware quote corpus.
- Two themes: Brutalist Press (dark editorial — Archivo Black headings, Inter body, JetBrains Mono code) and Daylight (cream/ink/gold light mode). Toggleable per user.
- Soft-delete + trash bin across every major entity (sessions, contemplations, actions, etc.) so destructive UX never deletes anything immediately.
- Multi-select photo picker for Become-a-Philosopher photo step.
- Honest error labels — every failure surfaces a real reason (timeout, OpenAI moderation flag, network, payload-too-large, etc.) rather than generic "something went wrong."
- All photo uploads downscaled to ≤1024×1024 q82 before transmission (under Vercel's 4.5 MB body cap).

## Daily journey, in one sentence

User wakes → Morning Ritual prompt → Today 1-3-5 with mood-aware quote → quick voice conversation with their current philosopher → action items auto-saved to Journal → midday quote-of-day widget glance → compose an aphorism for Aphorica that nails Rare rarity and shows up on the public feed under their painted sprite + @handle → Weekly Eisenhower review on Sunday → Evening Ritual with audio reflection → tomorrow the rolled-over todos and a fresh suggestion are waiting.

## Stage

Pre-release, dev build only. Sole developer + AI pair. Backend deployed to Vercel + Upstash. No paying users yet, no public store listing. Strong philosophical positioning ("Brutalist Press" identity, the Solo Leveling vision around painted progression of one's own character).

## What I want to know

Given everything above — what monetization models would fit best? Specifically: subscription tiers, in-app purchases (Stars/tokens), creator economy splits, a marketplace for user-published philosophers, premium personas, sprite cosmetics, or some combination. What positioning would I lean into? What pricing anchor would the audience accept? What's the riskiest assumption I should validate before launch?
