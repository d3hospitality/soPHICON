// ═══════════════════════════════════════════════════════════════════
// polygotTour.ts — "Try PolyGot" on the enkiRIDION home list.
//
// A short, scripted tour of PolyGot (D3's language app for the same
// glasses), shown in enkiRIDION's own lens: five moments in five
// languages, the same ones PolyGot's own demo walks through, then where
// to get it. Lines arrive one by one like the real HUD. Nothing is
// recorded or scored here, and no network is needed.
//
//   tap        next moment (last one: back home)
//   swipe      previous / next moment
//   double-tap back home
//
// Layout follows PolyGot's demo page: hud · main (5 lines) · caption · keys.
// ═══════════════════════════════════════════════════════════════════

import { RebuildPageContainer, TextContainerProperty } from '@evenrealities/even_hub_sdk';
import { hostSupports214 } from './host';

export interface TourSay { lang: string; word: string; show: string }
export interface TourStop { name: string; lang: string; main: string[]; caption: string; say?: TourSay }

// Each moment ends with a line the wearer says out loud; PolyGot's demo
// endpoint scores it (src/polygotSay.ts). `word` must match the endpoint's
// list exactly (lingua-franca-api/lib/demo-phrases.js).
export const TOUR: TourStop[] = [
  {
    name: 'Live Conversation', lang: 'French',
    main: [
      '● They:  D’où venez-vous ?',
      '      = Where are you from?',
      '○ You:   Je viens de Londres.',
      '      = I’m from London.',
    ],
    caption: 'They speak French, you read it in yours. Now answer them out loud.',
    say: { lang: 'fr', word: 'Je viens de Londres', show: 'Je viens de Londres' },
  },
  {
    name: 'Translate', lang: 'Japanese',
    main: [
      'You ask:  How much is this?',
      '▶  これはいくらですか？',
      '    koh·reh wah ee·koo·rah des·kah',
      '★ Saved to your Library',
    ],
    caption: 'Ask in your language, get it in Japanese. Try saying it.',
    say: { lang: 'ja', word: 'これはいくらですか', show: 'これはいくらですか' },
  },
  {
    name: 'Parrot Turret', lang: 'Italian',
    main: [
      '        grazie',
      '        graht·see·eh  ·  thank you',
      '',
      'PolyGot says it first…',
    ],
    caption: 'A word game you play out loud. PolyGot scores every try.',
    say: { lang: 'it', word: 'grazie', show: 'grazie' },
  },
  {
    name: 'Seasons', lang: 'Spanish',
    main: [
      'Season 1 · card 3 of 3',
      '',
      '        por favor',
      '        pohr fah·bohr  ·  please',
    ],
    caption: 'A step-by-step course: one big word at a time.',
    say: { lang: 'es', word: 'por favor', show: 'por favor' },
  },
  {
    name: 'Talk to PolyGot', lang: 'German',
    main: [
      'PolyGot:  Hallo! Was möchtest du trinken?',
      '       = Hi! What would you like to drink?',
      'You:      Einen Kaffee, bitte.',
      '       = A coffee, please.',
    ],
    caption: 'Practise a real scene out loud, one line at a time.',
    say: { lang: 'de', word: 'Einen Kaffee, bitte', show: 'Einen Kaffee, bitte' },
  },
];

/** The closing card, after the five moments. */
export const TOUR_END: TourStop = {
  name: 'That was PolyGot', lang: '',
  main: [
    '18 languages, right on your glasses.',
    '',
    'Get it:  Even Hub ▶ search PolyGot',
    'Free to install · Premium: 3 days free',
    'The link is on your phone, under Home.',
  ],
  caption: 'Made by D3 Hospitality, the people behind enkiRIDION.',
};

export const TOUR_LEN = TOUR.length + 1;          // five moments + the end card
export const tourStop = (i: number): TourStop => (i < TOUR.length ? TOUR[i] : TOUR_END);

export const TOUR_REGIONS = {
  hud: { id: 1, name: 'pg-hud' },
  main: { id: 2, name: 'pg-main' },
  caption: { id: 3, name: 'pg-cap' },
  keys: { id: 4, name: 'pg-keys' },
} as const;

export function tourHud(i: number): string {
  const s = tourStop(i);
  return i < TOUR.length ? `POLYGOT DEMO  ${i + 1}/${TOUR.length}  ·  ${s.name}  ·  ${s.lang}` : `POLYGOT DEMO  ·  ${s.name}`;
}
export function tourKeys(i: number): string {
  return i < TOUR.length ? 'Tap = next  ·  Swipe = say it again  ·  2-tap = Home' : 'Tap = back to enkiRIDION';
}
/** The first `shown` lines of a moment (the rest arrive one by one),
 *  plus the say-it status line once it is the wearer's turn. */
export function tourMain(i: number, shown: number, status = ''): string {
  const lines = tourStop(i).main.slice(0, Math.max(0, shown));
  if (status) lines.push(status);
  return lines.join('\n');
}

/** The say-it status line, in each state. */
export function sayLine(state: 'listen' | 'check' | 'hit' | 'close' | 'miss' | 'silent' | 'offline' | 'nomic', show: string, heard = ''): string {
  switch (state) {
    case 'listen':  return show ? '● Your turn: say it now' : '● Listening…';
    case 'check':   return '…  Checking';
    case 'hit':     return '★ Hit! Spot on.';
    case 'close':   return `Close!  I heard: ${heard || '…'}`;
    case 'miss':    return `I heard: ${heard || '…'}  ·  swipe to try again`;
    case 'silent':  return 'I could not hear you  ·  swipe to try again';
    case 'nomic':   return 'The mic did not open  ·  tap for next';
    default:        return 'Can’t score right now  ·  tap for next';
  }
}

export function buildTourPage(i: number, shown: number): RebuildPageContainer {
  const box = (r: { id: number; name: string }, y: number, h: number, content: string, extra: Record<string, number> = {}) =>
    new TextContainerProperty({
      xPosition: 8, yPosition: y, width: 560, height: h,
      containerID: r.id, containerName: r.name, content, isEventCapture: 0, zOrderIndex: 2 + r.id, ...extra,
    });
  const dim = (c: number): Record<string, number> => (hostSupports214 ? { textColor: c } : {});
  return new RebuildPageContainer({
    containerTotalNum: 4, listObject: [], imageObject: [],
    textObject: [
      box(TOUR_REGIONS.hud, 2, 32, tourHud(i), dim(2)),
      box(TOUR_REGIONS.main, 36, 150, tourMain(i, shown)),
      box(TOUR_REGIONS.caption, 190, 60, tourStop(i).caption, dim(2)),
      box(TOUR_REGIONS.keys, 254, 32, tourKeys(i), { isEventCapture: 1, ...dim(3) }),
    ],
  });
}
