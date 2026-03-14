#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════════════════════
# soΦcon — One-Button Deploy
# Philosophy on Glass for Even Realities G2
# ════════════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$HOME/sophicon"
JSON_FILE="$SCRIPT_DIR/assets/quotes.json"
SPRITES_DIR="$SCRIPT_DIR/sprites"

echo ""
echo "  ╔════════════════════════════════════════════════════════════════╗"
echo "  ║  soΦcon — Philosophy on Glass                                ║"
echo "  ║  Deploy Pipeline                                             ║"
echo "  ╚════════════════════════════════════════════════════════════════╝"
echo ""

# ── Kill existing dev server ──
pkill -f "vite" 2>/dev/null || true
sleep 1

# ── Clean slate ──
rm -rf "$PROJECT"
mkdir -p "$PROJECT/src" "$PROJECT/scripts" "$PROJECT/assets" "$PROJECT/public/assets" "$PROJECT/public/sprites"

# ── Copy scripts ──
cp "$SCRIPT_DIR/scripts/generate_constants.py" "$PROJECT/scripts/"

# ── Generate constants.ts from JSON ──
echo "  [1/7] Generating quote data from JSON..."
if [ -f "$JSON_FILE" ]; then
    python3 "$PROJECT/scripts/generate_constants.py" "$JSON_FILE" "$PROJECT/src/constants.ts"
    echo "        ✓ constants.ts generated"
else
    echo "        ✗ JSON file not found: $JSON_FILE"
    echo "        Using bundled constants.ts instead..."
    if [ -f "$SCRIPT_DIR/src/constants.ts" ]; then
        cp "$SCRIPT_DIR/src/constants.ts" "$PROJECT/src/constants.ts"
        echo "        ✓ Using fallback constants.ts"
    else
        echo "        ✗ No constants.ts available!"
        exit 1
    fi
fi

# ── Copy sprites into public/ so Vite serves them ──
echo "  [2/7] Copying sprite assets..."
if [ -d "$SPRITES_DIR" ]; then
    cp -r "$SPRITES_DIR"/* "$PROJECT/public/sprites/" 2>/dev/null || true
    SPRITE_COUNT=$(find "$PROJECT/public/sprites" -name "*.png" | wc -l)
    PHIL_COUNT=$(find "$PROJECT/public/sprites" -mindepth 1 -maxdepth 1 -type d | wc -l)
    echo "        ✓ $SPRITE_COUNT sprites across $PHIL_COUNT philosophers"
else
    echo "        - No sprites directory found (sprites are optional)"
fi

# ── Copy source files ──
echo "  [3/7] Installing source files..."
cp "$SCRIPT_DIR/package.json"    "$PROJECT/package.json"
cp "$SCRIPT_DIR/tsconfig.json"   "$PROJECT/tsconfig.json"
cp "$SCRIPT_DIR/vite.config.ts"  "$PROJECT/vite.config.ts"
cp "$SCRIPT_DIR/index.html"      "$PROJECT/index.html"
cp "$SCRIPT_DIR/app.json"        "$PROJECT/app.json"
cp "$SCRIPT_DIR/src/Main.ts"     "$PROJECT/src/Main.ts"
cp "$SCRIPT_DIR/src/pages.ts"    "$PROJECT/src/pages.ts"
cp "$SCRIPT_DIR/src/events.ts"   "$PROJECT/src/events.ts"
cp "$SCRIPT_DIR/src/ui.ts"       "$PROJECT/src/ui.ts"
cp "$SCRIPT_DIR/src/image-utils.ts"  "$PROJECT/src/image-utils.ts"
cp "$SCRIPT_DIR/src/pngEncoder.ts"   "$PROJECT/src/pngEncoder.ts"
cp "$SCRIPT_DIR/src/favorites.ts"    "$PROJECT/src/favorites.ts"
cp "$SCRIPT_DIR/src/style.css"       "$PROJECT/src/style.css"
echo "        ✓ Source files ready"

# ── Copy JSON to assets ──
echo "  [4/7] Bundling quote data..."
if [ -f "$JSON_FILE" ]; then
    cp "$JSON_FILE" "$PROJECT/assets/quotes.json"
    echo "        ✓ quotes.json bundled"
fi

# ── Copy logo into public/ for Vite ──
echo "  [5/7] Bundling assets..."
mkdir -p "$PROJECT/public/assets"
cp "$SCRIPT_DIR"/assets/soPHICON-Top-Logo-200x100.png "$PROJECT/public/assets/" 2>/dev/null || true
echo "        ✓ Logo asset bundled"

# ── Install dependencies ──
echo "  [6/7] Installing dependencies..."
cd "$PROJECT"
npm install --silent 2>&1 | tail -1
echo "        ✓ Dependencies installed"

# ── Count quotes ──
QUOTE_COUNT=$(grep -c '"text"' "$PROJECT/src/constants.ts" 2>/dev/null || echo "?")

# ── Summary ──
echo ""
echo "  [7/7] Build Summary"
echo "  ╔════════════════════════════════════════════════════════════════╗"
echo "  ║  soΦcon v0.1.0                                               ║"
echo "  ║  $QUOTE_COUNT quotes loaded                                       ║"
echo "  ╠════════════════════════════════════════════════════════════════╣"
echo "  ║  Navigation:                                                  ║"
echo "  ║    Home → Tradition → Philosopher → Book → Quote View        ║"
echo "  ║                                                               ║"
echo "  ║  Traditions:                                                  ║"
echo "  ║    Stoicism · Greek · Epicureanism · Taoism                  ║"
echo "  ║    Confucianism · Buddhist · Vedanta · Islamic               ║"
echo "  ║                                                               ║"
echo "  ║  Controls:                                                    ║"
echo "  ║    Scroll       = navigate / browse quotes                   ║"
echo "  ║    Single tap   = select / favorite                          ║"
echo "  ║    Double tap   = go back                                    ║"
echo "  ║    Auto-rotate  = new quote every 33 seconds                 ║"
echo "  ╠════════════════════════════════════════════════════════════════╣"
echo "  ║  Quote View Layout:                                           ║"
echo "  ║    [header] Philosopher — emotion                             ║"
echo "  ║    [sub]    Book · ★ rarity · ♥ fav                         ║"
echo "  ║    [text]   \"Quote text...\"                                  ║"
echo "  ║    [sprite] Emotion-matched pixel art face                   ║"
echo "  ╚════════════════════════════════════════════════════════════════╝"
echo ""

# ── Launch ──
echo "  Starting dev server..."
echo ""
cd "$PROJECT"
npx vite --host
