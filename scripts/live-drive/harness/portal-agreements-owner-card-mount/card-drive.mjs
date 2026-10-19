// Render the owner's Clients → Portal "Files and agreements" card (TenantRelationshipsClientsWorkspace PortalView)
// in light and dark, desktop 1440x900 and phone 390x844, after document.fonts.ready, and assert the one line that
// is true for the Sub-account that sees it, and the AA contrast of every text node in the card. HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1).
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
const LINE = "PARTIAL · once your client has joined their portal, agreements you ask Paige to draft and send them appear in Agreements to sign and download. This account's client record does not offer file sharing yet.";

// AA contrast of every visible text node in the card, against its real composited background (same method as the
// customer drive's measureInPage, without the gradient pass: this card carries no gradient fill).
function cardContrast(card) {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((k) => Math.round(f[k] * a + b[k] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (transparent(c)) continue; layers.push(c); if (alphaOf(c) >= 1) break; }
    const body = getComputedStyle(document.body).backgroundColor;
    let acc = layers.length && alphaOf(layers[layers.length - 1]) >= 1 ? layers.pop() : (transparent(body) ? "rgb(255,255,255)" : body);
    while (layers.length) acc = blend(layers.pop(), acc);
    return acc;
  };
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const nodes = [card, ...card.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && n.getClientRects().length > 0);
  return nodes.map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), p = parse(cs.color), a = (p.length > 3 ? p[3] : 1) * opacityOf(n);
    const fg = a < 1 ? blend(`rgba(${p[0]},${p[1]},${p[2]},${a})`, bg) : cs.color;
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 40), ratio: ratio(fg, bg), need: size >= 24 || (bold && size >= 18.66) ? 3 : 4.5, size: cs.fontSize };
  });
}

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
    let err = null, text = null, others = null, contrast = [];
    try {
      await page.goto(`http://127.0.0.1:${PORT}/?tier=sub_account&theme=${theme}`, { timeout: 180_000 });
      await page.getByRole("tab", { name: /^Portal$/ }).or(page.getByRole("button", { name: /^Portal$/ })).first().click({ timeout: 60_000 });
      const card = page.locator("article", { hasText: "Files and agreements" });
      await card.waitFor({ timeout: 30_000 });
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      text = (await card.locator("span").first().innerText()).replace(/\s+/g, " ").trim();
      others = await page.getByText(/agreements unchanged|other files vary by authorized account|from Sales|on their Solo client record appear/).count();
      contrast = await card.evaluate(cardContrast);
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      await card.screenshot({ path: path.join(out, `${name}-card.png`) });
    } catch (e) { err = String(e).slice(0, 300); }
    const contrastMin = contrast.length ? Math.min(...contrast.map((c) => c.ratio)) : null;
    const low = contrast.filter((c) => c.ratio < c.need);
    const ok = !err && text === LINE && others === 0 && contrast.length > 0 && low.length === 0 && errors.length === 0 && blocked.length === 0;
    if (!ok) failed = true;
    results[name] = { ok, err, text, others, contrastMin, low, contrast, errors, blocked };
    console.log(`${name} ${ok ? "OK" : "FAIL"}`, JSON.stringify(results[name]));
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, "e09-owner-portal-card.json"), JSON.stringify(results, null, 2));
} finally { await browser.close(); try { process.kill(-vite.pid); } catch { /* gone */ } }
process.exit(failed ? 1 : 0);
