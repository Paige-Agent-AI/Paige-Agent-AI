// Vibe Studio › a live form › "Put it on your website" (Experience 03), framed and driven.
// Structural harness: the real Vibe Studio, Publish panel and EmbedCode over the stubbed publish door
// (supabase-stub.ts `?publish=`). NOT the live app. It serves itself on STUDIO_HARNESS_PORT (default 5236).
//   node scripts/live-drive/harness/studio-mount/drive-embed-code.mjs [outdir]
// For each frame it checks: the code is shown only for a live form; it is the exact one tag for this form;
// the panel stays on screen and wraps the code with nothing pushed sideways; Copy code is reached by keyboard,
// shows a focus ring, copies the exact tag and says where to paste it; no gold on Copy; text contrast >= 4.5:1.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const PORT = Number(process.env.STUDIO_HARNESS_PORT || 5236);
const base = `http://127.0.0.1:${PORT}/`;
const REPO = path.resolve(import.meta.dirname, "../../../..");
const out = path.resolve(process.argv[2] || path.join(REPO, "scripts/live-drive/artifacts/studio-embed-code"));
fs.mkdirSync(out, { recursive: true });
const VIEWPORTS = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];
const results = [];
const check = (ok, name, detail = "") => { results.push({ ok, name, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  ${detail}` : ""}`); };
const up = () => new Promise((resolve) => { const r = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (s) => { s.resume(); resolve(s.statusCode === 200); }); r.on("error", () => resolve(false)); r.on("timeout", () => { r.destroy(); resolve(false); }); });

const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "scripts/live-drive/harness/studio-mount/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore", detached: true });
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());

async function open(query, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}?${query}`);
  await page.waitForSelector(".vs-home");
  await page.locator(".vs-card", { hasText: "New client intake" }).click();
  await page.waitForSelector(".vs-session");
  await page.waitForFunction(() => document.querySelector(".vs-sheet, .vs-stage-empty"));
  return { ctx, page, errors };
}
async function facts(page) {
  return page.evaluate(() => {
    const pop = document.querySelector(".vs-pop");
    const box = pop.getBoundingClientRect();
    const sec = pop.querySelector(".vs-embed");
    const c = document.createElement("canvas").getContext("2d");
    const rgb = (v) => { c.clearRect(0, 0, 1, 1); c.fillStyle = "#000"; c.fillStyle = v; c.fillRect(0, 0, 1, 1); const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
    const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
    // Composite translucent fills over what is behind them, so the measured ground is what is painted.
    const ground = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) { const x = rgb(getComputedStyle(n).backgroundColor); if (x.a > 0) layers.push(x); if (x.a > 0.99) break; }
      let acc = { r: 0, g: 0, b: 0 };
      for (const l of layers.reverse()) acc = { r: l.r * l.a + acc.r * (1 - l.a), g: l.g * l.a + acc.g * (1 - l.a), b: l.b * l.a + acc.b * (1 - l.a) };
      return acc;
    };
    let worst = { ratio: 99, what: "" };
    for (const el of sec ? sec.querySelectorAll("h3, p, code, button") : []) {
      if (!el.textContent.trim()) continue;
      const [hi, lo] = [lum(rgb(getComputedStyle(el).color)), lum(ground(el))].sort((x, y) => y - x);
      const ratio = (hi + 0.05) / (lo + 0.05);
      if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, what: `${el.tagName}:${el.textContent.trim().slice(0, 30)}` };
    }
    const copy = sec?.querySelector(".vs-btn");
    return {
      shown: Boolean(sec), code: sec?.querySelector(".vs-code")?.textContent ?? null,
      inView: box.left >= 0 && box.right <= innerWidth + 0.5 && box.top >= 0,
      pushed: sec ? [...sec.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > box.right + 1).map((el) => el.className).slice(0, 3) : [],
      docOverflowX: document.documentElement.scrollWidth - innerWidth, contrast: worst,
      goldCopy: copy ? /gold/.test(copy.className) : false,
    };
  });
}

try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await up(); if (!ready) await new Promise((r) => setTimeout(r, 500)); }
  if (!ready) throw new Error("Studio harness did not start.");
  // The harness runs on 127.0.0.1, not a Paige host, so the code points at the public host (embed-code.ts embedOrigin).
  const expected = `<script src="https://paigeagent.ai/embed.js" data-form="f-1" data-title="New client intake" data-cfasync="false" async></script>`;
  const expectedFrame = `<iframe src="https://paigeagent.ai/form/f-1?embed=1" title="New client intake" loading="lazy" style="width:100%;height:720px;border:0;color-scheme:normal"></iframe>`;
  for (const theme of ["light", "dark"]) {
    for (const [w, h] of VIEWPORTS) {
      const id = `${theme}/${w}x${h}`;
      // A draft: publishing it shows "It's live" with the code; before that, no code.
      {
        const { ctx, page, errors } = await open(`theme=${theme}`, w, h);
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await page.waitForSelector(".vs-pop");
        await page.waitForFunction(() => !document.querySelector(".vs-checks-skel"));
        check(!(await facts(page)).shown, `${id}: a draft offers no website code`);
        await page.getByRole("button", { name: "Publish now" }).click();
        await page.waitForSelector(".vs-pop h2:text(\"It's live\")");
        await page.waitForTimeout(150);
        const f = await facts(page);
        check(f.shown && f.code === expected, `${id}: "It's live" hands over the one tag for this form`, f.code ?? "");
        check(f.inView && f.pushed.length === 0 && f.docOverflowX <= 0, `${id}: the panel stays on screen and the code wraps inside it`, JSON.stringify(f));
        check(f.contrast.ratio >= 4.5, `${id}: embed text contrast >= 4.5:1 (worst ${f.contrast.ratio})`, f.contrast.what);
        check(!f.goldCopy, `${id}: Copy code is not gold (publishing was the act)`);
        await page.screenshot({ path: path.join(out, `${theme}-${w}x${h}-its-live.png`) });
        check(errors.length === 0, `${id}: no page error`, JSON.stringify(errors));
        await ctx.close();
      }
      // A live form, reopened: the code is still there; copy it by keyboard.
      {
        const { ctx, page, errors } = await open(`theme=${theme}&publish=live`, w, h);
        await page.getByRole("button", { name: "Live · Manage" }).click();
        await page.waitForSelector(".vs-pop h2:text(\"This is live\")");
        await page.waitForTimeout(250);
        const f = await facts(page);
        check(f.shown && f.code === expected && f.inView && f.pushed.length === 0, `${id}: a live form keeps its code in reach`, JSON.stringify(f));
        const copy = page.locator(".vs-embed .vs-btn");
        await page.locator(".vs-code").focus();
        await page.keyboard.press("Tab");
        await page.waitForTimeout(200);
        const ring = await copy.evaluate((el) => ({ focused: document.activeElement === el, style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth), shadow: getComputedStyle(el).boxShadow }));
        check(ring.focused && ((ring.style !== "none" && ring.width >= 2) || ring.shadow !== "none"), `${id}: Copy code is reached by Tab and shows its focus`, JSON.stringify(ring));
        await page.keyboard.press("Enter");
        await page.waitForSelector(".vs-embed button:text('Copied')");
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        const said = await page.locator(".vs-embed [role=status]").innerText();
        check(clip === expected && said === "Paste it into your site's page editor.", `${id}: Copy puts the exact tag on the clipboard and says where to paste it`, JSON.stringify({ clip, said }));
        await page.screenshot({ path: path.join(out, `${theme}-${w}x${h}-live-copied.png`) });
        // A site that won't run a script tag: the frame on its own, said plainly, and back again.
        await page.getByRole("button", { name: "Get a version without a script" }).click();
        await page.waitForTimeout(150);
        const nf = await facts(page);
        const caveat = await page.locator(".vs-embed").innerText();
        check(nf.code === expectedFrame && /can't resize to fit the form or carry your campaign links' tags/.test(caveat), `${id}: the no-script version is the form's frame, with what it can't do said`, nf.code ?? "");
        check(nf.inView && nf.pushed.length === 0 && nf.docOverflowX <= 0 && nf.contrast.ratio >= 4.5, `${id}: the no-script version stays on screen, wraps, contrast >= 4.5:1 (worst ${nf.contrast.ratio})`, JSON.stringify(nf));
        await copy.click();
        const clipFrame = await page.evaluate(() => navigator.clipboard.readText());
        check(clipFrame === expectedFrame, `${id}: Copy copies the version shown`, clipFrame);
        await page.screenshot({ path: path.join(out, `${theme}-${w}x${h}-no-script.png`) });
        await page.getByRole("button", { name: "Use the first code" }).click();
        check((await facts(page)).code === expected, `${id}: back to the one-line code`);
        check(errors.length === 0, `${id}: no page error (live)`, JSON.stringify(errors));
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  try { process.kill(-vite.pid, "SIGKILL"); } catch { /* gone */ }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Frames: ${out}`);
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
