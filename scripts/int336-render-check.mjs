import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildLaunchOptions, resolvePlaywright } from './live-drive/live-drive.mjs';
const out = path.resolve(process.argv[2] ?? '../render-check');
fs.mkdirSync(out, { recursive: true });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'scripts/live-drive/harness/paige-chat-mount/solo.vite.config.ts'], { stdio: ['ignore', 'pipe', 'pipe'] });
const results = [];
let browser;
try {
  await new Promise((resolve, reject) => { let log = ''; const timer = setTimeout(() => reject(new Error(log)), 45000); vite.stdout.on('data', d => { log += d; if (log.includes('ready in')) { clearTimeout(timer); resolve(); } }); vite.stderr.on('data', d => log += d); vite.on('exit', c => reject(new Error(`Vite ${c}: ${log}`))); });
  const { chromium } = await resolvePlaywright();
  browser = await chromium.launch(buildLaunchOptions());
  for (const [width, height, scenario = 'normal'] of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[1366,768,'reload']]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`http://127.0.0.1:5213/solo.html?scenario=${scenario}&hold=4&layout=page&theme=dark`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const input = page.getByRole('textbox', { name: 'Message PAIGE' });
    await input.waitFor();
    if (scenario === 'reload') await page.waitForFunction(() => document.querySelectorAll('[data-paige-message-id]').length >= 7);
    const priorMessages = await page.locator('[data-paige-message-id]').count();
    await input.fill('Review my workflow'); await input.press('Enter');
    await page.getByRole('button', { name: 'Stop PAIGE response' }).waitFor();
    await input.fill('New context'); await input.press('Shift+Enter'); await input.press('End'); await input.press('a');
    const passive = await input.inputValue();
    if (!passive.includes('\n') || !await input.isEditable()) throw new Error('Passive typing/newline failed');
    await input.press('Enter');
    await input.fill('Next draft remains');
    const measured = await page.evaluate(() => { const t = document.querySelector('textarea'); const r = t.getBoundingClientRect(); return { editable: !t.disabled, focused: document.activeElement === t, value: t.value, fontSize: getComputedStyle(t).fontSize, documentOverflow: document.documentElement.scrollWidth > innerWidth, inputVisible: r.top >= 0 && r.bottom <= innerHeight }; });
    if (!measured.editable || !measured.focused || measured.documentOverflow || !measured.inputVisible) throw new Error(JSON.stringify(measured));
    await page.evaluate(() => { const n = document.createElement('div'); n.textContent = 'INT-336 harness render — NOT authenticated production'; n.style.cssText = 'position:fixed;top:0;left:0;background:black;color:white;z-index:99999;font:12px sans-serif'; document.body.append(n); });
    await page.screenshot({ path: path.join(out, `${width}x${height}${scenario === 'reload' ? '-populated' : ''}.png`) });
    results.push({ width, height, scenario, priorMessages, passive, measured }); await page.close();
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log('PASS: real component harness keyboard, passive typing, Send while busy, focus and geometry', results);
} finally { if (browser) await browser.close(); vite.kill(); }
