// E09 Slice 4 — render "Files for {client}" (owner-client-files) inside the real Solo client record in every state
// the plan names (plan §3 "Harness states": empty, three sections populated, switch pending, FILE_CHANGED, upload in
// progress / uncertain / finished, the not-connected note, refused — plus unavailable, error, a confirmed share, an
// unshare, a joined client and Open), both themes, 1440 desktop and 390 phone, and MEASURE it: text contrast (AA,
// against the composited background), horizontal overflow, gold spent in the section (none: sharing is a visibility
// setting, not an approval), touch targets >= 44px on the phone (a switch's hit area is its whole <label>), clipped
// text, page errors, any request that tried to leave the machine (the network is blocked), the section's place in
// the record, and that the HARNESS RENDER tag is on screen. Each state is reached through the REAL UI (clicking the
// switch's label, choosing a file in the real input, pressing Open). It also reads owner-decided behaviour off the
// page and the stub's call log: the share carries the row's own version, success is said only after a list read that
// started after the write (§70.1), a new file is reserved private with no visibility argument (D1), the client's own
// uploads have no switch, rows the owner must not see never appear, no notification is sent (D4), and Open mints a
// 60-second link.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo record against the real
// client_file_* RPCs and Storage on a seeded test tenant is owed to a capable session.
//
//   node scripts/live-drive/harness/owner-client-files/files-drive.mjs [--out dir] [--only substr]
//   node .../files-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-owner-client-files");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5271;
const CLIENT = "e4000000-0000-4000-8000-0000000c0001";
const TENANT = "e4000000-0000-4000-8000-00000000aaaa";
const ACTOR = "e0900000-0000-4000-8000-00000000f001";
const NAME = "Jordan Rivera";
const FIRST = "Jordan";
const DRAFT = "Discovery report draft.pdf"; // private: the row the share/pending/confirm states act on
const SHARED = "Brand guidelines v2.pdf";
const LONG = "Pricing worksheet for the Harbour Lane studio launch and the founder's first-year retainer.pdf";
const NEW_FILE = "Proposal for Jordan.pdf";
const NEVER = ["Sam's welcome pack.pdf", "Another business's contract.pdf", "Half-sent scan.pdf", "Internal: pricing assumptions inside"];
const SIZES = { desktop: [1440, 900], phone: [390, 844] };

function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) {
    for (const state of ["populated", "connected", "empty", "loading", "refused", "unavailable", "error", "pending", "confirm", "confirm-joined", "unshare", "changed", "uploading", "uncertain", "saved", "share-added", "open", "open-blocked", "workspace-changed", "many", "more-loaded"]) shots.push({ state, theme, kind: "desktop" });
    for (const state of ["populated", "empty", "refused", "pending", "confirm", "changed", "uploading", "uncertain", "saved", "share-added", "open-blocked", "workspace-changed", "many", "more-loaded"]) shots.push({ state, theme, kind: "phone" });
  }
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_FILES_MUTANT: mutant ?? "" },
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const textOf = async (loc) => ((await loc.count()) ? clean(await loc.first().innerText()) : "");
const SECTION = "#client-files";

async function drive(page, s, n) {
  const section = page.locator(SECTION);
  await section.waitFor({ timeout: 30_000 });
  const row = (name) => section.locator(".trc-files-row").filter({ has: page.locator("strong", { hasText: name }) });
  const listReady = () => row(DRAFT).waitFor({ timeout: 30_000 });
  const log = () => page.evaluate(() => ({ listReads: window.__harness.listReads, fileWrites: window.__harness.fileWrites, uploads: window.__harness.uploads, signed: window.__harness.signed, invokes: window.__harness.invokes }));
  const rows = () => section.locator(".trc-files-row").evaluateAll((lis) => lis.map((li) => {
    const sw = li.querySelector('[role="switch"]');
    return `${li.closest("section")?.querySelector("h4")?.firstChild?.textContent?.trim()} | ${li.querySelector("strong")?.textContent} | ${li.querySelector(".trc-files-item > span")?.textContent.trim()} | ${[...li.querySelectorAll(".trc-files-control button:not([role='switch'])")].map((b) => b.textContent.trim()).join("+") || "-"}${sw ? ` | switch:${sw.getAttribute("aria-checked")}${sw.disabled ? ":disabled" : ""}` : " | no switch"}`;
  }));
  switch (s.state) {
    case "populated": case "connected": {
      await listReady();
      n.rows = await rows();
      n.headings = (await section.locator("h4").allInnerTexts()).map(clean);
      n.switchLabels = await section.locator('[role="switch"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      break;
    }
    case "empty": await section.getByText(`No files for ${NAME} yet.`).waitFor({ timeout: 30_000 }); break;
    case "loading": await section.locator(".trc-files-skeleton").first().waitFor({ timeout: 30_000 }); n.busy = await section.getAttribute("aria-busy"); break;
    case "refused": await section.getByText(`Only the business owner or an admin can see and share ${NAME}’s files.`).waitFor({ timeout: 30_000 }); break;
    case "unavailable": await section.getByText("Client files aren’t available for this account.").waitFor({ timeout: 30_000 }); break;
    case "error": await section.locator('[role="alert"]').waitFor({ timeout: 30_000 }); n.alert = clean(await section.locator('[role="alert"]').innerText()); break;
    case "workspace-changed":
      await section.getByText("Your workspace changed. Refresh to see this client’s files.").waitFor({ timeout: 30_000 });
      n.changedButtons = await section.locator(".trc-files-state button").allInnerTexts().then((t) => t.map(clean));
      break;
    case "pending": case "confirm": case "confirm-joined": case "unshare": case "changed": {
      await listReady();
      const name = s.state === "unshare" ? SHARED : DRAFT;
      const b = await log();
      await row(name).locator("label.trc-files-toggle").click();
      const settled = s.state === "changed" ? section.locator(".trc-files-row").filter({ has: page.locator(".trc-files-note") }) : row(name);
      if (s.state === "pending") {
        await row(name).getByText("Sharing…").waitFor({ timeout: 10_000 });
        n.pendingSwitch = await row(name).locator('[role="switch"]').evaluate((e) => ({ checked: e.getAttribute("aria-checked"), disabled: e.disabled }));
        n.rowBusy = await row(name).getAttribute("aria-busy");
      } else {
        await settled.locator(".trc-files-note").waitFor({ timeout: 10_000 });
        n.note = clean(await settled.locator(".trc-files-note").innerText());
        n.noteRole = await settled.locator(".trc-files-note").getAttribute("role");
        n.switchAfter = await settled.locator('[role="switch"]').getAttribute("aria-checked");
        n.rowAfter = clean(await settled.locator("strong").innerText());
        n.groupAfter = await settled.evaluate((li) => li.closest("section")?.querySelector("h4")?.firstChild?.textContent?.trim());
      }
      const a = await log();
      n.write = a.fileWrites[a.fileWrites.length - 1] ?? null;
      n.writesMade = a.fileWrites.length - b.fileWrites.length;
      n.readsAfterWrite = a.listReads - b.listReads;
      n.invokes = a.invokes;
      await settled.first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      break;
    }
    case "uploading": case "uncertain": case "saved": case "share-added": {
      await listReady();
      const b = await log();
      await section.locator('input[type="file"]').setInputFiles({ name: NEW_FILE, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 harness proposal") });
      const wait = { uploading: `Uploading ${NEW_FILE}…`, uncertain: `We couldn’t confirm ${NEW_FILE} was saved. Check before trying again.`, saved: `${NEW_FILE} is saved. It’s private to your team until you share it.`, "share-added": `${NEW_FILE} is saved. It’s private to your team until you share it.` }[s.state];
      await section.locator(".trc-files-upload").getByText(wait).waitFor({ timeout: 15_000 });
      n.upload = clean(await section.locator(".trc-files-upload").innerText());
      n.uploadRole = await section.locator(".trc-files-upload").getAttribute("role");
      const a = await log();
      n.begin = a.fileWrites.find((w) => w.begin) ?? null;
      n.uploads = a.uploads;
      n.readsAfterWrite = a.listReads - b.listReads;
      if (s.state === "saved") {
        n.privateRow = await rows().then((r) => r.find((x) => x.includes(NEW_FILE)) ?? null);
        n.offer = await section.locator(".trc-files-upload button").allInnerTexts().then((t) => t.map(clean));
      }
      if (s.state === "share-added") {
        // Nice-to-have 2: the file just added is offered for sharing right where its upload was reported.
        const before = await log();
        await section.locator(".trc-files-upload").getByRole("button", { name: `Share with ${FIRST}` }).click();
        await row(NEW_FILE).locator(".trc-files-note").waitFor({ timeout: 10_000 });
        const after = await log();
        n.note = clean(await row(NEW_FILE).locator(".trc-files-note").innerText());
        n.groupAfter = await row(NEW_FILE).evaluate((li) => li.closest("section")?.querySelector("h4")?.firstChild?.textContent?.trim());
        n.uploadGone = (await section.locator(".trc-files-upload").count()) === 0;
        n.write = after.fileWrites[after.fileWrites.length - 1] ?? null;
        n.readsAfterWrite = after.listReads - before.listReads;
        await row(NEW_FILE).evaluate((el) => el.scrollIntoView({ block: "center" }));
        break;
      }
      await section.locator(".trc-files-upload").evaluate((el) => el.scrollIntoView({ block: "center" }));
      break;
    }
    case "many": case "more-loaded": {
      // "Load more" (compliance S5): the first page is the newest 100; the next starts after the last row shown.
      await listReady();
      const foot = section.locator(".trc-files-more");
      await foot.waitFor({ timeout: 30_000 });
      n.firstPageRows = await section.locator(".trc-files-row").count();
      n.foot = clean(await foot.innerText());
      n.lastShown = await section.locator(".trc-files-row strong").last().innerText();
      if (s.state === "more-loaded") {
        const before = await page.evaluate(() => window.__harness.listArgs.length);
        await foot.getByRole("button", { name: "Load more" }).click();
        await foot.waitFor({ state: "detached", timeout: 15_000 });
        n.moreArgs = await page.evaluate((i) => window.__harness.listArgs.slice(i), before);
        n.rowsAfter = await section.locator(".trc-files-row strong").allInnerTexts();
        await section.locator(".trc-files-row").last().evaluate((el) => el.scrollIntoView({ block: "center" }));
      } else {
        n.moreButton = await foot.getByRole("button", { name: "Load more" }).count();
        await foot.evaluate((el) => el.scrollIntoView({ block: "center" }));
      }
      break;
    }
    case "open-blocked": case "open": {
      await listReady();
      // A popup blocker that refuses even the immediate tab: nothing may claim it opened.
      if (s.state === "open-blocked") await page.evaluate(() => { window.open = () => null; });
      await row(SHARED).getByRole("button", { name: `Open ${SHARED}` }).click();
      await row(SHARED).locator(".trc-files-note").waitFor({ timeout: 10_000 });
      n.note = clean(await row(SHARED).locator(".trc-files-note").innerText());
      n.signed = (await log()).signed;
      n.link = await row(SHARED).locator(".trc-files-note a").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent, rel: a.rel, target: a.target })));
      await page.waitForTimeout(300);
      await row(SHARED).evaluate((el) => el.scrollIntoView({ block: "center" }));
      break;
    }
  }
  n.headActions = await section.locator(".trc-files-head button").evaluateAll((bs) => bs.map((b) => ({ text: b.textContent.trim(), slot: b.parentElement?.classList.contains("trc-files-meta") ? "meta" : "other" })));
  n.icons = await section.locator(".trc-files-row .trc-files-icon").evaluateAll((is) => is.map((i) => i.getAttribute("data-kind")));
  n.order = await page.evaluate(() => [...(document.querySelector(".trc-record-body")?.children ?? [])].slice(0, 3).map((c) => c.id || c.className));
  n.connectNote = await textOf(section.locator(".trc-files-connect"));
  n.text = clean(await section.innerText());
  if (!["pending", "confirm", "confirm-joined", "unshare", "changed", "uploading", "uncertain", "saved", "share-added", "open", "open-blocked", "many", "more-loaded"].includes(s.state)) {
    await section.evaluate((el) => {
      const scroller = el.closest(".trc-record-scroll") ?? document.scrollingElement;
      const head = document.querySelector(".trc-record-head, .trc-record-header");
      const offset = head ? head.getBoundingClientRect().height + 8 : 8;
      scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
    });
  }
  await page.waitForTimeout(300);
}

function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  want(eq(n.order, ["client-standing", "client-shared-work", "client-files"]), `section not third in the record: ${JSON.stringify(n.order)}`);
  if (!["refused", "loading", "unavailable"].includes(s.state)) want((n.text ?? "").includes(`${NAME} sees only files you share. New files stay private.`), "the share boundary is not stated");
  // One header layout in every state (nice-to-have 4): Refresh lives in the header's action slot, never elsewhere.
  if (n.headActions) want(n.headActions.every((a) => a.slot === "meta"), `header actions out of the header slot: ${JSON.stringify(n.headActions)}`);
  for (const hidden of NEVER) want(!(n.text ?? "").includes(hidden), `a row the owner list never returns is on screen: ${hidden}`);
  if (s.state === "populated" || s.state === "connected") {
    want(eq(n.headings, [`Shared with ${FIRST} 2`, `From ${FIRST} 2`, "Private to your team 2"]), `sections ${JSON.stringify(n.headings)}`);
    want(eq(n.rows, [
      `Shared with ${FIRST} | ${SHARED} | PDF · 242 KB · Added Oct 12, 2026 · Shared Oct 13, 2026 | Open | switch:true`,
      `Shared with ${FIRST} | Kickoff agenda.docx | DOCX · 40 KB · Added Sep 12, 2026 · Shared Oct 13, 2026 | Open | switch:true`,
      `From ${FIRST} | Signed intake form.pdf | PDF · 1.2 MB · Sent Oct 9, 2026 | Open | no switch`,
      `From ${FIRST} | Studio-photo-reference.jpg | JPG · 3.2 MB · Sent Oct 8, 2026 | Open | no switch`,
      `Private to your team | ${DRAFT} | PDF · 242 KB · Added Oct 13, 2026 | Open | switch:false`,
      `Private to your team | ${LONG} | PDF · 242 KB · Added Oct 10, 2026 | Open | switch:false`,
    ]), `rows ${JSON.stringify(n.rows)}`);
    want(eq(n.icons, ["shared", "shared", "client", "client", "private", "private"]), `row icons ${JSON.stringify(n.icons)} (shared / from the client / private must differ)`);
    want((n.switchLabels ?? []).length === 4 && (n.switchLabels ?? []).every((l) => /^Share .+ with Jordan Rivera$/.test(l ?? "")), `switch labels ${JSON.stringify(n.switchLabels)}`);
  }
  if (s.state === "populated") want(n.connectNote === `${NAME} hasn’t joined your portal yet; shared files appear when they do.`, `not-connected note "${n.connectNote}"`);
  if (s.state === "connected") want(n.connectNote === "", "not-connected note shown for a client who has joined");
  if (s.state === "empty") want((n.text ?? "").includes("Add a file") && (n.text ?? "").includes("It stays private to your team until you share it."), "empty state missing Add a file");
  if (s.state === "loading") want(n.busy === "true", "loading section not aria-busy");
  if (s.state === "error") want(/couldn’t read Jordan Rivera’s files\. Nothing has been shared or unshared\./.test(n.alert ?? "") && /Try again/.test(n.alert ?? ""), `error alert "${n.alert}"`);
  if (["pending", "confirm", "confirm-joined", "unshare", "changed"].includes(s.state)) {
    want(n.writesMade === 1, `share writes ${n.writesMade}`);
    want(n.write?.p_expected_actor_id === ACTOR && n.write?.p_expected_tenant_id === TENANT
      && typeof n.write?.p_expected_updated_at === "string" && /^2026-\d\d-\d\dT/.test(n.write.p_expected_updated_at), `write args ${JSON.stringify(n.write)}`);
    want(n.invokes === 0, `a function (notification) was invoked on share: ${n.invokes} (D4)`);
  }
  if (s.state === "pending") want(n.pendingSwitch?.disabled === true && n.pendingSwitch?.checked === "true" && n.rowBusy === "true", `pending ${JSON.stringify(n.pendingSwitch)} busy=${n.rowBusy}`);
  if (s.state === "confirm") {
    want(n.note === `Shared. ${FIRST} will see it once they join your portal.` && n.noteRole === "status" && n.switchAfter === "true", `confirm note "${n.note}" switch=${n.switchAfter}`);
    want(n.readsAfterWrite >= 1, `success shown with no re-read after the write (§70.1): reads after = ${n.readsAfterWrite}`);
    want(n.groupAfter === `Shared with ${FIRST}` && n.write?.p_shared === true, `confirmed row not in the shared section: ${n.groupAfter}`);
  }
  if (s.state === "confirm-joined") want(n.note === `Shared. ${NAME} can open it in their portal.` && n.switchAfter === "true" && n.readsAfterWrite >= 1, `joined confirm note "${n.note}"`);
  if (s.state === "unshare") want(n.note === `No longer shared with ${NAME}.` && n.switchAfter === "false" && n.groupAfter === "Private to your team" && n.readsAfterWrite >= 1, `unshare note "${n.note}" group=${n.groupAfter}`);
  if (s.state === "changed") {
    want(n.note === "This file changed. Check it and share again." && n.switchAfter === "false", `changed note "${n.note}" switch=${n.switchAfter}`);
    want(n.rowAfter === "Discovery report draft (revised).pdf" && n.readsAfterWrite >= 1, `row not re-read after FILE_CHANGED: "${n.rowAfter}"`);
  }
  if (["uploading", "uncertain", "saved", "share-added"].includes(s.state)) {
    // D1: the reservation carries no visibility; the server always starts a file private.
    want(n.begin && !Object.keys(n.begin).some((k) => /visib|share/i.test(k)) && n.begin.p_filename === NEW_FILE && n.begin.p_contact_id === CLIENT, `begin args ${JSON.stringify(n.begin)}`);
  }
  if (s.state === "uploading") want(n.uploadRole === "status" && (n.uploads ?? []).length === 0, `uploading ${JSON.stringify({ role: n.uploadRole, uploads: n.uploads })}`);
  if (s.state === "uncertain") want(/Check saved upload/.test(n.upload ?? ""), `uncertain notice "${n.upload}"`);
  if (s.state === "saved") {
    want((n.uploads ?? []).length === 1 && new RegExp(`^${TENANT}/${CLIENT}/internal/`).test(n.uploads[0]), `stored path ${JSON.stringify(n.uploads)}`);
    want(n.readsAfterWrite >= 1, "upload reported saved with no re-read (§70.1)");
    want(/^Private to your team \| Proposal for Jordan\.pdf \| PDF · 1 KB · Added Oct 14, 2026 \| Open \| switch:false$/.test(n.privateRow ?? ""), `saved row "${n.privateRow}"`);
  }
  if (s.state === "saved") want(eq(n.offer, [`Share with ${FIRST}`, "Dismiss"]), `saved notice offers ${JSON.stringify(n.offer)}`);
  if (s.state === "share-added") {
    want(n.note === `Shared. ${FIRST} will see it once they join your portal.` && n.groupAfter === `Shared with ${FIRST}` && n.uploadGone, `share-added note "${n.note}" group=${n.groupAfter} uploadGone=${n.uploadGone}`);
    want(n.write?.p_shared === true && n.readsAfterWrite >= 1, `share-added write ${JSON.stringify(n.write)} reads=${n.readsAfterWrite}`);
  }
  if (s.state === "open") {
    want(eq(n.signed?.map((x) => x.expires), [60]), `signed links ${JSON.stringify(n.signed)}`);
    want(n.note === "Opened in a new tab. The link works for one minute." && (n.popups ?? []).length === 1, `open note "${n.note}" popups=${JSON.stringify(n.popups)}`);
  }
  if (s.state === "open-blocked") {
    want(!/Opened in a new tab/.test(n.note ?? "") && /didn’t open a new tab/.test(n.note ?? ""), `blocked open note "${n.note}"`);
    want((n.link ?? []).length === 1 && /signed-file\?e=60$/.test(n.link[0].href ?? "") && n.link[0].rel === "noopener noreferrer" && n.link[0].target === "_blank", `blocked open link ${JSON.stringify(n.link)}`);
  }
  if (s.state === "many" || s.state === "more-loaded") {
    want(n.firstPageRows === 100 && n.foot === "Showing the newest 100 files. Load more", `first page ${n.firstPageRows} rows, foot "${n.foot}"`);
  }
  if (s.state === "many") want(n.moreButton === 1, `Load more buttons ${n.moreButton}`);
  if (s.state === "more-loaded") {
    const a = n.moreArgs ?? [];
    want(a.length === 1 && a[0].p_limit === 100 && typeof a[0].p_before === "string" && /^[0-9a-f-]{36}$/.test(a[0].p_before_id ?? ""), `load-more read ${JSON.stringify(a)}`);
    const names = n.rowsAfter ?? [];
    want(names.length === 110 && new Set(names).size === 110, `after Load more: ${names.length} rows, ${new Set(names).size} distinct (a same-instant file skipped or repeated)`);
    want(["Session notes 094.pdf", "Session notes 095.pdf", "Session notes 096.pdf"].every((x) => names.includes(x)), "a file saved in the same instant as the page boundary is missing");
  }
  if (s.state === "workspace-changed") {
    want(!(n.text ?? "").includes("Only the business owner or an admin"), "an account change is reported as a permission refusal");
    want(eq(n.changedButtons, ["Refresh"]), `workspace-changed actions ${JSON.stringify(n.changedButtons)}`);
  }
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
  const inactive = (n) => !!n.closest("button:disabled, [aria-disabled='true'], input:disabled, fieldset:disabled");
  const section = document.querySelector("#client-files");
  const overlays = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((o) => o.getClientRects().length);
  const roots = [section, ...overlays].filter(Boolean);
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  const contrast = roots.flatMap((root) => textNodes(root).map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: ratio(fgOf(n, bg), bg), need, inactive: inactive(n), size: cs.fontSize };
  }));
  const graded = contrast.filter((c) => !c.inactive);
  // A switch is a non-text control: its track border/fill must reach 3:1 against what it sits on (WCAG 1.4.11).
  const switches = section ? [...section.querySelectorAll('[role="switch"]')].filter((e) => e.getClientRects().length).map((e) => {
    const cs = getComputedStyle(e), around = bgOf(e.parentElement);
    const edge = !transparent(cs.backgroundColor) ? blend(cs.backgroundColor, around) : cs.borderTopColor;
    return { label: e.getAttribute("aria-label"), state: e.getAttribute("aria-checked"), ratio: ratio(edge, around), disabled: e.disabled };
  }) : [];

  const probe = document.createElement("i"); document.body.append(probe);
  probe.style.setProperty("transition", "none", "important");
  const tokens = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep"].map((t) => getComputedStyle(section ?? document.documentElement).getPropertyValue(t).trim()).filter(Boolean);
  const golds = [...tokens.map((t) => { probe.style.color = t; return getComputedStyle(probe).color; }),
    ...["--accent", "--gold", "--gold-dark"].map((t) => { probe.style.color = `hsl(var(${t}))`; return getComputedStyle(probe).color; })]
    .map((c) => parse(c).slice(0, 3).map(Math.round).join(","));
  probe.remove();
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  const gold = roots.flatMap((root) => [...root.querySelectorAll("*")].filter((n) => n.getClientRects().length).flatMap((n) => {
    const cs = getComputedStyle(n); const hits = [];
    if (isGold(cs.color) && [...n.childNodes].some((c) => (c.nodeType === 3 && c.textContent.trim()) || c.nodeName === "svg")) hits.push("text");
    if (isGold(cs.backgroundColor)) hits.push("background");
    if (parseFloat(cs.borderTopWidth) > 0 && isGold(cs.borderTopColor)) hits.push("border");
    return hits.length ? [{ el: n.tagName.toLowerCase(), cls: String(n.className).slice(0, 40), text: n.textContent.trim().slice(0, 30), hits }] : [];
  }));

  // Same measurement as the customer drive (portal-progress-customer-mount/progress-drive.mjs hitIn).
  const extendedHit = (n) => {
    const r = n.getBoundingClientRect();
    const box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    if (getComputedStyle(n).position === "static") return box;
    const ext = { ...box };
    const cs = getComputedStyle(n), bw = (side) => parseFloat(cs[`border${side}Width`]) || 0;
    const pad = { top: r.top + bw("Top"), bottom: r.bottom - bw("Bottom"), left: r.left + bw("Left"), right: r.right - bw("Right") };
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(n, pseudo);
      if (ps.content === "none" || ps.position !== "absolute" || ps.display === "none") continue;
      const px = (v) => (v.endsWith("px") ? parseFloat(v) : null);
      const [t, b, l, rt] = [px(ps.top), px(ps.bottom), px(ps.left), px(ps.right)];
      if ([t, b, l, rt].some((v) => v === null)) continue;
      ext.top = Math.min(ext.top, pad.top + t); ext.bottom = Math.max(ext.bottom, pad.bottom - b);
      ext.left = Math.min(ext.left, pad.left + l); ext.right = Math.max(ext.right, pad.right - rt);
    }
    if (ext.top === box.top && ext.bottom === box.bottom && ext.left === box.left && ext.right === box.right) return box;
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const lands = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === n || n.contains(h)); };
    const inView = ext.top >= 0 && ext.bottom <= innerHeight && ext.left >= 0 && ext.right <= innerWidth;
    return inView && lands(cx, ext.top + 0.5) && lands(cx, ext.bottom - 0.5) && lands(ext.left + 0.5, cy) && lands(ext.right - 0.5, cy) ? ext : box;
  };
  const targets = roots.flatMap((root) => [...root.querySelectorAll('a, button, input, select, textarea, [role="switch"]')]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only, [hidden]"))
    .map((n) => {
      // A control inside a <label> is hit anywhere on the label: that is its target. Otherwise its own box,
      // plus an absolutely positioned ::before/::after (the sheet's Close reaches 44px this way), counted only
      // when real hit tests at the extension's outer edges land on the control.
      const label = n.closest("label");
      const hit = label ? label.getBoundingClientRect() : extendedHit(n);
      const r = n.getBoundingClientRect();
      return { text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 40), h: Math.round(hit.bottom - hit.top), w: Math.round(hit.right - hit.left), drawn: `${Math.round(r.width)}x${Math.round(r.height)}` };
    }));

  const scroller = section?.closest(".trc-record-scroll");
  const clipped = roots.flatMap((root) => [...root.querySelectorAll("h2,h3,p,span,strong,a,button,label")])
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim())
    .map((n) => n.textContent.trim().slice(0, 40));
  const spill = section ? [...section.querySelectorAll(".trc-files-row")].filter((row) => {
    const rr = row.getBoundingClientRect();
    return [...row.querySelectorAll("*")].some((c) => visible(c) && c.getBoundingClientRect().right > rr.right + 1);
  }).map((r) => r.textContent.trim().slice(0, 40)) : [];
  return {
    contrastMin: graded.length ? Math.min(...graded.map((c) => c.ratio)) : null,
    low: graded.filter((c) => c.ratio < c.need), switches, lowSwitch: switches.filter((sw) => !sw.disabled && sw.ratio < 3),
    gold, targets, clipped, spill,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
      || (scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false) || (section ? section.scrollWidth > section.clientWidth + 1 : false)
      || overlays.some((o) => o.scrollWidth > o.clientWidth + 1 || o.getBoundingClientRect().right > innerWidth + 1),
    sectionW: section ? Math.round(section.getBoundingClientRect().width) : null,
    font: section ? getComputedStyle(section.querySelector("h3") ?? section).fontFamily : null,
    // Which face actually painted: a declared-and-loaded @font-face for the first family, or the fallback.
    fontLoaded: section ? [...document.fonts].some((f) => f.status === "loaded" && getComputedStyle(section.querySelector("h3") ?? section).fontFamily.split(",")[0].replace(/"/g, "").trim() === f.family.replace(/"/g, "")) : null,
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.bottom <= innerHeight + 1 && getComputedStyle(t).visibility !== "hidden"; })(),
    phone: opts.phone,
  };
}

async function runShots(browser, shots, label = "") {
  const results = {};
  let failed = false;
  for (const s of shots) {
    const name = `e09-files-${s.state}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: "America/New_York", locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.clock.setFixedTime(new Date("2026-10-14T16:00:00Z"));
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [], blocked = [], notes = {};
    ctx.on("page", (p) => { notes.popups = [...(notes.popups ?? []), p.url()]; });
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return route.continue();
      blocked.push(route.request().url().slice(0, 140));
      return route.abort("blockedbyclient");
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/solo/42/clients/people?${new URLSearchParams({ person: CLIENT, state: s.state, theme: s.theme })}`, { timeout: 180_000 });
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    const m = await page.evaluate(measureInPage, { phone: !!s.phone });
    const smallTargets = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    const expectations = driveError ? [] : unmet(s, notes);
    const ok = !driveError && expectations.length === 0 && errors.length === 0 && blocked.length === 0 && m.low.length === 0 && m.lowSwitch.length === 0
      && !m.overflowX && m.gold.length === 0 && m.clipped.length === 0 && m.spill.length === 0 && smallTargets.length === 0 && m.tag;
    if (!ok) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    results[name] = { ok, expectations, state: s.state, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, blocked, notes, smallTargets, ...m, targets: undefined };
    await ctx.close();
    console.log(`${name} ${ok ? "OK" : "FAIL"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.low.slice(0, 3), switches: m.switches.map((x) => `${x.state}:${x.ratio}`), lowSwitch: m.lowSwitch,
      gold: m.gold.slice(0, 3), overflowX: m.overflowX, clipped: m.clipped, spill: m.spill, smallTargets, sectionW: m.sectionW, font: m.font, fontLoaded: m.fontLoaded,
      errors: errors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 2), blocked: blocked.slice(0, 3), tag: m.tag,
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
      fs.writeFileSync(path.join(out, "e09-files-measurements.json"), JSON.stringify(results, null, 2));
      exitCode = failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    const base = (state, kind, theme = "light") => ({ state, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone" });
    const controls = [
      { mutant: "gold", shot: base("connected", "desktop"), caught: (r) => r.gold.length > 0 },
      { mutant: "contrast", shot: base("populated", "desktop", "dark"), caught: (r) => r.low.length > 0 },
      { mutant: "overflow", shot: base("populated", "phone"), caught: (r) => r.overflowX === true || r.spill.length > 0 },
      { mutant: "target", shot: base("populated", "phone"), caught: (r) => r.smallTargets.some((t) => /^Share /.test(t.text)) },
      { mutant: "clip", shot: base("populated", "phone"), caught: (r) => r.clipped.length > 0 },
      { mutant: "unconfirmed", shot: base("confirm", "desktop"), caught: (r) => r.expectations.some((e) => /no re-read/.test(e)) },
      { mutant: "public", shot: base("saved", "desktop"), caught: (r) => r.expectations.some((e) => /begin args/.test(e)) },
      { mutant: "tieskip", shot: base("more-loaded", "desktop"), caught: (r) => r.expectations.some((e) => /same instant/.test(e)) },
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
    fs.writeFileSync(path.join(out, "e09-files-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
