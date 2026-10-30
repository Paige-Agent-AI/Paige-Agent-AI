import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { resolvePlaywright, buildLaunchOptions } from "../../live-drive.mjs";

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"../../../..");
const server=await createServer({configFile:path.join(here,"vite.config.ts")});
let browser;
try {
  await server.listen();
  const {chromium}=await resolvePlaywright();browser=await chromium.launch(buildLaunchOptions());
  const results=[];
  for(const width of [1366,390]) {
    const page=await browser.newPage({viewport:{width,height:844},reducedMotion:"reduce"});
    const externalRequests=[],pageErrors=[];
    page.on("pageerror",e=>pageErrors.push(e.message));
    await page.route("**/*",route=>{
      if(new URL(route.request().url()).origin==="http://127.0.0.1:5263") return route.continue();
      externalRequests.push(route.request().url());return route.abort();
    });
    await page.goto("http://127.0.0.1:5263",{waitUntil:"networkidle",timeout:60_000});
    await page.locator("[data-email-rich-review]").first().waitFor();
    assert.equal(await page.locator("[data-email-rich-review]").count(),2,"same original shared and inline consumers");
    for(const label of ["Original shared card","Original inline check"]) {
      const section=page.getByRole("region",{name:label});
      assert.match(await section.innerText(),/https:\/\/offer\.example\.invalid\/terms/);
      assert.equal(await section.locator("[data-email-rich-review] a,[data-email-rich-review] img,[data-email-rich-review] iframe,[data-email-rich-review] form,[data-email-rich-review] script").count(),0);
    }
    assert.equal(await page.evaluate(()=>window.__exp03Danger),undefined);
    assert.deepEqual(externalRequests,[],"viewing must not even attempt tracking/navigation requests");
    assert.deepEqual(pageErrors,[]);
    results.push({width,consumers:2,externalRequests:0,activeContent:0,pageErrors:0});await page.close();
  }
  const output=path.join(repo,"docs/evidence/ui-delivery/assets/exp03-saved-draft-conversation/rich-review-browser.json");
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify({proofClass:"isolated actual Chromium component/network behavior; fictional content",authenticated:false,fullShell:false,providerEffects:false,results},null,2)+"\n");
  console.log(JSON.stringify({pass:true,output,results}));
} finally { if(browser) await browser.close();await server.close(); }
