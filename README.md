# appshot

> Batch-generate beautiful App Store screenshots for every locale and device size — free, automated, config-driven.

appshot automates [YUZU AppScreen](https://github.com/YUZU-Hub/appscreen) (open-source, MIT) via Playwright to produce framed App Store screenshots with gradient backgrounds, 2D device frames, and localized headlines. One config file. One command. All 144 screenshots.

## Features

- **Config-driven** — all settings in `config.json`: screenshots, locales, sizes, colors, fonts
- **Multi-locale** — generates screenshots for every language in parallel
- **All device sizes** — iPhone 6.9", iPhone 6.7", iPad 12.9", iPad 13" (custom size support)
- **Beautiful frames** — gradient backgrounds, Bleed Bottom device position, custom fonts via Google Fonts
- **Free** — built on YUZU AppScreen (open-source) + Playwright, no paid services
- **Fastlane-ready** — output organized as `fastlane/screenshots/{locale}/{DeviceSize}/`

## Requirements

- [Docker](https://www.docker.com/) — to run YUZU AppScreen locally
- [Node.js](https://nodejs.org/) 18+
- [Playwright](https://playwright.dev/) (installed via npm)

## Setup

### 1. Build YUZU AppScreen Docker image

```bash
git clone https://github.com/YUZU-Hub/appscreen.git /tmp/yuzu-appscreen
cd /tmp/yuzu-appscreen
docker build -t yuzu-appscreen:local .
```

### 2. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 3. Configure

```bash
cp config.example.json config.json
```

Edit `config.json`:
- Add your screenshots under `"screenshots"` — one entry per screen, with localized titles
- Set your `"design"` preferences (colors, font, text position)
- Configure `"output.sizes"` for the device sizes you need

### 4. Add raw screenshots

Place your raw (unframed) screenshots in the raw directories:

```
raw/                  # iPhone screenshots
  en/
    screen-1.png      # filename must match screenshot "id" in config.json
    screen-2.png
  de/
    screen-1.png
    ...
raw-ipad-12.9/        # iPad 12.9" screenshots (same structure)
raw-ipad-13/          # iPad 13" screenshots (same structure)
```

### 5. Start YUZU and generate

```bash
# Start YUZU
docker compose up -d

# Generate all screenshots
node generate.mjs

# Or with a custom config
node generate.mjs --config my-app-config.json
```

## Output

Screenshots are saved to `fastlane/screenshots/{locale}/{DeviceSize}/`:

```
fastlane/screenshots/
├── en/
│   ├── iPhone_6.9_/
│   │   ├── screen-1.png
│   │   └── screen-2.png
│   └── iPad_12.9_/
│       └── ...
├── de/
│   └── ...
└── ...
```

## Configuration Reference

| Field | Description |
|-------|-------------|
| `screenshots[].id` | Filename (without extension) for the output screenshot |
| `screenshots[].titles` | Localized headline text per locale code |
| `design.background.color1/2` | Gradient start/end colors (hex) |
| `design.background.angle` | Gradient angle in degrees |
| `design.device.cornerRadius` | Device frame corner radius (default: 24 for iPhones) |
| `design.text.font` | Google Fonts font name |
| `design.text.headlineWeight` | Font weight: 300–900 |
| `design.text.headlineColor` | Headline color (hex) |
| `design.text.verticalOffset` | Text vertical position (0–100%) |
| `output.sizes[].yuzuDevice` | YUZU device key: `iphone-6.9`, `iphone-6.7`, `ipad-12.9`, `ipad-11`, `custom` |
| `output.sizes[].rawDir` | Directory containing raw screenshots for this size |
| `output.sizes[].cornerRadius` | Per-size corner radius override |
| `output.sizes[].border` | Per-size border: `{ width, color, opacity }` |

## CLI Options

```
node generate.mjs [--config path/to/config.json] [--yuzu-url http://localhost:8080]
```

## License

MIT
