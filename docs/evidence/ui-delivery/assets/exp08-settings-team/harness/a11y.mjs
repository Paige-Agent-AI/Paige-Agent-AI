import { chromium } from "playwright";
const OUT = process.env.OUT;
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const out = {};
// Keyboard: Tab order from the page start, focus-visible on each stop; open the row menu with Enter; Esc closes and returns focus.
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto("http://127.0.0.1:4792/?theme=light&s=populated&viewer=owner"); await page.waitForTimeout(800);
  const stops = [];
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => { const a = document.activeElement; return { name: a.getAttribute("aria-label") || a.textContent.trim().slice(0, 40), role: a.getAttribute("role") || a.tagName.toLowerCase(), fv: a.matches(":focus-visible"), outline: getComputedStyle(a).outlineStyle + " " + getComputedStyle(a).outlineWidth }; }));
  }
  out.tabStops = stops;
  await page.locator('[aria-label="Actions for Sam Lee"]').focus(); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  out.menuOpen = await page.evaluate(() => ({ items: [...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent.trim()), focused: document.activeElement.getAttribute("role"), focusedText: document.activeElement.textContent.trim() }));
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(100);
  out.menuArrow = await page.evaluate(() => document.activeElement.textContent.trim());
  out.menuFirstFocusBeforeArrow = "see menuOpen.focusedText";
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  out.afterEsc = await page.evaluate(() => ({ menu: !!document.querySelector('[role="menu"]'), focus: document.activeElement.getAttribute("aria-label") }));
  // Open review drawer by keyboard; Esc closes and focus returns.
  await page.locator('[aria-label="Actions for Sam Lee"]').focus(); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  out.reopen = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent.trim()));
  await page.locator('[role="menuitem"]:has-text("Remove")').first().focus(); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  out.drawer = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return { open: !!d, modal: d?.getAttribute("aria-modal"), label: d?.getAttribute("aria-labelledby") ? document.getElementById(d.getAttribute("aria-labelledby"))?.textContent : d?.getAttribute("aria-label"), focusInside: d?.contains(document.activeElement) }; });
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  out.drawerEsc = await page.evaluate(() => ({ open: !!document.querySelector('[role="dialog"]'), focus: document.activeElement.getAttribute("aria-label") }));
  await page.close();
}
// Zoom 200%: 1280x800 window at 2x = 640x400 CSS px.
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:4792/?theme=${theme}&s=populated&viewer=owner`); await page.waitForTimeout(800);
  out[`zoom200-${theme}`] = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, invite: !!document.querySelector('button') }));
  await page.screenshot({ path: `${OUT}/ev-zoom200-1280-roster-${theme}.png` });
  await page.locator('[aria-label="Actions for Sam Lee"]').first().focus(); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  await page.keyboard.press("End"); await page.waitForTimeout(100); out[`zoom200-menufocus-${theme}`] = await page.evaluate(() => document.activeElement.textContent.trim()); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  out[`zoom200-review-${theme}`] = await page.evaluate(() => ({ dialog: !!document.querySelector("[role=dialog]"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  await page.screenshot({ path: `${OUT}/ev-zoom200-1280-review-${theme}.png` });
  await page.close();
}
// Reduced motion: animation/transition on dialog and toggles.
for (const rm of ["no-preference", "reduce"]) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: rm });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4792/?theme=dark&s=populated&viewer=owner"); await page.waitForTimeout(800);
  await page.locator('[aria-label="Actions for Sam Lee"]').click(); await page.waitForTimeout(100);
  await page.locator('[role="menuitem"]:has-text("Remove from team")').click(); await page.waitForTimeout(60);
  out[`motion-${rm}`] = await page.evaluate(() => { const els = [...document.querySelectorAll('[role="dialog"], [role="dialog"] *, [role="switch"], [role="switch"] *')]; const anim = new Set(), trans = new Set(); for (const e of els) { const s = getComputedStyle(e); if (s.animationName !== "none") anim.add(s.animationName + " " + s.animationDuration); if (s.transitionDuration.split(",").some(d => parseFloat(d) > 0.01)) trans.add(s.transitionProperty + " " + s.transitionDuration); } return { animations: [...anim], transitions: [...trans].slice(0, 6) }; });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
