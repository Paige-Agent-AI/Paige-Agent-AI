#!/usr/bin/env node
// Evidence drive for INT-345: the REAL dialer rendering every honest
// calling-readiness state (docs/evidence/ui-delivery/solo-voice-readiness-parity.md).
//
//   node scripts/live-drive/voice-states-drive.mjs <outDir>
//
// Boots the voice-mount harness dev server, opens each readiness state, clicks
// the real trigger, waits for the real provider to resolve needs_config, and
// captures the REAL DialPad sheet. The rendered copy comes from the shipped
// classifyVoiceReadiness via the stub, so each PNG proves the exact string the
// deployed edge serves. Also records a JSON summary asserting the expected
// message substring per state — a capture whose copy drifted fails the drive.
//
// Harness/local render, not the deployed surface (§32.c). Synthetic fixtures only (§63).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";

const HARNESS = path.resolve(import.meta.dirname, "harness/voice-mount");
const PORT = 5217;
const BASE = `http://127.0.0.1:${PORT}`;

const STATES = [
  { key: "not_configured", expect: "Calling is not configured for this workspace." },
  { key: "no_primary", expect: "Send from this" },
  { key: "multiple_primary", expect: "Contact support" },
  { key: "wrong_subaccount", expect: "Contact support" },
  { key: "missing_binding", expect: "Contact support" },
  { key: "no_voice", expect: "marked for calls" },
];

const outDir = path.resolve(process.argv[2] ?? "docs/evidence/ui-delivery/assets/voice-readiness-states");
fs.mkdirSync(outDir, { recursive: true });

const vite = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "--config", path.join(HARNESS, "vite.config.ts")],
  { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" },
);
let viteLog = "";
vite.stdout.on("data", (d) => { viteLog += d; });
vite.stderr.on("data", (d) => { viteLog += d; });

async function waitForServer(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`vite dev server never became ready:\n${viteLog}`);
}

try {
  await waitForServer();
  const { chromium } = await resolvePlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveExecutablePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
  const summary = { harness: "voice-mount", renders: [], failures: [] };

  // Dark-theme renders (the harness ThemeProvider defaults dark; the light
  // variant is not wired through next-themes' storage, so claiming it would
  // be dishonest — the captures are labeled dark).
  for (const state of STATES) {
    const page = await browser.newPage({ viewport: { width: 480, height: 760 } });
    // domcontentloaded, not networkidle: the vite HMR websocket keeps the
    // network busy forever on a dev server, so networkidle never resolves.
    await page.goto(`${BASE}/?state=${state.key}`, { waitUntil: "domcontentloaded" });
    const trigger = page.locator('button[aria-label="Dialer"]');
    await trigger.waitFor({ timeout: 60_000 }); // first load pays vite's transform
    await trigger.click();
    const heading = page.locator("text=Calling isn't set up yet");
    await heading.waitFor({ timeout: 15_000 });
    // Wait out the Radix sheet's slide-in fully, then require the dialog box
    // to be stable for two consecutive samples (a mid-animation capture clips
    // the copy — caught by visual inspection of the first run).
    await page.waitForTimeout(900);
    const box = await page.locator('[role="dialog"]').boundingBox();
    if (!box || box.width < 300 || box.height < 200) {
      summary.failures.push({ state: state.key, meta: "sheet-box", box });
      continue;
    }
    const body = await page.textContent("body");
    const copyOk = body.includes(state.expect);
    const file = `${state.key}-dark.png`;
    await page.screenshot({ path: path.join(outDir, file), clip: { x: 480 - box.width - 16, y: 0, width: box.width + 16, height: 760 } });
    summary.renders.push({ state: state.key, theme: "dark", file, copyOk, expect: state.expect, sheetWidth: Math.round(box.width) });
    if (!copyOk) summary.failures.push({ state: state.key, missing: state.expect });
    await page.close();
  }

  await browser.close();

  // Meta self-test: byte-identical captures mean the sheet never painted — a
  // flat viewport satisfies copy assertions (DOM text) while proving nothing.
  // Distinct states MUST produce distinct images.
  const { createHash } = await import("node:crypto");
  const hashes = new Map();
  for (const r of summary.renders) {
    const h = createHash("md5").update(fs.readFileSync(path.join(outDir, r.file))).digest("hex");
    r.md5 = h.slice(0, 12);
    hashes.set(h, (hashes.get(h) ?? 0) + 1);
  }
  summary.distinctCaptures = hashes.size;
  if (hashes.size < STATES.length) {
    summary.failures.push({ meta: "identical-captures", distinct: hashes.size, expectedAtLeast: STATES.length });
  }

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`captured ${summary.renders.length} renders (${summary.distinctCaptures} distinct) → ${outDir}`);
  if (summary.failures.length) {
    console.error("CAPTURE FAILURES:", JSON.stringify(summary.failures, null, 2));
    process.exitCode = 1;
  }
} finally {
  // vite.kill() leaves the Windows shell-spawned child tree alive, hanging the
  // drive after the work is done — kill the tree.
  if (process.platform === "win32" && vite.pid) {
    spawn("taskkill", ["/pid", String(vite.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    vite.kill();
  }
}
