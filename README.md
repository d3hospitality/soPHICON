# soΦcon — soPHICON

**Philosophy on Glass** — A philosophy quote experience for Even Realities G2 smart glasses.

![Even G2](https://img.shields.io/badge/Even_G2-Compatible-green)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## Overview

soΦcon puts 2,801 philosophical quotes from 17 philosophers across 8 traditions on your glasses. Quotes auto-rotate every 33 seconds with emotion-matched pixel-art philosopher sprites. Browse by tradition and philosopher, or let wisdom find you.

## QR Code / Demos

<img width="450" height="450" alt="qrcode_d3hospitality github io" src="https://github.com/user-attachments/assets/1238a061-0499-4aff-b8c2-3a5c3748b947" />

<img width="1576" height="1069" alt="Even Hub Community (1)" src="https://github.com/user-attachments/assets/70f9df35-104e-45a9-bc32-b06229d947a1" />
<img width="1576" height="1069" alt="Even Hub Community (2)" src="https://github.com/user-attachments/assets/75728485-870c-415b-93da-a1442bbe8b43" />
<img width="1576" height="1069" alt="Even Hub Community (3)" src="https://github.com/user-attachments/assets/52ddc53d-4968-41f8-bd0f-a3eb45aa66df" />



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
