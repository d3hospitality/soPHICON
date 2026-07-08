// ═══════════════════════════════════════════════════════════════════
// G2 rendering adapter (src/g2/adapter.ts)
//
// A thin, disciplined seam between app code and the Even bridge. The
// SDK contract this encodes (see CONTEXT.md + docs/TRANSLATION-SYSTEM.md):
//
//   1. createStartUpPageContainer is called EXACTLY ONCE per session —
//      every later page change goes through rebuildPageContainer.
//   2. Bridge calls must be SERIALIZED — never two concurrent calls,
//      especially image pushes (0.5–2s each over BLE).
//   3. Rebuild only when the page LAYOUT changes; frequent text-only
//      changes should use textContainerUpgrade (cheap, no re-layout).
//   4. Image pushes are queued behind page calls so a rebuild never
//      races its own portrait.
//
// Today the adapter is used by the UX-lab surfaces (state machine pages,
// Home Glance refresh). The 23 direct rebuildPageContainer call sites in
// events.ts are the production-migration target — see docs/G2_UX_LAB.md.
// ═══════════════════════════════════════════════════════════════════

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';

type PageObject = any; // CreateStartUpPageContainer | RebuildPageContainer

/** Geometry-only signature of a page: same signature ⇒ same layout ⇒
 * a rebuild can be downgraded to textContainerUpgrade calls. */
function layoutSignature(page: PageObject): string {
  const sig: string[] = [];
  const walk = (arr: any[] | undefined, kind: string) => {
    for (const c of arr ?? []) {
      sig.push(`${kind}:${c.containerID}@${c.xPosition},${c.yPosition},${c.width},${c.height}`);
    }
  };
  walk(page?.textObject, 't');
  walk(page?.listObject, 'l');
  walk(page?.imageObject, 'i');
  return sig.sort().join('|');
}

export class G2Adapter {
  private bridge: EvenAppBridge;
  private queue: Promise<unknown> = Promise.resolve();
  private startupDone = false;
  private currentPageName = '';
  private currentSignature = '';

  constructor(bridge: EvenAppBridge) {
    this.bridge = bridge;
  }

  /** Serialize any bridge work. All adapter methods flow through here. */
  enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn); // keep the chain alive after errors
    this.queue = next.catch((e) => console.error(`[g2adapter] ${label}`, e));
    return next;
  }

  /** First page of the session. Safe to call defensively: if startup
   * already happened, this degrades to a rebuild. */
  ensureStartup(pageName: string, page: PageObject): Promise<number> {
    return this.enqueue('startup', async () => {
      if (this.startupDone) {
        const r = await (this.bridge as any).rebuildPageContainer(page);
        this.noteShown(pageName, page);
        return r as number;
      }
      const result = await (this.bridge as any).createStartUpPageContainer(page);
      this.startupDone = true;
      this.noteShown(pageName, page);
      return result as number;
    });
  }

  /** Show a page. Rebuilds only when the layout actually changed;
   * same-layout calls are downgraded to per-container text upgrades. */
  showPage(pageName: string, page: PageObject): Promise<void> {
    return this.enqueue(`showPage:${pageName}`, async () => {
      const sig = layoutSignature(page);
      if (sig && sig === this.currentSignature && pageName === this.currentPageName) {
        // Same geometry — cheap path: push text content only.
        for (const t of page?.textObject ?? []) {
          await (this.bridge as any).textContainerUpgrade({
            containerID: t.containerID, containerName: t.containerName, content: t.content,
          });
        }
        return;
      }
      await (this.bridge as any).rebuildPageContainer(page);
      this.noteShown(pageName, page);
    });
  }

  /** Frequent text updates on the current page (e.g. streaming reply). */
  updateText(containerID: number, containerName: string, content: string): Promise<void> {
    return this.enqueue(`text:${containerID}`, async () => {
      await (this.bridge as any).textContainerUpgrade({ containerID, containerName, content });
    });
  }

  /** Queue an image push behind whatever page work is in flight.
   * The push function receives the bridge so existing image-utils
   * helpers (pushSpriteSingle / pushSpritesSplit / …) slot in as-is. */
  queueImage(label: string, push: (bridge: EvenAppBridge) => Promise<void>): Promise<void> {
    return this.enqueue(`image:${label}`, () => push(this.bridge));
  }

  get pageName(): string { return this.currentPageName; }
  get hasStarted(): boolean { return this.startupDone; }

  /** Mark startup as already performed elsewhere (Main.ts boot path),
   * so a lab adapter created later never double-calls startup. */
  adoptExistingStartup(pageName: string): void {
    this.startupDone = true;
    this.currentPageName = pageName;
    this.currentSignature = '';
  }

  private noteShown(pageName: string, page: PageObject): void {
    this.currentPageName = pageName;
    this.currentSignature = layoutSignature(page);
  }
}
