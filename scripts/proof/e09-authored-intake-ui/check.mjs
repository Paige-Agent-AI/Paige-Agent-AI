import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.join(root, "docs/evidence/ui-delivery/assets/e09-authored-empty-intake");
await fs.mkdir(output, { recursive: true });
const fixture = path.join(root, "scripts/proof/e09-authored-intake-ui/adapter.ts");
const bundle = await build({ entryPoints: [path.join(root, "scripts/proof/e09-authored-intake-ui/source.tsx")], bundle: true, write: false,
  format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
  plugins: [{ name: "explicit-intake-sdk-double", setup(api) { api.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: fixture })); } }] });
const styles = (await fs.readdir(path.join(root, "dist/assets"))).filter(f => /^main-.*\.css$/.test(f)); assert.equal(styles.length, 1);
let css = await fs.readFile(path.join(root, "dist/assets", styles[0]), "utf8");
for (const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]) {
  const url = match[1].replace(/["']/g, "");
  if (url.startsWith("/assets/")) css = css.replaceAll(match[0], `url(data:font/woff2;base64,${(await fs.readFile(path.join(root, "dist", url.slice(1)))).toString("base64")})`);
}
const options = { headless: true };
try { await fs.access(chromium.executablePath()); } catch { options.executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe"; }
const browser = await chromium.launch(options), cases = [], errors = [];
try {
  for (const [width, height, filename] of [[1536, 770, "desktop.png"], [390, 844, "mobile.png"]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.on("pageerror", error => errors.push(error.message)); await page.route("**/*", route => route.abort());
    await page.setContent('<html data-pg="light"><head></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByLabel("Intake field label").waitFor();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("button", { name: "Save Paige", exact: true }).click();
    await page.getByRole("button", { name: "Saved", exact: true }).waitFor();
    await page.evaluate(() => window.reopenIntakeFixture());
    await page.waitForFunction(() => window.intakeFixtureSnapshot().reads === 4 && !document.body.textContent.includes("Loading fixture"));
    assert.equal(await page.getByLabel("Intake field label").count(), 0);
    const add = page.getByRole("button", { name: "Add field", exact: true }); await add.focus();
    assert.equal(await add.evaluate(e => e === document.activeElement), true);
    await page.keyboard.press("Enter"); await page.getByLabel("Intake field label").waitFor();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    assert.equal(await page.getByLabel("Intake field label").count(), 0);
    const stored = await page.evaluate(() => window.intakeFixtureSnapshot());
    assert.deepEqual(stored.config.intake, []); assert.deepEqual(stored.calls, ["set_tenant_playbook"]);
    const geometry = await add.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height,
      overflow: document.documentElement.scrollWidth > innerWidth, scrollOwner: document.scrollingElement?.tagName ?? null }; });
    assert.equal(geometry.overflow, false); assert(geometry.x >= 0 && geometry.x + geometry.width <= width && geometry.y + geometry.height <= height);
    await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(output, filename), fullPage: true });
    cases.push({ width, height, filename, geometry, rows: 0, syntheticWrites: stored.calls.length, keyboardAddRemove: true }); await page.close();
  }
} finally { await browser.close(); }
assert.deepEqual(errors, []);
const sources = ["src/lib/playbook/resolve.ts", "src/components/paige/usePlaybookEditor.ts", "src/components/paige/sections/IntakeSection.tsx", "src/components/paige/PaigeConsoleSaveBar.tsx",
  "scripts/proof/e09-authored-intake-ui/adapter.ts", "scripts/proof/e09-authored-intake-ui/source.tsx", "scripts/proof/e09-authored-intake-ui/check.mjs"];
const pins = Object.fromEntries(await Promise.all(sources.map(async name => [name, createHash("sha256").update(await fs.readFile(path.join(root, name))).digest("hex")])));
await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ evidence: "isolated-actual-source", network: "blocked", auth: "explicit-synthetic-double", records: "in-memory-fixture",
  productionAcceptance: "UNVERIFIED", fullShell: "NOT_RUN", fonts: "compiled local CSS and embedded available local fonts; network blocked", sourcePins: pins, cases, errors }, null, 2));
console.log(JSON.stringify({ captures: cases.length, errors: errors.length, sourcePins: sources.length, output }));
