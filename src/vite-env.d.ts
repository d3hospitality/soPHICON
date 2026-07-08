/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" enables the dev-only G2 UX Lab (see docs/G2_UX_LAB.md). */
  readonly VITE_G2_UX_LAB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
