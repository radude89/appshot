<div align="center">

# 📸 appshot

**Batch-generate beautiful App Store screenshots — free, automated, config-driven.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-automation-blueviolet?logo=playwright)](https://playwright.dev)
[![Docker](https://img.shields.io/badge/Docker-required-blue?logo=docker)](https://www.docker.com)
[![Powered by YUZU](https://img.shields.io/badge/Powered%20by-YUZU%20AppScreen-orange)](https://github.com/YUZU-Hub/appscreen)

*One config file. One command. Every locale. Every device size.*

</div>

---

## What is appshot?

appshot automates [YUZU AppScreen](https://github.com/YUZU-Hub/appscreen) (open-source, MIT) via [Playwright](https://playwright.dev) to produce pixel-perfect, framed App Store screenshots at scale — gradient backgrounds, 2D device frames, localized headlines — for every locale and device size at once.

No subscriptions. No manual work. No paid services.

```
6 screens × 6 locales × 4 device sizes = 144 screenshots in one run
```

---

## Features

| | |
|---|---|
| 🎨 **Beautiful frames** | Gradient backgrounds, Bleed Bottom device position, Google Fonts |
| 🌍 **Multi-locale** | One config drives all languages — runs in parallel |
| 📱 **All device sizes** | iPhone 6.9", 6.7", iPad 12.9", 13" — custom sizes too |
| ⚙️ **Config-driven** | Everything in `config.json`: screens, titles, colors, fonts, sizes |
| 🆓 **Completely free** | Built on YUZU AppScreen (open-source) + Playwright |
| 🚀 **Fastlane-ready** | Output matches Fastlane's `deliver` directory structure |
| 🔁 **Retry logic** | Automatic recovery from browser crashes and timeouts |
| 📤 **Upload to ASC** | One command uploads to App Store Connect via fastlane deliver |

---

## How it works

```
Your raw PNGs  ──►  YUZU AppScreen (Docker)  ──►  Framed screenshots
                         ▲
                    Playwright automation
                    (driven by config.json)
```

1. **You provide** raw screenshots (one per screen per locale) and a `config.json`
2. **appshot starts** YUZU AppScreen locally via Docker
3. **Playwright drives** YUZU to apply your design: gradient background, device frame, headline text
4. **Output lands** in `fastlane/screenshots/{locale}/{DeviceSize}/` — ready to upload

---

## Requirements

- **[Docker](https://www.docker.com/)** — runs YUZU AppScreen locally
- **[Node.js](https://nodejs.org/) 18+**
- **[Git](https://git-scm.com/)** — to clone YUZU

---

## Installation

### 1. Clone appshot

```bash
git clone https://github.com/radude89/appshot.git
cd appshot
npm install
npx playwright install chromium
```

### 2. Build YUZU AppScreen (one-time setup)

```bash
git clone https://github.com/YUZU-Hub/appscreen.git /tmp/yuzu-appscreen
cd /tmp/yuzu-appscreen
docker build -t yuzu-appscreen:local .
```

---

## Quick Start

### 1. Configure

```bash
cp config.example.json config.json
```

Edit `config.json` with your app's screens and localized titles:

```json
{
  "screenshots": [
    {
      "id": "home-screen",
      "titles": {
        "en": "Everything in one place",
        "de": "Alles an einem Ort",
        "fr": "Tout en un seul endroit"
      }
    }
  ],
  "design": {
    "background": { "color1": "#F0B263", "color2": "#FFD89B", "angle": 135 },
    "text": {
      "font": "Open Sans",
      "headlineWeight": "900",
      "headlineColor": "#000000",
      "verticalOffset": 5
    }
  }
}
```

### 2. Add your raw screenshots

```
raw/                        ← iPhone screenshots
  en/
    home-screen.png         ← filename = screenshot "id" from config.json
  de/
    home-screen.png
  fr/
    home-screen.png

raw-ipad-12.9/              ← iPad 12.9" screenshots (same structure)
raw-ipad-13/                ← iPad 13" screenshots (same structure)
```

> **Tip:** The filename must exactly match the `"id"` field in your config.

### 3. Generate

```bash
# Start YUZU
docker compose up -d

# Run appshot
node generate.mjs

# Custom config
node generate.mjs --config my-app.json

# Custom YUZU URL (if not running on localhost:8080)
node generate.mjs --yuzu-url http://localhost:9090
```

### 4. Collect your screenshots

```
fastlane/screenshots/
├── en/
│   ├── iPhone_6.9_/
│   │   └── home-screen.png
│   ├── iPhone_6.7_/
│   │   └── home-screen.png
│   └── iPad_12.9_/
│       └── home-screen.png
├── de/
│   └── ...
└── fr/
    └── ...
```

---

## Upload to App Store Connect

After generating screenshots, upload them directly to App Store Connect:

### Prerequisites

- **[fastlane](https://docs.fastlane.tools/)** — `gem install fastlane`
- **App Store Connect API Key** — [Create one here](https://appstoreconnect.apple.com/access/integrations/api) (App Manager role)

### Setup

Place your `.p8` key file in the standard location:

```bash
mkdir -p ~/.appstoreconnect/private_keys
cp AuthKey_XXXXXXXXXX.p8 ~/.appstoreconnect/private_keys/
```

### Option 1: Config-driven (recommended)

Add the `upload` section to your `config.json`:

```json
{
  "upload": {
    "appId": "com.example.myapp",
    "keyId": "XXXXXXXXXX",
    "issuerId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

Then run:

```bash
./upload.sh
```

### Option 2: CLI flags

```bash
./upload.sh --app-id com.example.myapp --key-id XXXXXXXXXX --issuer-id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Option 3: Environment variables

```bash
export ASC_APP_ID=com.example.myapp
export ASC_KEY_ID=XXXXXXXXXX
export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
./upload.sh
```

### Option 4: Full pipeline

```bash
./pipeline.sh --skip-extract --upload
```

### Upload CLI Reference

```
./upload.sh [options]

Options:
  --config <path>           Path to config file (default: config.json)
  --key-id <id>             App Store Connect API Key ID
  --issuer-id <id>          App Store Connect Issuer ID
  --key-path <path>         Path to .p8 API key file
  --app-id <bundle-id>      App bundle identifier
  --skip-staging            Skip screenshot staging (use existing staged files)
  --dry-run                 Stage screenshots but don't upload
```

The upload script automatically maps locale directories (e.g., `en`, `de`) to App Store Connect locale codes (`en-US`, `de-DE`), flattens the device subdirectories, and invokes fastlane deliver.

---

## Configuration Reference

### `screenshots[]`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Output filename (without `.png`). Must match your raw screenshot filenames. |
| `titles` | `object` | Localized headline text. Keys are locale codes (`en`, `de`, `fr`, `es`, `it`, `ro`, …). |

### `design.background`

| Field | Type | Description |
|-------|------|-------------|
| `color1` | `string` | Gradient start color (hex, e.g. `"#F0B263"`) |
| `color2` | `string` | Gradient end color (hex) |
| `angle` | `number` | Gradient angle in degrees (e.g. `135` for diagonal) |

### `design.device`

| Field | Type | Description |
|-------|------|-------------|
| `cornerRadius` | `number` | Default corner radius for device frame (24 for iPhones, 5 for iPads) |

### `design.text`

| Field | Type | Description |
|-------|------|-------------|
| `font` | `string` | Any [Google Fonts](https://fonts.google.com) font name (e.g. `"Open Sans"`, `"Inter"`) |
| `headlineWeight` | `string` | Font weight: `"300"` Light → `"400"` Regular → `"700"` Bold → `"900"` Black |
| `headlineColor` | `string` | Headline color (hex, e.g. `"#000000"`) |
| `verticalOffset` | `number` | Text vertical position as % from top (0–100). `5` keeps text near the top. |
| `subheadline` | `boolean` | Enable/disable subheadline text (default: `false`) |

### `output.sizes[]`

| Field | Type | Description |
|-------|------|-------------|
| `device` | `string` | Human-readable label (e.g. `"iPhone 6.9\""`) |
| `width` / `height` | `number` | Output dimensions in pixels |
| `yuzuDevice` | `string` | YUZU device key — see table below |
| `rawDir` | `string` | Directory containing raw screenshots for this size |
| `cornerRadius` | `number` | *(optional)* Per-size corner radius override |
| `border` | `object` | *(optional)* Per-size border: `{ "width": 5, "color": "#8B6914", "opacity": 100 }` |

### `upload` (optional)

| Field | Type | Description |
|-------|------|-------------|
| `appId` | `string` | App bundle identifier (e.g. `"com.example.myapp"`) |
| `keyId` | `string` | App Store Connect API Key ID |
| `issuerId` | `string` | App Store Connect Issuer ID (UUID format) |
| `keyPath` | `string` | *(optional)* Path to `.p8` key file. Defaults to `~/.appstoreconnect/private_keys/AuthKey_{keyId}.p8` |

#### Supported `yuzuDevice` values

| Value | Device |
|-------|--------|
| `iphone-6.9` | iPhone 6.9" (1320×2868) |
| `iphone-6.7` | iPhone 6.7" (1290×2796) |
| `iphone-6.5` | iPhone 6.5" |
| `iphone-5.5` | iPhone 5.5" |
| `ipad-12.9` | iPad 12.9" (2048×2732) |
| `ipad-11` | iPad 11" |
| `custom` | Custom size — set `width` and `height` |

---

## CLI Reference

```
node generate.mjs [options]

Options:
  --config <path>      Path to config file (default: config.json)
  --yuzu-url <url>     YUZU AppScreen URL (default: auto-detect at localhost:8080)
```

---

## Project Structure

```
appshot/
├── generate.mjs            # Main automation engine (Playwright → YUZU)
├── upload.sh               # Upload screenshots to App Store Connect
├── config.example.json     # Template config — copy to config.json
├── docker-compose.yml      # YUZU AppScreen Docker setup
├── pipeline.sh             # End-to-end pipeline script (optional)
├── extract-screenshots.sh  # Extract raws from Xcode .xcresult bundles
├── raw/                    # Your iPhone raw screenshots (gitignored)
├── raw-ipad-12.9/          # Your iPad 12.9" raws (gitignored)
├── raw-ipad-13/            # Your iPad 13" raws (gitignored)
└── fastlane/screenshots/   # Generated output (gitignored)
```

---

## Tips & Tricks

**Use different configs for different apps**
```bash
node generate.mjs --config apps/myapp.json
node generate.mjs --config apps/otherapp.json
```

**Generate only specific sizes**  
Remove unwanted entries from `output.sizes` in your config, or create a trimmed config file.

**iPad-specific styling**  
Use per-size `cornerRadius` and `border` overrides — iPads look great with a subtle border:
```json
{
  "device": "iPad 12.9\"",
  "cornerRadius": 5,
  "border": { "width": 5, "color": "#8B6914", "opacity": 100 }
}
```

**Any Google Font works**  
Set `design.text.font` to any name from [fonts.google.com](https://fonts.google.com) — YUZU loads them automatically.

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| [YUZU AppScreen](https://github.com/YUZU-Hub/appscreen) | Open-source screenshot framing tool (runs in Docker) |
| [Playwright](https://playwright.dev) | Browser automation — drives YUZU headlessly |
| [Docker](https://www.docker.com) | Runs YUZU AppScreen as a local web service |
| [Node.js](https://nodejs.org) | Runtime for the automation engine |
| [fastlane](https://docs.fastlane.tools) | *(optional)* Uploads screenshots to App Store Connect |

---

## License

MIT © [Radu Dan](https://github.com/radude89)

---

<div align="center">

Built with ❤️ for indie iOS developers tired of manual screenshot work.

**[⭐ Star on GitHub](https://github.com/radude89/appshot)** if appshot saves you time!

</div>
