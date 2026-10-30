import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import assert from "node:assert/strict";
import {resolvePlaywright,buildLaunchOptions} from "../../live-drive.mjs";
const out=path.resolve("docs/evidence/ui-delivery/assets/exp03-calling-authority");fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright(),browser=await chromium.launch(buildLaunchOptions()),results=[];
async function open({theme="light",width=1366,height=768,seat="owner",paige=false}={}){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"}),errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",route=>{const url=new URL(route.request().url());return["127.0.0.1","localhost"].includes(url.hostname)||["data:","blob:"].includes(url.protocol)?route.continue():route.abort();});
  await page.goto(`http://127.0.0.1:5253/solo/1971670/settings/connections?${new URLSearchParams({segment:"registration",theme,callingSeat:seat})}`,{timeout:120000});
  const card=page.locator(".ss-phone-setup");await card.getByRole("heading",{name:"Find a number",exact:true}).waitFor();
  if(await page.getByRole("button",{name:"Fold PAIGE conversation",exact:true}).first().isVisible())await page.getByRole("button",{name:"Fold PAIGE conversation",exact:true}).first().click();
  if(seat==="owner"||seat==="operator"){
    const setup=card.getByRole("button",{name:"Set up calling",exact:true});await setup.waitFor();await setup.scrollIntoViewIfNeeded();await setup.focus();await page.keyboard.press("Tab");await page.keyboard.press("Shift+Tab");
    assert.equal(await setup.evaluate(el=>document.activeElement===el),true,"keyboard focus reaches original setup control without execution");
    assert.equal(await setup.evaluate(el=>{const r=el.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return p===el||el.contains(p);}),true,"folded-panel setup target is unobscured");
  }else{await card.getByText("Only a workspace admin can change the numbers on this business.",{exact:false}).waitFor();assert.equal(await card.getByRole("button",{name:"Set up calling",exact:true}).count(),0);}
  if(paige){await page.getByRole("button",{name:"Direct PAIGE",exact:true}).click();await page.locator("#tenant-paige-workspace").waitFor({state:"visible"});}
  return{page,card,errors};
}
async function capture(page,name,extra){const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,theme:document.documentElement.dataset.pg,scrollOwner:document.querySelector("[data-solo-screen-host]")?.getAttribute("style")}));assert.equal(geometry.horizontalOverflow,false);await page.screenshot({path:path.join(out,name+".jpg"),type:"jpeg",quality:75});results.push({name,...geometry,...extra});}
try{
  for(const theme of["light","dark"])for(const[width,height]of[[1536,770],[1366,768],[1024,768],[900,1000]])for(const paige of[false,true]){
    const {page,errors}=await open({theme,width,height,paige});assert.deepEqual(errors,[]);await capture(page,`${theme}-${width}-${paige?"open":"closed"}`,{seat:"owner",paige,setupExecuted:false});await page.close();
  }
  for(const theme of["light","dark"])for(const seat of["member","operator","error"]){const{page,card,errors}=await open({theme,seat});assert.deepEqual(errors,[]);assert.equal(await card.getByRole("button",{name:"Set up calling",exact:true}).count(),seat==="operator"?1:0);await capture(page,`${theme}-${seat}`,{seat,setupExecuted:false});await page.reload();await page.getByRole("tab",{name:"Registration",exact:true}).click();await card.waitFor();if(seat==="operator")await card.getByRole("button",{name:"Set up calling",exact:true}).waitFor();else await card.getByText("Only a workspace admin can change the numbers on this business.",{exact:false}).waitFor();assert.equal(await card.getByRole("button",{name:"Set up calling",exact:true}).count(),seat==="operator"?1:0);await page.close();}
}finally{await browser.close();}
const files=["src/solo/settings.tsx","src/solo/data/useSoloNumbers.ts","src/solo/CallingSetupCard.tsx","src/components/tenant-shell/TenantCommandCenterShell.tsx",...["index.html","main.tsx","stubs.ts","vite.config.ts","drive.mjs"].map(n=>`scripts/live-drive/harness/exp03-calling-authority-mount/${n}`)];
fs.writeFileSync(path.join(out,"source-manifest.json"),JSON.stringify({proof:"Original whole Settings/shell and actual calling hook/card, synthetic read/identity ports only; all effect invocations refuse; no authenticated/provider proof.",files:Object.fromEntries(files.map(f=>[f,crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")]))},null,2)+"\n");
fs.writeFileSync(path.join(out,"state-proof.json"),JSON.stringify(results,null,2)+"\n");console.log(JSON.stringify({frames:results.length,out}));
