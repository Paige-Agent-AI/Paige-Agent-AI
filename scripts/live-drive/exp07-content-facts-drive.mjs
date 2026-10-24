#!/usr/bin/env node
// EXP07 row 3 surfacing — the Content library's preview facts line carrying what a generated
// image's completion actually recorded (format · dimensions · model · license), captured for real
// at the four Solo geometries with the PAIGE column closed and reserved.
//
// WHAT IT PROVES. The REAL GrowthHub content tab (src/solo/marketing-content.tsx through
// growth2.tsx) with only its network reads stubbed (marketing-mount harness): mc-1 carries the
// metadata a real completion records; mc-7 carries none. For each frame it asserts: the preview
// opens, the facts line shows every recorded fragment for mc-1, no invented fragment for mc-7,
// no horizontal overflow in the scroll owner, no sideways document, no harness crash, no page
// error.
//
// WHAT IT DOES NOT PROVE. Real data, real permissions, or the authenticated production surface.
// Those stay owed to the authenticated customer proof (matrix row 16).
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5224;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(import.meta.dirname, "../../docs/evidence/ui-delivery/assets/exp07-content-facts");
const REPO = path.resolve(import.meta.dirname, "../..");
const FRAMES = [
  { name: "1536x770", width: 1536, height: 770 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x1000", width: 900, height: 1000 },
];
const POSTURES = ["closed", "open"];

const results = [];
function check(ok, name, detail = "") {
  results.push({ ok, name, detail });
  if (!ok) console.log(`FAIL  ${name}${detail ? `  ${detail}` : ""}`);
}
function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${PORT} is already in use.`)));
    probe.once("listening", () => probe.close(resolve));
    probe.listen(PORT, "127.0.0.1");
  });
}
async function stopTree(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 300));
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
}
const probeOnce = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

async function openPreview(page, { piece, paige = "closed", theme = "light" }) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}?tab=content&piece=${piece}&theme=${theme}&paige=${paige}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector('[role="dialog"] .mct-facts, [data-harness-error]', { timeout: 30000 });
  await page.waitForTimeout(300);
  return errors;
}
const factsOf = (page) => page.evaluate(() => ({
  crashed: Boolean(document.querySelector("[data-harness-error]")),
  line: document.querySelector('[role="dialog"] .mct-facts')?.textContent ?? null,
  // The campaigns drawer is position:fixed (min(960px,96vw) wide), so the DOCUMENT can't show its
  // overflow — the drawer's own body is the scroll owner (review fix for the PR4 finding; the
  // earlier run measured .campaigns-scroll, the library page behind the drawer).
  drawerOverflowX: (() => { const b = document.querySelector(".campaigns-drawer .campaigns-drawer-body"); return b ? b.scrollWidth - b.clientWidth : null; })(),
  drawerFitsViewport: (() => { const r = document.querySelector(".campaigns-drawer")?.getBoundingClientRect(); return r ? r.right <= innerWidth + 1 && r.left >= -1 && r.width > 0 : null; })(),
  sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
}));

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
  const { chromium } = await resolvePlaywright();
  let browser;
  const frames = [];
  try {
    for (let i = 0; i < 40 && !(await probeOnce()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await probeOnce())) throw new Error("harness did not come up");
    browser = await chromium.launch(buildLaunchOptions());
    const page = await browser.newPage();

    // The recorded-facts piece at every Solo geometry, PAIGE closed and reserved.
    for (const frame of FRAMES) {
      for (const paige of POSTURES) {
        await page.setViewportSize({ width: frame.width, height: frame.height });
        const errors = await openPreview(page, { piece: "mc-1", paige });
        const facts = await factsOf(page);
        const name = `solo-${frame.name}-paige-${paige}`;
        await page.screenshot({ path: path.join(OUT, `${name}.png`) });
        frames.push({ frame: name, ...facts, pageErrors: errors });
        check(!facts.crashed && errors.length === 0, `${name} renders without error`, errors.join("; "));
        check(typeof facts.line === "string" && facts.line.includes("SVG") && facts.line.includes("1440×960") && facts.line.includes("made by fal-ai/flux-pro") && facts.line.includes("provider & model terms"), `${name} facts line carries the recorded fragments`, facts.line ?? "");
        check((facts.drawerOverflowX ?? 1) <= 0 && facts.drawerFitsViewport === true && !facts.sideways, `${name} no horizontal overflow in the drawer (fixed; its body is the scroll owner)`, `drawerOverflowX=${facts.drawerOverflowX} fitsViewport=${facts.drawerFitsViewport}`);
      }
    }

    // The honest-absence piece: an image with no recorded metadata invents nothing.
    await page.setViewportSize({ width: 1536, height: 770 });
    await openPreview(page, { piece: "mc-7" });
    const bare = await factsOf(page);
    await page.screenshot({ path: path.join(OUT, "solo-1536x770-paige-closed-no-meta.png") });
    check(typeof bare.line === "string" && /^Image · Square · Draft · saved/.test(bare.line) && !bare.line.includes("made by") && !bare.line.includes("×"), "no-meta image shows no invented facts", bare.line ?? "");

    // A dark-theme frame of the recorded-facts piece (contrast of the small facts text).
    await openPreview(page, { piece: "mc-1", theme: "dark" });
    const dark = await factsOf(page);
    await page.screenshot({ path: path.join(OUT, "solo-1536x770-paige-closed-dark.png") });
    check(dark.line !== null && dark.line.includes("1440×960"), "dark theme shows the same facts", dark.line ?? "");
  } finally {
    await browser?.close();
    await stopTree(vite);
  }
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ frames, results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed; ${frames.length} frames captured to ${OUT}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
