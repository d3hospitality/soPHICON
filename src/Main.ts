// ═══════════════════════════════════════════════════════════════════
// soΦcon — Boot (src/Main.ts)
//
// The single entry point called from index.html. Responsibilities:
//   1. Wait for the Even App WebView bridge to attach
//   2. Pull user + device info, subscribe to connect/battery changes
//   3. Call createStartUpPageContainer ONCE with the home page
//      (SDK contract — subsequent page changes use rebuildPageContainer
//      inside events.ts)
//   4. Push the splash logo images to the glass
//   5. Register event handlers (routing lives in events.ts)
//   6. Write a version marker to bridge.setLocalStorage
//
// Keep this file small. Anything more complex belongs in a focused
// module so reviewers can read the boot sequence at a glance.
// ═══════════════════════════════════════════════════════════════════

import { waitForEvenAppBridge, DeviceConnectType } from '@evenrealities/even_hub_sdk';
import { buildHomePage, loadGlanceLine } from './pages';
import { pushLogoToGlasses } from './image-utils';
import { registerEventHandlers, repaintGlassForLanguage, openFavoritesPage, openCalendarPage, openLanguagePage, surpriseFromQA } from './events';
import { setStatus, setBattery, log } from './ui';
import { TOTAL_QUOTES, TOTAL_PHILOSOPHERS, TOTAL_TRADITIONS } from './constants';
import { initDashboard } from './dashboard';
import { initFavorites } from './favorites';
import { initWisdomLog } from './wisdomlog';
import { initLang, glassLang, onLangChange } from './i18n';

async function main(): Promise<void> {
  log("Initializing...");
  setStatus("connecting", "Waiting for bridge...");

  const bridge = await waitForEvenAppBridge();
  log("Bridge ready", "success");

  // ── Validation tripwire (SDK 0.0.14) ─────────────────────────────
  // The SDK now validates menus, brightness, and z-order BEFORE calling
  // native: createStartUpPageContainer returns invalid (1) and
  // rebuildPageContainer returns false, and the page silently never
  // reaches the glasses — which looks exactly like a firmware fault.
  // events.ts has ~30 rebuild call sites that historically ignore the
  // return value; wrapping the bridge once here makes every silent
  // failure loud without touching any of them.
  {
    const origRebuild = bridge.rebuildPageContainer.bind(bridge);
    bridge.rebuildPageContainer = async (container) => {
      const ok = await origRebuild(container);
      if (!ok) {
        log("rebuildPageContainer REJECTED — page never reached the glasses (check menu labels / textColor / zOrder)", "error");
        console.error("[SDK] rejected payload:", container);
      }
      return ok;
    };
  }

  const user = await bridge.getUserInfo();
  log("User: " + user.name);

  const device = await bridge.getDeviceInfo();
  if (device) {
    log("Device: " + device.model + " (" + device.sn + ")");
    if (device.status?.isConnected()) {
      setStatus("connected");
      setBattery(device.status.batteryLevel);
    }
  } else {
    setStatus("disconnected", "No glasses");
  }

  bridge.onDeviceStatusChanged((status) => {
    if (status.connectType === DeviceConnectType.Connected) {
      setStatus("connected");
      setBattery(status.batteryLevel);
      log("Connected — battery " + status.batteryLevel + "%", "success");
    } else if (status.connectType === DeviceConnectType.Disconnected) {
      setStatus("disconnected");
      log("Disconnected", "error");
    } else if (status.connectType === DeviceConnectType.Connecting) {
      setStatus("connecting");
    }
  });

  // Language BEFORE the first page is built: the home list labels come
  // from the dictionary, so a page built ahead of this would be frozen
  // in English until something forced a rebuild.
  const picked = await initLang(bridge);
  log(`Language: ${picked}${glassLang() !== picked ? ` (glasses: ${glassLang()})` : ''}`);

  // Favorites + wisdom log BEFORE the first page: the quote page's ♥
  // mark and the calendar read these, and the 1.6.0 bug was exactly
  // this call being missing — toggles wrote to an unloaded store.
  await initFavorites(bridge);
  await initWisdomLog(bridge);

  // Glance line for the Home page — cached by the companion sync into
  // bridge.localStorage. Best-effort; empty when nothing is synced.
  try { await loadGlanceLine(bridge); } catch { /* render without it */ }

  // One webapp, two faces (the TEMPO contract): in the Even App this
  // drives the glasses; in a plain browser the same bundle is just the
  // dashboard. A failed glass boot must therefore DEGRADE, not abort —
  // the early `return` here used to kill initDashboard in every plain
  // browser once SDK 0.0.14 started validating create calls ("Startup
  // failed: 1" and a dead page with tabs that never wire up).
  const baseUrl = import.meta.env.BASE_URL;
  let glassAlive = false;
  const homePage = buildHomePage();
  const result = await bridge.createStartUpPageContainer(homePage);
  if (result !== 0) {
    log("Glass startup failed (" + result + ") — phone dashboard only", "error");
  } else {
    glassAlive = true;
    log("Home page created", "success");
    try {
      await new Promise(r => setTimeout(r, 500));
      await pushLogoToGlasses(bridge, baseUrl);
      log("Logo pushed", "success");
    } catch (err) {
      log("Logo not loaded: " + err, "error");
    }
    registerEventHandlers(bridge, baseUrl);
    log("Events active", "success");
  }

  // QA deep-link: ?glass=favorites|calendar jumps straight to a page
  // whose only production entrance is the contextual menu — which the
  // desktop simulator cannot open (no tap-and-hold in its automation
  // API, pre-2.2.9 protocol). Not persisted, harmless in production.
  try {
    const qa = new URLSearchParams(location.search);
    // &seed=1 (DEV BUILDS ONLY — import.meta.env.DEV is false in the
    // packed .ehpk, so this is unreachable in production) writes a few
    // favorites / wisdom entries / one journal session so the populated
    // states can be exercised in the simulator, where the contextual
    // menu that normally creates them cannot be opened.
    if (import.meta.env.DEV && qa.get('seed') === '1') {
      const day = 86400000, now = Date.now();
      const seedQuotes = [
        'I cannot teach anybody anything, I can only make them think.',
        'You have power over your mind - not outside events. Realize this, and you will find strength.',
        'The impediment to action advances action. What stands in the way becomes the way.',
      ];
      await bridge.setLocalStorage('enki_favorites', JSON.stringify([
        { t: seedQuotes[0], ts: now - 2 * day },
        { t: seedQuotes[1], ts: now - day },
        { t: seedQuotes[2], ts: now },
      ]));
      await bridge.setLocalStorage('wisdom_log', JSON.stringify([
        { ts: now - 2 * day, kind: 'fav', text: seedQuotes[0], who: 'Socrates', trad: 'Greek' },
        { ts: now - day, kind: 'reply', text: 'Lower the bucket slowly. The well is deep.', who: 'Enki', trad: 'Primordial' },
        { ts: now, kind: 'fav', text: seedQuotes[2], who: 'Marcus Aurelius', trad: 'Stoicism' },
        { ts: now, kind: 'like', text: 'The obstacle is the tuition.', who: 'romario' },
      ]));
      await bridge.setLocalStorage('speak_journal', JSON.stringify([{
        date: new Date(now - day).toISOString().slice(0, 10),
        philId: 'marcus_aurelius', philName: 'Marcus Aurelius', tradition: 'Stoicism',
        startTs: now - day, endTs: now - day + 600000,
        exchanges: [
          { role: 'user', content: 'How do I stop postponing?' },
          { role: 'assistant', content: 'Stop arguing about what a good man is. Be one.' },
        ],
      }]));
      const { initFavorites: reFav } = await import('./favorites');
      const { initWisdomLog: reWl } = await import('./wisdomlog');
      await reFav(bridge); await reWl(bridge);
      log('[QA] seeded favorites + wisdom + journal');
    }
    const jump = glassAlive ? qa.get('glass') : null;
    if (jump === 'favorites') await openFavoritesPage(bridge, baseUrl);
    else if (jump === 'calendar') await openCalendarPage(bridge, true);
    else if (jump === 'language') await openLanguagePage(bridge);
    else if (jump === 'surprise') await surpriseFromQA(bridge, baseUrl);
  } catch { /* QA hook only */ }

  // Phone-side dashboard (tabs, live glass-state mirror, sprite debug)
  await initDashboard(bridge, baseUrl);

  // A language switch on the phone has to reach the glass too — the
  // wearer changed it expecting both surfaces to follow.
  onLangChange(() => { repaintGlassForLanguage(bridge, baseUrl).catch(() => {}); });

  await bridge.setLocalStorage("sophicon_version", "0.1.0");
  log(`soΦcon v0.1.0 — ${TOTAL_QUOTES} quotes · ${TOTAL_PHILOSOPHERS} philosophers · ${TOTAL_TRADITIONS} traditions`, "success");
}

main().catch((err) => {
  log("Fatal: " + err, "error");
  console.error(err);
});
