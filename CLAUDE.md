# soPHICON / enkiSPEAKS — Design System Rules

Rules for integrating Figma designs into this codebase via the Figma MCP (and for keeping
Figma marketing/product files consistent with shipped UI). Read this before translating any
Figma node into markup or styling.

## What this repo actually is

A **deployable static site** — the *built* Vite output is committed directly:

```
index.html                  ← all markup (single page, 7 tab panels)
assets/index-D4xOt8rL.css   ← the entire stylesheet (tokens + components), Vite-hashed
assets/index-DpZ17GBs.js    ← bundled vanilla-JS app (~900 KB, ES module)
assets/*.png                ← logos (soPHICON top/bottom 200×100, enkiSPEAKS logo)
sprites/<philosopher>/      ← 18 philosopher sprite sets
personas.json               ← philosopher persona definitions (name, tradition, persona text)
```

`.gitignore` excludes `node_modules/` and `dist/` — the authoring source (un-minified JS,
un-hashed CSS) is **not in this repo**. Practical consequence: UI changes made here are edits
to built artifacts; when the bundle is regenerated, asset hashes in filenames change and
`index.html`'s `<script>`/`<link>` references must move with them.

The app is the **companion app for Even Realities G2 smart glasses** ("Philosophy / On Glass"):
tabs for Home, Picks (philosophers), Mindful, Speak, Journal, Debug, About; a BLE
status bar (connection dot + battery); the 1-3-5 daily checklist; weekly action plan; journal.

---

## 1. Token definitions

All design tokens are **CSS custom properties on `:root`**, hand-authored (no Style
Dictionary / token pipeline), defined at the top of `assets/index-D4xOt8rL.css`:

```css
:root{
  --bg: #0a0a0c;         /* page background */
  --surface: #111115;    /* card background */
  --surface-2: #16161c;  /* buttons, nested surfaces */
  --surface-3: #1c1c24;  /* highest elevation */
  --border: #26262f;     /* default hairline */
  --border-hi: #3a3a48;  /* hover/active hairline */
  --ink: #e9e9ef;        /* primary text */
  --dim: #8a8a99;        /* secondary text (.muted) */
  --dimmer: #565664;     /* tertiary/disabled text */
  --gold: #d4af37;       /* THE brand accent — headers, primary CTAs, active states */
  --gold-dim: rgba(212,175,55,.14);  /* gold tint fills */
  --ok: #4ade80;  --warn: #facc15;  --err: #f87171;   /* status */
  --accent-b: #60a5fa;  --accent-p: #a78bfa;          /* blue/purple accents */
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
```

**Rules**
- Never hard-code a color that has a token. Map Figma fills to the nearest `var(--…)`.
- **Canonical gold is `#d4af37`** — the app UI, the ad creatives, and the enkiRIDION brand all
  use it. (One historical Figma schema board used `#D4A94A`; treat that as drift, not truth.)
- There is exactly one theme: **dark**. No light-mode variables exist; don't invent them.

### Figma ↔ code color map

| Figma intent (marketing files) | Code token |
|---|---|
| bg `#050507` / `#0A0A0F` | `--bg` (#0a0a0c) |
| panel `#14141B` | `--surface` |
| card `#16161F` | `--surface-2` |
| border `#29293A` | `--border` |
| gold/amber accent | `--gold` (#d4af37) |
| text `#F5F5F0` / `#edebe5` | `--ink` |
| sub `#A0A0AF` | `--dim` |
| muted `#73737F` | `--dimmer` |
| green `#4ADE80` | `--ok` |

## 2. Component library

No framework and no component files — components are **semantic CSS class patterns** in the
single stylesheet, instantiated as plain HTML in `index.html`, wired by vanilla JS using
element `id`s and `data-*` attributes. There is no Storybook; `index.html` itself is the
component catalog.

**Card** — the universal container:

```html
<div class="card">
  <div class="card-header">
    <span class="today-dot"></span>
    Section Title
    <span class="badge muted">meta</span>   <!-- badge floats right via margin-left:auto -->
  </div>
  <div class="card-body">…</div>
</div>
```

```css
.card       { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:14px 16px; margin-bottom:12px }
.card-header{ display:flex; align-items:center; gap:8px; font-size:11px; font-weight:600;
              color:var(--gold); text-transform:uppercase; letter-spacing:.08em; margin-bottom:10px }
.card-body  { color:var(--ink); font-size:13.5px; line-height:1.5 }
```

**Buttons**: `.btn` (surface-2 + border), `.btn-primary` (gold fill, dark text `#1a1a1f`,
weight 700), `.btn-ghost` (transparent), grouped in `.btn-row` (flex, gap 8, wrap).

**Tabs**: `.tab-bar[role=tablist]` > `.tab-btn[data-tab=…]` (10.5px, 500) paired with
`.tab-panel[data-panel=…]`; `.active` class toggles both.

**Status**: `.dot` 8px circle (`.disconnected` etc.), `.badge` (mono font, 11px, auto-right),
`.muted` (`--dim`).

Feature components follow prefix conventions: `checklist-*`, `weekly-*`, `phil-mirror-*`,
`today-*`, `header-*`.

**Rule:** a new Figma section becomes a new `.card` with this exact anatomy — uppercase gold
11px header row (optional dot, optional right-aligned badge) + 13.5px body. Do not introduce
new container patterns.

## 3. Frameworks & libraries

- **Runtime:** vanilla JavaScript, ES modules. No React/Vue/etc.
- **Build:** Vite (evidence: hashed `index-*.{js,css}` names, `modulepreload` polyfill preamble).
- **Styling:** one hand-rolled global stylesheet. No Tailwind, no CSS-in-JS, no CSS Modules.
- **Figma MCP consequence:** reference code returned by `get_design_context` is React+Tailwind —
  it MUST be translated to plain HTML + classes from this stylesheet, using tokens above.

## 4. Asset management

- Static files, relative paths, no CDN and no optimization pipeline.
- Logos in `assets/` (`soPHICON-Top-Logo-200x100.png`, `soPHICON-Bottom-Logo-200x100.png`,
  `enkiSPEAKS Logo.png`).
- **Philosopher sprites**: `sprites/<philosopher_snake_case>/<philosopher>-<emotion>.png` —
  18 philosophers (adi_shankaracharya, al_farabi, aristotle, averroes, avicenna, confucius,
  enki, epictetus, epicurus, gautama_buddha, laozi, marcus_aurelius, nagarjuna, plato, seneca,
  socrates, zeno_of_citium, zhuangzi) × **23 emotions each**:
  `acceptance authority awe compassion contemplation conviction defiance devotion doubt grief
  honor joy liberation neutral peace rage resolve serenity sorrow teaching transcendence
  urgency wonder`.
- `personas.json` keys use the same snake_case ids: `{ name, tradition, persona }`.
- **Rule:** new philosopher or emotion assets must follow this exact naming; `neutral` is the
  required default sprite. When a Figma design shows a philosopher portrait, it maps to a
  sprite, not a new illustration.

## 5. Icon system

- **Inline SVG only**, embedded directly in markup: `viewBox="0 0 24 24"`, `fill="none"`,
  `stroke="currentColor"`, `stroke-width="2"`, round caps/joins (Feather-style).
- Icons inherit color from the parent (`currentColor`) — tint via the text color token.
- No icon font, no sprite sheet, no icon directory. Decorative glyphs are sometimes plain
  unicode (e.g. `⊙` checklist mark, `‹ ›` nav chevrons).
- **Rule:** export Figma icons as 24×24 stroke SVGs and inline them; strip fixed colors.

## 6. Styling approach

- **Methodology:** single global stylesheet; flat, semantic class names (no BEM, no utilities);
  feature prefixes for scoping.
- **Typography:** system stack
  `-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif`; `var(--mono)` for data
  (badges, week keys, numbers). Scale is small and dense: h1 22/700, card header 11/600
  uppercase (ls .08em), body 13.5/1.5, tabs 10.5, badges/tagline 11.
- **Radii:** 6 (tabs) / 8 (buttons) / 10 (cards). **Spacing:** 8/10/12/14/16 px rhythm.
- **Motion:** `transition: all .15s` on interactive elements.
- **Responsive:** desktop-default with `@media (max-width: 560px)` and `(max-width: 520px)`
  tighten-ups; viewport is locked (`user-scalable=no`) — this is app-like UI, not a marketing page.
- **Rule:** when a Figma frame is wider than ~560px, provide the narrow variant behavior at
  those two breakpoints.

## 7. Project structure

Flat, single-page: all markup in `index.html` as sibling `.tab-panel` sections; behavior in the
single JS bundle; styles in the single CSS file. Features are organized by **tab**, and within
a tab by **card**. There is no router — tabs are DOM toggles.

---

## Marketing ↔ product split (important for Figma work)

Two visual systems share one brand:

| | Product UI (this repo) | Marketing/ads (Figma files) |
|---|---|---|
| Background | `#0a0a0c` | `#050507` |
| Headline font | system stack, 22px | **Playfair Display Bold**, 108px, gold keyword |
| Mono accents | `var(--mono)` | **JetBrains Mono Medium**, letter-spaced caps |
| CTA | `.btn-primary` gold, radius 8 | gold pill, radius 62 |
| Shared | gold `#d4af37`, dark-cinematic mood, philosopher subject matter | same |

Playfair Display and JetBrains Mono are **ad-creative fonts only** — never import them into
the app UI. Conversely, app tokens (`--surface`, `--border`, …) are the source of truth when a
Figma product mock disagrees with shipped UI.
