import { chromium } from "playwright";
const OUT = process.env.OUT;
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const vps = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];
const report = [];
for (const [w, h] of vps) for (const paige of ["closed", "open"]) for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/harness:/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:4792/?${new URLSearchParams({ theme, s: "populated", viewer: "owner", frame: "1", paige })}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const ws = document.querySelector(".solo-settings");
    const r = ws?.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, pageWidth: r ? Math.round(r.width) : null,
      rows: document.querySelectorAll('[aria-label^="Actions for"]').length };
  });
  const n = `ev-${w}x${h}-${paige}-roster-${theme}`;
  await page.screenshot({ path: `${OUT}/${n}.png` });
  report.push({ n, ...m, errors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report));
