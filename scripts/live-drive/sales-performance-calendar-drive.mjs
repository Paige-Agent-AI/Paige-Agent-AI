// Synthetic presentation proof in the existing Sales mount and canonical Solo shell.
// This never uses an ordinary customer session and is not production acceptance.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolvePlaywright, buildLaunchOptions } from './live-drive.mjs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5217/performance.html');
assert(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname), 'Local fixture host only');
const output = path.resolve('scripts/live-drive/artifacts/sales-performance-calendar');
await mkdir(output, { recursive: true });
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = [];
async function record(name, run) {
  try { const detail = await run(); results.push({ name, result: 'PASS', detail }); }
  catch (error) { results.push({ name, result: 'FAIL', error: error.message }); throw error; }
}
async function openerCovered(page) {
  return page.locator('.sp-attention').evaluate(node => {
    const box = node.getBoundingClientRect();
    const x = Math.min(innerWidth - 1, box.x + box.width / 2);
    const y = Math.min(innerHeight - 1, Math.max(1, box.y + 10));
    return Boolean(document.elementFromPoint(x, y)?.closest('.tcs-paige-backdrop, .tcs-paige'));
  });
}
async function fixture(viewport, theme, paige, calendar = 'configured', reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  const url = new URL(base);
  url.searchParams.set('theme', theme); url.searchParams.set('paige', paige); url.searchParams.set('calendar', calendar);
  await page.goto(url.href);
  await page.locator('.sales-performance').waitFor();
  await page.locator('.sp-stage-bar').first().waitFor();
  await page.waitForTimeout(450);
  assert.deepEqual(pageErrors, [], 'Runtime render errors');
  return { page, context, pageErrors };
}
try {
  for (const viewport of [{ width: 1536, height: 770 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 900, height: 1000 }]) {
    for (const theme of ['light', 'dark']) for (const paige of ['closed', 'open']) {
      const name = `${viewport.width}x${viewport.height}-${theme}-paige-${paige}`;
      const { page, context, pageErrors } = await fixture(viewport, theme, paige);
      try {
        await record(name, async () => {
          const geometry = await page.evaluate(() => {
            const root = document.documentElement, results = document.querySelector('.sp-content'), panel = document.querySelector('.sales-performance');
            const box = panel.getBoundingClientRect();
            return { documentOverflow: root.scrollWidth - root.clientWidth, resultsOverflow: results.scrollHeight - results.clientHeight, panel: { x: box.x, y: box.y, width: box.width, height: box.height } };
          });
          assert(geometry.documentOverflow <= 1, 'Document horizontal overflow');
          // At narrow widths the canonical shell deliberately overlays PAIGE.
          // Use its real fold control before interacting with the covered workspace.
          const fold = page.locator('.tcs-paige-backdrop');
          const covered = await openerCovered(page);
          if (covered) {
            await page.screenshot({ path: path.join(output, `${name}-paige-overlay.png`) });
            await fold.click(); await fold.waitFor({ state: 'hidden' });
            geometry.paigeInteraction = 'Canonical overlay folded before workspace interaction';
          } else geometry.paigeInteraction = paige === 'open' ? 'Docked conversation' : 'Closed conversation';
          const opener = page.getByRole('button', { name: 'Inspect overdue balance', exact: true });
          await opener.scrollIntoViewIfNeeded(); await opener.focus(); await page.keyboard.press('Enter');
          const drawer = page.getByRole('dialog'); await drawer.waitFor();
          // Read geometry after the approved 180 ms entry transition settles.
          await page.waitForTimeout(450);
          assert((await drawer.innerText()).includes('2026-10-06 · America/Los_Angeles'), 'Server calendar text missing');
          assert((await drawer.innerText()).includes('Due today is not overdue.'), 'Due-today distinction missing');
          assert.equal(await drawer.getAttribute('data-pg'), theme, 'Drawer theme');
          const box = await drawer.boundingBox(); assert(box && box.x >= -1 && box.x + box.width <= viewport.width + 1, `Drawer clips horizontally: ${JSON.stringify(box)}`);
          await drawer.getByRole('button', { name: 'Open Collections', exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(output, `${name}-drawer.png`) });
          await page.keyboard.press('Tab');
          assert(await drawer.evaluate(node => node.contains(document.activeElement)), 'Focus leaves the drawer');
          await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' });
          assert(await opener.evaluate(node => node === document.activeElement), 'Focus did not return to inspector opener');
          assert.deepEqual(pageErrors, [], 'Runtime errors after drawer interaction');
          await page.screenshot({ path: path.join(output, `${name}-screen.png`) });
          return geometry;
        });
      } finally { await context.close(); }
    }
  }
  for (const calendar of ['missing', 'invalid']) {
    const { page, context } = await fixture({ width: 900, height: 1000 }, 'dark', 'open', calendar);
    try { await record(`calendar-${calendar}`, async () => {
      const fold = page.locator('.tcs-paige-backdrop');
      if (await openerCovered(page)) { await fold.click(); await fold.waitFor({ state: 'hidden' }); }
      await page.getByRole('button', { name: 'Inspect overdue balance', exact: true }).click();
      const drawer = page.getByRole('dialog'); await drawer.waitFor();
      await page.waitForTimeout(450);
      const box = await drawer.boundingBox();
      assert(box && box.x >= -1 && box.x + box.width <= 901, `Unavailable drawer clips horizontally: ${JSON.stringify(box)}`);
      const text = await drawer.innerText();
      assert(text.includes(calendar === 'missing' ? 'Business time zone is not set.' : 'Business time zone needs correction.'));
      assert(text.includes('Not available')); assert(!text.includes('$0.00'));
      await page.screenshot({ path: path.join(output, `${calendar}-drawer.png`) });
    }); } finally { await context.close(); }
  }
  const { page, context } = await fixture({ width: 1024, height: 768 }, 'light', 'closed', 'configured', 'reduce');
  try {
    await record('refresh-period-lens-and-reduced-motion', async () => {
      assert.equal(await page.locator('.sp-stage-bar').count(), 2);
      const animation = await page.locator('.sp-stage-bar').first().evaluate(node => getComputedStyle(node).animationName);
      assert.equal(animation, 'none', 'Reduced-motion stage animation');
      await page.reload(); await page.locator('.sp-stage-bar').first().waitFor();
      assert.equal(await page.locator('.sp-stage-bar').count(), 2, 'Charts absent after reload');
      const oldBar = await page.locator('.sp-stage-bar').first().elementHandle();
      await page.getByRole('combobox', { name: /^Period/ }).selectOption('week');
      assert.equal(await oldBar.evaluate(node => node.isConnected), false, 'Old-period marks retained');
      assert.equal(await page.locator('.sp-stage-bar').count(), 2);
      await page.getByRole('button', { name: 'Money', exact: true }).click();
      assert.equal(await page.locator('.sp-fill').count(), 10, 'Money marks require extra activation');
      assert.equal(await page.locator('.sp-fill').first().evaluate(node => getComputedStyle(node).animationName), 'none');
      await page.getByRole('button', { name: 'Commercial pulse', exact: true }).click();
      assert.equal(await page.locator('.sp-stage-bar').count(), 2);
      const beforeRefresh = await page.locator('.sp-stage-bar').first().elementHandle();
      await page.getByRole('button', { name: 'Refresh Sales performance', exact: true }).click();
      assert.equal(await beforeRefresh.evaluate(node => node.isConnected), false);
      return { syntheticPeriodRerenderOnly: true, productionRpcAndNativeZoom: 'UNVERIFIED' };
    });
  } finally { await context.close(); }
} catch { process.exitCode = 1; }
finally {
  await browser.close();
  const report = { scope: 'Local synthetic presentation only; customer authentication, production RPC and native browser zoom UNVERIFIED', results };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2));
}
