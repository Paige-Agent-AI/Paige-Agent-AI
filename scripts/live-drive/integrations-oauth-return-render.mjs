/** Local, stubbed transport proof. Never authenticated, provider or production evidence.
 * Owns its Vite server and closes it on success/failure. No provider control is clicked. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { resolvePlaywright, resolveExecutablePath } from "./live-drive.mjs";

const out = path.resolve("scripts/live-drive/artifacts/oauth-return");
mkdirSync(out, { recursive: true });
const results = [];
let server; let browser;
try {
  server = await createServer({ configFile: path.resolve("scripts/live-drive/harness/integrations-mount/vite.config.ts"), server: { port: 5213, strictPort: true } });
  await server.listen();
  const { chromium } = await resolvePlaywright();
  browser = await chromium.launch({ executablePath: resolveExecutablePath(), headless: true });
  for (const [width, height] of [[1536,770],[1366,768],[1024,768],[900,1000]]) {
    for (const theme of ["light", "dark"]) for (const paige of ["closed", "open"]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      const page = await context.newPage(); const errors = []; const external = []; const blockedAssets = [];
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", route => {
        if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
        const url = route.request().url();
        if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(new URL(url).hostname)) blockedAssets.push(url);
        else external.push(url);
        return route.abort();
      });
      await page.goto(`http://127.0.0.1:5213/?data=oauth-return&theme=${theme}&paige=${paige}`, { waitUntil: "networkidle" });
      const dialog = page.getByRole("dialog", { name: "Test service" });
      await dialog.waitFor().catch(async error => {
        await page.screenshot({path:path.join(out,"first-failure.png")});
        console.error({errors,external,body:(await page.locator("body").innerText()).slice(0,2500)});
        throw error;
      });
      assert.equal(await page.locator("vite-error-overlay").count(), 0);
      assert.equal(await dialog.getByRole("button", { name: "Sign in", exact: true }).count(), 1);
      assert.match(await dialog.innerText(), /Returning from sign-in does not verify/);
      const geometry = await page.evaluate(() => {
        const box = el => { const r=el.getBoundingClientRect();return { x:r.x,y:r.y,width:r.width,height:r.height }; };
        const root=document.querySelector("[data-tenant-shell]");
        const panel=document.querySelector('[role="dialog"]');
        const body=document.querySelector(".ig-panel-body");
        return { viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,root:box(root),panel:box(panel),
          document:[document.documentElement.clientWidth,document.documentElement.scrollWidth,document.documentElement.clientHeight,document.documentElement.scrollHeight],
          drawer:[body.clientHeight,body.scrollHeight,body.clientWidth,body.scrollWidth],
          reduced:matchMedia("(prefers-reduced-motion: reduce)").matches };
      });
      assert.equal(geometry.document[0],geometry.document[1],"document horizontal overflow");
      assert.equal(geometry.document[2],geometry.document[3],"document vertical overflow");
      assert(geometry.drawer[3] <= geometry.drawer[2]+1,"drawer horizontal overflow");
      assert(geometry.panel.x >= 0 && geometry.panel.x+geometry.panel.width <= width+1,"panel clipped");
      assert(geometry.reduced);
      const signIn=dialog.getByRole("button",{name:"Sign in",exact:true});
      await signIn.focus();
      assert(await signIn.evaluate(el=>el===document.activeElement));
      await page.screenshot({path:path.join(out,`${width}-${height}-${theme}-${paige}.png`)});
      await page.keyboard.press("Escape");
      await dialog.waitFor({state:"detached"});
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute("data-gateway-tool")),"00000000-0000-4000-8000-000000000021");
      assert.deepEqual(errors,[],"browser page errors");
      assert.deepEqual(external,[],"unexpected external request");
      results.push({width,height,theme,paige,geometry,blockedAssets,status:"PASS"});
      console.log(`PASS ${width}x${height} ${theme} PAIGE-${paige} return/focus/geometry`);
      await context.close();
    }
  }
} catch(error) { console.error(error); process.exitCode=1; }
finally {
  await browser?.close(); await server?.close();
  writeFileSync(path.join(out,"report.json"),JSON.stringify({evidence:"STRUCTURAL-RENDERED; stubbed transport and tenant context; shell markup/CSS, not live PAIGE",results},null,2));
}
