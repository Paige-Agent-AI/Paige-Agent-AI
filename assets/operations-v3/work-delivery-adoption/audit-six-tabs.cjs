const { chromium } = require('../../../node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.OPERATIONS_BROWSER_EXECUTABLE?{executablePath:process.env.OPERATIONS_BROWSER_EXECUTABLE}:{}) });
  const results = [], errors = [];
  const out = path.join(__dirname, 'six-tab-captures'); fs.mkdirSync(out, { recursive: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('http://127.0.0.1:8841/shell.html', { waitUntil: 'domcontentloaded' });
      await page.evaluate(theme => { localStorage.setItem('theme', theme); }, theme); await page.reload();
      await page.getByRole('heading', { name: 'Keep the promises moving' }).waitFor();
      for (const tab of ['Overview', 'Work', 'Projects', 'Delivery', 'Playbooks', 'Capacity']) {
        await page.getByRole('navigation', { name: 'Department views' }).getByRole('button', { name: tab, exact: true }).click();
        await page.locator('.ops-department-body').getByRole('heading', { level: 1 }).waitFor();
        const controls = await page.locator('.ops-department-body button').allTextContents();
        await page.screenshot({ path: path.join(out, `${tab}-${theme}-1366.png`) });
        results.push({ theme, tab, controls, noPageOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), heading: await page.locator('.ops-department-body h1').textContent() });
      }
      await page.getByRole('navigation', { name: 'Department views' }).getByRole('button', { name: 'Work', exact: true }).click();
      await page.locator('.ops-work-card').filter({hasText:'Prepare stakeholder review'}).click();
      await page.getByRole('dialog').waitFor();
      const missingDelivery = await page.getByRole('dialog').getByRole('button', { name: 'Delivery details', exact: true }).count() === 0;
      await page.screenshot({ path: path.join(out, `Work-detail-${theme}-1366.png`) });
      results.push({ theme, tab: 'Work detail', missingDelivery });
      await page.keyboard.press('Escape');
    }
    const report = { base: '5c90859ac1d4fe560200069c5a783e90fb21be19', candidate: 'local Work adoption, unmerged', boundary: 'Actual incumbent Solo shell and Operations components, explicit synthetic source ports, isolated signed-out Chrome. Source reachability and rendered usability audit; no customer runtime or persisted writes.', results, errors };
    fs.writeFileSync(path.join(__dirname, 'six-tab-audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ cases: results.length, errors, deliveryEntryPresent: results.filter(r => r.tab === 'Work detail').every(r => !r.missingDelivery), geometry: results.every(r => r.noPageOverflow !== false) }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
