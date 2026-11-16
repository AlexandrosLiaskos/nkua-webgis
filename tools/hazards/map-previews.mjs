// Produce the homepage image assets from the collection map interfaces.
// Social artwork is generated separately by sharing.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.NODE_PATH, 'playwright'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.env.PREVIEW_BASE_URL || 'http://127.0.0.1:58712';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const slug of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await page.goto(`${base}/${slug}/`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.locator('#loading.hidden').waitFor({ state: 'attached', timeout: 120000 });
    await page.locator('.leaflet-marker-icon').first().waitFor({ state: 'visible', timeout: 120000 });
    await page.locator('#close-welcome').click();
    await page.locator('#welcome-modal').waitFor({ state: 'hidden', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(root, 'sites', slug, 'map-preview.jpg'), type: 'jpeg', quality: 93, animations: 'disabled' });
    await page.close();
    process.stdout.write(`${slug} homepage map preview created\n`);
  }
} finally {
  await browser.close();
}
