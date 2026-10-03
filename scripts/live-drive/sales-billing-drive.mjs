import fs from 'node:fs';
import path from 'node:path';
import { resolvePlaywright, buildLaunchOptions } from './live-drive.mjs';
const out = path.resolve('scripts/live-drive/artifacts/sales-billing');
fs.mkdirSync(out, { recursive: true });
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const page = await browser.newPage();
const observations = [];
try {
  for (const frame of [{ width: 797, height: 770, name: '1536-closed' }, { width: 521, height: 770, name: '1536-open' }, { width: 685, height: 768, name: '1366-closed' }, { width: 439, height: 768, name: '1366-open' }, { width: 1024, height: 768, name: '1024-closed' }, { width: 1024, height: 768, name: '1024-open' }, { width: 900, height: 1000, name: '900-closed' }, { width: 900, height: 1000, name: '900-open' }]) {
    await page.setViewportSize({ width: frame.width, height: frame.height });
    await page.goto(process.env.SALES_BILLING_HARNESS_URL ?? 'http://127.0.0.1:5217/');
    await page.getByRole('tab', { name: 'Invoices', exact: true }).click();
    await page.evaluate(() => document.querySelector('[data-harness-controls]').style.display = 'none');
    await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
    await page.getByLabel('Description', { exact: true }).fill('A clear service description');
    await page.getByLabel('Unit price · USD').fill('100.00');
    await page.getByLabel('Quantity', { exact: true }).fill('2');
    const geometry = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, scrollOwners: [...document.querySelectorAll('*')].filter(el => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)).map(el => ({ class: el.className, height: el.clientHeight, scrollHeight: el.scrollHeight })), editor: document.querySelector('.sb-editor')?.getBoundingClientRect().toJSON() }));
    await page.screenshot({ path: path.join(out, `${frame.name}-editor.png`), fullPage: true });
    observations.push({ ...frame, geometry, evidence: 'isolated production components with network fixtures; not authenticated shell' });
    await page.getByRole('button', { name: 'Back to records', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.getByRole('tab', { name: 'Payments', exact: true }).click();
    await page.screenshot({ path: path.join(out, `${frame.name}-payments.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  observations.push({ reducedMotion: await page.getByRole('button', { name: 'Create invoice', exact: true }).evaluate(el => getComputedStyle(el).transitionDuration) });
} finally { await browser.close(); fs.writeFileSync(path.join(out, 'geometry.json'), JSON.stringify(observations, null, 2)); }
console.log(JSON.stringify(observations));
