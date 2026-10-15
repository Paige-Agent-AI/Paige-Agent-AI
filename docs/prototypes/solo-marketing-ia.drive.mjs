// Renders the Solo Marketing IA prototype across the Solo viewport matrix and records geometry.
// Usage: node docs/prototypes/solo-marketing-ia.drive.mjs [outDir]
// Prototype-only proof (rendered + harness behaviour). It is NOT authenticated-runtime evidence.
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || "scripts/live-drive/artifacts/solo-marketing-ia");
mkdirSync(out, { recursive: true });

function chromiumPath() {
  if (process.env.PW_EXECUTABLE_PATH) return process.env.PW_EXECUTABLE_PATH;
  const base = "/opt/pw-browsers";
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  return dir ? `${base}/${dir}/chrome-linux/chrome` : undefined;
}

// Resolves playwright the way campaigns-overview.drive.mjs does: repo devDependency, then global.
async function loadChromium() {
  for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs", "/opt/node22/lib/node_modules/playwright/index.js"]) {
    try { return (await import(spec)).chromium; } catch {}
  }
  throw new Error("playwright not found — npm ci, or install it globally");
}
const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
await page.goto(pathToFileURL(resolve(here, "solo-marketing-ia.html")).href);
// The sticky review bar would cover the top of tall frames in element screenshots; frames are of product only.
await page.addStyleTag({ content: ".rv-bar{position:static}" });

const click = async (ctl, v) => page.click(`.rv-seg[data-ctl="${ctl}"] button[data-v="${v}"]`);
const settle = () => page.waitForTimeout(260); // let the 220ms entry fade finish before any frame
const measure = () => page.evaluate(() => {
  const main = document.querySelector(".sh-main");
  const scroll = document.querySelector(".mk-scroll");
  const tabs = document.querySelector(".mk-tabs");
  return {
    column: Math.round(main.getBoundingClientRect().width),
    hOverflow: scroll.scrollWidth - scroll.clientWidth,
    tabsScroll: tabs.scrollWidth - tabs.clientWidth,
    selectedVisible: (() => {
      const s = document.querySelector('.mk-tabs [aria-selected="true"]').getBoundingClientRect();
      const t = tabs.getBoundingClientRect();
      return s.left >= t.left - 1 && s.right <= t.right + 1;
    })(),
  };
});

const rows = [];
let failures = 0;
for (const set of ["rec", "full"]) {
  await click("set", set);
  for (const theme of ["light", "dark"]) {
    await click("theme", theme);
    for (const vp of ["1536x770", "1366x768", "1024x768", "900x1000"]) {
      await click("vp", vp);
      for (const paige of ["closed", "docked", "expanded"]) {
        await click("paige", paige);
        const tabIds = await page.$$eval('.mk-tabs [role="tab"]', (b) => b.map((x) => x.dataset.tab));
        for (const tab of tabIds) {
          await page.$eval(`#tab-${tab}`, (el) => el.click());
          await settle();
          const m = await measure();
          const ok = m.hOverflow <= 0 && m.selectedVisible;
          if (!ok) failures++;
          rows.push({ set, theme, vp, paige, tab, ...m, ok });
          if (tab === "overview" || (vp === "1366x768" && paige === "docked")) {
            await page.locator("#stage").screenshot({ path: `${out}/${set}-${theme}-${vp}-${paige}-${tab}.png` });
          }
        }
        await page.$eval("#tab-overview", (el) => el.click());
      }
    }
  }
}

// States on Overview + Lead capture, 1366 docked, light.
await click("set", "rec"); await click("theme", "light"); await click("vp", "1366x768"); await click("paige", "docked");
for (const state of ["first", "load", "err", "ro"]) {
  await click("state", state);
  for (const tab of ["overview", "campaigns", "capture"]) {
    await page.$eval(`#tab-${tab}`, (el) => el.click());
    await settle();
    await page.locator("#stage").screenshot({ path: `${out}/state-${state}-${tab}.png` });
  }
}
await click("state", "pop");

// Keyboard: ArrowRight from Overview reaches Campaigns and keeps focus on the tab.
await page.$eval("#tab-overview", (el) => el.click());
await page.keyboard.press("ArrowRight");
const kb = await page.evaluate(() => document.activeElement?.id);
if (kb !== "tab-campaigns") failures++;

// Campaign calendar view + ownership map.
await page.click("#tab-campaigns");
await page.click('[data-cal="cal"]');
await settle();
await page.locator("#stage").screenshot({ path: `${out}/campaigns-calendar.png` });
await click("page", "map");
await page.screenshot({ path: `${out}/ownership-map.png`, fullPage: true });

writeFileSync(`${out}/fit-table.json`, JSON.stringify({ rows, keyboard: kb, failures }, null, 2));
console.log(`frames: ${rows.length} measured · failures: ${failures} · keyboard ArrowRight → ${kb}`);
await browser.close();
process.exit(failures ? 1 : 0);
