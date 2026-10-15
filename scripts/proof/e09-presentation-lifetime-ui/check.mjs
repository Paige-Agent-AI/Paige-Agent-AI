import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(root, process.argv[2] ?? ".impeccable/review/e09-presentation-lifetime");
await fs.mkdir(output, { recursive: true });
const adapter = path.join(root, "scripts/proof/e09-presentation-lifetime-ui/adapter.tsx");
const bundle = await build({ entryPoints: [path.join(root, "scripts/proof/e09-presentation-lifetime-ui/source.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" }, plugins: [{ name: "isolated-read-only-transports", setup(api) {
  api.onResolve({ filter: /^@\/(?:integrations\/supabase\/client|lib\/playbook|lib\/auth\/signOut|contexts\/DashboardModeContext|hooks\/useUnreadSupportCount|components\/dashboard\/NotificationBell|components\/ui\/avatar-uploader)$/ }, () => ({ path: adapter }));
} }] });
const assets = path.join(root, "dist/assets");
const styles = (await fs.readdir(assets)).filter(file => file.endsWith(".css"));
let css = (await Promise.all(styles.map(file => fs.readFile(path.join(assets, file), "utf8")))).join("\n");
for (const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]) {
  const url = match[1].replace(/["']/g, "");
  if (url.startsWith("/assets/")) css = css.replaceAll(match[0], `url(data:font/woff2;base64,${(await fs.readFile(path.join(root, "dist", url.slice(1)))).toString("base64")})`);
}
const options = { headless: true };
try { await fs.access(chromium.executablePath()); } catch { options.executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe"; }
const browser = await chromium.launch(options), errors = [], captures = [];
try {
  for (const [width, height] of [[1536,770], [390,844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await page.setContent('<html class="light" data-pg="light"><head></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("Test Studio A", { exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    if (width > 767) assert.equal(await page.getByRole("link", { name: "Resources", exact: true }).count(),0,"actor A's saved overlay hides Resources");
    const capture = async state => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, "unchanged native navigation must fit");
      const file = `${width}-${height}-${state}.png`; await page.screenshot({ path: path.join(output,file), fullPage: true }); captures.push({ file, width, height, state, overflow });
    };
    await capture("actor-a");
    await page.evaluate(() => window.presentationProof.switchActor());
    await page.getByText("Test Studio A", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByText("Test Studio B", { exact: true }).count(),0);
    await capture("switch-pending");
    await page.evaluate(() => window.presentationProof.release()); await page.getByText("Test Studio B", { exact: true }).waitFor();
    if (width > 767) assert.equal(await page.getByRole("link", { name: "Resources", exact: true }).count(),1,"actor B receives its own overlay");
    await capture("actor-b");
    await page.evaluate(() => window.presentationProof.signOut()); await page.getByText("Test Studio B", { exact: true }).waitFor({ state: "hidden" });
    await capture("signed-out"); await page.close();
  }
  assert.deepEqual(errors,[]);
  const files = ["src/hooks/useClientPortalRead.ts","src/hooks/useClientPortalBrand.ts","src/hooks/useClientPortalConfig.ts","src/components/app/AppNav.tsx"];
  const sources = await Promise.all(files.map(async file => ({ file, sha256: createHash("sha256").update(await fs.readFile(path.join(root,file))).digest("hex") })));
  await fs.writeFile(path.join(output,"result.json"),JSON.stringify({ evidenceClass:"isolated-actual-source-navigation",auth:"synthetic; not customer acceptance",network:"all blocked",native:"AppNav/hooks/router/UI; NotificationBell,role/playbook and transports fixture-backed",sources,captures,errors },null,2));
  console.log(JSON.stringify({ captures:captures.length,errors:errors.length,output }));
} finally { await browser.close(); }
