#!/usr/bin/env node
/**
 * R2's Solo viewport matrix: the approval card that held back a message with internal text, laid
 * out inside the REAL Solo shell (settings-mount: TenantCommandCenterShell, SoloPaigeWorkspace,
 * PaigeAIChat with soloTenantSafety, the shipped CSS) at the four Solo sizes, with PAIGE docked
 * open, folded, and full-screen, in both themes.
 *
 * HOW THE CARD GETS THERE, and why. This harness cannot drive a chat turn: typed text never
 * reaches the composer's store subscription, and the saved-thread resume never settles. That is
 * the same on the base commit, so it isn't this change (#1539). So the card is the component's own
 * rendered markup, captured from the real PaigeAIChat driven through the held-back turn by
 * src/solo/__render__/approval-recovery.render.test.tsx (committed in
 * docs/evidence/ui-delivery/solo-approval-recovery/approval-recovery.<theme>.html). It is placed
 * into the live transcript the shell rendered, after its own greeting.
 *
 * WHAT THIS PROVES: geometry. The card in the dock and the full-screen workspace at each size, one
 * scroll owner, nothing escaping the card, the next step in view, the page without horizontal
 * scroll with PAIGE folded, and the next step reachable by keyboard in the shell's own focus order.
 * WHAT IT DOES NOT: React behaviour of the turn (that is the jsdom suite), or anything deployed
 * or authenticated (§13/§32.c).
 *
 * Frames and shell-matrix-results.json land in scripts/live-drive/artifacts/outbound-draft-check/
 * (gitignored); the evidence record commits a subset beside the approval-recovery frames.
 *
 *   node scripts/live-drive/outbound-draft-check-render.mjs
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5209;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve("scripts/live-drive/artifacts/outbound-draft-check");
const VIEWPORTS = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];
const THEMES = ["dark", "light"];
const SCENE = "Held back: internal details";
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const treeClean = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() === "";

// The shipped sentence, read from the server's closed set: the captured card must carry it.
const outcomeSource = fs.readFileSync("supabase/functions/_shared/approval-outcome.ts", "utf8");
const NOTE = outcomeSource.match(/internal_text: \(many\) => many\s*\?\s*"[^"]+"\s*:\s*"([^"]+)"/)?.[1];
if (!NOTE) throw new Error("internal_text sentence not found in approval-outcome.ts");

/** The held-back exchange as the real component rendered it, per theme. */
function capturedExchange(theme) {
  const file = `docs/evidence/ui-delivery/solo-approval-recovery/approval-recovery.${theme}.html`;
  const html = fs.readFileSync(file, "utf8");
  const start = html.indexOf(`data-scene="${SCENE}"`);
  if (start < 0) throw new Error(`${SCENE} not found in ${file}`);
  const section = html.slice(start, html.indexOf("</section>", start));
  const frame = section.slice(section.indexOf('<div class="frame">') + '<div class="frame">'.length, section.lastIndexOf("</div>"));
  if (!frame.includes('data-card-mode="report"') || !frame.includes(NOTE)) {
    throw new Error(`${file} does not hold the held-back card with the shipped sentence; re-run the approval-recovery render`);
  }
  return frame;
}

const results = [];
const record = (name, ok, detail = null) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ""}`);
};

const assertPortFree = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", (error) => reject(new Error(`Harness port ${PORT} is not free: ${error.message}`)));
  server.listen(PORT, "127.0.0.1", () => server.close(resolve));
});
const waitForPort = () => new Promise((resolve, reject) => {
  const started = Date.now();
  const probe = () => {
    const socket = net.createConnection(PORT, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", () => {
      socket.destroy();
      if (Date.now() - started > 45_000) reject(new Error("Harness server did not start"));
      else setTimeout(probe, 150);
    });
  };
  probe();
});
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const finishTransitions = async (page) => {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) =>
      (a.playState === "running" || a.pending) && a.effect?.getTiming().iterations !== Infinity);
    await Promise.allSettled(finite.map((a) => a.finished));
  });
  await settle(page);
};

const paige = (page) => page.locator("#tenant-paige-workspace");
const transcript = (page) => paige(page).locator("[data-paige-transcript-scroll=true]");

async function openDock(page) {
  if (await transcript(page).isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Direct PAIGE", exact: true }).click();
  await transcript(page).waitFor({ state: "visible" });
  await finishTransitions(page);
}

/** Put the captured exchange after the shell's own last message, in the live transcript. */
async function placeCard(page, markup) {
  await page.waitForFunction(() => document.querySelector("#tenant-paige-workspace [data-paige-message-id]"));
  const placed = await page.evaluate((html) => {
    const region = document.getElementById("tenant-paige-workspace");
    const messages = region.querySelectorAll("[data-paige-message-id]");
    const last = messages[messages.length - 1];
    const holder = document.createElement("template");
    holder.innerHTML = html;
    const nodes = [...holder.content.children].filter((el) => el.hasAttribute("data-paige-message-id"));
    last.after(...nodes);
    return nodes.length;
  }, markup);
  await finishTransitions(page);
  return placed;
}

/** Every geometry fact the matrix asks for, taken from the rendered page itself. */
const measure = (page) => page.evaluate((note) => {
  const doc = document.scrollingElement;
  const region = document.getElementById("tenant-paige-workspace");
  const cards = region.querySelectorAll('[data-card-mode="report"]');
  const card = cards[cards.length - 1];
  const owner = card.closest("[data-paige-transcript-scroll=true]");
  const r = (el) => el.getBoundingClientRect();
  const cr = r(card);
  const rr = r(region);
  const or = r(owner);
  const escapes = [...card.querySelectorAll("*")]
    .filter((el) => { const b = r(el); return b.width > 0 && (b.right > cr.right + 1 || b.left < cr.left - 1); })
    .map((el) => `${el.tagName.toLowerCase()} ${String(el.className).slice(0, 48)}`);
  // Every scrolling ancestor between the card and the page: exactly one, the transcript.
  const scrollers = [];
  for (let el = card.parentElement; el && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      scrollers.push(el.getAttribute("data-paige-transcript-scroll") ? "transcript" : `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 32)}`);
    }
  }
  const noteEl = [...card.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.includes(note.slice(0, 40)));
  const ask = [...card.querySelectorAll("button")].find((b) => /Ask Paige again/.test(b.textContent ?? ""));
  const within = (el) => { const b = r(el); return b.top >= or.top - 1 && b.bottom <= or.bottom + 1 && b.left >= rr.left - 1 && b.right <= rr.right + 1; };
  const summary = card.querySelector(".break-words");
  // Reachable through the one scroll owner: the card's heading and sentence with its top in view,
  // then its next step at the end of the transcript, where a finished turn leaves the reader.
  owner.scrollTop += cr.top - or.top - 8;
  const noteVisible = !!noteEl && within(noteEl);
  owner.scrollTop = owner.scrollHeight;
  const askVisible = !!ask && within(ask);
  return {
    pageHorizontalScroll: doc.scrollWidth > doc.clientWidth,
    region: { width: Math.round(rr.width), full: region.dataset.full },
    transcriptWidth: Math.round(or.width),
    card: { width: Math.round(cr.width), insetLeft: Math.round(cr.left - rr.left), insetRight: Math.round(rr.right - cr.right), state: card.dataset.state },
    cardInsideRegion: cr.left >= rr.left - 1 && cr.right <= rr.right + 1,
    escapes,
    scrollers,
    transcriptHorizontalOverflow: owner.scrollWidth > owner.clientWidth + 1,
    cardTallerThanTranscript: cr.height > or.height,
    noteVisible,
    askVisible,
    summaryWraps: !!summary && r(summary).right <= cr.right + 1,
  };
}, NOTE);

const geometryOk = (m) => !m.pageHorizontalScroll && m.cardInsideRegion && m.escapes.length === 0
  && m.scrollers.length === 1 && m.scrollers[0] === "transcript" && !m.transcriptHorizontalOverflow
  && m.noteVisible && m.askVisible && m.summaryWraps && m.card.state === "failed";

/** From PAIGE's composer area, Shift+Tab back through the shell's own focus order to the card's next step. */
async function keyboardReachesAsk(page) {
  await paige(page).locator("textarea").first().evaluate((el) => {
    // The composer itself is disabled in this harness (see the header), so start from the first
    // enabled control after it and walk back.
    const focusables = [...document.querySelectorAll("#tenant-paige-workspace button:not([disabled]), #tenant-paige-workspace [tabindex]:not([tabindex='-1'])")];
    const after = focusables.find((f) => el.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
    (after ?? el).focus();
  });
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press("Shift+Tab");
    const on = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    if (/^Ask Paige again/.test(on)) return { ok: true, presses: i + 1 };
  }
  return { ok: false, where: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)) };
}

/** The frame shows what the owner reads first: the card's state and its sentence. */
async function showCardTop(page) {
  await page.evaluate(() => {
    const cards = document.querySelectorAll('#tenant-paige-workspace [data-card-mode="report"]');
    const card = cards[cards.length - 1];
    const owner = card.closest("[data-paige-transcript-scroll=true]");
    owner.scrollTop += card.getBoundingClientRect().top - owner.getBoundingClientRect().top - 48;
  });
  await settle(page);
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  return `${name}.png`;
}

fs.mkdirSync(OUT, { recursive: true });
let server;
let browser;
try {
  await assertPortFree();
  server = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "--config", "scripts/live-drive/harness/settings-mount/vite.config.ts",
    "--port", String(PORT), "--strictPort",
  ], { stdio: "ignore", windowsHide: true });
  await waitForPort();
  const exe = process.env.PW_EXECUTABLE_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  // Real scrollbars: a headless default hides them, which would hand the card width it never has.
  browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}), ignoreDefaultArgs: ["--hide-scrollbars"] });

  for (const theme of THEMES) {
    const markup = capturedExchange(theme);
    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height} ${theme}`;
      const tag = `${width}x${height}-${theme}`;
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: theme === "dark" ? "no-preference" : "reduce" });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(120_000);
      page.setDefaultTimeout(30_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));

      // PAIGE docked open, over a Solo screen.
      await page.goto(`${BASE}/solo/1971670/command-center?theme=${theme}&screen=home`, { waitUntil: "domcontentloaded" });
      await openDock(page);
      const placed = await placeCard(page, markup);
      const docked = await measure(page);
      const keys = await keyboardReachesAsk(page);
      await showCardTop(page);
      const dockedFrame = await shoot(page, `shell-${tag}-paige-open`);
      record(`${label} PAIGE open (docked): card inside the dock, one scroll owner, nothing escapes, next step in view`,
        placed === 4 && geometryOk(docked), { placed, ...docked, frame: dockedFrame });
      record(`${label} PAIGE open (docked): Shift+Tab reaches Ask Paige again`, keys.ok, keys);

      // PAIGE closed: fold with the shell's own key.
      await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
      await page.keyboard.press("Control+Backslash");
      await page.waitForFunction(() => document.querySelector("[data-tenant-shell]")?.getAttribute("data-paige") === "closed");
      await finishTransitions(page);
      const closed = await page.evaluate(() => {
        const doc = document.scrollingElement;
        const host = document.querySelector("[data-solo-screen-host]");
        const region = document.getElementById("tenant-paige-workspace");
        return {
          pageHorizontalScroll: doc.scrollWidth > doc.clientWidth,
          paigeWidth: region ? Math.round(region.getBoundingClientRect().width) : 0,
          hostWidth: Math.round(host?.getBoundingClientRect().width ?? 0),
          hostHorizontalOverflow: host ? host.scrollWidth > host.clientWidth + 1 : null,
        };
      });
      const closedFrame = await shoot(page, `shell-${tag}-paige-closed`);
      record(`${label} PAIGE closed: no horizontal page scroll, PAIGE takes no width, the screen does`,
        !closed.pageHorizontalScroll && closed.paigeWidth === 0 && closed.hostWidth > 0 && closed.hostHorizontalOverflow === false,
        { ...closed, frame: closedFrame });

      // PAIGE full-screen: SoloApp's own PAIGE route.
      await page.goto(`${BASE}/solo/1971670/paige?theme=${theme}&paige=full`, { waitUntil: "domcontentloaded" });
      await transcript(page).waitFor({ state: "visible" });
      const placedFull = await placeCard(page, markup);
      const full = await measure(page);
      await showCardTop(page);
      const fullFrame = await shoot(page, `shell-${tag}-paige-full`);
      record(`${label} PAIGE full-screen: card inside the workspace, one scroll owner, nothing escapes, next step in view`,
        placedFull === 4 && geometryOk(full) && full.region.full === "true", { ...full, frame: fullFrame });

      record(`${label} no page error`, errors.length === 0, errors.length ? { errors } : null);
      await context.close();
    }
  }
} finally {
  await browser?.close();
  if (server?.pid) server.kill("SIGTERM");
}

const failed = results.filter((r) => !r.ok).length;
fs.writeFileSync(path.join(OUT, "shell-matrix-results.json"), `${JSON.stringify({
  revision, treeClean, generatedAt: new Date().toISOString(), note: NOTE, passed: results.length - failed, failed, results,
  boundary: "Local render of the shipped Solo shell with the card's captured markup placed in its live transcript. Geometry only; not a React-driven turn, not deployed, not authenticated.",
}, null, 2)}\n`);
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
