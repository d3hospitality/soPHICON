#!/usr/bin/env python3
"""
soPHICON — Quote Data Generator
Reads the pipeline JSON and generates constants.ts for the G2 glasses app.

Usage:
    python generate_constants.py /path/to/quotes.json /path/to/output/constants.ts
"""

import sys
import json
from pathlib import Path

# Rarity color map (for G2 display, these are grayscale intensity hints)
RARITY_ORDER = ["legendary", "epic", "rare", "uncommon", "common"]


def load_data(json_path: str) -> dict:
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def generate_typescript(data: dict) -> str:
    meta = data.get("_meta", {})
    
    # Collect all traditions, philosophers, quotes
    traditions = []
    all_philosophers = []
    all_quotes = []
    phil_id_map = {}  # name -> phil_id
    
    for tradition_name, tdata in data.items():
        if tradition_name == "_meta":
            continue
        traditions.append(tradition_name)
        
        for phil_name, pdata in tdata["philosophers"].items():
            # Get phil_id from first quote
            phil_id = None
            emotions_set = set()
            phil_quotes = []
            books = list(pdata["books"].keys())
            
            for book_name, bdata in pdata["books"].items():
                for q in bdata["quotes"]:
                    if phil_id is None:
                        phil_id = q.get("phil_id", phil_name.lower().replace(" ", "_"))
                    emotions_set.add(q.get("emotion", "contemplation"))
                    phil_quotes.append({
                        "text": q["text"],
                        "rating": q.get("rating", 5),
                        "rarity": q.get("rarity", "common"),
                        "emotion": q.get("emotion", "contemplation"),
                        "blend": q.get("blend", ""),
                        "tags": q.get("tags", []),
                        "archetype": q.get("archetype", ""),
                        "sprite": q.get("sprite", ""),
                        "book": book_name,
                        "philosopher": phil_name,
                        "tradition": tradition_name,
                        "phil_id": phil_id,
                    })
            
            phil_id_map[phil_name] = phil_id
            all_philosophers.append({
                "name": phil_name,
                "phil_id": phil_id,
                "tradition": tradition_name,
                "books": books,
                "emotions": sorted(emotions_set),
                "quoteCount": len(phil_quotes),
            })
            all_quotes.extend(phil_quotes)
    
    # Build TypeScript
    lines = [
        "// ═══════════════════════════════════════════════════════════════════",
        "// soΦcon — Philosophy Quote Data",
        f"// Generated from: {meta.get('prefix', 'soPHICON')}",
        f"// Total: {meta.get('total_quotes', len(all_quotes))} quotes across {meta.get('total_books', '?')} books",
        "// Do not edit manually — regenerate via: python scripts/generate_constants.py",
        "// ═══════════════════════════════════════════════════════════════════",
        "",
        "export const DISPLAY = { WIDTH: 576, HEIGHT: 288 } as const;",
        "",
        "// ── Rarity tiers (display color intensities for G2 grayscale) ──",
        "export const RARITY_COLORS: Record<string, number> = {",
        '  legendary: 255,  // brightest white — GOLD equivalent',
        '  epic:      220,  // bright',
        '  rare:      180,  // medium-bright',
        '  uncommon:  140,  // medium',
        '  common:    100,  // subtle',
        "};",
        "",
        "// ── Auto-rotation interval (ms) ──",
        "export const QUOTE_ROTATION_MS = 33000;",
        "",
        "// ── Traditions ──",
        f"export const TRADITIONS = {json.dumps(traditions)} as const;",
        "export type Tradition = typeof TRADITIONS[number];",
        "",
    ]
    
    # Quote interface
    lines.extend([
        "export interface Quote {",
        "  text: string;",
        "  rating: number;",
        "  rarity: string;",
        "  emotion: string;",
        "  blend: string;",
        "  tags: string[];",
        "  archetype: string;",
        "  sprite: string;",
        "  book: string;",
        "  philosopher: string;",
        "  tradition: string;",
        "  phil_id: string;",
        "}",
        "",
    ])
    
    # Philosopher interface
    lines.extend([
        "export interface Philosopher {",
        "  name: string;",
        "  phil_id: string;",
        "  tradition: string;",
        "  books: string[];",
        "  emotions: string[];",
        "  quoteCount: number;",
        "}",
        "",
    ])
    
    # Philosophers array
    lines.append(f"export const PHILOSOPHERS: Philosopher[] = {json.dumps(all_philosophers, ensure_ascii=False)};")
    lines.append("")
    
    # Philosophers grouped by tradition
    lines.append("export const PHILOSOPHERS_BY_TRADITION: Record<string, Philosopher[]> = {")
    for tradition in traditions:
        phils = [p for p in all_philosophers if p["tradition"] == tradition]
        lines.append(f'  {json.dumps(tradition)}: {json.dumps(phils, ensure_ascii=False)},')
    lines.append("};")
    lines.append("")
    
    # All quotes array
    lines.append(f"export const ALL_QUOTES: Quote[] = {json.dumps(all_quotes, ensure_ascii=False)};")
    lines.append("")
    
    # Helper functions
    lines.extend([
        "// ── Helper Functions ──",
        "",
        "export function getQuotesForPhilosopher(name: string): Quote[] {",
        "  return ALL_QUOTES.filter(q => q.philosopher === name);",
        "}",
        "",
        "export function getQuotesForTradition(tradition: string): Quote[] {",
        "  return ALL_QUOTES.filter(q => q.tradition === tradition);",
        "}",
        "",
        "export function getPhilosophersForTradition(tradition: string): Philosopher[] {",
        "  return PHILOSOPHERS.filter(p => p.tradition === tradition);",
        "}",
        "",
        "export function getRandomQuote(philosopher?: string): Quote {",
        "  const pool = philosopher ? getQuotesForPhilosopher(philosopher) : ALL_QUOTES;",
        "  return pool[Math.floor(Math.random() * pool.length)];",
        "}",
        "",
        "export function getWeightedRandomQuote(philosopher?: string): Quote {",
        "  // Weight toward variety: avoid conviction-heavy repeats",
        "  const pool = philosopher ? getQuotesForPhilosopher(philosopher) : ALL_QUOTES;",
        "  // Boost non-conviction emotions (they're rarer)",
        "  const weighted: Quote[] = [];",
        "  for (const q of pool) {",
        "    const copies = q.emotion === 'conviction' ? 1 : 3;",
        "    for (let i = 0; i < copies; i++) weighted.push(q);",
        "  }",
        "  return weighted[Math.floor(Math.random() * weighted.length)];",
        "}",
        "",
        "export function getNeutralSprite(phil_id: string): string {",
        "  return `${phil_id}/${phil_id}-contemplation.png`;",
        "}",
        "",
        f"// Total quotes: {len(all_quotes)}",
        f"// Total philosophers: {len(all_philosophers)}",
        f"// Total traditions: {len(traditions)}",
        "",
    ])
    
    return "\n".join(lines)


def main():
    if len(sys.argv) < 3:
        print("Usage: python generate_constants.py <json_path> <output_path>")
        sys.exit(1)
    
    json_path = sys.argv[1]
    output_path = sys.argv[2]
    
    print(f"📖 Reading: {json_path}")
    data = load_data(json_path)
    
    meta = data.get("_meta", {})
    print(f"   Found {meta.get('total_quotes', '?')} quotes across {meta.get('total_books', '?')} books")
    
    print("📝 Generating TypeScript...")
    typescript = generate_typescript(data)
    
    print(f"💾 Writing: {output_path}")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(typescript)
    
    print("✅ Done!")


if __name__ == "__main__":
    main()
