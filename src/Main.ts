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
import { registerEventHandlers, repaintGlassForLanguage } from './events';
import { setStatus, setBattery, log } from './ui';
import { TOTAL_QUOTES, TOTAL_PHILOSOPHERS, TOTAL_TRADITIONS } from './constants';
import { initDashboard } from './dashboard';
import { initLang, glassLang, onLangChange } from './i18n';

async function main(): Promise<void> {
  log("Initializing...");
  setStatus("connecting", "Waiting for bridge...");

  const bridge = await waitForEvenAppBridge();
  log("Bridge ready", "success");

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

  // Glance line for the Home page — cached by the companion sync into
  // bridge.localStorage. Best-effort; empty when nothing is synced.
  try { await loadGlanceLine(bridge); } catch { /* render without it */ }

  const homePage = buildHomePage();
  const result = await bridge.createStartUpPageContainer(homePage);
  if (result !== 0) {
    log("Startup failed: " + result, "error");
    return;
  }
  log("Home page created", "success");

  const baseUrl = import.meta.env.BASE_URL;
  try {
    await new Promise(r => setTimeout(r, 500));
    await pushLogoToGlasses(bridge, baseUrl);
    log("Logo pushed", "success");
  } catch (err) {
    log("Logo not loaded: " + err, "error");
  }

  registerEventHandlers(bridge, baseUrl);
  log("Events active", "success");

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
