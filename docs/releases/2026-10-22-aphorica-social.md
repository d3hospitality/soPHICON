# Aphorica social beta — October 22, 2026

Aphorica now supports public topics, followed channels, reviewed voice/text thoughts and ordinary votes. Web: https://enkiridion.com/aphorica. Even Hub confirms **1.18.0 Beta**, with the existing two-person testing group; public store build remains 1.16.0. No invitations or promotional posts were sent.

## Reference implementation and provenance

- [InCoderWeb/social-media-template](https://github.com/InCoderWeb/social-media-template/tree/2ef6a6ff335ad00973eb08182e2b83c6c0885227): sidebar/feed/discovery composition and responsive layout reference. Reimplemented in the existing Next.js stack. No third-party source, photographs or unlicensed assets copied; no license was found in the inspected repository.
- [GitHub social-media-app topic](https://github.com/topics/social-media-app): discovery reference, not a code dependency.
- PolyGot `src/pair-code.ts`, `src/device-pairing.ts`, and API device-pairing flow informed full-link parsing, unambiguous eight-character codes, persistence and polling. Enki retains its own tokens, accounts and API.
- The globe raster is reused from the local Sommni application (`sommni 2/public/assets/globe.png`). Glasses use two serialized 190×95 transfers with enki's existing image encoding. No map service or GPS permission added.

## Shipped

- All account tiers share free access; no daily conversation paywall. Short-term service pacing remains. New Stripe checkout and Stars awards return 410; sprite packs unlock without spending Stars. Portrait generation uses free account access with a two-per-minute burst brake and owned-reference URL validation. Existing billing data remains for reconciliation.
- Email/password registration, verification callback, reset password, optional Google, private profile completion with username and DOB (18+ publishing beta). **Production SMTP remains missing. Email/password login works for a verified account, but public verification/reset delivery cannot be claimed ready.** Dashboard explicitly shows built-in mail service. Do not disable verification to bypass this blocker.
- One-link account pairing, explicit browser account confirmation, eight-character fallback, 30-minute expiry, separate hashed polling credential, scoped glasses JWT, existing revoke-all handling. Legacy six-character redemption remains available.
- Nine honest starter channels, follow counts, topic recommendations and proposed topics. Human posts have title ≤80 and body ≤800 NFC-normalized Unicode code points. Existing thoughts are retained in First Thoughts.
- Browser and native glasses compose title/body, dictate, re-record, save private drafts, review and explicitly confirm publication. Draft revision checks prevent stale publication; retries do not duplicate posts. Web edits and replies share the content check. Raw dictation is not saved to application storage.
- Atomic per-member up/downvotes; no self-vote or paid ranking. Comments, author edit/delete, reports and personal blocks. New public API omits email, DOB and precise coordinates. All new social tables use RLS and service-gateway-only access, with verified actor/ownership checks.
- Private, clearly labeled Enki reflections retrieve source passages from the curated Wonder corpus and discuss a selected public post. Source links/citations and post revision accompany the response.
- Thought globe shows real 24-hour counts and opt-in broad regions, suppressed until five distinct authors contribute in a region. Web can filter eligible regions. Glasses show the raster/counts and a regional summary. This is a lightweight globe, not a fully animated geographical activity map.
- Charcoal, cream and gold responsive web layout; no default blue links. Wonder/My day preserved.

## Deployments and artifact

- Web production: `dpl_7h1uLM3FuJjCq5GAkxJ6LqgLUw69`, staged deployment `enkispeaks-dh8ihgq5n-ops-7287s-projects.vercel.app`, promoted to enkiridion.com.
- API production: `dpl_2k4PzwjPNshYbhGxNnNDDJnTAJWA`, `sophicon-79hkaqm7z-ops-7287s-projects.vercel.app`, promoted to sophicon-api.vercel.app.
- Four additive migrations applied to the existing enki Supabase project: free social foundation, legacy write retirement, free requests/pack unlocks, retirement of client Star-award/accounting RPCs. Existing user content retained.
- EHPK: `/Users/d3hospitality/Desktop/enkiRIDION-1.18.0/enkiridion.ehpk`, portal size 3.5 MB, 18 neutral portraits.
- SHA-256: `1fe1055b40659e41916733492aaf52c8ae2946e48bd72d11c6a8661d564cf7da`.
- Package source: `release/aphorica-1.18.0`, based on tested Wonder commit `6fadf9f`. Development branch `feat/aphorica-free-social` retains pre-existing unfinished quote-audio work; it is excluded from this EHPK.
- Two existing enkiRIDION Sage subscriptions (active/past_due) had `cancel_at_period_end=true` set with no proration. No refunds or invoice cancellation. Previously issued outstanding invoices are a separate reconciliation item; do not claim they were voided.

## Verification

- 58 API tests pass, including no daily chat gate, identity/pairing, pacing and free portrait generation/URL rejection.
- Live Supabase integration with disposable accounts passes 800/801 Unicode boundaries, private drafts, stale revisions, duplicate publish/reply retries, concurrent vote counts, vote switches/self-vote rejection, follows, ownership, blocking, public identity projection, pairing credential separation and anonymous RLS denial. Model calls stubbed in this suite.
- Separate hosted API check used real Supabase login, real moderation, publication and a real Enki model response. Its account and post were removed.
- Authenticated free pack unlock/retry tested against actual database; Stars balance unchanged.
- Two native glasses workflow tests pass using the real SDK validator; full 800-character/long-word pagination preserves content and publication requires final confirmation. Existing Wonder tests and all standard page validations pass.
- Web production build, entitlement/access/capability checks and nine free-request/historical billing tests pass. Pre-existing lint/image/bundle-size warnings remain.
- Browser: email/password login with a disposable verified account; profile completion; save → review → edit flow. Live public feed checked at desktop and 390×844. Production proxy returns nine channels, cross-origin writes return 403, checkout returns 410.
- No physical G2 microphone/locked-phone interruption test was performed. Simulator/SDK checks do not replace that beta check.

## Beta boundaries and next work

1. **Required for broad non-Google onboarding:** configure a production SMTP provider and verify confirmation, resend and password recovery delivery to actual non-Google mailboxes. No credentials found in project environments. Google and existing verified-account login remain available.
2. Moderation currently checks before publish and supports reports; flagged drafts remain editable. A staffed moderation dashboard, appeal/recovery queue, comment moderation tools and in-product unblock management remain follow-up work. Review reports manually through authorized operations access during the small beta.
3. Public autonomous Enki orations, full knowledge-base ingestion, event fact verification, automatic subtopic activation and calibrated trending are PRD P1, not included. No fabricated users, posts or follower counts. Enki responses are private and do not verify user claims.
4. Newest has stable pagination. “Top on this page” is explicitly local to the fetched page. Channel discovery uses follower/recommendation totals. Global ranking, nested replies and comment votes remain later work.
5. Legacy location/Star-oriented read endpoints remain for old clients; new Aphorica uses the new gateway. Legacy unreviewed publishing is retired and asks old clients to update. Older native Android write compatibility needs a dedicated follow-up.
6. Supabase advisory audit includes intentional no-policy RLS notices on service-only tables and inherited advisories (public_profiles security-definer view, older functions, leaked-password protection setting). This is not a claim that the whole legacy project has no security advisories.
7. Establish cost/error monitoring and moderation ownership before increasing enrollment. Keep the beta rollback non-destructive: revert clients or stop new writes, preserve published posts/private drafts, retain the free policy. Do not drop the new tables to roll back.

Proofs: `/Users/d3hospitality/Documents/ObsidianVaults/.codex-artifacts/aphorica-social-20261022/` (`web-live.png`, `web-mobile.png`, `beta-1180.png`).

Final production pairing check passed: browser email/password sign-in preserved the pairing destination, explicit confirmation claimed the request, and polling issued a scoped device token that read the correct completed account. Saved `pairing-live.png`. Disposable UI account, drafts, unlocks and pairing request were removed; test servers stopped.


## Follow-up: first-class app navigation — 1.18.1 Beta

Aphorica is now directly discoverable throughout the website and is a dedicated bottom tab in the Even phone companion. Even Hub confirms **1.18.1 Beta** for the existing two-person group; public remains 1.16.0. On glasses, use **Home → Aphorica**.

- Website header and mobile navigation expose Aphorica to visitors and signed-in users. Wonder, demo and My day include a direct entry card.
- Phone tab supports live topics/feed, following and recommendations, votes, replies, private shared drafts, title/body dictation, edit/review/explicit publication, reports, private Enki reflections and the real activity globe. Website retains additional management tools. All access remains free.
- Account changes discard stale private responses. Leaving the panel stops recording, including a microphone permission request resolved after navigation.
- Source: web `f93631d`; isolated release `873c274`; development synchronization `c8c81a7`. Release branch remains named `release/aphorica-1.18.0`. Unfinished quote-audio work remains excluded from the package.
- Website production: `dpl_57HJ72YBG5EvG7r3j3LKhHjaW1bg`, https://enkispeaks-n68q02hll-ops-7287s-projects.vercel.app, verified before promotion to enkiridion.com. Previous web deployment `dpl_7h1uLM3FuJjCq5GAkxJ6LqgLUw69` remains the rollback target. API/database unchanged by this follow-up.
- Package: `/Users/d3hospitality/Desktop/enkiRIDION-1.18.1/enkiridion.ehpk`; SHA-256 `9e0339ab0294c74cbdd00af4f02288d30ecb321a70fd2ccf129e93d5df58f599`; portal size 3.5 MB. Build requires the existing generated `vendor/even_hub_sdk-0.0.14/dist` (ignored, not committed).
- Verification: TypeScript, production builds, four phone workflow tests, two glasses tests and five Wonder tests pass. Website access/capability checks pass. Live public web and phone layouts inspected at 390×844. No physical G2 microphone/locked-phone test was performed. Existing bundle/lint warnings remain.
- Proofs: `companion-1181.png`, `web-nav-live.png`, `beta-1181.png` in the existing workspace proof directory.

**Mail setup left prepared at the user's request:** verified Resend domain `auth.polygot.live`; sending-only key creation and Supabase SMTP forms prepared. No new key created and no SMTP configuration saved. Public email confirmation/recovery delivery is still unverified.

Follow-up: the existing Even store listing still contains obsolete Sage trial/$20 concept copy. It was inspected but not edited or published in this beta-only follow-up. Public store build and review state were left unchanged.


## Follow-up: Sommni 3D thought globe — 1.18.2 Beta

Replaced the static Aphorica globe with the original Sommni wineLENS orthographic dot-globe implementation, adapted for Enki. Source: `/Users/d3hospitality/Documents/Codex/2026-09-29/can-you-do-a-deep-audit/work/winelens-beta-20261018/src/atlas/` (`globe-model.ts`, `dot-atlas.ts`, `renderer.ts`). Country-ID mask and Natural Earth boundaries reused from that project's public atlas. Geography credits, pinned source URLs and hashes are retained under `public/aphorica/atlas/`. Wine points, counts and coverage rules are excluded.

- Web and Even phone: automatic spin, pause, drag/tap, keyboard rotation, zoom, world reset, country/territory selection and state/province/region selection. 242 countries/territories and 4,490 administrative subdivisions. Region geometry loads by country. Offscreen/hidden globes stop animation; reduced-motion preference disables automatic spin.
- Glasses: Home → Aphorica → Thought globe. Same geometry/camera rendered into two serialized 190×95 images, with Turn globe, country and state/region menus. Deliberate turns avoid a continuous BLE image stream. No claim of smooth automatic animation on physical G2.
- Activity rings represent only real API-provided broad-region aggregates at illustrative centers. Existing five-author suppression is unchanged. Country/state selection explores geography; no new country/state post-location data, exact locations, GPS permission or fake activity introduced. API/database/auth unchanged. Mail remains prepared and unsaved per user instruction.
- Corrected the phone activity text to read the API's `thoughts` field; kept globe controls usable during feed refresh and preserved camera state through companion redraws.

Source commits: website `5a8cdc0`, isolated beta `e73b4e9`, development sync `85f47cc`. Website deployment `dpl_Dpqt2ZbSjAWjPfpSZsvgswJYBQ1X` (`https://enkispeaks-5l6lpa91s-ops-7287s-projects.vercel.app`) promoted to enkiridion.com after artifact comparison. Previous deployment `dpl_57HJ72YBG5EvG7r3j3LKhHjaW1bg` is the web rollback target.

Even Hub visibly confirms **1.18.2 Beta** for the existing two-person group; public remains 1.16.0. Artifact `/Users/d3hospitality/Desktop/enkiRIDION-1.18.2/enkiridion.ehpk` (5.4 MB portal / 5.2 MiB disk); SHA-256 `7e8738d6c76a46d8c824a7fa07ec78e930438d09d65216f60b0f6f672b98f9ec`. Unfinished quote-audio work remains excluded.

Validation: web production build, capability/access checks, TypeScript, four phone workflow tests, two glasses tests (now including turn → country → state → world), five Wonder tests, and two geometry/data tests pass. Projection tests cover the dateline/inverse mapping, real New York hit testing, California framing and all country data files. Browser verified live website and phone country/state selection, mobile 390×844 layout and advancing rotation. No physical G2 hardware test performed. Existing bundle/lint warnings remain; the public stylesheet is copied into the package and resolves at runtime.

Proofs in the existing workspace artifact directory: `globe-web-live-1182.png`, `globe-phone-1182.png`, `globe-phone-state-1182.png`, `globe-beta-1182.png`.
