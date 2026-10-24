// EXP07 row 6 — templates, driven on the studio-mount harness:
// (1) a project's "Save as template" runs the governed setter (p_is_template true, p_tenant_id NULL —
//     the browser never names a tenant), the button flips to "Saved as template", the notice says
//     what moved, and the project leaves Drafts / appears as a template (the stub's filter proves the
//     list honours is_template);
// (2) Studio home's "Start from a template" lists the saved template and starts a NEW project whose
//     first chat message is the template's brief, verbatim (window.__chatBodies);
// (3) with no templates saved, the section stays hidden.
// Four Solo viewports × PAIGE closed/open for the templated project. Harness render — NOT live.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../..");
const outDir = path.join(root, "docs/evidence/ui-delivery/assets/exp07-template");
mkdirSync(outDir, { recursive: true });
const port = Number(process.env.EXP07_TEMPLATE_PORT || 5227);
const base = `http://127.0.0.1:${port}/`;

const vite = spawn("npx", ["vite", "--config", "scripts/live-drive/harness/studio-mount/vite.config.ts"], {
  cwd: root, shell: true, stdio: "pipe",
  env: { ...process.env, STUDIO_HARNESS_PORT: String(port) },
});
await new Promise((resolve, reject) => {
  let buf = "";
  const clean = () => buf.replace(/\x1b\[[0-9;]*m/g, "");
  vite.stdout.on("data", (d) => { buf += d; if (clean().includes(`:${port}`)) resolve(); });
  vite.stderr.on("data", (d) => { buf += d; });
  setTimeout(() => reject(new Error(`vite boot timeout: ${clean().slice(-400)}`)), 120_000);
});

const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE_PATH || undefined });
const errors = [];
const results = [];
const note = (ok, name, detail = "") => { results.push({ ok, name, detail }); if (!ok) console.log(`FAIL  ${name}  ${detail}`); };

async function label(page) {
  await page.evaluate(() => {
    const tag = document.createElement("div");
    tag.textContent = "harness render · not live";
    Object.assign(tag.style, { position: "fixed", right: "10px", bottom: "8px", zIndex: "9999", padding: "2px 8px", borderRadius: "999px", font: "600 11px system-ui", color: "#fff", background: "rgba(101,90,150,.9)" });
    document.body.append(tag);
  });
}
async function shoot(page, name) { await label(page); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); }
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const studioCalls = (page) => page.evaluate(() => window.__studioCalls ?? []);
const chatBodies = (page) => page.evaluate(() => window.__chatBodies ?? []);

// ── The 8 Solo frames: a project saved as a template ──
for (const [w, h] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000]]) {
  for (const paige of ["closed", "open"]) {
    const name = `solo-${w}x${h}-paige-${paige}`;
    const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    try {
      await page.goto(`${base}?theme=light&paige=${paige}`, { timeout: 120_000, waitUntil: "domcontentloaded" });
      await page.waitForSelector(".vs-home", { timeout: 60_000 });
      await page.locator(".vs-card", { hasText: "New client intake" }).click();
      await page.waitForSelector(".vs-session", { timeout: 30_000 });
      await page.waitForSelector("button:has-text('Save as template')", { timeout: 30_000 });
      await page.click("button:has-text('Save as template')");
      await page.waitForSelector("button:has-text('Saved as template')", { timeout: 30_000 });
      await page.waitForTimeout(300);
      const calls = await studioCalls(page);
      const setCall = calls.filter((c) => c.fn === "set_studio_session_template").pop();
      note(Boolean(setCall) && setCall.args.p_is_template === true && setCall.args.p_tenant_id === null,
        `${name} the governed setter ran (is_template true, tenant never named by the browser)`, JSON.stringify(setCall?.args ?? null));
      const bodyText = await page.locator("body").innerText();
      note(bodyText.includes("Saved as a workspace template"), `${name} the notice says what moved`);
      const ox = await overflow(page);
      note(ox <= 0, `${name} no horizontal overflow`, `overflowX=${ox}`);
      await shoot(page, name);
    } catch (e) {
      note(false, `${name} flow completed`, String(e).slice(0, 200));
    }
    await page.close();
  }
}

// ── Home: the template section starts a new project from the template's brief ──
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => errors.push(`home: ${e}`));
  await page.goto(`${base}?theme=light`, { timeout: 120_000, waitUntil: "domcontentloaded" });
  await page.waitForSelector(".vs-home", { timeout: 60_000 });
  const section = page.locator('section[aria-label="Start from a template"]');
  note(await section.count() === 1, "the template section is present on Studio home");
  note((await section.innerText()).includes("Workshop page template"), "the saved template is listed");
  note((await page.locator(".vs-card", { hasText: "Workshop page template" }).first().innerText()).includes("Starts a new project from this brief"), "template card carries the starts-a-project note",
    await page.locator(".vs-card", { hasText: "Workshop page template" }).first().innerText());
  await shoot(page, "home-template-section-1366x768");
  await page.locator(".vs-card", { hasText: "Workshop page template" }).click();
  await page.waitForSelector(".vs-session", { timeout: 30_000 });
  await page.waitForTimeout(500);
  const bodies = await chatBodies(page);
  const first = bodies[0]?.messages?.[0]?.content ?? "";
  note(first === "A landing page for my referral workshop", "the new project's first message is the template's brief, verbatim", JSON.stringify(first).slice(0, 140));
  const calls = await studioCalls(page);
  note(!calls.some((c) => c.fn === "set_studio_session_template"), "starting from a template never calls the setter (the template is untouched)",
    JSON.stringify(calls.filter((c) => c.fn === "set_studio_session_template")));
  await shoot(page, "template-started-session-1366x768");
  await page.close();
}

// ── The empty state: no templates saved → no section ──
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  await page.goto(`${base}?theme=light&templates=0`, { timeout: 120_000, waitUntil: "domcontentloaded" });
  await page.waitForSelector(".vs-home", { timeout: 60_000 });
  note(await page.locator('section[aria-label="Start from a template"]').count() === 0, "no templates saved: the section stays hidden");
  await shoot(page, "home-no-templates-1366x768");
  await page.close();
}

await browser.close();
try { vite.kill(); } catch { /* ignore */ }
try { process.platform === "win32" && spawn("taskkill", ["/F", "/T", "/PID", String(vite.pid)], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }

const passed = results.filter((r) => r.ok).length;
writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ results, pageErrors: errors }, null, 2));
console.log(`${passed}/${results.length} checks passed${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}; captures in ${outDir}`);
process.exit(passed < results.length || errors.length ? 1 : 0);
