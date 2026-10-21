// Actual source through the existing local Sales harness. No authentication/provider claims.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildLaunchOptions, resolvePlaywright } from "./live-drive.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const sourcePaths = ["src/solo/sales-ops.tsx", "src/solo/SalesWorkspace.tsx", "src/solo/sales-ops.css", "src/solo/sales/sales-department.css", "src/components/tenant-shell/TenantCommandCenterShell.tsx", "scripts/live-drive/harness/sales-mount/agreements-register.tsx", "scripts/live-drive/harness/sales-mount/vite.agreements-register.config.ts"];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async file => [file,createHash("sha256").update((await fs.readFile(path.join(root,file),"utf8")).replaceAll("\r\n","\n")).digest("hex")])));
const beforeSources = await sourceHashes();
const out = path.join(root, "docs/evidence/ui-delivery/assets/e04-agreement-register-discovery");
await fs.mkdir(out, { recursive: true });
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const results = [];
const errors = [];
const blocked = [];
const context = await browser.newContext({ reducedMotion: "reduce" });
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.hostname === "127.0.0.1" || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
  blocked.push(url.origin);
  return route.abort();
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
const url = (theme, paige, read = "ready") => `http://127.0.0.1:5289/agreements-register.html?theme=${theme}&paige=${paige}&read=${read}`;
const frames = [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]];
try {
  for (const theme of ["light", "dark"]) for (const [width,height] of frames) {
    for (const paige of width >= 900 ? ["closed", "open"] : ["closed"]) {
      await page.setViewportSize({ width, height });
      await page.goto(url(theme, paige), { waitUntil: "domcontentloaded" });
      const search = page.getByRole("searchbox", { name: "Find an agreement" });
      await search.waitFor({ state: "visible" });
      await search.fill("Mutual NDA");
      assert.equal(await page.locator('.so-terms .so-row').count(), 1);
      assert.match(await page.locator('.so-terms .so-row').innerText(), /Mutual NDA/);
      // Mobile uses the incumbent Sales body scroll owner. Reachability, not simultaneous
      // first-viewport visibility of every control, is the native contract.
      await page.getByRole("combobox", { name:"Signature state" }).scrollIntoViewIfNeeded();
      const fit = await page.evaluate(() => {
        const input = document.querySelector('.so-terms input[type="search"]');
        const select = document.querySelector('.so-terms select');
        const r = input.getBoundingClientRect(), s = select.getBoundingClientRect();
        return { viewport: innerWidth, document: document.documentElement.scrollWidth,
          input: { left:r.left, right:r.right, top:r.top, bottom:r.bottom },
          select: { left:s.left, right:s.right, top:s.top, bottom:s.bottom },
          scrollOwner: { className:document.querySelector('.sales-department-body').className,
            top:document.querySelector('.sales-department-body').scrollTop }, pageScroll:scrollY };
      });
      assert.ok(fit.document <= width + 1, JSON.stringify(fit));
      assert.ok(fit.input.left >= 0 && fit.input.right <= width + 1, JSON.stringify(fit));
      assert.ok(fit.select.left >= 0 && fit.select.right <= width + 1 && fit.select.bottom <= height + 1, JSON.stringify(fit));
      assert.equal(fit.pageScroll,0,JSON.stringify(fit));
      await page.screenshot({ path:path.join(out, `${width}-${height}-${theme}-${paige}.png`) });
      results.push({ theme,width,height,paige,fit,search:"PASS" });
      console.log(`Captured ${width}x${height} ${theme} ${paige}`);
    }
  }
  await page.setViewportSize({ width:1366, height:768 });
  await page.goto(url("light", "closed"), { waitUntil:"domcontentloaded" });
  const search = page.getByRole("searchbox", { name:"Find an agreement" });
  await search.fill("Delaney Okafor");
  assert.equal(await page.locator('.so-terms .so-row').count(), 1);
  await search.fill(".*");
  assert.equal(await page.locator('.so-terms .so-row').count(), 0);
  assert.match(await page.locator('.so-terms [role="status"]').innerText(), /No agreements match/);
  await search.fill("");
  await page.getByRole("combobox", { name:"Signature state" }).selectOption("none");
  assert.ok(await page.locator('.so-terms .so-row').count() > 0);
  assert.match(await page.locator('.so-terms .so-row').first().innerText(), /No document/);
  await page.getByRole("combobox", { name:"Signature state" }).selectOption("completed");
  await page.locator('.so-terms .so-row').first().click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /Completed/);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state:"hidden" });
  await search.focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("combobox", { name:"Signature state" }).evaluate(el => el === document.activeElement), true);
  await page.goto(url("dark", "closed", "error"), { waitUntil:"domcontentloaded" });
  await page.getByRole("combobox", { name:"Signature state" }).selectOption("unrecognised");
  assert.ok(await page.locator('.so-terms .so-row').count() > 0);
  assert.equal(await page.locator('.so-terms option[value="none"]').count(), 0);
  assert.match(await page.locator('.so-terms').innerText(), /could not be read/);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(blocked.filter(origin => origin !== "https://fonts.googleapis.com").length, 0, `Unexpected external request: ${blocked.join(",")}`);
  assert.deepEqual(await sourceHashes(),beforeSources,"Source changed during browser proof");
  const report = { proofClass:"actual-source browser; synthetic identity/network only", normalizedLFSourceSHA256:beforeSources, results, behavioral:["document search","signer search","literal no match","clear","terms-only filter","completed filter","original detail and Escape","keyboard input to filter","unreadable read is unknown"], errors, blocked, authenticated:"UNVERIFIED", providers:"NOT_EXERCISED" };
  await fs.writeFile(path.join(out,"result.json"), JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({ frames:results.length, behavioral:report.behavioral.length, errors:errors.length, externalRequests:blocked.length }));
} catch (error) {
  await page.screenshot({ path:path.join(out,"failure.png") }).catch(()=>{});
  await fs.writeFile(path.join(out,"failure.json"),JSON.stringify({error:String(error),errors,blocked,completed:results},null,2));
  throw error;
} finally { await browser.close(); }
