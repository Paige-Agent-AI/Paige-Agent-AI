// E09 Slice 3 — render "Shared with {client}" (owner-shared-work) inside the real Solo client record in every
// state the plan names (plan §3 "Harness states": loading, empty, a list with mixed switches, a pending switch,
// ITEM_CHANGED, the not-connected note, refused — plus error, a confirmed share, an unshare, a connected client
// and the "Add work for {client}" creator), both themes, desktop, the owner's 1366x768 and 1536x770 and phone,
// and MEASURE it: text contrast (AA, against the composited background), horizontal overflow, gold spent on the
// section or the creator (none: sharing is a visibility setting, not an approval), touch targets >= 44px on the
// phone (a switch's hit area is its whole <label>), clipped text, page errors, any request that tried to leave
// the machine (the network is blocked), the section's place in the record, and that the HARNESS RENDER tag is on
// screen. Each state is reached through the REAL UI (clicking the switch, the Add work button). It also reads the
// owner-decided behaviour off the page and the stub's call log: the share carries the row's own version, success
// is said only after a re-read that started after the write (§70.1), no notification is sent (D8), the client is
// told only title/status/due (D3), blocked reads as In progress to the client, cancelled work is never newly shared.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo record against the real
// plan_item_set_client_share on a seeded test tenant is owed to a capable session.
//
//   node scripts/live-drive/harness/owner-shared-work/shared-work-drive.mjs [--out dir] [--only substr]
//   node .../shared-work-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-owner-shared-work");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5245;
const CLIENT = "e4000000-0000-4000-8000-0000000c0001";
const NAME = "Jordan Rivera";
const DRAFT = "Draft discovery report"; // private, in progress: the row the share/pending/confirm states act on
const HOMEPAGE = "Homepage wireframe with the founder's notes on the studio's first year in Harbour Lane";
const FIRST = "Jordan"; // how the section names the client in a sentence about them
const SIZES = { desktop: [1440, 900], laptop: [1366, 768], wide: [1536, 770], phone: [390, 844] };

function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) {
    for (const state of ["populated", "connected", "empty", "loading", "refused", "error", "pending", "confirm", "confirm-joined", "unshare", "changed", "addwork", "filter-private"]) shots.push({ state, theme, kind: "desktop" });
    for (const state of ["populated", "empty", "refused", "pending", "confirm", "changed", "addwork", "filter-private"]) shots.push({ state, theme, kind: "phone" });
    shots.push({ state: "populated", theme, kind: "laptop" }, { state: "populated", theme, kind: "wide" });
  }
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_SHARED_MUTANT: mutant ?? "" },
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
/** The text of an element that may be absent, without waiting out the default timeout for it. */
const textOf = async (loc) => ((await loc.count()) ? clean(await loc.first().innerText()) : "");
const SECTION = "#client-shared-work";

async function drive(page, s, n) {
  const section = page.locator(SECTION);
  await section.waitFor({ timeout: 30_000 });
  const row = (title) => section.locator(".trc-shared-row").filter({ has: page.locator("strong", { hasText: title }) });
  const listReady = () => row(DRAFT).waitFor({ timeout: 30_000 });
  const before = () => page.evaluate(() => ({ reads: window.__harness.reads, writes: window.__harness.writes.length }));
  switch (s.state) {
    case "populated": case "connected": {
      await listReady();
      n.rows = await section.locator(".trc-shared-row").evaluateAll((lis) => lis.map((li) => {
        const sw = li.querySelector('[role="switch"]');
        const ctl = li.querySelector(".trc-shared-control")?.textContent.trim();
        return `${li.querySelector("strong")?.textContent} | ${li.querySelector(".trc-shared-item > span")?.textContent.trim()} | ${ctl}${sw ? ` | switch:${sw.getAttribute("aria-checked")}${sw.disabled ? ":disabled" : ""}` : " | no switch"}`;
      }));
      n.blockedLine = clean(await row("Brand workshop prep").locator(".trc-shared-quiet-line").innerText().catch(() => ""));
      // P1-2: every shared, non-cancelled row says what the client's own Progress page shows for it.
      n.sees = await section.locator(".trc-shared-row").evaluateAll((lis) => lis.map((li) => `${li.querySelector("strong")?.textContent} => ${li.querySelector(".trc-shared-quiet-line")?.textContent.trim() ?? "-"}`));
      n.filter = await section.locator(".trc-shared-filter-btn").evaluateAll((bs) => bs.map((b) => `${b.textContent.replace(/\s+/g, " ").trim()}:${b.getAttribute("aria-pressed")}`));
      n.refresh = clean(await section.locator(".trc-shared-refresh").innerText().catch(() => ""));
      n.switchLabels = await section.locator('[role="switch"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      break;
    }
    case "empty": await section.getByText(`No work is linked to ${NAME} yet.`).waitFor({ timeout: 30_000 }); break;
    case "loading": await section.locator(".trc-shared-skeleton").first().waitFor({ timeout: 30_000 }); n.busy = await section.getAttribute("aria-busy"); break;
    case "refused": await section.getByText(`Only the business owner or an admin can choose what ${NAME} sees in their portal.`).waitFor({ timeout: 30_000 }); break;
    case "error": await section.locator('[role="alert"]').waitFor({ timeout: 30_000 }); n.alert = clean(await section.locator('[role="alert"]').innerText()); break;
    case "filter-private": {
      await listReady();
      await section.locator(".trc-shared-filter-btn", { hasText: "Private" }).click();
      await row(HOMEPAGE).waitFor({ timeout: 10_000 });
      await section.locator(".trc-shared-row").filter({ has: page.locator("strong", { hasText: "Strategy review" }) }).waitFor({ state: "detached", timeout: 10_000 });
      n.rowsShown = await section.locator(".trc-shared-row strong").allInnerTexts();
      n.filter = await section.locator(".trc-shared-filter-btn").evaluateAll((bs) => bs.map((b) => `${b.textContent.replace(/\s+/g, " ").trim()}:${b.getAttribute("aria-pressed")}`));
      break;
    }
    case "pending": case "confirm": case "confirm-joined": case "unshare": case "changed": {
      await listReady();
      const title = s.state === "unshare" ? "Strategy review" : s.state === "changed" ? HOMEPAGE : DRAFT;
      const target = row(title);
      const sw = target.locator('[role="switch"]');
      const b = await before();
      // Click the switch's LABEL (its words), as an owner's finger or pointer would: the whole label is the target.
      await target.locator("label.trc-shared-toggle").click();
      if (s.state === "pending") {
        await target.getByText("Sharing…").waitFor({ timeout: 10_000 });
        n.pendingSwitch = await sw.evaluate((e) => ({ checked: e.getAttribute("aria-checked"), disabled: e.disabled }));
        n.rowBusy = await target.getAttribute("aria-busy");
      } else {
        await target.locator(".trc-shared-note").waitFor({ timeout: 10_000 });
        n.note = clean(await target.locator(".trc-shared-note").innerText());
        n.noteRole = await target.locator(".trc-shared-note").getAttribute("role");
        n.switchAfter = await sw.getAttribute("aria-checked");
        n.factsAfter = clean(await target.locator(".trc-shared-item > span").first().innerText());
        n.seesAfter = await textOf(target.locator(".trc-shared-quiet-line"));
      }
      const a = await page.evaluate(() => ({ reads: window.__harness.reads, writes: window.__harness.writes, invokes: window.__harness.invokes }));
      n.write = a.writes[a.writes.length - 1] ?? null;
      n.writesMade = a.writes.length - b.writes;
      n.readsAfterWrite = a.reads - b.reads;
      n.invokes = a.invokes;
      n.meta = clean(await section.locator(".trc-shared-meta [role='status']").innerText().catch(() => ""));
      await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
      break;
    }
    case "addwork": {
      await listReady();
      await section.locator(".trc-shared-add").first().click();
      const sheet = page.getByRole("dialog");
      await sheet.getByText("Give the next step an owner").waitFor({ timeout: 15_000 });
      n.chip = clean(await sheet.locator(".ops-create-client").innerText().catch(() => ""));
      n.description = clean(await sheet.locator("[id$='-description'], p").filter({ hasText: "Create a task with" }).first().innerText().catch(() => ""));
      n.submit = await sheet.locator('button[type="submit"]').evaluate((b) => ({ text: b.textContent.trim(), disabled: b.disabled, opacity: getComputedStyle(b).opacity })).catch(() => null);
      n.nativeSelects = await sheet.locator("select").count();
      n.nativeDate = await sheet.locator('input[type="datetime-local"]').count();
      await page.waitForTimeout(300);
      return;
    }
  }
  n.order = await page.evaluate(() => [...(document.querySelector(".trc-record-body")?.children ?? [])].slice(0, 3).map((c) => c.id || c.querySelector("h3")?.textContent || c.className));
  n.connectNote = await textOf(section.locator(".trc-shared-connect"));
  n.text = clean(await section.innerText());
  if (!["pending", "confirm", "confirm-joined", "unshare", "changed"].includes(s.state)) {
    // Frame the section the way the owner reaches it: scrolled to, under the record's sticky header.
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
  if (s.state !== "addwork") {
    want(eq(n.order?.slice(0, 2), ["client-standing", "client-shared-work"]), `section not second in the record: ${JSON.stringify(n.order)}`);
    // D3: the boundary is named for the owner, in these words.
    if (!["refused", "loading"].includes(s.state)) want((n.text ?? "").includes(`${NAME} sees only what you share here: title, status and due date. Notes, priority and who it’s assigned to stay private.`), "the share boundary is not stated");
  }
  if (s.state === "populated" || s.state === "connected") {
    // Cancelled work has no switch at all: cancelling cleared its share, and it can't be newly shared (D2).
    want(eq(n.rows, [
      `${DRAFT} | Task · In progress · Due Oct 10, 2026 | Private | switch:false`,
      "Brand workshop prep | Task · Blocked · Due Oct 20, 2026 | Shared | switch:true",
      "Strategy review | Milestone · Ready · Due Oct 26, 2026 | Shared | switch:true",
      `${HOMEPAGE} | Task · Ready · No due date | Private | switch:false`,
      "Kickoff workshop | Milestone · Completed · Due Sep 12, 2026 | Shared | switch:true",
      `Old proposal draft | Task · Cancelled · No due date | Cancelled · hidden from ${FIRST} | no switch`,
      `Retired brief | Task · Cancelled · No due date | Cancelled · hidden from ${FIRST} | no switch`,
    ]), `rows ${JSON.stringify(n.rows)}`);
    // The client's words, the customer read's mapping (blocked -> In progress, D3), dates in the business zone.
    want(eq(n.sees, [
      `${DRAFT} => -`,
      `Brand workshop prep => ${FIRST} sees: In progress · Due Tue, Oct 20`,
      `Strategy review => ${FIRST} sees: Not started · Due Mon, Oct 26`,
      `${HOMEPAGE} => -`,
      `Kickoff workshop => ${FIRST} sees: Done · Finished Sun, Sep 13`,
      "Old proposal draft => -",
      "Retired brief => -",
    ]), `client lines ${JSON.stringify(n.sees)}`);
    want(n.blockedLine === `${FIRST} sees: In progress · Due Tue, Oct 20`, `blocked line "${n.blockedLine}"`);
    want((n.switchLabels ?? []).every((l) => /^Share .+ with Jordan Rivera$/.test(l ?? "")), `switch labels ${JSON.stringify(n.switchLabels)}`);
    // P3: "Shared N · Private M" replaces "N of M shared"; cancelled work is in neither half.
    want(eq(n.filter, ["Shared 3:false", "Private 2:false"]) && /Shared 3 · Private 2/.test(n.text ?? ""), `share filter ${JSON.stringify(n.filter)}`);
    want(n.refresh === "Refresh" && !/Check again/.test(n.text ?? ""), `refresh control "${n.refresh}"`);
  }
  if (s.state === "populated") want(n.connectNote === `${NAME} hasn’t joined your portal yet; shared items appear when they do.`, `not-connected note "${n.connectNote}"`);
  if (s.state === "connected") want(n.connectNote === "", "not-connected note shown for a client who has joined");
  if (s.state === "empty") want((n.text ?? "").includes(`Add work for ${NAME}`) && !/switch/i.test(n.text ?? ""), "empty state missing Add work");
  if (s.state === "loading") want(n.busy === "true", "loading section not aria-busy");
  if (s.state === "filter-private") {
    want(eq(n.rowsShown, [DRAFT, HOMEPAGE]), `Private filter rows ${JSON.stringify(n.rowsShown)}`);
    want(eq(n.filter, ["Shared 3:false", "Private 2:true"]), `filter pressed state ${JSON.stringify(n.filter)}`);
  }
  if (s.state === "error") want(/couldn’t check what Jordan Rivera can see\. Nothing has been shared or unshared\./.test(n.alert ?? "") && /Try again/.test(n.alert ?? ""), `error alert "${n.alert}"`);
  if (["pending", "confirm", "confirm-joined", "unshare", "changed"].includes(s.state)) {
    want(n.writesMade === 1, `share writes ${n.writesMade}`);
    // The writer gets the session actor, the workspace this record was read for, and the row's own version.
    want(n.write?.p_expected_actor_id === "e0900000-0000-4000-8000-00000000f001" && n.write?.p_expected_tenant_id === "e4000000-0000-4000-8000-00000000aaaa"
      && typeof n.write?.p_expected_updated_at === "string" && /^2026-10-14T12:/.test(n.write.p_expected_updated_at), `write args ${JSON.stringify(n.write)}`);
    want(n.invokes === 0, `a function (notification) was invoked on share: ${n.invokes} (D8)`);
  }
  if (s.state === "pending") want(n.pendingSwitch?.disabled === true && n.pendingSwitch?.checked === "true" && n.rowBusy === "true", `pending ${JSON.stringify(n.pendingSwitch)} busy=${n.rowBusy}`);
  if (s.state === "confirm") {
    // P2-1: the client hasn't joined, so the note says when they'll see it, not that they can now.
    want(n.note === `Shared. ${FIRST} will see this once they join your portal.` && n.noteRole === "status" && n.switchAfter === "true", `confirm note "${n.note}" switch=${n.switchAfter}`);
    want(n.readsAfterWrite >= 1, `success shown with no re-read after the write (§70.1): reads after = ${n.readsAfterWrite}`);
    want(n.write?.p_shared === true, "confirm did not ask to share");
    want(n.seesAfter === `${FIRST} sees: In progress · Past due · Sat, Oct 10`, `client line after sharing "${n.seesAfter}"`);
  }
  if (s.state === "confirm-joined") {
    want(n.note === `Shared. ${NAME} can see this in their portal.` && n.switchAfter === "true" && n.readsAfterWrite >= 1, `joined confirm note "${n.note}" switch=${n.switchAfter}`);
    want(n.connectNote === "", "not-connected note shown for a client who has joined");
  }
  if (s.state === "unshare") {
    want(n.note === `No longer shared with ${NAME}.` && n.switchAfter === "false" && n.seesAfter === "", `unshare note "${n.note}" switch=${n.switchAfter} sees="${n.seesAfter}"`);
    want(n.readsAfterWrite >= 1, "unshare confirmed with no re-read");
  }
  if (s.state === "changed") {
    want(n.note === "This item changed. Check it and share again." && n.switchAfter === "false", `changed note "${n.note}" switch=${n.switchAfter}`);
    want(/In progress/.test(n.factsAfter ?? "") && n.readsAfterWrite >= 1, `row not re-read after ITEM_CHANGED: "${n.factsAfter}"`);
  }
  if (s.state === "addwork") {
    want(n.chip === `For client ${NAME}`, `creator client chip "${n.chip}"`);
    // P2-9: the sheet says the task stays private before anything is typed, and the submit names the act.
    want(n.description === `Create a task with a clear responsibility and deadline. It stays private until you share it with ${FIRST}.`, `creator description "${n.description}"`);
    want(n.submit?.text === "Create task" && n.submit?.disabled === true && n.submit?.opacity === "1", `creator submit ${JSON.stringify(n.submit)}`);
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
  const section = document.querySelector("#client-shared-work");
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
  const spill = section ? [...section.querySelectorAll(".trc-shared-row")].filter((row) => {
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
    const name = `e09-shared-${s.state}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
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
    await page.goto(`http://127.0.0.1:${PORT}/solo/42/clients/people?${new URLSearchParams({ person: CLIENT, state: s.state, theme: s.theme })}`);
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
      fs.writeFileSync(path.join(out, "e09-shared-measurements.json"), JSON.stringify(results, null, 2));
      exitCode = failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    const base = (state, kind, theme = "light") => ({ state, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone" });
    const controls = [
      { mutant: "gold", shot: base("populated", "desktop"), caught: (r) => r.gold.length > 0 },
      { mutant: "contrast", shot: base("populated", "desktop", "dark"), caught: (r) => r.low.length > 0 },
      { mutant: "overflow", shot: base("populated", "phone"), caught: (r) => r.overflowX === true || r.spill.length > 0 },
      { mutant: "target", shot: base("populated", "phone"), caught: (r) => r.smallTargets.some((t) => /^Share /.test(t.text)) },
      { mutant: "clip", shot: base("populated", "phone"), caught: (r) => r.clipped.length > 0 },
      { mutant: "unconfirmed", shot: base("confirm", "desktop"), caught: (r) => r.expectations.some((e) => /no re-read/.test(e)) },
      { mutant: "seesline", shot: base("populated", "desktop"), caught: (r) => r.expectations.some((e) => /client lines/.test(e)) },
      { mutant: "joinedcopy", shot: base("confirm", "desktop"), caught: (r) => r.expectations.some((e) => /confirm note/.test(e)) },
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
    fs.writeFileSync(path.join(out, "e09-shared-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
