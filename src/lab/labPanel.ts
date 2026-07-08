// ═══════════════════════════════════════════════════════════════════
// G2 UX LAB — phone-side panel (src/lab/labPanel.ts)
//
// The cockpit view of the glasses. Dev-only: mounted by Main.ts ONLY
// when isLabMode() is true (dynamic import — never in a normal boot).
//
// Sections (Even Hub style: dense dashboard cards, Even yellow accent,
// glasses green reserved for the mirror):
//   1. Glass mirror   — live textual + canvas mirror of the G2 display
//   2. Gestures       — tap / double-tap / swipe up / swipe down / list click
//   3. Surfaces       — drive Habit Check-In · Journal Prompt · Pairing ·
//                       Aphorica Lite · Home (state machine)
//   4. Scenarios      — fixture seeding (mock bridge only)
//   5. Toggles        — tier, paired, offline, habit due/done, resonance,
//                       speak-ended → journal prompt
// ═══════════════════════════════════════════════════════════════════

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import {
  simulateEvent, setLabEventHook, getCurrentPageName, returnHomeFromLab,
  onGlassesStateChange,
} from '../events';
import {
  setGlanceHomeEnabled, setPracticeLines,
  buildHabitCheckInPage, buildJournalPromptPage, buildPairingPage,
} from '../pages';
import { G2Adapter } from '../g2/adapter';
import { LabStateMachine, deriveState, type G2State, type G2Gesture } from '../g2/stateMachine';
import { isMockBridge, type GlassMirrorModel } from './mockBridge';
import { FIXTURES, getFixture, todayKey } from './fixtures';
import { log } from '../ui';

// ── tiny DOM helpers (mirrors dashboard.ts conventions) ──
const $ = (id: string) => document.getElementById(id);

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

// ── module state ──
let bridge: any = null;
let adapter: G2Adapter | null = null;
let machine: LabStateMachine | null = null;
let labLogEl: HTMLElement | null = null;

let habits: Array<{ title: string; streak: number }> = [];
let habitIdx = 0;
let realFetch: typeof fetch | null = null;

function labLog(line: string): void {
  if (!labLogEl) return;
  const entry = document.createElement('div');
  entry.className = 'entry';
  entry.textContent = `${new Date().toLocaleTimeString()} ${line}`;
  labLogEl.prepend(entry);
  while (labLogEl.children.length > 40) labLogEl.removeChild(labLogEl.lastChild!);
}

// ── gesture payloads: EXACTLY what the firmware sends (events.ts:1185) ──
const GESTURE_EVENTS: Record<G2Gesture, any> = {
  TAP: { sysEvent: { eventType: 0 } },
  DOUBLE_TAP: { sysEvent: { eventType: 3 } },
  SWIPE_UP: { textEvent: { eventType: 1 } },
  SWIPE_DOWN: { textEvent: { eventType: 2 } },
};

function sendGesture(g: G2Gesture): void {
  labLog(`gesture: ${g}`);
  simulateEvent(GESTURE_EVENTS[g]);
}

// ── habit data (raw keys — the lab reads the same store the app does) ──
async function loadHabits(): Promise<void> {
  try {
    const raw = await bridge.getLocalStorage('habits');
    const arr = raw ? JSON.parse(raw) : [];
    habits = (Array.isArray(arr) ? arr : [])
      .filter((h: any) => h && h.active !== false)
      .map((h: any) => ({ title: String(h.title ?? '?'), streak: Number(h.streak) || 0 }));
  } catch { habits = []; }
  if (habitIdx >= habits.length) habitIdx = 0;
}

async function markHabitDone(): Promise<void> {
  try {
    const raw = await bridge.getLocalStorage('habits');
    const arr = raw ? JSON.parse(raw) : [];
    const target = habits[habitIdx];
    for (const h of arr) {
      if (h.title === target?.title) {
        h.streak = (Number(h.streak) || 0) + 1;
        h.bestStreak = Math.max(Number(h.bestStreak) || 0, h.streak);
        if (Array.isArray(h.checkIns)) h.checkIns.push({ date: todayKey(), status: 'done', ts: Date.now() });
      }
    }
    await bridge.setLocalStorage('habits', JSON.stringify(arr));
  } catch { /* fixture store */ }
  await loadHabits();
  labLog(`habit done ✓ (${habits[habitIdx]?.title ?? '—'})`);
}

// ── machine page renders (through the adapter — serialized, layout-aware) ──
async function renderMachineState(state: G2State): Promise<void> {
  if (!adapter) return;
  if (state === 'HABIT_CHECKIN') {
    await loadHabits();
    const h = habits[habitIdx] ?? { title: 'No habits yet — apply a fixture', streak: 0 };
    await adapter.showPage('lab-habit', buildHabitCheckInPage(
      h.title, `streak ${h.streak} days`, habitIdx, Math.max(1, habits.length),
    ));
  } else if (state === 'JOURNAL_PROMPT') {
    let phil = 'Marcus Aurelius';
    try {
      const raw = await bridge.getLocalStorage('speak_journal');
      const j = raw ? JSON.parse(raw) : [];
      if (j.length) phil = j[j.length - 1].philName || phil;
    } catch { /* default phil */ }
    await adapter.showPage('lab-journal', buildJournalPromptPage(
      phil, 'One line: what did this conversation change?',
    ));
  } else if (state === 'PAIRING') {
    const paired = bridge.__lab ? bridge.__lab.isPaired() : true;
    await adapter.showPage('lab-pairing', buildPairingPage(
      paired ? 'linked' : 'lost', paired ? '@marcus_fan · SAGE' : '',
    ));
  }
  updateStateBadge();
}

async function saveJournalReflection(): Promise<void> {
  try {
    const raw = await bridge.getLocalStorage('speak_journal');
    const j = raw ? JSON.parse(raw) : [];
    j.push({
      date: todayKey(), philId: 'lab', philName: 'Reflection', tradition: 'Lab',
      startTs: Date.now(), endTs: Date.now(),
      exchanges: [{ role: 'user', text: '(reflection saved from G2 lab prompt)' }],
    });
    await bridge.setLocalStorage('speak_journal', JSON.stringify(j));
    labLog('reflection saved to journal ✓');
  } catch { /* fixture store */ }
}

// ── glance home practice stack ──
async function refreshPracticeGlance(): Promise<void> {
  const lines: string[] = [];
  try {
    const raw = await bridge.getLocalStorage(`checklist_${todayKey()}`);
    const items = raw ? JSON.parse(raw) : [];
    const next = (Array.isArray(items) ? items : [])
      .filter((i: any) => !i.completed)
      .sort((a: any, b: any) => (a.size === 'big' ? -1 : b.size === 'big' ? 1 : a.size === 'medium' ? -1 : 1))[0];
    if (next) lines.push(`> ${next.size === 'big' ? '1 BIG' : 'NEXT'}: ${next.title}`);
  } catch { /* no checklist */ }
  await loadHabits();
  if (habits.length) lines.push(`HABIT: ${habits[habitIdx].title} (${habits[habitIdx].streak}d)`);
  lines.push('Enki: one honest line tonight');
  setPracticeLines(lines.slice(0, 3).join('\n'));
  await returnHomeFromLab();
  labLog('glance home refreshed');
}

// ── mirror rendering ──
function paintMirrorCanvas(model: GlassMirrorModel): void {
  const canvas = $('lab-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#020a04';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / 576, sy = canvas.height / 288;
  for (const c of model.containers) {
    // Geometry isn't in the mirror model (content-only); draw stacked rows.
    void c;
  }
  // Stacked textual render — geometry-faithful painting comes with the
  // production adapter migration; rows are honest and readable for now.
  let y = 18;
  ctx.font = `${Math.round(11 * sy + 4)}px ui-monospace, monospace`;
  for (const c of model.containers) {
    ctx.fillStyle = c.isEventCapture ? '#69ff8e' : '#2e9e4f';
    const head = `#${c.id} ${c.name}${c.isEventCapture ? ' ◉' : ''}`;
    ctx.fillText(head, 8 * sx, y);
    y += 14 * sy + 2;
    ctx.fillStyle = '#3fd268';
    for (const line of c.content.split('\n').slice(0, 3)) {
      ctx.fillText(line.slice(0, 60), 20 * sx, y);
      y += 13 * sy + 2;
      if (y > canvas.height - 8) return;
    }
    y += 4 * sy;
    if (y > canvas.height - 8) return;
  }
}

function renderMirrorText(model: GlassMirrorModel): void {
  const pre = $('lab-mirror-text');
  if (!pre) return;
  const rows = model.containers.map(c =>
    `#${String(c.id).padStart(2)} ${c.kind.padEnd(5)} ${c.name}${c.isEventCapture ? '  [capture]' : ''}\n` +
    c.content.split('\n').map(l => `      ${l}`).join('\n'),
  );
  pre.textContent = rows.join('\n') || '(nothing rendered yet)';
  const meta = $('lab-mirror-meta');
  if (meta) meta.textContent = `startup:${model.startupDone ? '✓' : '—'} · rebuilds:${model.rebuildCount} · last:${model.lastCall}${model.lastImagePush ? ` · img:${model.lastImagePush}` : ''}`;
}

function updateStateBadge(): void {
  const badge = $('lab-state-badge');
  if (!badge) return;
  const machineState = machine?.current;
  const page = getCurrentPageName();
  badge.textContent = machineState ? `${machineState} (lab)` : `${deriveState(page)} · ${page}`;
}

// ── panel skeleton ──
const PANEL_HTML = `
  <div class="card">
    <div class="card-header">G2 glass mirror
      <span class="badge lab-accent" id="lab-state-badge">—</span>
    </div>
    <canvas id="lab-canvas" width="576" height="288" class="lab-canvas"></canvas>
    <div class="hint" id="lab-mirror-meta">—</div>
    <pre class="lab-mirror" id="lab-mirror-text">(waiting for first render)</pre>
  </div>

  <div class="card">
    <div class="card-header">Ring gestures</div>
    <div class="btn-row">
      <button class="btn" id="lab-g-tap">● Tap</button>
      <button class="btn" id="lab-g-double">●● Double-tap</button>
      <button class="btn" id="lab-g-up">↑ Swipe up</button>
      <button class="btn" id="lab-g-down">↓ Swipe down</button>
    </div>
    <div class="btn-row mt-sm">
      <input type="number" id="lab-list-idx" value="0" min="0" class="lab-idx" />
      <button class="btn sm" id="lab-g-list">List click @ index</button>
    </div>
    <div class="hint mt-sm">Injected into the same router as real ring events.</div>
  </div>

  <div class="card">
    <div class="card-header">Glance surfaces (state machine)</div>
    <div class="btn-row">
      <button class="btn sm" id="lab-s-home">Home Glance</button>
      <button class="btn sm" id="lab-s-habit">Habit Check-In</button>
      <button class="btn sm" id="lab-s-journal">Journal Prompt</button>
      <button class="btn sm" id="lab-s-pairing">Pairing</button>
      <button class="btn sm" id="lab-s-aphorica">Aphorica Lite</button>
    </div>
    <div class="hint mt-sm">Habit/Journal/Pairing are machine-owned (lab intercepts the ring).
    Aphorica Lite routes through the production router. Double-tap exits to Home.</div>
  </div>

  <div class="card">
    <div class="card-header">Scenario fixtures <span class="badge" id="lab-fixture-badge">mock store</span></div>
    <div class="field">
      <select id="lab-fixture"></select>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary sm" id="lab-fixture-apply">Apply scenario</button>
      <button class="btn sm" id="lab-fixture-glance">Refresh glance home</button>
    </div>
    <div class="hint mt-sm" id="lab-fixture-blurb"></div>
  </div>

  <div class="card">
    <div class="card-header">State toggles</div>
    <div class="btn-row">
      <label class="lab-lbl">Tier
        <select id="lab-tier"><option>seeker</option><option>examined</option><option>sage</option></select>
      </label>
      <button class="btn sm" id="lab-t-paired">Paired: ?</button>
      <button class="btn sm" id="lab-t-offline">Network: online</button>
    </div>
    <div class="btn-row mt-sm">
      <button class="btn sm" id="lab-t-habitdone">Mark habit done</button>
      <button class="btn sm" id="lab-t-resonance">Save quote resonance</button>
      <button class="btn sm" id="lab-t-speakend">Speak ended → prompt</button>
    </div>
  </div>

  <div class="card">
    <div class="card-header">Lab log</div>
    <div id="lab-log"></div>
  </div>
`;

export async function initLabPanel(b: EvenAppBridge, _baseUrl: string): Promise<void> {
  bridge = b;
  const mock = isMockBridge(bridge);

  // Reveal the (hidden-by-default) Lab tab + panel.
  const tabBtn = $('lab-tab-btn');
  if (tabBtn) tabBtn.style.display = '';
  const root = document.querySelector<HTMLElement>('.tab-panel[data-panel="lab"]');
  if (!root) { log('[LAB] panel root missing', 'error'); return; }
  root.appendChild(el(`<div class="lab-root">${PANEL_HTML}</div>`));
  labLogEl = $('lab-log');

  // Glance-first home is the lab's home variant.
  setGlanceHomeEnabled(true);
  setPracticeLines('> open the Lab tab\nHABIT: apply a fixture\nEnki: what matters today?');

  // Adapter adopts the startup Main.ts already performed.
  adapter = new G2Adapter(bridge);
  adapter.adoptExistingStartup('home');

  // State machine + ring interception while machine-owned pages are up.
  machine = new LabStateMachine({
    render: renderMachineState,
    exitToHome: async () => { await returnHomeFromLab(); updateStateBadge(); },
    onHabitDone: async () => { await markHabitDone(); await renderMachineState('HABIT_CHECKIN'); },
    onHabitCycle: async (dir) => {
      await loadHabits();
      if (habits.length) habitIdx = (habitIdx + dir + habits.length) % habits.length;
      await renderMachineState('HABIT_CHECKIN');
    },
    onJournalSave: saveJournalReflection,
    onLog: labLog,
  });
  setLabEventHook((event: any) => {
    if (!machine || !machine.active) return false;
    const g: G2Gesture | null =
      event?.sysEvent ? ((event.sysEvent.eventType ?? 0) === 3 ? 'DOUBLE_TAP' : 'TAP')
      : event?.textEvent ? ((event.textEvent.eventType ?? 0) === 1 ? 'SWIPE_UP' : 'SWIPE_DOWN')
      : null;
    if (!g) return true; // machine owns the glass; swallow list/audio noise
    machine.handle(g).catch(e => console.error('[lab machine]', e));
    return true;
  });

  // ── mirror wiring ──
  if (mock) {
    bridge.__lab.onModelChange((m: GlassMirrorModel) => { renderMirrorText(m); paintMirrorCanvas(m); });
  } else {
    const pre = $('lab-mirror-text');
    if (pre) pre.textContent = '(real bridge — model mirror comes from GlassesState)';
  }
  onGlassesStateChange(() => updateStateBadge());
  machine.onChange(() => updateStateBadge());
  updateStateBadge();

  // ── gestures ──
  ($('lab-g-tap'))?.addEventListener('click', () => sendGesture('TAP'));
  ($('lab-g-double'))?.addEventListener('click', () => sendGesture('DOUBLE_TAP'));
  ($('lab-g-up'))?.addEventListener('click', () => sendGesture('SWIPE_UP'));
  ($('lab-g-down'))?.addEventListener('click', () => sendGesture('SWIPE_DOWN'));
  ($('lab-g-list'))?.addEventListener('click', () => {
    const idx = Number(($('lab-list-idx') as HTMLInputElement)?.value ?? 0);
    labLog(`list click @ ${idx}`);
    simulateEvent({ listEvent: { currentSelectItemIndex: idx, eventType: 0 } } as any);
  });

  // ── surfaces ──
  ($('lab-s-home'))?.addEventListener('click', () => machine!.exit());
  ($('lab-s-habit'))?.addEventListener('click', () => machine!.go('HABIT_CHECKIN'));
  ($('lab-s-journal'))?.addEventListener('click', () => machine!.go('JOURNAL_PROMPT'));
  ($('lab-s-pairing'))?.addEventListener('click', () => machine!.go('PAIRING'));
  ($('lab-s-aphorica'))?.addEventListener('click', async () => {
    await machine!.exit();
    // Aphorica sits at home list index 1 — commit it through the real router.
    simulateEvent({ listEvent: { currentSelectItemIndex: 1, eventType: 0 } } as any);
  });

  // ── fixtures ──
  const sel = $('lab-fixture') as HTMLSelectElement | null;
  const blurb = $('lab-fixture-blurb');
  if (sel) {
    for (const f of FIXTURES) {
      const o = document.createElement('option');
      o.value = f.key; o.textContent = f.label;
      sel.appendChild(o);
    }
    const syncBlurb = () => { if (blurb) blurb.textContent = getFixture(sel.value)?.blurb ?? ''; };
    sel.addEventListener('change', syncBlurb);
    syncBlurb();
  }
  const fixtureBadge = $('lab-fixture-badge');
  if (!mock && fixtureBadge) fixtureBadge.textContent = 'disabled (real bridge)';
  ($('lab-fixture-apply'))?.addEventListener('click', async () => {
    if (!mock) { labLog('fixtures disabled on a real bridge (protects real data)'); return; }
    const f = getFixture(sel?.value ?? '');
    if (!f) return;
    await f.apply(bridge, bridge.__lab);
    labLog(`fixture applied: ${f.label}`);
    await refreshPracticeGlance();
  });
  ($('lab-fixture-glance'))?.addEventListener('click', refreshPracticeGlance);

  // ── toggles ──
  const tierSel = $('lab-tier') as HTMLSelectElement | null;
  if (tierSel) {
    try { tierSel.value = (await bridge.getLocalStorage('enki_tier')) || 'seeker'; } catch { /* default */ }
    tierSel.addEventListener('change', async () => {
      await bridge.setLocalStorage('enki_tier', tierSel.value);
      labLog(`tier → ${tierSel.value}`);
    });
  }
  const pairedBtn = $('lab-t-paired');
  const syncPairedLabel = () => {
    if (pairedBtn) pairedBtn.textContent = `Paired: ${mock ? (bridge.__lab.isPaired() ? 'yes' : 'no') : 'real device'}`;
  };
  syncPairedLabel();
  pairedBtn?.addEventListener('click', () => {
    if (!mock) { labLog('pairing toggle needs the mock bridge'); return; }
    bridge.__lab.setPaired(!bridge.__lab.isPaired());
    syncPairedLabel();
    labLog(`paired → ${bridge.__lab.isPaired()}`);
    if (!bridge.__lab.isPaired()) machine!.go('PAIRING').catch(() => {});
  });
  const offlineBtn = $('lab-t-offline');
  offlineBtn?.addEventListener('click', () => {
    if (realFetch) {
      window.fetch = realFetch; realFetch = null;
      if (offlineBtn) offlineBtn.textContent = 'Network: online';
      labLog('network → online');
    } else {
      realFetch = window.fetch.bind(window);
      window.fetch = (() => Promise.reject(new TypeError('Failed to fetch (lab offline)'))) as any;
      if (offlineBtn) offlineBtn.textContent = 'Network: OFFLINE';
      labLog('network → offline (fetch rejects)');
    }
  });
  ($('lab-t-habitdone'))?.addEventListener('click', async () => {
    await loadHabits();
    await markHabitDone();
    await refreshPracticeGlance();
  });
  ($('lab-t-resonance'))?.addEventListener('click', async () => {
    await getFixture('quote-resonance')!.apply(bridge, mock ? bridge.__lab : null);
    labLog('quote resonance saved ✓');
  });
  ($('lab-t-speakend'))?.addEventListener('click', async () => {
    if (mock) await getFixture('speak-ended')!.apply(bridge, bridge.__lab);
    await machine!.go('JOURNAL_PROMPT');
  });

  labLog(`lab ready · bridge: ${mock ? 'MOCK (isolated store)' : 'REAL Even bridge'}`);
  log('[LAB] G2 UX Lab active', 'success');
}
