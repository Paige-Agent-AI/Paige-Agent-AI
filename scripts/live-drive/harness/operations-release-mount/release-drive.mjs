// E09 Slice 4 (4B) — render releasing finished work to a client (operations-release-mount) inside the REAL Operations
// work-item detail sheet, in every state the release flow has: the one-member team (owner decision D2), the reviewer
// picker filled in, the submit confirmation and its verified result, the reviewer's own decision, approved work ready
// to release, the release confirmation, released, accepted, and the client asking for changes — plus the loading,
// still-reading and unavailable states. Both themes, 1440 desktop and 390 phone. It MEASURES each frame: text
// contrast (AA, against the composited background), horizontal overflow, gold (only the one act button may carry it,
// and never more than one at a time), touch targets >= 44px on the phone, clipped text, raw ISO timestamps on screen,
// page errors, any request that tried to leave the machine (the network is blocked), and that the HARNESS RENDER tag
// is on screen. Each state is reached through the REAL UI: the Work list's filter, the work item's button, the real
// choices (the shared Select primitive: open the combobox, click the option) and buttons of the release flow. The stub's call log proves the submit names the chosen version and a
// reviewer who is not the submitter, and that no notification was sent.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Operations sheet against the real
// operations_delivery_* RPCs on a seeded test tenant with a second team member is owed to a capable session.
//
//   node scripts/live-drive/harness/operations-release-mount/release-drive.mjs [--out dir] [--only substr]
//   node .../release-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-operations-release");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5273;
const ITEM_TITLE = "Final brand guidelines";
const SAM = "e0900000-0000-4000-8000-00000000f002";
const ACTOR = "e0900000-0000-4000-8000-00000000f001";
const V2 = "e4000000-0000-4000-8000-0000000f0002";
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
const STATES = ["single", "picker", "picker-open", "confirm", "submitted", "in-review", "approved", "release-confirm", "released", "accepted", "client-changes", "people-loading", "reading", "unavailable"];
const PHONE = ["single", "picker", "picker-open", "in-review", "approved", "accepted", "client-changes", "reading"];
// The one act each state may spend gold on (§11/§23): the primary write of that moment, nothing else.
const ACTS = ["Review submission", "Confirm submission", "Approve internally", "Release for client review", "Confirm client release"];

function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) {
    for (const state of STATES) shots.push({ state, theme, kind: "desktop" });
    for (const state of PHONE) shots.push({ state, theme, kind: "phone" });
  }
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_RELEASE_MUTANT: mutant ?? "" },
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const RELEASE = 'section[aria-label="Release this work to the client"]';

async function drive(page, s, n) {
  // The real Work list: show all work (the finished item is not "active"), then open the item's own sheet.
  await page.getByLabel("Filter work").selectOption("all", { timeout: 60_000 });
  await page.getByRole("button", { name: ITEM_TITLE }).first().click();
  const sheet = page.locator(".ops-detail-sheet");
  await sheet.waitFor({ timeout: 30_000 });
  const release = sheet.locator(RELEASE);
  await release.waitFor({ timeout: 30_000 });
  const log = () => page.evaluate(() => ({ reads: window.__harness.reads, writes: window.__harness.writes, invokes: window.__harness.invokes }));
  const button = (name) => release.getByRole("button", { name, exact: true });
  // Each choice is the shared Select primitive: a combobox found by its accessible name, which is its visible
  // label (WCAG 2.5.3). It is opened and chosen the way a person does it: click the combobox, click the option.
  const field = (name) => release.getByRole("combobox", { name, exact: true });
  const choose = async (name, option) => {
    const trigger = field(name);
    await trigger.waitFor({ timeout: 30_000 });
    await page.waitForFunction((el) => !el.disabled, await trigger.elementHandle(), { timeout: 15_000 });
    await trigger.click();
    await page.getByRole("option", { name: option }).click();
    await page.getByRole("listbox").waitFor({ state: "detached", timeout: 10_000 });
  };
  const pick = async () => {
    await choose("Studio session", "Rivera Design brand launch");
    await choose("Saved work", "Brand guidelines");
    await choose("Version", /^Version 2 · /);
    await choose("Reviewer", "Sam Okafor");
    n.names = await release.locator(".ops-staff-source-grid [role='combobox']").evaluateAll((els) => els.map((e) => e.labels?.[0]?.textContent ?? null));
    n.nativeSelects = await release.locator("select").count();
    await release.locator('article[aria-label="Exact preparation source"]').waitFor({ timeout: 15_000 });
  };
  let focus = release;
  switch (s.state) {
    case "single":
      // Wait for whatever the flow decided to show — the one-reviewer note OR a picker — so a picker offered with
      // nobody in it (D2 broken) is judged by the expectations below rather than timing out.
      await release.locator(".ops-item-release-single, .ops-staff-source-grid").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(500);
      n.reviewerSelects = await field("Reviewer").count();
      n.reviewShown = await release.locator('section[aria-label="Deliverable review"]').count();
      break;
    case "picker":
      await pick();
      // The reviewer listbox, opened again and closed with Escape: only eligible teammates are offered.
      await field("Reviewer").click();
      n.reviewerOptions = await page.getByRole("listbox").getByRole("option").allInnerTexts().then((t) => t.map(clean));
      await page.keyboard.press("Escape");
      await page.getByRole("listbox").waitFor({ state: "detached", timeout: 10_000 });
      n.reviewerAfterEscape = clean(await field("Reviewer").innerText());
      n.submitEnabled = await button("Review submission").isEnabled();
      focus = release.locator('article[aria-label="Exact preparation source"]');
      break;
    case "picker-open":
      // The Select primitive's listbox, open over the sheet, so its menu is measured and seen in both themes.
      await pick();
      await field("Version").evaluate((el) => el.scrollIntoView({ block: "center" }));
      await field("Version").click();
      await page.getByRole("listbox").waitFor({ timeout: 10_000 });
      // The listbox is measured once it has been placed: until then its popper sits off-screen at translate(0,-200%).
      n.placedTransform = await page.waitForFunction(() => {
        const w = document.querySelector("[data-radix-popper-content-wrapper]");
        return w && w.style.transform && !/-200%/.test(w.style.transform) ? w.style.transform : null;
      }, null, { timeout: 10_000 }).then((h) => h.jsonValue());
      n.versionOptions = await page.getByRole("listbox").getByRole("option").allInnerTexts().then((t) => t.map(clean));
      n.checked = clean(await page.getByRole("option", { selected: true }).innerText());
      focus = null;
      break;
    case "confirm": case "submitted": {
      await pick();
      await button("Review submission").click();
      const dialog = page.getByRole("alertdialog");
      await dialog.waitFor({ timeout: 10_000 });
      n.dialog = clean(await dialog.innerText());
      if (s.state === "submitted") {
        const before = await log();
        await dialog.getByRole("button", { name: "Confirm submission" }).click();
        await release.getByText("Submission is recorded and verified.", { exact: false }).waitFor({ timeout: 15_000 });
        const after = await log();
        n.write = after.writes.at(-1) ?? null;
        n.readsAfterWrite = after.reads - before.reads;
        n.invokes = after.invokes;
        await release.locator(".ops-staff-progression").first().waitFor({ timeout: 15_000 });
      }
      break;
    }
    case "in-review":
      await release.getByLabel("Review note").waitFor({ timeout: 30_000 });
      await release.getByLabel("Review note").fill("Looks right. Tighten the colour section before it goes to Jordan.");
      focus = release.locator(".ops-staff-decisions");
      break;
    case "approved": case "release-confirm":
      await button("Release for client review").waitFor({ timeout: 30_000 });
      if (s.state === "release-confirm") {
        await button("Release for client review").click();
        await page.getByRole("alertdialog").waitFor({ timeout: 10_000 });
        n.dialog = clean(await page.getByRole("alertdialog").innerText());
      }
      focus = button("Release for client review");
      break;
    case "released":
      await release.getByRole("heading", { name: "Awaiting client review" }).waitFor({ timeout: 30_000 });
      focus = release.locator('section[aria-label="Recorded client outcome"]');
      break;
    case "accepted":
      await release.getByRole("heading", { name: "Client acceptance recorded" }).waitFor({ timeout: 30_000 });
      n.outcome = clean(await release.locator('section[aria-label="Recorded client outcome"]').innerText());
      focus = release.locator('section[aria-label="Recorded client outcome"]');
      break;
    case "client-changes":
      await release.getByRole("heading", { name: "Client requested changes" }).waitFor({ timeout: 30_000 });
      await field("Studio session").waitFor({ timeout: 30_000 });
      focus = release.locator('section[aria-label="Recorded client outcome"]');
      break;
    case "people-loading":
      await release.locator(".ops-item-release-skeleton").waitFor({ timeout: 30_000 });
      n.busy = await release.getAttribute("aria-busy");
      break;
    case "reading":
      await release.locator(".ops-staff-skeleton").first().waitFor({ timeout: 30_000 });
      n.skeletons = await release.locator(".ops-staff-skeleton").count();
      break;
    case "unavailable":
      await release.getByRole("heading", { name: "Submitted work unavailable" }).waitFor({ timeout: 30_000 });
      break;
  }
  // Headings carry one scale inside the sheet: the release heading leads, its steps sit beneath it.
  n.headingSizes = await release.locator("h2").evaluateAll((hs) => hs.map((h) => parseFloat(getComputedStyle(h).fontSize)));
  n.text = clean(await release.innerText());
  n.goldActs = await release.locator("button.ops-staff-primary").evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()));
  if (focus && !(await page.getByRole("alertdialog").count())) await focus.first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
}

function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // No raw timestamps, internal codes or table names in front of the owner.
  want(!/\d{4}-\d\d-\d\dT\d\d:/.test(n.text ?? ""), `a raw ISO timestamp is on screen: ${(n.text ?? "").match(/\S*\d{4}-\d\d-\d\dT\S*/)?.[0]}`);
  want(!/operations_delivery|PGRST|42501|scoped/.test(n.text ?? ""), "an internal code is on screen");
  want((n.goldActs ?? []).length <= 1, `more than one gold act at once: ${JSON.stringify(n.goldActs)}`);
  want((n.goldActs ?? []).every((t) => ACTS.includes(t)), `gold on something that is not the act: ${JSON.stringify(n.goldActs)}`);
  if (s.state === "single") {
    want(n.reviewerSelects === 0, "a reviewer picker is offered with nobody in it (D2)");
    want(n.reviewShown === 0 && !/choose a teammate to review|nominate/i.test(n.text ?? ""), "advice to nominate a reviewer contradicts the single-reviewer note (D2)");
    want((n.text ?? "").includes("Until then, you can share a finished file with this client from their client record."), "the single-reviewer fallback is not stated");
  }
  if (s.state === "picker") {
    want(eq(n.reviewerOptions, ["Sam Okafor"]), `reviewers ${JSON.stringify(n.reviewerOptions)} (the signed-in owner or an invited person must never be offered)`);
    want(n.reviewerAfterEscape === "Sam Okafor", `Escape changed the chosen reviewer: "${n.reviewerAfterEscape}"`);
    want(n.nativeSelects === 0, `native <select> in the release flow: ${n.nativeSelects} (§11: the Select primitive)`);
    want(n.submitEnabled === true, "Review submission is not enabled after choosing version and reviewer");
    want(eq(n.names, ["Studio session", "Saved work", "Version", "Reviewer"]), `select names do not match their visible labels: ${JSON.stringify(n.names)}`);
  }
  if (s.state === "picker-open") {
    want((n.versionOptions ?? []).length >= 1 && n.versionOptions.every((t) => /^Version \d+ · /.test(t)), `version options ${JSON.stringify(n.versionOptions)}`);
    want(/^Version 2 · /.test(n.checked ?? ""), `the chosen version is not marked selected: "${n.checked}"`);
  }
  if (s.state === "confirm") want(/Submit this version for internal review\?/.test(n.dialog ?? "") && /Sam Okafor/.test(n.dialog ?? ""), `confirm dialog "${n.dialog}"`);
  if (s.state === "submitted") {
    want(n.write?.name === "operations_delivery_submit_scoped" && n.write?.args?.p_artifact_version_id === V2 && n.write?.args?.p_reviewer_user_id === SAM
      && n.write?.args?.p_expected_actor_id === ACTOR && n.write?.args?.p_expected_revision_no === 0, `submit args ${JSON.stringify(n.write)}`);
    want(n.readsAfterWrite >= 1, `submission reported with no re-read after the write (§70.1): ${n.readsAfterWrite}`);
    want(n.invokes === 0, `a function (notification) was invoked: ${n.invokes}`);
  }
  if (s.state === "release-confirm") want(/Release version 1 for client review\?/.test(n.dialog ?? ""), `release dialog "${n.dialog}"`);
  if (s.state === "accepted") want(/Version 1 was accepted by the client on Oct 14, 2026/.test(n.outcome ?? ""), `accepted outcome "${n.outcome}"`);
  if (s.state === "people-loading") want(n.busy === "true", "the loading release section is not aria-busy");
  want((n.headingSizes ?? []).length === 0 || ((n.headingSizes[0] ?? 0) >= Math.max(...n.headingSizes) && Math.max(...n.headingSizes) <= 18), `heading scale out of the sheet's range: ${JSON.stringify(n.headingSizes)}`);
  if (s.state === "reading") want(n.skeletons >= 1, "no skeleton while the release flow reads");
  return miss;
}

function measureInPage(opts) {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (transparent(c)) continue;
      layers.push(c);
      if (alphaOf(c) >= 1) break;
    }
    const pageBg = getComputedStyle(document.body).backgroundColor;
    let acc = layers.length && alphaOf(layers[layers.length - 1]) >= 1 ? layers.pop() : (transparent(pageBg) ? "rgb(255,255,255)" : pageBg);
    while (layers.length) acc = blend(layers.pop(), acc);
    return acc;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const fgOf = (el, bg) => {
    const c = getComputedStyle(el).color, p = parse(c), a = (p.length > 3 ? p[3] : 1) * opacityOf(el);
    return a < 1 ? blend(`rgba(${p[0]},${p[1]},${p[2]},${a})`, bg) : c;
  };
  const visible = (n) => n.getClientRects().length > 0 && !n.closest(".sr-only, [data-harness-tag]") && getComputedStyle(n).visibility !== "hidden" && !n.closest("[hidden], [aria-hidden='true']");
  const inactive = (n) => !!n.closest("button:disabled, [aria-disabled='true'], input:disabled, select:disabled, textarea:disabled, fieldset:disabled");
  const release = document.querySelector('section[aria-label="Release this work to the client"]');
  const overlays = [...document.querySelectorAll('[role="alertdialog"], [role="listbox"]')].filter((o) => o.getClientRects().length);
  const roots = [release, ...overlays].filter(Boolean);
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  const contrast = roots.flatMap((root) => textNodes(root).map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: ratio(fgOf(n, bg), bg), need, inactive: inactive(n), size: cs.fontSize };
  }));
  const graded = contrast.filter((c) => !c.inactive);

  const probe = document.createElement("i"); document.body.append(probe);
  probe.style.setProperty("transition", "none", "important");
  const scope = release ?? document.documentElement;
  const tokens = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep"].map((t) => getComputedStyle(scope).getPropertyValue(t).trim()).filter(Boolean);
  const golds = [...tokens.map((t) => { probe.style.color = t; return getComputedStyle(probe).color; }),
    ...["--accent", "--gold", "--gold-dark"].map((t) => { probe.style.color = `hsl(var(${t}))`; return getComputedStyle(probe).color; })]
    .map((c) => parse(c).slice(0, 3).map(Math.round).join(","));
  probe.remove();
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  // Gold is allowed ONLY on the act button of the moment (and the text inside it); everything else is a finding.
  const acts = new Set(opts.acts);
  const isAct = (n) => { const b = n.closest("button"); return !!b && b.classList.contains("ops-staff-primary") && acts.has(b.textContent.trim()); };
  const gold = roots.flatMap((root) => [...root.querySelectorAll("*")].filter((n) => n.getClientRects().length && !isAct(n)).flatMap((n) => {
    const cs = getComputedStyle(n); const hits = [];
    if (isGold(cs.color) && [...n.childNodes].some((c) => (c.nodeType === 3 && c.textContent.trim()) || c.nodeName === "svg")) hits.push("text");
    if (n.nodeName === "svg" && isGold(cs.color)) hits.push("icon");
    if (isGold(cs.backgroundColor)) hits.push("background");
    if (parseFloat(cs.borderTopWidth) > 0 && isGold(cs.borderTopColor)) hits.push("border");
    return hits.length ? [{ el: n.tagName.toLowerCase(), cls: String(n.className?.baseVal ?? n.className).slice(0, 40), text: n.textContent.trim().slice(0, 30), hits }] : [];
  }));

  const targets = roots.flatMap((root) => [...root.querySelectorAll('a, button, input, select, textarea, [tabindex="0"], [role="option"]')]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only, [hidden]"))
    .filter((n) => !n.matches(".ops-staff-document, textarea"))
    .map((n) => {
      const r = n.getBoundingClientRect();
      return { text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 40), h: Math.round(r.height), w: Math.round(r.width) };
    }));
  const clipped = roots.flatMap((root) => [...root.querySelectorAll("h2,h3,p,span,strong,a,button,label")])
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim())
    .map((n) => n.textContent.trim().slice(0, 40));
  const sheet = document.querySelector(".ops-detail-sheet");
  const spill = release ? [...release.querySelectorAll("*")].filter((c) => visible(c) && c.getBoundingClientRect().right > release.getBoundingClientRect().right + 1).map((c) => `${c.tagName.toLowerCase()} ${c.textContent.trim().slice(0, 30)}`).slice(0, 5) : [];
  const type = release ? [...release.querySelectorAll("h2, h3")].filter(visible).map((h) => `${h.tagName}:${getComputedStyle(h).fontSize}`) : [];
  return {
    contrastMin: graded.length ? Math.min(...graded.map((c) => c.ratio)) : null,
    low: graded.filter((c) => c.ratio < c.need),
    gold, targets, clipped, spill, type,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
      || (sheet ? sheet.scrollWidth > sheet.clientWidth + 1 : false)
      || overlays.some((o) => o.scrollWidth > o.clientWidth + 1 || o.getBoundingClientRect().right > innerWidth + 1),
    sheetW: sheet ? Math.round(sheet.getBoundingClientRect().width) : null,
    sheetTitle: sheet ? getComputedStyle(sheet.querySelector("h2") ?? sheet).fontSize : null,
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.bottom <= innerHeight + 1 && getComputedStyle(t).visibility !== "hidden"; })(),
    phone: opts.phone,
  };
}

async function runShots(browser, shots, label = "") {
  const results = {};
  let failed = false;
  for (const s of shots) {
    const name = `e09-release-${s.state}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: "America/New_York", locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.clock.setFixedTime(new Date("2026-10-14T16:00:00Z"));
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [], blocked = [], notes = {};
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return route.continue();
      blocked.push(route.request().url().slice(0, 140));
      return route.abort("blockedbyclient");
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/solo/42/operations/work?${new URLSearchParams({ state: s.state, theme: s.theme })}`, { timeout: 180_000 });
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    let m;
    try { m = await page.evaluate(measureInPage, { phone: !!s.phone, acts: ACTS }); }
    catch (e) {
      // A renderer that crashes under machine load is reported as this frame's failure, never skipped silently.
      results[name] = { ok: false, state: s.state, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError: `measure failed: ${String(e).slice(0, 200)}` };
      failed = true; console.log(`${name} FAIL`, JSON.stringify({ driveError: results[name].driveError }));
      await ctx.close().catch(() => undefined);
      continue;
    }
    const smallTargets = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    const expectations = driveError ? [] : unmet(s, notes);
    const ok = !driveError && expectations.length === 0 && errors.length === 0 && blocked.length === 0 && m.low.length === 0
      && !m.overflowX && m.gold.length === 0 && m.clipped.length === 0 && m.spill.length === 0 && smallTargets.length === 0 && m.tag;
    if (!ok) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    results[name] = { ok, expectations, state: s.state, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, blocked, notes: { ...notes, text: undefined }, smallTargets, ...m, targets: undefined };
    await ctx.close();
    console.log(`${name} ${ok ? "OK" : "FAIL"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.low.slice(0, 3), gold: m.gold.slice(0, 3), goldActs: notes.goldActs, overflowX: m.overflowX,
      clipped: m.clipped, spill: m.spill, smallTargets: smallTargets.slice(0, 4), type: m.type, sheetW: m.sheetW, errors: errors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 2), blocked: blocked.slice(0, 3), tag: m.tag,
    }));
  }
  return { results, failed };
}

const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
let exitCode = 0;
try {
  if (!selftest) {
    const vite = await startVite(null);
    try {
      const { results, failed } = await runShots(browser, allShots());
      if (!only) fs.writeFileSync(path.join(out, "e09-release-measurements.json"), JSON.stringify(results, null, 2));
      exitCode = failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    const base = (state, kind, theme = "light") => ({ state, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone" });
    const controls = [
      { mutant: "gold", shot: base("accepted", "desktop"), caught: (r) => r.gold.length > 0 },
      { mutant: "contrast", shot: base("in-review", "desktop", "dark"), caught: (r) => r.low.length > 0 },
      { mutant: "target", shot: base("approved", "phone"), caught: (r) => r.smallTargets.length > 0 },
      { mutant: "overflow", shot: base("in-review", "phone"), caught: (r) => r.overflowX === true || r.spill.length > 0 },
      { mutant: "empty-picker", shot: base("single", "desktop"), caught: (r) => r.expectations.some((e) => /D2/.test(e)) },
      { mutant: "select-target", shot: base("picker", "phone"), caught: (r) => r.smallTargets.length > 0 },
    ];
    const verdicts = [];
    for (const c of controls) {
      const vite = await startVite(c.mutant);
      try {
        const { results } = await runShots(browser, [c.shot], `-MUTANT-${c.mutant}`);
        const r = Object.values(results)[0];
        const caught = !!r && !r.ok && c.caught(r);
        verdicts.push({ mutant: c.mutant, caught, ok: r?.ok, driveError: r?.driveError ?? null });
        if (!caught) exitCode = 1;
      } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } await new Promise((res) => setTimeout(res, 800)); }
    }
    fs.writeFileSync(path.join(out, "e09-release-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
