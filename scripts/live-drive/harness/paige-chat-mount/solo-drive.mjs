// C3a — drive the Solo PAIGE chat harness (solo.html) through every in-scope turn state and record
// MEASUREMENTS, not just pictures: horizontal overflow, the focus ring's computed colour, status-text
// contrast, gold on anything but the act, the sweep under reduced motion, the announcer log, and the
// absence of chain-of-thought and of any C4 "resume" language.
//
//   node scripts/live-drive/harness/paige-chat-mount/solo-drive.mjs [--only name,name] [--out dir]
//
// Starts its own Vite (the sandbox reaps backgrounded servers between shells), labels every frame
// "harness render · not live" ON the image after measuring, and writes results.json beside the PNGs.
// HARNESS RENDER ≠ AUTHENTICATED RUNTIME: this proves the real component renders the scripted wire;
// it cannot prove the deployed, signed-in app (§32/§70.1 — owed).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const only = arg("--only")?.split(",") ?? null;
const out = path.resolve(repo, arg("--out") ?? "docs/evidence/ui-delivery/assets/c3-living-response");
fs.mkdirSync(out, { recursive: true });
const PORT = 5213;
const BASE = `http://127.0.0.1:${PORT}/solo.html`;

const PROMPTS = {
  fast: "Give me a subject line for Daniel's renewal note",
  normal: "Who hasn't heard from us in two weeks?",
  research: "Why do project-management rollouts stall at small architecture firms?",
  approval: "Send the renewal proposal to Daniel Reyes.",
  limit: "Check every client's notes against their goals.",
  interrupted: "Check every client's goals.",
  stop: "Who hasn't heard from us in two weeks?",
  refused: "Pull up Maya Okafor's session history.",
};
const VIEWPORTS = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];

/** One render. */
function shot(name, o) { return { name, ...o }; }
const shots = [];
for (const [w, h] of VIEWPORTS) for (const layout of ["page", "drawer"]) for (const theme of ["light", "dark"]) {
  shots.push(shot(`matrix-normal-${layout}-${theme}-${w}x${h}`, { scenario: "normal", layout, theme, w, h, after: ["openTrace"] }));
  shots.push(shot(`matrix-approval-${layout}-${theme}-${w}x${h}`, { scenario: "approval", layout, theme, w, h }));
}
for (const theme of ["light", "dark"]) {
  const s = (name, o) => shots.push(shot(`${name}-${theme}`, { layout: "page", theme, w: 1366, h: 768, ...o }));
  s("f1-fast-first-400ms", { scenario: "fast", hold: 1, waitMs: 150 });
  s("f2-fast-thinking", { scenario: "fast", hold: 1, waitMs: 1300 });
  s("f4-fast-settled", { scenario: "fast" });
  s("n2-normal-first-step", { scenario: "normal", hold: 4 });
  s("n3-normal-steps-open", { scenario: "normal", hold: 6, after: ["openTrace"] });
  s("n4-normal-step-error-open", { scenario: "normal", hold: 9, after: ["openTrace"] });
  // Held after the first answer chunk (the scripted waits before it add up to ~4.2 s), so the frame
  // waits for the line to SAY "Writing" rather than guessing a time — the earlier fixed 2.6 s wait
  // captured "Thinking" and the record claimed a frame it did not show.
  s("n5-normal-writing", { scenario: "normal", hold: 14, untilLine: "Writing the answer" });
  s("n6-normal-done-open", { scenario: "normal", after: ["openTrace"] });
  s("r1-research-running", { scenario: "research", hold: 3 });
  s("r2-research-still", { scenario: "research", hold: 3, waitMs: 11500 });
  s("r3-research-done", { scenario: "research" });
  // hold=5 stops on the RUNNING "Drafting the cover note" step (hold=6 already included its "done").
  s("a1-approval-preparing", { scenario: "approval", hold: 5, untilLine: "Drafting the cover note" });
  s("a2-approval-waiting", { scenario: "approval" });
  s("a3a4-approval-approved", { scenario: "approval", after: ["approve"] });
  s("a5-approval-declined", { scenario: "approval", after: ["decline"] });
  s("l1-limit-working-open", { scenario: "limit", hold: 12, after: ["openTrace"] });
  s("l2-limit-reached-open", { scenario: "limit", after: ["openTrace"] });
  s("l5-interrupted", { scenario: "interrupted" });
  s("s2-stopped-by-you", { scenario: "stop", waitMs: 1600, after: ["stop", "see"] });
  s("h2-refused", { scenario: "refused" });
  s("o1-reload", { scenario: "reload", noSend: true, after: ["openFirstTrace"] });
  s("e1-first-use", { scenario: "first", noSend: true });
  s("rm-n2-reduced-motion", { scenario: "normal", hold: 4, reduce: true });
  s("kbd-focus-line", { scenario: "normal", after: ["tabToLine"] });
  s("zoom200-n6", { scenario: "normal", w: 683, h: 384, dpr: 2, after: ["openTrace"] });
  s("zoom200-a2", { scenario: "approval", w: 683, h: 384, dpr: 2 });
  s("reflow320-n6", { scenario: "normal", w: 320, h: 720, after: ["openTrace"] });
  s("phone390-sheet", { scenario: "normal", w: 390, h: 844, after: ["openTrace"] });
  s("drawer-a3a4-approved", { scenario: "approval", layout: "drawer", after: ["approve"] });
  s("drawer-a5-declined-focus", { scenario: "approval", layout: "drawer", after: ["declineKbd"] });
  s("a5-approval-declined-kbd", { scenario: "approval", after: ["declineKbd"] });
  s("drawer-n6-open-in-view", { scenario: "normal", layout: "drawer", w: 1024, h: 768, after: ["openTraceInPlace"] });
  s("drawer-a2-open-in-view", { scenario: "approval", layout: "drawer", w: 1024, h: 768, after: ["openTraceInPlace"] });
}

const selected = only ? shots.filter((s) => only.some((o) => s.name.includes(o))) : shots;

function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["vite", "--config", path.join(here, "solo.vite.config.ts")], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const onData = (d) => { log += d; if (/ready in/.test(log)) resolve(child); };
    child.stdout.on("data", onData);
    child.stderr.on("data", (d) => { log += d; });
    child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
    setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 60_000);
  });
}

// Runs in the page: every measurement the evidence record cites.
const MEASURE = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) stack.push(c); } let acc = { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i -= 1) acc = blend(stack[i], acc); return acc; };
  const hsl = ({ r, g, b }) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = (mx + mn) / 2; if (mx === mn) return { h: 0, s: 0, l }; const d = mx - mn; const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: h * 60, s, l }; };
  const isGold = (c) => { if (!c || c.a < 0.3) return false; const x = hsl(c); return x.h >= 28 && x.h <= 52 && x.s >= 0.35 && x.l >= 0.25 && x.l <= 0.93; };
  const doc = document.scrollingElement;
  const transcript = document.querySelector('[data-paige-transcript-scroll]');
  const lines = Array.from(document.querySelectorAll("[data-paige-turn-line]"));
  const contrast = lines.map((l) => { const t = l.querySelector(".ptl-text"); const meta = l.querySelector(".ptl-meta"); const g = l.querySelector(".ptl-glyph"); const bg = bgOf(l); return {
    kind: l.dataset.kind, text: t?.textContent,
    textRatio: t ? +ratio(parse(getComputedStyle(t).color) ?? parse(getComputedStyle(l.querySelector(".ptl-row")).color), bg).toFixed(2) : null,
    metaRatio: meta ? +ratio(parse(getComputedStyle(meta).color), bg).toFixed(2) : null,
    glyphRatio: g && g.firstElementChild ? +ratio(parse(getComputedStyle(g).color), bg).toFixed(2) : null,
  }; });
  const gold = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const props = [["color", cs.color, el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())], ["background", cs.backgroundColor, true], ["bgimage", cs.backgroundImage.includes("gradient") ? (cs.backgroundImage.match(/rgba?\([^)]+\)/) ?? [""])[0] : "", true], ["border", cs.borderTopWidth !== "0px" ? cs.borderTopColor : "", true], ["outline", cs.outlineStyle !== "none" ? cs.outlineColor : "", true], ["fill", el.tagName === "svg" || el.closest("svg") ? cs.color : "", el.tagName === "svg"]];
    for (const [k, v, applies] of props) if (applies && v && isGold(parse(v))) { gold.push({ prop: k, value: v, tag: el.tagName.toLowerCase(), label: (el.closest("button")?.getAttribute("aria-label") || el.closest("button")?.textContent || el.textContent || "").trim().slice(0, 40) }); break; }
  }
  const sweeps = Array.from(document.querySelectorAll("[data-sweep]")).map((s) => getComputedStyle(s).animationName);
  const active = document.activeElement;
  const focus = active && active !== document.body ? { tag: active.tagName.toLowerCase(), cls: String(active.className).slice(0, 60), outline: getComputedStyle(active).outlineColor, outlineStyle: getComputedStyle(active).outlineStyle, ratio: +ratio(parse(getComputedStyle(active).outlineColor), bgOf(active)).toFixed(2) } : null;
  const text = document.body.innerText;
  return {
    overflow: { doc: doc.scrollWidth > doc.clientWidth, transcript: transcript ? transcript.scrollWidth > transcript.clientWidth : null },
    lines: contrast, gold, sweeps, focus,
    // Every visible step row in an open "What PAIGE did": its label and its meta (department ·
    // detail), measured on the bubble they sit on. The earlier drive measured only the line itself
    // and missed a meta tint under AA.
    steps: Array.from(document.querySelectorAll("[data-paige-turn-step]")).filter((r) => r.getBoundingClientRect().height > 0 && getComputedStyle(r).visibility !== "hidden").map((r) => {
      const bg = bgOf(r);
      const t = r.querySelector(".ptl-step-text"); const meta = r.querySelector(".ptl-step-meta");
      return { status: r.dataset.status, textRatio: t ? +ratio(parse(getComputedStyle(t).color), bg).toFixed(2) : null, metaRatio: meta ? +ratio(parse(getComputedStyle(meta).color), bg).toFixed(2) : null };
    }),
    footer: document.querySelector("[data-paige-turn-footer] p")?.textContent ?? null,
    cardResult: document.querySelector("[data-paige-card-result]")?.textContent ?? null,
    announcer: window.__announced ?? [],
    cot: /NOT-SHOWN-REASONING|Thought process/i.test(text),
    c4Language: /resum|pick(ing)? (this|it) back up|keep going|same answer/i.test(text),
    syntheticBubble: /Approved — run it\.|Hold off — skip that one\./.test(text),
  };
};

async function run() {
  const vite = await startVite();
  const { chromium } = await resolvePlaywright();
  const browser = await chromium.launch(buildLaunchOptions());
  const results = {};
  try {
    for (const s of selected) {
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr ?? 1, reducedMotion: s.reduce ? "reduce" : "no-preference", colorScheme: s.theme });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const q = new URLSearchParams({ scenario: s.scenario, theme: s.theme, layout: s.layout, ...(s.hold !== undefined ? { hold: String(s.hold) } : {}) });
      await page.goto(`${BASE}?${q}`);
      await page.waitForSelector("textarea", { timeout: 30_000 });
      // Record every announcement the live region makes (a change of state, never a step).
      await page.evaluate(() => {
        window.__announced = [];
        new MutationObserver(() => {
          for (const n of document.querySelectorAll("[data-paige-turn-announcer]")) {
            const t = n.textContent; if (t && window.__announced.at(-1) !== t) window.__announced.push(t);
          }
        }).observe(document.body, { subtree: true, childList: true, characterData: true });
      });
      await page.waitForTimeout(600);
      if (!s.noSend) {
        await page.locator("textarea").fill(PROMPTS[s.scenario]);
        await page.keyboard.press("Enter");
      }
      if (s.untilLine) {
        await page.waitForFunction((t) => Array.from(document.querySelectorAll("[data-paige-turn-line] .ptl-text")).some((n) => n.textContent === t), s.untilLine, { timeout: 12_000 });
        await page.waitForTimeout(200);
      } else {
        await page.waitForTimeout(s.waitMs ?? (s.hold !== undefined ? 2600 : 5200));
      }
      let toggleInView = null;
      for (const a of s.after ?? []) {
        if (a === "openTrace" || a === "openFirstTrace") {
          const btn = page.locator("[data-paige-turn-line] button.ptl-row").nth(a === "openFirstTrace" ? 0 : -1);
          if (await btn.count()) {
            await btn.click();
            await page.waitForTimeout(450);
            // Bring the opened answer's line to the top of the frame so the trace is in the picture.
            await btn.evaluate((el) => el.scrollIntoView({ block: "start" }));
            await page.waitForTimeout(150);
          }
        }
        if (a === "openTraceInPlace") {
          // S1: open the trace with the keyboard, exactly as a person would, and measure whether
          // the line they pressed is still inside the transcript viewport once it has grown. No
          // framing scroll afterwards — the picture is what the person sees.
          const btn = page.locator("[data-paige-turn-line] button.ptl-row").last();
          if (await btn.count()) {
            const inView = () => btn.evaluate((el) => {
              const sc = el.closest("[data-paige-transcript-scroll]"); const a = el.getBoundingClientRect(); const b = sc.getBoundingClientRect();
              return { inView: a.top >= b.top - 1 && a.bottom <= b.bottom + 1, top: Math.round(a.top - b.top), height: Math.round(b.height), scrollTop: Math.round(sc.scrollTop) };
            });
            // As a person would: scroll the transcript (wheel) until the line shows, then press it.
            const start = await inView();
            if (!start.inView) {
              const box = await page.locator("[data-paige-transcript-scroll]").boundingBox();
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.mouse.wheel(0, start.top - 48);
              await page.waitForTimeout(400);
            }
            const before = await inView();
            await btn.click();
            await page.waitForTimeout(500);
            const after = await inView();
            console.log("toggle", JSON.stringify({ before, after }));
            toggleInView = before.inView ? after.inView : null;
          }
        }
        if (a === "approve") { await page.getByRole("button", { name: /^Approve/ }).first().click(); await page.waitForTimeout(4200); }
        if (a === "declineKbd") {
          // Keyboard: focus "Not now" and press Enter — the button disappears with the card, and focus
          // must land on the record that replaced it, drawn with the indigo ring.
          await page.getByRole("button", { name: /Not now/ }).first().focus();
          await page.keyboard.press("Enter");
          await page.waitForTimeout(2400);
        }
        if (a === "decline") { await page.getByRole("button", { name: /Not now/ }).first().click(); await page.waitForTimeout(2400); }
        if (a === "stop") { await page.getByRole("button", { name: "Cancel PAIGE response" }).click(); await page.waitForTimeout(600); }
        if (a === "see") { await page.getByRole("button", { name: "See what finished" }).click(); await page.waitForTimeout(450); }
        if (a === "tabToLine") {
          await page.locator("textarea").focus();
          for (let i = 0; i < 60; i += 1) {
            await page.keyboard.press("Shift+Tab");
            if (await page.evaluate(() => !!document.activeElement?.closest("[data-paige-turn-line]"))) break;
          }
          await page.waitForTimeout(200);
        }
      }
      const m = await page.evaluate(MEASURE);
      m.pageErrors = errors;
      m.toggleInView = toggleInView;
      // The label goes on AFTER measuring, so it cannot influence what was measured.
      await page.evaluate((label) => {
        const tag = document.createElement("div");
        tag.textContent = label;
        tag.setAttribute("style", "position:fixed;right:8px;bottom:8px;z-index:99999;font:600 11px/1.2 system-ui;padding:4px 7px;border-radius:6px;background:rgba(20,18,24,.82);color:#fff;pointer-events:none");
        document.body.appendChild(tag);
      }, `harness render · not live · ${s.name}`);
      await page.screenshot({ path: path.join(out, `${s.name}.png`) });
      results[s.name] = { ...s, measured: m };
      const minStep = m.steps.length ? Math.min(...m.steps.flatMap((x) => [x.textRatio, x.metaRatio].filter((v) => v !== null))) : null;
      const flags = [minStep !== null && minStep < 4.5 && `STEP-CONTRAST:${minStep}`, toggleInView === false && "LINE-OUT-OF-VIEW", m.overflow.doc && "DOC-OVERFLOW", m.overflow.transcript && "TRANSCRIPT-OVERFLOW", m.cot && "COT", m.c4Language && "C4-LANGUAGE", m.syntheticBubble && "SYNTHETIC-BUBBLE", errors.length && `ERRORS:${errors.length}`].filter(Boolean);
      console.log(`${s.name}: lines=${m.lines.map((l) => `${l.kind}:${l.text}`).join(" | ")} gold=${m.gold.map((g) => `${g.prop}@${g.label}`).join(",") || "none"} ${flags.join(" ")}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    // npx forks vite: end the whole process group, or the pipes keep this process alive.
    try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
  // An --only run updates its own entries and keeps the rest of the record.
  const file = path.join(out, "results.json");
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  fs.writeFileSync(file, JSON.stringify({ ...prior, ...results }, null, 1));
}

run().catch((e) => { console.error(e); process.exit(1); });
