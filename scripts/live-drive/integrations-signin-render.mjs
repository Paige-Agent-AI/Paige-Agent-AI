#!/usr/bin/env node
/**
 * Renders the Connected MCP Gateway SIGN-IN flow — the surface Slice ④ added and the one three
 * review rounds have all been about — in both genuine themes.
 *
 * WHAT CLASS OF EVIDENCE THIS IS (§70.1). Structural/harness render, driven in a real Chromium
 * against the real components and the real stylesheets, with the Supabase transport stubbed. It
 * proves layout, theme, copy and state behaviour. It is NOT authenticated runtime proof: no real
 * session, no real database, no real provider. That drive stays owed and is reported as owed,
 * never implied by these frames.
 *
 * WHY IT EXISTS SEPARATELY FROM `integrations-fit-drive.mjs` (§18). That drive measures the
 * Integrations PAGE — geometry, scroll ownership, the legacy manage form. It never opens the
 * catalogue, so every state the gateway sign-in owns has gone un-rendered through four slices.
 * This adds those states and reuses the same mount, the same launcher resolution and the same
 * artifacts directory rather than forking any of them.
 *
 * Usage:
 *   npx vite --config scripts/live-drive/harness/integrations-mount/vite.config.ts   # port 5203
 *   node scripts/live-drive/integrations-signin-render.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";

const BASE = process.env.HARNESS_URL || "http://127.0.0.1:5203";
const OUT = path.resolve("scripts/live-drive/artifacts/signin");
mkdirSync(OUT, { recursive: true });

const findings = [];
const check = (pass, message) => {
  findings.push(`${pass ? "PASS" : "FAIL"}  ${message}`);
  console.log(`${pass ? "PASS" : "FAIL"}  ${message}`);
  return pass;
};

/** Waits for every running animation to finish so a frame is never caught mid-transition. */
const settle = async (page) => {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(80);
};

const shot = async (page, name) => {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};

/** Opens the catalogue and routes into a provider that signs in, the way a person reaches it. */
async function openSignIn(page, provider) {
  await page.click('.ig-card[data-provider="mcp-add"]');
  await page.waitForSelector(".ig-gw-tile", { timeout: 15000 });
  await page.click(`.ig-gw-tile:has(.ig-gw-tile-name:text-is("${provider}"))`);
  await page.waitForSelector('label.ig-field:has(span:text-is("Name")) input', { timeout: 15000 });
}

const nameField = (page) => page.locator('label.ig-field:has(span:text-is("Name")) input');
const addressField = (page) => page.locator('label.ig-field:has(span:text-is("Server address")) input');

async function main() {
  const { chromium } = await resolvePlaywright();
  const executablePath = resolveExecutablePath();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });

  try {
    for (const theme of ["light", "dark"]) {
      // A refusal from oauth_begin is what makes the retry state reachable at all: a success
      // navigates away to the provider, so the locked-name state would never paint.
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/?theme=${theme}&data=signin-fail`, { waitUntil: "networkidle" });
      await openSignIn(page, "Close");

      // 1. The form as a person first meets it.
      const freshDisabled = await nameField(page).isDisabled();
      check(!freshDisabled, `${theme} · the name is editable before anything is saved`);
      await shot(page, `${theme}-signin-form`);

      await nameField(page).fill("My Close");
      await addressField(page).fill("https://wrong.example.invalid/mcp");
      await page.getByRole("button", { name: /^Sign in to Close$/ }).click();

      // 2. The state after a refused begin: the row exists, so the name can no longer change.
      await page.waitForSelector(".ig-error", { timeout: 15000 });
      const lockedDisabled = await nameField(page).isDisabled();
      check(lockedDisabled, `${theme} · the name LOCKS once the shell row exists`);
      const kept = await nameField(page).inputValue();
      check(kept === "My Close", `${theme} · the typed name is kept, not cleared (got ${JSON.stringify(kept)})`);
      const addrEditable = !(await addressField(page).isDisabled());
      check(addrEditable, `${theme} · the ADDRESS stays editable — it is the field a retry can apply`);
      const text = await page.locator('[role="dialog"]').innerText();
      check(
        /remove it from Integrations and start again/.test(text),
        `${theme} · the locked field says what to do instead of leaving it unexplained`,
      );
      check(
        /saved under that name/i.test(text),
        `${theme} · the failure copy tells the owner the row EXISTS (never "nothing happened")`,
      );
      check(!/non-2xx|undefined|null|MCP_[A-Z_]+/.test(text), `${theme} · no framework or database jargon reached the owner`);
      await shot(page, `${theme}-signin-refused-name-locked`);

      // 3. The address is genuinely correctable on the retry — the round-2 fix, rendered.
      await addressField(page).fill("https://right.example.invalid/mcp");
      const corrected = await addressField(page).inputValue();
      check(corrected === "https://right.example.invalid/mcp", `${theme} · a corrected address is accepted on retry`);
      await shot(page, `${theme}-signin-retry-address-corrected`);

      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  const failed = findings.filter((f) => f.startsWith("FAIL"));
  writeFileSync(path.join(OUT, "signin-render-report.json"), JSON.stringify({ findings, failed: failed.length }, null, 2));
  console.log(`\n${findings.length - failed.length}/${findings.length} checks passed`);
  console.log(`frames → ${OUT}`);
  if (failed.length) { console.log(`\n${failed.length} FAILURE(S)`); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
