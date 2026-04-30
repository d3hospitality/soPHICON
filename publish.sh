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

# Defensive: clear any stale git index lock left over from a crashed
# git operation in a previous shell. Only deletes if it's older than
# 30 seconds AND zero-byte (a real running git op would have a fresh
# non-empty lock). Prevents the "fatal: Unable to create .git/index.lock"
# trap that bites every time the previous publish was interrupted.
if [ -f .git/index.lock ]; then
  if [ ! -s .git/index.lock ] && [ -z "$(find .git/index.lock -mmin -0.5 2>/dev/null)" ]; then
    echo "  ⚠  removing stale .git/index.lock (zero-byte, older than 30s)"
    rm -f .git/index.lock
  else
    echo "  ⚠  .git/index.lock exists and looks active — bailing out"
    echo "     If you're sure no git is running:  rm -f .git/index.lock"
    exit 1
  fi
fi

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
