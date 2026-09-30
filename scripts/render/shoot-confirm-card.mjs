import { chromium } from "playwright";
const url = "file://" + process.cwd() + "/docs/evidence/ui-delivery/solo-approval-executes/confirm-card.html";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const [theme, attr] of [["light","light"],["dark","dark"]]) {
  const p = await b.newPage({ viewport: { width: 860, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto(url, { waitUntil: "load" });
  await p.evaluate((t) => { document.documentElement.setAttribute("data-theme", t);
    if (t === "dark") document.documentElement.classList.add("dark"); }, attr);
  await p.waitForFunction(() => document.querySelectorAll("section.scene").length >= 7);
  await p.screenshot({ path: `docs/evidence/ui-delivery/solo-approval-executes/confirm-card-${theme}.png`, fullPage: true });
  console.log(theme, "ok");
  await p.close();
}
await b.close();
