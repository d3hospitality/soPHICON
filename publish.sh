#!/usr/bin/env bash
# publish.sh — one-command deploy for soPHICON.
# Run this on your Mac (the sandbox can commit + build but can't auth to push).
#
#   ./publish.sh
#
# Prereqs on your machine:
#   - git with your github.com creds cached (gh auth login or SSH key)
#   - node + npm
#   - vercel CLI:  npm i -g vercel   (only needed the first time)

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo ""
echo "========================================"
echo "  1/4  push main to origin"
echo "========================================"
git push origin main

echo ""
echo "========================================"
echo "  2/4  install + build"
echo "========================================"
npm install
npm run build

echo ""
echo "========================================"
echo "  3/4  deploy dist -> gh-pages branch"
echo "========================================"
# Blow away any stale gh-pages worktree cache so we always start clean.
rm -rf node_modules/.cache/gh-pages
npx gh-pages -d dist -m "publish: $(git log -1 --format=%s main)"

echo ""
echo "========================================"
echo "  4/4  deploy Vercel API"
echo "========================================"
cd "$ROOT/sophicon-api"
vercel --prod
cd "$ROOT"

echo ""
echo "  done."
echo "  glasses app:  https://d3hospitality.github.io/soPHICON/"
echo "  api:          printed by vercel above"
echo ""
