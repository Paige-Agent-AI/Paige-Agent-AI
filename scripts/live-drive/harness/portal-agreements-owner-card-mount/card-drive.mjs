// Render the owner's Clients → Portal "Files and agreements" card (TenantRelationshipsClientsWorkspace PortalView)
// in light and dark, desktop 1440x900 and phone 390x844, after document.fonts.ready, and assert the one line that
// is true after both Documents and Agreements shipped. HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1).
//   node scripts/live-drive/harness/portal-agreements-owner-card-mount/card-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const i = argv.indexOf("--out");
const out = path.resolve(repo, i >= 0 ? argv[i + 1] : "scripts/live-drive/artifacts/e09-portal-owner-card");
fs.mkdirSync(out, { recursive: true });
const PORT = 5253;
const LINE = "PARTIAL · once your client has joined their portal, files you share on their Solo client record appear in Documents, and agreements you send them from Sales appear in Agreements to sign and download.";

const vite = await new Promise((resolve, reject) => {
  const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  const on = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
  child.stdout.on("data", on); child.stderr.on("data", on);
  child.on("exit", (c) => reject(new Error(`vite exited ${c}: ${log}`)));
  setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
});
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
let failed = false;
const results = {};
try {
  for (const theme of ["light", "dark"]) for (const [kind, w, h] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, reducedMotion: "reduce", ...(kind === "phone" ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await ctx.newPage();
    const errors = [], blocked = [];
    await page.route("**/*", (r) => { const u = new URL(r.request().url()); if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return r.continue(); blocked.push(u.href.slice(0, 120)); return r.abort("blockedbyclient"); });
    page.on("pageerror", (e) => errors.push(String(e)));
    const name = `e09-owner-portal-card-sub_account-${theme}-${kind}-${w}x${h}`;
    let err = null, text = null, others = null;
    try {
      await page.goto(`http://127.0.0.1:${PORT}/?tier=sub_account&theme=${theme}`, { timeout: 180_000 });
      await page.getByRole("tab", { name: /^Portal$/ }).or(page.getByRole("button", { name: /^Portal$/ })).first().click({ timeout: 60_000 });
      const card = page.locator("article", { hasText: "Files and agreements" });
      await card.waitFor({ timeout: 30_000 });
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      text = (await card.locator("span").first().innerText()).replace(/\s+/g, " ").trim();
      others = await page.getByText(/agreements unchanged|other files vary by authorized account/).count();
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      await card.screenshot({ path: path.join(out, `${name}-card.png`) });
    } catch (e) { err = String(e).slice(0, 300); }
    const ok = !err && text === LINE && others === 0 && errors.length === 0 && blocked.length === 0;
    if (!ok) failed = true;
    results[name] = { ok, err, text, others, errors, blocked };
    console.log(`${name} ${ok ? "OK" : "FAIL"}`, JSON.stringify(results[name]));
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, "e09-owner-portal-card.json"), JSON.stringify(results, null, 2));
} finally { await browser.close(); try { process.kill(-vite.pid); } catch { /* gone */ } }
process.exit(failed ? 1 : 0);
