// ═══════════════════════════════════════════════════════════════════
// G2 UX LAB — fixture scenarios (src/lab/fixtures.ts)
//
// Each scenario seeds the bridge's localStorage with a coherent app
// state so the phone panel + glasses mirror can be exercised without
// real usage history. In the browser the bridge is the lab mock, whose
// store is ISOLATED under the "g2lab::" prefix — fixtures can never
// touch real user data. (When the lab runs inside Even Hub against a
// real bridge, fixtures are disabled — see labPanel.ts guard.)
// ═══════════════════════════════════════════════════════════════════

export interface LabBridgeControls {
  setPaired(next: boolean, batteryLevel?: number): void;
  clearStore(): void;
}

export interface Fixture {
  key: string;
  label: string;
  blurb: string;
  apply(bridge: any, controls: LabBridgeControls | null): Promise<void>;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let itemSeq = 0;
function checklistItem(title: string, size: 'big' | 'medium' | 'small', completed: boolean) {
  itemSeq += 1;
  return {
    id: `lab-${itemSeq}`, date: todayKey(), title, size,
    domain: 'Mind', quadrant: 'Q2', controlAxis: 'within',
    source: 'manual', completed,
    completedAt: completed ? Date.now() - 3600_000 : undefined,
    createdAt: Date.now() - 7200_000,
  };
}

function habit(title: string, philName: string, philId: string, streak: number, dueToday: boolean) {
  return {
    id: `lab-habit-${title.toLowerCase().replace(/\W+/g, '-')}`,
    title, detail: `${title} — daily practice`,
    source: `${philName} (Stoicism)`, philName, philId, tradition: 'Stoicism',
    themes: ['discipline'], tagHints: [],
    quote: { text: 'You have power over your mind — not outside events.', source: 'Meditations', philName },
    createdAt: Date.now() - 30 * 86400_000, active: true,
    streak, bestStreak: Math.max(streak, 8),
    // Last check-in yesterday ⇒ due today; today ⇒ already done.
    checkIns: [{ date: dueToday ? daysAgo(1) : todayKey(), status: 'done', ts: Date.now() - (dueToday ? 86400_000 : 3600_000) }],
  };
}

async function seedToday(bridge: any, opts: { doneBig?: boolean } = {}): Promise<void> {
  const items = [
    checklistItem('Ship the weekly menu', 'big', Boolean(opts.doneBig)),
    checklistItem('Reply to supplier', 'medium', true),
    checklistItem('Walk 30 minutes', 'medium', false),
    checklistItem('Review food cost sheet', 'medium', false),
    checklistItem('Water the plants', 'small', true),
    checklistItem('Read 10 pages', 'small', false),
    checklistItem('Stretch', 'small', false),
    checklistItem('Inbox zero', 'small', false),
    checklistItem('Journal one line', 'small', false),
  ];
  await bridge.setLocalStorage(`checklist_${todayKey()}`, JSON.stringify(items));
  await bridge.setLocalStorage('checklist_index', JSON.stringify([todayKey()]));
  await bridge.setLocalStorage('glance_today', JSON.stringify({
    d: todayKey(), line: 'TODAY · 1 BIG: Ship the menu · 2/9 done',
  }));
}

export const FIXTURES: Fixture[] = [
  {
    key: 'fresh-seeker-offline',
    label: 'Fresh Seeker · offline',
    blurb: 'No account, no data, no network. First-run glance experience.',
    async apply(bridge, controls) {
      controls?.clearStore();
      await bridge.setLocalStorage('enki_tier', 'seeker');
      controls?.setPaired(true, 92);
    },
  },
  {
    key: 'linked-sage-today',
    label: 'Linked Sage · Today data',
    blurb: 'Paired + linked account with a live 1-3-5 cockpit and habits.',
    async apply(bridge, controls) {
      controls?.clearStore();
      await bridge.setLocalStorage('enki_token', 'lab-token');
      await bridge.setLocalStorage('enki_handle', 'marcus_fan');
      await bridge.setLocalStorage('enki_tier', 'sage');
      await seedToday(bridge);
      await bridge.setLocalStorage('habits', JSON.stringify([
        habit('Morning meditation', 'Marcus Aurelius', 'marcus_aurelius', 12, false),
        habit('Evening review', 'Seneca', 'seneca', 5, false),
      ]));
      controls?.setPaired(true, 87);
    },
  },
  {
    key: 'habit-due',
    label: 'Habit due',
    blurb: 'One habit is due for check-in — drives the Habit Check-In page.',
    async apply(bridge, controls) {
      await bridge.setLocalStorage('habits', JSON.stringify([
        habit('Morning meditation', 'Marcus Aurelius', 'marcus_aurelius', 12, true),
        habit('Cold shower', 'Epictetus', 'epictetus', 3, true),
      ]));
      controls?.setPaired(true, 87);
    },
  },
  {
    key: 'speak-ended',
    label: 'Speak just ended',
    blurb: 'A conversation just checkpointed — drives the Journal Prompt page.',
    async apply(bridge, _controls) {
      const session = {
        date: todayKey(), philId: 'marcus_aurelius', philName: 'Marcus Aurelius',
        tradition: 'Stoicism', startTs: Date.now() - 15 * 60_000, endTs: Date.now() - 30_000,
        exchanges: [
          { role: 'user', text: 'How do I stop overthinking everything?' },
          { role: 'philosopher', text: 'You have power over your mind — not outside events. Realize this, and you will find strength.' },
        ],
      };
      const raw = await bridge.getLocalStorage('speak_journal');
      const journal = raw ? JSON.parse(raw) : [];
      journal.push(session);
      await bridge.setLocalStorage('speak_journal', JSON.stringify(journal));
    },
  },
  {
    key: 'quote-resonance',
    label: 'Quote resonance saved',
    blurb: 'A quote was hearted on-glass; favorites reflect it.',
    async apply(bridge, _controls) {
      await bridge.setLocalStorage('sophicon_favorites', JSON.stringify([
        'You have power over your mind — not outside events. Realize this, and you will find strength.',
      ]));
    },
  },
  {
    key: 'aphorica-read',
    label: 'Aphorica read / react',
    blurb: 'Community feed state — open Aphorica Lite from the surfaces card.',
    async apply(bridge, _controls) {
      await bridge.setLocalStorage('glance_today', JSON.stringify({
        d: todayKey(), line: 'APHORICA · 3 new from @stoic_sam',
      }));
    },
  },
  {
    key: 'pairing-lost',
    label: 'Pairing lost → reconnect',
    blurb: 'Glasses dropped BLE — drives the Pairing page + status strip.',
    async apply(_bridge, controls) {
      controls?.setPaired(false);
      // Reconnect after a few seconds, like real BLE behavior.
      setTimeout(() => controls?.setPaired(true, 63), 6000);
    },
  },
];

export function getFixture(key: string): Fixture | undefined {
  return FIXTURES.find(f => f.key === key);
}

export { todayKey };
