import fs from 'node:fs';
import path from 'node:path';
import { resolvePlaywright, buildLaunchOptions } from './live-drive.mjs';
const out = path.resolve('scripts/live-drive/artifacts/sales-billing-shell');
fs.mkdirSync(out, { recursive: true });
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const page = await browser.newPage();
page.setDefaultTimeout(15000);
const observations = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const geometry = async (target = page) => target.evaluate(() => {
  const rect = el => el.getBoundingClientRect().toJSON();
  const controls = [...document.querySelectorAll('.campaigns-tabs button,.campaigns-studio,.so-subnav button,.sb-fixed-footer button')].filter(el => el.getClientRects().length).map(el => {
    const box = el.getBoundingClientRect(); let clipped = box.right > innerWidth + 1 || box.bottom > innerHeight + 1 || box.left < -1 || box.top < -1;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node); const parent = node.getBoundingClientRect();
      if (['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX) && (box.left < parent.left - 1 || box.right > parent.right + 1)) clipped = true;
      if (['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowY) && (box.top < parent.top - 1 || box.bottom > parent.bottom + 1)) clipped = true;
    }
    return { label: el.textContent || el.getAttribute('aria-label'), rect: rect(el), clipped };
  });
  return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, main: rect(document.querySelector('#tenant-shell-main')), palette: getComputedStyle(document.querySelector('[data-tenant-shell]') ?? document.querySelector('#tenant-shell-main')).getPropertyValue('--pg-canvas'), controls, scrollOwners: [...document.querySelectorAll('*')].filter(el => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)).map(el => ({ class: el.className, height: el.clientHeight, scrollHeight: el.scrollHeight })) };
});
try {
  for (const theme of process.env.SALES_BILLING_ZOOM_ONLY === '1' ? [] : ['light', 'dark']) for (const [width, height] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) for (const paige of ['closed', 'open']) {
    const name = `${width}-${height}-${paige}-${theme}`;
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:5217/solo/test-account/growth/sales?full-shell=1&billing-fixture=populated&theme=${theme}&paige=${paige}&view=invoices`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Create invoice', exact: true }).waitFor();
    await page.waitForFunction(({ theme, paige }) => { const shell = document.querySelector('[data-tenant-shell]'); return shell?.getAttribute('data-pg') === theme && shell?.getAttribute('data-paige') === paige; }, { theme, paige });
    await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await Promise.all(document.querySelector('[data-tenant-shell]').getAnimations().map(animation => animation.finished.catch(() => undefined))); });
    if (await page.locator('[data-harness-error]').count()) throw new Error(await page.locator('[data-harness-error]').innerText());
    const register = await geometry();
    await page.screenshot({ path: path.join(out, `${name}-register.png`) });
    const overlay = paige === 'open' && width < 1080;
    if (overlay) await page.getByRole('button', { name: 'Fold PAIGE conversation', exact: true }).last().click();
    const tabs = {};
    for (const tab of ['Overview', 'Payments', 'Invoices', 'Recurring', 'Agreements']) {
      await page.getByRole('tablist', { name: 'Sales views', exact: true }).getByRole('tab', { name: tab, exact: true }).click();
      if (overlay) await page.getByRole('button', { name: 'Direct PAIGE', exact: true }).click();
      tabs[tab] = await geometry();
      await page.screenshot({ path: path.join(out, `${name}-${tab.toLowerCase()}.png`) });
      if (overlay) await page.getByRole('button', { name: 'Fold PAIGE conversation', exact: true }).last().click();
    }
    await page.getByRole('tab', { name: 'Invoices', exact: true }).click();
    const catalogRow = page.locator('.sb-register tbody tr').filter({ hasText: 'Catalog service' });
    await catalogRow.locator('.sb-row-link').click();
    await page.locator('.sb-detail-grid').getByRole('heading', { name: 'Catalog service', exact: true }).waitFor();
    const selection = await geometry();
    await page.screenshot({ path: path.join(out, `${name}-selection.png`) });
    await catalogRow.getByRole('button', { name: 'Edit', exact: true }).click();
    const headingFocused = await page.locator('.sb-editor h2').evaluate(el => el === document.activeElement);
    await page.keyboard.press('Tab');
    const backFocused = await page.getByRole('button', { name: 'Back to records', exact: true }).evaluate(el => el === document.activeElement);
    await page.keyboard.press('Tab');
    const readingRegionFocused = await page.getByRole('region', { name: 'Billing details and summary', exact: true }).evaluate(el => el === document.activeElement);
    await page.keyboard.press('Tab');
    const clientFocused = await page.locator('.sb-fields select').first().evaluate(el => el === document.activeElement);
    const unitValue = await page.getByLabel('Unit price · USD').inputValue();
    if (unitValue !== '150.00') throw new Error(`Current Catalog unit mismatch: ${unitValue}`);
    await page.locator('.sb-summary [role="status"]').waitFor();
    await page.getByLabel('Description', { exact: true }).fill('Synthetic Catalog service draft');
    if (overlay) await page.getByRole('button', { name: 'Direct PAIGE', exact: true }).click();
    const editor = await geometry();
    await page.screenshot({ path: path.join(out, `${name}-editor.png`) });
    if (overlay) await page.getByRole('button', { name: 'Fold PAIGE conversation', exact: true }).last().click();
    // Internal tab click must retain the editor until discard is explicitly chosen.
    await page.getByRole('tab', { name: 'Payments', exact: true }).click();
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await page.getByRole('button', { name: 'Review draft', exact: true }).click();
    const reviewUnit = await page.locator('.sb-paper dt').filter({ hasText: /^Unit price$/ }).evaluate(el => el.nextElementSibling.textContent);
    if (reviewUnit !== '$150.00') throw new Error(`Review Catalog unit mismatch: ${reviewUnit}`);
    if (overlay) await page.getByRole('button', { name: 'Direct PAIGE', exact: true }).click();
    const review = await geometry();
    await page.screenshot({ path: path.join(out, `${name}-review.png`) });
    if (overlay) await page.getByRole('button', { name: 'Fold PAIGE conversation', exact: true }).last().click();
    observations.push({ name, register, tabs, selection, editor, review, catalogRepricing: { unitValue, reviewUnit, savedUnit: '$100.00' }, keyboard: { headingFocused, backFocused, readingRegionFocused, clientFocused }, internalDirtyExit: 'PASS', overlay: overlay ? 'PAIGE blocks underlying pointer actions by design; folded for editing and dirty-exit checks' : false, proof: 'real production shell and components; synthetic network/auth data and unavailable PAIGE slot' });
  }
  // CSS layout dimensions equivalent to 200% browser zoom at these physical window sizes.
  // Device scale factor preserves the physical screenshot size; this is reflow evidence,
  // not a claim that browser-chrome zoom controls were exercised.
  const zoomCases = [];
  for (const physical of [[1536, 770], [900, 1000]]) for (const paige of ['closed', 'open']) {
    const viewport = { width: physical[0] / 2, height: physical[1] / 2 };
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const zoomPage = await context.newPage();
    zoomPage.setDefaultTimeout(15000);
    await zoomPage.goto(`http://127.0.0.1:5217/solo/test-account/growth/sales?full-shell=1&billing-fixture=populated&theme=light&paige=${paige}&view=invoices`, { waitUntil: 'domcontentloaded' });
    await zoomPage.getByRole('button', { name: 'Create invoice', exact: true }).waitFor();
    await zoomPage.waitForFunction(paige => document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige') === paige, paige);
    await zoomPage.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await Promise.all(document.querySelector('[data-tenant-shell]').getAnimations().map(animation => animation.finished.catch(() => undefined))); });
    const name = `${physical[0]}-${physical[1]}-${paige}-200pct-reflow`;
    const register = await geometry(zoomPage);
    await zoomPage.screenshot({ path: path.join(out, `${name}-register.png`) });
    if (paige === 'open') await zoomPage.getByRole('button', { name: 'Fold PAIGE conversation', exact: true }).last().click();
    await zoomPage.waitForFunction(() => document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige') === 'closed');
    await zoomPage.evaluate(async () => { await Promise.all(document.querySelector('[data-tenant-shell]').getAnimations().map(animation => animation.finished.catch(() => undefined))); });
    // The shell intentionally restores Direct PAIGE at 150ms after folding.
    // Complete that existing transition before starting the editor keyboard flow.
    if (paige === 'open') await zoomPage.waitForTimeout(250);
    const catalogRow = zoomPage.locator('.sb-register tbody tr').filter({ hasText: 'Catalog service' });
    await catalogRow.getByRole('button', { name: 'Edit', exact: true }).click();
    await zoomPage.getByLabel('Description', { exact: true }).fill('Synthetic keyboard reviewed draft');
    await zoomPage.getByRole('button', { name: 'Review draft', exact: true }).click();
    // Wait for the production review-entry focus effect before testing Tab.
    await zoomPage.waitForFunction(() => document.activeElement === document.querySelector('.sb-editor h2')).catch(async error => { throw new Error(`${name}:review entry focus: ${JSON.stringify(await zoomPage.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0,250), heading: document.querySelector('.sb-editor h2')?.outerHTML, inert: [...document.querySelectorAll('[inert]')].map(el => el.className) })))}; ${error.message}`); });
    const readingPane = zoomPage.getByRole('region', { name: 'Billing details and summary', exact: true });
    const readingHeight = await readingPane.evaluate(el => el.clientHeight);
    if (readingHeight < 120) throw new Error(`${name}:financial reading pane is only ${readingHeight}px`);
    await zoomPage.getByRole('button', { name: 'Back to records', exact: true }).focus();
    await zoomPage.keyboard.press('Tab');
    if (!await readingPane.evaluate(el => el === document.activeElement)) throw new Error(`${name}:reading pane cannot receive keyboard focus`);
    for (let step = 0; step < 24 && await readingPane.evaluate(el => el.scrollTop) > 0; step++) {
      await zoomPage.keyboard.press('PageUp'); await zoomPage.waitForTimeout(180);
    }
    const seen = new Set();
    const readingSteps = [];
    const blocks = await readingPane.locator('.sb-paper>h3,.sb-paper>p,.sb-paper dt,.sb-paper dd,.sb-summary>h3,.sb-summary dt,.sb-summary dd,.sb-summary>p').allTextContents();
    for (let step = 0; step < 24; step++) {
      const reading = await readingPane.evaluate(el => { const pane = el.getBoundingClientRect(); const blocks = [...el.querySelectorAll('.sb-paper>h3,.sb-paper>p,.sb-paper dt,.sb-paper dd,.sb-summary>h3,.sb-summary dt,.sb-summary dd,.sb-summary>p')]; return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight, focused: el === document.activeElement, active: document.activeElement?.outerHTML.slice(0,200), visible: blocks.flatMap((block, index) => { const b = block.getBoundingClientRect(); return b.top >= pane.top - 1 && b.bottom <= pane.bottom + 1 ? [index] : []; }) }; });
      readingSteps.push(reading);
      reading.visible.forEach(index => seen.add(index));
      await zoomPage.screenshot({ path: path.join(out, `${name}-review-read-${step}.png`) });
      await zoomPage.keyboard.press('PageDown');
      await zoomPage.waitForTimeout(180);
      if (await readingPane.evaluate(el => el.scrollTop) === reading.top) break;
    }
    const unread = blocks.filter((text, index) => text.trim() && !seen.has(index));
    if (unread.length) throw new Error(`${name}:keyboard reading misses ${unread.join(' | ')}; steps=${JSON.stringify(readingSteps)}`);
    for (let step = 0; step < 24 && await readingPane.evaluate(el => el.scrollTop) > 0; step++) {
      await zoomPage.keyboard.press('PageUp'); await zoomPage.waitForTimeout(180);
    }
    const review = await geometry(zoomPage);
    for (const [state, snapshot] of Object.entries({ register, review })) {
      if (snapshot.controls.some(control => control.clipped)) throw new Error(`${name}:${state} clips a navigation/footer control`);
      if (snapshot.scrollOwners.some(owner => owner.class === 'campaigns-scroll')) throw new Error(`${name}:${state} scrolls the Campaigns parent`);
    }
    await zoomPage.emulateMedia({ reducedMotion: 'reduce' });
    await zoomPage.locator('.sb-fixed-footer .btn').first().hover();
    const motion = await zoomPage.locator('.sb-fixed-footer .btn').first().evaluate(el => ({ duration: getComputedStyle(el).transitionDuration, transform: getComputedStyle(el).transform }));
    if (motion.transform !== 'none') throw new Error(`${name}:reduced motion still lifts a control`);
    await zoomPage.screenshot({ path: path.join(out, `${name}-review.png`) });
    const unit = await zoomPage.locator('.sb-paper dt').filter({ hasText: /^Unit price$/ }).evaluate(el => el.nextElementSibling.textContent);
    await zoomPage.getByRole('button', { name: 'Back to records', exact: true }).click();
    await zoomPage.getByRole('alertdialog').waitFor();
    await zoomPage.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await readingPane.waitFor();
    await zoomPage.getByRole('button', { name: 'Back to records', exact: true }).click();
    await zoomPage.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await zoomPage.getByRole('button', { name: 'Create invoice', exact: true }).waitFor();
    const restoredTabs = await zoomPage.getByRole('tablist', { name: 'Sales views', exact: true }).getByRole('tab').count();
    if (restoredTabs !== 5) throw new Error(`${name}:Back did not restore the Sales destinations`);
    // A fresh read-only Catalog mount proves selector scope; this is not a claim
    // about the draft abandonment/navigation flow (covered separately above).
    await zoomPage.goto(`http://127.0.0.1:5217/solo/test-account/growth/catalog?full-shell=1&theme=light&paige=closed`, { waitUntil: 'domcontentloaded' });
    await zoomPage.waitForFunction(() => document.querySelector('.solo-campaigns')?.getAttribute('data-campaigns-view') === 'catalog');
    const otherViewWrap = await zoomPage.locator('.campaigns-tabs').evaluate(el => getComputedStyle(el).flexWrap);
    if (otherViewWrap !== 'nowrap') throw new Error(`${name}:Sales-scoped wrap affects another Campaigns view`);
    zoomCases.push({ name, physical, cssViewport: viewport, deviceScaleFactor: 2, register, review, reviewUnit: unit, accessibleReviewAction: true, readingHeight, keyboardReading: { blocks, readingSteps, unread, restoredTabs, dirtyBackContinueAndDiscard: 'PASS' }, reducedMotion: motion, otherCampaignsViewWrap: otherViewWrap, method: '200% equivalent CSS layout reflow; browser chrome zoom unverified' });
    await context.close();
  }
  fs.writeFileSync(path.join(out, 'zoom-reflow.json'), JSON.stringify(zoomCases, null, 2));
} finally { await browser.close(); if (observations.length) fs.writeFileSync(path.join(out, 'geometry.json'), JSON.stringify({ observations, errors }, null, 2)); }
console.log(JSON.stringify({ cases: observations.length, clipped: observations.flatMap(item => ['register', 'selection', 'editor', 'review'].flatMap(state => item[state].controls.filter(c => c.clipped).map(c => `${item.name}:${state}:${c.label}`))), errors }));
