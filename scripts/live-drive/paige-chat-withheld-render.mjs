#!/usr/bin/env node
/**
 * Renders and drives the client portal's chat (PaigeChat, as AppShell mounts it on /app) through a
 * withheld answer (R3), against scripts/live-drive/harness/paige-chat-mount.
 *
 * WHAT CLASS OF EVIDENCE THIS IS. A structural harness render, driven in a real Chromium: the real chat
 * component and stylesheets, with its data hooks stubbed and the chat endpoint answered in-page with
 * the SHIPPED sentence (read from supabase/functions/_shared/client-seat-reply.ts, never retyped). It
 * proves what a client reads, at each width and in both themes, and that the portal does not keep the
 * sentence as a document's summary. It is NOT authenticated runtime proof, and no model wrote the
 * answer: the server's decision to withhold is proven in the handler harness, not here.
 *
 * Usage: node scripts/live-drive/paige-chat-withheld-render.mjs
 *   Starts the harness dev server itself; writes PNGs and drive-results.json to
 *   docs/evidence/ui-delivery/client-seat-withheld/.
 */
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";
import { createServer } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withheldReplyForClient } from "../../supabase/functions/_shared/client-seat-reply.ts";

const OUT = path.resolve("docs/evidence/ui-delivery/client-seat-withheld");
const BUSINESS = "Northside Fitness";
const SENTENCE = { withheld: withheldReplyForClient(BUSINESS), saved: withheldReplyForClient(BUSINESS, { savedSomething: true }) };
const QUESTION = "Can you update my phone number to (415) 555-0132?";

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

async function open({ width, height, theme = "light", variant = "withheld", doc = false, scale = 1, reducedMotion = "no-preference" }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/?theme=${theme}&variant=${variant}${doc ? "&doc=1" : ""}`, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea", { timeout: 15000 });
  await page.waitForTimeout(500);
  return { page, context, errors };
}

async function ask(page, text = QUESTION) {
  const box = page.locator("textarea").first();
  await box.click();
  await box.fill(text);
  await box.press("Enter");
}

async function waitFor(page, text) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 15000 });
  await page.waitForTimeout(300);
}

/** The bubble that holds `text`, measured: is every line visible, and does anything scroll sideways? */
async function measure(page, text) {
  return page.evaluate((t) => {
    const all = [...document.querySelectorAll("[data-paige-message-id]")];
    const bubble = all.find((n) => n.textContent?.includes(t));
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (!bubble) return { found: false, docOverflow };
    const r = bubble.getBoundingClientRect();
    return {
      found: true, docOverflow,
      clipped: bubble.scrollWidth - bubble.clientWidth,
      width: Math.round(r.width), height: Math.round(r.height),
      inViewport: r.left >= 0 && r.right <= window.innerWidth,
    };
  }, text);
}

try {
  mkdirSync(OUT, { recursive: true });

  // Each width the portal is used at: three desktop widths (chat panel at 40%) and a phone (full width).
  for (const [width, height, themes] of [[1536, 770, ["light"]], [1366, 768, ["light", "dark"]], [1024, 768, ["light"]], [390, 844, ["light", "dark"]]]) {
    for (const theme of themes) {
      for (const variant of ["withheld", "saved"]) {
        const { page, context, errors } = await open({ width, height, theme, variant });
        await ask(page);
        await waitFor(page, SENTENCE[variant]);
        const m = await measure(page, SENTENCE[variant]);
        const name = `${variant}-${width}x${height}-${theme}`;
        await page.screenshot({ path: path.join(OUT, `${name}.png`) });
        check(`${name}: the client reads the whole sentence, nothing scrolls sideways, no page error`,
          m.found && m.docOverflow <= 0 && m.clipped <= 0 && m.inViewport && errors.length === 0,
          JSON.stringify({ ...m, errors }));
        await context.close();
      }
    }
  }

  // 200% zoom: the same CSS pixels at twice the density, as the V1 matrix measured it.
  for (const [width, height] of [[683, 384], [768, 385]]) {
    const { page, context, errors } = await open({ width, height, scale: 2 });
    await ask(page);
    await waitFor(page, SENTENCE.withheld);
    const m = await measure(page, SENTENCE.withheld);
    await page.screenshot({ path: path.join(OUT, `zoom200-${width * 2}x${height * 2}.png`) });
    check(`200% zoom of ${width * 2}x${height * 2}: the sentence reflows and nothing scrolls sideways`,
      m.found && m.docOverflow <= 0 && m.clipped <= 0 && errors.length === 0, JSON.stringify(m));
    await context.close();
  }

  // Keyboard only: reach the message box with Tab, send with Enter, read the sentence.
  {
    const { page, context } = await open({ width: 1366, height: 768 });
    let reached = false;
    for (let i = 0; i < 25 && !reached; i += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA");
    }
    const focusVisible = await page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false);
    await page.keyboard.type(QUESTION);
    await page.keyboard.press("Enter");
    await waitFor(page, SENTENCE.withheld);
    check("keyboard: Tab reaches the message box (focus visible), Enter sends, and the sentence arrives",
      reached && focusVisible, JSON.stringify({ reached, focusVisible }));
    await context.close();
  }

  // Reduced motion: once the sentence has arrived, nothing on the chat is still animating.
  {
    const { page, context } = await open({ width: 1366, height: 768, reducedMotion: "reduce" });
    await ask(page);
    await waitFor(page, SENTENCE.withheld);
    await page.waitForTimeout(500);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    check("reduced motion: after the sentence arrives, no animation is running", running === 0, `running=${running}`);
    await context.close();
  }

  // The document turn: a withheld answer is never kept as the document's summary; a delivered one is.
  {
    const withheld = await open({ width: 1366, height: 768, doc: true });
    await withheld.page.locator("button.bg-gradient-gold").click();
    await waitFor(withheld.page, SENTENCE.withheld);
    const kept = await withheld.page.evaluate(() => window.__documentSummaries);
    await withheld.page.screenshot({ path: path.join(OUT, "withheld-document-1366x768-light.png") });
    check("document turn: the withheld sentence is shown and not kept as the document's summary", kept.length === 0, JSON.stringify(kept));
    await withheld.context.close();

    const answered = await open({ width: 1366, height: 768, doc: true, variant: "answer" });
    await answered.page.locator("button.bg-gradient-gold").click();
    await waitFor(answered.page, "Your next session is Tuesday");
    const keptAnswer = await answered.page.evaluate(() => window.__documentSummaries);
    check("CONTROL document turn: a delivered answer is kept as the document's summary",
      keptAnswer.length === 1 && keptAnswer[0].fileName === "intake.pdf", JSON.stringify(keptAnswer).slice(0, 120));
    await answered.context.close();
  }
} finally {
  await browser.close();
  await server.close();
  writeFileSync(path.join(OUT, "drive-results.json"), JSON.stringify({ harness: "paige-chat-mount", results }, null, 2) + "\n");
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
