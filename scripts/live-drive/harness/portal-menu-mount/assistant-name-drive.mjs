// E09 CURA round 2 (verifier §58 #9): the owner's Customer agent card, in the real PortalStudio as Solo's Clients →
// Portal mounts it, when the saved agent name includes PAIGE ("Paige Assistant") and when the owner types one
// ("AskPaige"). Asserts the card explains why clients see Cura, and measures the notice's contrast. Solo sizes,
// both themes. The Solo shell's PAIGE dock is a hidden placeholder here (data-paige="closed"): PAIGE-open frames
// are not produced. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE.
//   node scripts/live-drive/harness/portal-menu-mount/assistant-name-drive.mjs [--out dir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolvePlaywright } from "../../live-drive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const argv = process.argv.slice(2);
const out = path.resolve(repo, argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "scripts/live-drive/artifacts/e09-owner-agent-name");
fs.mkdirSync(out, { recursive: true });
const PORT = 5246;
const SIZES = [[1536, 770], [1366, 768], [1024, 768], [900, 1000]];
const SAVED = "Your saved name “Paige Assistant” reads like Paige, so clients see “Cura”. Paige is your own assistant; your clients’ agent has its own name.";
const TYPED = "Clients will see “Cura”. A name that reads like Paige stays with your own assistant, so the portal uses Cura instead.";

const vite = await new Promise((resolve, reject) => {
  const child = spawn("npx", ["vite", "--config", path.join(here, "vite.config.ts"), "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  const onData = (d) => { log += String(d); if (log.includes("Local:") || log.includes("ready in")) resolve(child); };
  child.stdout.on("data", onData); child.stderr.on("data", onData);
  child.on("exit", (code) => reject(new Error(`vite exited ${code}: ${log}`)));
  setTimeout(() => reject(new Error(`vite did not start: ${log}`)), 120_000);
});
const pw = await resolvePlaywright();
const browser = await pw.chromium.launch(buildLaunchOptions());
const shots = [];
for (const theme of ["light", "dark"]) for (const [w, h] of SIZES) shots.push({ theme, w, h, typed: false });
shots.push({ theme: "light", w: 1366, h: 768, typed: true });
const lines = []; let failures = 0;
try {
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, colorScheme: s.theme });
    await ctx.addInitScript(() => sessionStorage.setItem("e09-portal-menu-harness:portal_config", JSON.stringify({ modules: [], assistant: { display_name: "Paige Assistant" } })));
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    const name = `e09-owner-agent-name-${s.typed ? "typed" : "saved"}-${s.theme}-${s.w}x${s.h}`;
    const problems = [];
    try {
      await page.goto(`http://127.0.0.1:${PORT}/solo/1234567/clients/portal?view=owner&variant=stored&theme=${s.theme}`, { timeout: 180_000 });
      const input = page.getByLabel("Agent name");
      await input.waitFor({ timeout: 60_000 });
      if (s.typed) await input.fill("AskPaige");
      const notice = page.locator('[data-testid="agent-name-notice"]');
      await notice.scrollIntoViewIfNeeded();
      const text = (await notice.innerText()).trim();
      if (text !== (s.typed ? TYPED : SAVED)) problems.push(`notice "${text}"`);
      if (!s.typed && (await input.inputValue()) !== "Cura") problems.push(`field shows "${await input.inputValue()}"`);
      const ratio = await notice.evaluate((el) => {
        const p = (c) => c.match(/[\d.]+/g).map(Number);
        const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        let bg = null; for (let e = el; e && !bg; e = e.parentElement) { const c = p(getComputedStyle(e).backgroundColor); if (c.length < 4 || c[3] > 0.99) if (c[3] !== 0) bg = c; }
        bg = bg ?? (document.documentElement.classList.contains("dark") ? [0, 0, 0] : [255, 255, 255]);
        const fg = p(getComputedStyle(el).color); const a = fg[3] ?? 1;
        const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
        const L1 = lum(mix), L2 = lum(bg); return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
      });
      if (ratio < 4.5) problems.push(`notice contrast ${ratio}`);
      const box = await page.locator("fieldset[aria-label='Customer agent settings']").boundingBox();
      if (box) await page.screenshot({ path: path.join(out, `${name}.png`), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 72), width: Math.min(s.w - Math.max(0, box.x - 16), box.width + 32), height: Math.min(s.h, box.height + 120) } });
      else await page.screenshot({ path: path.join(out, `${name}.png`) });
      lines.push(`${name} ${problems.length || errors.length ? "FAIL" : "OK"} ${JSON.stringify({ problems, contrast: ratio, errors: errors.slice(0, 2) })}`);
    } catch (e) { problems.push(String(e).slice(0, 200)); lines.push(`${name} FAIL ${JSON.stringify({ problems, errors })}`); }
    if (problems.length || errors.length) failures++;
    console.log(lines.at(-1));
    await ctx.close();
  }
} finally { await browser.close(); try { process.kill(-vite.pid); } catch { /* gone */ } }
fs.writeFileSync(path.join(out, "assistant-name-drive.txt"), lines.join("\n") + "\n");
console.log(`\n${shots.length - failures}/${shots.length} OK`);
process.exit(failures ? 1 : 0);
