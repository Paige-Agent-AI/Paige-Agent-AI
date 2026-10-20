// Deterministic local UI evidence only. Uses the existing Sales lifecycle harness.
// No ordinary authentication, provider connection or financial execution is asserted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePlaywright, buildLaunchOptions } from './live-drive.mjs';

const origin = 'http://127.0.0.1:5294';
const invoice = 'e4000000-0000-4000-8000-0000000a0017';
const output = path.resolve(process.env.E4_RENDER_OUTPUT || 'scripts/live-drive/artifacts/exp04-invoice-focus');
fs.mkdirSync(output, { recursive: true });
const report = { evidence: 'SYNTHETIC_LOCAL_ONLY', cases: [], errors: [], externalRequestsBlocked: 0 };
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());

async function open({ width = 1366, height = 768, theme = 'dark', paige = 'closed', state, ids = [invoice], reducedMotion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.externalRequestsBlocked++;
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const query = new URLSearchParams({ view: 'invoices', theme, paige, keep: 'retained' });
  for (const id of ids) query.append('invoice', id);
  if (state) query.set('focus-state', state);
  await page.goto(`${origin}/solo/42/sales/payments?${query}#retained-fragment`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'Invoice review', exact: true }).waitFor();
  return { page, context };
}

async function geometry(page) {
  return page.evaluate(() => {
    const surface = document.querySelector('.sb-focused-invoice');
    const shell = document.querySelector('[data-tenant-shell]');
    const box = surface?.getBoundingClientRect();
    const escapes = [...(surface?.querySelectorAll('button, dl, h2, h3') || [])]
      .filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); })
      .map(node => node.textContent?.slice(0, 80));
    return {
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      surface: box && { left: box.left, right: box.right, width: box.width },
      paige: shell?.getAttribute('data-paige'), escapes,
      focus: document.activeElement?.textContent,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      controls: [...(surface?.querySelectorAll('button') || [])].map(node => {
        const r = node.getBoundingClientRect();
        return { name: node.textContent, width: r.width, height: r.height };
      }),
    };
  });
}

try {
  for (const theme of ['light', 'dark']) for (const [width, height] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000], [390, 844]]) {
    for (const paige of (width === 390 ? ['closed'] : ['closed', 'open'])) {
      const { page, context } = await open({ width, height, theme, paige });
      await page.getByText('Retained service invoice', { exact: true }).waitFor();
      const measured = await geometry(page);
      const name = `${theme}-${width}x${height}-paige-${paige}`;
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      report.cases.push({ name, ...measured });
      assert.equal(measured.documentOverflow, false, name);
      assert.deepEqual(measured.escapes, [], name);
      assert.equal(measured.paige, paige, name);
      assert.equal(measured.focus, 'Invoice review', name);
      await context.close();
    }
  }
  for (const state of ['loading', 'missing', 'refused', 'foreign', 'retry', 'invalid', 'duplicate']) {
    const ids = state === 'invalid' ? ['bad-id'] : state === 'duplicate' ? [invoice, invoice] : [invoice];
    const { page, context } = await open({ state, ids });
    if (state === 'loading') await page.getByText('Reading this invoice…', { exact: true }).waitFor();
    else await page.getByRole('heading', { name: state === 'refused' || state === 'foreign' ? 'Invoice could not be opened' : state === 'invalid' || state === 'duplicate' ? 'Invoice could not be opened' : 'Invoice unavailable', exact: true }).waitFor();
    assert.equal(await page.getByText('Discovery and service delivery', { exact: true }).count(), 0, state);
    assert.equal(await page.getByText('Retained service invoice', { exact: true }).count(), 0, state);
    await page.screenshot({ path: path.join(output, `state-${state}.png`) });
    if (state === 'retry') {
      await page.getByRole('button', { name: 'Retry invoice', exact: true }).click();
      await page.getByText('Retained service invoice', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__e4FocusReads), 2);
    }
    if (state === 'invalid' || state === 'duplicate') assert.equal(await page.evaluate(() => window.__e4FocusReads || 0), 0);
    report.cases.push({ name: `state-${state}`, result: 'PASS' });
    await context.close();
  }
  {
    const { page, context } = await open();
    await page.getByText('Retained service invoice', { exact: true }).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Back to invoices');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Invoices', exact: true }).waitFor();
    const url = new URL(page.url());
    assert.equal(url.searchParams.has('invoice'), false);
    assert.equal(url.searchParams.get('view'), 'invoices');
    assert.equal(url.searchParams.get('keep'), 'retained');
    assert.equal(url.hash, '#retained-fragment');
    assert.equal(await page.getByText('Retained service invoice', { exact: true }).count(), 0);
    await page.getByText('Discovery and service delivery', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('searchbox', { name: 'Search invoices', exact: true }).evaluate(node => node === document.activeElement), true);
    report.cases.push({ name: 'keyboard-back-preserves-route-and-restores-list', result: 'PASS', focus: 'Search invoices' });
    await context.close();
  }
  // A 683 CSS-pixel viewport models 200% browser reflow from a 1366px display.
  // This is reflow proof, not a claim that the browser's native zoom control was driven.
  {
    const { page, context } = await open({ width: 683, height: 384 });
    await page.getByText('Retained service invoice', { exact: true }).waitFor();
    const measured = await geometry(page);
    await page.screenshot({ path: path.join(output, 'reflow-200-percent-equivalent.png') });
    assert.equal(measured.documentOverflow, false);
    assert.deepEqual(measured.escapes, []);
    assert.equal(measured.reducedMotion, true);
    report.cases.push({ name: '200-percent-equivalent-reflow-reduced-motion', ...measured });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.failure = error.stack || String(error); process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
