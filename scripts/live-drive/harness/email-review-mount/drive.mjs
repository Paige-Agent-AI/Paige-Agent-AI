import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolvePlaywright, buildLaunchOptions } from "../../live-drive.mjs";

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"../../../..");
const sourceFiles=["src/components/admin/comms/mergeVars.ts","src/components/chat/confirmPreview.ts","src/components/chat/PaigeConfirmCard.tsx","src/pages/admin/conversations/GovernedReplyStrip.tsx","scripts/live-drive/harness/email-review-mount/main.tsx","scripts/live-drive/harness/email-review-mount/drive.mjs"];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash("sha256").update(await fs.readFile(path.join(repo,file))).digest("hex")])));
const sourceHashes=await hashes();
const sourceBaseCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim();
const sourceWorkingTreeDirty=execFileSync("git",["status","--porcelain","--",...sourceFiles],{cwd:repo,encoding:"utf8"}).trim().length>0;
const server=await createServer({configFile:path.join(here,"vite.config.ts")});
let browser;
try {
  await server.listen();
  console.log(JSON.stringify({phase:"loopback-server-ready"}));
  const {chromium}=await resolvePlaywright();browser=await chromium.launch(buildLaunchOptions());
  console.log(JSON.stringify({phase:"installed-chromium-ready"}));
  const results=[];
  for(const width of [1366,390]) {
    const page=await browser.newPage({viewport:{width,height:844},reducedMotion:"reduce"});
    const externalRequests=[],pageErrors=[];
    page.on("pageerror",e=>pageErrors.push(e.message));
    await page.route("**/*",route=>{
      if(new URL(route.request().url()).origin==="http://127.0.0.1:5263") return route.continue();
      externalRequests.push(route.request().url());return route.abort();
    });
    // Component readiness is the proof condition; Vite's development traffic is
    // not a reliable global network-idle signal. All remote attempts still fail.
    await page.goto("http://127.0.0.1:5263",{waitUntil:"domcontentloaded",timeout:60_000});
    await page.locator("[data-email-rich-review]").first().waitFor({timeout:60_000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(null)))));
    console.log(JSON.stringify({phase:"actual-consumers-mounted",width}));
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
  assert.deepEqual(await hashes(),sourceHashes,"source changed during browser proof");
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify({proofClass:"isolated actual Chromium component/network behavior; fictional content",sourceBaseCommit,sourceWorkingTreeDirty,sourceHashes,authenticated:false,fullShell:false,providerEffects:false,results},null,2)+"\n");
  console.log(JSON.stringify({pass:true,output,results}));
} finally { if(browser) await browser.close();await server.close(); }
