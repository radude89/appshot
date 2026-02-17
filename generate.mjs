#!/usr/bin/env node

/**
 * YUZU AppScreen Automation Engine
 * 
 * Generates beautifully framed App Store screenshots by automating YUZU AppScreen.
 * Reads configuration from config.json and processes raw screenshots into output directory.
 * 
 * Selectors discovered from YUZU AppScreen (https://github.com/YUZU-Hub/appscreen):
 * Verified via live exploration on 2026-02-16
 * 
 * - File upload: #file-input (hidden file input)
 * - Output size dropdown: #output-size-trigger, .device-option[data-device="iphone-6.9|iphone-6.7"]
 * - Tab navigation: button.tab[data-tab="background|screenshot|text"]
 * - Background type: #bg-type-selector button[data-type="gradient"]
 * - Gradient angle: #gradient-angle (range input)
 * - Gradient stops: #gradient-stops .gradient-stop input[type="color"]
 * - Device type: #device-type-selector button[data-type="2d"]
 * - Position presets: button.position-preset[data-preset="bleed-bottom"]
 * - Headline toggle: #headline-toggle (div.toggle)
 * - Headline text: #headline-text (textarea!)
 * - Headline font picker: #font-picker-trigger
 * - Font search: #font-search
 * - Headline weight: #headline-weight (select)
 * - Headline color: #headline-color (input color)
 * - Subheadline toggle: #subheadline-toggle
 * - Export button: #export-current
 * 
 * Usage:
 *   node generate.mjs [--config path/to/config.json] [--yuzu-url http://localhost:8080]
 * 
 * @author appshot
 * @version 1.0.0
 */

import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { mkdir, rename, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI arguments
const args = process.argv.slice(2);
const configPath = args.includes('--config') 
  ? args[args.indexOf('--config') + 1] 
  : join(__dirname, 'config.json');
const yuzuBaseUrl = args.includes('--yuzu-url')
  ? args[args.indexOf('--yuzu-url') + 1]
  : null; // Auto-detect

// Configuration
const MAX_RETRIES = 3;
const CANVAS_WAIT_MS = 2000; // Wait for canvas to render
const DOWNLOAD_TIMEOUT_MS = 30000;
const PER_SCREENSHOT_TIMEOUT_MS = 90000; // 90s max per screenshot before retry

// Load configuration
console.log(`Loading configuration from: ${configPath}`);
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

/**
 * Detect if YUZU is running locally or use live demo
 */
async function detectYuzuUrl() {
  if (yuzuBaseUrl) {
    console.log(`Using YUZU URL from CLI: ${yuzuBaseUrl}`);
    return yuzuBaseUrl;
  }

  // Try localhost first
  try {
    const response = await fetch('http://localhost:8080', { 
      method: 'HEAD',
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      console.log('✓ Using local YUZU instance at http://localhost:8080');
      return 'http://localhost:8080';
    }
  } catch (err) {
    // Localhost not available
  }

  // Fallback to live demo
  console.log('⚠ Local YUZU not available, using live demo: https://yuzu-hub.github.io/appscreen/');
  return 'https://yuzu-hub.github.io/appscreen/';
}

/**
 * Create output directory if it doesn't exist
 */
async function ensureDir(path) {
  try {
    await access(path);
  } catch {
    await mkdir(path, { recursive: true });
  }
}

/**
 * Sanitize size name for filesystem (replace " with _)
 */
function sanitizeSize(sizeName) {
  return sizeName.replace(/"/g, '_').replace(/\s+/g, '_');
}

/**
 * Get device selector attribute for YUZU size picker
 */
function getDeviceSelectorAttr(sizeName) {
  // Map "iPhone 6.9"" to "iphone-6.9"
  return sizeName.toLowerCase().replace(/\s+/g, '-').replace(/"/g, '');
}

/**
 * Wait for canvas to finish rendering
 * YUZU uses HTML Canvas which requires time to paint after settings change
 */
async function waitForCanvasRender(page) {
  // Strategy: Fixed delay + check if canvas has content
  await page.waitForTimeout(CANVAS_WAIT_MS);
  
  // Optional: Verify canvas has non-blank content
  const hasContent = await page.evaluate(() => {
    const canvas = document.getElementById('preview-canvas');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Check if at least some pixels are non-transparent
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] > 0) return true;
    }
    return false;
  });
  
  if (!hasContent) {
    console.warn('    ⚠ Canvas appears blank, waiting additional time...');
    await page.waitForTimeout(1000);
  }
}

/**
 * Remove all existing screenshots from YUZU's sidebar list.
 * YUZU persists its project state in IndexedDB across reloads, so old screenshots
 * accumulate and the wrong one can end up selected when we export.
 * Clearing the list ensures only our freshly-uploaded image is present.
 */
async function clearYuzuScreenshots(page) {
  let attempts = 0;
  while (attempts < 40) {
    const items = await page.locator('.screenshot-item:not(.upload-item)').all();
    if (items.length === 0) break;
    try {
      // Open the context menu for the first item
      const menuBtn = items[0].locator('.screenshot-menu-btn');
      await menuBtn.click({ timeout: 2000 });
      await page.waitForTimeout(150);
      // Click "Remove"
      await page.click('.screenshot-menu-item.screenshot-delete', { timeout: 2000 });
      await page.waitForTimeout(150);
    } catch {
      break; // No more items or menu not found
    }
    attempts++;
  }
}

async function uploadScreenshot(page, screenshotPath) {
  // Clear any previously loaded screenshots so only ours is in the list.
  // This prevents YUZU from exporting the wrong (previously selected) screenshot.
  await clearYuzuScreenshots(page);
  
  const fileInput = page.locator('#file-input');
  await fileInput.setInputFiles(screenshotPath);
  await page.waitForTimeout(500);
  
  // After upload, ensure the newly added item is selected.
  // (With a clean list there's only one item, but click anyway to be safe.)
  try {
    const item = page.locator('.screenshot-item:not(.upload-item)').first();
    await item.click({ timeout: 2000 });
    await page.waitForTimeout(200);
  } catch {}
}

/**
 * Select output size in YUZU
 */
async function selectOutputSize(page, size) {
  const deviceAttr = size.yuzuDevice || getDeviceSelectorAttr(size.device);
  
  // Open size dropdown
  await page.click('#output-size-trigger');
  await page.waitForTimeout(300);
  
  if (deviceAttr === 'custom') {
    // Select custom size option
    await page.click('.device-option[data-device="custom"]');
    await page.waitForTimeout(500);
    
    // Wait for custom size inputs to appear (#custom-size-inputs container)
    await page.waitForSelector('#custom-size-inputs.visible', { state: 'visible', timeout: 5000 });
    
    // Fill custom width and height using the discovered YUZU selectors
    await page.fill('#custom-width', size.width.toString());
    await page.waitForTimeout(200);
    await page.fill('#custom-height', size.height.toString());
    await page.waitForTimeout(500);
    
    // Trigger change events to ensure YUZU picks up the values
    await page.evaluate(() => {
      const w = document.getElementById('custom-width');
      const h = document.getElementById('custom-height');
      w.dispatchEvent(new Event('input', { bubbles: true }));
      w.dispatchEvent(new Event('change', { bubbles: true }));
      h.dispatchEvent(new Event('input', { bubbles: true }));
      h.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);
  } else {
    // Click the device option
    await page.click(`.device-option[data-device="${deviceAttr}"]`);
    await page.waitForTimeout(500);
  }
}

/**
 * Configure Background tab settings
 */
async function configureBackground(page, design) {
  // Switch to Background tab
  await page.click('button.tab[data-tab="background"]');
  await page.waitForTimeout(300);
  
  // Select gradient type
  await page.click('#bg-type-selector button[data-type="gradient"]');
  await page.waitForTimeout(300);
  
  // Set gradient angle
  await page.fill('#gradient-angle', design.background.angle.toString());
  await page.waitForTimeout(200);
  
  // Set gradient colors
  const stops = await page.locator('#gradient-stops .gradient-stop').all();
  if (stops.length >= 2) {
    // First color stop
    const color1Input = stops[0].locator('input[type="color"]');
    await color1Input.fill(design.background.color1);
    
    // Second color stop
    const color2Input = stops[1].locator('input[type="color"]');
    await color2Input.fill(design.background.color2);
    
    await page.waitForTimeout(200);
  }
}

/**
 * Configure Device tab settings
 */
async function configureDevice(page, design, size) {
  // Switch to Device tab (labeled "Screenshot" in YUZU)
  await page.click('button.tab[data-tab="screenshot"]');
  await page.waitForTimeout(500);
  
  // Wait for tab content to be visible
  await page.waitForSelector('#device-type-selector', { state: 'visible', timeout: 5000 });
  
  // Select 2D device type
  await page.click('#device-type-selector button[data-type="2d"]');
  await page.waitForTimeout(500);
  
  // Click "Bleed Bottom" preset (expand dropdown first)
  try {
    await page.click('#position-preset-trigger');
    await page.waitForSelector('#position-preset-content', { state: 'visible', timeout: 3000 });
    await page.click('button.position-preset[data-preset="bleed-bottom"]');
    await page.waitForTimeout(300);
  } catch (err) {
    console.log('    ⚠ Position preset not available (using default)');
  }
  
  // Set corner radius (per-size override or design default)
  const cornerRadius = size.cornerRadius ?? design.device.cornerRadius ?? 24;
  await page.evaluate((val) => {
    const el = document.getElementById('corner-radius');
    el.value = val; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, cornerRadius);
  await page.waitForTimeout(200);
  
  // Configure border if specified for this size
  if (size.border) {
    // Always enable border toggle (it resets to disabled after page reload)
    const frameToggle = page.locator('#frame-toggle');
    await frameToggle.click();
    await page.waitForTimeout(500);
    // Verify it's now active; if it was already active, clicking toggled it off — click again
    const borderActive = await frameToggle.evaluate(el => el.classList.contains('active'));
    if (!borderActive) {
      await frameToggle.click();
      await page.waitForTimeout(500);
    }
    // Set border properties via JavaScript to avoid visibility issues with collapsed sections
    await page.evaluate(({ width, color, opacity }) => {
      const wEl = document.getElementById('frame-width');
      if (wEl) { wEl.value = width; wEl.dispatchEvent(new Event('input', { bubbles: true })); }
      const cEl = document.getElementById('frame-color');
      if (cEl) { cEl.value = color; cEl.dispatchEvent(new Event('input', { bubbles: true })); }
      const oEl = document.getElementById('frame-opacity');
      if (oEl) { oEl.value = opacity; oEl.dispatchEvent(new Event('input', { bubbles: true })); }
    }, { width: size.border.width, color: size.border.color, opacity: size.border.opacity ?? 100 });
    await page.waitForTimeout(200);
  }
}

/**
 * Configure Text tab settings
 */
async function configureText(page, design, titleText) {
  // Switch to Text tab
  await page.click('button.tab[data-tab="text"]');
  await page.waitForTimeout(300);
  
  // Enable headline if not already enabled
  const headlineToggle = page.locator('#headline-toggle');
  const isEnabled = await headlineToggle.evaluate(el => el.classList.contains('active'));
  if (!isEnabled) {
    await headlineToggle.click();
    await page.waitForTimeout(500);
  }
  
  // Set headline text (using textarea, not input!)
  await page.fill('#headline-text', titleText);
  await page.waitForTimeout(300);
  
  // Set font using the font picker
  const font = design.text.font || 'Open Sans';
  await page.click('#font-picker-trigger');
  await page.waitForTimeout(200);
  
  await page.fill('#font-search', font);
  await page.waitForTimeout(300);
  
  try {
    await page.click(`.font-option:has-text("${font}")`, { timeout: 3000 });
    await page.waitForTimeout(200);
  } catch (error) {
    console.warn(`    ⚠ Could not find font "${font}", using default`);
  }
  
  // Set font weight
  const weight = design.text.headlineWeight || '900';
  await page.selectOption('#headline-weight', weight);
  await page.waitForTimeout(200);
  
  // Set text color
  await page.fill('#headline-color', design.text.headlineColor);
  await page.waitForTimeout(200);
  
  // Set text vertical offset
  const textOffsetY = design.text.verticalOffset ?? 12;
  await page.evaluate((val) => {
    const el = document.getElementById('text-offset-y');
    el.value = val; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, textOffsetY);
  await page.waitForTimeout(200);
  
  // Disable subheadline if enabled (as per design config)
  const subheadlineToggle = page.locator('#subheadline-toggle');
  const subEnabled = await subheadlineToggle.evaluate(el => el.classList.contains('active'));
  if (subEnabled) {
    await subheadlineToggle.click();
    await page.waitForTimeout(300);
  }
  
  await waitForCanvasRender(page);
}

/**
 * Export/download the framed screenshot
 */
async function exportScreenshot(page, outputPath) {
  await ensureDir(dirname(outputPath));
  
  // Set up download listener
  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS });
  
  // Click export button
  await page.click('#export-current');
  
  // Wait for download
  const download = await downloadPromise;
  
  // Save to output path
  await download.saveAs(outputPath);
}

/**
 * Process a single screenshot with retry logic.
 * Configures ALL settings per screenshot since YUZU resets device position on upload.
 */
async function processScreenshot(page, screenshot, locale, size, design, outputDir, attempt = 1) {
  const screenshotId = screenshot.id;
  const title = screenshot.titles[locale];
  const sizeRawDir = join(__dirname, size.rawDir || 'raw');
  const rawPath = join(sizeRawDir, locale, `${screenshotId}.png`);
  const sizeFolder = sanitizeSize(size.device);
  const outputPath = join(outputDir, locale, sizeFolder, `${screenshotId}.png`);
  
  const logPrefix = `  [${locale}] [${size.device}] ${screenshotId}`;
  
  try {
    // Check if raw screenshot exists
    try {
      await access(rawPath);
    } catch {
      console.error(`${logPrefix} - ✗ Raw screenshot not found: ${rawPath}`);
      return false;
    }
    
    console.log(`${logPrefix} - Processing... (attempt ${attempt}/${MAX_RETRIES})`);
    
    // Reload page to clear YUZU's screenshot list (prevents OOM from accumulation)
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await selectOutputSize(page, size);
    
    // Upload screenshot
    await uploadScreenshot(page, rawPath);
    
    // Configure all settings (YUZU resets device position on each upload)
    await configureBackground(page, design);
    await configureDevice(page, design, size);
    await configureText(page, design, title);
    
    // Export
    await exportScreenshot(page, outputPath);
    
    console.log(`${logPrefix} - ✓ Done`);
    return true;
    
  } catch (error) {
    console.error(`${logPrefix} - ✗ Error: ${error.message}`);
    
    if (attempt < MAX_RETRIES) {
      console.log(`${logPrefix} - Retrying...`);
      await page.waitForTimeout(1500);
      // Reload page to clear state on retry
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      return processScreenshot(page, screenshot, locale, size, design, outputDir, attempt + 1);
    } else {
      console.error(`${logPrefix} - ✗ Failed after ${MAX_RETRIES} attempts`);
      return false;
    }
  }
}

/**
 * Process all screenshots for a single output size
 */
async function processSize(size, yuzuUrl, config) {
  const outputDir = join(__dirname, config.output.path);
  let successCount = 0;
  let failureCount = 0;
  let browser = null;
  
  // Launch/relaunch browser for this size
  async function launchBrowser() {
    try { if (browser) await browser.close(); } catch {}
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-web-security']
    });
  }
  
  // Helper to create a fresh browser context + page with full settings configured
  async function createFreshPage() {
    try {
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        permissions: ['clipboard-read', 'clipboard-write']
      });
      const page = await context.newPage();
      await page.goto(yuzuUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      await selectOutputSize(page, size);
      return { context, page };
    } catch (err) {
      // Browser died — relaunch
      console.log(`    ℹ Browser crashed, relaunching...`);
      await launchBrowser();
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        permissions: ['clipboard-read', 'clipboard-write']
      });
      const page = await context.newPage();
      await page.goto(yuzuUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      await selectOutputSize(page, size);
      return { context, page };
    }
  }
  
  await launchBrowser();
  const isIpad = size.device.toLowerCase().includes('ipad');
  const CONTEXT_REFRESH_INTERVAL = isIpad ? 6 : 12;
  
  try {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Output Size: ${size.device} (${size.width}×${size.height})`);
    console.log('='.repeat(50));
    
    let { context, page } = await createFreshPage();
    console.log(`\nNavigating to YUZU...`);
    let processedInContext = 0;
    
    // Process each screenshot
    for (const screenshot of config.screenshots) {
      // Process each locale
      for (const locale of Object.keys(screenshot.titles)) {
        // Refresh context periodically to prevent memory/state buildup
        if (processedInContext >= CONTEXT_REFRESH_INTERVAL) {
          console.log(`    ℹ Refreshing browser context (after ${processedInContext} screenshots)...`);
          try { await context.close(); } catch {}
          ({ context, page } = await createFreshPage());
          processedInContext = 0;
        }

        let success = false;
        try {
          success = await processScreenshot(page, screenshot, locale, size, config.design, outputDir);
        } catch (fatalError) {
          // Browser context or browser died — recreate and retry
          console.log(`    ⚠ ${fatalError.message}, recovering...`);
          try { await context.close(); } catch {}
          ({ context, page } = await createFreshPage());
          processedInContext = 0;
          try {
            success = await processScreenshot(page, screenshot, locale, size, config.design, outputDir);
          } catch (retryError) {
            console.error(`    ✗ ${retryError.message}, skipping`);
            success = false;
          }
        }
        
        processedInContext++;
        if (success) {
          successCount++;
        } else {
          failureCount++;
        }
      }
    }
    
    // Close context after processing this size
    try { await context.close(); } catch {}
    
  } finally {
    try { await browser.close(); } catch {}
  }
  
  return { successCount, failureCount };
}

/**
 * Main execution
 */
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  appshot');
  console.log('  YUZU AppScreen Automation Engine');
  console.log('═══════════════════════════════════════════════════\n');
  
  // Detect YUZU URL
  const yuzuUrl = await detectYuzuUrl();
  
  // Calculate total screenshots
  const totalScreenshots = config.screenshots.length * 
                          Object.keys(config.screenshots[0].titles).length * 
                          config.output.sizes.length;
  console.log(`Configuration loaded:`);
  console.log(`  Screenshots: ${config.screenshots.length}`);
  console.log(`  Locales: ${Object.keys(config.screenshots[0].titles).length}`);
  console.log(`  Sizes: ${config.output.sizes.length}`);
  console.log(`  Total to generate: ${totalScreenshots}\n`);
  
  // Split sizes: run iPhones in parallel, iPads sequentially (large images need more memory)
  const iphoneSizes = config.output.sizes.filter(s => s.device.toLowerCase().includes('iphone'));
  const ipadSizes = config.output.sizes.filter(s => !s.device.toLowerCase().includes('iphone'));
  const sizeResults = [];
  
  if (iphoneSizes.length > 0) {
    console.log(`Wave 1 (parallel): ${iphoneSizes.map(s => s.device).join(', ')}...\n`);
    const iphoneResults = await Promise.all(
      iphoneSizes.map(size => processSize(size, yuzuUrl, config))
    );
    sizeResults.push(...iphoneResults);
  }
  
  for (const size of ipadSizes) {
    console.log(`\nWave (sequential): ${size.device}...\n`);
    const result = await processSize(size, yuzuUrl, config);
    sizeResults.push(result);
  }
  
  // Aggregate results
  const successCount = sizeResults.reduce((sum, r) => sum + r.successCount, 0);
  const failureCount = sizeResults.reduce((sum, r) => sum + r.failureCount, 0);
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('  GENERATION COMPLETE');
  console.log('═'.repeat(50));
  console.log(`  ✓ Success: ${successCount}/${totalScreenshots}`);
  console.log(`  ✗ Failures: ${failureCount}/${totalScreenshots}`);
  
  if (failureCount > 0) {
    console.log('\n⚠ Some screenshots failed to generate. Check errors above.');
    process.exit(1);
  } else {
    console.log('\n🎉 All screenshots generated successfully!');
  }
}

// Execute
main().catch(error => {
  console.error('\n✗ Fatal error:', error);
  process.exit(1);
});
