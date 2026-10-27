// EXP07 row 10 — the publish affordance on a saved piece, driven on the marketing-mount harness:
// the Content tab's piece drawer carries "Publish to a channel", fed by the SAME presence read as
// the Social tab (only connected channels are pickable; the rest state what they are), the caption
// prefills from the piece's own words, and the door's OWN preview (what will post, where, nothing
// scheduled) must be approved before anything goes out. Every terminal state is the door's exact
// sentence — published (with link), declined, failed, outcome_unknown (it may have posted), and the
// pre-approval refusals (needs re-auth, not connected, not configured, retry gate). The receipt
// history renders what already happened to the piece. Four Solo viewports × PAIGE closed/open.
// Harness — NOT live.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const REPO = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(REPO, "docs/evidence/ui-delivery/assets/exp07-publish");
const PORT = Number(process.env.EXP07_PUBLISH_PORT || 5230);
const BASE = `http://127.0.0.1:${PORT}/`;

function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${PORT} is already in use.`)));
    probe.once("listening", () => probe.close(resolve));
    probe.listen(PORT, "127.0.0.1");
  });
}
const probeOnce = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

const results = [];
const check = (ok, name, detail = "") => { results.push({ ok, name, detail }); if (!ok) console.log(`FAIL  ${name}  ${detail}`); };
const frames = [];

async function openPiece(page, { piece = "mc-4", door = "", paige = "closed", theme = "light" } = {}) {
  const errors = [];
  const onErr = (e) => errors.push(String(e));
  page.on("pageerror", onErr);
  await page.goto(`${BASE}?tab=content&piece=${piece}&theme=${theme}&paige=${paige}${door ? `&door=${door}` : ""}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector('[role="dialog"] .mct-pubdoor, [data-harness-error]', { timeout: 30_000 });
  await page.waitForSelector(".mct-pubdoor-net, .mct-pubdoor-state", { timeout: 15_000 });
  page.off("pageerror", onErr);
  return errors;
}
const panelText = (page) => page.locator('[role="dialog"] .mct-pubdoor').innerText();
const overflow = (page) => page.evaluate(() => {
  const body = document.querySelector(".campaigns-drawer .campaigns-drawer-body");
  return { drawer: body ? body.scrollWidth - body.clientWidth : null, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

async function prepareOn(page, expect = "preview") {
  await page.locator('.mct-pubdoor-net[aria-pressed="false"]').first().click();
  const prepare = page.locator("button", { hasText: "Prepare to publish" });
  await prepare.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(300);
  await prepare.click();
  // Pre-approval refusals never show a preview — the door refuses on the first call — so those
  // scenarios await the RESULT box instead.
  const selector = expect === "preview" ? ".mct-pubdoor-preview" : ".mct-pubdoor-result";
  try {
    await page.waitForSelector(selector, { timeout: 15_000 });
  } catch {
    console.log("PREPARE-TIMEOUT panel:", (await panelText(page)).replace(/\n/g, " | ").slice(0, 400));
    await page.screenshot({ path: path.join(OUT, "debug-prepare-timeout.png") });
    throw new Error("prepare did not produce the expected door answer");
  }
  await page.waitForTimeout(300);
}

async function main() {
  await assertPortFree();
  mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/marketing-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
  let browser;
  try {
    for (let i = 0; i < 40 && !(await probeOnce()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await probeOnce())) throw new Error("harness did not come up");
    browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || undefined });
    const page = await browser.newPage();

    // ── The picker's truth at every Solo geometry: only connected channels are pickable; the
    //    others say what they are and point at Settings. Nothing here posts.
    for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
      for (const paige of ["closed", "open"]) {
        const name = `solo-${w}x${h}-paige-${paige}`;
        await page.setViewportSize({ width: w, height: h });
        const errors = await openPiece(page, { paige });
        const text = await panelText(page);
        const pickable = await page.locator('.mct-pubdoor-net[aria-pressed]').count();
        const off = await page.locator(".mct-pubdoor-net-off").count();
        const ox = await overflow(page);
        await page.screenshot({ path: path.join(OUT, `${name}.png`) });
        frames.push({ frame: name, pickable, off, overflowX: ox.drawer, pageErrors: errors });
        check(errors.length === 0 && !(await page.locator("[data-harness-error]").count()), `${name} renders without error`, errors.join("; "));
        check(text.includes("Instagram") && text.includes("Connected"), `${name} the connected channel is offered`);
        check(pickable === 1, `${name} exactly one channel is pickable (the connected one)`, `pickable=${pickable}`);
        check(text.includes("Needs you to sign in again"), `${name} needs_reauth says its state instead of hiding`);
        check(text.includes("Not connected"), `${name} unconnected channels say so`);
        check(text.includes("Settings → Integrations"), `${name} the way to connect is named`);
        check(text.includes("Nothing posts until you approve the exact post"), `${name} the approval promise is on the surface`);
        check((ox.drawer ?? 1) <= 0 && ox.page <= 0, `${name} no horizontal overflow`, `drawer=${ox.drawer} page=${ox.page}`);
      }
    }

    // ── The full governed flow: prepare → the door's own preview → approve once → published. ──
    await page.setViewportSize({ width: 1536, height: 770 });
    await openPiece(page, {});
    await prepareOn(page);
    const preview = await panelText(page);
    check(preview.includes("Publish “"), `flow the door's summary leads the preview`, preview.slice(0, 120));
    check(preview.includes("Nothing else is included, and nothing is scheduled."), `flow the preview carries the door's own scope sentence`);
    check(preview.includes("Northfield Coaching (main)"), `flow the channel's real identity is named`);
    check(/Approval expires/.test(preview), `flow the preview states when approval expires`);
    await page.screenshot({ path: path.join(OUT, "flow-approval-preview.png") });
    await page.locator("button", { hasText: "Approve and post once" }).click();
    await page.waitForSelector(".mct-pubdoor-result", { timeout: 15_000 });
    await page.waitForTimeout(300);
    const published = await panelText(page);
    await page.screenshot({ path: path.join(OUT, "flow-published.png") });
    check(published.includes("Published") && published.includes("see the post"), `flow approval posts once and offers the receipt link`, published.slice(0, 160));

    // The caption prefilled from the piece's own words, not an invented line.
    await openPiece(page, {});
    await page.locator('.mct-pubdoor-net[aria-pressed="false"]').first().click();
    await page.waitForSelector("#mct-pubdoor-words", { timeout: 15_000 });
    const words = await page.locator("#mct-pubdoor-words").inputValue();
    check(words.includes("ask three questions") || words.includes("Before you hire help"), `caption prefills from the piece's own copy`, words.slice(0, 80));

    // ── Decline: the door's preview refused → nothing was published. ──
    await openPiece(page, {});
    await prepareOn(page);
    await page.locator("button", { hasText: "Not now" }).click();
    await page.waitForSelector(".mct-pubdoor-result", { timeout: 15_000 });
    const declined = await panelText(page);
    await page.screenshot({ path: path.join(OUT, "flow-declined.png") });
    check(declined.includes("Nothing was published."), `decline states nothing was published`, declined.slice(0, 120));

    // ── Truthful terminals, each the door's exact sentence. ──
    for (const [door, needle, label] of [
      ["failed", "The channel refused the post. Nothing was published.", "failed"],
      ["outcome_unknown", "hasn't confirmed it. It may have posted", "outcome unknown"],
      ["refused", "connection changed before the post could go out", "post-claim refusal"],
    ]) {
      await openPiece(page, { door });
      await prepareOn(page);
      await page.locator("button", { hasText: "Approve and post once" }).click();
      await page.waitForSelector(".mct-pubdoor-result", { timeout: 15_000 });
      const text = await panelText(page);
      await page.screenshot({ path: path.join(OUT, door === "outcome_unknown" ? "flow-outcome-uncertain.png" : `flow-${door}.png`) });
      check(text.includes(needle), `${label} states the door's sentence verbatim`, text.slice(0, 160));
    }

    // ── Pre-approval refusals: the channel's state, account setup, the retry gate. ──
    for (const [door, needle, label] of [
      ["needs_reauth", "needs you to sign in again", "needs re-auth"],
      ["no_connection", "isn't connected yet", "no connection"],
      ["not_configured", "isn't configured on this account", "not configured"],
      ["retry_blocked", "never reported an outcome", "retry gate"],
    ]) {
      await openPiece(page, { door });
      await prepareOn(page, "refused");
      await page.waitForSelector(".mct-pubdoor-result", { timeout: 15_000 });
      const text = await panelText(page);
      await page.screenshot({ path: path.join(OUT, door === "outcome_unknown" ? "flow-outcome-uncertain.png" : `flow-${door}.png`) });
      check(text.includes(needle), `${label} refuses before approval with the door's sentence`, text.slice(0, 160));
    }

    // ── Receipts: what already happened to this piece, in the door's own vocabulary. ──
    await openPiece(page, {});
    const withReceipt = await panelText(page);
    check(withReceipt.includes("Recent attempts for this piece"), `receipts the history heading renders`);
    check(withReceipt.includes("Published"), `receipts a published attempt is listed with its link`);
    await openPiece(page, { piece: "mc-2" });
    const uncertainPiece = await panelText(page);
    check(uncertainPiece.includes("Outcome being checked — it may have posted"), `receipts an unresolved attempt says exactly what it is`, uncertainPiece.slice(0, 200));
    await page.screenshot({ path: path.join(OUT, "receipts-uncertain-attempts.png") });

    // The library foot now tells the connected truth (it used to say posting wasn't connected).
    await page.goto(`${BASE}?tab=content&theme=light&paige=closed`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector(".mct-foot", { timeout: 30_000 });
    const foot = await page.locator(".mct-foot").innerText();
    check(foot.includes("you approve the exact post before it goes out") && !foot.includes("aren’t connected yet"), `library foot states the connected truth`, foot);

    writeFileSync(path.join(OUT, "exp07-publish-drive.json"), JSON.stringify({ frames, results }, null, 2));
  } finally {
    try { await browser?.close(); } catch { /* already gone */ }
    try { process.kill(-vite.pid, "SIGKILL"); } catch { /* already gone */ }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
