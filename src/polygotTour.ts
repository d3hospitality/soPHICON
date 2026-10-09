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

export interface TourStop { name: string; lang: string; main: string[]; caption: string }

export const TOUR: TourStop[] = [
  {
    name: 'Live Conversation', lang: 'French',
    main: [
      '● They:  D’où venez-vous ?',
      '      = Where are you from?',
      '○ You:   Je viens de Londres.',
      '● They:  Vous restez combien de temps ?',
      '      = How long are you staying?',
    ],
    caption: 'They speak French. You read it in yours, and know what to say back.',
  },
  {
    name: 'Translate', lang: 'Japanese',
    main: [
      'You ask:  How much is this?',
      '▶  これはいくらですか？',
      '    kore wa ikura desu ka?',
      '    koh·reh wah ee·koo·rah des·kah',
      '★ Saved to your Library',
    ],
    caption: 'Ask in your language. Get it in Japanese, and how to say it.',
  },
  {
    name: 'Parrot Turret', lang: 'Italian',
    main: [
      '        grazie',
      '        graht·see·eh  ·  thank you',
      'PolyGot says it first…',
      'Your turn: say it out loud.',
      '★ Hit! Spot on.',
    ],
    caption: 'A word game you play out loud. PolyGot scores every try.',
  },
  {
    name: 'Seasons', lang: 'Spanish',
    main: [
      'Season 1 · card 3 of 3',
      '',
      '        por favor',
      '        pohr fah·bohr',
      '        = please',
    ],
    caption: 'A step-by-step course: one big word at a time.',
  },
  {
    name: 'Talk to PolyGot', lang: 'German',
    main: [
      'PolyGot:  Hallo! Was möchtest du trinken?',
      '       = Hi! What would you like to drink?',
      'You:      Einen Kaffee, bitte.',
      'PolyGot:  Kommt sofort!',
      '       = Coming right up!',
    ],
    caption: 'Practise a real scene out loud, one line at a time.',
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
  return i < TOUR.length ? 'Tap = next  ·  Swipe = back/next  ·  2-tap = Home' : 'Tap = back to enkiRIDION';
}
/** The first `shown` lines of a moment (the rest arrive one by one). */
export function tourMain(i: number, shown: number): string {
  return tourStop(i).main.slice(0, Math.max(0, shown)).join('\n');
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
