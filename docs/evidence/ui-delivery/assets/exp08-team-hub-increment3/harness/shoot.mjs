import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// EXP08 Team Hub increment 3 (attachments) rendered harness. Serves the harness build on
// 127.0.0.1:4791 and drives the REAL TeamHubWorkspace against the in-memory doubles in src/. The
// rail, command row and PAIGE panel are labelled placeholders, not the real tenant shell; the
// supabase double is not the database, Storage or the team-hub-file edge function. Every name,
// file and figure is synthetic.
const OUT = process.env.TEAM_HUB_EVIDENCE_OUT ?? resolve(HERE, "..");
const REPORT = process.env.TEAM_HUB_REPORT ?? resolve(HERE, "report.json");
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const only = process.argv[2];
// The increment-1/2 viewport records, unchanged (tenant-command-center-shell.css + readNavPreference).
const records = [
  { id: "1536x770-closed", vw: 1536, vh: 770, rail: 216, paige: "closed" },
  { id: "1536x770-open", vw: 1536, vh: 770, rail: 216, paige: "inline", pw: 399 },
  { id: "1366x768-closed", vw: 1366, vh: 768, rail: 72, paige: "closed" },
  { id: "1366x768-open", vw: 1366, vh: 768, rail: 72, paige: "inline", pw: 340 },
  { id: "1024x768-closed", vw: 1024, vh: 768, rail: 72, paige: "closed" },
  { id: "1024x768-open", vw: 1024, vh: 768, rail: 72, paige: "overlay" },
  { id: "900x1000-closed", vw: 900, vh: 1000, rail: 72, paige: "closed" },
  { id: "900x1000-open", vw: 900, vh: 1000, rail: 72, paige: "overlay" },
];
const R = Object.fromEntries(records.map((r) => [r.id, r]));
const phone = { vw: 390, vh: 844, rail: 60, row: 58, paige: "closed" };
const zoom = { vw: 640, vh: 400, rail: 60, row: 58, paige: "closed" };

// Synthetic files, and the fate the double gives each (see src/mock-supabase.ts).
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain", csv: "text/csv" };
const f = (name, mimeType, size = 2048, fate) => ({ name, mimeType, size, fate });
const READY_PDF = f("Brightline-intake-notes.pdf", MIME.pdf, 284_000);
const CHECKING_PNG = f("kickoff-whiteboard.png", MIME.png, 1_250_000, "hold-check");
const UPLOADING_JPG = f("cover-option-b.jpg", MIME.jpg, 2_600_000, "hold-upload");
const FAILED_XLSX = f("Q4-forecast.xlsx", MIME.xlsx, 48_000, "fail-upload");
const TYPE_EXE = f("installer.exe", "application/x-msdownload", 90_000);
const BIG_PDF = f("Board-recording-notes.pdf", MIME.pdf, 11 * 1024 * 1024);
const MACRO_DOCX = f("Proposal-with-macros.docx", MIME.docx, 64_000, "reject:macro_content");
const MISMATCH_PDF = f("renamed-report.pdf", MIME.pdf, 30_000, "reject:mismatch");
const viewportChips = [READY_PDF, CHECKING_PNG];
const allStates = [UPLOADING_JPG, CHECKING_PNG, READY_PDF, FAILED_XLSX, TYPE_EXE, BIG_PDF, MACRO_DOCX];
// Six server rejections in one pick: five reach the server and are refused with their reasons; the
// sixth is refused at once as "5 files per message".
const refusedSet = [
  f("Proposal-with-macros.docx", MIME.docx, 64_000, "reject:macro_content"),
  f("renamed-report.pdf", MIME.pdf, 30_000, "reject:mismatch"),
  f("Org-chart-with-chart.docx", MIME.docx, 120_000, "reject:embedded_content"),
  f("Pricing-linked-sheet.xlsx", MIME.xlsx, 52_000, "reject:external_content"),
  f("Truncated-contract.docx", MIME.docx, 8_000, "reject:malformed_document"),
  f("Sixth-file.pdf", MIME.pdf, 12_000, "reject:mismatch"),
];

const shots = [];
// The viewport records scroll the stream to its end after the chips are added, as a person would:
// adding chips does not re-pin the stream (see the two ev-state-unpinned frames, which do not scroll).
for (const r of records) for (const theme of ["dark", "light"]) shots.push({ ...r, theme, act: "chips", chips: viewportChips, scrollEnd: true, name: `ev-${r.id}-files-${theme}` });
shots.push({ ...phone, theme: "dark", act: "phonechips", chips: viewportChips, scrollEnd: true, name: "ev-390-files-dark" });
shots.push({ ...phone, theme: "light", act: "phonechips", chips: viewportChips, scrollEnd: true, name: "ev-390-files-light" });
shots.push({ ...R["1536x770-closed"], theme: "dark", act: "chips", chips: viewportChips, name: "ev-state-unpinned-1536-dark" });
shots.push({ ...phone, theme: "light", act: "phonechips", chips: viewportChips, name: "ev-state-unpinned-390-light" });
shots.push({ ...phone, theme: "dark", act: "phonechips", chips: allStates, name: "ev-390-chipstates-dark" });
shots.push({ ...R["1366x768-closed"], theme: "dark", act: "chips", chips: allStates, name: "ev-state-chipstates-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "light", act: "chips", chips: allStates, name: "ev-state-chipstates-1366-light" });
shots.push({ ...R["1366x768-closed"], theme: "dark", act: "chips", chips: refusedSet, name: "ev-state-refusedreasons-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "light", act: "chips", chips: [MISMATCH_PDF, TYPE_EXE, BIG_PDF], name: "ev-state-refusedreasons-1366-light" });
shots.push({ ...R["1366x768-closed"], theme: "dark", act: "retry", chips: [FAILED_XLSX], name: "ev-state-failedretry-after-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "light", act: "chips", chips: [READY_PDF], clip: ".th-conv .th-composer", name: "ev-state-disclosure-1366-light" });
shots.push({ ...R["1366x768-closed"], theme: "dark", act: "chips", chips: [READY_PDF], clip: ".th-conv .th-composer", name: "ev-state-disclosure-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "dark", act: "filesonly", chips: [READY_PDF, f("Kickoff-agenda.txt", MIME.txt, 1_400)], name: "ev-state-filesonly-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "light", act: "filesonly", chips: [READY_PDF, f("Kickoff-agenda.txt", MIME.txt, 1_400)], name: "ev-state-filesonly-1366-light" });
shots.push({ ...R["1366x768-closed"], theme: "dark", dl: "fail", act: "dlfail", name: "ev-state-downloadfailed-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "light", dl: "fail", act: "dlfail", name: "ev-state-downloadfailed-1366-light" });
shots.push({ ...R["1366x768-closed"], theme: "dark", act: "download", name: "ev-state-download-1366-dark" });
shots.push({ ...R["1366x768-closed"], theme: "dark", act: "thread", chips: [READY_PDF], name: "ev-state-threadchip-1366-dark" });
shots.push({ ...zoom, theme: "light", act: "phonechips", chips: viewportChips, name: "ev-zoom200-1280-chips-light" });
shots.push({ ...zoom, theme: "light", act: "phoneconv", name: "ev-zoom200-1280-filerows-light" });
shots.push({ ...zoom, theme: "dark", act: "phonechips", chips: allStates, name: "ev-zoom200-1280-chipstates-dark" });

const report = [];
const GOLD_TOKENS = ["--pg-gold-core", "--pg-gold", "--pg-gold-deep", "--pg-gold-fill"];
for (const shot of shots) {
  if (only && !shot.name.includes(only)) continue;
  const page = await browser.newPage({ viewport: { width: shot.vw, height: shot.vh } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("requestfailed", (r) => { if (!r.url().startsWith("data:")) errors.push(`requestfailed ${r.url()}`); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  // Every announcement the one live region makes, in order.
  await page.addInitScript(() => {
    const w = window; w.__thAnnounced = [];
    let last = "";
    setInterval(() => { const el = document.querySelector(".th-hub [aria-live]"); const t = el?.textContent ?? ""; if (t && t !== last) { w.__thAnnounced.push(t); } last = t; }, 15);
  });
  const fates = Object.fromEntries((shot.chips ?? []).filter((c) => c.fate).map((c) => [c.name, c.fate]));
  const q = new URLSearchParams({ s: "populated", theme: shot.theme, vw: shot.vw, vh: shot.vh, rail: shot.rail, row: shot.row ?? 66, paige: shot.paige, pw: shot.pw ?? 0, me: "owner", dl: shot.dl ?? "" });
  await page.goto(`http://127.0.0.1:4791/?${q}`);
  await page.evaluate((x) => { window.__thFates = x; }, fates);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const pick = async (scope, chips) => {
    await page.locator(`${scope} input[type=file]`).first().setInputFiles(chips.map((c) => ({ name: c.name, mimeType: c.mimeType, buffer: Buffer.alloc(c.size, 0x20) })));
    await page.waitForTimeout(900);
  };
  if (shot.act === "phonechips" || shot.act === "phoneconv") { await page.locator("#th-conv-c-general").click(); await page.waitForTimeout(500); }
  if (shot.act === "chips" || shot.act === "phonechips" || shot.act === "filesonly" || shot.act === "retry") await pick(".th-conv", shot.chips);
  if (shot.act === "retry") { await page.locator(".th-att-retry").first().click(); await page.waitForTimeout(900); }
  if (shot.act === "filesonly") { await page.locator(".th-conv .th-send").click(); await page.waitForTimeout(900); }
  if (shot.act === "dlfail" || shot.act === "download") { await page.locator("button[aria-label='Download Kickoff-cover-brief.pdf']").click(); await page.waitForTimeout(600); }
  let streamBeforeScroll = null;
  if (shot.scrollEnd) {
    streamBeforeScroll = await page.evaluate(() => { const st = document.querySelector(".th-conv .th-stream"); const at = { top: Math.round(st.scrollTop), max: st.scrollHeight - st.clientHeight }; st.scrollTop = st.scrollHeight; return at; });
    await page.waitForTimeout(300);
  }
  if (shot.act === "thread") {
    await page.locator("button.th-replies").first().click(); await page.waitForTimeout(600);
    await pick(".th-thread", shot.chips);
  }
  const metrics = await page.evaluate((goldTokens) => {
    const hub = document.querySelector(".th-hub");
    const grid = document.querySelector(".th-grid");
    const visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
    const small = [...document.querySelectorAll(".th-hub button, .th-hub textarea, .th-hub input")]
      .filter(visible)
      .map((el) => ({ t: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
      .filter((b) => b.h < 40 || b.w < 40);
    // Resolve the gold tokens to computed colours, then find every hub element painted with one.
    const probe = document.createElement("i"); hub.appendChild(probe);
    const gold = new Set(goldTokens.map((t) => { probe.style.color = `var(${t})`; return getComputedStyle(probe).color; }));
    probe.remove();
    const goldUse = [...hub.querySelectorAll("*")].filter(visible).flatMap((el) => {
      const cs = getComputedStyle(el);
      const hits = ["backgroundColor", "color", "borderTopColor", "outlineColor"].filter((p) => gold.has(cs[p]) && !(p === "outlineColor" && cs.outlineStyle === "none") && !(p === "borderTopColor" && cs.borderTopStyle === "none"));
      return hits.length ? [{ el: `${el.tagName.toLowerCase()}.${String(el.className).split(" ").join(".")}`, text: (el.textContent || "").trim().slice(0, 30), props: hits }] : [];
    });
    const row = document.querySelector(".th-conv .th-composer-row");
    return {
      hubW: hub ? Math.round(hub.getBoundingClientRect().width) : null, cols: grid ? getComputedStyle(grid).gridTemplateColumns : null, view: grid?.getAttribute("data-view"),
      fileRows: [...document.querySelectorAll(".th-file[role=group]")].filter(visible).map((el) => ({ label: el.getAttribute("aria-label"), describedBy: el.getAttribute("aria-describedby"),
        thumb: el.querySelector(".th-file-thumb img") ? el.querySelector(".th-file-thumb img").naturalWidth > 0 : null, error: el.querySelector(".th-file-error")?.textContent ?? null })),
      chips: [...document.querySelectorAll(".th-att")].filter(visible).map((el) => ({ name: el.querySelector(".th-att-name")?.textContent, state: el.getAttribute("data-state"), text: el.querySelector(".th-att-state")?.textContent, retry: Boolean(el.querySelector(".th-att-retry")) })),
      notes: [...document.querySelectorAll(".th-att-note")].filter(visible).map((el) => el.textContent),
      disclosureSr: document.getElementById("th-file-disclosure")?.textContent ?? null,
      composerButtons: row ? [...row.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")) : null,
      paperclip: (() => { const b = document.querySelector(".th-conv button[aria-label^='Attach files']"); return b ? { label: b.getAttribute("aria-label"), title: b.getAttribute("title"), accept: b.parentElement.querySelector("input[type=file]")?.getAttribute("accept") } : null; })(),
      send: (() => { const b = document.querySelector(".th-conv .th-send"); return b ? { disabled: b.disabled, ready: b.hasAttribute("data-ready") } : null; })(),
      hint: document.querySelector(".th-conv .th-hint")?.textContent ?? null,
      actButtons: [...document.querySelectorAll(".th-hub .th-btn--act")].filter(visible).map((el) => el.textContent),
      goldUse, small,
      overflow: document.documentElement.scrollWidth > window.innerWidth, hubOverflow: hub ? hub.scrollWidth > hub.clientWidth : null,
      announced: window.__thAnnounced ?? [], fileLog: window.__thFileLog ?? [], navigated: window.__thNavigated ?? [],
    };
  }, GOLD_TOKENS);
  if (shot.clip) await page.locator(shot.clip).first().screenshot({ path: `${OUT}/${shot.name}.png` });
  else await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  report.push({ name: shot.name, scrolledToEndByHarness: Boolean(shot.scrollEnd), streamBeforeScroll, ...metrics, errors });
  await page.close();
}

// Every refusal reason code the chip can be given, driven one at a time against the double:
// the client's own precheck, team_hub_begin_file refusals, and team-hub-file finish rejections.
const matrix = [];
if (!only || only === "matrix") {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto("http://127.0.0.1:4791/?s=populated&theme=dark&vw=1366&vh=768&rail=72&row=66&paige=closed&pw=0&me=owner");
  await page.waitForTimeout(600);
  const cases = [
    ...["mismatch", "type_mismatch", "unrecognised", "legacy_office", "macro_content", "embedded_content", "external_content", "dde_field", "malformed_document", "oversized_document", "size_mismatch", "object_mismatch", "metadata_mismatch", "too_large", "empty", "not_allowed", "rejected", "some_future_code"]
      .map((code) => ({ via: "finish rejected", code, fate: `reject:${code}` })),
    ...["too_large", "limit_reached", "invalid", "rejected", "not_found"].map((code) => ({ via: "begin refused", code, fate: `begin:${code}` })),
    ...["invalid", "not_found"].map((code) => ({ via: "finish refused", code, fate: `finish:${code}` })),
    { via: "precheck", code: "type (.exe)", file: { name: "tool.exe", mimeType: "application/x-msdownload", size: 10 } },
    { via: "precheck", code: "type (.doc)", file: { name: "legacy.doc", mimeType: "application/msword", size: 10 } },
    { via: "precheck", code: "type (.pptx)", file: { name: "deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 10 } },
    { via: "precheck", code: "too_large", file: { name: "big.pdf", mimeType: MIME.pdf, size: 10_485_761 } },
    { via: "precheck", code: "empty", file: { name: "empty.pdf", mimeType: MIME.pdf, size: 0 } },
  ];
  let n = 0;
  for (const c of cases) {
    n += 1;
    const file = c.file ?? { name: `case-${n}.pdf`, mimeType: MIME.pdf, size: 100 };
    if (c.fate) await page.evaluate(([name, fate]) => { window.__thFates = { [name]: fate }; }, [file.name, c.fate]);
    await page.locator(".th-conv input[type=file]").first().setInputFiles([{ name: file.name, mimeType: file.mimeType, buffer: Buffer.alloc(file.size, 0x20) }]);
    await page.waitForTimeout(250);
    const chip = await page.evaluate(() => { const el = document.querySelector(".th-att"); return el ? { state: el.getAttribute("data-state"), text: el.querySelector(".th-att-state")?.textContent } : null; });
    const hub = await page.evaluate(() => ({ unavailable: !document.querySelector(".th-conv input[type=file]") }));
    matrix.push({ ...c, file: file.name, chip, ...hub });
    if (hub.unavailable) { await page.reload(); await page.waitForTimeout(600); continue; }
    await page.locator(".th-att button[aria-label^='Remove']").first().click();
    await page.waitForTimeout(150);
  }
  await page.close();
}
await browser.close();
writeFileSync(REPORT, JSON.stringify({ frames: report, refusalMatrix: matrix }, null, 1));
console.log(JSON.stringify({ frames: report.length, matrix: matrix.length }));
