import {
  authHeaders,
  acceptPairing,
  onAccountChange,
  linkedHandle,
} from "./enkiAccount";
const escape = (s: string) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const PAIR = "https://sophicon-api.vercel.app/api/social-pair";
async function pair(body: any) {
  const r = await fetch(PAIR, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Try again.");
  return d;
}
export function initSocialCompanion() {
  const home = document.querySelector('[data-panel="home"]');
  if (!home || document.getElementById("social-pair-card")) return;
  const card = document.createElement("section");
  card.id = "social-pair-card";
  card.className = "card";
  home.prepend(card);
  let pending: any = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  try {
    pending = JSON.parse(
      localStorage.getItem("aphorica:pending-pair") || "null",
    );
  } catch {}
  async function render(message = "") {
    const handle = await linkedHandle();
    card.innerHTML = `<div class="card-body"><h2>A world of thought, on glass.</h2><p>${handle ? `Linked as @${escape(handle)}. Aphorica, conversations and saved thoughts are free.` : "Create a free account with any email. Copy one link, connect in your browser, then return here."}</p>${!handle ? `<button class="btn primary" id="social-pair-start">${pending ? "Copy my pairing link" : "Connect my account"}</button>${pending ? `<label>Hold to copy<input id="social-pair-link" readonly value="${escape(pending.url)}" style="width:100%;color:#d8bd72;background:#171813;border:1px solid #4c472e;padding:10px;margin-top:10px"/></label><p>Code: ${escape(pending.code.slice(0, 4) + "-" + pending.code.slice(4))}. Expires ${new Date(pending.expires_at).toLocaleTimeString()}.</p>` : ""}` : ""}<p role="status">${escape(message)}</p><button class="btn primary" id="social-open-app">Open Aphorica</button><button class="btn" id="social-open-web">Copy website link</button><p class="muted">On glasses: Home → Aphorica → New thought. Dictate, review, then publish.</p></div>`;
    card
      .querySelector("#social-pair-start")
      ?.addEventListener("click", async () => {
        try {
          if (!pending || Date.parse(pending.expires_at) < Date.now()) {
            pending = await pair({ action: "start" });
            localStorage.setItem(
              "aphorica:pending-pair",
              JSON.stringify(pending),
            );
          }
          await render(
            "Open this link in your browser and confirm your account.",
          );
          try {
            await navigator.clipboard.writeText(pending.url);
          } catch {
            const input =
              card.querySelector<HTMLInputElement>("#social-pair-link");
            input?.focus();
            input?.select();
          }
          schedule();
        } catch (e) {
          await render((e as Error).message);
        }
      });
    card.querySelector("#social-open-app")?.addEventListener("click", () => {
      document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="aphorica"]')?.click();
    });
    card
      .querySelector("#social-open-web")
      ?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            "https://enkiridion.com/aphorica",
          );
          await render("Copied. Open in your phone browser.");
        } catch {
          await render("Open enkiridion.com/aphorica in your browser.");
        }
      });
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(poll, 3000);
  }
  async function poll() {
    if (polling || !pending) return;
    polling = true;
    try {
      const d = await pair({
        action: "status",
        code: pending.code,
        poll: pending.poll,
      });
      if (d.state === "linked") {
        await acceptPairing(d);
        pending = null;
        localStorage.removeItem("aphorica:pending-pair");
        await render("Connected. Your account is ready on glasses.");
      } else if (d.state === "expired") {
        pending = null;
        localStorage.removeItem("aphorica:pending-pair");
        await render("That link expired. Make a fresh one.");
      } else schedule();
    } catch {
      schedule();
    } finally {
      polling = false;
    }
  }
  onAccountChange(() => {
    void render();
  });
  void render();
  if (pending) schedule();
  window.addEventListener("focus", () => {
    if (pending) void poll();
  });
}
