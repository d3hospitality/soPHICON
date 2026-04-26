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
  isoWeekKey, weekRangeLabel, shiftWeek,
  loadOverview, saveOverview, generateOverview, pickRolloverCandidates,
  setActionDone, setProblemStatus,
  pickQuotesForAction, setWeeklyBridge,
} from './weekly';
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
let quoteShuffleTimer: number | null = null;

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

  // Header
  const isThisWeek = currentWeekKey === isoWeekKey();
  titleEl.textContent = isThisWeek ? 'This week' : 'Week of';
  keyEl.textContent = `${weekRangeLabel(currentWeekKey)} · ${currentWeekKey}`;

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

function openProblemModal(problemId: string): void {
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

  // Render actions into their respective quadrants
  for (const q of QUADRANTS) {
    const ul = modal.querySelector<HTMLElement>(`.action-list[data-q="${q}"]`);
    if (!ul) continue;
    const actions = p.actions.filter(a => a.quadrant === q);
    if (actions.length === 0) {
      ul.innerHTML = '<li class="muted" style="font-size:11.5px;padding:6px;">—</li>';
      continue;
    }
    ul.innerHTML = actions.map(a => renderActionRow(p.id, a)).join('');
  }

  // Wire checkboxes
  modal.querySelectorAll<HTMLElement>('.action-check').forEach(check => {
    check.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const pid = check.dataset.pid || '';
      const aid = check.dataset.aid || '';
      const next = !check.classList.contains('checked');
      await setActionDone(currentWeekKey, pid, aid, next);
      // Mutate in-memory for instant feedback
      const prob = currentOverview?.problems.find(p => p.id === pid);
      const act = prob?.actions.find(a => a.id === aid);
      if (act) act.done = next;
      check.classList.toggle('checked', next);
      check.innerHTML = next ? '✓' : '';
      check.closest('.action-row')?.classList.toggle('done', next);
      await renderWeekly();   // updates the X/Y count on the row underneath
    });
  });

  startQuoteShuffle();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function renderActionRow(pid: string, a: WeeklyAction): string {
  return `
    <li class="action-row ${a.done ? 'done' : ''}" data-aid="${escapeAttr(a.id)}">
      <div class="action-head">
        <span class="action-check ${a.done ? 'checked' : ''}" data-pid="${escapeAttr(pid)}" data-aid="${escapeAttr(a.id)}">${a.done ? '✓' : ''}</span>
        <div style="flex:1;min-width:0;">
          <div class="action-title">${escapeHtml(a.title)}</div>
          ${a.source ? `<div class="action-source">${escapeHtml(a.source)}</div>` : ''}
        </div>
      </div>
      <div class="action-detail">${escapeHtml(a.detail)}</div>
      <div class="tethered-quote" data-aid="${escapeAttr(a.id)}"></div>
    </li>`;
}

/** Cycle a fresh quote into each .tethered-quote slot every ~7s. */
function startQuoteShuffle(): void {
  stopQuoteShuffle();
  const cycle = () => {
    if (!currentOverview || !activeProblemId) return;
    const problem = currentOverview.problems.find(p => p.id === activeProblemId);
    if (!problem) return;
    const modal = $('problem-modal');
    if (!modal) return;
    for (const a of problem.actions) {
      const slot = modal.querySelector<HTMLElement>(`.tethered-quote[data-aid="${cssEscape(a.id)}"]`);
      if (!slot) continue;
      const quotes = pickQuotesForAction(a, 1);
      if (quotes.length === 0) { slot.style.display = 'none'; continue; }
      const fq = quotes[0];
      slot.style.opacity = '0';
      setTimeout(() => {
        slot.innerHTML = `${escapeHtml(fq.q.text)}<span class="q-attrib">— ${escapeHtml(fq.phil)}, ${escapeHtml(fq.q.source || fq.tradition)}</span>`;
        slot.style.opacity = '1';
      }, 200);
    }
  };
  cycle();
  quoteShuffleTimer = window.setInterval(cycle, 7000);
}
function stopQuoteShuffle(): void {
  if (quoteShuffleTimer != null) { clearInterval(quoteShuffleTimer); quoteShuffleTimer = null; }
}

function closeProblemModal(): void {
  const modal = $('problem-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  activeProblemId = null;
  stopQuoteShuffle();
}

// ── attribute + CSS-attribute-selector helpers (escapeHtml already
//    exists in this file at line ~413) ──
function escapeAttr(s: string): string { return escapeHtml(s); }
function cssEscape(s: string): string {
  // Minimal CSS attribute-value escape: covers what stable kebab-case ids need.
  return s.replace(/["\\]/g, '\\$&');
}

// ─── PUBLIC ENTRY ─────────────────────────────────────────────────
export async function initDashboard(b: EvenAppBridge, base: string): Promise<void> {
  bridge = b;
  baseUrl = base;
  setWeeklyBridge(b);

  initTabs();
  initHomeStats();
  renderPhilosopherGrid();
  initDebugPanel();
  initJournalPanel();
  await initMindfulPanel();
  await initSettings();
  await refreshJournal();
  await initWeeklyPanel();

  // Subscribe to live glass-state updates; also refresh journal when
  // user exits speak-conversation (checkpoint just fired)
  onGlassesStateChange((s) => {
    applyGlassState(s);
    // Any transition OUT of speak-conversation → journal likely changed
    if (s.page !== 'speak-conversation') refreshJournal().catch(() => {});
  });
  log('[DASHBOARD] Ready', 'success');
}
