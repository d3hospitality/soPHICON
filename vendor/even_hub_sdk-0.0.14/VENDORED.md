# Why this package is vendored

SDK 0.0.14 is early-access and UNPUBLISHED — the npm registry serves
0.0.13, so `npm install @evenrealities/even_hub_sdk@0.0.14` fails.
This copy came from `even_hub_ts_sdk_0.0.14.zip` in the Contextual Menu
early-access package (issued 2026-08-07, confidential until 2026-08-15).

The zip ships only `dist/`; the package.json here was reconstructed from
the 0.0.12 registry package with a `types` field added.

When 0.0.14 (or later) lands on the registry:
  1. `npm install @evenrealities/even_hub_sdk@latest`
  2. delete this vendor directory
  3. remove the `file:` reference from package.json
