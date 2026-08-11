// ═══════════════════════════════════════════════════════════════════
// soΦcon — Phone-side interactive dashboard (src/dashboard.ts)
//
// Vanilla TS + DOM, no framework. Inspired by Lingua Franca's
// dashboard.ts pattern: tab-driven UI, pub/sub sync with the
// on-glass state, sprite-debug surface so you can verify pushes
// from the phone without plugging into devtools on-glass.
//
// What this file owns:
//   • Tab switching (Home / Philosophers / Speak / Debug / About)
//   • Live glass-state mirror (subscribes to onGlassesStateChange)
//   • Philosopher grid (tap a card → same UX as selecting via ring)
//   • Manual sprite-push console
//   • Settings (OpenAI key, clear-conversation-history)
//
// Boot flow (see Main.ts): initDashboard(bridge, baseUrl) is called
// after waitForEvenAppBridge resolves. Dashboard never assumes the
// bridge exists before that.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import {
  PHILOSOPHERS, TRADITIONS, TOTAL_QUOTES, TOTAL_PHILOSOPHERS, TOTAL_TRADITIONS,
  Philosopher, Tradition, Quote, getPhilosophersByTradition, capitalize,
  Rarity, getRarity, getRaritySymbol,
} from './constants';
import {
  onGlassesStateChange, GlassesState,
  getPhilsForCurrentSelectPage, setHoveredPhilosopherFromDashboard,
  startMindfulness, stopMindfulness, loadMindfulConfig, getMindfulConfig,
} from './events';
import { pushSprite, getSpritePushLog, clearSpriteCache } from './image-utils';
import {
  loadJournal, JournalSession, SpeakMessage, loadActionItems,
  loadPersonas, getPersona, startConversation, sendMessage,
  emotionToSprite, normalizeEmotion, pullSpeakSessions,
} from './speak';
import {
  WeeklyOverview, WeeklyProblem, WeeklyAction, Category, Quadrant, QUADRANTS,
  isoWeekKey, weekRangeLabel, weekDisplayLabel, shiftWeek,
  loadOverview, saveOverview, generateOverview, pickRolloverCandidates,
  setActionDone, setProblemStatus,
  pickQuotesForAction, setWeeklyBridge,
} from './weekly';
import {
  Habit, HabitStatus, PendingCheckIn,
  setHabitsBridge, listHabits, favoriteAsHabit, unfavoriteHabit,
  isHabit, pendingCheckIns, recordCheckIn, streakHealth, habitSpritePath,
} from './habits';
import { authHeaders, linkedHandle, linkedTier, linkWithCode, unlink, setAccountBridge } from './enkiAccount';
import { isFavoriteText, toggleFavoriteText, onFavoritesChange } from './favorites';
import { getWisdomEntries, onWisdomLogChange, addWisdomEntry, hasWisdomEntry } from './wisdomlog';
import {
  setSyncBridge, syncNow, schedulePush, markDirty, captureChecklistDelete,
  onSyncApplied, getSyncStatus, updateGlance,
} from './enkiSync';
import {
  UserProfile, LANGUAGES, setProfileBridge, loadProfile, saveProfile,
} from './profile';
import {
  ChecklistItem, Size, Domain, Quadrant as ChecklistQuadrant, ControlAxis,
  DOMAINS, QUADRANTS as CHECKLIST_QUADRANTS, CONTROL_AXES,
  setChecklistBridge, loadToday, addItem, completeItem, uncompleteItem,
  deleteItem,
} from './checklist';
import { CATEGORY_HUE } from './weekly';
import { INTRO_COUNT, STORY_SECTIONS } from './story';
import { log } from './ui';
import {
  SUPPORT_URL, SUPPORT_LATCH_KEY, PILL_LINE_1, PILL_LINE_2,
  supportEnabled, activeCrypto,
} from './support';
import {
  t, tQuote, lang, setLang, initLang, onLangChange, applyBidiHints, LANGS, isPhoneOnly, type LangCode,
} from './i18n';

// ─── Handles we fill in initDashboard ─────────────────────────────
let bridge: EvenAppBridge | null = null;
let baseUrl = '';

// ─── Helpers ──────────────────────────────────────────────────────
function $(id: string): HTMLElement | null { return document.getElementById(id); }
function $$(sel: string): HTMLElement[] { return Array.from(document.querySelectorAll(sel)); }

function pageLabel(page: string): string {
  switch (page) {
    case 'home':                return 'Home: traditions';
    case 'philosophers':        return 'Philosophers';
    case 'mindstate':           return 'Mindstate';
    case 'quote':               return 'Quote';
    case 'speak-traditions':    return 'Speak: traditions';
    case 'speak-philosophers':  return 'Speak: philosophers';
    case 'speak-conversation':  return 'Conversation';
    case 'traditions':          return 'Philosophies';
    case 'support':             return 'Support the dev';
    default:                    return page;
  }
}

function pageSubtext(s: GlassesState): string {
  if (s.page === 'quote' && s.quoteText) {
    const n = `${(s.quoteIndex ?? 0) + 1}/${s.quoteTotal ?? 0}`;
    return `${n} · "${s.quoteText.slice(0, 40)}…"`;
  }
  if (s.page === 'speak-conversation' && s.philosopher) {
    const bits: string[] = [s.philosopher.name];
    if (s.tradition) bits.push(s.tradition);
    if (s.speakListening) bits.push('● listening');
    return bits.join(' · ');
  }
  // Mirror the live ring-scroll on philosopher-select pages:
  // "Marcus Aurelius · 5/7 in Stoicism"
  if ((s.page === 'philosophers' || s.page === 'speak-philosophers') && s.hoveredPhilosopher) {
    const h = s.hoveredPhilosopher;
    return `${h.name} · ${h.index + 1}/${h.total} in ${h.tradition}`;
  }
  if (s.philosopher) return s.philosopher.name;
  if (s.tradition) return s.tradition;
  return '';
}

// ─── TAB SWITCHING ────────────────────────────────────────────────
function initTabs(): void {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (!tab) return;
      $$('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      $$('.tab-panel').forEach(p => {
        p.classList.toggle('active', p.getAttribute('data-panel') === tab);
      });
      // Refresh debug view whenever debug tab opened
      if (tab === 'debug') { refreshPushLog(); renderSyncStatus().catch(() => {}); }
      // Speak tab → refresh the trial CTA (shown to seeker/unlinked).
      if (tab === 'speak') refreshSpeakTrialCta().catch(() => {});
      // Force-refresh the journal whenever Journal tab is opened so newly-
      // checkpointed conversations always appear without the user needing
      // to reload the dashboard. First pull any sessions saved on other
      // devices (web/Android/other glasses) so the journal is complete.
      if (tab === 'journal') {
        pullSpeakSessions().then(() => refreshJournal()).catch(() => refreshJournal().catch(() => {}));
      }
      // Aphorica → (re)load the commons feed
      if (tab === 'aphorica') refreshAphorica().catch(() => {});
      // Home tab → refresh Today card + habits card (both pull from journal),
      // and kick a background sync cycle (pull + push, no-op unlinked).
      if (tab === 'home') {
        renderTodayCard().catch(() => {});
        renderHabits().catch(() => {});
        renderChecklist().catch(() => {});
        renderAphHome().catch(() => {});
        syncNow().catch(() => {});
      }
    });
  });

  // Header settings icon → jump to About tab (which has settings)
  $('header-settings-btn')?.addEventListener('click', () => {
    const aboutBtn = document.querySelector<HTMLElement>('.tab-btn[data-tab="about"]');
    aboutBtn?.click();
  });
}

// ─── LIVE GLASS STATE MIRROR ──────────────────────────────────────
// Resolve a sprite path against Vite's configured base URL. Kept as a
// helper so every img src uses the same resolution rule and we have
// one place to tweak if the base ever changes.
function spriteUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const trimmed = path.replace(/^\/+/, '');
  return `${base}sprites/${trimmed}`;
}

// Fallback SVG shown in .glasses-sprite.placeholder when nothing is loaded
const PLACEHOLDER_SVG = `
  <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="16" cy="16" r="10"/>
    <line x1="16" y1="6" x2="16" y2="26"/>
  </svg>`;

// ─── PHILOSOPHER SELECT MIRROR (Home tab card) ───────────────────────
// Live-mirrors the philosopher-select page on the glasses: shows the
// same list the glasses are showing, highlights the hovered item as the
// user scrolls the ring, displays a 200×200 sprite preview alongside.
// Clicking an item in this list pushes the corresponding philosopher's
// sprite to the glasses' sprite container (best-effort — we can't
// programmatically scroll the glass list highlighter, just the sprite).

let lastMirrorTradition: string | null = null;
let lastMirrorPhilCount: number = 0;

function renderPhilSelectMirror(s: GlassesState): void {
  const card  = $('phil-mirror-card');
  const list  = $('phil-mirror-list');
  const sprite = $('phil-mirror-sprite');
  const trad  = $('phil-mirror-tradition');
  const title = $('phil-mirror-title');
  if (!card || !list || !sprite || !trad || !title) return;

  const onSelect = s.page === 'philosophers' || s.page === 'speak-philosophers';
  if (!onSelect) {
    card.style.display = 'none';
    lastMirrorTradition = null;
    lastMirrorPhilCount = 0;
    return;
  }
  card.style.display = '';

  // Header
  title.textContent = s.page === 'philosophers' ? 'Browsing philosophers' : 'Speak: pick a philosopher';
  trad.textContent = (s.tradition || s.hoveredPhilosopher?.tradition || '—');

  // Re-render the list only when tradition or list-size changes (avoids
  // wiping/rebuilding click handlers on every scroll event)
  const traditionChanged = lastMirrorTradition !== s.tradition;
  const totalNow = s.hoveredPhilosopher?.total || 0;
  const sizeChanged = lastMirrorPhilCount !== totalNow;
  if (traditionChanged || sizeChanged) {
    const meta = getPhilsForCurrentSelectPage();
    if (meta) {
      list.innerHTML = meta.phils.map((p, i) => `
        <li class="phil-mirror-item" data-i="${i}" data-phil-id="${p.philId}">
          <span class="phil-mirror-num">${i + 1}</span>
          <span class="phil-mirror-name">${escapeHtml(p.name)}</span>
        </li>
      `).join('');
      // Wire clicks once
      list.querySelectorAll<HTMLElement>('.phil-mirror-item').forEach(item => {
        item.addEventListener('click', async () => {
          const i = parseInt(item.dataset.i || '0', 10);
          await setHoveredPhilosopherFromDashboard(i);
        });
      });
    }
    lastMirrorTradition = s.tradition;
    lastMirrorPhilCount = totalNow;
  }

  // Highlight currently-hovered item
  const hi = s.hoveredPhilosopher?.index ?? -1;
  list.querySelectorAll<HTMLElement>('.phil-mirror-item').forEach((item, i) => {
    item.classList.toggle('active', i === hi);
  });

  // Big sprite alongside the list — uses the same spritePath the glasses
  // pushed (per-philosopher neutral). 200×200 so it actually reads.
  if (s.spritePath) {
    const url = spriteUrl(s.spritePath);
    sprite.innerHTML = `<img src="${url}" alt="" onerror="this.parentElement.innerHTML='<span class=\\'phil-mirror-fallback\\'>·</span>'"/>`;
  } else if (s.hoveredPhilosopher) {
    const fallbackPath = `${s.hoveredPhilosopher.philId}/${s.hoveredPhilosopher.philId}-neutral.png`;
    const url = spriteUrl(fallbackPath);
    sprite.innerHTML = `<img src="${url}" alt="" onerror="this.parentElement.innerHTML='<span class=\\'phil-mirror-fallback\\'>·</span>'"/>`;
  } else {
    sprite.innerHTML = `<span class="phil-mirror-fallback">·</span>`;
  }
}

function applyGlassState(s: GlassesState): void {
  // Keep the philosopher-select mirror in sync first (it's prominent)
  renderPhilSelectMirror(s);

  const badge = $('glasses-page-badge');
  const name = $('glasses-page-name');
  const sub = $('glasses-page-sub');
  const dot = $('glasses-live-dot');
  const sprite = $('glasses-sprite');

  if (badge) badge.textContent = s.page;
  if (name) name.textContent = pageLabel(s.page);
  if (sub) sub.textContent = pageSubtext(s) || '—';
  if (dot) dot.style.display = 'inline-block';

  // Mirror the sprite as a regular <img> on the phone side. This isn't
  // the on-glass image — it's a "what does the glass think it's showing
  // right now" check. If the file 404s we fall back to the SVG so the
  // user never sees a broken-image glyph.
  if (sprite && s.spritePath) {
    sprite.className = 'glasses-sprite';
    const url = spriteUrl(s.spritePath);
    sprite.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;" alt="" onerror="this.parentElement.className='glasses-sprite placeholder'; this.parentElement.innerHTML='${PLACEHOLDER_SVG.replace(/\n/g,'').replace(/"/g, '&quot;')}'"/>`;
  } else if (sprite) {
    sprite.className = 'glasses-sprite placeholder';
    sprite.innerHTML = PLACEHOLDER_SVG;
  }

  // Speak tab mirror
  const speakBadge = $('speak-phil-badge');
  const speakMirror = $('speak-mirror');
  if (s.page === 'speak-conversation' && s.philosopher) {
    if (speakBadge) speakBadge.textContent = `${s.philosopher.name}${s.tradition ? ' · ' + s.tradition : ''}`;
    if (speakMirror) {
      const indicator = s.speakThinking
        ? '⋯ Thinking'
        : (s.speakListening ? '● Listening' : '◦ Speaking on glass');
      speakMirror.innerHTML = `
        <div class="muted" style="font-size:12px; font-family: var(--mono);">${indicator}${s.speakPageIndex !== undefined && s.speakPageCount ? ` · glass page ${s.speakPageIndex + 1}/${s.speakPageCount}` : ''}</div>
      `;
    }
    // Render the LIVE glass conversation into the companion thread and prime
    // the phone composer to the same philosopher — so the exchange happening
    // on the glasses shows up here, and you can pick it up from the phone.
    const gpid = s.philosopher.philId;
    if (gpid) {
      speakActivePhil = gpid;
      const sel = document.getElementById('speak-phil-select') as HTMLSelectElement | null;
      if (sel && sel.options.length && sel.value !== gpid) sel.value = gpid;
      const composeBadge = document.getElementById('speak-compose-badge');
      if (composeBadge) composeBadge.textContent = s.philosopher.name;
      renderSpeakThread(gpid).catch(() => {});
    }
  } else if (speakBadge) {
    speakBadge.textContent = '— idle —';
    if (speakMirror) speakMirror.innerHTML = `<p class="muted">Nothing yet. Pick a philosopher → tap the glass → speak. The exchange renders here live.</p>`;
  }
}

// ─── PICKS — FULL QUOTES BROWSER ──────────────────────────────────
// Mirrors Android ui/quotes/QuotesScreen: tradition accordion →
// philosopher rows (40px sprite + name + count) → quote cards. Fully
// offline — every quote is baked into constants.ts. Favorites persist
// via bridge.setLocalStorage under `enki_favorites` (quote-text keyed).

// Favorites now live in src/favorites.ts — ONE store for both surfaces
// (key 'enki_favorites', timestamped entries). Before 1.7.0 this file
// kept its own Set while the glass wrote a different key that was never
// even loaded; a ♥ on the glass and a ★ here were strangers. The
// delegation below is the whole fix: same module, same entries, and
// onFavoritesChange repaints Picks when the glass toggles mid-session.
// Which tradition / philosopher rows are currently expanded (session state)
const expandedTraditions: Set<string> = new Set();
let expandedPhil: string | null = null;   // only one philosopher open at a time

// Rarity → glyph + label + colour class (matches Android QuotesScreen).
// ✦ legendary gold / ◆ epic violet / ◈ rare blue / ○ uncommon green / · common dim
function quoteRarity(q: Quote): Rarity {
  const known: Rarity[] = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
  const v = String(q.rarity || '').toLowerCase() as Rarity;
  return known.includes(v) ? v : getRarity(q.rating || 0);
}

function renderQuoteCard(philId: string, philName: string, q: Quote): string {
  const rarity = quoteRarity(q);
  const glyph = getRaritySymbol(rarity);
  const fav = isFavoriteText(q.text);
  const attribution = `— ${philName}${q.source ? ' · ' + q.source : ''}`;
  return `
    <div class="quote-card rarity-${rarity}">
      <div class="quote-card-top">
        <span class="quote-rarity" title="${escapeAttr(rarity)}">${glyph} ${rarity.toUpperCase()}</span>
        <button class="quote-fav ${fav ? 'on' : ''}" data-fav="${escapeAttr(q.text)}" data-phil="${escapeAttr(philName)}"
          aria-label="${fav ? 'Remove favorite' : 'Save favorite'}" title="${fav ? 'Saved' : 'Save'}">${fav ? '★' : '☆'}</button>
      </div>
      <div class="quote-text">“${escapeHtml(q.text)}”</div>
      <div class="quote-attribution">${escapeHtml(attribution)}</div>
      <div class="quote-emotion mono">${escapeHtml(String(q.emotion || '').replace(/_/g, ' '))}</div>
    </div>`;
}

function renderPhilosopherGrid(): void {
  const host = $('phil-groups');
  if (!host) return;

  let html = '';
  for (const tradition of TRADITIONS) {
    // Picks tab is the quote-browse path — filter out empty-quote
    // philosophers (Enki etc.) so we don't show "0 quotes" cards.
    const phils = getPhilosophersByTradition(tradition as Tradition).filter(p => p.quotes.length > 0);
    if (phils.length === 0) continue;
    const tradQuotes = phils.reduce((sum, p) => sum + p.quotes.length, 0);
    const tOpen = expandedTraditions.has(tradition);

    const rowsHtml = phils.map((p: Philosopher) => {
      const pOpen = expandedPhil === p.philId;
      const cardsHtml = pOpen
        ? `<div class="quote-cards">${p.quotes.map(q => renderQuoteCard(p.philId, p.name, q)).join('')}</div>`
        : '';
      return `
        <div class="phil-row-wrap">
          <div class="phil-row${pOpen ? ' active' : ''}" data-phil="${p.philId}">
            <img class="phil-row-sprite" src="${spriteUrl(`${p.philId}/${p.philId}-neutral.png`)}" alt="" onerror="this.style.display='none'" />
            <div class="phil-row-text">
              <div class="phil-row-name">${escapeHtml(p.name)}</div>
              <div class="phil-row-sub mono">${p.quotes.length} quote${p.quotes.length === 1 ? '' : 's'}</div>
            </div>
            <span class="phil-row-chevron">${pOpen ? '▾' : '▸'}</span>
          </div>
          ${cardsHtml}
        </div>`;
    }).join('');

    html += `<div class="tradition-accordion${tOpen ? ' open' : ''}" data-tradition="${escapeAttr(tradition)}">
      <button class="tradition-head" data-tradition="${escapeAttr(tradition)}">
        <span class="tradition-name">${escapeHtml(tradition)}</span>
        <span class="tradition-count mono">${tradQuotes} quote${tradQuotes === 1 ? '' : 's'}</span>
        <span class="tradition-chevron">${tOpen ? '▾' : '▸'}</span>
      </button>
      ${tOpen ? `<div class="tradition-phils">${rowsHtml}</div>` : ''}
    </div>`;
  }
  host.innerHTML = html;

  // Tradition accordion toggle
  host.querySelectorAll<HTMLElement>('.tradition-head').forEach(head => {
    head.addEventListener('click', () => {
      const t = head.dataset.tradition || '';
      if (expandedTraditions.has(t)) { expandedTraditions.delete(t); expandedPhil = null; }
      else expandedTraditions.add(t);
      renderPhilosopherGrid();
    });
  });

  // Philosopher row toggle (accordion within tradition — one open at a time)
  host.querySelectorAll<HTMLElement>('.phil-row').forEach(row => {
    row.addEventListener('click', () => {
      const philId = row.dataset.phil || '';
      expandedPhil = expandedPhil === philId ? null : philId;
      renderPhilosopherGrid();
    });
  });

  // Favorite toggle — persists to enki_favorites, no re-render churn
  host.querySelectorAll<HTMLButtonElement>('.quote-fav').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const text = btn.dataset.fav || '';
      const added = await toggleFavoriteText(text);
      if (added) addWisdomEntry('fav', text, btn.dataset.phil || '').catch(() => {});
      if (added) {
        btn.classList.add('on'); btn.textContent = '★';
        btn.setAttribute('aria-label', 'Remove favorite');
      } else {
        btn.classList.remove('on'); btn.textContent = '☆';
        btn.setAttribute('aria-label', 'Save favorite');
      }
    });
  });
}

// ─── SPEAK — PHONE-SIDE COMPOSE ───────────────────────────────────
// Mirrors Android ui/speak/SpeakScreen conversation pane: philosopher
// selector, message thread with emotion-reactive sprites next to each
// reply, and a text input + Send. Shares the exact same storage as the
// glass (speak_history_<philId> via speak.ts), so the phone and glasses
// see one thread. Network-dependent, like the glass — offline it just
// surfaces the API error inline.

let speakActivePhil: string | null = null;   // philosopher currently primed
let speakSending = false;

// Read the persisted thread for a philosopher directly from bridge
// storage — the same key speak.ts writes on every exchange.
async function loadSpeakThread(philId: string): Promise<SpeakMessage[]> {
  if (!bridge) return [];
  try {
    const raw = await bridge.getLocalStorage(`speak_history_${philId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      : [];
  } catch { return []; }
}

// ─── POST-CONVERSATION REFLECTION ────────────────────────────────────
// After a real exchange, surface 2 quote-cards that resonate with the
// conversation's emotional register — the philosopher's own words first,
// widening to the corpus when they have few (e.g. Enki) — so the user has
// something to carry into deeper thinking. Pure local (baked quotes), free.
function dominant(arr: string[]): string | null {
  const c: Record<string, number> = {};
  for (const e of arr) c[e] = (c[e] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function reflectionHtml(philId: string, thread: SpeakMessage[]): string {
  if (!thread.some(m => m.role === 'user')) return '';   // only after a real exchange
  const phil = PHILOSOPHERS.find(p => p.philId === philId);
  const philName = phil?.name || 'them';

  const register = dominant(
    thread.filter(m => m.role === 'assistant' && m.emotion).map(m => normalizeEmotion(m.emotion!))
  );

  // Candidate pool: same philosopher in-register → same philosopher →
  // whole corpus in-register → whole corpus.
  const own = (phil?.quotes || []);
  let pool: Quote[] = register ? own.filter(q => normalizeEmotion(q.emotion) === register) : [];
  if (pool.length < 2) pool = pool.concat(own);
  if (pool.length < 2) {
    const all = PHILOSOPHERS.flatMap(p => p.quotes);
    pool = pool.concat(register ? all.filter(q => normalizeEmotion(q.emotion) === register) : all);
  }
  const seen = new Set<string>();
  const ranked = pool.filter(q => q.text && !seen.has(q.text) && seen.add(q.text))
    .sort((a, b) => b.rating - a.rating).slice(0, 6);
  for (let i = ranked.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ranked[i], ranked[j]] = [ranked[j], ranked[i]]; }
  const cards = ranked.slice(0, 2);
  if (cards.length === 0) return '';

  const insight = register
    ? `You moved through ${escapeHtml(register)} with ${escapeHtml(philName)}. Sit with these:`
    : `Carry the conversation with ${escapeHtml(philName)} further:`;

  const items = cards.map(q => {
    const rar = String(q.rarity || getRarity(q.rating));
    const color = TQ_RARITY_COLOR[rar] || 'var(--gold)';
    return `<div class="reflect-quote">
      <span class="reflect-rarity" style="color:${color}">${getRaritySymbol(rar as Rarity)}</span>
      <div class="reflect-quote-main">
        <p class="reflect-text">&ldquo;${escapeHtml(q.text)}&rdquo;</p>
        <p class="reflect-src">— ${escapeHtml(q.source || philName)}</p>
      </div>
    </div>`;
  }).join('');

  return `<div class="reflect-card">
    <div class="reflect-head">✦ TAKE IT DEEPER</div>
    <p class="reflect-insight">${insight}</p>
    ${items}
  </div>`;
}

async function renderSpeakThread(philId: string): Promise<void> {
  const host = $('speak-thread');
  if (!host) return;
  const phil = PHILOSOPHERS.find(p => p.philId === philId);
  const philName = phil?.name || 'Philosopher';
  const thread = await loadSpeakThread(philId);
  if (thread.length === 0) {
    host.innerHTML = `<p class="muted">No turns yet with ${escapeHtml(philName)}. Send your first message below.</p>`;
    return;
  }
  host.innerHTML = thread.map(m => {
    if (m.role === 'user') {
      const mood = m.userMood && m.userMood !== 'neutral'
        ? `<span class="speak-turn-emo">· ${escapeHtml(m.userMood)}</span>` : '';
      return `
        <div class="speak-turn user">
          <div class="speak-turn-head"><span class="speak-turn-who">YOU</span>${mood}</div>
          <div class="speak-turn-body">${escapeHtml(m.content)}</div>
        </div>`;
    }
    // Assistant turn — show the emotion-reactive sprite next to the reply.
    const emo = m.emotion ? normalizeEmotion(m.emotion) : 'neutral';
    const spr = spriteUrl(emotionToSprite(philId, emo));
    const emoTag = m.emotion
      ? `<span class="speak-turn-emo">· ${escapeHtml(String(m.emotion).replace(/_/g, ' '))}</span>` : '';
    return `
      <div class="speak-turn phil">
        <div class="speak-turn-row">
          <img class="speak-turn-sprite" src="${spr}" alt="" onerror="this.style.visibility='hidden'" />
          <div class="speak-turn-main">
            <div class="speak-turn-head"><span class="speak-turn-who">${escapeHtml(philName.toUpperCase())}</span>${emoTag}</div>
            <div class="speak-turn-body">${escapeHtml(m.content)}</div>
          </div>
        </div>
      </div>`;
  }).join('') + reflectionHtml(philId, thread);
  host.scrollTop = host.scrollHeight;
}

// Prime the module conversation (loads history + appends a greeting the
// FIRST time a philosopher is opened this session), then re-render.
async function primeSpeakPhil(philId: string): Promise<void> {
  if (speakActivePhil === philId) return;
  speakActivePhil = philId;
  const badge = $('speak-compose-badge');
  const phil = PHILOSOPHERS.find(p => p.philId === philId);
  if (badge) badge.textContent = phil ? phil.name : philId;
  if (getPersona(philId)) {
    try { await startConversation(philId); } catch (e) { console.warn('[SPEAK] prime failed', e); }
  }
  await renderSpeakThread(philId);
}

/** Programmatically activate a tab (used by the trial CTA → About/pairing). */
function switchTab(name: string): void {
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`) as HTMLElement | null;
  btn?.click();
}

/**
 * First-run onboarding / sign-in gate. Shown when the glasses are unlinked
 * and the user hasn't chosen "continue free". The primary CTA opens
 * enkiridion.com/pricing in the phone browser — that's where Google sign-in
 * and the $8/mo trial run (the Even Hub webview can't host Google OAuth) —
 * then the user links back with a pairing code from the About tab.
 */
async function maybeShowOnboarding(): Promise<void> {
  const overlay = document.getElementById('onboard');
  if (!overlay || !bridge) return;

  const linked = await linkedHandle();
  let dismissed = '';
  try { dismissed = (await bridge.getLocalStorage('enki_onboarded')) || ''; } catch {}
  if (linked || dismissed === '1') { (overlay as HTMLElement).hidden = true; return; }

  (overlay as HTMLElement).hidden = false;

  const close = async (remember: boolean) => {
    (overlay as HTMLElement).hidden = true;
    if (remember && bridge) { try { await bridge.setLocalStorage('enki_onboarded', '1'); } catch {} }
  };

  // "Continue free" → remember, so it stops nudging. The About tab still
  // carries the trial CTA for later.
  document.getElementById('onboard-free')?.addEventListener('click', () => { close(true); });
  // "I already subscribed" → jump to the pairing input (don't remember, so
  // if they bail we still nudge next launch).
  document.getElementById('onboard-pair')?.addEventListener('click', () => { close(false); switchTab('about'); });
  // The trial CTA is an <a target="_blank"> to enkiridion.com — let the
  // browser open; keep the gate un-dismissed so it keeps nudging until the
  // glasses are actually linked.
}

/**
 * Show/hide the enkiSPEAKS trial CTA above the philosopher list.
 * Sage/trial (entitled) → hidden. Seeker or unlinked → shown, so the
 * upgrade path is one tap from where you'd start a conversation.
 */
async function refreshSpeakTrialCta(): Promise<void> {
  const linked = await linkedHandle();
  const entitled = (await linkedTier()) === 'sage';
  const cta = $('speak-trial-cta');
  if (cta) cta.hidden = entitled;
  // The Home "how to unlock" card is only useful before you've paired.
  const howto = $('home-howto');
  if (howto) (howto as HTMLElement).hidden = !!linked;
}

async function initSpeakCompose(): Promise<void> {
  const select = $('speak-phil-select') as HTMLSelectElement | null;
  const input = $('speak-input') as HTMLInputElement | null;
  const sendBtn = $('speak-send') as HTMLButtonElement | null;
  if (!select || !input || !sendBtn) return;

  // Trial CTA → jump to About, where the "Link your glasses" pairing lives.
  // (Starting the trial itself happens on enkiridion.com — Google sign-in +
  // card — then you pair the glasses with the code.)
  const trialCta = $('speak-trial-cta');
  trialCta?.addEventListener('click', () => switchTab('about'));

  // Personas power the persona payload sent to /api/speak.
  await loadPersonas(baseUrl).catch(() => {});

  // Every philosopher can be spoken to (including Enki, the free seeker
  // guide) — this is the conversation path, not the quote-browse path.
  // Grouped by tradition so the list reads Greek / Stoicism / … as labeled
  // sections; the trial CTA above the select sits above the first (Greek).
  select.innerHTML = TRADITIONS.map(tradition => {
    const phils = getPhilosophersByTradition(tradition as Tradition);
    if (phils.length === 0) return '';
    const opts = phils
      .map(p => `<option value="${p.philId}">${escapeHtml(p.name)}</option>`)
      .join('');
    return `<optgroup label="${escapeAttr(tradition)}">${opts}</optgroup>`;
  }).join('');

  await refreshSpeakTrialCta();

  const doSend = async () => {
    if (speakSending) return;
    const philId = select.value;
    const text = input.value.trim();
    if (!philId || !text) return;
    await primeSpeakPhil(philId);

    speakSending = true;
    sendBtn.disabled = true;
    input.value = '';
    // Optimistic: show the user turn immediately, then a thinking row.
    const host = $('speak-thread');
    const philName = PHILOSOPHERS.find(p => p.philId === philId)?.name || 'Philosopher';
    if (host) {
      if (host.querySelector('.muted')) host.innerHTML = '';
      host.insertAdjacentHTML('beforeend', `
        <div class="speak-turn user">
          <div class="speak-turn-head"><span class="speak-turn-who">YOU</span></div>
          <div class="speak-turn-body">${escapeHtml(text)}</div>
        </div>
        <div class="speak-turn phil" id="speak-thinking">
          <div class="speak-turn-head"><span class="speak-turn-who">${escapeHtml(philName.toUpperCase())}</span><span class="speak-turn-emo">· thinking…</span></div>
        </div>`);
      host.scrollTop = host.scrollHeight;
    }

    try {
      // sendMessage handles auth headers + 401/403/429 → returns graceful
      // upsell copy as the reply text (never throws on entitlement).
      await sendMessage(text);
    } catch (e) {
      console.warn('[SPEAK] send failed', e);
    } finally {
      // Re-render from the persisted thread (sendMessage saved it), so the
      // phone reflects exactly what the glass would show.
      await renderSpeakThread(philId);
      speakSending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  };

  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); doSend(); }
  });
  select.addEventListener('change', () => { primeSpeakPhil(select.value); });

  // Prime the first philosopher so the thread reflects any stored history.
  if (select.value) await primeSpeakPhil(select.value);
}

// ─── DEBUG — SPRITE PUSH LOG ──────────────────────────────────────
function refreshPushLog(): void {
  const host = $('push-log');
  const count = $('push-count');
  if (!host) return;
  const entries = getSpritePushLog();
  if (count) count.textContent = String(entries.length);
  if (entries.length === 0) {
    host.innerHTML = '<div class="row ok"><span class="ts">—</span><span class="sp muted">No pushes yet</span></div>';
    return;
  }
  host.innerHTML = entries.map(e => {
    const when = new Date(e.ts).toLocaleTimeString(undefined, { hour12: false });
    return `<div class="row ${e.ok ? 'ok' : 'err'}">
      <span class="ts">${when}</span>
      <span class="sp" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.ok ? '✓' : '✗'} ${e.key}${e.err ? ' — ' + e.err : ''}</span>
      <span class="ms">${e.ms}ms</span>
    </div>`;
  }).join('');
}

// ─── DEBUG — MANUAL PUSH ──────────────────────────────────────────
function initDebugPanel(): void {
  // Populate philosopher picker
  const sel = $('push-phil') as HTMLSelectElement | null;
  if (sel) {
    sel.innerHTML = PHILOSOPHERS.map(p => `<option value="${p.philId}">${p.name} (${p.tradition})</option>`).join('');
  }

  $('btn-push-sprite')?.addEventListener('click', async () => {
    if (!bridge) { log('[DASHBOARD] No bridge', 'error'); return; }
    const phil = (sel?.value || 'socrates');
    const emo = ($('push-emotion') as HTMLSelectElement | null)?.value || 'neutral';
    const path = `${phil}/${phil}-${emo}.png`;
    try {
      await pushSprite(bridge, baseUrl, path, 1, 'portrait', 100, 100);
      log(`[DASHBOARD] Manual push ✓ ${path}`, 'success');
    } catch (e) {
      log(`[DASHBOARD] Manual push FAILED: ${e}`, 'error');
    }
    refreshPushLog();
  });

  $('btn-clear-cache')?.addEventListener('click', () => {
    clearSpriteCache();
    log('[DASHBOARD] Sprite cache cleared', 'success');
    refreshPushLog();
  });

  $('btn-refresh-log')?.addEventListener('click', refreshPushLog);
}

// ─── SETTINGS ─────────────────────────────────────────────────────
async function initSettings(): Promise<void> {
  if (!bridge) return;

  // ── enkiRIDION account link (glasses pairing) ──
  const codeInput = $('glasses-code') as HTMLInputElement | null;
  const linkHint = $('glasses-link-hint');
  const btnLink = $('btn-link-glasses');
  const btnUnlink = $('btn-unlink-glasses');

  async function renderLinkState(): Promise<void> {
    const handle = await linkedHandle();
    const tier = await linkedTier();
    if (linkHint) {
      linkHint.innerHTML = handle
        ? `Linked as @${escapeHtml(handle)} · ${escapeHtml((tier || 'seeker').toUpperCase())}. Tier follows your enkiridion.com subscription. ${tier === 'sage' ? 'Your conversations save to your profile and sync across web, Android &amp; glasses.' : 'Still on Seeker — one conversation a day with Enki (not saved). <a href="https://enkiridion.com/pricing?src=g2" target="_blank" rel="noopener">Start your 7-day free trial →</a>'}`
        : 'Unlinked — Seeker mode: all quotes, plus one conversation a day with Enki (not saved). Start your <strong>7-day free trial</strong> on enkiridion.com (Google sign-in), then generate a code under Settings → G2 Glasses and link here to unlock every philosopher and save your conversations across web &amp; Android. <a href="https://enkiridion.com/pricing?src=g2" target="_blank" rel="noopener">Start free trial →</a>';
    }
    if (btnUnlink) btnUnlink.style.display = handle ? '' : 'none';
    if (btnLink) btnLink.style.display = handle ? 'none' : '';
    if (codeInput) codeInput.style.display = handle ? 'none' : '';
    await refreshSpeakTrialCta();
  }
  await renderLinkState();

  btnLink?.addEventListener('click', async () => {
    const code = codeInput?.value?.trim() || '';
    if (code.length !== 6) { log('[DASHBOARD] Enter the 6-character code', 'error'); return; }
    const result = await linkWithCode(code);
    if (result.ok) {
      log(`[DASHBOARD] Glasses linked as @${result.handle || 'you'} (${result.tier || 'seeker'})`, 'success');
      if (codeInput) codeInput.value = '';
      // First sync right away so the cockpit fills in from the account,
      // and pull any conversations saved on other devices into the journal.
      syncNow().then(async () => {
        await renderChecklist();
        await renderHabits();
      }).catch(() => {});
      pullSpeakSessions().catch(() => {});
    } else {
      log(`[DASHBOARD] Link failed: ${result.error || 'invalid code'}`, 'error');
    }
    await renderLinkState();
    await renderHeaderAccount();
  });

  btnUnlink?.addEventListener('click', async () => {
    await unlink();
    log('[DASHBOARD] Glasses unlinked — back to Seeker', 'success');
    await renderLinkState();
    await renderHeaderAccount();
  });

  $('btn-reset-convos')?.addEventListener('click', async () => {
    if (!bridge) return;
    if (!confirm('Clear ALL conversation history with ALL philosophers? This cannot be undone.')) return;
    // Each philosopher's history lives under speak_history_<philId>
    for (const p of PHILOSOPHERS) {
      await bridge.setLocalStorage(`speak_history_${p.philId}`, '').catch(() => {});
    }
    log('[DASHBOARD] Cleared all conversation history', 'success');
  });
}

// ─── HOME STATS ────────────────────────────────────────────────────
function initHomeStats(): void {
  $('stat-quotes')!.textContent = TOTAL_QUOTES.toLocaleString();
  $('stat-phils')!.textContent  = String(TOTAL_PHILOSOPHERS);
  $('stat-trads')!.textContent  = String(TOTAL_TRADITIONS);
}

// ─── JOURNAL / CALENDAR ───────────────────────────────────────────
let journalCache: JournalSession[] = [];
let calCursor = new Date();  // month being shown
let selectedDate: string | null = null;

async function refreshJournal(): Promise<void> {
  journalCache = await loadJournal();
  const count = $('journal-count');
  if (count) count.textContent = `${journalCache.length} session${journalCache.length === 1 ? '' : 's'}`;
  renderCalendar();
  await renderSessionList();
  renderCollected();
}

// ─── JOURNAL — COLLECTED (the wisdom log) ─────────────────────────
// Everything the user explicitly kept, newest first: quotes saved (with
// a real date), replies logged from the glasses mid-conversation, and
// Aphorica posts liked. The glass writes these; this is where the phone
// shows the trail. Distinct from Sessions above: sessions are what
// HAPPENED, this is what was KEPT.
function renderCollected(): void {
  const host = $('journal-collected');
  if (!host) return;
  const items: { ts: number; icon: string; label: string; text: string }[] = [];
  for (const w of getWisdomEntries()) {
    items.push({
      ts: w.ts,
      icon: w.kind === 'reply' ? '●' : '♥',
      label: w.kind === 'like' ? `Liked @${w.who}`
           : w.kind === 'post' ? `Kept @${w.who}`
           : w.kind === 'reply' ? `Reply from ${w.who}`
           : `Saved · ${w.who}`,
      text: w.text,
    });
  }
  const badge = $('journal-collected-count');
  if (badge) badge.textContent = String(items.length);
  if (items.length === 0) {
    host.innerHTML = `<p class="muted">Nothing collected yet. On the glasses: tap-and-hold any quote → Save to favorites, or any reply → Log this reply.</p>`;
    return;
  }
  items.sort((a, b) => b.ts - a.ts);
  host.innerHTML = `<ul class="collected-list">${items.slice(0, 60).map(i => {
    const d = new Date(i.ts);
    const when = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    return `<li class="collected-item">
      <span class="ci-icon">${i.icon}</span>
      <div class="ci-body">
        <div class="ci-meta">${escapeHtml(i.label)} · ${when}</div>
        <div class="ci-text">${escapeHtml(i.text)}</div>
      </div>
    </li>`;
  }).join('')}</ul>`;
}

// ─── JOURNAL — SESSION LIST (Android ui/journal parity) ───────────
// Every session as a row: sprite + name + date + first-line snippet +
// turn count. Tapping expands the full conversation turns; action items
// extracted from that session (loadActionItems, matched by sessionId)
// render below the turns. Fully offline — reads baked/stored journal.
const expandedSessions: Set<string> = new Set();

function sessionKey(s: JournalSession): string { return `${s.philId}@${s.startTs}`; }

async function renderSessionList(): Promise<void> {
  const host = $('journal-sessions');
  const count = $('journal-sessions-count');
  if (!host) return;

  if (journalCache.length === 0) {
    host.innerHTML = `<p class="muted">No conversations yet. Open Speak on the glasses or the phone to start one.</p>`;
    if (count) count.textContent = '0';
    return;
  }

  // Newest first
  const sessions = [...journalCache].sort((a, b) => b.startTs - a.startTs);
  if (count) count.textContent = `${sessions.length}`;

  // Action items keyed by sessionId (<philId>@<startTs>) so we can attach
  let actionsBySession = new Map<string, any[]>();
  try {
    const items = await loadActionItems();
    for (const it of items) {
      const arr = actionsBySession.get(it.sessionId) || [];
      arr.push(it);
      actionsBySession.set(it.sessionId, arr);
    }
  } catch {}

  host.innerHTML = `<div class="session-list">${sessions.map(s => {
    const key = sessionKey(s);
    const open = expandedSessions.has(key);
    const firstUser = s.exchanges.find(m => m.role === 'user');
    const snippet = firstUser ? firstUser.content : (s.exchanges[0]?.content || '');
    const dateLabel = new Date(s.startTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeLabel = new Date(s.startTs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const turns = s.exchanges.length;
    const acts = actionsBySession.get(key) || [];

    let bodyHtml = '';
    if (open) {
      const turnsHtml = s.exchanges.map((m: SpeakMessage) => {
        const who = m.role === 'user' ? 'YOU' : s.philName.toUpperCase();
        const cls = m.role === 'user' ? 'user' : 'phil';
        const tag = m.role === 'user'
          ? (m.userMood && m.userMood !== 'neutral' ? `<span class="mood">· ${escapeHtml(m.userMood)}</span>` : '')
          : (m.emotion ? `<span class="mood">· ${escapeHtml(String(m.emotion).replace(/_/g, ' '))}</span>` : '');
        return `<div class="session-exchange ${cls}">
          <div class="who">${who}${tag}</div>
          <div class="content">${escapeHtml(m.content)}</div>
        </div>`;
      }).join('');
      const actsHtml = acts.length ? `
        <div class="session-actions">
          <div class="session-actions-label">${acts.length} action item${acts.length === 1 ? '' : 's'}</div>
          ${acts.slice(0, 8).map(a => `
            <div class="session-action-item">
              ${escapeHtml(a.title || '')}
              ${a.theme ? `<div class="sa-meta">${escapeHtml(a.theme)}</div>` : ''}
            </div>`).join('')}
        </div>` : '';
      bodyHtml = `<div class="session-item-body">${turnsHtml}${actsHtml}</div>`;
    }

    return `
      <div class="session-item${open ? ' open' : ''}">
        <button class="session-item-head" data-session="${escapeAttr(key)}">
          <img class="session-item-sprite" src="${spriteUrl(`${s.philId}/${s.philId}-neutral.png`)}" alt="" onerror="this.style.visibility='hidden'" />
          <div class="session-item-text">
            <div class="session-item-name">${escapeHtml(s.philName)} · ${escapeHtml(s.tradition)}</div>
            <div class="session-item-snippet">${escapeHtml(snippet)}</div>
            <div class="session-item-meta">${dateLabel} · ${timeLabel} · ${turns} turn${turns === 1 ? '' : 's'}${acts.length ? ` · ${acts.length} action${acts.length === 1 ? '' : 's'}` : ''}</div>
          </div>
          <span class="session-item-chevron">${open ? '▾' : '▸'}</span>
        </button>
        ${bodyHtml}
      </div>`;
  }).join('')}</div>`;

  host.querySelectorAll<HTMLElement>('.session-item-head').forEach(head => {
    head.addEventListener('click', () => {
      const k = head.dataset.session || '';
      if (expandedSessions.has(k)) expandedSessions.delete(k);
      else expandedSessions.add(k);
      renderSessionList();
    });
  });
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderCalendar(): void {
  const host = $('journal-calendar');
  if (!host) return;

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay(); // 0=Sun
  const monthLabel = calCursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const todayKey = dateKey(new Date());

  // Group journal sessions by date
  const byDate = new Map<string, JournalSession[]>();
  for (const s of journalCache) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }
  // Captures (wisdom log + dated favorites) count as activity too — a
  // day where the wearer only SAVED things is not an empty day. Same
  // union the glass calendar uses (glassCalendar.buildActivityMap).
  const capturesByDate = new Map<string, number>();
  for (const w of getWisdomEntries()) {
    // All kinds count — 'fav' entries ARE the save history now (the
    // live favorites store can shrink on un-favorite; the log cannot).
    const k = dateKey(new Date(w.ts));
    capturesByDate.set(k, (capturesByDate.get(k) || 0) + 1);
  }

  let html = `
    <div class="cal-nav">
      <button id="cal-prev" aria-label="previous">‹</button>
      <div class="month-label">${monthLabel}</div>
      <button id="cal-next" aria-label="next">›</button>
    </div>
    <div class="cal-header">
      ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div>${d}</div>`).join('')}
    </div>
    <div class="cal-grid">`;

  for (let i = 0; i < leading; i++) html += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(new Date(year, month, d));
    const sessions = byDate.get(key) || [];
    const captures = capturesByDate.get(key) || 0;
    // Only SESSION days are clickable (the day click filters the
    // session list); capture-only days get the ♥ badge but must not
    // look interactive — a clickable-looking no-op reads as broken
    // (review finding). Captures live in the Collected card below.
    const has = sessions.length > 0 ? ' has-sessions' : '';
    const active = key === selectedDate ? ' active' : '';
    const today = key === todayKey ? ' today' : '';
    const countText = sessions.length > 0 ? `${sessions.length}×` : (captures > 0 ? '♥' : '');
    html += `<div class="cal-cell${has}${active}${today}" data-date="${key}" ${!sessions.length ? 'style="cursor:default"' : ''}>
      <span class="day">${d}</span>
      <span class="count">${countText}</span>
    </div>`;
  }
  html += `</div>`;
  host.innerHTML = html;

  $('cal-prev')?.addEventListener('click', () => { calCursor = new Date(year, month - 1, 1); renderCalendar(); });
  $('cal-next')?.addEventListener('click', () => { calCursor = new Date(year, month + 1, 1); renderCalendar(); });

  host.querySelectorAll<HTMLElement>('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', async () => {
      const k = cell.dataset.date;
      if (!k || !byDate.has(k)) return;
      selectedDate = k;
      renderCalendar();
      await renderSessionDetail(k, byDate.get(k) || []);
    });
  });
}

async function renderSessionDetail(date: string, sessions: JournalSession[]): Promise<void> {
  const host = $('session-detail');
  const badge = $('session-detail-badge');
  if (!host) return;
  if (badge) badge.textContent = `${date} · ${sessions.length} session${sessions.length === 1 ? '' : 's'}`;

  if (sessions.length === 0) {
    host.innerHTML = `<p class="muted">No exchanges on ${date}.</p>`;
    return;
  }

  // ── Daily overview rollup ────────────────────────────────────────
  const sortedSessions = [...sessions].sort((a, b) => a.startTs - b.startTs);
  const totalTurns = sessions.reduce((sum, s) => sum + s.exchanges.length, 0);
  const userTurns = sessions.reduce((sum, s) => sum + s.exchanges.filter(m => m.role === 'user').length, 0);
  const philsCount = new Map<string, number>();
  for (const s of sessions) {
    philsCount.set(s.philName, (philsCount.get(s.philName) || 0) + 1);
  }
  const philsList = [...philsCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => c > 1 ? `${n} (×${c})` : n);

  // Mood distribution across user turns
  const moodCount = new Map<string, number>();
  for (const s of sessions) {
    for (const m of s.exchanges) {
      if (m.role === 'user' && m.userMood && m.userMood !== 'neutral') {
        moodCount.set(m.userMood, (moodCount.get(m.userMood) || 0) + 1);
      }
    }
  }
  const topMoods = [...moodCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m, c]) => c > 1 ? `${m} (${c})` : m);

  // Action items extracted on this date (across all today's sessions)
  let actionsToday: any[] = [];
  try {
    const items = await loadActionItems();
    actionsToday = items.filter(it => it.date === date);
  } catch {}

  const firstTime = new Date(sortedSessions[0].startTs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const lastTime = new Date(sortedSessions[sortedSessions.length - 1].endTs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const range = sessions.length > 1 ? `${firstTime} → ${lastTime}` : firstTime;

  const overviewHtml = `
    <div class="day-overview">
      <div class="day-overview-row">
        <div class="day-stat"><div class="day-stat-v">${sessions.length}</div><div class="day-stat-k">session${sessions.length === 1 ? '' : 's'}</div></div>
        <div class="day-stat"><div class="day-stat-v">${philsCount.size}</div><div class="day-stat-k">philosopher${philsCount.size === 1 ? '' : 's'}</div></div>
        <div class="day-stat"><div class="day-stat-v">${userTurns}</div><div class="day-stat-k">your turn${userTurns === 1 ? '' : 's'}</div></div>
        <div class="day-stat"><div class="day-stat-v">${actionsToday.length}</div><div class="day-stat-k">action${actionsToday.length === 1 ? '' : 's'}</div></div>
      </div>
      <div class="day-overview-meta">
        <div><span class="meta-k">Time:</span> ${range}</div>
        <div><span class="meta-k">With:</span> ${philsList.join(' · ')}</div>
        ${topMoods.length ? `<div><span class="meta-k">Moods:</span> ${topMoods.join(' · ')}</div>` : ''}
      </div>
      ${actionsToday.length ? `
        <details class="day-actions">
          <summary>${actionsToday.length} action item${actionsToday.length === 1 ? '' : 's'} extracted today</summary>
          <ul class="day-actions-list">
            ${actionsToday.slice(0, 8).map(a => `
              <li>
                <div class="day-action-title">${escapeHtml(a.title)}</div>
                <div class="day-action-meta">${escapeHtml(a.philName)} · ${escapeHtml(a.theme || '')}</div>
              </li>
            `).join('')}
          </ul>
        </details>
      ` : ''}
    </div>
  `;

  // ── Sessions: collapsible per-philosopher blocks ──────────────────
  const sessionsHtml = sortedSessions.map((s, i) => {
    const time = new Date(s.startTs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const turnsHtml = s.exchanges.map((m: SpeakMessage) => {
      const who = m.role === 'user' ? 'You' : s.philName;
      const cls = m.role === 'user' ? 'user' : 'phil';
      const mood = m.userMood && m.role === 'user' ? `<span class="mood">${m.userMood}</span>` : '';
      const emo = m.emotion && m.role === 'assistant' ? `<span class="mood">${m.emotion}</span>` : '';
      return `<div class="session-exchange ${cls}">
        <div class="who">${who}${mood}${emo}</div>
        <div class="content">${escapeHtml(m.content)}</div>
      </div>`;
    }).join('');
    // Only the most recent session opens by default
    const openAttr = i === sortedSessions.length - 1 ? ' open' : '';
    return `<details class="session-block"${openAttr}>
      <summary class="session-summary">
        <span class="session-phil">${escapeHtml(s.philName)}</span>
        <span class="session-trad">${escapeHtml(s.tradition)}</span>
        <span class="session-time">${time}</span>
        <span class="session-turns">${s.exchanges.length} turn${s.exchanges.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="session-body">${turnsHtml}</div>
    </details>`;
  }).join('');

  host.innerHTML = overviewHtml + sessionsHtml;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] || c));
}

// ─── PROBLEMS (extracted via /api/problems) ───────────────────────
// Runs AUTOMATICALLY — once on load when a journal exists, and again each
// time a conversation ends on the glasses (same trigger that refreshes the
// journal). The "Extract from journal" button remains as a manual refresh.
// Auto runs fail silently so a network blip or tier gate never scribbles
// an error over the panel unprompted.
let problemsRunning = false;
async function extractProblems(auto: boolean = false): Promise<void> {
  const host = $('problems-list');
  const count = $('problems-count');
  if (!host || problemsRunning) return;
  if (journalCache.length === 0) {
    if (!auto) host.innerHTML = '<p class="muted">No journal yet. Talk to a philosopher first.</p>';
    return;
  }
  problemsRunning = true;
  if (!auto) host.innerHTML = '<p class="muted">Analyzing…</p>';
  try {
    const resp = await fetch('https://sophicon-api.vercel.app/api/problems', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ journal: journalCache }),
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    const problems = data.problems || [];
    if (count) count.textContent = `${problems.length}`;
    host.innerHTML = problems.length === 0
      ? '<p class="muted">No recurring themes yet.</p>'
      : problems.map((p: any) => `
        <div class="item-card">
          <div class="title">${escapeHtml(p.title || '?')}</div>
          <div class="summary">${escapeHtml(p.summary || '')}</div>
          <div class="meta">
            <span>first seen ${escapeHtml(p.firstSeen || '—')}</span>
            <span>${p.exchangeCount || 0} turns</span>
            ${(p.moods || []).map((m: string) => `<span class="mood">${escapeHtml(m)}</span>`).join('')}
          </div>
          <div class="source">heard by: ${(p.philosophers || []).map((n: string) => escapeHtml(n)).join(' · ')}</div>
        </div>`).join('');
    log(`[DASHBOARD] ${problems.length} problems extracted${auto ? ' (auto)' : ''}`, 'success');
  } catch (e) {
    if (!auto) host.innerHTML = `<p style="color:var(--err);">Failed: ${e}</p>`;
    log(`[DASHBOARD] problems failed: ${e}`, 'error');
  } finally {
    problemsRunning = false;
  }
}

// ─── ACTION ITEMS (via /api/actions) ──────────────────────────────
async function computeActions(): Promise<void> {
  const host = $('actions-list');
  if (!host) return;
  if (journalCache.length === 0) {
    host.innerHTML = '<p class="muted">No journal yet. Talk to a philosopher first.</p>';
    return;
  }
  // Past 7 days of sessions
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = journalCache.filter(s => s.endTs >= cutoff);
  if (recent.length === 0) {
    host.innerHTML = '<p class="muted">No conversations in the last 7 days.</p>';
    return;
  }
  host.innerHTML = '<p class="muted">Generating…</p>';
  try {
    const resp = await fetch('https://sophicon-api.vercel.app/api/actions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ conversations: recent, scope: 'week' }),
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    const actions = data.actions || [];
    host.innerHTML = actions.length === 0
      ? '<p class="muted">Nothing actionable surfaced this week.</p>'
      : actions.map((a: any) => `
        <div class="item-card">
          <div class="title">${escapeHtml(a.title || '?')}</div>
          <div class="summary">${escapeHtml(a.detail || '')}</div>
          <div class="source">— ${escapeHtml(a.source || '')}${a.theme ? ` · ${escapeHtml(a.theme)}` : ''}</div>
        </div>`).join('');
    log(`[DASHBOARD] ${actions.length} actions generated`, 'success');
  } catch (e) {
    host.innerHTML = `<p style="color:var(--err);">Failed: ${e}</p>`;
    log(`[DASHBOARD] actions failed: ${e}`, 'error');
  }
}

function initJournalPanel(): void {
  // Explicit false: addEventListener would otherwise pass the click Event
  // as the `auto` flag, silencing manual-run feedback.
  $('btn-extract-problems')?.addEventListener('click', () => extractProblems(false));
  $('btn-compute-actions')?.addEventListener('click', computeActions);
}

// ─── MINDFULNESS TAB ──────────────────────────────────────────────
let mindfulSelectedPhilIds: Set<string> = new Set();

function renderMindfulPhilGrid(): void {
  const host = $('mindful-phil-grid');
  if (!host) return;
  host.innerHTML = PHILOSOPHERS.map(p => `
    <div class="phil-card ${mindfulSelectedPhilIds.has(p.philId) ? 'active' : ''}" data-phil="${p.philId}">
      <img class="phil-card-sprite" src="${spriteUrl(`${p.philId}/${p.philId}-neutral.png`)}" alt="" onerror="this.style.display='none'" />
      <div class="phil-card-text">
        <div class="phil-card-name">${p.name}</div>
        <div class="phil-card-sub">${p.tradition}</div>
      </div>
    </div>
  `).join('');
  host.querySelectorAll<HTMLElement>('.phil-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.phil!;
      if (mindfulSelectedPhilIds.has(id)) mindfulSelectedPhilIds.delete(id);
      else mindfulSelectedPhilIds.add(id);
      renderMindfulPhilGrid();
      updateMindfulPhilCount();
    });
  });
}

function updateMindfulPhilCount(): void {
  const badge = $('mindful-phil-count');
  if (!badge) return;
  const n = mindfulSelectedPhilIds.size;
  badge.textContent = n === 0 ? `all ${PHILOSOPHERS.length}` : `${n} selected`;
}

function updateMindfulStatus(): void {
  const cfg = getMindfulConfig();
  const status = $('mindful-status');
  if (!status) return;
  if (!cfg.enabled) {
    status.textContent = 'off';
    return;
  }
  if (cfg.nextAt) {
    const ms = cfg.nextAt - Date.now();
    if (ms > 0) {
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      status.textContent = `next in ${m}:${String(s).padStart(2,'0')}`;
    } else {
      status.textContent = 'showing...';
    }
  } else {
    status.textContent = 'on';
  }
}

async function initMindfulPanel(): Promise<void> {
  const cfg = await loadMindfulConfig();
  // Apply saved config to the form
  const intervalSel = $('mindful-interval') as HTMLSelectElement | null;
  const displaySel  = $('mindful-display')  as HTMLSelectElement | null;
  if (intervalSel) intervalSel.value = String(cfg.intervalSec);
  if (displaySel)  displaySel.value  = String(cfg.displaySec);
  mindfulSelectedPhilIds = new Set(cfg.philIds || []);

  renderMindfulPhilGrid();
  updateMindfulPhilCount();

  $('btn-mindful-all')?.addEventListener('click', () => {
    mindfulSelectedPhilIds = new Set(PHILOSOPHERS.map(p => p.philId));
    renderMindfulPhilGrid();
    updateMindfulPhilCount();
  });
  $('btn-mindful-none')?.addEventListener('click', () => {
    mindfulSelectedPhilIds.clear();
    renderMindfulPhilGrid();
    updateMindfulPhilCount();
  });

  $('btn-mindful-start')?.addEventListener('click', async () => {
    const intervalSec = Number(intervalSel?.value || 300);
    const displaySec  = Number(displaySel?.value  || 60);
    await startMindfulness({
      intervalSec, displaySec,
      philIds: Array.from(mindfulSelectedPhilIds),
    });
    log(`[MINDFUL] started — ${intervalSec}s interval, ${displaySec}s hold`, 'success');
    updateMindfulStatus();
  });

  $('btn-mindful-stop')?.addEventListener('click', async () => {
    await stopMindfulness();
    log('[MINDFUL] stopped', 'success');
    updateMindfulStatus();
  });

  // Live countdown while tab is visible
  setInterval(updateMindfulStatus, 1000);
}

// ─── WEEKLY ACTION PLAN ───────────────────────────────────────────
// Surfaces clusters of problems on the Home tab. Each problem opens a
// modal showing 3-5 actions grouped by Eisenhower quadrant, each action
// tethered to a small carousel of quotes pulled from constants.ts that
// match the action's emotion-theme tags. Storage is per ISO week so the
// user can navigate prev/next weeks and roll-over open problems.
let currentWeekKey: string = isoWeekKey();
let currentOverview: WeeklyOverview | null = null;
let activeProblemId: string | null = null;

async function initWeeklyPanel(): Promise<void> {
  $('btn-weekly-generate')?.addEventListener('click', async () => {
    await generateForCurrentWeek(false);
  });

  $('btn-weekly-rollover')?.addEventListener('click', async () => {
    if (!confirm('Generate next week from this week\'s open problems?')) return;
    const nextWeek = shiftWeek(currentWeekKey, 1);
    const rolledOver = await pickRolloverCandidates(currentWeekKey);
    setWeeklyStatus(`Rolling ${rolledOver.length} into ${nextWeek}…`);
    try {
      const journal = await loadJournal();
      const inWindow = filterJournalToWeek(journal, nextWeek);
      const ov = await generateOverview({ weekKey: nextWeek, journal: inWindow, rolledOver });
      await markDirty('weekly_overview', nextWeek);
      schedulePush();
      currentWeekKey = nextWeek;
      currentOverview = ov;
      await renderWeekly();
      setWeeklyStatus(`Generated ${ov.problems.length} problems for ${nextWeek}.`);
    } catch (e: any) {
      setWeeklyStatus(`Rollover failed: ${e?.message || e}`);
    }
  });

  // Prev/next week navigation. We cap forward navigation at +4 weeks
  // past the current ISO week — generating action plans for 3+ months
  // out is meaningless and the empty-state UI starts to feel broken.
  // Backward is uncapped (can scroll into past indefinitely).
  const MAX_FUTURE_WEEKS = 4;

  $('weekly-prev')?.addEventListener('click', async () => {
    try {
      const next = shiftWeek(currentWeekKey, -1);
      console.log('[WEEKLY] ‹ prev', currentWeekKey, '→', next);
      if (next === currentWeekKey) return;  // safety: shiftWeek failed
      currentWeekKey = next;
      await loadAndRenderCurrentWeek();
    } catch (e) {
      console.error('[WEEKLY] prev failed', e);
      setWeeklyStatus(`prev failed: ${(e as any)?.message || e}`);
    }
  });
  $('weekly-next')?.addEventListener('click', async () => {
    try {
      const next = shiftWeek(currentWeekKey, +1);
      console.log('[WEEKLY] › next', currentWeekKey, '→', next);
      if (next === currentWeekKey) {
        console.warn('[WEEKLY] shiftWeek returned same key — invalid weekKey?', currentWeekKey);
        setWeeklyStatus(`Can't advance — weekKey malformed: ${currentWeekKey}`);
        return;
      }
      // Enforce forward cap relative to TODAY's ISO week
      const today = isoWeekKey();
      const todayMon = isoWeekMondayLocal(today);
      const nextMon  = isoWeekMondayLocal(next);
      if (todayMon && nextMon) {
        const weeksAhead = Math.round((+nextMon - +todayMon) / (7 * 86400000));
        if (weeksAhead > MAX_FUTURE_WEEKS) {
          setWeeklyStatus(`Forward capped at +${MAX_FUTURE_WEEKS} weeks. Plan further out by living it first.`);
          return;
        }
      }
      currentWeekKey = next;
      await loadAndRenderCurrentWeek();
    } catch (e) {
      console.error('[WEEKLY] next failed', e);
      setWeeklyStatus(`next failed: ${(e as any)?.message || e}`);
    }
  });

  // Modal close + actions
  $('problem-modal-close')?.addEventListener('click', closeProblemModal);
  $('problem-modal')?.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).id === 'problem-modal') closeProblemModal();
  });
  $('problem-modal-addressed')?.addEventListener('click', async () => {
    if (!activeProblemId) return;
    await setProblemStatus(currentWeekKey, activeProblemId, 'addressed');
    await markDirty('weekly_overview', currentWeekKey);
    schedulePush();
    currentOverview = await loadOverview(currentWeekKey);
    await renderWeekly();
    closeProblemModal();
  });
  $('problem-modal-rollover')?.addEventListener('click', async () => {
    if (!activeProblemId) return;
    await setProblemStatus(currentWeekKey, activeProblemId, 'rolled-over');
    await markDirty('weekly_overview', currentWeekKey);
    schedulePush();
    currentOverview = await loadOverview(currentWeekKey);
    await renderWeekly();
    closeProblemModal();
  });

  // ESC closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProblemModal();
  });

  await loadAndRenderCurrentWeek();
}

function setWeeklyStatus(msg: string): void {
  const el = $('weekly-status');
  if (el) el.textContent = msg;
}

/** Monday of an ISO weekKey as a UTC Date (local-only mirror of weekly.ts
 * isoWeekMonday — kept here so dashboard doesn't need that internal). */
function isoWeekMondayLocal(weekKey: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return null;
  const jan4 = new Date(Date.UTC(+m[1], 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monW1 = new Date(jan4);
  monW1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const mon = new Date(monW1);
  mon.setUTCDate(monW1.getUTCDate() + (parseInt(m[2]) - 1) * 7);
  return mon;
}

/** Disable prev/next buttons at sensible bounds + show visual state. */
function updateWeekNavBounds(): void {
  const prevBtn = $('weekly-prev') as HTMLButtonElement | null;
  const nextBtn = $('weekly-next') as HTMLButtonElement | null;
  if (!prevBtn || !nextBtn) return;
  // Prev: never disabled (you can always look back)
  prevBtn.disabled = false;
  prevBtn.title = 'Previous week';
  // Next: disabled if we're already 4+ weeks ahead of current week
  const today = isoWeekKey();
  const cur   = isoWeekMondayLocal(currentWeekKey);
  const tod   = isoWeekMondayLocal(today);
  if (cur && tod) {
    const ahead = Math.round((+cur - +tod) / (7 * 86400000));
    if (ahead >= 4) {
      nextBtn.disabled = true;
      nextBtn.title = 'Forward capped at +4 weeks';
      return;
    }
  }
  nextBtn.disabled = false;
  nextBtn.title = 'Next week';
}

/** Filter journal to sessions within the same ISO week. */
function filterJournalToWeek(journal: JournalSession[], weekKey: string): JournalSession[] {
  return journal.filter(s => {
    try {
      const d = new Date(s.startTs);
      return isoWeekKey(d) === weekKey;
    } catch { return false; }
  });
}

async function loadAndRenderCurrentWeek(): Promise<void> {
  currentOverview = await loadOverview(currentWeekKey);
  await renderWeekly();
}

async function generateForCurrentWeek(force: boolean): Promise<void> {
  setWeeklyStatus('Generating…');
  const generateBtn = $('btn-weekly-generate') as HTMLButtonElement | null;
  if (generateBtn) generateBtn.disabled = true;
  try {
    const journal = await loadJournal();
    const inWindow = filterJournalToWeek(journal, currentWeekKey);
    if (inWindow.length === 0 && !force) {
      setWeeklyStatus('No conversations in this week. Have a Speak session first.');
      return;
    }
    const ov = await generateOverview({ weekKey: currentWeekKey, journal: inWindow });
    await markDirty('weekly_overview', currentWeekKey);
    schedulePush();
    currentOverview = ov;
    await renderWeekly();
    setWeeklyStatus(`Generated ${ov.problems.length} problem${ov.problems.length === 1 ? '' : 's'}.`);
  } catch (e: any) {
    setWeeklyStatus(`Failed: ${e?.message || e}`);
  } finally {
    if (generateBtn) generateBtn.disabled = false;
  }
}

async function renderWeekly(): Promise<void> {
  const titleEl = $('weekly-week-title');
  const keyEl   = $('weekly-week-key');
  const list    = $('problem-list');
  const empty   = $('weekly-empty');
  const rollBtn = $('btn-weekly-rollover');
  const genBtn  = $('btn-weekly-generate');
  if (!titleEl || !keyEl || !list || !empty || !rollBtn || !genBtn) return;

  // Header — "2026 // APRIL // W1" big, range subtle below
  const isThisWeek = currentWeekKey === isoWeekKey();
  titleEl.textContent = weekDisplayLabel(currentWeekKey);
  keyEl.textContent = `${weekRangeLabel(currentWeekKey)}${isThisWeek ? ' · current' : ''}`;
  updateWeekNavBounds();

  // Body
  if (!currentOverview || currentOverview.problems.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    genBtn.textContent = 'Generate this week';
    rollBtn.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  genBtn.textContent = 'Regenerate';

  // If any problems are still open, offer rollover (relevant near end of week)
  const hasOpen = currentOverview.problems.some(p => p.status === 'open');
  rollBtn.style.display = hasOpen ? '' : 'none';

  list.innerHTML = currentOverview.problems.map(p => {
    const total = p.actions.length;
    const done  = p.actions.filter(a => a.done).length;
    const progressClass = done === total && total > 0 ? 'complete' : '';
    const rolledClass = p.status === 'rolled-over' ? 'rolled' : '';
    const addressedClass = p.status === 'addressed' ? 'addressed' : '';
    const philsLine = p.philosophers.slice(0, 3).join(' · ');
    const moreCount = Math.max(0, p.philosophers.length - 3);
    return `
      <li class="problem-row ${addressedClass} ${rolledClass}" data-pid="${escapeAttr(p.id)}">
        <span class="cat-badge" data-cat="${p.category}">${p.category}</span>
        <div class="problem-info">
          <div class="problem-title">${escapeHtml(p.title)}</div>
          <div class="problem-meta">
            <span>${escapeHtml(philsLine)}${moreCount ? ` +${moreCount}` : ''}</span>
            <span class="status-pill ${p.status}">${p.status}</span>
          </div>
        </div>
        <div class="problem-progress ${progressClass}">${done}/${total}</div>
      </li>`;
  }).join('');

  // Wire row clicks
  list.querySelectorAll<HTMLElement>('.problem-row').forEach(row => {
    row.addEventListener('click', () => {
      const pid = row.dataset.pid || '';
      openProblemModal(pid);
    });
  });
}

// Per-action picked quote, locked when the modal opens — no longer shuffles.
// Long-pressing the action and favoriting it freezes whichever quote is
// shown at that moment onto the resulting Habit.
const lockedQuoteByAction = new Map<string, ReturnType<typeof pickQuotesForAction>[number]>();

async function openProblemModal(problemId: string): Promise<void> {
  if (!currentOverview) return;
  const p = currentOverview.problems.find(p => p.id === problemId);
  if (!p) return;
  activeProblemId = problemId;

  const modal = $('problem-modal');
  if (!modal) return;

  ($('problem-modal-cat')!).textContent = p.category;
  ($('problem-modal-cat')!).setAttribute('data-cat', p.category);
  ($('problem-modal-title')!).textContent = p.title;
  ($('problem-modal-summary')!).textContent = p.summary;

  // Lock-in one quote per action for THIS modal session
  lockedQuoteByAction.clear();
  for (const a of p.actions) {
    const picks = pickQuotesForAction(a, 1);
    if (picks.length > 0) lockedQuoteByAction.set(a.id, picks[0]);
  }

  // Get current habit set so favorited rows render with the flame
  const habits = await listHabits();
  const habitIds = new Set(habits.map(h => h.id));

  // Render actions into their respective quadrants
  for (const q of QUADRANTS) {
    const ul = modal.querySelector<HTMLElement>(`.action-list[data-q="${q}"]`);
    if (!ul) continue;
    const actions = p.actions.filter(a => a.quadrant === q);
    if (actions.length === 0) {
      ul.innerHTML = '<li class="muted" style="font-size:11.5px;padding:6px;">—</li>';
      continue;
    }
    ul.innerHTML = actions.map(a => renderActionRow(p.id, a, habitIds.has(a.id))).join('');
  }

  // Wire checkboxes
  modal.querySelectorAll<HTMLElement>('.action-check').forEach(check => {
    check.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const pid = check.dataset.pid || '';
      const aid = check.dataset.aid || '';
      const next = !check.classList.contains('checked');
      await setActionDone(currentWeekKey, pid, aid, next);
      await markDirty('weekly_overview', currentWeekKey);
      schedulePush();
      const prob = currentOverview?.problems.find(p => p.id === pid);
      const act = prob?.actions.find(a => a.id === aid);
      if (act) act.done = next;
      check.classList.toggle('checked', next);
      check.innerHTML = next ? '✓' : '';
      check.closest('.action-row')?.classList.toggle('done', next);
      await renderWeekly();
    });
  });

  // Wire long-press → favorite-as-habit on each action row
  modal.querySelectorAll<HTMLElement>('.action-row').forEach(row => {
    attachLongPress(row, async () => {
      const aid = row.dataset.aid || '';
      await toggleHabitForAction(p.id, aid, row);
    });
  });

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function renderActionRow(pid: string, a: WeeklyAction, isHabit: boolean): string {
  const fq = lockedQuoteByAction.get(a.id);
  const quoteHtml = fq
    ? `<div class="tethered-quote" data-aid="${escapeAttr(a.id)}">${escapeHtml(fq.q.text)}<span class="q-attrib">— ${escapeHtml(fq.phil)}, ${escapeHtml(fq.q.source || fq.tradition)}</span></div>`
    : '';
  return `
    <li class="action-row ${a.done ? 'done' : ''} ${isHabit ? 'is-habit' : ''}" data-aid="${escapeAttr(a.id)}">
      <div class="action-head">
        <span class="action-check ${a.done ? 'checked' : ''}" data-pid="${escapeAttr(pid)}" data-aid="${escapeAttr(a.id)}">${a.done ? '✓' : ''}</span>
        <div style="flex:1;min-width:0;">
          <div class="action-title">${escapeHtml(a.title)}${isHabit ? ' <span class="habit-flame" title="Favorited as a daily habit">🔥</span>' : ''}</div>
          ${a.source ? `<div class="action-source">${escapeHtml(a.source)}</div>` : ''}
        </div>
      </div>
      <div class="action-detail">${escapeHtml(a.detail)}</div>
      ${quoteHtml}
      <div class="long-press-hint muted">long-press to ${isHabit ? 'remove from' : 'commit as'} daily habit</div>
    </li>`;
}

async function toggleHabitForAction(problemId: string, actionId: string, row: HTMLElement): Promise<void> {
  if (!currentOverview) return;
  const p = currentOverview.problems.find(p => p.id === problemId);
  const a = p?.actions.find(a => a.id === actionId);
  if (!a) return;

  if (await isHabit(actionId)) {
    await unfavoriteHabit(actionId);
    await markDirty('habit', actionId);
    schedulePush();
    row.classList.remove('is-habit');
    log(`[HABITS] removed: ${a.title}`);
  } else {
    const fq = lockedQuoteByAction.get(actionId);
    await favoriteAsHabit({
      actionId,
      title: a.title,
      detail: a.detail,
      source: a.source,
      themes: a.themes,
      tagHints: a.tagHints,
      quote: fq ? { text: fq.q.text, source: fq.q.source || fq.tradition, philName: fq.phil } : null,
    });
    await markDirty('habit', actionId);
    schedulePush();
    row.classList.add('is-habit');
    log(`[HABITS] committed: ${a.title}`);
  }
  // Re-render the title chrome (flame on/off)
  const titleEl = row.querySelector<HTMLElement>('.action-title');
  if (titleEl) {
    const isNow = row.classList.contains('is-habit');
    titleEl.innerHTML = `${escapeHtml(a.title)}${isNow ? ' <span class="habit-flame" title="Favorited as a daily habit">🔥</span>' : ''}`;
  }
  const hint = row.querySelector<HTMLElement>('.long-press-hint');
  if (hint) hint.textContent = `long-press to ${row.classList.contains('is-habit') ? 'remove from' : 'commit as'} daily habit`;
  await renderHabits();
}

/** Pointer-down + 600ms timer = long-press; cancels on early up/move. */
function attachLongPress(el: HTMLElement, handler: () => void, ms: number = 600): void {
  let timer: number | null = null;
  let fired = false;
  const clear = () => { if (timer != null) { clearTimeout(timer); timer = null; } };
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;  // left/touch only
    fired = false;
    clear();
    timer = window.setTimeout(() => {
      fired = true;
      try { (navigator as any).vibrate?.(20); } catch {}
      handler();
    }, ms);
  });
  el.addEventListener('pointerup', () => clear());
  el.addEventListener('pointercancel', () => clear());
  el.addEventListener('pointermove', (ev) => {
    // Cancel long-press if user starts scrolling (>10px)
    if (Math.abs(ev.movementX) + Math.abs(ev.movementY) > 8) clear();
  });
  el.addEventListener('contextmenu', (ev) => { if (fired) ev.preventDefault(); });
}

function closeProblemModal(): void {
  const modal = $('problem-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  activeProblemId = null;
}

// ─── TODAY CARD (Home tab) ───────────────────────────────────────────
// Compact "what's already happened today" card — tap it to jump to the
// Journal tab with today selected. Updates whenever Home reopens or a
// new session lands.
// ── Today's Quote card — Android-parity featured quote ──
const TQ_RARITY_COLOR: Record<string, string> = {
  legendary: '#d4af37', epic: '#a78bfa', rare: '#60a5fa', uncommon: '#4ade80', common: '#8a8a99',
};
let tqPool: { text: string; source: string; philName: string; rarity: Rarity }[] = [];
function buildTqPool(): void {
  if (tqPool.length) return;
  for (const p of PHILOSOPHERS) {
    for (const q of p.quotes) {
      if ((q.rating || 0) >= 8) {
        tqPool.push({ text: q.text, source: q.source, philName: p.name, rarity: getRarity(q.rating) });
      }
    }
  }
}
function renderTodayQuote(shuffle = false): void {
  buildTqPool();
  if (!tqPool.length) return;
  const now = new Date();
  const doy = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const idx = shuffle ? Math.floor(Math.random() * tqPool.length) : doy % tqPool.length;
  const q = tqPool[idx];
  const textEl = document.getElementById('tq-text');
  const attrEl = document.getElementById('tq-attr');
  const rarEl = document.getElementById('tq-rarity');
  if (textEl) textEl.textContent = '\u201C' + tQuote(q.text) + '\u201D';
  if (attrEl) attrEl.textContent = '\u2014 ' + q.philName + ' \u00B7 ' + q.source;
  if (rarEl) {
    rarEl.textContent = getRaritySymbol(q.rarity) + ' ' + String(q.rarity).toUpperCase();
    rarEl.style.color = TQ_RARITY_COLOR[String(q.rarity)] || 'var(--dim)';
  }
}

async function renderTodayCard(): Promise<void> {
  const card = $('today-card');
  const body = $('today-body');
  const empty = $('today-empty');
  if (!card || !body || !empty) return;

  const journal = await loadJournal();
  const todayKeyStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();
  const todays = journal.filter(s => s.date === todayKeyStr).sort((a, b) => a.startTs - b.startTs);

  if (todays.length === 0) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const totalTurns = todays.reduce((sum, s) => sum + s.exchanges.length, 0);
  const userTurns = todays.reduce((sum, s) => sum + s.exchanges.filter(m => m.role === 'user').length, 0);
  const philsCount = new Map<string, number>();
  for (const s of todays) philsCount.set(s.philName, (philsCount.get(s.philName) || 0) + 1);
  const last = todays[todays.length - 1];
  const lastTime = new Date(last.endTs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const minsAgo = Math.max(1, Math.round((Date.now() - last.endTs) / 60000));
  const ago = minsAgo < 60 ? `${minsAgo}m ago` : minsAgo < 1440 ? `${Math.round(minsAgo/60)}h ago` : 'earlier today';

  // Pull today's actions count
  let actionsCount = 0;
  try {
    const items = await loadActionItems();
    actionsCount = items.filter(it => it.date === todayKeyStr).length;
  } catch {}

  body.innerHTML = `
    <div class="today-stats">
      <div class="today-stat"><div class="v">${todays.length}</div><div class="k">session${todays.length === 1 ? '' : 's'}</div></div>
      <div class="today-stat"><div class="v">${philsCount.size}</div><div class="k">philosopher${philsCount.size === 1 ? '' : 's'}</div></div>
      <div class="today-stat"><div class="v">${userTurns}</div><div class="k">turns</div></div>
      <div class="today-stat"><div class="v">${actionsCount}</div><div class="k">action${actionsCount === 1 ? '' : 's'}</div></div>
    </div>
    <div class="today-last">
      <span class="today-last-label">Last:</span>
      <span class="today-last-phil">${escapeHtml(last.philName)}</span>
      <span class="today-last-time">${lastTime} · ${ago}</span>
    </div>
    <div class="today-cta muted">Tap to open today's journal →</div>
  `;
  // Card click → jump to journal tab and select today
  card.onclick = () => {
    const journalBtn = document.querySelector<HTMLElement>('.tab-btn[data-tab="journal"]');
    journalBtn?.click();
    // After the journal tab refreshes, click today's cell
    setTimeout(() => {
      const todayCell = document.querySelector<HTMLElement>(`.cal-cell[data-date="${todayKeyStr}"]`);
      todayCell?.click();
    }, 80);
  };
}

// ─── HABITS CARD + DAILY CHECK-IN ───────────────────────────────────
// Habits card sits on the Home tab below the weekly overview. It lists
// active habits with their streak count + the philosopher's sprite.
// On dashboard boot we also surface a check-in modal if the user has
// any habits whose last check-in was older than yesterday. Each habit
// row in the modal shows the philosopher's face and asks "did you
// [habit] yesterday?" — yes / no / skip. Streaks live locally and,
// when the glasses are linked, sync to the account via device_sync
// (enkiSync.ts). This is the Solo-Leveling daily-quest layer.

// ─── TODAY'S 1-3-5 CHECKLIST PANEL ────────────────────────────────
// Cockpit on the Home tab. Three buckets (1 BIG / 3 MEDIUM / 5 SMALL)
// each rendered as <ul>; a dashed "+ add" button per bucket reveals an
// inline form. All metadata lenses (size/domain/quadrant/controlAxis)
// live on the same ChecklistItem object — for v1 we only surface
// title + size + domain + quadrant + control axis at add-time.
// Reflection loop, quote attachment, and calendar integration come
// in follow-up steps once this foundation is solid.

async function initChecklistPanel(): Promise<void> {
  const card = $('today-checklist');
  if (!card) return;

  // Wire each bucket's "+ add" toggle once. The form hides itself after
  // a successful save and on cancel.
  card.querySelectorAll<HTMLElement>('.checklist-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const size = (btn.dataset.size || 'medium') as Size;
      const form = card.querySelector<HTMLElement>(`.checklist-add-form[data-size="${size}"]`);
      if (!form) return;
      const isOpen = !form.hidden;
      // Close all other forms first so only one is open at a time
      card.querySelectorAll<HTMLElement>('.checklist-add-form').forEach(f => f.hidden = true);
      if (isOpen) return;                  // toggle off
      renderChecklistForm(form, size);
    });
  });

  await renderChecklist();
}

/** Render the inline add-form for a given size bucket. */
function renderChecklistForm(form: HTMLElement, size: Size): void {
  form.hidden = false;
  form.innerHTML = `
    <input type="text" class="cl-add-title" placeholder="${
      size === 'big' ? 'Your one heavyweight…' :
      size === 'medium' ? 'A substantial block…' :
      'A quick win…'
    }" autocomplete="off" maxlength="160" />
    <div class="checklist-add-form-row">
      <select class="cl-add-domain" aria-label="domain">
        ${DOMAINS.map(d => `<option value="${d}">${d}</option>`).join('')}
      </select>
      <select class="cl-add-quadrant" aria-label="quadrant">
        ${CHECKLIST_QUADRANTS.map(q => {
          const labels: Record<string, string> = {
            Q1: 'Q1 · do first', Q2: 'Q2 · schedule',
            Q3: 'Q3 · ask a philosopher', Q4: 'Q4 · question it',
          };
          return `<option value="${q}" ${q === 'Q2' ? 'selected' : ''}>${labels[q]}</option>`;
        }).join('')}
      </select>
      <select class="cl-add-control" aria-label="control axis">
        ${CONTROL_AXES.map(c => {
          const labels: Record<string, string> = {
            within: 'within control', influence: 'can influence', release: 'release',
          };
          return `<option value="${c}" ${c === 'within' ? 'selected' : ''}>${labels[c]}</option>`;
        }).join('')}
      </select>
    </div>
    <div class="checklist-add-form-actions">
      <button class="cl-add-cancel" type="button">cancel</button>
      <button class="cl-add-save primary" type="button">add</button>
    </div>
  `;

  const titleInput = form.querySelector<HTMLInputElement>('.cl-add-title');
  const domainSel = form.querySelector<HTMLSelectElement>('.cl-add-domain');
  const quadSel = form.querySelector<HTMLSelectElement>('.cl-add-quadrant');
  const ctrlSel = form.querySelector<HTMLSelectElement>('.cl-add-control');
  const cancelBtn = form.querySelector<HTMLButtonElement>('.cl-add-cancel');
  const saveBtn = form.querySelector<HTMLButtonElement>('.cl-add-save');

  setTimeout(() => titleInput?.focus(), 30);  // post-paint focus

  cancelBtn?.addEventListener('click', () => { form.hidden = true; });

  const submit = async () => {
    const title = (titleInput?.value || '').trim();
    if (!title) { titleInput?.focus(); return; }
    if (saveBtn) saveBtn.disabled = true;
    try {
      const created = await addItem({
        title,
        size,
        domain: (domainSel?.value || 'Other') as Domain,
        quadrant: (quadSel?.value || 'Q2') as ChecklistQuadrant,
        controlAxis: (ctrlSel?.value || 'within') as ControlAxis,
        source: 'manual',
      });
      await markDirty('checklist_item', created.id);
      schedulePush();
      form.hidden = true;
      await renderChecklist();
    } catch (e) {
      console.error('[CHECKLIST] add failed', e);
      if (saveBtn) saveBtn.disabled = false;
    }
  };

  saveBtn?.addEventListener('click', submit);
  titleInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
    if (ev.key === 'Escape') { form.hidden = true; }
  });
}

/** Pull today's items from storage and re-render the three buckets. */
async function renderChecklist(): Promise<void> {
  const items = await loadToday();
  const big    = items.filter(it => it.size === 'big');
  const medium = items.filter(it => it.size === 'medium');
  const small  = items.filter(it => it.size === 'small');

  renderChecklistBucket('big', big, 1);
  renderChecklistBucket('medium', medium, 3);
  renderChecklistBucket('small', small, 5);

  const progress = $('checklist-progress');
  if (progress) {
    const done = items.filter(it => it.completed).length;
    progress.textContent = items.length === 0 ? '— / —' : `${done} / ${items.length}`;
  }

  // Keep the glasses' Home glance line in step with the cockpit.
  updateGlance().catch(() => {});
}

function renderChecklistBucket(size: Size, items: ChecklistItem[], cap: number): void {
  const list = $(`checklist-${size}`);
  const addBtn = document.querySelector<HTMLButtonElement>(`.checklist-add[data-size="${size}"]`);
  if (!list) return;

  // Soft cap — disable the +add button when full but don't hide rows the
  // user already created above the cap.
  if (addBtn) {
    addBtn.disabled = items.length >= cap;
    addBtn.textContent = items.length >= cap
      ? `${size} bucket full (${items.length}/${cap})`
      : `+ add a ${size === 'big' ? 'big focus' : size === 'medium' ? 'medium task' : 'small win'}`;
  }

  if (items.length === 0) {
    list.innerHTML = `<li class="checklist-empty">— nothing yet —</li>`;
    return;
  }
  list.innerHTML = items.map(it => renderChecklistRow(it)).join('');
  // Wire row event delegation
  list.querySelectorAll<HTMLElement>('.checklist-row').forEach(row => {
    const id = row.dataset.id || '';
    const date = row.dataset.date || '';
    if (!id || !date) return;
    row.querySelector<HTMLElement>('.checklist-check')?.addEventListener('click', async () => {
      const isChecked = row.classList.contains('is-done');
      try {
        if (isChecked) await uncompleteItem(date, id);
        else           await completeItem(date, id);
        await markDirty('checklist_item', id);
        schedulePush();
        await renderChecklist();
      } catch (e) { console.error('[CHECKLIST] toggle failed', e); }
    });
    row.querySelector<HTMLElement>('.checklist-delete')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        await captureChecklistDelete(date, id);   // tombstone BEFORE the row vanishes
        await deleteItem(date, id);
        schedulePush();
        await renderChecklist();
      }
      catch (e) { console.error('[CHECKLIST] delete failed', e); }
    });
  });
}

function renderChecklistRow(it: ChecklistItem): string {
  // Domain stripe color: reuse weekly's CATEGORY_HUE, fall back to gold
  const stripe = (CATEGORY_HUE as any)[it.domain] || '#d6c45a';
  const checkChar = it.completed ? '✓' : '';
  const titleSafe = escapeHtml(it.title);
  return `
    <li class="checklist-row${it.completed ? ' is-done' : ''}"
        data-id="${it.id}" data-date="${it.date}"
        style="border-left-color: ${stripe};">
      <div class="checklist-check${it.completed ? ' is-checked' : ''}"
           role="checkbox" aria-checked="${it.completed}" tabindex="0">${checkChar}</div>
      <div class="checklist-title" title="${titleSafe}">${titleSafe}</div>
      <span class="checklist-domain-mini">${it.domain}</span>
      <span class="checklist-q-badge q-${it.quadrant.toLowerCase()}">${it.quadrant}</span>
      <button class="checklist-delete" type="button" aria-label="delete">×</button>
    </li>
  `;
}

async function renderHabits(): Promise<void> {
  const list = $('habit-list');
  const empty = $('habits-empty');
  const count = $('habit-count');
  if (!list || !empty || !count) return;
  const habits = await listHabits();
  count.textContent = habits.length === 0 ? '' : `${habits.length}`;
  // Streaks feed the glasses' Home glance line — keep it fresh.
  updateGlance().catch(() => {});
  if (habits.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = habits.map(h => renderHabitRow(h)).join('');
}

function renderHabitRow(h: Habit): string {
  const sprite = habitSpritePath(h, h.streak >= 1 ? 'compassion' : (h.history.length > 0 ? 'sorrow' : 'contemplation'));
  const sh = streakHealth(h);
  const flameCount = Math.min(3, Math.max(0, Math.floor(h.streak / 3) + (h.streak >= 1 ? 1 : 0)));
  const flames = '🔥'.repeat(flameCount);
  return `
    <li class="habit-row tone-${sh.tone}" data-hid="${escapeAttr(h.id)}">
      <div class="habit-sprite">
        ${sprite ? `<img src="./sprites/${sprite}" alt="${escapeAttr(h.philName)}" loading="lazy" onerror="this.style.display='none'"/>` : `<span class="habit-sprite-fallback">${escapeHtml(h.philName.charAt(0) || '·')}</span>`}
      </div>
      <div class="habit-info">
        <div class="habit-title">${escapeHtml(h.title)}</div>
        <div class="habit-meta">
          <span class="habit-source">${escapeHtml(h.philName)}</span>
          <span class="habit-streak">${flames} ${escapeHtml(sh.label)}</span>
          ${h.bestStreak > h.streak && h.bestStreak >= 3 ? `<span class="habit-best">best: ${h.bestStreak}</span>` : ''}
        </div>
      </div>
    </li>`;
}

async function maybeShowDailyCheckIn(): Promise<void> {
  const pending = await pendingCheckIns();
  if (pending.length === 0) return;
  showCheckInModal(pending);
}

function showCheckInModal(pending: PendingCheckIn[]): void {
  const modal = $('checkin-modal');
  const list = $('checkin-list');
  const subtitle = $('checkin-subtitle');
  if (!modal || !list || !subtitle) return;

  const yesterdayLabel = new Date(pending[0].forDate + 'T00:00:00')
    .toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  subtitle.textContent = `${yesterdayLabel} — your check-in`;

  list.innerHTML = pending.map(p => {
    const sprite = habitSpritePath(p.habit, 'teaching');
    return `
      <li class="checkin-row" data-hid="${escapeAttr(p.habit.id)}" data-date="${p.forDate}">
        <div class="checkin-sprite">
          ${sprite ? `<img src="./sprites/${sprite}" alt="${escapeAttr(p.habit.philName)}" onerror="this.style.display='none'"/>` : `<span class="habit-sprite-fallback">${escapeHtml(p.habit.philName.charAt(0))}</span>`}
        </div>
        <div class="checkin-body">
          <div class="checkin-q">${escapeHtml(p.habit.philName)} asks: did you <strong>${escapeHtml(p.habit.title)}</strong> yesterday?</div>
          ${p.habit.quote ? `<div class="checkin-quote">"${escapeHtml(p.habit.quote.text)}"<span class="q-attrib">— ${escapeHtml(p.habit.quote.philName)}, ${escapeHtml(p.habit.quote.source)}</span></div>` : ''}
          <div class="checkin-actions">
            <button class="btn btn-primary checkin-yes" data-status="done">Yes</button>
            <button class="btn checkin-no" data-status="missed">Not yesterday</button>
            <button class="btn checkin-skip" data-status="skipped">Skip</button>
          </div>
          <div class="checkin-result" style="display:none"></div>
        </div>
      </li>`;
  }).join('');

  // Wire row buttons
  list.querySelectorAll<HTMLElement>('.checkin-row').forEach(row => {
    const hid = row.dataset.hid || '';
    const date = row.dataset.date || '';
    row.querySelectorAll<HTMLButtonElement>('button[data-status]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const status = btn.dataset.status as HabitStatus;
        await recordCheckIn(hid, status, date);
        await markDirty('habit', hid);
        schedulePush();
        // Replace buttons with a small result line
        row.querySelectorAll<HTMLElement>('.checkin-actions button').forEach(b => (b as HTMLButtonElement).disabled = true);
        const result = row.querySelector<HTMLElement>('.checkin-result');
        if (result) {
          const word = status === 'done' ? 'Logged ✓' : status === 'missed' ? 'Streak reset' : 'Skipped';
          result.textContent = word;
          result.style.display = 'block';
        }
        await renderHabits();
        // If every row answered, auto-close after a short delay
        const remaining = list.querySelectorAll('.checkin-row .checkin-actions button:not([disabled])').length;
        if (remaining === 0) setTimeout(() => closeCheckInModal(), 900);
      });
    });
  });

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function closeCheckInModal(): void {
  const modal = $('checkin-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

// ── attribute + CSS-attribute-selector helpers (escapeHtml already
//    exists in this file at line ~413) ──
function escapeAttr(s: string): string { return escapeHtml(s); }
function cssEscape(s: string): string {
  // Minimal CSS attribute-value escape: covers what stable kebab-case ids need.
  return s.replace(/["\\]/g, '\\$&');
}

// ─── USER PROFILE PANEL ──────────────────────────────────────────
async function initProfilePanel(): Promise<void> {
  // Populate language dropdown
  const langSel = $('prof-language') as HTMLSelectElement | null;
  if (langSel) {
    langSel.innerHTML = LANGUAGES.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
  }

  await renderProfileForm();

  $('btn-save-profile')?.addEventListener('click', async () => {
    await saveProfileFromForm();
  });
  $('btn-reset-profile')?.addEventListener('click', async () => {
    if (!confirm('Reset profile to defaults? Your habits, journal, and weekly plans are kept.')) return;
    const fresh: UserProfile = {
      name: '', language: 'en', languageLabel: 'English', pronouns: '',
      lifeContext: { role: '', currentFocus: '', challenges: [], values: [] },
      preferences: { adviceStyle: 'mixed', tone: 'mixed', replyLength: 'mixed' },
      guidelines: [],
      createdAt: Date.now(), updatedAt: Date.now(), version: 1,
    };
    await saveProfile(fresh);
    await renderProfileForm();
    flashSavedBadge();
  });
}

async function renderProfileForm(): Promise<void> {
  const p = await loadProfile();
  const set = (id: string, val: string) => { const el = $(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null; if (el) el.value = val; };
  set('prof-name', p.name);
  set('prof-pronouns', p.pronouns || '');
  set('prof-language', p.language);
  set('prof-role', p.lifeContext.role);
  set('prof-focus', p.lifeContext.currentFocus);
  set('prof-challenges', p.lifeContext.challenges.join(', '));
  set('prof-values', p.lifeContext.values.join(', '));
  set('prof-advice-style', p.preferences.adviceStyle);
  set('prof-tone', p.preferences.tone);
  set('prof-guidelines', p.guidelines.join('\n'));
}

async function saveProfileFromForm(): Promise<void> {
  const get = (id: string) => (($(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value || '').trim();
  const splitCSV = (s: string, max: number = 5) => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, max);
  const splitLines = (s: string, max: number = 20) => s.split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, max);
  const langCode = get('prof-language') || 'en';
  const langLabel = LANGUAGES.find(l => l.code === langCode)?.label || 'English';
  const profile: UserProfile = {
    name: get('prof-name'),
    language: langCode,
    languageLabel: langLabel,
    pronouns: get('prof-pronouns'),
    lifeContext: {
      role: get('prof-role'),
      currentFocus: get('prof-focus'),
      challenges: splitCSV(get('prof-challenges')),
      values: splitCSV(get('prof-values')),
    },
    preferences: {
      adviceStyle: (get('prof-advice-style') as any) || 'mixed',
      tone: (get('prof-tone') as any) || 'mixed',
      replyLength: 'mixed',   // reply-length control removed from settings; model keeps a neutral default
    },
    guidelines: splitLines(get('prof-guidelines')),
    createdAt: (await loadProfile()).createdAt,
    updatedAt: Date.now(),
    version: 1,
  };
  await saveProfile(profile);
  flashSavedBadge();
  log(`[PROFILE] saved · lang=${langCode} · name=${profile.name || '(none)'}`);
}

function flashSavedBadge(): void {
  const b = $('profile-saved-badge');
  if (!b) return;
  b.textContent = '✓ saved';
  setTimeout(() => { if (b) b.textContent = ''; }, 1800);
}

// ─── HEADER ACCOUNT CHIP ──────────────────────────────────────────
// When linked: "@handle ◈ SAGE" (gold) / "@handle SEEKER" (dim) in the
// masthead row. Hidden when unlinked — the About tab owns the pairing CTA.
async function renderHeaderAccount(): Promise<void> {
  const host = $('header-account');
  if (!host) return;
  const handle = await linkedHandle();
  if (!handle) { host.style.display = 'none'; host.innerHTML = ''; return; }
  const tier = ((await linkedTier()) || 'seeker').toLowerCase();
  const isSage = tier === 'sage';
  host.style.display = '';
  host.innerHTML = `@${escapeHtml(handle)} <span class="tier-chip ${isSage ? 'sage' : ''}">${isSage ? '◈ SAGE' : escapeHtml(tier.toUpperCase())}</span>`;
}

// ─── APHORICA — the commons (read + vote; compose is a HANDOFF) ────
// Same community feed the web + Android show, via /api/aphorica/supafeed.
// Voting needs the pairing token; unlinked taps get a link-your-glasses
// hint. Composing always hands off to enkiridion.com (translation spec).
const APH_FEED_URL = 'https://sophicon-api.vercel.app/api/aphorica/supafeed';
const APH_VOTE_URL = 'https://sophicon-api.vercel.app/api/aphorica/vote';

interface AphPost {
  id: string; text: string; tradition: string; emotion: string;
  archetype: string; rarity: string; stars: number;
  upvotes: number; downvotes: number; createdAt: string | number;
  author: { handle: string; tier: string; spritePath: string | null };
  myVote: number | null;
}

let aphSort: 'hot' | 'new' = 'hot';
let aphPosts: AphPost[] = [];
let aphLoading = false;

function aphHint(msg: string): void {
  const el = $('aph-hint');
  if (!el) return;
  el.textContent = msg;
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3200);
}

function aphSpriteUrl(p: string | null): string | null {
  if (!p) return null;
  if (/^https?:\/\//.test(p)) return p;
  return spriteUrl(p.replace(/^\/?sprites\//, ''));
}

function rarityGlyph(r: string): string {
  const known: Rarity[] = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
  const v = String(r || '').toLowerCase() as Rarity;
  return known.includes(v) ? getRaritySymbol(v) : '·';
}

async function refreshAphorica(): Promise<void> {
  const list = $('aph-list');
  const empty = $('aph-empty');
  const count = $('aph-count');
  if (!list || aphLoading) return;
  aphLoading = true;
  if (aphPosts.length === 0) list.innerHTML = '<li class="muted" style="padding:8px 2px;">Loading the commons…</li>';
  try {
    const resp = await fetch(`${APH_FEED_URL}?sort=${aphSort}&limit=50`, {
      headers: { ...(await authHeaders()) },
    });
    if (!resp.ok) throw new Error(`supafeed ${resp.status}`);
    const data = await resp.json();
    aphPosts = Array.isArray(data.posts) ? data.posts : [];
    if (count) count.textContent = `${aphPosts.length}`;
    renderAphList();
    if (empty) empty.style.display = aphPosts.length === 0 ? 'block' : 'none';
  } catch (e) {
    list.innerHTML = `<li style="color:var(--err);font-size:12px;padding:8px 2px;">Couldn't reach the commons: ${escapeHtml(String((e as any)?.message || e))}</li>`;
  } finally {
    aphLoading = false;
  }
}

function aphPostHtml(p: AphPost): string {
  const tier = String(p.author?.tier || 'seeker').toLowerCase();
  const isSage = tier === 'sage';
  const sprite = aphSpriteUrl(p.author?.spritePath || null);
  const meta = [p.tradition, p.emotion, p.archetype].filter(Boolean)
    .map(x => escapeHtml(String(x).replace(/_/g, ' '))).join(' · ');
  return `
    <li class="aph-post" data-aid="${escapeAttr(p.id)}">
      <div class="aph-post-head">
        ${sprite ? `<img class="aph-author-sprite" src="${sprite}" alt="" onerror="this.style.display='none'"/>` : ''}
        <span class="aph-handle">@${escapeHtml(p.author?.handle || 'anon')}</span>
        <span class="tier-chip ${isSage ? 'sage' : ''}">${isSage ? '◈ SAGE' : escapeHtml(tier.toUpperCase())}</span>
        <span class="aph-rarity" title="${escapeAttr(p.rarity || '')}">${rarityGlyph(p.rarity)}</span>
      </div>
      <div class="aph-text">"${escapeHtml(p.text || '')}"</div>
      ${meta ? `<div class="aph-meta">${meta}</div>` : ''}
      <div class="aph-votes">
        <button class="aph-vote up ${p.myVote === 1 ? 'mine' : ''}" data-v="1">♥ ${p.upvotes || 0}</button>
        <button class="aph-vote down ${p.myVote === -1 ? 'mine' : ''}" data-v="-1">▼ ${p.downvotes || 0}</button>
        <button class="aph-keep ${hasWisdomEntry('post', p.text || '') ? 'kept' : ''}" title="Keep in your journal">${hasWisdomEntry('post', p.text || '') ? '★ kept' : '☆ keep'}</button>
      </div>
    </li>`;
}

function wireAphVotes(container: HTMLElement, after?: () => void): void {
  container.querySelectorAll<HTMLElement>('.aph-post').forEach(row => {
    const aid = row.dataset.aid || '';
    row.querySelectorAll<HTMLButtonElement>('.aph-vote').forEach(btn => {
      btn.addEventListener('click', () => voteAphorism(aid, Number(btn.dataset.v) as 1 | -1).then(() => after?.()));
    });
    // Keep = PRIVATE save into the wisdom log. Deliberately not gated
    // on an account: the vote is public and needs identity; keeping a
    // thought for yourself needs nothing. Free tier gets a working
    // bookmark; the calendar and Collected show it like any capture.
    row.querySelector<HTMLButtonElement>('.aph-keep')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const post = aphPosts.find(pp => pp.id === aid);
      if (!post || hasWisdomEntry('post', post.text || '')) return;
      const btn = ev.currentTarget as HTMLButtonElement;
      await addWisdomEntry('post', post.text || '', post.author?.handle || 'anon');
      btn.textContent = '★ kept';
      btn.classList.add('kept');
      aphHint('Kept — see Journal › Collected');
    });
  });
}

function renderAphList(): void {
  const list = $('aph-list');
  if (!list) return;
  list.innerHTML = aphPosts.map(aphPostHtml).join('');
  wireAphVotes(list);
}

/** Compact community preview on the Home tab — top posts with sprites + votes. */
async function renderAphHome(): Promise<void> {
  const list = $('aph-home-list');
  if (!list) return;
  try {
    if (aphPosts.length === 0) {
      const resp = await fetch(`${APH_FEED_URL}?sort=hot&limit=8`, { headers: { ...(await authHeaders()) } });
      if (resp.ok) { const data = await resp.json(); aphPosts = Array.isArray(data.posts) ? data.posts : []; }
    }
    const top = aphPosts.slice(0, 5);
    list.innerHTML = top.length
      ? top.map(aphPostHtml).join('')
      : '<li class="muted" style="padding:8px 2px;">No aphorisms yet — be the first to post one on the web.</li>';
    wireAphVotes(list, () => { renderAphHome(); renderAphList(); });
  } catch {
    list.innerHTML = '<li style="color:var(--err);font-size:12px;padding:8px 2px;">Couldn’t reach the commons.</li>';
  }
}

async function voteAphorism(aphorismId: string, dir: 1 | -1): Promise<void> {
  const handle = await linkedHandle();
  if (!handle) {
    // A hidden-tab hint reads as "voting is broken" when tapped from the
    // Home preview — surface the actionable sign-in gate instead (it has
    // the pairing CTA), plus the hint for the Aphorica-tab context.
    // Hint only — the overlay ambush made a tap on a heart feel like a
    // paywall slam. The About tab keeps the pairing CTA for when the
    // user goes looking.
    aphHint('Link your glasses to vote (About tab) — or ☆ keep it, no account needed');
    return;
  }
  const post = aphPosts.find(p => p.id === aphorismId);
  if (!post) return;
  const vote = post.myVote === dir ? 0 : dir;      // tap again = retract
  // Optimistic: apply locally first so the heart reacts instantly, then
  // reconcile with the server's authoritative counts (revert on failure).
  const prev = { myVote: post.myVote, up: post.upvotes, down: post.downvotes };
  if (prev.myVote === 1) post.upvotes = Math.max(0, post.upvotes - 1);
  if (prev.myVote === -1) post.downvotes = Math.max(0, post.downvotes - 1);
  if (vote === 1) post.upvotes += 1;
  if (vote === -1) post.downvotes += 1;
  post.myVote = vote;
  renderAphEverywhere();
  try {
    const resp = await fetch(APH_VOTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ aphorismId, vote }),
    });
    if (!resp.ok) throw new Error(`vote ${resp.status}`);
    const data = await resp.json();
    if (typeof data.upvotes === 'number') post.upvotes = data.upvotes;
    if (typeof data.downvotes === 'number') post.downvotes = data.downvotes;
    renderAphEverywhere();
  } catch (e) {
    post.myVote = prev.myVote;
    post.upvotes = prev.up;
    post.downvotes = prev.down;
    renderAphEverywhere();
    aphHint('Vote failed — try again');
    console.error('[APHORICA] vote failed', e);
  }
}

/** Votes show on the Aphorica tab AND the Home preview — repaint both so
 * an optimistic tap reacts wherever the user actually tapped. */
function renderAphEverywhere(): void {
  renderAphList();
  renderAphHome().catch(() => {});
}

function initAphoricaPanel(): void {
  $$('.aph-sort').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = (btn.getAttribute('data-sort') as 'hot' | 'new') || 'hot';
      if (s === aphSort) return;
      aphSort = s;
      $$('.aph-sort').forEach(b => b.classList.toggle('active', b === btn));
      aphPosts = [];
      refreshAphorica().catch(() => {});
    });
  });
}

// ─── SYNC STATUS (Debug tab) ──────────────────────────────────────
async function renderSyncStatus(): Promise<void> {
  const body = $('sync-status-body');
  const badge = $('sync-status-badge');
  if (!body) return;
  const s = await getSyncStatus();
  if (badge) badge.textContent = s.linkedHandle ? (s.syncing ? 'syncing…' : 'linked') : 'unlinked';
  const lastPull = s.lastPullMs
    ? `${new Date(s.lastPullMs).toLocaleTimeString(undefined, { hour12: false })} (${Math.max(0, Math.round((Date.now() - s.lastPullMs) / 60000))}m ago)`
    : 'never';
  body.innerHTML = `
    <div><span class="sync-k">Account</span><span class="sync-v">${s.linkedHandle ? '@' + escapeHtml(s.linkedHandle) : 'unlinked — local only'}</span></div>
    <div><span class="sync-k">Last pull</span><span class="sync-v">${s.linkedHandle ? lastPull : '—'}</span></div>
    <div><span class="sync-k">Pending pushes</span><span class="sync-v">${s.dirtyCount}</span></div>
    ${s.lastError ? `<div><span class="sync-k">Last error</span><span class="sync-err">${escapeHtml(s.lastError)}</span></div>` : ''}
  `;
}

function initSyncPanel(): void {
  $('btn-sync-now')?.addEventListener('click', async () => {
    await syncNow();
    await renderSyncStatus();
    await renderChecklist();
    await renderHabits();
  });
  $('btn-sync-refresh')?.addEventListener('click', () => renderSyncStatus().catch(() => {}));
}

// ─── PUBLIC ENTRY ─────────────────────────────────────────────────
export async function initDashboard(b: EvenAppBridge, base: string): Promise<void> {
  bridge = b;
  baseUrl = base;
  setWeeklyBridge(b);
  setHabitsBridge(b);
  setProfileBridge(b);
  setAccountBridge(b);
  setChecklistBridge(b);
  setSyncBridge(b);

  initTabs();
  initHomeStats();
  renderPhilosopherGrid();
  // Glass ♥ and phone ★ are the same store now — repaint Picks when
  // the other surface toggles (cheap: grid rerender only if mounted).
  onFavoritesChange(() => { try { renderPhilosopherGrid(); renderCollected(); renderCalendar(); } catch { /* not mounted */ } });
  onWisdomLogChange(() => { try { renderCollected(); renderCalendar(); } catch { /* not mounted */ } });
  initDebugPanel();
  initJournalPanel();
  initAphoricaPanel();
  initSyncPanel();
  await initMindfulPanel();
  await initSpeakCompose();
  await initSettings();
  await initProfilePanel();
  await renderHeaderAccount();
  await refreshJournal();
  // Problems auto-run on load — no button press needed once a journal exists.
  extractProblems(true).catch(() => {});
  await initWeeklyPanel();
  await renderHabits();
  await renderTodayCard();
  renderTodayQuote();
  document.getElementById('tq-refresh')?.addEventListener('click', () => renderTodayQuote(true));
  await initChecklistPanel();

  // Home: Public Aphorica Feed preview + "see all" → Aphorica tab.
  renderAphHome().catch(() => {});
  $('aph-home-all')?.addEventListener('click', () => switchTab('aphorica'));
  // Copy buttons (how-to links) — clipboard where available, else select-all.
  $$('.copy-btn').forEach(btn => btn.addEventListener('click', async () => {
    const url = btn.getAttribute('data-copy') || '';
    try { await navigator.clipboard.writeText(url); btn.textContent = 'Copied'; btn.classList.add('copied'); }
    catch { btn.textContent = 'Copied'; btn.classList.add('copied'); }
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1600);
  }));

  // Language first: every render below reads through t().
  initI18n();
  syncTabBarHeight();

  // Support the dev — pill on Home + the page behind it. No-ops entirely
  // when SUPPORT_URL is empty. The latch check catches a Support tap that
  // happened on the glasses while this webview was backgrounded.
  initSupport();
  consumeSupportLatch().catch(() => {});

  // Device-sync spine: pull the account's checklist/habits/weekly rows
  // on dashboard open, then re-render whatever a merge touched. Pure
  // no-op when unlinked — local seeker experience is never gated.
  onSyncApplied(() => {
    renderChecklist().catch(() => {});
    renderHabits().catch(() => {});
    loadAndRenderCurrentWeek().catch(() => {});
  });
  syncNow().catch(() => {});

  // Daily check-in modal — surfaces when the user has habits whose
  // last check-in is older than yesterday. Wire close affordance once.
  $('checkin-close')?.addEventListener('click', closeCheckInModal);
  $('checkin-modal')?.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).id === 'checkin-modal') closeCheckInModal();
  });
  await maybeShowDailyCheckIn();

  // First-run onboarding / sign-in gate (unlinked users): routes to Google
  // sign-in + the $8/mo trial on enkiridion.com, then pairing.
  await maybeShowOnboarding();

  // Subscribe to live glass-state updates; also refresh journal when
  // user exits speak-conversation (checkpoint just fired)
  let lastGlassPage = '';
  onGlassesStateChange((s) => {
    applyGlassState(s);
    // Any transition OUT of speak-conversation → journal likely changed.
    // Also refresh the Today card + Habits since both pull from the journal.
    if (s.page !== 'speak-conversation') {
      // Only re-distill problems on the actual EXIT edge (conversation just
      // checkpointed), not on every state tick outside a conversation.
      const justLeftConversation = lastGlassPage === 'speak-conversation';
      refreshJournal()
        .then(() => { if (justLeftConversation) return extractProblems(true); })
        .catch(() => {});
      renderTodayCard().catch(() => {});
      renderHabits().catch(() => {});
      // Glass just left a conversation — the shared thread may have grown.
      // Re-render the phone compose thread if it's showing that philosopher.
      if (speakActivePhil) renderSpeakThread(speakActivePhil).catch(() => {});
    }
    // The wearer may have tapped Support on-glass while this webview was
    // asleep; every state tick is a chance to notice the latch they left.
    consumeSupportLatch().catch(() => {});
    lastGlassPage = s.page || '';
  });
  // Deep-link: a #<tab> hash activates that tab on load (e.g. #speak, #philosophers).
  const deepTab = location.hash.replace('#', '').trim();
  if (deepTab) {
    setTimeout(() => document.querySelector<HTMLElement>(`.tab-btn[data-tab="${deepTab}"]`)?.click(), 600);
  }
  log('[DASHBOARD] Ready', 'success');
}

// ═══ SUPPORT THE DEV ═══════════════════════════════════════════════
// One pill on Home, one page behind it, one hosted checkout. The page
// has no .tab-btn, so the functions below are the only way in or out of
// it — and every one of them is gated on supportEnabled(), so an empty
// SUPPORT_URL hides the pill AND the page rather than shipping a button
// that goes nowhere.

/** Activate the Support panel. Deliberately NOT switchTab(): there is no
 *  tab button to click, so this clears the bar's active state by hand
 *  and toggles the panel directly. */
function openSupportPanel(): void {
  $$('.tab-btn').forEach(b => b.classList.remove('active'));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.getAttribute('data-panel') === 'support'));
  window.scrollTo({ top: 0 });
}

/** How long a latch set on the glasses stays live. Long enough to survive
 *  a walk home with the phone in a pocket; short enough that opening the
 *  dashboard days later doesn't ambush anyone with a tip jar. */
const SUPPORT_LATCH_TTL_MS = 15 * 60 * 1000;

/** Consume the on-glass latch if one is waiting and still fresh.
 *  Nothing on the glasses can foreground this webview, so tapping
 *  Support on-glass leaves a note here instead; this is where it lands. */
async function consumeSupportLatch(): Promise<void> {
  if (!bridge || !supportEnabled()) return;
  let raw = '';
  try { raw = (await bridge.getLocalStorage(SUPPORT_LATCH_KEY)) || ''; } catch { return; }
  if (!raw) return;
  // Clear first: a latch that fails to open should still never re-fire.
  try { await bridge.setLocalStorage(SUPPORT_LATCH_KEY, ''); } catch { /* best effort */ }
  const at = Number(raw);
  if (!Number.isFinite(at) || Date.now() - at > SUPPORT_LATCH_TTL_MS) return;
  openSupportPanel();
  log('[SUPPORT] opened from glasses', 'success');
}

/** Display form: 8 characters from each end — enough to eyeball against
 *  your wallet before sending. The FULL string is what gets copied; this
 *  shortening is cosmetic and must never reach a clipboard or a QR. */
function shortAddr(addr: string): string {
  return addr.length <= 20 ? addr : `${addr.slice(0, 8)}…${addr.slice(-8)}`;
}

/** Clipboard write with a fallback path.
 *
 * navigator.clipboard requires a SECURE CONTEXT, and the Even App
 * webview is not guaranteed to be one — on a plain http:// origin the
 * API is either absent or its promise rejects. A tip address that
 * silently fails to copy is indistinguishable from a broken app, so
 * both the missing-API case and the rejection case fall through to the
 * legacy execCommand path rather than doing nothing.
 *
 * Returns true if either path reported success. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through — the rejection path matters as much as the absent-API one */ }
  return legacyCopy(text);
}

/** execCommand('copy') via an off-screen textarea. Deprecated, still the
 *  only thing that works in a non-secure webview. */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // Off-screen but still selectable; display:none would break selection.
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);   // iOS needs the explicit range
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function renderSupportCrypto(): void {
  const wrap = $('support-crypto');
  const list = $('support-crypto-list');
  if (!wrap || !list) return;
  const rows = activeCrypto();
  if (rows.length === 0) { wrap.hidden = true; return; }   // gated: nothing filled in yet
  wrap.hidden = false;
  list.innerHTML = '';
  for (const c of rows) {
    const li = document.createElement('li');

    // The WHOLE pill is the button, not a label with a small Copy target
    // beside it. One address, one tap area — nothing to miss on a phone.
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'tippill';
    // Full address on the element: data-copy is what gets written to the
    // clipboard, title is the hover/long-press reveal. Only the SPAN is
    // ever truncated.
    pill.setAttribute('data-copy', c.address);
    pill.title = c.address;
    pill.setAttribute('aria-label', `${c.label} — ${t('support.copy')}`);

    const chain = document.createElement('span');
    chain.className = 'tp-chain';
    chain.textContent = c.label;

    const addr = document.createElement('span');
    addr.className = 'tp-addr';
    addr.textContent = shortAddr(c.address);

    const act = document.createElement('span');
    act.className = 'tp-act';
    act.textContent = t('support.copy');

    pill.addEventListener('click', async () => {
      // Copy the FULL address from data-copy, never the elided display.
      const ok = await copyText(pill.getAttribute('data-copy') || '');
      // Feedback lands on the pill itself — no toast to miss or mis-time.
      act.textContent = ok ? t('support.copied') : t('support.copyFailed');
      pill.classList.add(ok ? 'copied' : 'copyfail');
      setTimeout(() => {
        act.textContent = t('support.copy');
        pill.classList.remove('copied', 'copyfail');
      }, 1600);
    });

    pill.append(chain, addr, act);
    li.appendChild(pill);
    list.appendChild(li);
  }
}

function renderSupportPage(): void {
  const hook = $('support-hook'); if (hook) hook.textContent = t('story.hook');

  const cta = $('support-cta') as HTMLAnchorElement | null;
  if (cta) { cta.href = SUPPORT_URL; cta.textContent = t('support.cta'); }
  const note = $('support-cta-note'); if (note) note.textContent = t('support.ctaNote');
  const back = $('support-back');     if (back) back.textContent = t('support.back');
  const ch = $('support-crypto-head'); if (ch) ch.textContent = t('support.cryptoHead');

  // The opening — always visible, never behind a tap.
  const intro = $('support-intro');
  if (intro) {
    intro.innerHTML = '';
    for (let i = 1; i <= INTRO_COUNT; i++) {
      const p = document.createElement('p');
      p.textContent = t(`story.i${String(i).padStart(2, '0')}` as any);
      intro.appendChild(p);
    }
  }

  renderStoryStack();

  const signoff = $('support-signoff'); if (signoff) signoff.textContent = t('story.signName');
  const signrole = $('support-signrole'); if (signrole) signrole.textContent = t('story.signRole');
  renderSupportCrypto();
  applyBidiHints();
}

/**
 * The stacked story cards.
 *
 * Each section is a flush-stacked card whose title is a <button>;
 * pressing it drops that section open. Several can be open at once —
 * this is a story someone may want to read straight through, and an
 * accordion that closes the section you just read to open the next one
 * fights that.
 *
 * Height is animated via max-height rather than `height: auto` (which
 * doesn't transition), and set generously — the panels are text, so an
 * over-large max-height costs nothing visually and avoids measuring
 * every panel on every language change.
 */
function renderStoryStack(): void {
  const stack = $('story-stack');
  if (!stack) return;
  stack.innerHTML = '';

  STORY_SECTIONS.forEach((section, idx) => {
    const card = document.createElement('section');
    card.className = 'story-card';

    const panelId = `story-panel-${idx}`;
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'story-head';
    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-controls', panelId);

    const title = document.createElement('span');
    title.className = 'story-title';
    // Natural case in the dictionary; CSS uppercases it. Hand-uppercasing
    // would not survive translation — German nouns and Russian casing
    // rules make an all-caps source string wrong in the target.
    title.textContent = t(`${section.id}.t` as any);

    const chev = document.createElement('span');
    chev.className = 'story-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▾';

    head.append(title, chev);

    const panel = document.createElement('div');
    panel.className = 'story-panel';
    panel.id = panelId;
    const inner = document.createElement('div');
    inner.className = 'story-panel-inner';
    for (let i = 1; i <= section.paras; i++) {
      const p = document.createElement('p');
      p.textContent = t(`${section.id}.p${String(i).padStart(2, '0')}` as any);
      inner.appendChild(p);
    }
    panel.appendChild(inner);

    head.addEventListener('click', () => {
      const opening = !card.classList.contains('open');
      // One at a time: opening a section closes whichever was open. With
      // eight sections the page otherwise grows without bound and the
      // stack stops reading as a stack.
      stack.querySelectorAll('.story-card.open').forEach(other => {
        other.classList.remove('open');
        other.querySelector('.story-head')?.setAttribute('aria-expanded', 'false');
      });
      card.classList.toggle('open', opening);
      head.setAttribute('aria-expanded', opening ? 'true' : 'false');
      // Re-opened content can land off-screen when a taller section above
      // it just collapsed — bring the header back into view.
      if (opening) head.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    card.append(head, panel);
    stack.appendChild(card);
  });
  applyBidiHints();
}

function initSupport(): void {
  const pill = $('supportline');
  // The dead-button gate. With no destination there is nothing to show,
  // so the pill stays hidden and the page is never rendered or reachable.
  if (!supportEnabled()) { if (pill) pill.hidden = true; return; }

  const l1 = $('supportline-1'); if (l1) l1.textContent = PILL_LINE_1;
  const l2 = $('supportline-2'); if (l2) l2.textContent = PILL_LINE_2;
  if (pill) {
    pill.hidden = false;
    pill.addEventListener('click', openSupportPanel);
  }
  $('support-back')?.addEventListener('click', () => switchTab('home'));
  renderSupportPage();
}

// ═══ LANGUAGE ══════════════════════════════════════════════════════
// One choice drives three surfaces: this webapp, the glasses display,
// and the quote corpus. See src/i18n.ts for the loading model and for
// why Arabic is phone-only.

/** Repaint every string tagged `data-i18n="key"` in the static markup.
 *  Dynamic content re-renders through its own render function; this only
 *  covers what index.html declares. */
function applyTranslations(): void {
  $$('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key as any);
  });
}

function renderLangPicker(): void {
  const grid = $('lang-grid');
  const note = $('lang-note');
  if (!grid) return;
  grid.innerHTML = '';
  for (const l of LANGS) {
    const btn = document.createElement('button');
    btn.className = 'lang-btn' + (l.code === lang() ? ' active' : '');
    btn.type = 'button';

    const native = document.createElement('span');
    native.className = 'ln';
    native.textContent = l.native;
    const english = document.createElement('span');
    english.className = 'le';
    english.textContent = l.english;
    btn.append(native, english);

    // Say the caveat in the picker, not after the fact. A language that
    // cannot render on the HUD should never be a surprise.
    if (!l.onGlass) {
      const warn = document.createElement('span');
      warn.className = 'lg';
      warn.textContent = t('lang.phoneOnly');
      btn.appendChild(warn);
    }

    btn.addEventListener('click', async () => {
      await setLang(l.code as LangCode, bridge);
      log(`[LANG] → ${l.code}`, 'success');
    });
    grid.appendChild(btn);
  }
  if (note) {
    note.textContent = t('lang.phoneOnlyWhy');
    note.hidden = !isPhoneOnly();
  }
}

/** Everything that must repaint when the language changes. Glass pages
 *  repaint separately — events.ts owns that half. */
function onLanguageChanged(): void {
  applyTranslations();
  applyBidiHints();
  syncTabBarHeight();   // translated labels can change the bar's height
  renderLangPicker();
  renderSupportPage();
  renderTodayQuote();
  renderChecklist().catch(() => {});
  renderHabits().catch(() => {});
}

/** Main.ts calls initLang() before it builds the first glass page, so by
 *  the time the dashboard boots the tables are already loaded — this
 *  only paints and subscribes. */
function initI18n(): void {
  applyTranslations();
  renderLangPicker();
  onLangChange(onLanguageChanged);
}

// ═══ TAB BAR CLEARANCE ══════════════════════════════════════════════
/**
 * Publish the fixed tab bar's real height as --tabbar-h so #app can
 * reserve exactly enough bottom padding.
 *
 * A hardcoded 80px was clipping the Support pill on Android: the bar
 * adds env(safe-area-inset-bottom) for the system nav bar, and its
 * eight labels are translated, so a longer word (German "Tagebuch",
 * Russian "Дневник") can wrap a label and grow the bar. Measuring
 * covers both, plus rotation and font-scaling, without guessing.
 */
function syncTabBarHeight(): void {
  const bar = document.querySelector<HTMLElement>('.tab-bar');
  if (!bar) return;
  const apply = () => {
    const h = Math.ceil(bar.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--tabbar-h', `${h}px`);
  };
  apply();
  // Re-measure when the bar itself changes size: language switch,
  // rotation, dynamic type.
  if ('ResizeObserver' in window) new ResizeObserver(apply).observe(bar);
  window.addEventListener('orientationchange', () => setTimeout(apply, 150));
}
