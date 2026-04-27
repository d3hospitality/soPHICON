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
  Philosopher, Tradition, getPhilosophersByTradition, capitalize,
} from './constants';
import {
  onGlassesStateChange, GlassesState,
  startMindfulness, stopMindfulness, loadMindfulConfig, getMindfulConfig,
} from './events';
import { pushSprite, getSpritePushLog, clearSpriteCache } from './image-utils';
import { loadJournal, JournalSession, SpeakMessage } from './speak';
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
import {
  UserProfile, LANGUAGES, setProfileBridge, loadProfile, saveProfile,
} from './profile';
import { log } from './ui';

// ─── Handles we fill in initDashboard ─────────────────────────────
let bridge: EvenAppBridge | null = null;
let baseUrl = '';

// ─── Helpers ──────────────────────────────────────────────────────
function $(id: string): HTMLElement | null { return document.getElementById(id); }
function $$(sel: string): HTMLElement[] { return Array.from(document.querySelectorAll(sel)); }

function pageLabel(page: string): string {
  switch (page) {
    case 'home':                return 'Home — traditions';
    case 'philosophers':        return 'Philosophers';
    case 'mindstate':           return 'Mindstate';
    case 'quote':               return 'Quote';
    case 'speak-traditions':    return 'Speak — traditions';
    case 'speak-philosophers':  return 'Speak — philosophers';
    case 'speak-conversation':  return 'Conversation';
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
      if (tab === 'debug') refreshPushLog();
      if (tab === 'journal') refreshJournal().catch(() => {});
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

function applyGlassState(s: GlassesState): void {
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
        : (s.speakListening ? '● Listening' : '◦ Tap to speak (on glass)');
      speakMirror.innerHTML = `
        <div class="muted" style="font-size:12px; font-family: var(--mono); margin-bottom:6px;">${indicator}</div>
        <div style="font-size:13.5px; line-height:1.5;">
          ${s.speakPageIndex !== undefined && s.speakPageCount ? `<span class="muted">Page ${s.speakPageIndex + 1} / ${s.speakPageCount}</span>` : ''}
        </div>
      `;
    }
  } else if (speakBadge) {
    speakBadge.textContent = '— idle —';
    if (speakMirror) speakMirror.innerHTML = `<p class="muted">Nothing yet. Pick a philosopher → tap the glass → speak.</p>`;
  }
}

// ─── PHILOSOPHER GRID ─────────────────────────────────────────────
function renderPhilosopherGrid(): void {
  const host = $('phil-groups');
  if (!host) return;

  let html = '';
  for (const tradition of TRADITIONS) {
    const phils = getPhilosophersByTradition(tradition as Tradition);
    if (phils.length === 0) continue;
    html += `<div class="tradition-group">
      <div class="tradition-label">${tradition}</div>
      <div class="phil-grid">
        ${phils.map((p: Philosopher) => {
          // True emotion coverage = unique `emotion` values across all
          // quotes (not dominantEmotions, which is just the top-3 tags).
          const emotionCount = new Set(p.quotes.map(q => q.emotion)).size;
          return `
          <div class="phil-card" data-phil="${p.philId}">
            <img class="phil-card-sprite" src="${spriteUrl(`${p.philId}/${p.philId}-neutral.png`)}" alt="" onerror="this.style.display='none'" />
            <div class="phil-card-text">
              <div class="phil-card-name">${p.name}</div>
              <div class="phil-card-sub">${p.quotes.length} quotes · ${emotionCount} emotions</div>
            </div>
          </div>
        `;
        }).join('')}
      </div>
    </div>`;
  }
  host.innerHTML = html;

  // Clicking a philosopher card pushes their neutral sprite to the
  // debug portrait — useful to verify "is the glass actually showing
  // this?" without touching the ring. Non-destructive to ring flow.
  host.querySelectorAll('.phil-card').forEach(card => {
    card.addEventListener('click', async () => {
      const philId = card.getAttribute('data-phil');
      if (!philId || !bridge) return;
      host.querySelectorAll('.phil-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      try {
        await pushSprite(bridge, baseUrl, `${philId}/${philId}-neutral.png`, 1, 'portrait', 100, 100);
        log(`[DASHBOARD] Pushed ${philId}/neutral to portrait`, 'success');
      } catch (e) {
        log(`[DASHBOARD] Push failed: ${e}`, 'error');
      }
      refreshPushLog();
    });
  });
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
  const input = $('openai-key') as HTMLInputElement | null;
  const existing = await bridge.getLocalStorage('openai_key').catch(() => '');
  if (input && existing) input.value = '••••••••' + existing.slice(-4);

  $('btn-save-settings')?.addEventListener('click', async () => {
    if (!bridge) return;
    const val = input?.value || '';
    // Only save if user entered a new value (not the masked placeholder)
    if (val && !val.startsWith('•')) {
      await bridge.setLocalStorage('openai_key', val).catch(() => false);
      if (input) input.value = '••••••••' + val.slice(-4);
    }
    log('[DASHBOARD] Settings saved', 'success');
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
    const has = sessions.length > 0 ? ' has-sessions' : '';
    const active = key === selectedDate ? ' active' : '';
    const today = key === todayKey ? ' today' : '';
    const countText = sessions.length > 0 ? `${sessions.length}×` : '';
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
    cell.addEventListener('click', () => {
      const k = cell.dataset.date;
      if (!k || !byDate.has(k)) return;
      selectedDate = k;
      renderCalendar();
      renderSessionDetail(k, byDate.get(k) || []);
    });
  });
}

function renderSessionDetail(date: string, sessions: JournalSession[]): void {
  const host = $('session-detail');
  const badge = $('session-detail-badge');
  if (!host) return;
  if (badge) badge.textContent = `${date} · ${sessions.length} session${sessions.length === 1 ? '' : 's'}`;

  if (sessions.length === 0) {
    host.innerHTML = `<p class="muted">No exchanges on ${date}.</p>`;
    return;
  }

  const html = sessions.map(s => {
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
    return `<div class="mt-md">
      <div style="font-size:12px; color: var(--dim); font-family: var(--mono); margin-bottom: 6px;">
        ${s.philName} (${s.tradition}) · ${time} · ${s.exchanges.length} turn${s.exchanges.length === 1 ? '' : 's'}
      </div>
      ${turnsHtml}
    </div>`;
  }).join('');
  host.innerHTML = html;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] || c));
}

// ─── PROBLEMS (extracted via /api/problems) ───────────────────────
async function extractProblems(): Promise<void> {
  const host = $('problems-list');
  const count = $('problems-count');
  if (!host) return;
  if (journalCache.length === 0) {
    host.innerHTML = '<p class="muted">No journal yet. Talk to a philosopher first.</p>';
    return;
  }
  host.innerHTML = '<p class="muted">Analyzing…</p>';
  try {
    const resp = await fetch('https://sophicon-api.vercel.app/api/problems', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    log(`[DASHBOARD] ${problems.length} problems extracted`, 'success');
  } catch (e) {
    host.innerHTML = `<p style="color:var(--err);">Failed: ${e}</p>`;
    log(`[DASHBOARD] problems failed: ${e}`, 'error');
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  $('btn-extract-problems')?.addEventListener('click', extractProblems);
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
      currentWeekKey = nextWeek;
      currentOverview = ov;
      await renderWeekly();
      setWeeklyStatus(`Generated ${ov.problems.length} problems for ${nextWeek}.`);
    } catch (e: any) {
      setWeeklyStatus(`Rollover failed: ${e?.message || e}`);
    }
  });

  $('weekly-prev')?.addEventListener('click', async () => {
    currentWeekKey = shiftWeek(currentWeekKey, -1);
    await loadAndRenderCurrentWeek();
  });
  $('weekly-next')?.addEventListener('click', async () => {
    currentWeekKey = shiftWeek(currentWeekKey, +1);
    await loadAndRenderCurrentWeek();
  });

  // Modal close + actions
  $('problem-modal-close')?.addEventListener('click', closeProblemModal);
  $('problem-modal')?.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).id === 'problem-modal') closeProblemModal();
  });
  $('problem-modal-addressed')?.addEventListener('click', async () => {
    if (!activeProblemId) return;
    await setProblemStatus(currentWeekKey, activeProblemId, 'addressed');
    currentOverview = await loadOverview(currentWeekKey);
    await renderWeekly();
    closeProblemModal();
  });
  $('problem-modal-rollover')?.addEventListener('click', async () => {
    if (!activeProblemId) return;
    await setProblemStatus(currentWeekKey, activeProblemId, 'rolled-over');
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

// ─── HABITS CARD + DAILY CHECK-IN ───────────────────────────────────
// Habits card sits on the Home tab below the weekly overview. It lists
// active habits with their streak count + the philosopher's sprite.
// On dashboard boot we also surface a check-in modal if the user has
// any habits whose last check-in was older than yesterday. Each habit
// row in the modal shows the philosopher's face and asks "did you
// [habit] yesterday?" — yes / no / skip. Streaks are kept locally;
// this is the Solo-Leveling daily-quest layer.

async function renderHabits(): Promise<void> {
  const list = $('habit-list');
  const empty = $('habits-empty');
  const count = $('habit-count');
  if (!list || !empty || !count) return;
  const habits = await listHabits();
  count.textContent = habits.length === 0 ? '' : `${habits.length}`;
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
  set('prof-reply-length', p.preferences.replyLength);
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
      replyLength: (get('prof-reply-length') as any) || 'mixed',
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

// ─── PUBLIC ENTRY ─────────────────────────────────────────────────
export async function initDashboard(b: EvenAppBridge, base: string): Promise<void> {
  bridge = b;
  baseUrl = base;
  setWeeklyBridge(b);
  setHabitsBridge(b);
  setProfileBridge(b);

  initTabs();
  initHomeStats();
  renderPhilosopherGrid();
  initDebugPanel();
  initJournalPanel();
  await initMindfulPanel();
  await initSettings();
  await initProfilePanel();
  await refreshJournal();
  await initWeeklyPanel();
  await renderHabits();

  // Daily check-in modal — surfaces when the user has habits whose
  // last check-in is older than yesterday. Wire close affordance once.
  $('checkin-close')?.addEventListener('click', closeCheckInModal);
  $('checkin-modal')?.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).id === 'checkin-modal') closeCheckInModal();
  });
  await maybeShowDailyCheckIn();

  // Subscribe to live glass-state updates; also refresh journal when
  // user exits speak-conversation (checkpoint just fired)
  onGlassesStateChange((s) => {
    applyGlassState(s);
    // Any transition OUT of speak-conversation → journal likely changed
    if (s.page !== 'speak-conversation') refreshJournal().catch(() => {});
  });
  log('[DASHBOARD] Ready', 'success');
}
