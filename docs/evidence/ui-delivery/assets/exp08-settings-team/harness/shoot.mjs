import { chromium } from "playwright";
const OUT = process.env.OUT;
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const shots = [
  { n: "roster-1280-light", vw: 1280, theme: "light" },
  { n: "roster-1280-dark", vw: 1280, theme: "dark" },
  { n: "menu-1280-light", vw: 1280, theme: "light", act: "menu" },
  { n: "suspend-1280-dark", vw: 1280, theme: "dark", act: "suspend" },
  { n: "review-1280-light", vw: 1280, theme: "light", act: "review" },
  { n: "review-1280-dark", vw: 1280, theme: "dark", act: "review" },
  { n: "run-1280-dark", vw: 1280, theme: "dark", act: "run" },
  { n: "invite-1280-light", vw: 1280, theme: "light", act: "invite" },
  { n: "invite-review-1280-dark", vw: 1280, theme: "dark", act: "invitereview" },
  { n: "switch-notice-1280-light", vw: 1280, theme: "light", act: "switch" },
  { n: "admin-view-1280-light", vw: 1280, theme: "light", viewer: "admin" },
  { n: "roster-390-light", vw: 390, theme: "light" },
  { n: "review-390-dark", vw: 390, theme: "dark", act: "review" },
  { n: "loading-1280-dark", vw: 1280, theme: "dark", s: "loading" },
  { n: "error-1280-light", vw: 1280, theme: "light", s: "error" },
  { n: "firstuse-1280-light", vw: 1280, theme: "light", s: "firstuse" },
  { n: "hub-off-1280-light", vw: 1280, theme: "light", s: "hub-off" },
  { n: "hub-off-1280-dark", vw: 1280, theme: "dark", s: "hub-off" },
];
const report = [];
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.vw, height: s.vw < 500 ? 844 : 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/harness:/.test(m.text())) errors.push(m.text()); });
  const q = new URLSearchParams({ theme: s.theme, s: s.s ?? "populated", viewer: s.viewer ?? "owner" });
  await page.goto(`http://127.0.0.1:4792/?${q}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  // Phone: the row menu closes on scroll (by design), so controls are activated with focus + Enter,
  // as a keyboard user would, rather than by a pointer click that scrolls first.
  const click = async (sel) => { if (s.vw < 500) { await page.locator(sel).first().focus(); await page.keyboard.press("Enter"); } else { await page.locator(sel).first().click(); } await page.waitForTimeout(450); };
  if (s.act === "menu") await click('[aria-label="Actions for Sam Lee"]');
  if (s.act === "suspend") { await click('[aria-label="Actions for Sam Lee"]'); await click('[role="menuitem"]:has-text("Suspend access")'); await page.waitForTimeout(400); }
  if (s.act === "review" || s.act === "run") {
    await click('[aria-label="Actions for Sam Lee"]'); await click('[role="menuitem"]:has-text("Remove from team")'); await page.waitForTimeout(500);
    await click('[aria-labelledby="stw-handall-l"]'); await click('[role="option"]:has-text("Avery Cole")');
    if (s.act === "run") { await click('button:has-text("Continue")'); await click('button:has-text("Start hand-over")'); await page.waitForTimeout(2400); }
  }
  if (s.act === "invite" || s.act === "invitereview") {
    await click('button:has-text("Invite someone")');
    await page.fill('input[type=email]', "spot.job@brandtcopy.example");
    await click('.stw-convo [role="switch"]');
    if (s.act === "invitereview") await click('button:has-text("Review invitation")');
  }
  if (s.act === "switch") { await click('[aria-label="Team conversations for Sam Lee"]'); await page.waitForTimeout(900); }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: `${OUT}/${s.n}.png`, fullPage: !/review|run|suspend|invite/.test(s.n) });
  report.push({ n: s.n, overflow, errors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
