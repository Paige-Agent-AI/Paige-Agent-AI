// Measurements for the Engagement panel prototype: WCAG contrast of every text/ground token
// pair the prototype uses (both themes), and a keyboard drive of the drawer.
// Usage: node assets/exp04-engagement/checks.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/user/Paige-Agent-AI/node_modules/playwright');
const here = path.dirname(fileURLToPath(import.meta.url));

const T = {
  light: { raised: '#fffdf8', well: '#f5f2ec', workspace: '#f7f4ee', ink: '#201e23', ink2: '#3d3941', muted: '#67616b', faint: '#6a646e',
    positive: '#327458', warning: '#986322', negative: '#a5483d', violet: '#655a96', line: ['#2d2832', .185], lineStrong: ['#2d2832', .28] },
  dark: { raised: '#211d27', well: '#17141b', workspace: '#16131a', ink: '#f6f2ea', ink2: '#d6d0c9', muted: '#aca69d', faint: '#969089',
    positive: '#8fd1ae', warning: '#edc17f', negative: '#eda093', violet: '#9b8de0', line: ['#f4edde', .195], lineStrong: ['#f4edde', .30] },
};
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, p) => toHex(hex(a).map((v, i) => v * p + hex(b)[i] * (1 - p))); // color-mix(in srgb, a p%, b)
const lum = h => { const [r, g, b] = hex(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

const rows = [];
for (const [theme, t] of Object.entries(T)) {
  const check = (label, fg, bg, min) => rows.push({ theme, label, fg, bg, ratio: +ratio(fg, bg).toFixed(2), min, pass: ratio(fg, bg) >= min });
  for (const ground of ['raised', 'well']) for (const k of ['ink', 'ink2', 'muted', 'faint', 'positive', 'warning', 'negative', 'violet'])
    check(`${k} on ${ground}`, t[k], t[ground], 4.5);
  for (const k of ['positive', 'warning', 'negative', 'violet']) check(`${k} chip text on its tint`, t[k], mix(t[k], t.raised, k === 'warning' ? .06 : .09), 4.5);
  check('focus ring (violet) on raised — non-text', t.violet, t.raised, 3);
  check('bar: verified segment vs track — non-text', t.positive, t.well, 3);
  check('bar: invoiced segment vs track — non-text', t.violet, t.well, 3);
  check('bar: invoiced vs verified segments — non-text', t.violet, t.positive, 1);
  check('control border (line-strong) on raised — non-text', mix(t.lineStrong[0], t.raised, t.lineStrong[1]), t.raised, 1);
}
const fails = rows.filter(r => !r.pass);

// Keyboard drive.
function resolveChromium() {
  const root = '/opt/pw-browsers';
  for (const dir of fs.readdirSync(root).sort().reverse()) for (const rel of ['chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) { const p = path.join(root, dir, rel); if (fs.existsSync(p)) return p; }
}
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || resolveChromium(), proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined, args: ['--ignore-certificate-errors'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })).newPage();
await page.goto(pathToFileURL(path.join(here, 'prototype.html')).href + '?state=populated&bare=1&motion=0');
const kb = {};
kb.scrimBlocksBackground = await page.evaluate(() => document.getElementById('clients').hasAttribute('inert'));
await page.keyboard.press('Escape');
kb.escClosesInitial = await page.evaluate(() => document.getElementById('frame').dataset.open === 'false');
await page.locator('.client-row').first().click();
kb.openFocusIsClose = await page.evaluate(() => document.activeElement?.getAttribute('data-act') === 'close');
await page.keyboard.press('Escape');
kb.escClosed = await page.evaluate(() => document.getElementById('frame').dataset.open === 'false');
kb.focusReturnedToRow = await page.evaluate(() => document.activeElement?.classList.contains('client-row'));
await page.keyboard.press('Enter');
kb.enterReopens = await page.evaluate(() => document.getElementById('frame').dataset.open === 'true');
let escaped = false;
for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => document.getElementById('drawer').contains(document.activeElement)))) { escaped = true; break; } }
kb.tabStaysInDrawer = !escaped;
await page.locator('[data-jump="delivery"]').first().focus();
await page.keyboard.press('Enter');
kb.jumpFocusesDeliveryHeading = await page.evaluate(() => document.activeElement?.id === 'h-delivery');
await page.locator('[data-rv]').count(); // toolbar is hidden in bare mode
await page.goto(pathToFileURL(path.join(here, 'prototype.html')).href + '?state=error&bare=1&motion=0');
await page.locator('[data-act="retry"]').click();
kb.retryShowsLoading = await page.evaluate(() => !!document.querySelector('[aria-busy="true"]'));
await page.waitForTimeout(1100);
kb.retryResolves = await page.evaluate(() => !!document.getElementById('sec-payments'));
await browser.close();

console.log(JSON.stringify({ contrast: { pairs: rows.length, fails, min: Object.fromEntries(Object.keys(T).map(th => [th, Math.min(...rows.filter(r => r.theme === th && r.min === 4.5).map(r => r.ratio))])) }, keyboard: kb }, null, 1));
fs.writeFileSync(path.join(here, 'contrast-results.json'), JSON.stringify(rows, null, 1));
