// EXP08 PAIGE team-lifecycle tools: frames of the "Paige team context" panel at the bottom of
// Settings → Team, at every Solo verification viewport, PAIGE closed and open, light and dark.
// RENDERED-HARNESS (the real SoloTeamWorkspace on in-memory doubles), not the real shell, not
// authenticated. For each frame the page is scrolled so the panel is in view, the viewport is
// captured (ev-<vp>-<paige>-paige-panel-<theme>.png) and the panel itself is captured on its own
// (paige-panel-<w>-<theme>.png, closed only), with its measured layout written to the report.
import { chromium } from "playwright";
const OUT = process.env.OUT;
const PREFIX = process.env.PREFIX ?? "";
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const vps = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];
const report = [];
for (const [w, h] of vps) for (const paige of ["closed", "open"]) for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/harness:/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:4792/?${new URLSearchParams({ theme, s: "populated", viewer: "owner", frame: "1", paige })}`);
  await page.waitForSelector(".stw-paige");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector(".stw-paige")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const panel = document.querySelector(".stw-paige");
    const r = panel?.getBoundingClientRect();
    const lanes = Array.from(document.querySelectorAll(".stw-lanes > div")).map((d) => ({ cls: d.className, width: Math.round(d.getBoundingClientRect().width) }));
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panelWidth: r ? Math.round(r.width) : null,
      lanes,
      today: Array.from(document.querySelectorAll(".stw-now li")).map((li) => li.textContent),
      soon: document.querySelectorAll(".stw-soon").length,
      rule: document.querySelector(".stw-rule")?.textContent ?? null,
    };
  });
  const n = `${PREFIX}ev-${w}x${h}-${paige}-paige-panel-${theme}`;
  await page.screenshot({ path: `${OUT}/${n}.png` });
  if (paige === "closed" && (w === 1366 || w === 900)) await page.locator(".stw-paige").screenshot({ path: `${OUT}/${PREFIX}paige-panel-${w}-${theme}.png` });
  report.push({ n, ...m, errors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
