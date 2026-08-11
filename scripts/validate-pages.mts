// Offline validation harness: build every glass page the PHONE host
// will receive (hostSupports214 = true) and run the SDK 0.0.14's own
// validator over each payload. Proves menus + brightness + z-order
// valid without hardware.
// Force the phone-host path: node's UA has no "Macintosh".
import {
  validateEvenHubPageContainer, formatEvenHubPageContainerValidationError,
} from '@evenrealities/even_hub_sdk';
import {
  buildHomePage, rebuildHomePage, buildTraditionsPage,
  buildPhilosopherSelectPage, buildMindstatePage, buildQuoteViewPage,
  buildSpeakTraditionPage, buildSpeakPhilosopherPage,
  buildSpeakConversationPage, buildMindfulnessBlankPage,
  buildAphoricaPage, buildAphoricaReadPage, buildSupportPage,
  buildFavoritesEmptyPage, buildCalendarPage,
  buildCalendarDayPage, favMenu,
  BROWSABLE_TRADITIONS,
} from '../src/pages';
import { PHILOSOPHERS, getQuotePhilosophersByTradition } from '../src/constants';

const trad = BROWSABLE_TRADITIONS[0];
const phil = getQuotePhilosophersByTradition(trad)[0];
const quote = phil.quotes[0];

const pages: [string, any][] = [
  ['home (create)',        buildHomePage()],
  ['home (rebuild)',       rebuildHomePage()],
  ['philosophies',         buildTraditionsPage()],
  ['philosopher-select',   buildPhilosopherSelectPage(trad, 0)],
  ['mindstate',            buildMindstatePage(phil)],
  ['quote',                buildQuoteViewPage(phil, quote, 0, phil.quotes.length, false)],
  ['speak-traditions',     buildSpeakTraditionPage()],
  ['speak-philosophers',   buildSpeakPhilosopherPage(trad, 0)],
  ['speak-conversation',   buildSpeakConversationPage(phil.name, trad, 'A reply.', false, [], 0)],
  ['mindful-blank',        buildMindfulnessBlankPage()],
  ['aphorica',             buildAphoricaPage(['@a · SAGE (3)'], 0)],
  ['aphorica-read',        buildAphoricaReadPage('@a · SAGE', 'text', 1, 0, 0, 1, null, null, null, [], null)],
  ['support',              buildSupportPage(0)],
  ['favorites (empty)',    buildFavoritesEmptyPage()],
  ['favorites (viewer)',   buildQuoteViewPage(phil, quote, 0, 3, true, false, favMenu())],
  ['calendar',             buildCalendarPage(2026, 7, 'August 2026 · 3 active', '○ ● ● ■ ○ ○ ○', '◀ Tue 11 ◆ · 2♥ ▶')],
  ['calendar-day',         buildCalendarDayPage('11 August', ['14:32 ▶ Spoke with Socrates, 3 turns'], 0)],
];

let bad = 0;
for (const [name, page] of pages) {
  const menuCount = page?.menuObject?.menuItems?.length ?? 0;
  const r = validateEvenHubPageContainer(page);
  if (r.valid) {
    console.log(`  ok    ${name.padEnd(20)} menu=${menuCount}`);
  } else {
    bad++;
    console.log(`  FAIL  ${name.padEnd(20)} ${formatEvenHubPageContainerValidationError(r as any)}`);
  }
}
console.log(bad ? `\n${bad} INVALID PAGE(S)` : '\nall pages valid for the 2.2.9 phone host');
process.exit(bad ? 1 : 0);
