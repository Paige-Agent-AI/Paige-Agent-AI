#!/usr/bin/env node
// Render Campaigns → Catalog → Offers and check what it actually shows (Slice 2A).
//
// WHAT THIS PROVES AND WHAT IT DOES NOT. It renders the REAL `CatalogOffers`, `Catalog` and
// `GrowthHub` with only the network read stubbed, so it proves the rendered states, the copy, the
// four-viewport geometry, both palettes, and the truth rules (no fabricated commerce data, no `$0`
// for an unrecorded amount, the Vibe-owned half preserved). It does NOT prove the authenticated
// production surface: §32.c stays owed to a session that can drive the deployed app, and this
// harness must never be reported as having discharged it.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const PORT = 5211;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(import.meta.dirname, "artifacts/catalog-offers");
const REPO = path.resolve(import.meta.dirname, "../..");

// The four widths every Solo surface is proved at.
const FRAMES = [
  { name: "1536x770", width: 1536, height: 770 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x1000", width: 900, height: 1000 },
];

const results = [];
function check(ok, name, detail = "") {
  results.push({ ok, name, detail });
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
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
  const gone = () => { try { process.kill(-child.pid, 0); return false; } catch { return true; } };
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* group already gone */ }
  try { process.kill(child.pid, "SIGTERM"); } catch { /* child already gone */ }
  // SIGTERM alone was not enough: vite outlived it and kept holding --strictPort 5211, so the run
  // AFTER A SUCCESSFUL ONE died with "Port already in use". A drive that cannot be run twice is not
  // reproducible evidence, whatever it printed the first time. Wait for the group, then insist.
  for (let i = 0; i < 20 && !gone(); i++) await new Promise((r) => setTimeout(r, 100));
  if (!gone()) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* raced with exit */ }
    try { process.kill(child.pid, "SIGKILL"); } catch { /* raced with exit */ }
  }
}

/**
 * Navigate and wait for THE SURFACE, never for network idleness.
 *
 * The harness pulls a Google Fonts stylesheet and this sandbox has no route to that host, so under
 * an idle-network wait the page is not idle until the proxy gives up on a request that can never
 * succeed. The wait was therefore set by an unreachable third party, and page.goto intermittently
 * blew its 30s budget and failed an otherwise clean run. Waiting on the mounted surface asserts
 * the thing we actually care about and cannot be held hostage by a blocked font request.
 */
async function open(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main.paige-solo", { timeout: 30000 });
}

/** Everything the assertions need, read from the live DOM in one pass. */
async function measure(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main.paige-solo");
    const scroll = document.querySelector(".campaigns-scroll");
    const rows = [...document.querySelectorAll(".co-row")];
    const tabs = [...document.querySelectorAll(".campaigns-tabs button")].map((b) => b.textContent.trim());
    const text = main?.textContent ?? "";
    return {
      text,
      crashed: Boolean(document.querySelector("[data-harness-error]")),
      rows: rows.length,
      tabs,
      selectedTab: document.querySelector('.campaigns-tabs button[aria-selected="true"]')?.textContent.trim() ?? null,
      surface: Boolean(document.querySelector(".campaigns-surface")),
      // No surface in the Solo shell may scroll the document sideways.
      horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        || Boolean(scroll && scroll.scrollWidth > scroll.clientWidth + 1),
      // Any element wider than its own container is the min-width:auto defect.
      overflowing: [...document.querySelectorAll(".campaigns-surface *")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible").length,
      bg: main ? getComputedStyle(main).backgroundColor : null,
      // A price cell must never repeat itself: "Contact for pricing" over "Contact for pricing".
      duplicatedPriceLabel: [...document.querySelectorAll(".co-price")].filter((el) => {
        const value = el.querySelector("b")?.textContent?.trim() ?? "";
        const label = el.querySelector("small")?.textContent?.trim() ?? "";
        return label !== "" && label === value;
      }).length,
      conflicts: document.querySelectorAll(".co-conflict").length,
      notice: document.querySelectorAll(".co-notice").length,
      firstUse: document.querySelectorAll(".co-first").length,
      // Which category chip is pressed, and what chips exist. A workspace switch that leaves the
      // previous account's filter pressed — or its category chips on screen — is the leak the
      // Solo scope rule's "prior-workspace state cleanup" names.
      activeFilter: document.querySelector('.co-filter[aria-pressed="true"]')?.textContent?.trim() ?? null,
      filters: [...document.querySelectorAll(".co-filter")].map((el) => el.textContent?.trim() ?? ""),
    };
  });
}

/**
 * `.paige-solo` transitions `background` over 300ms. Measuring before it settles reads a
 * mid-fade grey — which once looked like a broken dark palette. Wait past the transition.
 */
async function settle(page) { await page.waitForTimeout(420); }

async function setMode(page, mode) {
  await page.click(`[data-mode="${mode}"]`);
  await page.waitForTimeout(70);
}

async function main() {
  await assertPortFree();
  fs.mkdirSync(OUT, { recursive: true });

  const vite = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js", "--config",
    "scripts/live-drive/harness/catalog-mount/vite.config.ts", "--port", String(PORT), "--strictPort",
  ], { cwd: REPO, stdio: "ignore", detached: true });

  const { chromium } = await resolvePlaywright();
  let browser;
  try {
    // Readiness is probed with node:http, NOT fetch. `fetch` honours HTTPS_PROXY, so against a
    // local address it can return a 200 RELAY PAGE from the agent proxy while nothing is listening
    // on 127.0.0.1 at all — the probe goes green, and Playwright then fails with
    // ERR_CONNECTION_REFUSED on the first navigation. A readiness check that a proxy can satisfy
    // is not a readiness check. node:http does not read the proxy env, so this asks the actual
    // socket. (Same trap as the browser launch, which is why buildLaunchOptions bypasses loopback.)
    const probeOnce = () => new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      ready = await probeOnce();
      if (!ready) await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error(`Harness server did not start on 127.0.0.1:${PORT}.`);

    browser = await chromium.launch(buildLaunchOptions());

    // The readiness probe above returns as soon as vite serves index.html, but vite optimises
    // dependencies on the first REAL page load and can drop in-flight requests while it does —
    // which showed up as two failed requests to the harness origin, on the first frame only.
    // Warm the transform pipeline once, unmeasured. This removes a cold-start artifact; it does
    // not weaken the assertion, which still names every failed request and still turns red on a
    // genuinely new one.
    const warm = await browser.newContext();
    const warmPage = await warm.newPage();
    await open(warmPage);
    await settle(warmPage);
    await warm.close();

    for (const theme of ["light", "dark"]) {
      for (const frame of FRAMES) {
        const ctx = await browser.newContext({ viewport: { width: frame.width, height: frame.height } });
        const page = await ctx.newPage();
        // Page errors are product defects and must be zero. Failed REQUESTS are separated,
        // because this sandbox has no route to fonts.googleapis.com — an environment fact, not a
        // defect. It is asserted by name rather than filtered away, so a genuinely new failed
        // request still turns this red.
        const pageErrors = [];
        const failedRequests = [];
        page.on("pageerror", (e) => pageErrors.push(String(e.message)));
        page.on("requestfailed", (r) => failedRequests.push(r.url()));
        await open(page);
        if (theme === "dark") { await page.click("[data-theme-toggle]"); await settle(page); }

        const id = `${theme}/${frame.name}`;

        // 1. The populated library.
        const populated = await measure(page);
        check(!populated.crashed, `${id}: renders without crashing`);
        check(populated.surface, `${id}: campaigns surface mounted`);
        check(populated.rows === 6, `${id}: every offer rendered`, `rows=${populated.rows}`);
        check(!populated.horizontal, `${id}: no horizontal scroll`);
        check(populated.overflowing === 0, `${id}: no child overflows its container`, `n=${populated.overflowing}`);
        check(
          // The Marketing department strip (owner ruling 2026-10-03); Offers is the Sales lane's tab.
          populated.tabs.join("|") === "Overview|Campaigns|Lead capture|Social|Analytics|Offers|Sales|Pipeline",
          `${id}: Marketing tab lock intact`, populated.tabs.join("|"),
        );
        check(populated.selectedTab === "Offers", `${id}: Offers is the selected tab`);
        check(/What this business sells/.test(populated.text), `${id}: Offers is the default section`);
        check(
          !/\brevenue\b|\bconversion\b|in stock|units sold|\bratings?\b/i.test(populated.text),
          `${id}: no fabricated commerce data`,
        );
        check(!/\$0\b/.test(populated.text), `${id}: no $0 rendered`);
        check(populated.duplicatedPriceLabel === 0, `${id}: no price cell repeats itself`, `n=${populated.duplicatedPriceLabel}`);
        check(/Contact for pricing/.test(populated.text), `${id}: an unpriced offer says how it is presented`);
        check(/nothing on this surface charges anybody/i.test(populated.text), `${id}: the not-a-checkout boundary is stated`);
        await page.screenshot({ path: path.join(OUT, `offers-${theme}-${frame.name}.png`) });

        // 2. The derived conflict — active, claims a price, no amount recorded.
        await setMode(page, "unpriced");
        const unpriced = await measure(page);
        check(unpriced.conflicts === 1, `${id}: the record's own contradiction is named`, `n=${unpriced.conflicts}`);
        check(/no amount is recorded against it/.test(unpriced.text), `${id}: conflict says which fact is missing`);

        // 2b. An instalment plan must show its arithmetic, never the per-instalment figure alone.
        await setMode(page, "instalment");
        const inst = await measure(page);
        check(/\$500 × 6/.test(inst.text), `${id}: instalment shows its arithmetic`);
        check(!/Fixed amount/.test(inst.text), `${id}: instalment is not labelled a fixed amount`);

        // 2c. A recurring plan is per-period. Rendering it bare turns a $99/month retainer into a
        // one-off "$99" — the same lie as the instalment, for the shape the writer actually emits.
        await setMode(page, "recurring");
        const rec = await measure(page);
        check(/\$99 \/ month/.test(rec.text), `${id}: recurring shows its period`, rec.text);
        check(!/Fixed amount/.test(rec.text), `${id}: recurring is not labelled a fixed amount`);

        // 2d. An unreadable permission is not a denied one.
        await setMode(page, "authority-unknown");
        const unknown = await measure(page);
        check(/could not be read just now/.test(unknown.text), `${id}: unknown authority says so`);
        check(!/cannot change it/.test(unknown.text), `${id}: unknown authority is not reported as denial`);

        // 2d. Unmigrated columns are named, not silently rendered as "the tenant left it blank".
        await setMode(page, "fields-unavailable");
        const pending = await measure(page);
        check(/not available on this deployment yet/.test(pending.text), `${id}: pending columns are named`);

        // 3. First use — the state every tenant sees today, since the table is empty on prod.
        await setMode(page, "empty");
        const empty = await measure(page);
        check(empty.firstUse === 1, `${id}: first use renders`);
        check(/Nothing is listed yet/.test(empty.text), `${id}: first use explains the surface`);
        check(!empty.horizontal, `${id}: first use does not overflow`);

        // 3b. Empty AND mid-deploy. This composition — the pending notice stacked above FirstUse —
        // is what EVERY production tenant sees during the deploy window, and until now it was
        // proven only by a jsdom textContent assertion, at no width and in neither palette.
        await setMode(page, "empty-pending");
        const emptyPending = await measure(page);
        check(emptyPending.firstUse === 1, `${id}: first use still renders mid-deploy`);
        check(emptyPending.notice === 1, `${id}: the pending notice reaches the empty state`,
          `n=${emptyPending.notice}`);
        check(!emptyPending.horizontal, `${id}: notice above first use does not overflow`);

        // 3c. ACCOUNT SWITCH — required by the Solo Shell scope rule, and previously proven only
        // at the adapter (a tenantId change re-triggers the read). That is not the risk. The risk
        // is the SURFACE keeping the previous workspace's rows, or its category filter, after the
        // tenant underneath it changes. So: land on one workspace, pick a category, switch, and
        // look for anything of the first workspace still on screen.
        await setMode(page, "populated");
        const chips = await page.$$(".co-filter");
        if (chips.length > 1) await chips[1].click();
        await settle(page);
        const before = await measure(page);
        check(before.activeFilter !== "Everything1" && before.activeFilter !== null,
          `${id}: a category filter can be selected before the switch`, String(before.activeFilter));

        await setMode(page, "switched-account");
        const after = await measure(page);
        check(/Quarterly Tax Review/.test(after.text), `${id}: the new workspace's offers render`);
        check(!/Foundations Coaching Program/.test(after.text),
          `${id}: no offer from the previous workspace survives the switch`);
        check(!after.filters.some((f) => /Programs|Chair services/.test(f)),
          `${id}: no category from the previous workspace survives the switch`,
          after.filters.join(" | "));
        check(/^Everything/.test(after.activeFilter ?? ""),
          `${id}: the filter resets rather than carrying the old account's selection`,
          String(after.activeFilter));
        check(!after.horizontal, `${id}: the switched workspace does not overflow`);

        // 3d. RESTORED SESSION — required by the Solo Shell scope rule, and it is a real state
        // rather than a synonym for first entry. A returning owner lands on the Catalog by URL
        // while `accountContextLoading` is still true, and the workspace resolves underneath a
        // surface that is already mounted. Three things can go wrong and none were driven before:
        // the surface can read tenant data before the context resolves (§9), the resolving frame
        // can survive the resolution, and the deep-linked destination can be lost when it lands.
        await setMode(page, "resolving");
        const restoring = await measure(page);
        check(restoring.rows === 0, `${id}: restored session shows no offers before the workspace resolves`,
          `rows=${restoring.rows}`);
        check(/Resolving/i.test(restoring.text), `${id}: restored session says it is resolving`);
        check(restoring.firstUse === 0,
          `${id}: an unresolved workspace is not mistaken for an empty one`);

        await setMode(page, "populated");
        const restored = await measure(page);
        check(restored.rows > 0, `${id}: the workspace fills in once it resolves`, `rows=${restored.rows}`);
        check(!/Resolving/i.test(restored.text), `${id}: the resolving frame does not survive resolution`);
        check(restored.selectedTab === "Offers",
          `${id}: the deep-linked destination survives the restore`, String(restored.selectedTab));
        check(!restored.horizontal, `${id}: the restored surface does not overflow`);

        // 3e. LOADING and UNAVAILABLE. Both render branches existed with no test and no drive.
        // `unavailable` matters more than its size suggests: the tier matrix cites exactly this
        // branch as the operator-tier safety — an operator with no workspace must be TOLD so
        // rather than shown an empty catalog — so the branch the matrix leans on was the one
        // branch nothing rendered.
        await setMode(page, "loading");
        const loading = await measure(page);
        check(loading.rows === 0, `${id}: the loading frame shows no offers`, `rows=${loading.rows}`);
        check(loading.firstUse === 0, `${id}: a read in flight is not mistaken for an empty catalog`);

        await setMode(page, "unavailable");
        const unavailable = await measure(page);
        check(/needs a resolved workspace/i.test(unavailable.text),
          `${id}: no resolvable workspace says so, in words`);
        check(unavailable.rows === 0 && unavailable.firstUse === 0,
          `${id}: no workspace renders neither offers nor an empty catalog`,
          `rows=${unavailable.rows} firstUse=${unavailable.firstUse}`);

        // 3f. THE EDITOR (Slice 2B). This block exists because its absence was the gap: the drive
        // passed 419 checks over a surface whose write half it never touched, and the stub did not
        // even provide `saveOffer` — so the first press of Save in a real browser would have
        // thrown, and nothing here would have noticed.
        await setMode(page, "empty");
        await page.click("button.btn-g");                       // "Add your first offer"
        await page.waitForTimeout(90);
        const editor = await page.evaluate(() => {
          const panel = document.querySelector(".co-editor");
          const save = [...document.querySelectorAll(".co-editor-foot button")]
            .find((b) => b.textContent === "Save");
          const rows = [...document.querySelectorAll(".co-field")];
          const overflowing = rows.filter((r) => r.scrollWidth > r.clientWidth + 1).length;
          return {
            open: Boolean(panel),
            modal: panel?.getAttribute("aria-modal") === "true",
            labelled: Boolean(panel?.getAttribute("aria-labelledby")),
            saveDisabled: Boolean(save?.disabled),
            rows: rows.length,
            overflowing,
            wider: panel ? panel.getBoundingClientRect().width > document.documentElement.clientWidth + 1 : false,
            statusWords: ["Publish", "Archive", "Pause", "Status"].filter((w) => panel?.textContent?.includes(w)),
            text: panel?.textContent ?? "",
          };
        });
        check(editor.open, `${id}: the editor opens from first use`);
        check(editor.modal && editor.labelled, `${id}: the editor is a labelled modal dialog`);
        check(editor.rows >= 8, `${id}: every field row rendered`, `rows=${editor.rows}`);
        check(editor.overflowing === 0, `${id}: no field row overflows`, `n=${editor.overflowing}`);
        check(!editor.wider, `${id}: the editor never exceeds the viewport`);
        check(editor.saveDisabled, `${id}: Save is refused until the offer has a name`);
        // The pack's rule, rendered: lifecycle is not in the form that renames the offer.
        check(editor.statusWords.length === 0, `${id}: no status control inside the editor`,
          editor.statusWords.join(", "));
        check(/A name is all this needs to save/.test(editor.text),
          `${id}: the editor says what it actually requires`);

        // Typing a name is the whole precondition, so Save must become reachable on it alone.
        await page.fill(".co-field input", "Drive-created offer");
        await page.waitForTimeout(60);
        const named = await page.evaluate(() => {
          const save = [...document.querySelectorAll(".co-editor-foot button")]
            .find((b) => b.textContent === "Save");
          return { disabled: Boolean(save?.disabled), foot: document.querySelector(".co-editor-foot")?.textContent ?? "" };
        });
        check(!named.disabled, `${id}: a name alone makes Save reachable`);
        check(/Anything left blank stays unstated/.test(named.foot),
          `${id}: the editor states that blanks stay unstated`);

        // Close it before touching the harness controls. The editor is correctly modal, so its
        // scrim intercepts pointer events — leaving it open made the next `setMode` click time out
        // against its own dialog. That is the editor behaving properly and the drive sequencing
        // badly, which is worth distinguishing rather than "fixing" by weakening the scrim.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(70);

        // A refused save must keep the panel open and say nothing was written.
        await setMode(page, "save-refused");
        await page.click("button.btn-g");
        await page.waitForTimeout(80);
        await page.fill(".co-field input", "Refused offer");
        await page.click(".co-editor-foot button.btn-g");
        await page.waitForTimeout(120);
        const refused = await page.evaluate(() => ({
          open: Boolean(document.querySelector(".co-editor")),
          text: document.querySelector(".co-editor")?.textContent ?? "",
        }));
        check(refused.open, `${id}: a refused save keeps the editor open`);
        check(/an offer needs a name/.test(refused.text), `${id}: the refusal is shown as written`);

        await page.keyboard.press("Escape");
        await page.waitForTimeout(80);
        const closed = await page.evaluate(() => !document.querySelector(".co-editor"));
        check(closed, `${id}: Escape closes the editor`);

        // 4. Read-only.
        await setMode(page, "readonly");
        const readonly = await measure(page);
        check(readonly.notice === 1, `${id}: a member is told they cannot change it`);

        // 5. Failure and recovery.
        await setMode(page, "error");
        const errored = await measure(page);
        check(/Offers could not load/.test(errored.text), `${id}: read failure is honest`);
        check(/Your records were not changed/.test(errored.text), `${id}: failure states nothing changed`);

        // 6. Published Vibe work is preserved: it moved to Marketing › Lead capture (owner ruling
        // 2026-10-03), so it is reached through that tab rather than a Catalog section switch.
        await setMode(page, "populated");
        await page.click('.campaigns-tabs [role="tab"]:has-text("Lead capture")');
        await page.waitForTimeout(70);
        const assets = await measure(page);
        check(
          /Created and published in Vibe Studio/.test(assets.text),
          `${id}: published work preserved in Lead capture with its ownership sentence`,
        );
        check(/Foundations — application/.test(assets.text), `${id}: the published artifact still lists`);
        if (theme === "light" && frame.name === "1536x770") {
          await page.screenshot({ path: path.join(OUT, `assets-${theme}-${frame.name}.png`) });
        }

        check(pageErrors.length === 0, `${id}: no runtime errors`, pageErrors.slice(0, 2).join(" | "));
        const unexpected = failedRequests.filter((u) => !u.startsWith("https://fonts.googleapis.com/"));
        check(unexpected.length === 0, `${id}: no unexpected failed request`, unexpected.slice(0, 2).join(" | "));
        await ctx.close();
      }
    }

    // Both palettes must be genuinely different, not a tint of each other.
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 770 } });
    const page = await ctx.newPage();
    await open(page);
    // Wait for the surface itself, not just the network. One run of this block reported a false
    // FAIL because `main.paige-solo` was momentarily absent after the theme click and `measure`
    // read null — a gate that goes red at random teaches the reader to ignore its red.
    await page.waitForSelector("main.paige-solo");
    const light = (await measure(page)).bg;
    await page.click("[data-theme-toggle]"); await settle(page);
    await page.waitForSelector("main.paige-solo");
    const dark = (await measure(page)).bg;
    check(light !== dark, "light and dark are genuinely different", `${light} vs ${dark}`);
    // Not merely different — the exact shipped token values, so a washed-out theme cannot pass.
    check(light === "rgb(246, 245, 241)", "light is the shipped Mineral canvas", light);
    check(dark === "rgb(12, 10, 27)", "dark is the shipped Obsidian canvas", dark);
    await ctx.close();
  } finally {
    if (browser) await browser.close();
    await stopTree(vite);
  }

  const failures = results.filter((r) => !r.ok);
  fs.writeFileSync(
    path.join(OUT, "report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), harness: "render only — §32.c live drive still owed", results }, null, 2),
  );
  console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length) { console.error(`\n${failures.length} FAILED`); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
