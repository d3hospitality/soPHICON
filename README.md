# soΦcon — soPHICON

**Philosophy on Glass** — A philosophy quote experience for Even Realities G2 smart glasses.

![Even G2](https://img.shields.io/badge/Even_G2-Compatible-green)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## Overview

soΦcon puts 2,801 philosophical quotes from 17 philosophers across 8 traditions on your glasses. Quotes auto-rotate every 33 seconds with emotion-matched pixel-art philosopher sprites. Browse by tradition and philosopher, or let wisdom find you.

## Features

- 📜 **2,801 quotes** across 32 books and 8 philosophical traditions
- 🎭 **Emotion-reactive sprites** — pixel-art philosopher faces change with each quote's emotion
- ⭐ **Rarity system** — Legendary/Epic/Rare/Uncommon/Common tiers
- 🔄 **Auto-rotation** — new quote every 33 seconds
- ♥ **Favorites** — save quotes you love
- 👁️ **Reactive hover** — scrolling philosophers shows their face in real-time
- 💍 **Ring navigation** with scroll and click

## Controls

| Page | Single Click | Double Click | Scroll |
|------|-------------|--------------|--------|
| Home | Select tradition | — | Navigate |
| Philosophers | Select philosopher | ‹ Back | Navigate + preview sprite |
| Books | Select book / All | ‹ Back | Navigate |
| Quote View | ♥ Favorite | ‹ Back | Browse quotes |

## Navigation

```
Home (Traditions) → Philosopher → Book Select → Quote View
                                    ↑ "All Quotes" option
```

## Traditions

Greek Philosophy · Stoicism · Epicureanism · Taoism · Confucianism · Buddhist Philosophy · Vedanta · Islamic Philosophy

## Development

```bash
git clone https://github.com/d3hospitality/soPHICON.git
cd soPHICON
npm install
npm run dev
```

### Deploy

```bash
./deploy.sh
```

## Tech Stack

- **Vite + TypeScript**
- **@evenrealities/even_hub_sdk** for G2 integration
- **Custom grayscale PNG encoder** for sprite rendering

---

*Built for the Even Realities G2 smart glasses*
*Part of the d3hospitality ecosystem*

MIT © D3 Hospitality
