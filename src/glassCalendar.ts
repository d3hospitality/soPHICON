// ══════════════════════════════════════════════════════════════════════════
// soΦcon — Glass calendar (activity aggregation + renderers)
//
// The on-glass month overview and day detail. Pure data + string
// building lives here; page CONTAINERS live in pages.ts and routing in
// events.ts, same split as everything else on the glass.
//
// "Activity" on a day = the union of three sources:
//   talks — speak_journal sessions (JournalSession.date, already local
//           YYYY-MM-DD, stamped by the originating device)
//   saves — wisdom-log 'fav' entries (append-only: un-favoriting later
//           never rewrites the day you saved it)
//   logs  — wisdom-log 'reply' and 'like' entries
//
// Known undercount, documented rather than papered over: seeker
// conversations are never checkpointed (speak.ts gates on entitlement),
// so free-tier talks leave no calendar trace. The wisdom log is the
// free-tier's visible history — captures work for everyone.
//
// Date keys are LOCAL YYYY-MM-DD via the same construction dashboard.ts
// / habits.ts / checklist.ts use. If any of the four ever switches to
// UTC, day boundaries desync across surfaces — grep 'dateKey' first.
// ══════════════════════════════════════════════════════════════════════════

import { loadJournal, JournalSession } from './speak';
import { getWisdomEntries, WisdomEntry } from './wisdomlog';
import { tGlass, glassLang } from './i18n';

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface DayActivity {
  talks: JournalSession[];
  saves: { ts: number; text: string }[];
  logs: WisdomEntry[];
}
export type ActivityMap = Map<string, DayActivity>;

/** One aggregation per calendar entry; the map is small (≤ ~500 log
 *  entries + sessions) so rebuilding on each open beats cache
 *  invalidation across three change sources. */
export async function buildActivityMap(): Promise<ActivityMap> {
  const map: ActivityMap = new Map();
  const day = (key: string): DayActivity => {
    let d = map.get(key);
    if (!d) { d = { talks: [], saves: [], logs: [] }; map.set(key, d); }
    return d;
  };
  for (const s of await loadJournal()) {
    if (s.date) day(s.date).talks.push(s);
  }
  // Saves come from the WISDOM LOG ('fav' entries), not the live
  // favorites store: the log is append-only history, so un-favoriting
  // later never erases the day you saved it — a calendar that rewrites
  // its own past breaks streaks retroactively and reads as a bug.
  for (const w of getWisdomEntries()) {
    if (w.kind === 'fav') day(dateKey(new Date(w.ts))).saves.push({ ts: w.ts, text: w.text });
    else day(dateKey(new Date(w.ts))).logs.push(w);
  }
  return map;
}

function totalOf(d: DayActivity): number {
  return d.talks.length + d.saves.length + d.logs.length;
}

/** Consecutive active days ending today (or yesterday, so an unopened
 *  morning doesn't read as a broken streak). */
export function computeStreak(map: ActivityMap): number {
  const today = new Date();
  const probe = new Date(today);
  if (!map.has(dateKey(probe))) probe.setDate(probe.getDate() - 1);   // grace: today not yet active
  let streak = 0;
  while (map.has(dateKey(probe))) {
    streak++;
    probe.setDate(probe.getDate() - 1);
  }
  return streak;
}

// ─── Month grid ──────────────────────────────────────────────────────

/** Map our language codes to Intl locales. Months and weekday initials
 *  come from Intl — zero dictionary keys, correct in every language,
 *  and the firmware font covers Latin/CJK/Cyrillic output. */
function intlLocale(): string {
  const l = glassLang();
  return l === 'zh' ? 'zh-CN' : l === 'pt' ? 'pt-BR' : l;
}

export function monthTitle(year: number, month0: number): string {
  const name = new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(new Date(year, month0, 1));
  // CJK month names already contain the numeral; keep "name year".
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

/** The month grid as firmware text. Glyphs (all firmware-safe, and all
 *  MEASURED EQUAL at 20px advance in the LVGL font — the whole grid
 *  depends on that, because firmware text is proportional and a 5px '·'
 *  against a 20px '●' makes columns wander by half a cell per week):
 *    ○  quiet day    ●  day with activity    ◆  today
 *  There is deliberately NO weekday header row: Latin narrow initials
 *  measure 11-16px and cannot sit over 20px columns. Monday-first,
 *  6 week rows max = 6 lines, zero image cost. */
export function renderMonthGrid(year: number, month0: number, map: ActivityMap): string {
  const first = new Date(year, month0, 1);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const todayKey = dateKey(new Date());
  // Monday-first column of the 1st: JS getDay() is Sun=0.
  const lead = (first.getDay() + 6) % 7;

  const lines: string[] = [];
  // The leading pad must hold a full cell (20px glyph + 5px space =
  // '○ ' at 25px), so pad with a same-width invisible pair: four 5px
  // spaces + separator. '    ' (4 spaces) = 20px = one glyph cell.
  let row: string[] = new Array(lead).fill('    ');
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(new Date(year, month0, d));
    const glyph = key === todayKey ? '◆' : map.has(key) ? '●' : '○';
    row.push(glyph);
    if (row.length === 7) { lines.push(row.join(' ')); row = []; }
  }
  if (row.length > 0) lines.push(row.join(' '));
  return lines.join('\n');
}

/** Header line: "August 2026 · 12 active · 4-day streak" (parts drop
 *  when zero so a fresh install reads clean). */
export function monthHeaderLine(year: number, month0: number, map: ActivityMap): string {
  const prefix = `${year}-${String(month0 + 1).padStart(2, '0')}-`;
  let active = 0;
  for (const key of map.keys()) if (key.startsWith(prefix)) active++;
  const streak = computeStreak(map);
  const parts = [monthTitle(year, month0)];
  if (active > 0) parts.push(tGlass('g.calActive').replace('{n}', String(active)));
  if (streak > 1) parts.push(tGlass('g.calStreak').replace('{n}', String(streak)));
  return parts.join(' · ');
}

// ─── Day list (navpad rows) ──────────────────────────────────────────

export interface CalDayRow { key: string; label: string; }

/** Active days of a month, newest first, as navpad rows:
 *  "11 · 2♥ 1▶" (day number · saves hearts, talks arrows, logs dots). */
export function activeDaysOfMonth(year: number, month0: number, map: ActivityMap): CalDayRow[] {
  const prefix = `${year}-${String(month0 + 1).padStart(2, '0')}-`;
  const rows: CalDayRow[] = [];
  const keys = [...map.keys()].filter(k => k.startsWith(prefix)).sort().reverse();
  for (const key of keys) {
    const d = map.get(key)!;
    const parts: string[] = [];
    if (d.talks.length) parts.push(`${d.talks.length}▶`);
    if (d.saves.length) parts.push(`${d.saves.length}♥`);
    if (d.logs.length) parts.push(`${d.logs.length}●`);
    rows.push({ key, label: `${Number(key.slice(8))} · ${parts.join(' ')}` });
  }
  return rows;
}

// ─── Day detail (paged entries) ──────────────────────────────────────

const DAY_BODY_LINES = 7;
const CHARS_PER_LINE: Record<string, number> = { zh: 26, ja: 26, de: 46, ru: 46 };
const CHARS_PER_LINE_DEFAULT = 55;

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** All of one day's activity as display blocks, chronological. */
export function dayEntryBlocks(key: string, map: ActivityMap): string[] {
  const d = map.get(key);
  if (!d) return [];
  const items: { ts: number; text: string }[] = [];
  for (const s of d.talks) {
    const turns = s.exchanges.filter(e => e.role === 'user').length;
    items.push({ ts: s.startTs, text: `${hhmm(s.startTs)} ▶ ${tGlass('g.calSpoke').replace('{name}', s.philName).replace('{n}', String(turns))}` });
  }
  for (const s of d.saves) {
    items.push({ ts: s.ts, text: `${hhmm(s.ts)} ♥ "${s.text}"` });
  }
  for (const w of d.logs) {
    const label = w.kind === 'like'
      ? tGlass('g.calLiked').replace('{name}', w.who)
      : tGlass('g.calLogged').replace('{name}', w.who);
    items.push({ ts: w.ts, text: `${hhmm(w.ts)} ● ${label}: "${w.text}"` });
  }
  items.sort((a, b) => a.ts - b.ts);
  return items.map(i => i.text);
}

/** Page the blocks exactly like the support story: wrap to per-language
 *  line widths, pack whole lines, 7 lines per page, blank line between
 *  entries. Same reasoning: overflow on this panel is silently cut, so
 *  page height must be deterministic. */
export function dayPages(key: string, map: ActivityMap): string[] {
  const cpl = CHARS_PER_LINE[glassLang()] ?? CHARS_PER_LINE_DEFAULT;
  const wrap = (text: string): string[] => {
    const out: string[] = [];
    let rest = text.trim();
    while (rest.length > cpl) {
      let cut = rest.lastIndexOf(' ', cpl);
      if (cut <= 0 || cut < cpl * 0.5) cut = cpl;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out.length ? out : [''];
  };

  const lines: string[] = [];
  dayEntryBlocks(key, map).forEach((b, i) => {
    if (i > 0) lines.push('');
    lines.push(...wrap(b));
  });

  const pages: string[] = [];
  for (let i = 0; i < lines.length;) {
    while (i < lines.length && lines[i] === '') i++;
    if (i >= lines.length) break;
    pages.push(lines.slice(i, i + DAY_BODY_LINES).join('\n').replace(/\s+$/, ''));
    i += DAY_BODY_LINES;
  }
  return pages.length ? pages : [tGlass('g.calEmptyDay')];
}

/** Localized long-date title for the day page ("11 August"). */
export function dayTitle(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
}
