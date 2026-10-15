import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright";
import assert from "node:assert/strict";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(project, process.argv[2] ?? ".impeccable/review/e09-portal-config");
await fs.mkdir(output, { recursive: true });
const adapter = path.join(project, "scripts/proof/e09-portal-config-ui/adapter.tsx");
const result = await build({
  entryPoints: [path.join(project, "scripts/proof/e09-portal-config-ui/source.tsx")],
  bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "proof-only-sdk", setup(buildApi) {
    buildApi.onResolve({ filter: /^@\/(hooks\/useTenantContext|integrations\/supabase\/client)$/ }, () => ({ path: adapter }));
  } }],
});
const files = ["src/index.css", "src/components/tenant-relationships/tenant-relationships-clients-workspace.css", "src/components/tenant-relationships/PortalConfigurationGate.tsx"];
const contents = await Promise.all(files.map((file) => fs.readFile(path.join(project, file), "utf8")));
const options = { headless: true };
try { await fs.access(chromium.executablePath()); } catch { options.executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe"; }
const browser = await chromium.launch(options);
const cases = [];
const errors = [];
try {
  for (const [width, height] of [[1536, 770], [1366, 768], [1024, 768], [900, 1000], [390, 844]]) {
    for (const open of [false, true]) {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) => route.abort());
        const availableWidth = width < 620 ? width - 32 : Math.max(280, width - 264 - (open ? 420 : 0) - 48);
        await page.setContent(`<html data-pg="${theme}"><head></head><body><main id="root" style="width:${availableWidth}px;margin:16px"></main></body></html>`);
        await page.addStyleTag({ content: contents[0] + "\n" + contents[1] + "\nbody{margin:0;background:var(--pg-canvas);color:var(--pg-ink);font-family:var(--pg-font-ui)}.proof-note{font-size:12px;color:var(--pg-muted);margin:16px 0 8px}article{margin-bottom:16px}#root{max-width:calc(100% - 32px)}" });
        await page.addScriptTag({ content: result.outputFiles[0].text });
        await page.locator("[data-editor-sentinel]").waitFor();
        await page.getByRole("button", { name: "Retry access check" }).waitFor();
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          hiddenText: [...document.querySelectorAll(".trc-state h2,.trc-state p,.trc-state button")].some((node) => node.scrollWidth > node.clientWidth + 1),
          error: document.querySelector('[data-proof-state="error"] [role="alert"]') !== null,
          waiting: document.querySelector('[data-proof-state="checking"] [aria-busy="true"]') !== null,
          deniedMounts: document.querySelectorAll('[data-proof-state="denied"] [data-editor-sentinel]').length,
          allowedMounts: document.querySelectorAll('[data-proof-state="allowed"] [data-editor-sentinel]').length,
        }));
        assert.equal(geometry.overflow, false); assert.equal(geometry.hiddenText, false);
        assert.equal(geometry.error, true); assert.equal(geometry.waiting, true);
        assert.equal(geometry.deniedMounts, 0); assert.equal(geometry.allowedMounts, 1);
        const retry = page.getByRole("button", { name: "Retry access check" });
        await page.keyboard.press("Tab"); assert.equal(await retry.evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press("Enter");
        await page.getByRole("alert").waitFor();
        assert.equal(await retry.evaluate((node) => node === document.activeElement), true);
        const name = `${width}-${open ? "narrow" : "wide"}-${theme}.png`;
        await page.screenshot({ path: path.join(output, name), fullPage: true });
        cases.push({ width, height, reservedPanelWidth: open ? 420 : 0, availableWidth, theme, reducedMotion: true, geometry, screenshot: name });
        await page.close();
      }
    }
  }
  assert.equal(errors.length, 0);
} finally { await browser.close(); }
const proof = { source: files.map((file, i) => ({ file, sha256: createHash("sha256").update(contents[i]).digest("hex") })), cases, errors,
  boundary: "Actual gate source and incumbent CSS in isolated synthetic browser documents. Width reservations exercise the component; they are not the real Solo shell or authenticated tenant proof. No server, user preview tab, production endpoint, credential or business operation was accessed." };
await fs.writeFile(path.join(output, "result.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ cases: cases.length, errors, output, boundary: proof.boundary }));
