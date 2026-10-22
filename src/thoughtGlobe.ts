// Shared with the website: the Sommni-derived renderer is packaged as a local ES module.
export function thoughtGlobeModule(): Promise<any> {
  const url = new URL('aphorica/atlas/globe.mjs', document.baseURI).href;
  return import(/* @vite-ignore */ url);
}
