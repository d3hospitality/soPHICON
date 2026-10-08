#!/usr/bin/env bash
# Build the Even Hub package WITHOUT the full sprite library.
#
# Web builds (Vercel / GitHub Pages) keep every sprite in dist/. The EHPK
# only ships each philosopher's neutral portrait as an offline floor; all
# other expressions load from Supabase Storage (src/spriteSource.ts).
#
#   scripts/pack-ehpk.sh [output.ehpk]
#
# Re-upload sprites to the backend before bumping SPRITE_VERSION.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./app.json').version")
OUT="${1:-$HOME/Desktop/enkiRIDION-${VERSION}/enkiRIDION-${VERSION}.ehpk}"
STAGE=".ehpk-stage"

npm run build >/dev/null
rm -rf "$STAGE" && cp -R dist "$STAGE"
# keep only <phil>/<phil>-neutral.png
find "$STAGE/sprites" -type f -name '*.png' ! -name '*-neutral.png' -delete
mkdir -p "$(dirname "$OUT")"
evenhub pack app.json "$STAGE" -o "$OUT" >/dev/null
echo "packed $OUT ($(du -h "$OUT" | cut -f1)), sprites kept: $(find "$STAGE/sprites" -name '*.png' | wc -l | tr -d ' ')"
