// ═══════════════════════════════════════════════════════════════════
// soΦcon — Page Builders v8
// All pages max 4 containers. Speak conversation uses list for
// Speak/Back buttons instead of double-tap.
// ═══════════════════════════════════════════════════════════════════

import {
  CreateStartUpPageContainer, RebuildPageContainer,
  ListContainerProperty, TextContainerProperty,
  ImageContainerProperty, ListItemContainerProperty,
} from '@evenrealities/even_hub_sdk';
import {
  TRADITIONS, Tradition, Philosopher, Quote,
  getPhilosophersByTradition,
  getRarity, getRaritySymbol,
  capitalize, formatTag,
  getEmotionsForPhilosopher, getTagsForPhilosopher,
} from './constants';

// ══════════════════════════════════════════════════════════════════
// S1 — HOME (4 containers)
// ══════════════════════════════════════════════════════════════════

export const HOME_LIST_ITEMS = ["soPHICON Speaks", ...TRADITIONS];
export const SPEAK_INDEX = 0;

function homeContainers() {
  const title = new TextContainerProperty({
    xPosition: 390, yPosition: 220, width: 150, height: 50,
    containerID: 1, containerName: "title",
    content: "G2 Enchiridion",
    isEventCapture: 0,
  });
  const traditions = new ListContainerProperty({
    xPosition: 75, yPosition: 20, width: 225, height: 255,
    containerID: 2, containerName: "traditions",
    itemContainer: new ListItemContainerProperty({
      itemCount: HOME_LIST_ITEMS.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: [...HOME_LIST_ITEMS],
    }),
    isEventCapture: 1,
  });
  const logoTop = new ImageContainerProperty({
    xPosition: 350, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "logo top",
  });
  const logoBottom = new ImageContainerProperty({
    xPosition: 350, yPosition: 120, width: 200, height: 100,
    containerID: 10, containerName: "logo bottom",
  });
  return { title, traditions, logoTop, logoBottom };
}

export function buildHomePage(): CreateStartUpPageContainer {
  const c = homeContainers();
  return new CreateStartUpPageContainer({
    containerTotalNum: 4,
    listObject: [c.traditions],
    textObject: [c.title],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

export function rebuildHomePage(): RebuildPageContainer {
  const c = homeContainers();
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [c.traditions],
    textObject: [c.title],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// S2 — PHILOSOPHER SELECT (4 containers)
// ══════════════════════════════════════════════════════════════════

export function buildPhilosopherSelectPage(tradition: Tradition): RebuildPageContainer {
  const philosophers = getPhilosophersByTradition(tradition);
  const header = new TextContainerProperty({
    xPosition: 350, yPosition: 225, width: 200, height: 30,
    containerID: 1, containerName: "header",
    content: tradition, isEventCapture: 0,
  });
  const listItems = [...philosophers.map(p => p.name), "Back"];
  const philosopherList = new ListContainerProperty({
    xPosition: 75, yPosition: 20, width: 225, height: 255,
    containerID: 2, containerName: "philosophers",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });
  const portraitTop = new ImageContainerProperty({
    xPosition: 350, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "portrait",
  });
  const portraitBottom = new ImageContainerProperty({
    xPosition: 350, yPosition: 120, width: 200, height: 100,
    containerID: 11, containerName: "portrait-2",
  });
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [philosopherList],
    textObject: [header],
    imageObject: [portraitTop, portraitBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// S3 — MINDSTATE BROWSE (4 containers)
// ══════════════════════════════════════════════════════════════════

export function buildMindstatePage(philosopher: Philosopher): RebuildPageContainer {
  const emotions = getEmotionsForPhilosopher(philosopher);
  const tags = getTagsForPhilosopher(philosopher, 8);
  const allCount = philosopher.quotes.length;

  const header = new TextContainerProperty({
    xPosition: 350, yPosition: 225, width: 200, height: 30,
    containerID: 1, containerName: "header",
    content: philosopher.name, isEventCapture: 0,
  });
  const listItems: string[] = [`Shuffle (${allCount})`];
  for (const e of emotions) {
    if (listItems.length >= 18) break;
    const count = philosopher.quotes.filter(q => q.emotion === e).length;
    listItems.push(`${capitalize(e)} (${count})`);
  }
  for (const t of tags) {
    if (listItems.length >= 18) break;
    const count = philosopher.quotes.filter(q => q.tags.includes(t)).length;
    listItems.push(`On ${formatTag(t)} (${count})`);
  }
  listItems.push("Back");

  const mindList = new ListContainerProperty({
    xPosition: 75, yPosition: 20, width: 225, height: 255,
    containerID: 2, containerName: "mindstates",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });
  const portraitTop = new ImageContainerProperty({
    xPosition: 350, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "portrait",
  });
  const portraitBottom = new ImageContainerProperty({
    xPosition: 350, yPosition: 120, width: 200, height: 100,
    containerID: 12, containerName: "portrait-2",
  });
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [mindList],
    textObject: [header],
    imageObject: [portraitTop, portraitBottom],
  });
}

export function getMindstateSelections(philosopher: Philosopher): {
  type: "shuffle" | "emotion" | "tag" | "back";
  value: string;
}[] {
  const emotions = getEmotionsForPhilosopher(philosopher);
  const tags = getTagsForPhilosopher(philosopher, 8);
  const sel: { type: "shuffle" | "emotion" | "tag" | "back"; value: string }[] = [];
  sel.push({ type: "shuffle", value: "" });
  for (const e of emotions) { if (sel.length >= 18) break; sel.push({ type: "emotion", value: e }); }
  for (const t of tags) { if (sel.length >= 18) break; sel.push({ type: "tag", value: t }); }
  sel.push({ type: "back", value: "" });
  return sel;
}

// ══════════════════════════════════════════════════════════════════
// S4 — QUOTE VIEW (3 containers)
// ══════════════════════════════════════════════════════════════════

export function buildQuoteViewPage(
  philosopher: Philosopher,
  quote: Quote,
  quoteIndex: number,
  totalQuotes: number,
  isFavorite: boolean = false,
  isShuffleMode: boolean = false,
): RebuildPageContainer {
  const rarity = quote.rarity || getRarity(quote.rating);
  const favMark = isFavorite ? " ♥" : "";
  const titleCase = (s: string) => s.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  const quoteText = new TextContainerProperty({
    xPosition: 180, yPosition: 55, width: 370, height: 100,
    containerID: 2, containerName: "quote",
    content: `"${quote.text}"`,
    isEventCapture: 1,
  });

  const sprite = new ImageContainerProperty({
    xPosition: 75, yPosition: 55, width: 100, height: 100,
    containerID: 3, containerName: "sprite",
  });

  const pos = String(quoteIndex + 1).padStart(3, '0');
  const tot = String(totalQuotes).padStart(3, '0');
  const line1 = `${pos}/${tot} - ${capitalize(quote.emotion)}${favMark}`;
  const line2 = `${philosopher.name}, ${quote.source}`;
  const filled = '\u2605'.repeat(quote.rating);
  const outline = '\u2606'.repeat(10 - quote.rating);
  const line3 = `${capitalize(String(rarity))} - ${quote.rating} ${filled}${outline}`;

  const tagParts: string[] = [];
  const used = new Set<string>();
  if (quote.blend) { const b = titleCase(quote.blend); tagParts.push(b); used.add(b.toLowerCase()); }
  if (quote.archetype) { const a = titleCase(quote.archetype); if (!used.has(a.toLowerCase())) { tagParts.push(a); used.add(a.toLowerCase()); } }
  for (const t of quote.tags) { const d = titleCase(t); if (!used.has(d.toLowerCase())) { tagParts.push(d); used.add(d.toLowerCase()); } if (tagParts.length >= 5) break; }
  const line4 = tagParts.length > 0 ? '\u00B7 ' + tagParts.join(' \u00B7 ') : '';

  const labelContent = [line1, line2, line3, line4].filter(Boolean).join('\n');

  const infoText = new TextContainerProperty({
    xPosition: 75, yPosition: 161, width: 475, height: 115,
    containerID: 13, containerName: "text-3",
    content: labelContent,
    isEventCapture: 0,
  });

  // Hidden spacer to keep containerTotalNum at 4
  const spacer = new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 20, height: 20,
    containerID: 4, containerName: "spacer",
    content: "", isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [],
    textObject: [quoteText, infoText, spacer],
    imageObject: [sprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// SPEAK — TRADITION SELECT (4 containers, mirrors home layout)
// ══════════════════════════════════════════════════════════════════

export function buildSpeakTraditionPage(): RebuildPageContainer {
  const title = new TextContainerProperty({
    xPosition: 390, yPosition: 220, width: 150, height: 50,
    containerID: 1, containerName: "title",
    content: "soPHICON Speaks",
    isEventCapture: 0,
  });
  const tradList = new ListContainerProperty({
    xPosition: 75, yPosition: 20, width: 225, height: 255,
    containerID: 2, containerName: "traditions",
    itemContainer: new ListItemContainerProperty({
      itemCount: TRADITIONS.length + 1, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: [...TRADITIONS, "Back"],
    }),
    isEventCapture: 1,
  });
  const logoTop = new ImageContainerProperty({
    xPosition: 350, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "logo top",
  });
  const logoBottom = new ImageContainerProperty({
    xPosition: 350, yPosition: 120, width: 200, height: 100,
    containerID: 10, containerName: "logo bottom",
  });
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [tradList],
    textObject: [title],
    imageObject: [logoTop, logoBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// SPEAK — PHILOSOPHER SELECT (4 containers, IDs 1-4)
// ══════════════════════════════════════════════════════════════════

export function buildSpeakPhilosopherPage(tradition: Tradition): RebuildPageContainer {
  const philosophers = getPhilosophersByTradition(tradition);
  const header = new TextContainerProperty({
    xPosition: 350, yPosition: 225, width: 200, height: 30,
    containerID: 1, containerName: "header",
    content: `Speak: ${tradition}`, isEventCapture: 0,
  });
  const listItems = [...philosophers.map(p => p.name), "Back"];
  const philosopherList = new ListContainerProperty({
    xPosition: 75, yPosition: 20, width: 225, height: 255,
    containerID: 2, containerName: "philosophers",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });
  const portrait = new ImageContainerProperty({
    xPosition: 400, yPosition: 70, width: 100, height: 100,
    containerID: 3, containerName: "portrait",
  });
  const branding = new TextContainerProperty({
    xPosition: 350, yPosition: 180, width: 200, height: 30,
    containerID: 4, containerName: "branding",
    content: "soPHICON Speaks",
    isEventCapture: 0,
  });
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [philosopherList],
    textObject: [header, branding],
    imageObject: [portrait],
  });
}

// ══════════════════════════════════════════════════════════════════
// SPEAK — CONVERSATION (4 containers, IDs 1-4)
//   1 = emotion portrait 100x100 (reactive)
//   2 = response text (big, scrollable via list)
//   3 = Speak/Stop button
//   4 = tradition label (lower-right)
// Double-tap = back. No back button needed.
// ══════════════════════════════════════════════════════════════════

export const SPEAK_ACTION_SPEAK = 0;

export function buildSpeakConversationPage(
  philosopherName: string,
  tradition: string,
  responseText: string,
  isListening: boolean = false,
): RebuildPageContainer {
  // 1: Emotion portrait — left side
  const portrait = new ImageContainerProperty({
    xPosition: 75, yPosition: 20, width: 100, height: 100,
    containerID: 1, containerName: "portrait",
  });

  // 2: Big response text
  const displayText = isListening
    ? "Listening..."
    : `${philosopherName}: ${responseText}`;

  const responseBox = new TextContainerProperty({
    xPosition: 180, yPosition: 20, width: 380, height: 210,
    containerID: 2, containerName: "response",
    content: displayText,
    isEventCapture: 0,
  });

  // 3: Speak/Stop button — bottom left
  const speakLabel = isListening ? "Stop" : "Speak";
  const speakButton = new ListContainerProperty({
    xPosition: 75, yPosition: 235, width: 200, height: 30,
    containerID: 3, containerName: "speak-btn",
    itemContainer: new ListItemContainerProperty({
      itemCount: 1, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: [speakLabel],
    }),
    isEventCapture: 1,
  });

  // 4: Tradition label — lower right
  const traditionLabel = new TextContainerProperty({
    xPosition: 400, yPosition: 240, width: 160, height: 25,
    containerID: 4, containerName: "tradition",
    content: tradition,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [speakButton],
    textObject: [responseBox, traditionLabel],
    imageObject: [portrait],
  });
}
