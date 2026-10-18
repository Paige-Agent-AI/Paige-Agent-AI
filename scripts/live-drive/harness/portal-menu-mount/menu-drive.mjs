// E09 Slice M — render the customer portal menu (the real AppNav: phone drawer and desktop bar with a group menu
// open) and the owner's "Customer portal menu" editor (the real PortalStudio, embedded as Solo mounts it) in every
// state, both themes, 1440 and 390 wide, and MEASURE them: text contrast (AA against the real composited
// background), horizontal overflow, gold spent anywhere but the owner's Save menu, touch targets >= 44px, page
// errors / failed responses / any request that tried to leave the machine (the network is blocked), and that the
// HARNESS RENDER tag is on screen. It also reads the menu off the rendered page and checks it against the owner
// rulings (fixed Home + Messages, ruled groups, overlay names/order/hiding, Payments never shown while not live).
// The PERSISTENCE run (§70.1) saves through the real editor, RELOADS the page and reads the saved menu back off the
// reloaded editor, then opens the customer view in the same tab and checks the customer gets exactly that menu.
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the data boundary is stubbed (stubs.ts). The signed-in
// customer portal and Solo editor on the deployed app, against a seeded test tenant, are owed to a capable session.
//
//   node scripts/live-drive/harness/portal-menu-mount/menu-drive.mjs [--out dir] [--only substr]
//   node .../menu-drive.mjs --selftest [--out dir]   # negative controls: each injected defect must FAIL the drive
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-menu");
const only = arg("--only");
const selftest = argv.includes("--selftest");
fs.mkdirSync(out, { recursive: true });
const PORT = 5246;
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
const CUSTOMER = ["default", "renamed", "hidden", "reordered", "staff", "multi"];
const OWNER = ["default", "renamed", "hidden", "reordered", "saving", "saved", "mismatch"];

function allShots() {
  const shots = [];
  for (const theme of ["light", "dark"]) {
    for (const kind of ["desktop", "phone"]) {
      for (const variant of CUSTOMER) shots.push({ view: "customer", variant, theme, kind });
      for (const variant of OWNER) shots.push({ view: "owner", variant, theme, kind });
    }
  }
  return shots.map((s) => ({ ...s, w: SIZES[s.kind][0], h: SIZES[s.kind][1], phone: s.kind === "phone" }));
}

function startVite(mutant) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, HARNESS_MENU_MUTANT: mutant ?? "" },
    });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim();
const ownerVariantParam = (v) => (v === "saving" || v === "mismatch" ? v : "default");

/** Bring each state to the moment worth framing, through the REAL UI, and read the menu off the page. */
async function drive(page, s, notes) {
  if (s.view === "customer") {
    if (s.phone) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      const nav = page.locator('[role="dialog"] nav[aria-label="Customer navigation"]');
      await nav.waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      notes.menu = await nav.locator("[data-portal-heading], button").evaluateAll((els) => els.map((e) => (e.hasAttribute("data-portal-heading") ? `# ${e.textContent.trim()}` : e.textContent.trim())));
      return;
    }
    const nav = page.locator('[data-harness-region="nav"] nav[aria-label="Customer navigation"]');
    await nav.waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => !document.querySelector('[data-harness-region="nav"] .animate-pulse'), null, { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    notes.bar = await nav.locator(":scope > a, :scope > button").evaluateAll((els) => els.map((e) => (e.dataset.portalGroup ? `[${e.dataset.portalGroup}]` : e.textContent.trim())));
    // Every group menu, opened from the keyboard as a keyboard user would, read, closed with Escape.
    notes.groups = {};
    const triggers = nav.locator("button[data-portal-group]");
    for (let i = 0; i < await triggers.count(); i++) {
      const t = triggers.nth(i);
      await t.focus();
      await page.keyboard.press("Enter");
      const menu = page.locator('[role="menu"]');
      await menu.waitFor({ timeout: 10_000 });
      notes.groups[await t.getAttribute("data-portal-group")] = await menu.locator('[role="menuitem"] [data-portal-label]').allInnerTexts();
      notes.firstFocused = notes.firstFocused ?? await page.evaluate(() => document.activeElement?.getAttribute("role"));
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached", timeout: 10_000 });
    }
    // Frame the bar with its first group open.
    if (await triggers.count()) {
      await triggers.first().click();
      await page.locator('[role="menu"]').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(300);
    }
    return;
  }
  const editor = page.locator('[data-testid="portal-menu-editor"]');
  await editor.waitFor({ timeout: 30_000 });
  const fill = async (name, value) => { await editor.getByLabel(name, { exact: true }).fill(value); };
  if (["renamed", "saving", "saved", "mismatch"].includes(s.variant)) await fill("Name for Sessions", "Coaching calls");
  if (s.variant === "hidden") await editor.getByRole("switch", { name: "Show Documents" }).click();
  if (s.variant === "reordered") {
    await editor.getByRole("button", { name: "Move Sessions up" }).click();
    await editor.getByRole("button", { name: "Move Sessions up" }).click();
  }
  if (["saving", "saved", "mismatch"].includes(s.variant)) {
    await editor.getByRole("button", { name: "Save menu" }).click();
    await editor.locator('[data-testid="portal-menu-status"]').waitFor({ timeout: 15_000 });
    if (s.variant !== "saving") await page.waitForTimeout(400);
    notes.status = { text: clean(await editor.locator('[data-testid="portal-menu-status"]').innerText()), role: await editor.locator('[data-testid="portal-menu-status"]').getAttribute("role") };
  }
  await readOwner(page, editor, notes);
}

/** What the owner page shows: editor rows, preview, the View as client nav, every gold act on the page, row lines. */
async function readOwner(page, editor, notes) {
  notes.rows = await editor.locator("[data-menu-heading], [data-menu-row]").evaluateAll((els) => els.map((e) => (e.hasAttribute("data-menu-heading") ? `# ${e.textContent.trim()}` : e.getAttribute("data-menu-row"))));
  notes.preview = await editor.locator('[data-testid="portal-menu-preview"] [data-portal-label]').allInnerTexts();
  notes.sessionsRow = clean(await editor.locator('[data-menu-row="sessions"]').innerText());
  notes.editorText = clean(await editor.innerText());
  notes.values = await editor.locator("[data-menu-row] input").evaluateAll((els) => els.map((i) => i.value));
  notes.switches = await editor.locator('[data-menu-row] [role="switch"]').evaluateAll((els) => els.map((s) => s.getAttribute("aria-checked")));
  notes.viewAsClient = {
    headings: await page.locator('[data-testid="portal-view-as-client-nav"] p').allInnerTexts(),
    labels: await page.locator('[data-testid="portal-view-as-client-nav"] [data-portal-label]').allInnerTexts(),
  };
  // One gold act per PAGE (§11), not just per card: every button on the owner page wearing gold.
  notes.pageGold = await page.locator('[data-harness-region="page"] button').evaluateAll((els) => els.filter((b) => /gradient-gold|\bbg-accent\b/.test(b.className)).map((b) => b.textContent.trim()));
  // Each configurable row is one line: the switch sits beside the name field, never under it (390px included).
  notes.rowLines = await editor.locator("[data-menu-row]:has(input)").evaluateAll((rows) => rows.flatMap((r) => {
    const i = r.querySelector("input").getBoundingClientRect(), sw = r.querySelector('[role="switch"]').getBoundingClientRect();
    const mid = sw.top + sw.height / 2;
    return mid >= i.top && mid <= i.bottom ? [] : [r.getAttribute("data-menu-row")];
  }));
  // Frame the editor: scroll the shell's own scroller so the card's top sits at the top of the viewport.
  await editor.evaluate((el) => {
    let n = el.parentElement; while (n && !(n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY))) n = n.parentElement;
    if (n) n.scrollTop += el.getBoundingClientRect().top - n.getBoundingClientRect().top - 8;
  });
  await page.waitForTimeout(300);
}

/** What the owner ruled each state must show, checked against what the drive read off the page. */
function unmet(s, n) {
  const miss = [];
  const want = (ok, what) => { if (!ok) miss.push(what); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const text = JSON.stringify(n);
  want(!/Payments|Coming soon/.test(text), "Payments or 'Coming soon' shown while the route is not live");
  if (s.view === "customer") {
    const expected = {
      default: { top: ["Home", "Messages"], work: ["Progress", "Action items", "Sessions"], paper: ["Documents"], learn: ["Resources"] },
      renamed: { top: ["Home", "Messages"], work: ["Progress", "Action items", "Coaching calls"], paper: ["Documents"], learn: ["Library"] },
      hidden: { top: ["Home", "Messages"], work: ["Progress", "Sessions"], paper: [], learn: ["Resources"] },
      reordered: { top: ["Home", "Messages"], work: ["Sessions", "Action items", "Progress"], paper: ["Documents"], learn: ["Resources"] },
      staff: { top: ["Home"], work: ["Planning"], paper: [], learn: ["Resources"] },
      multi: { top: ["Home"], work: ["Action items"], paper: [], learn: ["Resources"] },
      // What the persistence run's owner saved: Sessions renamed, Documents hidden.
      stored: { top: ["Home", "Messages"], work: ["Progress", "Action items", "Coaching calls"], paper: [], learn: ["Resources"] },
    }[s.variant];
    if (s.phone) {
      const menu = [...expected.top];
      if (expected.work.length) menu.push("# Your work", ...expected.work);
      if (expected.paper.length) menu.push("# Paperwork", ...expected.paper);
      if (expected.learn.length) menu.push("# Learn", ...expected.learn);
      const fixedBottom = s.variant === "staff" || s.variant === "multi" ? ["Support", "Settings", "Sign Out"] : ["Get help", "Account", "Settings", "Sign Out"];
      want(eq(n.menu, [...menu, ...fixedBottom]), `drawer ${JSON.stringify(n.menu)}`);
    } else {
      const bar = [...expected.top];
      const group = (label, items) => { if (items.length === 1) bar.push(items[0]); else if (items.length > 1) bar.push(`[${label}]`); };
      group("Your work", expected.work); group("Paperwork", expected.paper); group("Learn", expected.learn);
      want(eq(n.bar, bar), `bar ${JSON.stringify(n.bar)}`);
      if (expected.work.length > 1) want(eq(n.groups?.["Your work"], expected.work), `Your work menu ${JSON.stringify(n.groups)}`);
      if (Object.keys(n.groups ?? {}).length) want(n.firstFocused === "menuitem", `keyboard open did not focus a menu item: ${n.firstFocused}`);
    }
    return miss;
  }
  const baseRows = ["# Always shown", "home", "messages", "# Your work", "progress", "actions", "sessions", "# Paperwork", "documents", "# Learn", "resources"];
  if (s.variant === "reordered") want(eq(n.rows, ["# Always shown", "home", "messages", "# Your work", "sessions", "progress", "actions", "# Paperwork", "documents", "# Learn", "resources"]), `rows ${JSON.stringify(n.rows)}`);
  else want(eq(n.rows, baseRows), `rows ${JSON.stringify(n.rows)}`);
  const previews = {
    default: ["Home", "Messages", "Progress", "Action items", "Sessions", "Documents", "Resources"],
    renamed: ["Home", "Messages", "Progress", "Action items", "Coaching calls", "Documents", "Resources"],
    hidden: ["Home", "Messages", "Progress", "Action items", "Sessions", "Resources"],
    reordered: ["Home", "Messages", "Sessions", "Progress", "Action items", "Documents", "Resources"],
  };
  want(eq(n.preview, previews[s.variant] ?? previews.renamed), `preview ${JSON.stringify(n.preview)}`);
  if (s.variant !== "default" && s.variant !== "hidden" && s.variant !== "reordered") want(/Renamed from Sessions/.test(n.sessionsRow ?? ""), `sessions row "${n.sessionsRow}"`);
  want(eq(n.pageGold, ["Save menu"]), `gold acts on the page ${JSON.stringify(n.pageGold)}`);
  want(eq(n.rowLines ?? null, []), `rows whose controls left the name's line ${JSON.stringify(n.rowLines)}`);
  want(eq(n.viewAsClient?.labels, n.preview), `View as client ${JSON.stringify(n.viewAsClient)} differs from the preview`);
  want((n.viewAsClient?.headings ?? []).length > 0, "View as client is not grouped");
  want(!(n.values ?? []).some((v) => !v), `an empty name field ${JSON.stringify(n.values)}`);
  want(/Always on/.test(n.editorText ?? "") && /Get help, Account, Settings and Sign out are always at the bottom/.test(n.editorText ?? "") && /tell Paige/.test(n.editorText ?? ""), "fixed items note or Always on missing");
  if (s.variant === "saving") want(n.status?.role === "status" && /Saving/.test(n.status?.text ?? ""), `saving status ${JSON.stringify(n.status)}`);
  if (s.variant === "saved") want(n.status?.role === "status" && /^Menu saved/.test(n.status?.text ?? ""), `saved status ${JSON.stringify(n.status)}`);
  if (s.variant === "mismatch") want(n.status?.role === "alert" && /doesn't match/.test(n.status?.text ?? "") && !/Menu saved/.test(n.status?.text ?? ""), `mismatch status ${JSON.stringify(n.status)}`);
  return miss;
}

function measureInPage(opts) {
  const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
  const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const blend = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f.length > 3 ? f[3] : 1; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || alphaOf(c) === 0;
  const pageBg = () => getComputedStyle(document.body).backgroundColor;
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      let c = getComputedStyle(n).backgroundColor;
      // A gradient fill (the gold act button) paints no background-color: grade against its first stop.
      const img = getComputedStyle(n).backgroundImage;
      if (transparent(c) && /gradient/.test(img)) c = (img.match(/rgba?\([^)]*\)|color\([^)]*\)/) ?? [c])[0];
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
  const inactive = (n) => !!n.closest("button:disabled, [aria-disabled='true'], input:disabled, fieldset:disabled");

  const roots = opts.owner
    ? [document.querySelector('[data-testid="portal-menu-editor"]')].filter(Boolean)
    : [document.querySelector('[data-harness-region="nav"] nav[aria-label="Customer navigation"]'), document.querySelector('[role="menu"]'), document.querySelector('[role="dialog"]')].filter(Boolean);
  // The rest of the customer bar (brand mark, role badge, bell, account, Sign Out) predates Slice M: measured and
  // REPORTED as chrome findings, never silently passed, but not graded as this slice's surface.
  const chromeRoot = opts.owner ? null : document.querySelector('[data-harness-region="nav"] > div');
  const textNodes = (root) => [...root.querySelectorAll("*")].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n));
  const contrast = roots.flatMap((root) => textNodes(root).map((n) => {
    const bg = bgOf(n), cs = getComputedStyle(n), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    return { text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), ratio: ratio(fgOf(n, bg), bg), need, inactive: inactive(n), size: cs.fontSize };
  }));
  // Placeholders are text too: the default name in an empty name field.
  const placeholders = opts.owner ? [...document.querySelectorAll('[data-testid="portal-menu-editor"] input')].filter((i) => !i.value && i.placeholder && visible(i)).map((i) => {
    const bg = bgOf(i), c = getComputedStyle(i, "::placeholder").color;
    return { text: `placeholder:${i.placeholder}`, ratio: ratio(alphaOf(c) < 1 ? blend(c, bg) : c, bg), need: 4.5, inactive: inactive(i), size: getComputedStyle(i).fontSize };
  }) : [];
  const graded = [...contrast, ...placeholders].filter((c) => !c.inactive);
  const low = graded.filter((c) => c.ratio < c.need);

  const probe = document.createElement("i"); document.body.append(probe);
  probe.style.setProperty("transition", "none", "important");
  const golds = ["--accent", "--gold", "--gold-light", "--gold-dark", "--accent-glow"].map((t) => { probe.style.color = `hsl(var(${t}))`; return parse(getComputedStyle(probe).color).slice(0, 3).join(","); });
  probe.remove();
  // The gold gradient's stops are literal hsl() values, not the tokens: recognise them by hue.
  const goldHue = (c) => {
    const [r, g, b] = parse(c).slice(0, 3).map((v) => v / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return false;
    const sat = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
    return h >= 30 && h <= 55 && sat > 0.45 && l > 0.35 && l < 0.85;
  };
  const isGold = (c) => !transparent(c) && golds.includes(parse(c).slice(0, 3).map(Math.round).join(","));
  const gold = roots.flatMap((root) => [...root.querySelectorAll("*")].filter((n) => n.getClientRects().length && !n.closest("[data-harness-tag]")).flatMap((n) => {
    const cs = getComputedStyle(n); const hits = [];
    if (isGold(cs.color) && [...n.childNodes].some((c) => (c.nodeType === 3 && c.textContent.trim()) || c.nodeName === "svg")) hits.push("text");
    const stops = /gradient/.test(cs.backgroundImage) ? cs.backgroundImage.match(/rgba?\([^)]*\)/g) ?? [] : [];
    if (isGold(cs.backgroundColor) || stops.some((c) => isGold(c) || goldHue(c))) hits.push("background");
    if (parseFloat(cs.borderTopWidth) > 0 && isGold(cs.borderTopColor)) hits.push("border");
    // The one permitted act: the owner's Save menu.
    const act = n.closest("button")?.textContent?.trim() === "Save menu";
    return hits.length && !act ? [{ el: n.tagName.toLowerCase(), text: n.textContent.trim().slice(0, 30), hits }] : [];
  }));
  const saveMenuGold = opts.owner ? (() => { const b = [...document.querySelectorAll('[data-testid="portal-menu-editor"] button')].find((x) => x.textContent.trim() === "Save menu"); return !!b && /gradient-gold/.test(b.className); })() : null;

  const targetSel = 'a, button, input, [role="switch"], [role="menuitem"]';
  const hitOf = (n) => {
    const r = n.getBoundingClientRect();
    const ext = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(n, pseudo);
      if (ps.content === "none" || ps.position !== "absolute" || getComputedStyle(n).position === "static") continue;
      const px = (v) => (v.endsWith("px") ? parseFloat(v) : null);
      const [t, b, l, rt] = [px(ps.top), px(ps.bottom), px(ps.left), px(ps.right)];
      if ([t, b, l, rt].some((v) => v === null)) continue;
      ext.top = Math.min(ext.top, r.top + t); ext.bottom = Math.max(ext.bottom, r.bottom - b);
      ext.left = Math.min(ext.left, r.left + l); ext.right = Math.max(ext.right, r.right - rt);
    }
    return { h: Math.round(ext.bottom - ext.top), w: Math.round(ext.right - ext.left) };
  };
  const targets = roots.flatMap((root) => [...root.querySelectorAll(targetSel)]
    .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only, [hidden], [data-harness-tag]"))
    .map((n) => ({ text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 40), ...hitOf(n) })));

  const scroller = document.querySelector('[data-harness-region="page"]')?.closest(".tcs-main") ?? document.querySelector('[data-harness-region="page"]');
  const chrome = (() => {
    if (!chromeRoot) return null;
    const navEl = roots[0];
    const outside = (n) => !navEl || !navEl.contains(n);
    const lowChrome = textNodes(chromeRoot).filter(outside).map((n) => { const bg = bgOf(n); return { text: n.textContent.trim().slice(0, 30), ratio: ratio(fgOf(n, bg), bg) }; }).filter((c) => c.ratio < 4.5);
    const small = [...chromeRoot.querySelectorAll(targetSel)].filter((n) => outside(n) && n.getClientRects().length).map((n) => ({ text: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().slice(0, 30), ...hitOf(n) })).filter((t) => t.h < 44 || t.w < 44);
    const goldChrome = [...chromeRoot.querySelectorAll("*")].filter((n) => outside(n) && n.getClientRects().length && (isGold(getComputedStyle(n).color) || isGold(getComputedStyle(n).backgroundColor))).map((n) => n.textContent.trim().slice(0, 30));
    return { lowChrome, small, goldChrome };
  })();
  return {
    chrome,
    contrastMin: graded.length ? Math.min(...graded.map((c) => c.ratio)) : null, low,
    gold, saveMenuGold,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5
      || (scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false),
    smallTargets: targets.filter((t) => t.h < 44 || t.w < 44),
    tag: (() => { const t = document.querySelector("[data-harness-tag]"); const r = t?.getBoundingClientRect(); return !!r && r.width > 40 && r.height >= 10 && getComputedStyle(t).visibility !== "hidden"; })(),
  };
}

async function runShots(browser, shots, label = "") {
  const results = {};
  let failed = false;
  for (const s of shots) {
    const name = `e09-menu-${s.view}-${s.variant}-${s.theme}-${s.w}x${s.h}${label}`;
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", locale: "en-US",
      ...(s.phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
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
    const variantParam = s.view === "owner" ? ownerVariantParam(s.variant) : s.variant;
    await page.goto(`http://127.0.0.1:${PORT}/${s.view === "owner" ? "solo/1234567/clients/portal" : "app"}?${new URLSearchParams({ view: s.view, variant: variantParam, theme: s.theme })}`, { timeout: 180_000 });
    let driveError = null;
    try { await drive(page, s, notes); } catch (e) { driveError = String(e).slice(0, 400); }
    const m = await page.evaluate(measureInPage, { owner: s.view === "owner" });
    const expectations = driveError ? [] : unmet(s, notes);
    const ok = !driveError && expectations.length === 0 && errors.length === 0 && blocked.length === 0 && m.low.length === 0 && !m.overflowX
      && m.gold.length === 0 && m.smallTargets.length === 0 && m.tag && (s.view !== "owner" || m.saveMenuGold === true);
    if (!ok) failed = true;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    if (s.view === "owner" && !driveError) await page.locator('[data-testid="portal-menu-editor"]').screenshot({ path: path.join(out, `${name}-editor.png`) }).catch(() => undefined);
    if (s.view === "owner" && !driveError && ["default", "renamed"].includes(s.variant)) await page.locator('[data-testid="portal-view-as-client"]').screenshot({ path: path.join(out, `${name}-viewasclient.png`) }).catch(() => undefined);
    results[name] = { ok, driveError, expectations, errors, consoleErrors, blocked, notes, ...m };
    await ctx.close();
    console.log(`${name} ${ok ? "OK" : "FAIL"}`, JSON.stringify({ driveError, expectations, contrastMin: m.contrastMin, low: m.low.slice(0, 3), gold: m.gold.slice(0, 3), saveMenuGold: m.saveMenuGold, overflowX: m.overflowX, smallTargets: m.smallTargets.slice(0, 4), errors: errors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 2), blocked: blocked.slice(0, 3), tag: m.tag, chrome: m.chrome }));
  }
  return { results, failed };
}

/**
 * §70.1 in the harness: the owner renames Sessions and hides Documents, saves, and sees "Menu saved"; the page RELOADS
 * and the editor still holds exactly that; then, in the same tab, the customer view gets exactly that menu. The store
 * is sessionStorage (stubs.ts), so the reload and the navigation are real; production is still owed (§32).
 */
async function runPersistence(browser, label = "", filter = () => true) {
  const results = {};
  let failed = false;
  for (const theme of ["light", "dark"]) {
    for (const kind of ["desktop", "phone"]) {
      if (!filter({ theme, kind })) continue;
      const [w, h] = SIZES[kind]; const phone = kind === "phone";
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, reducedMotion: "reduce", locale: "en-US", ...(phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
      const page = await ctx.newPage();
      const errors = [], blocked = [], notes = {}, miss = [];
      await page.route("**/*", (route) => {
        const u = new URL(route.request().url());
        if (u.hostname === "127.0.0.1" && u.port === String(PORT)) return route.continue();
        blocked.push(route.request().url().slice(0, 140)); return route.abort("blockedbyclient");
      });
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
      const ownerUrl = `http://127.0.0.1:${PORT}/solo/1234567/clients/portal?${new URLSearchParams({ view: "owner", variant: "default", theme })}`;
      const reloaded = `e09-menu-owner-reloaded-${theme}-${w}x${h}${label}`, after = `e09-menu-customer-afterownersave-${theme}-${w}x${h}${label}`;
      let driveError = null, mOwner = null, mCustomer = null;
      try {
        await page.goto(ownerUrl, { timeout: 180_000 });
        await page.evaluate(() => window.sessionStorage.clear());
        await page.reload({ timeout: 180_000 });
        const editor = page.locator('[data-testid="portal-menu-editor"]');
        await editor.waitFor({ timeout: 30_000 });
        await editor.getByLabel("Name for Sessions", { exact: true }).fill("Coaching calls");
        await editor.getByRole("switch", { name: "Show Documents" }).click();
        await editor.getByRole("button", { name: "Save menu" }).click();
        await editor.locator('[data-testid="portal-menu-status"]').waitFor({ timeout: 15_000 });
        await page.waitForTimeout(300);
        notes.savedStatus = clean(await editor.locator('[data-testid="portal-menu-status"]').innerText());
        await page.reload({ timeout: 180_000 });
        await editor.waitFor({ timeout: 30_000 });
        await page.waitForTimeout(400);
        await readOwner(page, editor, notes);
        notes.statusAfterReload = await editor.locator('[data-testid="portal-menu-status"]').count();
        notes.sessionsValue = await editor.getByLabel("Name for Sessions", { exact: true }).inputValue();
        notes.documentsShown = await editor.getByRole("switch", { name: "Show Documents" }).getAttribute("aria-checked");
        notes.saveDisabled = await editor.getByRole("button", { name: "Save menu" }).isDisabled();
        mOwner = await page.evaluate(measureInPage, { owner: true });
        await page.screenshot({ path: path.join(out, `${reloaded}.png`) });
        await editor.screenshot({ path: path.join(out, `${reloaded}-editor.png`) }).catch(() => undefined);
        // Same tab, so the same sessionStorage: the customer of this business opens their portal.
        await page.goto(`http://127.0.0.1:${PORT}/app?${new URLSearchParams({ view: "customer", variant: "stored", theme })}`, { timeout: 180_000 });
        const cnotes = {};
        await drive(page, { view: "customer", variant: "stored", theme, kind, phone }, cnotes);
        notes.customer = cnotes;
        mCustomer = await page.evaluate(measureInPage, { owner: false });
        await page.screenshot({ path: path.join(out, `${after}.png`) });
        miss.push(...unmet({ view: "customer", variant: "stored", phone }, cnotes));
      } catch (e) { driveError = String(e).slice(0, 400); }
      const want = (ok, what) => { if (!ok) miss.push(what); };
      if (!driveError) {
        want(/^Menu saved/.test(notes.savedStatus ?? ""), `save status "${notes.savedStatus}"`);
        want(notes.sessionsValue === "Coaching calls", `after reload Sessions reads "${notes.sessionsValue}"`);
        want(notes.documentsShown === "false", `after reload Documents switch is ${notes.documentsShown}`);
        want(notes.saveDisabled === true, "after reload the editor is dirty (Save menu enabled)");
        want(notes.statusAfterReload === 0, "a status line survived the reload");
        want(JSON.stringify(notes.preview) === JSON.stringify(["Home", "Messages", "Progress", "Action items", "Coaching calls", "Resources"]), `after reload the preview reads ${JSON.stringify(notes.preview)}`);
      }
      const measured = [mOwner, mCustomer].filter(Boolean);
      const ok = !driveError && miss.length === 0 && errors.length === 0 && blocked.length === 0 && measured.length === 2
        && measured.every((m) => m.low.length === 0 && !m.overflowX && m.gold.length === 0 && m.smallTargets.length === 0 && m.tag)
        && mOwner.saveMenuGold === true;
      if (!ok) failed = true;
      results[`${reloaded}+${after}`] = { ok, driveError, expectations: miss, errors, blocked, notes, owner: mOwner, customer: mCustomer };
      console.log(`${reloaded} + ${after} ${ok ? "OK" : "FAIL"}`, JSON.stringify({ driveError, expectations: miss, errors: errors.slice(0, 3), ownerLow: mOwner?.low?.slice(0, 2), customerLow: mCustomer?.low?.slice(0, 2), ownerMin: mOwner?.contrastMin, customerMin: mCustomer?.contrastMin }));
      await ctx.close();
    }
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
      const persistence = only ? { results: {}, failed: false } : await runPersistence(browser);
      fs.writeFileSync(path.join(out, "e09-menu-measurements.json"), JSON.stringify({ ...results, persistence: persistence.results }, null, 2));
      exitCode = failed || persistence.failed ? 1 : 0;
    } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } }
  } else {
    // Negative controls: each defect is injected by the harness's own vite transform (no product file edited) and
    // the drive MUST report it through the named check. A control that passes means the drive is blind to it.
    const shot = (view, variant, kind, theme = "light") => ({ view, variant, theme, kind, w: SIZES[kind][0], h: SIZES[kind][1], phone: kind === "phone" });
    const controls = [
      { mutant: "navgold", shot: shot("customer", "default", "phone"), caught: (r) => r.gold.length > 0 },
      { mutant: "navtarget", shot: shot("customer", "default", "phone"), caught: (r) => r.smallTargets.length > 0 },
      { mutant: "editorgold", shot: shot("owner", "default", "desktop"), caught: (r) => r.gold.length > 0 },
      { mutant: "contrast", shot: shot("owner", "default", "desktop", "dark"), caught: (r) => r.low.length > 0 },
      { mutant: "overflow", shot: shot("owner", "default", "phone"), caught: (r) => r.overflowX === true },
      { mutant: "target", shot: shot("owner", "default", "desktop"), caught: (r) => r.smallTargets.some((t) => /^Move /.test(t.text)) },
      { mutant: "signoutdark", shot: shot("customer", "default", "phone", "dark"), caught: (r) => r.low.some((c) => /Sign Out/.test(c.text)) },
      { mutant: "rowwrap", shot: shot("owner", "default", "phone"), caught: (r) => (r.expectations ?? []).some((e) => /left the name's line/.test(e)) },
      { mutant: "nopersist", persistence: true, caught: (r) => (r.expectations ?? []).some((e) => /after reload/.test(e)) },
    ];
    const verdicts = [];
    for (const c of controls) {
      const vite = await startVite(c.mutant);
      try {
        const { results } = c.persistence
          ? await runPersistence(browser, `-MUTANT-${c.mutant}`, ({ theme, kind }) => theme === "light" && kind === "desktop")
          : await runShots(browser, [c.shot], `-MUTANT-${c.mutant}`);
        const r = Object.values(results)[0];
        const caught = !!r && !r.ok && c.caught(r);
        verdicts.push({ mutant: c.mutant, caught, ok: r?.ok, driveError: r?.driveError ?? null });
        if (!caught) exitCode = 1;
      } finally { try { process.kill(-vite.pid); } catch { /* already gone */ } await new Promise((res) => setTimeout(res, 800)); }
    }
    fs.writeFileSync(path.join(out, "e09-menu-selftest.json"), JSON.stringify(verdicts, null, 2));
    console.log("SELFTEST", JSON.stringify(verdicts));
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
