#!/usr/bin/env node
/**
 * INT-345 K-3 — rendered evidence for the calling-setup card.
 *
 * Captures the REAL SoloSettings → Registration surface (settings-mount harness:
 * real route, real shell chain, real CallingSetupCard + PhoneSetupPanel; only the
 * Supabase transport stubbed) at the four Solo viewports, PAIGE closed and open,
 * in the two load-bearing calling states:
 *   absent  — the four-stage card with the one-click "Set up calling" button
 *   noprim  — account connected, number owned, primary NOT chosen (the honest
 *             middle state that must NOT offer the setup button)
 *
 * Copy assertions per page keep the captures honest; the distinct-hash meta check
 * keeps them non-vacuous (a byte-identical set means something never painted).
 *
 * Harness render · not live (§32.c). Synthetic rows only (§63).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";

const HARNESS = path.resolve(import.meta.dirname, "harness/setup-card-mount");
const PORT = 5218;
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: "1536x770", width: 1536, height: 770 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x1000", width: 900, height: 1000 },
];

const STATES = [
  { key: "absent", expect: "Set up calling" },
  { key: "noprim", expect: "Send from this" },
  { key: "ready", expect: "Complete" },
];

const outDir = path.resolve("docs/evidence/ui-delivery/assets/voice-setup-card");
fs.mkdirSync(outDir, { recursive: true });

const vite = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "--config", path.join(HARNESS, "vite.config.ts")],
  { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" },
);
let viteLog = "";
vite.stdout.on("data", (d) => { viteLog += d; });
vite.stderr.on("data", (d) => { viteLog += d; });

async function waitForServer(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`settings-mount never became ready:\n${viteLog}`);
}

try {
  await waitForServer();
  const { chromium } = await resolvePlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveExecutablePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
  const summary = { renders: [], failures: [] };
  let firstPage = true;

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      for (const paige of ["closed", "open"]) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        await page.goto(`${BASE}/?state=${state.key}&paige=${paige}`, { waitUntil: "domcontentloaded" });
        const card = page.locator('[aria-label="Calling setup"]');
        // First load pays vite's cold transform of the whole Settings route — on a
        // slow box that is minutes, not seconds. Later pages ride the warm server.
        await card.waitFor({ timeout: firstPage ? 1_200_000 : 120_000 });
        firstPage = false;
        await page.waitForTimeout(400);
        const body = await page.textContent("body");
        const copyOk = body.includes(state.expect)
          && (state.key === "absent" || !body.includes("Set up calling"));
        const file = `setup-card-${state.key}-${vp.name}-paige-${paige}.png`;
        await page.screenshot({ path: path.join(outDir, file) });
        summary.renders.push({ state: state.key, viewport: vp.name, paige, file, copyOk });
        if (!copyOk) summary.failures.push({ state: state.key, viewport: vp.name, paige, missing: state.expect });
        await page.close();
      }
    }
  }
  await browser.close();

  // Meta self-test: byte-identical captures mean nothing painted.
  const hashes = new Map();
  for (const r of summary.renders) {
    const h = createHash("md5").update(fs.readFileSync(path.join(outDir, r.file))).digest("hex");
    r.md5 = h.slice(0, 12);
    hashes.set(h, (hashes.get(h) ?? 0) + 1);
  }
  summary.distinctCaptures = hashes.size;
  if (hashes.size < 12) {
    summary.failures.push({ meta: "identical-captures", distinct: hashes.size, total: summary.renders.length });
  }

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`captured ${summary.renders.length} renders (${summary.distinctCaptures} distinct) → ${outDir}`);
  if (summary.failures.length) {
    console.error("CAPTURE FAILURES:", JSON.stringify(summary.failures, null, 2));
    process.exitCode = 1;
  }
} finally {
  if (process.platform === "win32" && vite.pid) {
    spawn("taskkill", ["/pid", String(vite.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    vite.kill();
  }
}
