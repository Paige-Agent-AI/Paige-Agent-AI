// EXP03 20271120120003 (review M1) — render why PAIGE won't send, in the REAL Solo inbox (exp03-composer-inline-check
// mount, ?supp=bounce|complaint|optout), and MEASURE it before labelling: the composer note says the right thing for
// the row's reason (a bounce is the address, never "opted out"), Send is held, AA text contrast of the new lines against their real composited background, no horizontal overflow, no
// gold outside the act, the face loaded, no page errors. HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1).
//
//   node scripts/live-drive/harness/exp03-composer-inline-check-mount/bounce-notice-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const out = path.resolve(repo, outArg >= 0 ? argv[outArg + 1] : "docs/evidence/ui-delivery/assets/exp03-governed-bounce-suppression");
fs.mkdirSync(out, { recursive: true });
const PORT = 5199;
const LABEL = "harness render · not live";

const EXPECT = {
  bounce: { note: "This email address bounced. Check it, or use another address." },
  complaint: { note: "They marked your email as spam — Paige won't send email." },
  optout: { note: "This contact opted out of Email — Paige won't send." },
};
const shots = [];
for (const supp of Object.keys(EXPECT)) for (const theme of ["light", "dark"]) shots.push({ supp, theme, w: 1366, h: 768 });
for (const [w, h] of [[1536, 770], [1024, 768], [900, 1000]]) for (const theme of ["light", "dark"]) shots.push({ supp: "bounce", theme, w, h });

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const onData = (d) => { log += String(d); if (log.includes("ready in")) resolve(child); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

function measure() {
  const main = document.querySelector("#tenant-shell-main");
  const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true });
  const parse = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "rgba(0,0,0,0)"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
  const lum = (c) => { const [r, g, b] = parse(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const over = (fg, bg) => { const f = parse(fg), b = parse(bg); const a = f[3]; return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(",")})`; };
  const transparent = (c) => !c || c === "transparent" || parse(c)[3] === 0;
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (transparent(c)) continue; layers.push(c); if (parse(c)[3] >= 1) break; }
    let acc = layers.length && parse(layers[layers.length - 1])[3] >= 1 ? layers.pop() : getComputedStyle(document.body).backgroundColor || "rgb(255,255,255)";
    while (layers.length) acc = over(layers.pop(), acc);
    return acc;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)); };
  const textOf = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const ownText = (n) => [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join("").trim();
  const signal = main?.querySelector("[data-suppression-signal]");
  const noteEl = [...(main?.querySelectorAll("p, div, span") ?? [])].find((n) => /bounced\. Check it|marked your email as spam — Paige won't send email\.|opted out of Email — Paige won't send\./.test(ownText(n)) && !signal?.contains(n));
  const contrastOf = (root) => !root ? [] : [root, ...root.querySelectorAll("*")].filter((n) => ownText(n)).map((n) => { const bg = bgOf(n); const col = over(getComputedStyle(n).color, bg); return { text: ownText(n).slice(0, 70), ratio: ratio(col, bg), size: getComputedStyle(n).fontSize }; });
  const send = main?.querySelector("[data-composer-send]");
  const composer = main?.querySelector('[data-composer-writing-surface="true"]')?.closest(".border-t");
  const goldBtns = composer ? [...composer.querySelectorAll("button")].filter((b) => /gold/.test(b.className) || /gradient/.test(getComputedStyle(b).backgroundImage)).map((b) => textOf(b)) : [];
  return {
    mounted: !!main, font: document.fonts.check('14px "Schibsted Grotesk"'),
    signal: textOf(signal), note: noteEl ? ownText(noteEl) : null,
    contrast: [...contrastOf(signal), ...(noteEl ? contrastOf(noteEl) : [])],
    send: send ? { disabled: send.disabled || send.getAttribute("aria-disabled") === "true", text: textOf(send) } : null,
    goldBtns, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    bodyText: textOf(main).slice(0, 4000),
  };
}

async function burnLabel(page) {
  return page.evaluate((LABEL) => {
    const el = document.createElement("div");
    el.textContent = LABEL;
    Object.assign(el.style, { position: "fixed", left: "50%", top: "6px", transform: "translateX(-50%)", zIndex: "2147483647", padding: "3px 10px", borderRadius: "999px", font: "600 12px/16px system-ui, sans-serif", background: "#111", color: "#fff", border: "1px solid #fff" });
    document.body.append(el);
    const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.width > 40 && (top === el || el.contains(top));
  }, LABEL);
}

const vite = await startVite();
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = {};
let failed = false;
try {
  for (const s of shots) {
    const name = `exp03b-${s.supp}-${s.theme}-${s.w}x${s.h}`;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: "America/Chicago", locale: "en-US" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    try {
      await page.goto(`http://127.0.0.1:${PORT}/solo/42/clients/conversations?${new URLSearchParams({ door: "ok", supp: s.supp, theme: s.theme, paige: "closed" })}`, { timeout: 240_000 });
      await page.waitForSelector("[data-canonical-conversations]", { timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.locator("[data-thread-key]").filter({ hasText: "Jordan Rivera" }).first().click();
      await page.waitForFunction(() => document.querySelector('[data-composer-writing-surface="true"] textarea')?.getAttribute("placeholder")?.includes("Jordan"), null, { timeout: 15_000 });
      await page.locator('input[placeholder="Subject"]').fill("Re: Kitchen refresh — scope questions");
      await page.locator('[data-composer-writing-surface="true"] textarea').fill("Hardware is included in the quote.");
      await page.waitForFunction((t) => document.querySelector("#tenant-shell-main")?.textContent?.includes(t), EXPECT[s.supp].note, { timeout: 10_000 });
      await page.waitForTimeout(300);
    } catch (e) { errors.push(`did not reach the state: ${String(e).slice(0, 240)}`); }
    const m = await page.evaluate(measure);
    const want = EXPECT[s.supp];
    const checks = {
      mounted: m.mounted, font: m.font, noOverflow: !m.overflowX,
      note: m.note === want.note,
      // The Solo inbox's right pane is SoloClientContextPane, which shows no do-not-send rows; the rail with the
      // reason line (ContactCardRail) is the admin inbox's. Its words are proved by the jsdom render tests.
      soloHasNoRailSignal: m.signal === "",
      notOptedOut: s.supp === "optout" || !/opted out/i.test(m.bodyText),
      sendHeld: m.send?.disabled === true,
      aa: m.contrast.length > 0 && m.contrast.every((c) => c.ratio >= 4.5),
      goldOnlyOnSend: m.goldBtns.every((t) => t === "Send"),
    };
    const ok = errors.length === 0 && Object.values(checks).every(Boolean);
    const labelled = await burnLabel(page);
    if (!ok || !labelled) failed = true;
    if (labelled) await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 70 });
    results[name] = { ok: ok && labelled, checks, note: m.note, signal: m.signal, contrast: m.contrast, send: m.send, goldBtns: m.goldBtns, errors };
    console.log(name, ok && labelled ? "OK" : "FAIL", JSON.stringify({ failed: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k), note: m.note, signal: m.signal, worst: m.contrast.reduce((a, c) => Math.min(a, c.ratio), 99), errors: errors.slice(0, 2) }));
    await ctx.close();
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* gone */ }
}
fs.writeFileSync(path.join(out, "exp03b-measurements.json"), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
