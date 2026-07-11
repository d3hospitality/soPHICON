# enkiRIDION / enkiSPEAKS — Multilingual Paid Social Cost Estimate

**Scope:** Meta (Facebook + Instagram) and TikTok, using the creative matrix in the
[enkiRIDION — TikTok Ad Creatives Figma file](https://www.figma.com/design/gxMfTzmYYgdScSF5uZlEjZ/enkiRIDION-%E2%80%94-TikTok-Ad-Creatives?node-id=0-1):
**7 language lanes × 14 creatives = 98 frames**, with copy variants for 9 locales.

| Lane | Locale(s) | Creatives |
|---|---|---|
| PT | pt-BR ("Fala, guerreiro") | 7 concept + 7 device-gated |
| ES | es-MX ("Qué onda, güey"), es-CO ("Quiubo, parcero"), es-Caribe ("Oye, tigre") | 7 + 7 |
| FR | fr ("Franchement, frérot") | 7 + 7 |
| IT | it ("Bella zio") | 7 + 7 |
| RU | ru ("Хватит ныть") | 7 + 7 |
| JA | ja ("考えすぎのあなたへ") | 7 + 7 |
| ZH | zh ("别再精神内耗了") | 7 + 7 |

Device-gated creatives per lane: **iOS · Google Play · iPad · Apple Watch · Vision Pro · Web · Even Realities G2**.

---

## 1. What the platforms actually charge

Neither Meta nor TikTok charges per creative, per language, or per ad. Uploading all
98 creatives costs **$0**. Both platforms are pure auctions — you pay for delivery
(impressions/clicks/installs). What your language × device matrix *does* drive is the
**number of ad sets / ad groups**, and each of those carries a minimum daily budget
and its own learning-phase data requirement. Structure, not creative count, sets your
cost floor.

**Platform minimums:**

| Platform | Level | Minimum daily budget |
|---|---|---|
| TikTok | Campaign | **$50/day** |
| TikTok | Ad group | **$20/day** |
| Meta | Ad set | ~$1–7/day formal floor, but ~**$10–20/day** practical minimum for app-install optimization (needs ~50 conversion events/week per ad set to exit learning) |

## 2. Two lanes you mostly can't buy

- **RU:** Meta halted all ad sales/delivery in Russia in March 2022 and TikTok
  suspended advertising there as well. The RU creatives can only be used for
  **Russian-speaking diaspora** targeting (language = Russian, geo = EU/US/Israel/
  Kazakhstan/Georgia etc.). Budget it as a small diaspora ad set, not a market.
- **ZH:** Facebook/Instagram and TikTok don't serve ads in mainland China (TikTok
  also isn't available in Hong Kong). The ZH lane realistically buys **Taiwan,
  Singapore/Malaysia, and the global Chinese-speaking diaspora**.

Neither of these kills the creative work — it just changes the geo and shrinks the
audience (and budget) for those two lanes.

## 3. Device targeting: what's real

- **Meta** targets by OS (iOS/Android), min OS version, specific device models
  (iPad — yes), and Wi-Fi/carrier. **Apple Watch, Vision Pro, and Even Realities G2
  are not targetable devices** — run those creatives inside the iOS ad set (they act
  as premium-Apple-ecosystem hooks, and Vision Pro/Watch owners are by definition
  iPhone owners). The "Web" creative maps to desktop placements / traffic campaigns.
- **TikTok** targets OS, OS version, device model, device price tier, and carrier.
  Same story: no wearables/XR targeting; iPad-model targeting is possible but the
  audience is thin.

So the buyable device matrix is effectively **iOS / Android (/ optional desktop-web)**
per language — the other device-gated creatives ride along inside the iOS placement
rather than getting their own ad sets. Note that iOS CPIs run **~2.8–3.5× Android**
on Meta at equivalent targeting.

## 4. The math

### The trap: buying the matrix as drawn

7 languages × 7 device gates = 49 ad groups. On TikTok alone that's
49 × $20/day = **$980/day ≈ $29,400/month just to satisfy minimums**, spread so thin
nothing exits the learning phase. Don't structure it this way.

### The sane structure

7 language campaigns (PT-BR, ES-LatAm, FR, IT, JA, ZH-TW/SG, RU-diaspora) × 2 OS ad
groups = **14 ad groups per platform**, with all 7 concept creatives + the relevant
device-gated creatives rotating inside each.

| Platform | Structure | Floor (minimums) | Recommended (exits learning) |
|---|---|---|---|
| TikTok | 14 ad groups × $20–35/day | ~$280/day ≈ **$8.4k/mo** | ~$420–490/day ≈ **$13–15k/mo** |
| Meta | 14 ad sets × $10–25/day | ~$150/day ≈ **$4.5k/mo** | ~$250–350/day ≈ **$8–10k/mo** |
| **Both** | 28 ad sets/groups | **~$13k/mo** | **~$21–25k/mo** |

### Benchmark rates by market (2026, app installs / lifestyle-education vertical)

| Market | Meta CPM | Blended CPI (Android / iOS) | Notes |
|---|---|---|---|
| Brazil (PT) | $1.50–4 | $0.50–1.00 / $1.50–3 | Cheapest volume; TikTok CPM $1–3 |
| Mexico, Colombia, Caribbean (ES) | $1.50–4 | $0.50–1.50 / $1.50–3.50 | Great volume play |
| France (FR) | $6–10 | $2–4 / $4–8 | Western-Europe pricing |
| Italy (IT) | $5–9 | $2–3.50 / $4–7 | Slightly cheaper than FR |
| Japan (JA) | $8–14 | $2.50–5 / $6–12 | Expensive, high-intent, near-US costs |
| Taiwan/SG + diaspora (ZH) | $4–8 | $1.50–3 / $3–6 | Smaller pool |
| RU diaspora | varies by host geo | $1.50–4 | Small audience, host-country CPMs |

### Scenario budgets (both platforms combined)

| Scenario | Structure | Monthly budget | Expected installs* |
|---|---|---|---|
| **Pilot** — PT-BR + ES-MX only, iOS+Android, Meta + TikTok | 8 ad sets/groups | **$3–5k** | ~2,500–5,000 |
| **Full rollout floor** — all 7 lanes, minimum viable | 28 | **$13k** | ~5,000–8,000 |
| **Full rollout recommended** — all lanes exit learning | 28 | **$21–25k** | ~9,000–15,000 |
| **Aggressive scale** — winners scaled, LatAm heavy | 30–40 | **$40k+** | ~25,000+ |

\* Blended across markets; LatAm dominates install volume at any budget because CPIs
are 3–8× cheaper than JA/FR/IT.

## 5. Recommendations

1. **Phase it.** Launch PT-BR and ES first (cheapest CPI, biggest lanes — ES has 3
   copy variants ready). Use 4–6 weeks of data to set CPI expectations before
   opening FR/IT/JA.
2. **Don't give wearable/XR creatives their own ad sets.** Watch/Vision Pro/G2
   frames live inside the iOS ad set as creative rotation; let the algorithm find
   the Apple-ecosystem buyers.
3. **TikTok needs motion.** The Figma frames are static; TikTok in-feed strongly
   favors video. Budget creative production for animating the 7 concepts per lane
   (or use TikTok Smart Creative), otherwise CPMs quoted above will run high.
4. **Expect iOS to cost ~3× Android** per install; judge iOS on downstream
   subscription value, not CPI.
5. **One caveat on Q4:** CPMs spike 30–60% October–December; the scenario table
   assumes non-holiday pricing.

## Sources

- [AdAmigo — Meta Ads CPM/CPC benchmarks by country, 2026](https://www.adamigo.ai/blog/meta-ads-cpm-cpc-benchmarks-by-country-2026)
- [AdAmigo — Meta Ads benchmarks 2026 (CPM, CPC, CTR, CVR, ROAS)](https://www.adamigo.ai/blog/meta-ads-benchmarks-2026-cpm-cpc-ctr-cvr-roas-by-industry-country)
- [Adligator — Meta Ads CPM by country 2026](https://adligator.com/blog/meta-ads-cpm-by-country-benchmarks)
- [Superads — Facebook cost-per-app-install benchmarks](https://www.superads.ai/facebook-ads-costs/cost-per-app-install)
- [Vmobify — Meta app install campaigns, 2026 guide](https://vmobify.com/blog/meta-app-install-campaigns)
- [TikTok Ads Manager — About budgets (official minimums)](https://ads.tiktok.com/help/article/budget)
- [Stackmatix — TikTok ads minimum daily budget 2026](https://www.stackmatix.com/blog/tiktok-ads-minimum-daily-budget-2026)
- [TikAdSuite — TikTok CPM rates 2026 by industry](https://tikadsuite.com/blog/tiktok-cpm-rates/)
- [Darkroom — TikTok advertising costs 2026](https://www.darkroomagency.com/observatory/how-much-does-tiktok-advertising-cost-in-2026)
- [Insert Affiliate — Mobile app UA cost benchmarks by category](https://insertaffiliate.com/blog/mobile-app-user-acquisition-cost-benchmarks/)
- [AppBrain — Android CPI per country](https://www.appbrain.com/stats/android-cpi-per-country)
- [Business of Apps — CPI rates research](https://www.businessofapps.com/ads/cpi/research/cost-per-install/)
