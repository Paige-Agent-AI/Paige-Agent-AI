// Isolated actual presenter/Operations/Radix/BrowserRouter over deterministic SDK aliases.
// No authentication, provider, durable production receipt or actual AppNav/Chat acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePlaywright, buildLaunchOptions } from './live-drive.mjs';

const origin = 'http://127.0.0.1:5295';
const output = path.resolve(process.env.E4_CLIENT_RENDER_OUTPUT || 'scripts/live-drive/artifacts/exp04-client-review');
fs.mkdirSync(output, { recursive: true });
const report = { evidence: 'ISOLATED_ACTUAL_COMPONENTS_SYNTHETIC_SDK_AND_SHELL', cases: [], errors: [], externalRequestsBlocked: [],
  authenticatedAcceptance: 'NOT_RUN', actualAppNavChat: 'NOT_RUN', productionReloadPersistence: 'NOT_RUN', nativeZoom: 'NOT_RUN' };
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const contexts = [];
const ready = page => page.locator('.client-released-work li button').first().waitFor();
async function open({ width = 1366, height = 768, theme = 'light', scenario = 'ready', history = false, record } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' }); contexts.push(context);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.externalRequestsBlocked.push(`${url.protocol}//${url.host}`); return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  const query = new URLSearchParams({ theme, scenario }); if (record) query.set('record', record);
  await page.goto(`${origin}${history ? '/portal/test-studio' : '/app/actions'}?${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (history) await page.getByRole('link', { name: 'Open action items', exact: true }).click();
  await page.getByRole('heading', { name: 'Released work', exact: true }).waitFor();
  return { page, context };
}
async function review(page) { await ready(page); const source = page.locator('.client-released-work li button').first(); const opener = await source.elementHandle(); await source.click(); await page.getByRole('article', { name: 'Released artifact content' }).waitFor(); return opener; }
const snapshot = page => page.evaluate(() => window.e04ClientFixture.snapshot());
const close = page => page.getByRole('button', { name: 'Close review', exact: true }).click();
const outer = page => page.locator('.client-delivery-review-dialog');
const pass = (name, extra = {}) => report.cases.push({ name, result: 'PASS', ...extra });
async function capture(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`) }); }

try {
  for (const theme of ['light', 'dark']) for (const [width, height] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000], [390, 844], [320, 720]]) {
    const { page, context } = await open({ width, height, theme }); await review(page); await page.evaluate(() => document.fonts.ready);
    const geometry = await outer(page).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll('button')].filter(button => getComputedStyle(button).display !== 'none').map(button => ({ name: button.textContent, height: button.getBoundingClientRect().height }));
      return { pageFits: document.documentElement.scrollWidth <= innerWidth + 1, contentFits: element.scrollWidth <= element.clientWidth + 1,
        boundsFit: rect.left >= -1 && rect.right <= innerWidth + 1, controls,
        theme: element.getAttribute('data-pg'), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        localFaceLoaded: [...document.fonts].some(face => face.family.includes('Schibsted Grotesk') && face.status === 'loaded') };
    });
    assert.equal(geometry.pageFits, true); assert.equal(geometry.contentFits, true); assert.equal(geometry.boundsFit, true); assert.equal(geometry.theme, theme);
    assert.equal(geometry.reducedMotion, true); assert.equal(geometry.localFaceLoaded, true); for (const button of geometry.controls) assert.ok(button.height >= 43.5, button.name);
    await capture(page, `${theme}-${width}x${height}-top`);
    await page.getByRole('button', { name: 'Accept this version', exact: true }).scrollIntoViewIfNeeded();
    const actionRect = await page.getByRole('button', { name: 'Accept this version', exact: true }).boundingBox();
    assert.ok(actionRect && actionRect.y >= 0 && actionRect.y + actionRect.height <= height + 1);
    await capture(page, `${theme}-${width}x${height}-actions`);
    pass(`${theme}-${width}x${height}`, geometry); await context.close();
  }
  for (const [scenario, expected] of Object.entries({ loading: 'Loading your released work', empty: 'No work has been released', unlinked: 'client link could not be found', ambiguous: 'could not be resolved safely', error: 'could not be read', refused: 'could not be read', foreign: 'could not be read', partial: 'This list is partial', capped: 'This list is partial' })) {
    const { page, context } = await open({ scenario }); await page.getByText(new RegExp(expected)).first().waitFor();
    assert.equal((await snapshot(page)).decisions, 0); pass(`state-${scenario}`); await context.close();
  }
  for (const theme of ['light', 'dark']) for (const [width, height] of [[320, 720], [1366, 768]]) {
    const { page, context } = await open({ theme, width, height, scenario: 'long' }); await review(page);
    const fits = await outer(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1);
    assert.equal(fits, true); await page.getByRole('button', { name: 'Accept this version', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Accept this version', exact: true }).click(); await page.getByRole('alertdialog').waitFor();
    assert.equal(await page.getByRole('alertdialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await capture(page, `${theme}-${width}-long-confirmation`); pass(`${theme}-${width}-long-content-and-confirmation`); await context.close();
  }
  {
    const { page, context } = await open(); const opener = await review(page); assert.equal((await snapshot(page)).decisions, 0);
    await page.getByRole('button', { name: 'Accept this version', exact: true }).click();
    await page.getByRole('alertdialog').waitFor(); await page.keyboard.press('Escape');
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' }); assert.equal(await outer(page).isVisible(), true);
    await page.waitForFunction(() => document.activeElement?.textContent === 'Accept this version', null, { timeout: 2000 });
    await close(page); await outer(page).waitFor({ state: 'hidden' });
    const expected = await opener.evaluate(element => element.isConnected) ? 'Review version 3' : 'Review closed.';
    await page.waitForFunction(text => document.activeElement?.textContent === text, expected, { timeout: 2000 });
    pass('nested-escape-and-opener-focus', { expectedFocus: expected }); await context.close();
  }
  {
    const { page, context } = await open({ history: true }); await review(page);
    const note = page.getByRole('textbox', { name: 'Review note', exact: true }); await note.fill('Retain my exact-version note.'); const original = await note.elementHandle();
    await page.goBack(); await page.waitForURL(/\/portal\/test-studio/);
    assert.deepEqual(await original.evaluate(e => ({ connected: e.isConnected, value: e.value })), { connected: true, value: 'Retain my exact-version note.' });
    await close(page); assert.equal(await outer(page).isVisible(), true);
    await page.goForward(); await page.waitForURL(/\/app\/actions/); assert.equal(await original.evaluate(e => e.isConnected), true);
    await page.getByRole('button', { name: 'Clear review note', exact: true }).click(); await close(page); await outer(page).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent === 'Review closed.', null, { timeout: 2000 }); pass('actual-back-forward-outside-app-retains-instance'); await context.close();
  }
  {
    const { page, context } = await open({ history: true }); await review(page);
    await page.evaluate(() => window.e04ClientFixture.setWriteMode('unknown'));
    await page.getByRole('button', { name: 'Accept this version', exact: true }).click(); await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
    await page.getByText('Your decision could not be confirmed.', { exact: false }).waitFor();
    await close(page); assert.equal(await outer(page).isVisible(), true); await page.goBack(); await page.waitForURL(/\/portal\/test-studio/);
    await page.getByRole('button', { name: 'Check recorded review', exact: true }).click(); await close(page); assert.equal(await outer(page).isVisible(), true);
    const before = (await snapshot(page)).calls.filter(n => n === 'operations_delivery_client_reviews_scoped').length;
    await page.evaluate(() => window.e04ClientFixture.recoverOriginal()); await page.getByRole('button', { name: 'Check recorded review', exact: true }).click();
    await page.getByText('Your acceptance is recorded for version 3.', { exact: true }).waitFor();
    assert.equal((await snapshot(page)).calls.filter(n => n === 'operations_delivery_client_reviews_scoped').length, before);
    assert.equal((await snapshot(page)).decisions, 1); await close(page); await outer(page).waitFor({ state: 'hidden' }); pass('unknown-original-source-recovery-no-replay-no-causal-callback'); await context.close();
  }
  {
    const { page, context } = await open(); await review(page); await page.evaluate(() => window.e04ClientFixture.setScenario('error'));
    await page.getByRole('button', { name: 'Accept this version', exact: true }).click(); await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
    await page.getByText('Your acceptance is recorded for version 3.', { exact: true }).waitFor();
    await outer(page).getByText('The decision is recorded. Check released work again for the latest list.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Your decision could not be confirmed.', { exact: false }).count(), 0); assert.equal((await snapshot(page)).decisions, 1);
    pass('consumer-refresh-failure-preserves-verified-source'); await context.close();
  }
  {
    const { page, context } = await open({ history: true }); await review(page); const note = page.getByRole('textbox', { name: 'Review note', exact: true }); await note.fill('Retained while access lookup is unavailable.');
    await page.evaluate(() => window.e04ClientFixture.setAuthError(true)); await page.goBack(); await page.waitForURL(/\/portal\/test-studio/);
    await page.getByText('Access could not be checked.', { exact: false }).waitFor(); assert.equal(await note.inputValue(), 'Retained while access lookup is unavailable.');
    await page.evaluate(() => { window.e04ClientFixture.setAuthError(false); window.e04ClientFixture.setExactError('42501'); });
    await page.getByRole('button', { name: 'Check review access', exact: true }).click(); await outer(page).waitFor({ state: 'hidden' });
    assert.equal(await page.getByText('Synthetic released version 1', { exact: false }).count(), 0); assert.equal((await snapshot(page)).decisions, 0);
    pass('uncertain-recheck-retains-proven-snapshot-definitive-loss-scrubs'); await context.close();
  }
  {
    const { page, context } = await open(); await review(page); await page.getByRole('textbox', { name: 'Review note', exact: true }).fill('Guard this note.');
    await assert.rejects(page.getByRole('button', { name: 'Sign out', exact: true }).click({ timeout: 1000 })); assert.equal((await snapshot(page)).logoutCalls, 0);
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"],[role="alertdialog"]'))), true); }
    await page.getByRole('button', { name: 'Accept this version', exact: true }).click(); await page.getByRole('alertdialog').waitFor();
    await page.evaluate(() => window.e04ClientFixture.setActor(null)); await outer(page).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('alertdialog').count(), 0); assert.equal(await page.getByText('Synthetic released version 1', { exact: false }).count(), 0);
    pass('modal-background-logout-inert-security-loss-unblocked'); await context.close();
  }
  {
    const { page, context } = await open(); await review(page); await page.evaluate(() => window.e04ClientFixture.setWriteMode('pending'));
    await page.getByRole('button', { name: 'Accept this version', exact: true }).click(); await page.getByRole('button', { name: 'Confirm acceptance', exact: true }).click();
    await page.waitForFunction(() => window.e04ClientFixture.snapshot().pending);
    await page.evaluate(() => window.e04ClientFixture.setActor('ec040000-0000-4000-8000-000000000009')); await outer(page).waitFor({ state: 'hidden' });
    await page.evaluate(() => window.e04ClientFixture.setActor('ec040000-0000-4000-8000-000000000001')); await ready(page); await review(page);
    await page.evaluate(() => window.e04ClientFixture.resolvePending());
    await page.getByRole('button', { name: 'Accept this version', exact: true }).waitFor();
    assert.equal(await page.getByText('Your acceptance is recorded for version 3.', { exact: true }).count(), 0); assert.equal((await snapshot(page)).decisions, 1);
    await close(page); await outer(page).waitFor({ state: 'hidden' }); pass('actual-a-b-a-retired-write-does-not-revive'); await context.close();
  }
  {
    const { page, context } = await open(); await review(page);
    await page.addStyleTag({ content: '.paige-solo{font-family:Arial;height:100%}.paige-solo h1{font-family:Arial}' });
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Close review', exact: true }).focus();
    const ring = await page.getByRole('button', { name: 'Close review', exact: true }).evaluate(element => ({ width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle, color: getComputedStyle(element).outlineColor }));
    assert.ok(parseFloat(ring.width) >= 2); assert.equal(ring.style, 'solid'); assert.notEqual(ring.color, 'rgba(0, 0, 0, 0)');
    // A prior department's ordinary heading rules must not replace the actual local artifact face.
    assert.match(await page.getByRole('heading', { name: 'Launch strategy brief', exact: true }).evaluate(element => getComputedStyle(element).fontFamily), /Schibsted Grotesk/);
    pass('client-context-local-face-and-visible-focus-role', ring); await context.close();
  }
  {
    const { page, context } = await open({ record: 'accepted' }); await review(page);
    await page.getByText('Your acceptance is recorded for version 3.', { exact: true }).waitFor(); assert.equal((await snapshot(page)).decisions, 0);
    pass('fresh-mount-terminal-record-presentation-seeded-not-persistence-proof'); await context.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequestsBlocked, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report, status: 'PASS' }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', cases: report.cases.length, report: path.join(output, 'report.json') }));
} catch (error) {
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ ...report, status: 'FAIL', error: String(error) }, null, 2)); throw error;
} finally { for (const context of contexts) await context.close().catch(() => {}); await browser.close(); }
