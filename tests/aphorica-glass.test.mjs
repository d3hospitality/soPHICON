import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
let published = 0;
let draft;
let transcript = "A thoughtful title";
let page;
let checks = 0;
const built = await build({
  stdin: {
    contents: `export * from './src/aphoricaGlass';export {validateEvenHubPageContainer} from '@evenrealities/even_hub_sdk';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  external: ["@evenrealities/even_hub_sdk"],
  platform: "node",
  format: "cjs",
  write: false,
  plugins: [
    {
      name: "mock-account",
      setup(b) {
        b.onLoad({ filter: /\/enkiAccount\.ts$/ }, () => ({
          contents:
            "export const authHeaders=async()=>({});export const onAccountChange=()=>{};",
          loader: "js",
        }));
        b.onLoad({ filter: /\/image-utils\.ts$/ }, () => ({
          contents: "export const pushThoughtGlobe=async()=>{};",
          loader: "js",
        }));
      },
    },
  ],
});
const channel = { id: randomUUID(), name: "Questions", followers: 0, score: 0 };
const module = { exports: {} };
async function fetchMock(url, options) {
  const body = options?.body ? JSON.parse(options.body) : null;
  let value = {};
  if (String(url).includes("transcribe")) value = { text: transcript };
  else if (body?.action === "draft") {
    draft = { ...body, revision: (draft?.revision || 0) + 1 };
    value = draft;
  } else if (body?.action === "publish") {
    published++;
    value = { id: "post" };
  } else if (String(url).includes("view=channels"))
    value = { channels: [channel] };
  else if (String(url).includes("view=me"))
    value = { user: { id: "me", username: "qa", complete: true } };
  else if (String(url).includes("view=post"))
    value = {
      post: {
        id: "post",
        title: draft.title,
        body: draft.body,
        username: "qa",
        upvotes: 0,
        downvotes: 0,
      },
      comments: [],
    };
  else if (String(url).includes("view=globe"))
    value = { total: 0, regions: [] };
  else value = { posts: [] };
  return { ok: true, json: async () => value };
}
vm.runInNewContext(built.outputFiles[0].text, {
  module,
  exports: module.exports,
  require,
  console,
  TextEncoder,
  TextDecoder,
  URL,
  URLSearchParams,
  AbortSignal,
  Date,
  setTimeout: () => 0,
  clearTimeout: () => {},
  crypto: { randomUUID },
  fetch: fetchMock,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
});
const app = module.exports;
const bridge = {
  audioControl: async () => true,
  rebuildPageContainer: async (p) => {
    const v = app.validateEvenHubPageContainer(p);
    assert.equal(v.valid, true, JSON.stringify(v));
    page = p;
    checks++;
    return true;
  },
};
test("800-character and long-word pagination loses no non-whitespace text", () => {
  for (const s of ["😀".repeat(800), "word ".repeat(160), "x".repeat(800)]) {
    const pages = app.textPages(s);
    assert.ok(pages.length > 1);
    assert.equal(pages.join("").replace(/\s/g, ""), s.replace(/\s/g, ""));
    for (const p of pages)
      for (const line of p.split("\n"))
        assert.ok(Array.from(line).length <= 42);
  }
});
test("glasses records and reviews both fields, and publishes only after explicit final confirmation", async () => {
  const glass = new app.AphoricaGlass(bridge, async () => {});
  const choose = async (label) => {
    const names = page.listObject[0].itemContainer.itemName;
    const index = names.indexOf(label);
    assert.ok(index >= 0, `${label} missing in ${names}`);
    await glass.handle({ listEvent: { currentSelectItemIndex: index } });
  };
  await glass.open();
  await choose("New thought");
  await choose("Questions");
  await choose("Record title");
  await glass.handle({ audioEvent: { audioPcm: new Uint8Array(3200) } });
  await choose("Stop & transcribe");
  assert.equal(published, 0);
  transcript = "A thought worth sharing. ".repeat(25);
  await choose("Record thought");
  await glass.handle({ audioEvent: { audioPcm: new Uint8Array(3200) } });
  await choose("Stop & transcribe");
  assert.equal(published, 0);
  await choose("Review for publication");
  assert.equal(published, 0);
  assert.ok(page.listObject[0].itemContainer.itemName[0].startsWith("Read 1/"));
  await choose("Continue to confirmation");
  assert.equal(published, 0);
  await choose("Confirm publish");
  assert.equal(published, 1);
  assert.ok(checks >= 11);
  await glass.handle({ sysEvent: { eventType: 3 } });
  await choose("Thought globe");
  assert.equal(page.imageObject.length, 2);
  assert.equal(await glass.handle({ sysEvent: { eventType: 5 } }), false);
});
