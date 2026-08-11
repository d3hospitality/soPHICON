// ═══════════════════════════════════════════════════════════════════
// English dictionary — THE SOURCE OF TRUTH for every language.
//
// Add a string here, then run:
//     node scripts/translate_ui.mjs
// which regenerates public/i18n/<lang>.json for all seven targets.
// Never hand-edit the generated files; they are overwritten.
//
// Key naming: <surface>.<thing>. Keep keys stable — the generated files
// are keyed by them, and renaming a key orphans seven translations.
//
// {placeholders} survive translation: the prompt instructs the model to
// leave them exactly as-is, and scripts/translate_ui.mjs FAILS the batch
// if a placeholder goes missing rather than shipping a broken string.
//
// GLASS STRINGS (prefix `g.`) are length-critical — they render on a
// 576×288 HUD roughly ten words wide. The generator applies a tighter
// length budget to those keys and measures the result with
// @evenrealities/pretext.
// ═══════════════════════════════════════════════════════════════════

export const EN = {
  // ─── App chrome ───────────────────────────────────────────────────
  'app.tagline': 'PHILOSOPHY · EXAMINED DAILY',
  'app.connecting': 'Connecting…',
  'app.connected': 'Connected',
  'app.disconnected': 'No glasses',
  'app.settings': 'Settings',

  // ─── Tab bar ──────────────────────────────────────────────────────
  'tab.home': 'Today',
  'tab.quotes': 'Quotes',
  'tab.mindful': 'Mindful',
  'tab.speak': 'Speak',
  'tab.journal': 'Journal',
  'tab.aphorica': 'Aphorica',
  'tab.debug': 'Debug',
  'tab.about': 'About',

  // ─── Home ─────────────────────────────────────────────────────────
  'home.todayQuote': "Today's Quote",
  'home.newQuote': 'New quote',
  'home.aphoricaFeed': 'Public Aphorica Feed',
  'home.seeAll': 'see all →',
  'home.checklist': "Today's 1-3-5",
  'home.bucketBig': '1 BIG',
  'home.bucketBigHint': 'your one heavyweight',
  'home.bucketMedium': '3 MEDIUM',
  'home.bucketMediumHint': 'substantial blocks',
  'home.bucketSmall': '5 SMALL',
  'home.bucketSmallHint': 'quick wins',
  'home.addBig': '+ add a big focus',
  'home.addMedium': '+ add a medium task',
  'home.addSmall': '+ add a small win',
  'home.habits': 'Daily Habits',
  'home.habitsEmpty': 'Long-press any action in the weekly plan to commit to it as a daily habit. Each morning, your philosopher will check in on your streak.',
  'home.onGlass': 'On Glass',
  'home.notConnected': 'Not connected',
  'home.waitingBridge': 'Waiting for bridge…',
  'home.library': 'Library',
  'home.statQuotes': 'Quotes',
  'home.statPhilosophers': 'Philosophers',
  'home.statTraditions': 'Traditions',
  'home.noConversations': 'No conversations yet today. Open Speak on the glasses to start one.',

  // ─── Language picker ──────────────────────────────────────────────
  'lang.title': 'Language',
  'lang.help': 'Changes the app, the glasses display, and the quotes.',
  'lang.phoneOnly': 'App only. The glasses stay in English',
  'lang.phoneOnlyWhy': 'The glasses firmware has no Arabic letterforms, so Arabic on the display would render blank. The app is fully Arabic; the glasses fall back to English.',
  'lang.onGlass': 'App + glasses',

  // ─── Support the dev ──────────────────────────────────────────────
  // The pill itself is deliberately NOT translated — see support.ts.
  'support.cta': 'Support the bootleg engineer →',
  'support.ctaNote': 'You choose the amount. Stripe hosts the checkout, so no card details ever touch enkiRIDION.',
  'support.cryptoHead': 'Or send crypto. Tap to copy the address',
  'support.copy': 'Copy',
  'support.copied': 'Copied',
  'support.copyFailed': 'Copy failed',
  'support.back': '← Back to Today',

  // ─── The story (generated from the authored markdown) ────────────
  // Section TITLES are stored in natural case and uppercased in CSS —
  // text-transform survives translation, a hand-uppercased string does
  // not (and German/Russian caps rules differ from English).
  'story.hook': "Built by one person, after restaurant shifts.",
  'story.i01': "Before I ask you to support anything, it is fair that you know who built this and why.",
  'story.i02': "My name is Romario. I work full time as a server in a fine dining restaurant, describing food and wine, carrying plates, resetting tables, trying to make somebody's evening feel a little more meaningful than it otherwise would have.",
  'story.i03': "Then I go home and build software.",
  'story.i04': "I am not a formally trained engineer. I studied architecture, ran a restaurant with my father, and taught myself to code because I kept having ideas for things I wanted to exist. I did not know the correct way to build them, so I built them the incorrect way until I understood enough to do better.",
  'story.i05': "A bootleg engineer.",
  'story.i06': "enkiRIDION has not really made me money. I am not saying that for sympathy. It is simply part of the accurate picture. I build it because I love building it, and because I believe Stoicism, reflective practice, and ideas from cognitive behavioral therapy can help people recognize the patterns inside their own thinking.",
  'story.i07': "It also came from my own life: setbacks, bad decisions, long stretches of uncertainty, and the particular exhaustion of having ambition while being tired.",
  'story.i08': "Somewhere in there I became aware of how often we treat human-made systems as though they were laws of nature. Schools, companies, credentialing, hiring, the unwritten rules we follow every day. All of it was made by people. Which means it can be useful, and it can also become obsolete, badly incentivized, and completely detached from the people it is supposed to serve.",
  'story.i09': "I do not think existence is proof of correctness. The AI era is going to be an asteroid for a lot of those dinosaurs. Some institutions will adapt. Others will spend years protecting processes that stopped making sense long ago.",
  'story.i10': "Much of the world is racing to automate labor, shorten attention spans, and make consumption easier. Some of that will be extraordinary. Some of it will make people feel even more disconnected from themselves. I think we should also build technology that gives people agency over their inner lives, technology that occasionally helps you stop, notice what you are thinking, and decide whether that thought deserves to control what happens next.",
  'story.i11': "That is why I built enkiRIDION.",

  'story.s1.t': "Philosophy as something you actually use",
  'story.s1.p01': "Philosophy is usually presented in the least inviting way possible: a shelf of difficult books, a few famous quotes, and the vague sense that wisdom is in there somewhere. Most people do not need another list of books they feel guilty about. They need a place to begin, and the right question while the problem is still happening.",
  'story.s1.p02': "So enkiRIDION contains 2,801 quotes I personally read, rated, and tagged, one at a time, trying to understand what state of mind each one actually speaks to. You can talk with 17 philosophers, write privately, and turn something you said mid-conversation into an action you return to later.",
  'story.s1.p03': "The goal is not to imitate a dead philosopher perfectly. It is to put enough friction between you and your automatic thinking that you see the situation differently. Sometimes that takes Marcus Aurelius. Sometimes Nietzsche. Sometimes a Sumerian god asking why you keep avoiding something you already know you need to do.",
  'story.s1.p04': "It runs on your phone and on Even Realities glasses, because I wanted reflection to exist somewhere other than another glowing rectangle. Not a feed. Just a thought arriving when it might be useful.",
  'story.s1.p05': "This is not therapy, and I am not a therapist. It is built for the person with five quiet minutes: before work, after an argument, before a decision they will live with for years. Sometimes five honest minutes change the direction of a day. That is the whole bet.",

  'story.s2.t': "Before you support anything",
  'story.s2.p01': "This page is not the Sage membership. Sage is $8 per month and it is the straightforward way enkiRIDION supports itself. Honestly, I would rather you spend your money there than here.",
  'story.s2.p02': "This page is optional and it buys you nothing. No badge, no unlock, no secret philosopher, no priority, no influence over what I build. If you are already a Sage member, contributing here gets you nothing extra. Saying all of this immediately before a support button is probably not advanced sales strategy. That is fine. I wanted the truth on the record first.",

  'story.s3.t': "What remains free",
  'story.s3.p01': "The free version is not a trap or a disguised trial. All 2,801 quotes are browsable without paying and they do not expire. I am not going to wait until you build a habit around them and then move them behind a paywall.",
  'story.s3.p02': "You also get one conversation a day with Enki. If that is all you ever use, that is a completely valid way to use this. The point is to help you reflect, not to irritate you until paying is the easiest way to make the irritation stop.",

  'story.s4.t': "Why it is called enkiRIDION",
  'story.s4.p01': "Epictetus never wrote a book. He taught, and his student Arrian wrote down what he heard. That became the *Enchiridion*, usually translated \"handbook,\" though it means something closer to *held in the hand*. Enki was the Sumerian god of wisdom, water, and craft. Put them together and you get enkiRIDION: a handbook that talks back.",
  'story.s4.p02': "Enki is the first figure you meet, because the hardest question in philosophy is also the simplest. Where do I even begin? Most products answer that with a library. Here are the Stoics, here are 500 books, good luck. I wanted someone to meet you at the entrance instead.",

  'story.s5.t': "What building it actually took",
  'story.s5.p01': "There is no team. No investor, no content staff, no design agency, no philosophy board, no growth strategist. There is me, a laptop, restaurant shifts, and whatever is left of the night.",
  'story.s5.p02': "I read, rated, tagged, and categorized all 2,801 quotes. I created 391 portraits, 17 philosophers across 23 emotional states, because the face speaking to you should not stay frozen while the conversation changes. That meant mapping every portrait to an emotional state and building the logic that decides when it shifts.",
  'story.s5.p03': "I built the apps, the web experience, the backend, the journal, authentication, subscriptions, the quote system, the voice system, and the glasses version. Some of them worked badly. Some only worked on my machine.",
  'story.s5.p04': "At one point I wrote a custom PNG encoder from scratch, because the glasses firmware silently rejected images from standard libraries. No error, no warning, just a blank display. The image worked everywhere else. So I rebuilt the pipeline, twice, and started reading file format specs I never expected to need. Eventually the screen showed an image. That is the clearest summary of this whole thing: build with incomplete knowledge, watch it fail, understand one more layer, build it again.",

  'story.s6.t': "Where the money goes",
  'story.s6.p01': "Every voice conversation has a real cost. Transcription, the reply, the emotional read that keeps the exchange coherent. And the infrastructure has to stay online whether or not anyone pays. Sage memberships cover some of that. Not all of it yet.",
  'story.s6.p02': "Anything contributed here goes to the unexciting things that must keep working: servers, model usage, transcription, developer accounts, app store fees. After that it buys the resource I have least of.",
  'story.s6.p03': "Time. More nights where I keep building this instead of setting it aside for something more immediately profitable. There is always a more practical project available. Support gives me room to keep choosing this one.",

  'story.s7.t': "What your support does not buy",
  'story.s7.p01': "It does not buy control over the product. It does not make your opinion count more than someone using the free version, and it does not move your feature request ahead of anyone else's.",
  'story.s7.p02': "I will listen to feedback and I care a great deal about what people experience here. But support is not ownership, and I do not want to quietly create that expectation.",
  'story.s7.p03': "A tip jar that gives nothing back is probably worse business than one full of badges, tiers, and carefully designed social pressure. There are smarter ways to do this. I would rather have a page I can explain in one sentence: you supported the person building it. That is all.",

  'story.s8.t': "Why any of this exists",
  'story.s8.p01': "enkiRIDION does not need to transform your life to justify existing. Most meaningful things do not work that way.",
  'story.s8.p02': "Sometimes a tool matters because it changes one morning. A sentence reaches you at the right hour. A question interrupts a bad decision long enough to reconsider it.",
  'story.s8.p03': "If it has ever done that for you, that is enough, and you owe me nothing for it. Genuinely. Close this page and keep using the app. The free quotes stay free, and Enki will be there tomorrow.",
  'story.s8.p04': "But if you would still like to throw something in the hat, the button is at the top. You choose the amount. It goes to one person who will almost certainly spend it on API credits at two in the morning, then stay awake testing whether a philosopher's face looks appropriately disappointed. Thank you for reading this far. Most people will not.",

  'story.signName': "Romario",
  'story.signRole': "Server by trade. Bootleg engineer by necessity.",

  // ─── About ────────────────────────────────────────────────────────
  'about.blurb': 'Philosophy on Glass. 2,801 quotes across 17 philosophers and 8 traditions.',
  'about.offline': 'Everything works offline as a Seeker. Link your glasses below and your Today list, habits, and weekly plan stay in step with the enkiRIDION Android app and enkiridion.com.',
  'about.profile': 'Your Profile',
  'about.data': 'Data',
  'about.clearConvos': 'Clear all conversation history',
  'about.appLog': 'App log',

  // ─── Glass (length-critical) ──────────────────────────────────────
  'g.speak': 'enkiSPEAKS',
  'g.aphorica': 'Public Aphorica',
  'g.shuffleAll': 'Shuffle All',
  'g.philosophies': 'Philosophies',
  'g.support': 'Support the dev',
  'g.supportHeader': 'enkiRIDION · SUPPORT THE DEV',
  'g.back': '‹ Back',
  'g.noPhilosophers': '(no philosophers)',
  'g.noMembers': '(no members yet)',
  'g.thinking': 'Thinking…',
  'g.listening': 'Listening…',
  'g.tapToSpeak': 'Tap to speak',
  'g.finishOnWeb': 'Finish on enkiridion.com →',

  // ─── Glass Support story: EIGHT pages, one screen each ───────────
  // PURE NARRATIVE. No subscription pitch, no cost accounting, no
  // justification for asking. The wearer tapped a row called Support
  // the dev; what earns that is the story, not a case for the money.
  // The ask lives on the phone, which is the only surface that can
  // actually take it.
  //
  // Deliberately NOT the phone story. The glass is the glance tier
  // (docs/TRANSLATION-SYSTEM.md): it earns attention and hands off,
  // and it cannot take money at all. A 33-page letter here was web
  // parity chasing, which is the drift that doc exists to prevent.
  // Each string is exactly one page and must fit 7 lines at 528px;
  // scripts/translate_ui.mjs enforces that per language.
  'g.story1': "Built by one person, after restaurant shifts. I’m Romario. I slang hummus at a Michelin-level restaurant, then go home and build this with whatever is left of me.",
  'g.story2': "I am not a trained engineer. I studied architecture, ran a restaurant with my father, and taught myself to code because I kept imagining things that did not exist yet. A bootleg engineer.",
  'g.story3': "enkiRIDION came out of my own life. Setbacks, bad decisions, missed chances, and the particular exhaustion of still wanting more from yourself when you are already tired.",
  'g.story4': "Somewhere in there, I stopped believing the systems around us were permanent. Schools, credentials, hiring, status, all the unwritten rules. People made them. People can be wrong. Existence is not proof of correctness.",
  'g.story5': "Philosophy is usually handed to you after the battle, as a shelf of difficult books and a list of dead names. I wanted it beside you while the problem was still happening, before fear, anger, or doubt made the decision for you.",
  'g.story6': "So I built a system around 2,801 quotes and created 391 portraits of 17 philosophers across 23 emotional states, so the face speaking to you changes when the conversation does.",
  'g.story7': "I wanted reflection to live somewhere other than another glowing rectangle asking for more of your attention. Not a feed. Not a notification. Just a thought arriving while you might still be able to do something with it.",
  'g.story8': "If one quote reached you before you gave up, that was already enough. I am still building because my war is not over. The rest of the story, and the tip jar, are on your phone.",

  // ─── Contextual menu labels (SDK 0.0.14) ─────────────────────────
  // VERBS ONLY — an action item gives no state feedback, so every label
  // is a command. HARD LIMIT: 32 UTF-8 bytes (CJK ≈ 10 glyphs); an
  // over-long label rejects the whole page and blanks the glasses, so
  // translate_ui.mjs refuses to ship one and menu() in pages.ts
  // byte-truncates as a last-resort runtime guard.
  'g.menuHome': 'Go home',
  'g.menuSurprise': 'Surprise me',
  'g.menuFavorite': 'Save to favorites',
  'g.menuSpeakThis': 'Speak with this philosopher',
  'g.menuEndConvo': 'End conversation',
  'g.menuRefresh': 'Refresh feed',
  'g.menuDevStory': 'Read the dev story',
  'g.menuNewMindful': 'New mindful quote',
  'g.menuTipJar': 'Open tip jar on phone',
  'g.menuRestartStory': 'Restart story',

  // ─── 1.7.0: favorites page · calendar · captures ──────────────────
  'g.favTitle': 'Favorites',
  'g.favEmpty': 'No favorites yet. Open any quote, tap and hold, then Save to favorites.',
  'g.favPos': '{i} of {n}',
  'g.calActive': '{n} active',
  'g.calStreak': '{n}-day streak',
  'g.calLegend': '○ quiet · ● activity · ◆ today',
  'g.calNoActivity': 'Nothing this month yet.',
  'g.calEmptyDay': 'Nothing kept this day.',
  'g.calSpoke': 'Spoke with {name}, {n} turns',
  'g.calLogged': 'Reply from {name}',
  'g.calLiked': 'Liked @{name}',
  'g.likeDone': '♥ Liked',
  'g.likeLinkFirst': 'Link your glasses on the phone to like',
  'g.likeFailed': 'Like failed, try again',
  'g.replyLogged': '● Logged to your journal',

  // 1.7.0 menu verbs (32-byte cap enforced like the rest)
  'g.menuShowFavorites': 'Show favorites',
  'g.menuShowCalendar': 'Show calendar',
  'g.menuLikePost': 'Like this post',
  'g.menuLogReply': 'Log this reply',
  'g.menuUnfavorite': 'Remove from favorites',
  'g.menuCalToday': 'Go to today',

  'g.pagePrev': 'swipe up',
  'g.pageNext': 'click for more',
  'g.pageEnd': 'end. Full story + tip jar on your phone.',

} as const;

export type Dict = Record<keyof typeof EN, string>;
export type DictKey = keyof typeof EN;
