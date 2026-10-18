// E09 Slice 4 — render the customer's Documents (/app/documents, portal-documents-customer-mount) inside the real
// customer chrome in every state the plan names (plan §3 "Harness states": loading, empty, shared plus own uploads,
// upload incomplete, an "awaiting review" section with one item, the review dialog (accept, and request changes with
// a note), accepted, unavailable, multiple businesses, signed-link failure — plus an image preview, a release read
// that failed, and the home's Documents tile), both themes, 1440 desktop and 390 phone, and MEASURE it: text contrast
// (AA, against the composited background), horizontal overflow, gold anywhere but the review's own accept act, touch
// targets >= 44px on the phone, clipped text, page errors, and any request that tried to leave the machine (the
// network is blocked). Every state is reached through the REAL UI (pressing Open, Review, Accept, Request changes).
// It also reads the behaviour off the page and the stub's log: rows the customer must never see never appear, labels
// say where a file came from in the business's own name, links are minted for 60 seconds (one under the file's own
// name to download), the decision goes through the decide RPC with the version the customer read, and the released
// work section sits above the library.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in customer portal against the real
// client_portal_documents, Storage and the release RPCs on a seeded test tenant is owed to a capable session.
//
//   node scripts/live-drive/harness/portal-documents-customer-mount/documents-drive.mjs [--out dir] [--only substr]
//   node .../documents-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-documents-customer");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5272;
const NOW = new Date("2026-10-16T15:30:00-05:00");
const TZ = "America/Chicago";
const BUSINESS = "Northwind Studio";
const NEVER = ["Pricing worksheet.pdf", "Unfinished owner draft.pdf", "Sam's welcome pack.pdf", "Another business's contract.pdf", "Sam's upload.pdf",
  "Internal: margin notes", "Customer upload", "e0900000-0000-4000-8000-00000000e001"];
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
const LONG = "Studio photo reference with the founder's notes on the Harbour Lane space.jpg";

function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) {
    for (const kind of ["desktop", "phone"]) {
      for (const state of ["populated", "empty", "loading", "pending", "released", "accepted", "release-unavailable", "unavailable", "multiple"]) shots.push({ state, theme, kind });
      shots.push({ state: "review", dataState: "released", theme, kind }, { state: "accept", dataState: "released", theme, kind },
        { state: "changes", dataState: "released", theme, kind }, { state: "preview", dataState: "populated", theme, kind },
        { state: "sign-error", theme, kind }, { state: "home", theme, kind, home: true });
    }
  }
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_DOCUMENTS_MUTANT: mutant ?? "" },
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const section = "section[aria-labelledby='client-documents-title']";
const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const textOf = async (loc) => ((await loc.count()) ? clean(await loc.first().innerText()) : "");
const log = (page) => page.evaluate(() => ({ documentReads: window.__harness.documentReads, signed: window.__harness.signed, decisions: window.__harness.decisions }));

async function drive(page, s, n) {
  if (s.home) {
    const tile = page.locator('[data-harness-home] a[href="/app/documents"]');
    await tile.getByText(/awaiting your review|files|Nothing here yet/).waitFor({ timeout: 60_000 });
    n.tile = clean(await tile.innerText());
    return;
  }
  const root = page.locator(section);
  await root.waitFor({ timeout: 60_000 });
  const library = () => root.locator("h2", { hasText: "Your library" });
  const libraryRows = () => root.locator("ul").last().locator("li").evaluateAll((lis) => lis.map((li) => `${li.querySelector("h3")?.textContent} | ${li.querySelector("p")?.textContent} | ${[...li.querySelectorAll("button")].map((b) => b.textContent.trim()).join("+") || "-"}`));
  const released = root.locator("[data-client-released-work]");
  switch (s.state) {
    case "loading": await root.getByText("Loading your documents…").waitFor({ timeout: 30_000 }); n.busy = await root.getAttribute("aria-busy"); break;
    case "unavailable": case "multiple": await root.locator('[role="alert"]').waitFor({ timeout: 30_000 }); n.alert = clean(await root.locator('[role="alert"]').innerText()); break;
    case "empty": await root.getByText(/Nothing here yet\./).waitFor({ timeout: 30_000 }); break;
    case "populated": case "pending": case "released": case "accepted": case "release-unavailable": case "sign-error": {
      await library().waitFor({ timeout: 30_000 });
      await root.locator("h3", { hasText: "Brand guidelines v2.pdf" }).waitFor({ timeout: 30_000 });
      if (["released", "accepted", "release-unavailable"].includes(s.state)) await released.waitFor({ timeout: 30_000 });
      else await page.waitForTimeout(600);
      n.rows = await libraryRows();
      n.released = await textOf(released);
      n.releasedFirst = await page.evaluate((sel) => {
        const r = document.querySelector(`${sel} [data-client-released-work]`), l = [...document.querySelectorAll(`${sel} h2`)].find((h) => h.textContent === "Your library");
        return !!r && !!l && !!(r.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
      }, section);
      if (s.state === "sign-error") {
        await root.getByRole("button", { name: "Open Brand guidelines v2.pdf" }).click();
        await page.getByRole("dialog").locator('[role="alert"]').waitFor({ timeout: 15_000 });
        n.dialog = clean(await page.getByRole("dialog").innerText());
      }
      if (s.state === "released" || s.state === "accepted") await released.evaluate((el) => el.scrollIntoView({ block: "start" }));
      break;
    }
    case "preview": {
      await root.locator("h3", { hasText: "Moodboard - autumn launch.png" }).waitFor({ timeout: 30_000 });
      await root.getByRole("button", { name: "Open Moodboard - autumn launch.png" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("img").waitFor({ timeout: 15_000 });
      await page.waitForFunction(() => document.querySelector('[role="dialog"] img')?.complete === true, null, { timeout: 15_000 });
      n.dialog = clean(await dialog.innerText());
      n.imgLoaded = await dialog.locator("img").evaluate((img) => img.naturalWidth > 0);
      n.links = await dialog.locator("a").evaluateAll((as) => as.map((a) => `${a.textContent.trim()} -> ${a.getAttribute("href")?.replace(/^http:\/\/127\.0\.0\.1:\d+/, "")} ${a.getAttribute("target") ?? ""} ${a.getAttribute("rel") ?? ""}`.trim()));
      n.signed = (await log(page)).signed;
      break;
    }
    case "review": case "accept": case "changes": {
      await released.waitFor({ timeout: 30_000 });
      await released.getByRole("button", { name: "Review Autumn launch plan, version 2" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("Week one — the new homepage").waitFor({ timeout: 15_000 });
      n.dialogClass = await dialog.getAttribute("class");
      if (s.state === "accept") {
        await dialog.getByRole("button", { name: "Accept this version" }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Confirm acceptance" }).click();
        await dialog.getByText("Your acceptance is recorded for version 2.").waitFor({ timeout: 15_000 });
      }
      if (s.state === "changes") {
        await dialog.getByRole("textbox", { name: "Review note" }).fill("Please move the launch email a week later, after the photoshoot.");
        await dialog.getByRole("button", { name: "Request changes" }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Confirm changes" }).click();
        await dialog.getByText("Your changes are recorded for version 2.").waitFor({ timeout: 15_000 });
      }
      await page.waitForTimeout(400);
      n.dialog = clean(await dialog.innerText());
      n.decisions = (await log(page)).decisions;
      if (s.state !== "review") {
        // Close the dialog and read the list the customer goes back to.
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached", timeout: 10_000 });
        await released.getByText(s.state === "accept" ? "Accepted" : "You asked for changes").waitFor({ timeout: 15_000 });
        n.releasedAfter = await textOf(released);
        await released.evaluate((el) => el.scrollIntoView({ block: "start" }));
      }
      break;
    }
  }
  n.text = clean(await root.innerText().catch(() => ""));
  await page.waitForTimeout(300);
}

function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const hidden of NEVER) want(!(n.text ?? "").includes(hidden) && !(n.dialog ?? "").includes(hidden), `the customer can see something they must not: ${hidden}`);
  const ROWS = [
    `Brand guidelines v2.pdf | 242 KB · Shared by ${BUSINESS} | Open`,
    `Moodboard - autumn launch.png | 1.8 MB · Shared by ${BUSINESS} | Open`,
    "Signed intake form.pdf | 1.2 MB · Your upload | Open",
    `${LONG} | 3.2 MB · Your upload | Open`,
    `Kickoff agenda.docx | 40 KB · Shared by ${BUSINESS} | Open`,
  ];
  if (["populated", "released", "accepted", "release-unavailable", "sign-error"].includes(s.state)) want(eq(n.rows, ROWS), `library rows ${JSON.stringify(n.rows)}`);
  if (s.state === "pending") want(eq(n.rows, ["Insurance certificate.pdf | 242 KB · Upload incomplete | Check upload", ...ROWS]), `pending rows ${JSON.stringify(n.rows)}`);
  if (["populated", "pending", "sign-error"].includes(s.state)) want(n.released === "", `released work shown with nothing released: "${n.released}"`);
  if (s.state === "released") {
    want(n.releasedFirst === true, "Work for your review is not above the library");
    want(/Work for your review/.test(n.released) && /Autumn launch plan Version 2 · Waiting for you Review/.test(n.released), `released section "${n.released}"`);
  }
  if (s.state === "accepted") want(/Autumn launch plan Version 2 · Accepted View/.test(n.released), `accepted section "${n.released}"`);
  if (s.state === "release-unavailable") want(/couldn’t be checked just now/.test(n.released), `release failure not said: "${n.released}"`);
  if (s.state === "empty") want(/Nothing here yet\. Files Northwind Studio shares with you appear here, and so does anything you upload above\./.test(n.text ?? ""), "empty library copy");
  if (s.state === "loading") want(n.busy === "true", "loading not aria-busy");
  if (s.state === "unavailable") want(/could not be verified/.test(n.alert ?? ""), `unavailable "${n.alert}"`);
  if (s.state === "multiple") want(/could not be verified|access/.test(n.alert ?? ""), `multiple "${n.alert}"`);
  if (s.state === "sign-error") want(/could not be opened/.test(n.dialog ?? "") && /Try again/.test(n.dialog ?? ""), `sign error "${n.dialog}"`);
  if (s.state === "preview") {
    want(n.imgLoaded === true, "the image preview did not load");
    want(eq((n.signed ?? []).map((x) => `${x.expires}:${x.download}`), ["60:null", "60:Moodboard - autumn launch.png"]), `signed ${JSON.stringify(n.signed)}`);
    want((n.links ?? []).some((l) => /^Download -> .*download=Moodboard/.test(l)) && (n.links ?? []).some((l) => /^Open file -> .* _blank noopener noreferrer$/.test(l)), `links ${JSON.stringify(n.links)}`);
    want(/This link works for one minute\./.test(n.dialog ?? ""), "the one-minute link is not said");
  }
  if (["review", "accept", "changes"].includes(s.state)) want(!/(^| )paige-solo( |$)/.test(n.dialogClass ?? ""), `the dialog carries a Solo theme class: ${n.dialogClass}`);
  if (s.state === "review") want(eq(n.decisions, []) && /Accept this version/.test(n.dialog ?? ""), "review opened without the decision controls, or decided on its own");
  if (s.state === "accept") {
    want(n.decisions?.length === 1 && n.decisions[0].p_decision === "accepted" && typeof n.decisions[0].p_expected_updated_at === "string", `accept decisions ${JSON.stringify(n.decisions)}`);
    want(/Autumn launch plan Version 2 · Accepted View/.test(n.releasedAfter ?? ""), `list after accepting "${n.releasedAfter}"`);
  }
  if (s.state === "changes") {
    want(n.decisions?.length === 1 && n.decisions[0].p_decision === "client_revision_requested" && n.decisions[0].p_note === "Please move the launch email a week later, after the photoshoot.", `changes decisions ${JSON.stringify(n.decisions)}`);
    want(/You asked for changes/.test(n.releasedAfter ?? ""), `list after requesting changes "${n.releasedAfter}"`);
  }
  if (s.state === "home") want(/Documents/.test(n.tile ?? "") && /1 awaiting your review/.test(n.tile ?? "") && /3 shared by Northwind Studio · 2 from you/.test(n.tile ?? "") && /Open documents/.test(n.tile ?? ""), `home tile "${n.tile}"`);
  return miss;
}

function measureInPage(opts) {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const pageBg = () => getComputedStyle(document.body).backgroundColor;
  // Effective opacity of the element and its ancestors: an opacity-faded parent fades the text it holds.
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (transparent(c)) continue;
      layers.push(c);
      if (alphaOf(c) >= 1) break;
    }
    let acc = layers.length && alphaOf(layers[layers.length - 1]) >= 1 ? layers.pop() : (transparent(pageBg()) ? "rgb(255,255,255)" : pageBg());
    while (layers.length) acc = blend(layers.pop(), acc);
    return acc;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const fgOf = (el, bg) => {
    const c = getComputedStyle(el).color, p = parse(c), o = opacityOf(el);
    const a = (p.length > 3 ? p[3] : 1) * o;
    return a < 1 ? blend(`rgba(${p[0]},${p[1]},${p[2]},${a})`, bg) : c;
  };
  const visible = (n) => n.getClientRects().length > 0 && !n.closest(".sr-only, [data-harness-tag]") && getComputedStyle(n).visibility !== "hidden" && !n.closest("[hidden]");
  const inactive = (n) => !!n.closest("button:disabled, [aria-disabled='true'], input:disabled");

  // On the home frames only the Documents tile is this slice's; it is graded, the rest reported.
  const homeTiles = opts.home ? [...document.querySelectorAll("[data-harness-home] .bg-card")].filter((c) => /Documents/.test(c.textContent)) : [];
  const overlays = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((o) => o.getClientRects().length);
  // With a dialog open, the page behind it is inert and dimmed: the dialog is what is graded.
  const pageRoots = opts.home ? homeTiles : overlays.length ? overlays : [document.querySelector('[data-harness-region="page"]')].filter(Boolean);
  const wholePage = document.querySelector('[data-harness-region="page"]');
  const nav = document.querySelector('[data-harness-region="nav"] > div');
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  const contrastFor = (root) => textNodes(root).map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    // AA: 4.5:1, or 3:1 for large text (24px, or 18.66px bold).
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: ratio(fgOf(n, bg), bg), need, inactive: inactive(n), size: cs.fontSize };
  });
  const pageContrast = pageRoots.flatMap(contrastFor);
  const navContrast = nav ? contrastFor(nav) : [];
  const wholeContrast = opts.home && wholePage ? contrastFor(wholePage) : [];
  const graded = (list) => list.filter((c) => !c.inactive);
  const low = (list) => graded(list).filter((c) => c.ratio < c.need);
  const min = (list) => (graded(list).length ? Math.min(...graded(list).map((c) => c.ratio)) : null);

  const probe = document.createElement("i"); document.body.append(probe);
  probe.style.setProperty("transition", "none", "important");
  const goldTokens = ["--accent", "--gold", "--gold-light", "--gold-dark", "--accent-glow"];
  const golds = goldTokens.map((t) => { probe.style.color = `hsl(var(${t}))`; return parse(getComputedStyle(probe).color).slice(0, 3).join(","); });
  probe.remove();
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  // Gold is spent only on the act: the review's own Accept / Confirm acceptance (the Operations component's
  // primary). Those are reported as `act`, never counted as misuse; gold anywhere else is.
  const goldIn = (root) => [...root.querySelectorAll("*")].filter((n) => n.getClientRects().length && !n.closest("[data-harness-tag], .ops-client-primary")).flatMap((n) => {
    const cs = getComputedStyle(n); const hits = [];
    if (isGold(cs.color) && [...n.childNodes].some((c) => (c.nodeType === 3 && c.textContent.trim()) || c.nodeName === "svg")) hits.push("text");
    if (isGold(cs.backgroundColor)) hits.push("background");
    if (parseFloat(cs.borderTopWidth) > 0 && isGold(cs.borderTopColor)) hits.push("border");
    if (n.nodeName === "svg" || n.closest("svg")) { if (isGold(cs.stroke) || isGold(cs.fill)) hits.push("icon"); }
    return hits.length ? [{ el: n.tagName.toLowerCase(), text: n.textContent.trim().slice(0, 30), hits }] : [];
  });

  const targetSel = 'a, button, input, [role="button"], [role="switch"]';
  // A control's hit area: its own box, plus an absolutely positioned ::before/::after it contains (EmptyTile
  // reaches 44px this way). The extension only counts when a real hit test at its outer edges lands on the
  // control. A control below the fold is brought into view by the page's own scroller for the test (never
  // scrollIntoView, which also scrolls the shell), and the scroller is put back before anything is framed.
  const hitOf = (n) => {
    const scroller = n.closest('[data-harness-region="page"]');
    const r0 = n.getBoundingClientRect();
    if (scroller && (r0.top < 8 || r0.bottom > innerHeight - 8)) {
      const saved = scroller.scrollTop;
      scroller.scrollTop += (r0.top + r0.bottom) / 2 - innerHeight / 2;
      try { return hitIn(n); } finally { scroller.scrollTop = saved; }
    }
    return hitIn(n);
  };
  const hitIn = (n) => {
    const r = n.getBoundingClientRect();
    const box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    if (getComputedStyle(n).position === "static") return { ...box, extended: false };
    const ext = { ...box };
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(n, pseudo);
      if (ps.content === "none" || ps.position !== "absolute" || ps.display === "none") continue;
      const px = (v) => (v.endsWith("px") ? parseFloat(v) : null);
      const [t, b, l, rt] = [px(ps.top), px(ps.bottom), px(ps.left), px(ps.right)];
      if ([t, b, l, rt].some((v) => v === null)) continue;
      // An absolute box's offsets are measured from the control's PADDING edge, inside its border.
      const cs = getComputedStyle(n), bw = (side) => parseFloat(cs[`border${side}Width`]) || 0;
      const pad = { top: r.top + bw("Top"), bottom: r.bottom - bw("Bottom"), left: r.left + bw("Left"), right: r.right - bw("Right") };
      ext.top = Math.min(ext.top, pad.top + t); ext.bottom = Math.max(ext.bottom, pad.bottom - b);
      ext.left = Math.min(ext.left, pad.left + l); ext.right = Math.max(ext.right, pad.right - rt);
    }
    if (ext.top === box.top && ext.bottom === box.bottom && ext.left === box.left && ext.right === box.right) return { ...box, extended: false };
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const lands = (x, y) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === n || n.contains(hit)); };
    const inView = ext.top >= 0 && ext.bottom <= innerHeight && ext.left >= 0 && ext.right <= innerWidth;
    const verified = inView && lands(cx, ext.top + 0.5) && lands(cx, ext.bottom - 0.5) && lands(ext.left + 0.5, cy) && lands(ext.right - 0.5, cy);
    const probe = (x, y) => { const h = document.elementFromPoint(x, y); return h ? `${h.tagName.toLowerCase()}.${String(h.className).slice(0, 24)}` : null; };
    return verified ? { ...ext, extended: true } : { ...box, extended: false, unverifiedExtension: { inView, ext: [ext.top, ext.bottom, ext.left, ext.right].map(Math.round), vh: innerHeight, top: probe(cx, ext.top + 0.5), bottom: probe(cx, ext.bottom - 0.5) } };
  };
  const targetsIn = (root, region) => [...root.querySelectorAll(targetSel)]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only, [hidden]"))
    .map((n) => {
      const drawn = n.getBoundingClientRect();
      const hit = hitOf(n);
      const r = { height: hit.bottom - hit.top, width: hit.right - hit.left };
      // WCAG 2.5.8's inline exception: a link that sits inside a sentence. Reported, never silently passed.
      const inline = n.tagName === "A" && getComputedStyle(n).display === "inline" && /\S/.test((n.parentElement?.textContent ?? "").replace(n.textContent, ""));
      return { text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 40), h: Math.round(r.height), w: Math.round(r.width), drawn: `${Math.round(drawn.width)}x${Math.round(drawn.height)}`, extended: hit.extended, unverifiedExtension: hit.unverifiedExtension ?? false, region, inline };
    });
  const targets = [...pageRoots.flatMap((r) => targetsIn(r, "page")), ...(nav ? targetsIn(nav, "nav") : [])];

  const sectionEl = opts.home ? null : document.querySelector("section[aria-labelledby='client-documents-title']");
  const clipRoots = opts.home ? homeTiles : [sectionEl, ...overlays].filter(Boolean);
  const clipped = clipRoots.flatMap((root) => [...root.querySelectorAll("h1,h2,h3,p,span,a,button,div")])
    .filter((n) => visible(n) && n.scrollWidth > n.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(n).overflowX) && n.textContent.trim())
    .map((n) => n.textContent.trim().slice(0, 40));
  // Text that spills past its card's right edge (a row that will not wrap).
  const spill = clipRoots.flatMap((root) => [...root.querySelectorAll("li, .bg-card")]).filter((card) => {
    const cr = card.getBoundingClientRect();
    return [...card.querySelectorAll("*")].some((c) => visible(c) && c.getBoundingClientRect().right > cr.right + 1);
  }).map((c) => c.textContent.trim().slice(0, 40));

  const h1 = overlays[0]?.querySelector("h1") ?? sectionEl?.querySelector("h1");
  return {
    heading: h1?.textContent ?? null,
    font: h1 ? getComputedStyle(h1).fontFamily : getComputedStyle(document.body).fontFamily,
    contrastMin: min(pageContrast), lowPage: low(pageContrast),
    navContrastMin: min(navContrast), lowNav: low(navContrast),
    wholePageContrastMin: opts.home ? min(wholeContrast) : undefined, lowWholePage: opts.home ? low(wholeContrast) : undefined,
    goldPage: pageRoots.flatMap(goldIn), goldNav: nav ? goldIn(nav) : [], goldWholePage: opts.home && wholePage ? goldIn(wholePage) : undefined,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
      || (wholePage ? wholePage.scrollWidth > wholePage.clientWidth + 1 : false)
      || overlays.some((o) => o.scrollWidth > o.clientWidth + 1 || o.getBoundingClientRect().right > innerWidth + 1),
    actGold: overlays.flatMap((o) => [...o.querySelectorAll(".ops-client-primary")]).filter((b) => b.getClientRects().length).map((b) => b.textContent.trim()),
    widths: { doc: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, scroller: wholePage ? [wholePage.scrollWidth, wholePage.clientWidth] : null },
    clipped, spill, targets,
    homeTiles: opts.home ? homeTiles.length : undefined,
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && r.top >= 0 && getComputedStyle(t).visibility !== "hidden"; })(),
  };
}

async function runShots(browser, shots, label = "") {
  const results = {};
  let failed = false;
  for (const s of shots) {
    const name = `e09-documents-${s.state}${s.variant ? `-${s.variant}` : ""}-${s.theme}-${s.kind}-${s.w}x${s.h}${label}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: TZ, locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.clock.setFixedTime(NOW);
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [], blocked = [], notes = {};
    // The network is blocked: only the local harness server answers. Anything else is recorded and refused.
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return route.continue();
      blocked.push(route.request().url().slice(0, 140));
      return route.abort("blockedbyclient");
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}${s.home ? "/app" : "/app/documents"}?${new URLSearchParams({ state: s.dataState ?? s.state, theme: s.theme })}`, { timeout: 180_000 });
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    const m = await page.evaluate(measureInPage, { phone: !!s.phone, home: !!s.home });
    const small = s.phone ? m.targets.filter((t) => t.h < 44 || t.w < 44) : [];
    const smallTargets = small.filter((t) => !t.inline);
    const inlineTargets = small.filter((t) => t.inline);
    const expectations = driveError ? [] : unmet(s, notes);
    const surfaceOk = !driveError && expectations.length === 0 && errors.length === 0 && blocked.length === 0 && m.lowPage.length === 0 && !m.overflowX
      && m.goldPage.length === 0 && m.clipped.length === 0 && m.spill.length === 0
      && smallTargets.filter((t) => t.region !== "nav").length === 0 && m.tag && (!s.home || m.homeTiles >= 1);
    const chromeOk = m.lowNav.length === 0 && m.goldNav.length === 0 && smallTargets.filter((t) => t.region === "nav").length === 0;
    if (!surfaceOk) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    if (s.home) {
      // The two tiles this slice owns, each framed on its own wherever the grid put it (one is below a phone's fold).
      for (const [key, re] of [["documents", /Documents/]]) {
        const tile = page.locator("[data-harness-home] .bg-card").filter({ hasText: re }).first();
        if (await tile.count()) await tile.screenshot({ path: path.join(out, `${name}-tile-${key}.png`) }).catch(() => undefined);
      }
    }
    results[name] = { ok: surfaceOk, chromeOk, expectations, state: s.state, variant: s.variant ?? null, theme: s.theme, viewport: `${s.w}x${s.h}`, driveError, errors, consoleErrors, blocked, notes, smallTargets, inlineTargets, ...m, targets: undefined };
    await ctx.close();
    console.log(`${name} ${surfaceOk ? "OK" : "FAIL"}${chromeOk ? "" : " (chrome findings)"}`, JSON.stringify({
      driveError, expectations, contrastMin: m.contrastMin, low: m.lowPage.slice(0, 3), navMin: m.navContrastMin, lowNav: m.lowNav.slice(0, 3),
      wholePageMin: m.wholePageContrastMin, lowWholePage: m.lowWholePage?.slice(0, 3), goldPage: m.goldPage.slice(0, 3), goldNav: m.goldNav.map((g) => `${g.text}:${g.hits}`),
      goldWholePage: m.goldWholePage?.length, actGold: m.actGold, overflowX: m.overflowX, clipped: m.clipped, spill: m.spill, smallTargets, inlineTargets, errors: errors.slice(0, 3),
      consoleErrors: consoleErrors.slice(0, 2), blocked: blocked.slice(0, 3), tag: m.tag,
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
      fs.writeFileSync(path.join(out, "e09-documents-measurements.json"), JSON.stringify(results, null, 2));
      exitCode = failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    const base = (state, kind, theme = "light", extra = {}) => ({ state, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone", ...extra });
    const controls = [
      { mutant: "gold", shot: base("released", "desktop"), caught: (r) => r.goldPage.length > 0 },
      { mutant: "contrast", shot: base("populated", "desktop", "dark"), caught: (r) => r.lowPage.length > 0 },
      { mutant: "overflow", shot: base("populated", "phone"), caught: (r) => r.overflowX === true || r.spill.length > 0 },
      { mutant: "target", shot: base("populated", "phone"), caught: (r) => r.smallTargets.some((t) => /^Open /.test(t.text)) },
      { mutant: "clip", shot: base("populated", "phone"), caught: (r) => r.clipped.length > 0 },
      { mutant: "label", shot: base("populated", "desktop"), caught: (r) => r.expectations.some((e) => /library rows/.test(e)) },
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
    fs.writeFileSync(path.join(out, "e09-documents-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
