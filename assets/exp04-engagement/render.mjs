// Renders the review frames for the Engagement panel prototype.
// Usage: node assets/exp04-engagement/render.mjs   (Chromium from PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers)
// Each frame is captured at its full drawer height so the owner sees the whole panel in one image.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/user/Paige-Agent-AI/node_modules/playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const page_url = pathToFileURL(path.join(here, 'prototype.html')).href;
const FRAMES = [
  ['populated', 'desktop', 'light'], ['populated', 'desktop', 'dark'],
  ['populated', 'mobile', 'light'], ['populated', 'mobile', 'dark'],
  ['early', 'desktop', 'light'], ['nozone', 'desktop', 'light'], ['empty', 'desktop', 'light'],
  ['error', 'desktop', 'light'], ['refused', 'desktop', 'light'],
  // extra, for review only
  ['loading', 'desktop', 'light'], ['early', 'mobile', 'dark'],
];
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
// The repo's playwright expects a newer browser build than the one preinstalled; resolve the
// installed Chromium like scripts/live-drive does (PW_EXECUTABLE_PATH, then a /opt/pw-browsers scan).
import fs from 'node:fs';
function resolveChromium() {
  if (process.env.PW_EXECUTABLE_PATH) return process.env.PW_EXECUTABLE_PATH;
  const root = '/opt/pw-browsers';
  for (const dir of (fs.existsSync(root) ? fs.readdirSync(root) : []).sort().reverse()) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const p = path.join(root, dir, rel); if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}
const browser = await chromium.launch({ executablePath: resolveChromium(), proxy, args: ['--ignore-certificate-errors'] });
const report = [];
for (const [state, view, theme] of FRAMES) {
  const width = view === 'mobile' ? 390 : 1440;
  const ctx = await browser.newContext({ viewport: { width, height: view === 'mobile' ? 844 : 900 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${page_url}?state=${state}&theme=${theme}&view=${view}&bare=1&motion=0`, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => errors.push('nav:' + e.message));
  await page.evaluate(() => document.fonts.ready);
  const fontOk = await page.evaluate(() => document.fonts.check('600 16px "Schibsted Grotesk"'));
  // Grow the viewport to the drawer's full content height (header + scroll body).
  const full = await page.evaluate(() => {
    const head = document.querySelector('.d-head'), body = document.querySelector('.d-body');
    return Math.ceil((head?.offsetHeight || 0) + (body?.scrollHeight || 0));
  });
  const height = Math.min(Math.max(view === 'mobile' ? 844 : 900, full), 6000);
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(150);
  // Layout probes: horizontal overflow anywhere inside the drawer is a defect.
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.drawer *')]
    .filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && !el.classList.contains('track'))
    .map(el => el.className || el.tagName).slice(0, 5));
  const file = `${state}-${view}-${theme}.png`;
  await page.screenshot({ path: path.join(here, file) });
  report.push({ file, height, fontOk, errors, overflow });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
