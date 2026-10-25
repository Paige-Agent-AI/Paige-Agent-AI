// EXP07 row 8 — the content-calendar PLAN, driven on the marketing-mount harness:
// (1) the tab renders the plan grouped by local day with channel labels, linked-piece titles,
//     plan statuses (planned / ready-to-schedule / cancelled strike-through) and the BOUNDARY line
//     that says nothing here posts or schedules by itself;
// (2) adding an entry runs the governed RPC with p_tenant_id null (the browser never names a
//     tenant) and a tz-aware planned_for (recorded in-page on window.__planCalls);
// (3) cancelling an entry is a status change on the same row — the RPC is upsert, never a create,
//     so a plan edit cannot duplicate anything;
// (4) the empty state (?plan=0) says so honestly.
// Four Solo viewports × PAIGE closed/open. Harness render — NOT live.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(root, "docs/evidence/ui-delivery/assets/exp07-calendar");
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.EXP07_CALENDAR_PORT || 5228);
const BASE = `http://127.0.0.1:${PORT}/`;

const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore", detached: true });
const probeOnce = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});
const { chromium: resolveChromium } = { chromium };
let browser;
const frames = [];
const results = [];
const check = (ok, name, detail = "") => { results.push({ ok, name, detail }); if (!ok) console.log(`FAIL  ${name}  ${detail}`); };

const label = async (page) => {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "10px", bottom: "8px", zIndex: "9999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
};
const shoot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const planCalls = (page) => page.evaluate(() => window.__planCalls ?? []);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function openTab(page, { paige = "closed", theme = "light", plan = "" } = {}) {
  await page.goto(`${BASE}?tab=calendar&theme=${theme}&paige=${paige}${plan ? `&plan=${plan}` : ""}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector(".cpc", { timeout: 60_000 });
  await page.waitForSelector(".cpc-entry, .cpc-note", { timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function main() {
  for (let i = 0; i < 40 && !(await probeOnce()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await probeOnce())) throw new Error("harness did not come up");
  browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || undefined });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ── The 8 Solo frames: the plan tab, entries loaded ──
  for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
    for (const paige of ["closed", "open"]) {
      const name = `solo-${w}x${h}-paige-${paige}`;
      await page.setViewportSize({ width: w, height: h });
      await openTab(page, { paige });
      const body = await page.locator(".cpc").innerText();
      const boundary = await page.locator(".cpc-boundary").innerText();
      check(body.includes("Social post") && body.includes("Email") && body.includes("Website update"), `${name} channel labels render`, "");
      check(body.includes("Workshop reminder: two days out"), `${name} linked piece title renders`, "");
      check(body.includes("Ready to schedule") && body.includes("Cancelled"), `${name} plan statuses render`, "");
      check(boundary.includes("nothing here posts or schedules"), `${name} the boundary line is on the surface`, boundary.slice(0, 90));
      const cancelledEl = page.locator(".cpc-entry[data-status='cancelled'] .cpc-what");
      if (await cancelledEl.count() > 0) {
        const cancelledStruck = await cancelledEl.first().evaluate((el) => getComputedStyle(el).textDecorationLine.includes("line-through"));
        check(cancelledStruck, `${name} a cancelled entry is struck through, not hidden`, "");
      } else {
        check(false, `${name} the cancelled entry rendered`, "selector found no cancelled row");
      }
      const ox = await overflow(page);
      check(ox <= 0, `${name} no horizontal overflow`, `overflowX=${ox}`);
      await label(page);
      await shoot(page, name);
      frames.push({ frame: name, overflowX: ox });
    }
  }

  // ── Add an entry: the governed RPC with a tz-aware instant and no client-named tenant ──
  await page.setViewportSize({ width: 1366, height: 768 });
  await openTab(page);
  await page.click("button:has-text('Add a plan entry')");
  await page.fill(".cpc-form input[type='datetime-local']", "2026-11-05T09:00");
  await page.selectOption(".cpc-form select >> nth=0", "blog_outline");
  await page.selectOption(".cpc-form select >> nth=1", "mc-4");
  await page.fill(".cpc-form input[type='text']", "Teardown post from the library");
  await page.click("button:has-text('Add to plan')");
  await page.waitForTimeout(500);
  const calls = await planCalls(page);
  const upsert = calls.filter((c) => c.fn === "content_plan_upsert").pop();
  check(Boolean(upsert) && upsert.args.p_tenant_id === null && upsert.args.p_channel === "blog_outline" && upsert.args.p_content_id === "mc-4",
    "adding runs the governed upsert (tenant never named by the browser)", JSON.stringify(upsert?.args ?? null).slice(0, 120));
  check(typeof upsert?.args.p_planned_for === "string" && /Z$|[+-]\d\d:\d\d$/.test(String(upsert.args.p_planned_for)), "planned_for is a timezone-aware instant", String(upsert?.args.p_planned_for));
  const body = await page.locator(".cpc").innerText();
  check(body.includes("Teardown post from the library"), "the new entry renders after save", "");
  await label(page);
  await shoot(page, "add-entry-1366x768");

  // ── Cancel is an upsert on the SAME row: no second create, nothing to duplicate ──
  const before = (await planCalls(page)).filter((c) => c.fn === "content_plan_upsert").length;
  await page.locator(".cpc-entry:not([data-status='cancelled']) button:has-text('Cancel')").first().click();
  await page.waitForTimeout(500);
  const after = (await planCalls(page)).filter((c) => c.fn === "content_plan_upsert");
  check(after.length === before + 1 && after[after.length - 1].args.p_status === "cancelled" && Boolean(after[after.length - 1].args.p_id),
    "cancelling re-upserts the same row (p_id set, status cancelled — no new row)", JSON.stringify(after[after.length - 1]?.args).slice(0, 120));
  await label(page);
  await shoot(page, "cancel-entry-1366x768");

  // ── The empty state ──
  await openTab(page, { plan: "0" });
  const empty = await page.locator(".cpc").innerText();
  check(empty.includes("Nothing planned yet"), "empty state is honest", "");
  await label(page);
  await shoot(page, "empty-1366x768");

  // ── A dark-theme frame ──
  await openTab(page, { theme: "dark" });
  await label(page);
  await shoot(page, "solo-1366x768-paige-closed-dark");

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ frames, results, pageErrors: errors }, null, 2));
  console.log(`${results.length - failed}/${results.length} checks passed${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}; ${frames.length} frames captured to ${OUT}`);
  process.exit(failed || errors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* ignore */ }
  try { process.platform === "win32" && spawn("taskkill", ["/F", "/T", "/PID", String(vite.pid)], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
});
