import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../.."),output=path.resolve(root,process.argv[2]??".impeccable/review/e09-client-welcome");
await fs.mkdir(output,{recursive:true});
const adapter=path.join(root,"scripts/proof/e09-client-welcome-ui/adapter.tsx");
const bundle=await build({entryPoints:[path.join(root,"scripts/proof/e09-client-welcome-ui/source.tsx")],bundle:true,write:false,
  format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"production"',"import.meta.env.DEV":"false"},
  plugins:[{name:"explicit-welcome-sdk-double",setup(api){api.onResolve({filter:/^@\/integrations\/supabase\/client$/},()=>({path:adapter}));}}]});
const styles=(await fs.readdir(path.join(root,"dist/assets"))).filter(f=>/^main-.*\.css$/.test(f));assert.equal(styles.length,1);
let css=await fs.readFile(path.join(root,"dist/assets",styles[0]),"utf8");
for(const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]){
  const url=match[1].replace(/["']/g,"");if(url.startsWith("/assets/"))css=css.replaceAll(match[0],`url(data:font/woff2;base64,${(await fs.readFile(path.join(root,"dist",url.slice(1)))).toString("base64")})`);
}
css+="\n"+await fs.readFile(path.join(root,"src/pages/onboard/onboard-theme.css"),"utf8");
const options={headless:true};try{await fs.access(chromium.executablePath());}catch{options.executablePath="C:/Program Files/Google/Chrome/Application/chrome.exe";}
const browser=await chromium.launch(options),cases=[],errors=[];
try{
  for(const [width,height,state,context]of [[1536,770,"ready","a"],[1366,768,"ready","b"],[1024,768,"ready","b"],[900,1000,"ready","a"],
    [390,844,"ready","a"],[320,720,"ready","b"],[390,844,"loading","a"],[390,844,"unavailable","a"],
    [390,844,"read_error","a"],[390,844,"configuration_required","b"],[390,844,"signed_out","a"]]){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
    page.on("pageerror",e=>errors.push(e.message));await page.route("**/*",route=>route.abort());
    await page.setContent('<html data-pg="light"><head></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({content:css});await page.evaluate(seed=>{window.welcomeSeed=seed;},{state,context});
    await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole("heading",{name:"Welcome.",exact:true}).waitFor();
    if(state==="ready")await page.getByLabel("First name",{exact:true}).waitFor();
    else await page.getByText(state==="loading"?"Loading your information…":state==="unavailable"?"Your information is unavailable for this business. Contact the business for help.":state==="read_error"?"Your information could not be loaded. Your edits have been kept in this session. Try again when connected.":state==="signed_out"?"Sign in again to continue.":"Second Test Business needs to finish setting up your welcome questions. Contact the business before continuing.",{exact:true}).waitFor();
    if(state==="signed_out"){
      const link=page.getByRole("link",{name:"Go to sign in",exact:true});assert.equal(await link.getAttribute("href"),"/auth");
      const colors=await link.evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}));
      const luminance=value=>{const channels=value.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
      const levels=[luminance(colors.color),luminance(colors.background)].sort((a,b)=>b-a);
      assert((levels[0]+.05)/(levels[1]+.05)>=4.5,`sign-in recovery contrast ${JSON.stringify(colors)}`);
    }
    await page.evaluate(()=>document.fonts.ready);
    const capture=async suffix=>{
      const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,
        sizes:[...document.querySelectorAll("form input,form select,form textarea,section button")].map(e=>({tag:e.tagName,height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontSize})),
        brandColor:getComputedStyle(document.querySelector(".onboard-container > div > span:last-child")).color,
        scrollOwner:document.scrollingElement?.tagName,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
      assert.equal(geometry.overflow,false);assert.equal(geometry.reduced,true);
      assert.equal(geometry.brandColor,"rgb(244, 236, 214)","business name must remain readable on the existing dark shell");
      for(const size of geometry.sizes){assert(size.height>=44,JSON.stringify(size));assert(parseFloat(size.font)>=16,JSON.stringify(size));}
      const filename=`${width}-${height}-${context}-${state}-${suffix}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});
      cases.push({width,height,state,context,filename,geometry});
    };
    await capture("initial");
    if(state==="ready"&&width===1536){
      await page.getByLabel("First name",{exact:true}).focus();await page.keyboard.press("Tab");assert.equal(await page.locator(":focus").getAttribute("id"),"welcome-last_name");
      await page.getByLabel("Phone number",{exact:true}).fill("+12025550131");await page.getByLabel("Your goal",{exact:true}).fill("A saved source-driven goal");
      await page.evaluate(()=>window.welcomeProof.mode("conflict"));await page.getByRole("button",{name:"Continue to agreement",exact:true}).click();
      await page.getByRole("alert").filter({hasText:"changed"}).waitFor();assert.equal(await page.getByLabel("Your goal",{exact:true}).inputValue(),"A saved source-driven goal");await capture("conflict");
      page.once("dialog",dialog=>dialog.dismiss());await page.getByRole("button",{name:"Discard edits and reload",exact:true}).click();assert.equal(await page.getByLabel("Your goal",{exact:true}).inputValue(),"A saved source-driven goal");
    }
    if(state==="ready"&&width===390){
      await page.getByLabel("Your goal",{exact:true}).fill("Recoverable draft");await page.evaluate(()=>window.welcomeProof.mode("unknown"));
      await page.getByRole("button",{name:"Continue to agreement",exact:true}).click();await page.getByRole("alert").filter({hasText:"confirm"}).waitFor();await capture("unknown");
    }
    if(state==="ready"&&width===320){
      const next=page.getByRole("button",{name:"Continue to agreement",exact:true});await next.scrollIntoViewIfNeeded();
      const rect=await next.boundingBox();assert(rect&&rect.y>=0&&rect.y+rect.height<=height+1);await capture("continue-reachable");
      await page.getByLabel("Phone number",{exact:true}).fill("+12025550131");await page.getByLabel("Your goal",{exact:true}).fill("Persistent fixture goal");
      const numeric=page.getByLabel("Target milestones");await numeric.fill("3.5");
      assert.equal(await numeric.evaluate(e=>e.validity.stepMismatch),false);await numeric.press("Enter");
      await page.getByText("Agreement route test double",{exact:true}).waitFor();
      const calls=await page.evaluate(()=>window.welcomeProof.calls());assert.equal(calls.filter(x=>x.name==="client_portal_save_welcome").length,1);
      assert(calls.filter(x=>x.name.startsWith("client_portal_welcome")||x.name==="client_portal_save_welcome").every(x=>x.pinned));
      await page.getByRole("button",{name:"Return to information",exact:true}).click();await page.getByLabel("Your goal",{exact:true}).waitFor();
      assert.equal(await page.getByLabel("Your goal",{exact:true}).inputValue(),"Persistent fixture goal");assert.equal(await page.getByLabel("Phone number",{exact:true}).inputValue(),"+12025550131");
      assert.equal(await numeric.inputValue(),"3.5");
      await capture("returned-fixture-state");
    }
    await page.close();
  }
}finally{await browser.close();}
assert.deepEqual(errors,[]);
const sourceFiles=["src/pages/onboard/OnboardLayout.tsx","src/pages/onboard/Step1Welcome.tsx","src/pages/onboard/useClientWelcome.ts","src/pages/onboard/useOnboardingClient.ts","src/lib/client-portal-welcome.ts","src/pages/onboard/onboard-theme.css"];
const pins=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash("sha256").update(await fs.readFile(path.join(root,f))).digest("hex")])));
await fs.writeFile(path.join(output,"result.json"),JSON.stringify({evidence:"isolated-actual-source",network:"blocked",auth:"explicit-synthetic-double",domainRecords:"in-memory-UI-fixtures-only",productionAcceptance:"UNVERIFIED",fonts:"local compiled fonts; remote fallback when unavailable",sourcePins:pins,cases,errors},null,2));
console.log(JSON.stringify({captures:cases.length,sourcePins:Object.keys(pins).length,errors:errors.length,output}));
