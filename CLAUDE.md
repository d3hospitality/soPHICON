# soΦcon — Philosophy on Glass

Static web app (**enkiSPEAKS**) for Even Realities G2 glasses. This branch
(`gh-pages`) holds **built output** — `index.html` plus compiled `assets/`.
There is no `package.json` here; the Vite source builds elsewhere and its
output is published to this branch.

## Deploy goal — publish to enkiridion.com

The live site is served from **Vercel**, not raw GitHub Pages.

- **Vercel team:** `ops-7287s-projects` (`team_N8PS9mQY2bc9e6Eqa90a7Mm2`)
- **Vercel project:** `sophicon-app` (`prj_AlPmtHXJCXZawEyatCHqnJoNhve4`), framework Vite
- **Production domain goal:** `enkiridion.com`

### To deploy

1. Land the change on `gh-pages` (this is the published/output branch).
2. Trigger a Vercel production deploy of the `sophicon-app` project.
3. Confirm the deployment `readyState` is `READY` and `target` is `production`.
4. Verify the change is live (e.g. favicon: fetch `/assets/favicon.svg`).

### Domain wiring (one-time, not yet done)

`enkiridion.com` is **not yet attached** to the `sophicon-app` project — the
project currently answers only on its `*.vercel.app` domains. To finish:

1. Add `enkiridion.com` (and `www.`) as a domain on the `sophicon-app` project.
2. Point the domain's DNS at Vercel (A/CNAME or nameservers) and let it verify.

Until that is done, "push to enkiridion.com" means "deploy `sophicon-app`"; the
custom domain will only resolve once the DNS step above is complete.

## Favicon

`assets/favicon.svg` — the enkiSPEAKS pixel-glyph, rendered as a stark
**white (`#e9e9ef`) mark on a black (`#0a0a0c`) square**. Flat, monochrome,
no gradients, `shape-rendering="crispEdges"`. Wired via `<link rel="icon">`
in `index.html`. Keep it simple and ink-on-slate — no gradients.
