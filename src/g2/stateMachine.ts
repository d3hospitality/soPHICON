// ═══════════════════════════════════════════════════════════════════
// G2 UX state machine (src/g2/stateMachine.ts)
//
// An EXPLICIT map of the on-glass experience. Two jobs:
//
//   1. deriveState(page) — project the existing implicit navigation
//      (events.ts `currentPage` strings) onto the seven canonical UX
//      states, so the phone lab can always answer "where is the user?"
//   2. LabStateMachine — drive the three NEW glance surfaces (Habit
//      Check-In, Journal Prompt, Pairing) that don't exist in the
//      production event router yet. While one of these is active the
//      lab intercepts ring events (events.setLabEventHook) and routes
//      them through the transition table below; leaving the machine
//      hands control back to the production router at Home.
//
// Ring verb grammar is FIXED (docs/TRANSLATION-SYSTEM.md §4):
//   scroll = move · click = select/advance · double-click = back/home
// ═══════════════════════════════════════════════════════════════════

export type G2State =
  | 'HOME_GLANCE'
  | 'QUOTE'
  | 'SPEAK'
  | 'HABIT_CHECKIN'
  | 'JOURNAL_PROMPT'
  | 'APHORICA_LITE'
  | 'PAIRING';

export type G2Gesture = 'TAP' | 'DOUBLE_TAP' | 'SWIPE_UP' | 'SWIPE_DOWN';

/** Project events.ts `currentPage` onto the canonical UX states. */
export function deriveState(page: string): G2State {
  switch (page) {
    case 'home': return 'HOME_GLANCE';
    case 'quote':
    case 'philosophers':
    case 'mindstate':
    case 'mindful-blank':
    case 'mindful-quote': return 'QUOTE';
    case 'speak-traditions':
    case 'speak-philosophers':
    case 'speak-conversation': return 'SPEAK';
    case 'aphorica':
    case 'aphorica-read': return 'APHORICA_LITE';
    default: return 'HOME_GLANCE';
  }
}

export interface MachineContext {
  /** Render one of the machine-owned pages on the glasses. */
  render: (state: G2State) => Promise<void>;
  /** Hand control back to the production router at Home. */
  exitToHome: () => Promise<void>;
  /** TAP on HABIT_CHECKIN marks the habit done. */
  onHabitDone: () => Promise<void>;
  /** SWIPE on HABIT_CHECKIN moves between due habits. */
  onHabitCycle: (dir: 1 | -1) => Promise<void>;
  /** TAP on JOURNAL_PROMPT saves the reflection to the journal. */
  onJournalSave: () => Promise<void>;
  onLog?: (line: string) => void;
}

/** Machine-owned states — the production router owns everything else. */
const MACHINE_STATES: ReadonlySet<G2State> = new Set([
  'HABIT_CHECKIN', 'JOURNAL_PROMPT', 'PAIRING',
]);

export class LabStateMachine {
  private state: G2State | null = null; // null = production router owns the glass
  private ctx: MachineContext;
  private listeners: Array<(s: G2State | null) => void> = [];

  constructor(ctx: MachineContext) {
    this.ctx = ctx;
  }

  get active(): boolean { return this.state !== null; }
  get current(): G2State | null { return this.state; }

  onChange(cb: (s: G2State | null) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(): void {
    for (const cb of this.listeners) { try { cb(this.state); } catch { /* cb */ } }
  }

  private log(line: string): void { this.ctx.onLog?.(line); }

  /** Enter a machine-owned state and render it. */
  async go(state: G2State): Promise<void> {
    if (!MACHINE_STATES.has(state)) {
      // Non-machine states are reached by exiting to the production router.
      await this.exit();
      return;
    }
    this.state = state;
    this.log(`state → ${state}`);
    await this.ctx.render(state);
    this.emit();
  }

  /** Leave the machine: production router takes over at Home. */
  async exit(): Promise<void> {
    if (this.state === null) return;
    this.state = null;
    this.log('state → (production router · HOME_GLANCE)');
    await this.ctx.exitToHome();
    this.emit();
  }

  /** Transition table for machine-owned states. Returns true when the
   * gesture was consumed (the production router must NOT also see it). */
  async handle(gesture: G2Gesture): Promise<boolean> {
    if (this.state === null) return false;
    this.log(`gesture ${gesture} @ ${this.state}`);

    switch (this.state) {
      case 'HABIT_CHECKIN':
        if (gesture === 'TAP') { await this.ctx.onHabitDone(); return true; }
        if (gesture === 'SWIPE_UP') { await this.ctx.onHabitCycle(-1); return true; }
        if (gesture === 'SWIPE_DOWN') { await this.ctx.onHabitCycle(1); return true; }
        if (gesture === 'DOUBLE_TAP') { await this.exit(); return true; }
        return true;

      case 'JOURNAL_PROMPT':
        if (gesture === 'TAP') { await this.ctx.onJournalSave(); await this.exit(); return true; }
        if (gesture === 'DOUBLE_TAP') { await this.exit(); return true; }
        return true; // swipes are inert on the prompt

      case 'PAIRING':
        if (gesture === 'DOUBLE_TAP') { await this.exit(); return true; }
        return true; // pairing page is informational

      default:
        return false;
    }
  }
}
