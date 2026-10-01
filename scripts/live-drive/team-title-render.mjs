#!/usr/bin/env node
/**
 * Renders every Team screen state that shows the word for what someone is called, for the "title"
 * wording change, against the shared team-mount harness.
 *
 * WHAT CLASS OF EVIDENCE THIS IS. Structural/harness render, driven in a real Chromium against the
 * real components inside the tenant shell's structure, with the real stylesheets — and with the
 * Supabase client and tenant context stubbed (scripts/live-drive/harness/team-mount). It proves the
 * words a person reads, the layout at each width and both themes. It is NOT authenticated runtime
 * proof, and the PAIGE panel is not rendered (the harness shell is PAIGE-closed).
 *
 * Usage: node scripts/live-drive/team-title-render.mjs <label>
 *   Starts the harness dev server itself, writes <label>-*.png and <label>-copy.txt to
 *   docs/evidence/ui-delivery/team-title/. Run it on main as "before" and on the change as "after".
 */
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";
import { createServer } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const label = process.argv[2];
if (!/^[a-z0-9-]+$/.test(label ?? "")) {
  console.error("usage: node scripts/live-drive/team-title-render.mjs <label>");
  process.exit(2);
}

const OUT = path.resolve("docs/evidence/ui-delivery/team-title");
const VIEWPORTS = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];

const server = await createServer({
  configFile: path.resolve("scripts/live-drive/harness/team-mount/vite.config.ts"),
  logLevel: "error",
  server: { port: 0, strictPort: false },
});
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, "");

// The shared resolvers, not the proxy: this target is a local dev server (see team-removal-render).
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  ...(resolveExecutablePath() ? { executablePath: resolveExecutablePath() } : {}),
});

const transcript = [];
const findings = [];

async function open(width, height, theme, state = "dense") {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => findings.push(`page error ${width}x${height} ${theme}: ${e.message}`));
  await page.goto(`${BASE}/?theme=${theme}&state=${state}`, { waitUntil: "networkidle" });
  await page.waitForSelector("button.stw-row", { timeout: 15000 });
  return page;
}

async function record(page, scene) {
  const lines = await page.evaluate(() =>
    document.body.innerText.split("\n").map((l) => l.trim()).filter((l) => /title/i.test(l)));
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("label, dt")).map((n) => n.firstChild?.textContent?.trim() ?? "")
      .filter((t) => /title/i.test(t)));
  transcript.push(`## ${scene}`, ...new Set(lines.map((l) => `- ${l}`)), ...labels.map((l) => `- label: ${l}`), "");
}

async function shot(page, name) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) findings.push(`${name}: the page scrolls sideways by ${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`) });
}

// A titled teammate who is not the owner (row 1: owners have no permission control).
async function openEditor(page) {
  await page.locator('button.stw-row:not(:has(.stw-pill[data-tone="owner"]))').first().click();
  await page.waitForSelector('[role="dialog"]');
}

try {
  mkdirSync(OUT, { recursive: true });
  for (const [w, h] of VIEWPORTS) {
    const page = await open(w, h, "light");
    await shot(page, `roster-${w}x${h}-light`);
    if (w === 1366) await record(page, "roster");
    await page.close();
  }
  {
    const page = await open(1366, 768, "dark");
    await shot(page, "roster-1366x768-dark");
    await page.close();
  }
  {
    const page = await open(1366, 768, "light", "first");
    await page.waitForSelector(".stw-first-use");
    await shot(page, "first-use-1366x768-light");
    await record(page, "first use");
    await page.close();
  }
  for (const theme of ["light", "dark"]) {
    const page = await open(1366, 768, theme);
    await openEditor(page);
    await shot(page, `editor-1366x768-${theme}`);
    if (theme === "light") {
      await record(page, "member editor");
      await page.locator('[role="dialog"] .stw-permission-change select').selectOption("admin");
      await page.waitForSelector('[role="dialog"] .stw-confirm');
      await shot(page, "permission-confirm-1366x768-light");
      await record(page, "permission-change confirmation");
    }
    await page.close();
  }
  {
    const page = await open(1366, 768, "light");
    await page.getByRole("button", { name: /^Invite someone$/ }).first().click();
    await page.waitForSelector('[role="dialog"]');
    await shot(page, "invite-1366x768-light");
    await record(page, "invitation form");
    await page.locator('[role="dialog"] input[type="email"]').fill("desk@northstar.example");
    await page.locator('[role="dialog"] button', { hasText: /^Review/ }).click();
    await page.getByText("Confirm invitation").first().waitFor();
    await shot(page, "invite-review-1366x768-light");
    await record(page, "invitation review");
    await page.close();
  }
  {
    const page = await open(1366, 768, "light");
    await page.getByText("Roles & access", { exact: true }).first().click();
    await page.getByText("Permissions are enforced").first().waitFor();
    await shot(page, "roles-1366x768-light");
    await record(page, "roles and access");
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

// .txt, not .md: the UI evidence validator reads every .md under docs/evidence/ui-delivery as a record.
writeFileSync(path.join(OUT, `${label}-copy.txt`), [`Visible "title" copy: ${label}`, "", ...transcript].join("\n"));
if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log(`wrote ${label} captures to ${path.relative(process.cwd(), OUT)}`);
