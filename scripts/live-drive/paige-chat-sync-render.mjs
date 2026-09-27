#!/usr/bin/env node
/**
 * Renders the client portal's chat (PaigeChat, as AppShell mounts it on /app) after a credit report
 * whose sync did not complete (R3b), against scripts/live-drive/harness/paige-chat-mount: before, the
 * pipeline's own text and step name; after, the sentences from supabase/functions/_shared/client-seat-reply.ts:
 * one for a sync that stopped before its first write, one for a sync that stopped after it.
 *
 * WHAT CLASS OF EVIDENCE THIS IS. A structural harness render, driven in a real Chromium: the real chat
 * and panel components and stylesheets, the chat endpoint answered in-page. It proves what an uploader
 * reads at each width and in both themes. It is NOT authenticated runtime proof; the server's choice
 * of sentence is proven in the handler harness (30.33) and the unit suite.
 *
 * Usage: node scripts/live-drive/paige-chat-sync-render.mjs
 *   Writes PNGs and drive-results.json to docs/evidence/ui-delivery/credit-sync-message/.
 */
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";
import { createServer } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { syncStatusForClient } from "../../supabase/functions/_shared/client-seat-reply.ts";

const OUT = path.resolve("docs/evidence/ui-delivery/credit-sync-message");
const SENTENCE = String(syncStatusForClient({ success: false, step: "extraction_parse" }, "Northside Fitness")?.error);
const PARTIAL = String(syncStatusForClient({ success: false, step: "write_rejected" }, "Northside Fitness")?.error);
// The panel's fallback is the did-not-finish sentence without a business name (the panel has none).
const FALLBACK = String(syncStatusForClient({ success: false, step: "write_rejected" })?.error);

const server = await createServer({
  configFile: path.resolve("scripts/live-drive/harness/paige-chat-mount/vite.config.ts"),
  logLevel: "error",
  server: { port: 0, strictPort: false },
});
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, "");
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  ...(resolveExecutablePath() ? { executablePath: resolveExecutablePath() } : {}),
});

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function render({ width, height, theme = "light", variant, scale = 1 }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?theme=${theme}&variant=${variant}&doc=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea", { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.locator("button.bg-gradient-gold").click();
  await page.waitForFunction(() => document.body.innerText.includes("Sync Incomplete"), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const panel = [...document.querySelectorAll("div")].find((n) => n.textContent?.startsWith("⚠️ Sync Incomplete"));
    const r = panel?.getBoundingClientRect();
    return {
      text: panel?.textContent ?? "",
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped: panel ? panel.scrollWidth - panel.clientWidth : -1,
      inViewport: r ? r.left >= 0 && r.right <= window.innerWidth : false,
    };
  });
  return { page, context, errors, m };
}

try {
  mkdirSync(OUT, { recursive: true });
  // BEFORE_ONLY=1, run from a checkout of the base commit (the old panel), renders what an uploader
  // used to read and stops there.
  const before = await render({ width: 1366, height: 768, variant: "syncfail-before" });
  if (process.env.BEFORE_ONLY === "1") {
    await before.page.screenshot({ path: path.join(OUT, "before-1366x768-light.png") });
    check("BEFORE (base commit's panel, the pipeline's frame): the uploader read the step name and the pipeline's own text",
      before.m.text.includes("(step: extraction_parse)") && before.m.text.includes("Failed to parse extracted data"), before.m.text.slice(-120));
    await before.context.close();
    throw Object.assign(new Error("before only"), { beforeOnly: true });
  }
  // A server still sending the pipeline's frame (an older deployment) to this panel: neither its text nor
  // its step is drawn; the panel's own fallback sentence is.
  await before.page.screenshot({ path: path.join(OUT, "stale-server-1366x768-light.png") });
  check("a stale server's raw frame on this panel: no pipeline text and no step, the fallback sentence instead",
    before.m.text.includes(FALLBACK) && !/extraction_parse|Failed to parse|step|Error:/.test(before.m.text), before.m.text.slice(-120));
  await before.context.close();

  for (const [width, height, themes] of [[1536, 770, ["light"]], [1366, 768, ["light", "dark"]], [1024, 768, ["light"]], [390, 844, ["light", "dark"]]]) {
    for (const theme of themes) {
      const r = await render({ width, height, theme, variant: "syncfail" });
      const name = `after-${width}x${height}-${theme}`;
      await r.page.screenshot({ path: path.join(OUT, `${name}.png`) });
      check(`${name}: the uploader reads the sentence, no step name, no pipeline text, nothing clipped or scrolling sideways`,
        r.m.text.includes(SENTENCE) && !/extraction_parse|step|Failed to parse|Error:/.test(r.m.text)
          && r.m.docOverflow <= 0 && r.m.clipped <= 0 && r.m.inViewport && r.errors.length === 0,
        JSON.stringify({ ...r.m, text: r.m.text.slice(-80), errors: r.errors }));
      await r.context.close();
    }
  }
  // A sync that stopped after its first write: the second sentence, which claims nothing about what was kept.
  for (const [width, height, theme] of [[1366, 768, "light"], [390, 844, "light"], [390, 844, "dark"]]) {
    const r = await render({ width, height, theme, variant: "syncpartial" });
    const name = `partial-${width}x${height}-${theme}`;
    await r.page.screenshot({ path: path.join(OUT, `${name}.png`) });
    check(`${name}: a sync stopped after its first write reads the did-not-finish sentence, no claim that nothing was added, nothing clipped`,
      r.m.text.includes(PARTIAL) && !/none of them were added|uploading it again|write_rejected|credit_report_uploads|step|Error:/.test(r.m.text)
        && r.m.docOverflow <= 0 && r.m.clipped <= 0 && r.m.inViewport && r.errors.length === 0,
      JSON.stringify({ ...r.m, text: r.m.text.slice(-80), errors: r.errors }));
    await r.context.close();
  }
  const zoom = await render({ width: 683, height: 384, variant: "syncfail", scale: 2 });
  await zoom.page.screenshot({ path: path.join(OUT, "after-zoom200-1366x768.png") });
  check("200% zoom of 1366x768: the sentence reflows and nothing scrolls sideways", zoom.m.text.includes(SENTENCE) && zoom.m.docOverflow <= 0 && zoom.m.clipped <= 0, JSON.stringify({ docOverflow: zoom.m.docOverflow, clipped: zoom.m.clipped }));
  await zoom.context.close();
} catch (e) {
  if (!e?.beforeOnly) throw e;
} finally {
  await browser.close();
  await server.close();
  writeFileSync(path.join(OUT, process.env.BEFORE_ONLY === "1" ? "before-results.json" : "drive-results.json"), JSON.stringify({ harness: "paige-chat-mount", results }, null, 2) + "\n");
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
