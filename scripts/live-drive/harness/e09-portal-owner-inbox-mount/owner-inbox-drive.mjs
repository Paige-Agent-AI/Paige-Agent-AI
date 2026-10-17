// E09 Slice 1 — render the BUSINESS OWNER side of the portal conversation (e09-portal-owner-inbox-mount):
// the canonical inbox inside the real Solo Clients workspace, with a thread that mixes email, SMS, portal
// messages and a help request, and the composer in Portal mode replying through comms_portal_reply. Every
// frame is MEASURED: text contrast against the real composited background (AA 4.5:1), horizontal overflow,
// gold spent outside the primary act (Send), touch targets on the phone frames (>= 44px), page errors and
// failed requests, plus the behaviour each state claims (portal labels, Portal composer, kept draft, the
// RPC called and nothing sent through send-message).
//
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1): the signed-in Solo inbox is owed.
//
//   node scripts/live-drive/harness/e09-portal-owner-inbox-mount/owner-inbox-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const out = path.resolve(repo, outArg >= 0 ? argv[outArg + 1] : "scripts/live-drive/artifacts/e09-portal-messages-owner");
fs.mkdirSync(out, { recursive: true });
const PORT = 5253;
const NAME = "Jordan Rivera";
const PORTAL_PLACEHOLDER = `Message ${NAME} in their client portal…`;
const DRAFT = "Adding a note to the top of it now.";

const shots = [];
// The Solo frame matrix (ui-delivery evidence): four viewports × PAIGE closed / open × both themes, state=thread.
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) for (const paige of ["closed", "open"]) for (const theme of ["light", "dark"]) shots.push({ state: "thread", theme, w, h, paige, matrix: true });
// The other states at 1366×768, both themes.
for (const state of ["help", "notjoined", "error"]) for (const theme of ["light", "dark"]) shots.push({ state, theme, w: 1366, h: 768, paige: "closed" });
// A phone frame of the populated thread, for touch-target size.
for (const theme of ["light", "dark"]) shots.push({ state: "thread", theme, w: 390, h: 844, paige: "closed", phone: true });

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    const name = s.matrix
      ? `e09-inbox-matrix-${s.paige}-${s.theme}-${s.w}x${s.h}`
      : `e09-inbox-${s.state}-${s.theme}${s.phone ? "-phone" : ""}-${s.w}x${s.h}`;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", hasTouch: !!s.phone });
    const page = await ctx.newPage();
    const errors = [];
    const consoleErrors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 240)); });
    // A missing favicon is the harness's, not the surface's; every other failed resource is an error.
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${PORT}/solo/42/clients/conversations?${new URLSearchParams({ state: s.state, theme: s.theme, paige: s.paige })}`);
    let composer;
    const behaviour = {};
    try {
      await page.waitForSelector("[data-canonical-conversations]", { timeout: 30_000 });
      composer = page.locator(`textarea[placeholder="${PORTAL_PLACEHOLDER}"]`).first();
      await composer.waitFor({ timeout: 30_000 });
      await page.waitForTimeout(400);
      behaviour.composerPortal = true;
    } catch (e) {
      behaviour.composerPortal = false;
      errors.push(`surface did not reach a Portal composer: ${String(e).slice(0, 200)}`);
    }
    if (behaviour.composerPortal) {
      if (s.state === "thread") await composer.fill(DRAFT);
      if (s.state === "notjoined" || s.state === "error") {
        const text = s.state === "notjoined" ? "Here's the timeline link." : DRAFT;
        await composer.fill(text);
        await page.getByRole("button", { name: "Send", exact: true }).click();
        const expected = s.state === "notjoined" ? `${NAME} hasn't joined your client portal yet` : "Couldn't confirm the portal message was posted";
        try { await page.locator("[data-sonner-toast]").filter({ hasText: expected }).first().waitFor({ timeout: 10_000 }); behaviour.toast = expected; }
        catch { behaviour.toast = null; errors.push(`expected outcome copy not shown: "${expected}"`); }
        behaviour.draftKept = (await composer.inputValue()) === text;
        await page.waitForTimeout(300);
      }
      if (s.state === "help") {
        // The help request is the newest message: bring its bubble into view the way the thread opens on it.
        await page.getByText("I can't find the revised timeline", { exact: false }).first().scrollIntoViewIfNeeded().catch(() => undefined);
        await page.waitForTimeout(200);
      }
    }
    const m = await page.evaluate(({ phone, state }) => {
      // color-mix() computes to `color(srgb r g b [/ a])` with 0–1 channels; rgb() has 0–255 ones.
      const parse = (c) => { const n = (c.match(/[\d.]+/g) ?? []).map(Number); return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n; };
      const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const alphaOf = (c) => { const p = parse(c); return p.length > 3 ? p[3] : 1; };
      const over = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = alphaOf(fg); return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
      const transparent = (c) => !c || c === "transparent" || /rgba\(0, 0, 0, 0\)/.test(c) || alphaOf(c) === 0;
      // Composite every translucent background from the element up to the first opaque one.
      const bgOf = (el) => {
        const layers = [];
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (transparent(c)) continue;
          layers.push(c);
          if (alphaOf(c) >= 1) break;
        }
        let acc = layers.length && alphaOf(layers[layers.length - 1]) >= 1 ? layers.pop() : getComputedStyle(document.body).backgroundColor;
        if (transparent(acc)) acc = "rgb(255,255,255)";
        while (layers.length) acc = over(layers.pop(), acc);
        return acc;
      };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
      const visible = (n) => { const r = n.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(n); return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; };
      const inView = (n) => { const r = n.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
      const tag = document.querySelector("[data-harness-tag]");
      const scopes = [document.querySelector("#tenant-shell-main"), ...document.querySelectorAll("[data-sonner-toast]")].filter(Boolean);
      const textEls = scopes.flatMap((sc) => [sc, ...sc.querySelectorAll("*")]).filter((n) => n !== tag && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && visible(n) && inView(n));
      const disabled = (n) => !!n.closest("button:disabled, [aria-disabled='true'], fieldset:disabled");
      const contrast = textEls.filter((n) => !disabled(n)).map((n) => ({ text: n.textContent.trim().slice(0, 50), ratio: ratio(over(getComputedStyle(n).color, bgOf(n)), bgOf(n)), color: getComputedStyle(n).color, bg: bgOf(n) }));
      // Placeholders are text too.
      for (const t of document.querySelectorAll("#tenant-shell-main textarea, #tenant-shell-main input")) {
        if (!visible(t) || !inView(t) || t.value || !t.placeholder) continue;
        const bg = bgOf(t); const col = getComputedStyle(t, "::placeholder").color;
        contrast.push({ text: `placeholder: ${t.placeholder.slice(0, 40)}`, ratio: ratio(over(col, bg), bg), color: col, bg });
      }
      const low = contrast.filter((c) => c.ratio < 4.5);

      // Gold: every brand gold token resolved to its computed colour; an element painting one in its text,
      // fill or border is gold spent. The only place that may spend it is the primary act (Send).
      const rootCs = getComputedStyle(document.querySelector("#tenant-shell-main"));
      const probe = document.createElement("i"); document.body.append(probe);
      const resolve = (v) => { probe.style.color = ""; probe.style.color = v; if (!probe.style.color) probe.style.color = `hsl(${v})`; return probe.style.color ? getComputedStyle(probe).color : null; };
      const goldTokens = ["--pg-gold", "--pg-gold-core", "--pg-gold-fill", "--pg-gold-deep", "--cd-gold", "--gold", "--gold-dark", "--gold-light", "--accent"];
      const goldRgb = [...new Set(goldTokens.map((t) => rootCs.getPropertyValue(t).trim()).filter(Boolean).map(resolve).filter(Boolean))];
      probe.remove();
      const strip = (c) => parse(c).slice(0, 3).map(Math.round).join(",");
      const goldKeys = new Set(goldRgb.map(strip));
      const sendBtn = [...document.querySelectorAll("#tenant-shell-main button")].find((b) => b.textContent.trim() === "Send");
      const goldEls = [...document.querySelectorAll("#tenant-shell-main *")].filter(visible).filter((n) => {
        const cs = getComputedStyle(n);
        const paints = [cs.color, cs.backgroundColor, cs.borderTopWidth !== "0px" ? cs.borderTopColor : null, cs.borderLeftWidth !== "0px" ? cs.borderLeftColor : null].filter((c) => c && !transparent(c));
        return paints.some((c) => goldKeys.has(strip(c)));
      }).map((n) => ({ el: `${n.tagName.toLowerCase()}${n.className && typeof n.className === "string" ? "." + n.className.split(" ").slice(0, 3).join(".") : ""}`, text: n.textContent.trim().slice(0, 30), primaryAct: !!(sendBtn && (n === sendBtn || sendBtn.contains(n))) }));
      const goldOutsideAct = goldEls.filter((g) => !g.primaryAct);

      // Horizontal overflow: the page, the inbox, and any visible element that runs past the viewport edge
      // without sitting inside its own horizontal scroller.
      const inbox = document.querySelector("[data-canonical-conversations]");
      const scrollsX = (n) => { for (let p = n.parentElement; p; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if ((ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") && p !== document.documentElement && p !== document.body) return true; } return false; };
      const pastEdge = [...document.querySelectorAll("#tenant-shell-main *")].filter(visible).filter((n) => { const r = n.getBoundingClientRect(); return r.right > innerWidth + 1 && !scrollsX(n); }).slice(0, 5).map((n) => ({ el: n.tagName.toLowerCase(), text: n.textContent.trim().slice(0, 30), right: Math.round(n.getBoundingClientRect().right) }));
      const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth || (inbox ? inbox.scrollWidth > inbox.clientWidth + 1 : false) || pastEdge.length > 0;

      // Touch targets on the phone frames: every visible control inside the inbox at least 44×44.
      const controls = [...document.querySelectorAll("#tenant-shell-main button, #tenant-shell-main a[href], #tenant-shell-main [role='button'], #tenant-shell-main [role='tab'], #tenant-shell-main [role='combobox'], #tenant-shell-main input, #tenant-shell-main textarea")].filter(visible).filter(inView);
      const smallTargets = phone ? controls.map((n) => { const r = n.getBoundingClientRect(); return { label: (n.getAttribute("aria-label") || n.textContent.trim() || n.getAttribute("placeholder") || n.tagName).slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.h < 44 || t.w < 44) : [];

      const text = document.querySelector("#tenant-shell-main")?.innerText ?? "";
      const has = (t) => text.includes(t);
      const helpRow = [...document.querySelectorAll("[data-thread-key]")].find((r) => r.textContent.includes("Jordan Rivera"));
      return {
        contrastMin: contrast.length ? Math.min(...contrast.map((c) => c.ratio)) : null, textCount: contrast.length, low: low.slice(0, 8),
        goldTokens: goldRgb, gold: goldEls.length, goldOutsideAct, overflowX, pastEdge, smallTargets,
        labels: { portalClient: has("Portal · Jordan Rivera"), portalYou: has("Portal · You"), help: has("Help request"), email: has("Before we sign off on phase two"), sms: has("Thursday works") },
        note: has(`Posts in Jordan Rivera's client portal`),
        railHelpPreview: helpRow ? helpRow.textContent.includes("Help request:") : null,
        claimsRead: /\b(Read|Seen)\b/.test(text),
        rpc: (window.__harness?.rpc ?? []).map((r) => r.name),
        state,
      };
    }, { phone: !!s.phone, state: s.state });

    // Behaviour each state claims.
    const portalReplies = m.rpc.filter((r) => r === "comms_portal_reply").length;
    const sentElsewhere = m.rpc.filter((r) => r === "functions:send-message").length;
    const checks = {
      composerPortal: behaviour.composerPortal === true,
      noteShown: m.note,
      labelsShown: m.labels.portalClient && m.labels.help && m.labels.email && m.labels.sms && (s.state === "thread" ? m.labels.portalYou : true),
      railHelpPreview: s.state === "help" ? m.railHelpPreview === true : true,
      neverClaimsRead: !m.claimsRead,
      rpcOnce: s.state === "notjoined" || s.state === "error" ? portalReplies === 1 : portalReplies === 0,
      noProviderSend: sentElsewhere === 0,
      outcomeCopy: s.state === "notjoined" || s.state === "error" ? !!behaviour.toast : true,
      draftKept: s.state === "notjoined" || s.state === "error" ? behaviour.draftKept === true : true,
    };
    const ok = errors.length === 0 && !m.overflowX && m.goldOutsideAct.length === 0 && m.low.length === 0 && m.smallTargets.length === 0 && Object.values(checks).every(Boolean);
    if (!ok) failed = true;
    results[name] = { ok, ...m, checks, behaviour, errors, consoleErrors: consoleErrors.slice(0, 10) };
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    await ctx.close();
    console.log(name, ok ? "OK" : "FAIL", JSON.stringify({ contrastMin: m.contrastMin, low: m.low.slice(0, 3).map((l) => `${l.text}:${l.ratio}`), gold: m.gold, goldOutsideAct: m.goldOutsideAct.slice(0, 3), overflowX: m.overflowX, pastEdge: m.pastEdge, smallTargets: m.smallTargets.slice(0, 6), checks: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k), errors: errors.slice(0, 2), consoleErrors: consoleErrors.length }));
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}
fs.writeFileSync(path.join(out, "e09-inbox-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
