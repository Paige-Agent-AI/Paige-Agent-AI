// E09 CURA identity, rounds 2–3 — render the customer /app home (chat header, greeting, composer placeholder, the
// "not active" status, the home greeting card and tiles, the notifications prompt) with Cura and with a renamed
// agent "Ava", light and dark, 1440 and 390, and MEASURE each frame: no visible PAIGE, the expected wording on
// screen, AA text contrast against the composited background, no horizontal overflow, no page errors, and the
// HARNESS RENDER tag on screen. HARNESS RENDER ≠ AUTHENTICATED RUNTIME (§32/§70.1).
// Round 3: the home no longer repeats the chat's greeting (said once on screen), and a person whose access is not
// active gets the home's empty state and a Home-only menu (no "Welcome", no Action items or Resources).
//   node scripts/live-drive/harness/portal-chat-identity-mount/identity-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = path.resolve(repo, arg("--out") ?? "scripts/live-drive/artifacts/e09-portal-chat-identity");
fs.mkdirSync(out, { recursive: true });
const PORT = 5251;

const desk = { w: 1440, h: 900, kind: "desktop" }, phone = { w: 390, h: 844, kind: "phone" };
const greet = (a) => `Hi — I’m ${a}, the AI client success agent for Northwind Studio. How can I help?`;
const CASES = [
  { name: "cura", q: "access=ready", agent: "Cura", expect: (v) => [v.phone ? "Message Cura…" : "Ask Cura… (Shift+Enter for new line)", greet("Cura"), "AI client success agent for Northwind Studio", ...(v.phone ? [] : ["Jordan Rivera", "Ask Cura about your next steps."])], absent: ["is here to help"], once: greet("Cura") },
  { name: "ava", q: "access=ready&agent=Ava", agent: "Ava", expect: (v) => [v.phone ? "Message Ava…" : "Ask Ava… (Shift+Enter for new line)", greet("Ava"), "AI client success agent for Northwind Studio", ...(v.phone ? [] : ["Jordan Rivera", "Ask Ava about your next steps.", "Tell Ava what you're working toward. Ava will help you map the path."])], absent: ["is here to help"], once: greet("Ava") },
  // Said once (the chat column), with the one way to get help; the home says what will appear there instead, and
  // the menu offers Home only.
  { name: "inactive", q: "access=inactive", expect: (v) => ["Your access to this portal isn’t active.", "Contact support", ...(v.phone ? [] : ["Nothing is shared with you right now"])], absent: ["Cura", "Ask ", "Set your first goal", "is here to help", "Welcome", "Action items", "Resources", "Messages"], once: "isn’t active" },
  { name: "push-credit", q: "access=ready&agent=Ava&funding=1&push=1", dialog: true, expect: () => ["Get a notification on this device when one of your credit scores changes or a dispute is updated."], absent: ["funding"] },
  { name: "push-none", q: "access=ready&agent=Ava&push=1", noDialog: true, expect: () => [] },
];
const shots = [];
for (const c of CASES) for (const theme of ["light", "dark"]) for (const v of [desk, phone]) {
  if (c.name === "push-none" && (theme === "dark" || v.kind === "phone")) continue;
  shots.push({ ...c, theme, ...v, phone: v.kind === "phone" });
}

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

/** In-page: text contrast of every visible text node's element against its composited background. */
function measure() {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    if (document.documentElement.classList.contains("dark") && !stack.some((c) => c.a >= 1)) base = { r: 0, g: 0, b: 0, a: 1 };
    for (const c of stack.reverse()) base = over(c, base);
    return base;
  };
  const low = []; let min = 99; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement; if (!el || seen.has(el) || !n.textContent.trim()) continue; seen.add(el);
    if (el.closest("[data-harness-tag]")) continue;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || Number(cs.opacity) === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); const col = over(fg, bg);
    const L1 = lum(col), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700; const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    min = Math.min(min, ratio);
    if (ratio < need) low.push(`${n.textContent.trim().slice(0, 40)} ${ratio.toFixed(2)}`);
  }
  const tag = document.querySelector("[data-harness-tag]"); const tr = tag?.getBoundingClientRect();
  const placeholder = document.querySelector("textarea")?.getAttribute("placeholder") ?? null;
  const text = document.body.innerText.replace(/HARNESS RENDER · SYNTHETIC DATA · NOT LIVE/g, "");
  return {
    contrastMin: Math.round(min * 100) / 100, low,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    tag: !!tr && tr.height > 0 && tr.bottom <= innerHeight + 1,
    placeholder, text: text + (placeholder ? `\n${placeholder}` : ""),
    dialog: document.querySelector('[role="dialog"]')?.innerText ?? null,
    paige: /paige/i.test(text + (placeholder ?? "") + [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).join(" ")),
  };
}

const vite = await startVite();
const pw = await resolvePlaywright();
const browser = await pw.chromium.launch(buildLaunchOptions());
const log = [];
let failures = 0;
try {
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.phone ? 2 : 1, colorScheme: s.theme, timezoneId: "America/Chicago" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const file = `e09-chat-identity-${s.name}-${s.theme}-${s.kind}-${s.w}x${s.h}.png`;
    let driveError = null, m = null;
    try {
      await page.goto(`http://127.0.0.1:${PORT}/app?${s.q}&theme=${s.theme}`, { waitUntil: "networkidle" });
      if (s.name === "inactive") await page.getByText("Your access to this portal isn’t active.", { exact: true }).waitFor({ timeout: 30_000 });
      else await page.getByText(greet(s.agent ?? "Ava"), { exact: true }).first().waitFor({ timeout: 30_000 });
      if (s.dialog) await page.getByRole("dialog").waitFor({ timeout: 10_000 });
      else await page.waitForTimeout(2200); // past the prompt's 1.5 s check, so a prompt that should NOT open has had its chance
      m = await page.evaluate(measure);
    } catch (e) { driveError = String(e).slice(0, 300); }
    const missing = m ? s.expect(s).filter((t) => !m.text.includes(t) && !(m.dialog ?? "").includes(t)) : [];
    const present = m ? (s.absent ?? []).filter((t) => (m.dialog ?? m.text).includes(t)) : [];
    const repeats = m && s.once ? m.text.split(s.once).length - 1 : 0;
    const problems = [
      ...(driveError ? [`drive: ${driveError}`] : []),
      ...(m?.paige ? ["visible PAIGE"] : []),
      ...missing.map((t) => `missing: ${t}`), ...present.map((t) => `present: ${t}`),
      ...(repeats > 1 ? [`said ${repeats} times: ${s.once}`] : []),
      ...(m && m.low.length ? [`contrast: ${m.low.join("; ")}`] : []),
      ...(m?.overflowX ? ["horizontal overflow"] : []), ...(m && !m.tag ? ["harness tag not on screen"] : []),
      ...(s.noDialog && m?.dialog ? ["a prompt opened for a business that sends no push"] : []),
      ...errors.map((e) => `pageerror: ${e.slice(0, 160)}`),
    ];
    if (!driveError) await page.screenshot({ path: path.join(out, file) });
    const ok = problems.length === 0; if (!ok) failures++;
    const line = `${file.replace(/\.png$/, "")} ${ok ? "OK" : "FAIL"} ${JSON.stringify({ problems, contrastMin: m?.contrastMin, placeholder: m?.placeholder, dialog: m?.dialog?.replace(/\s+/g, " ").slice(0, 160) ?? null })}`;
    console.log(line); log.push(line);
    await ctx.close();
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* gone */ }
}
fs.writeFileSync(path.join(out, "identity-drive.txt"), log.join("\n") + "\n");
console.log(`\n${shots.length - failures}/${shots.length} OK. Frames in ${path.relative(repo, out)}`);
process.exit(failures ? 1 : 0);
