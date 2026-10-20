import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import os from "node:os";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "playwright";
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const compatibility = process.argv.includes("--compatibility");
const canonicalPrototype=process.argv.includes('--canonical-prototype');
const canonicalCommand=process.argv.includes('--canonical-command');
const canonicalFlow=canonicalPrototype||canonicalCommand;
const dialogs = process.argv.includes("--dialogs")||canonicalFlow;
const engineName = process.argv.find(value => value.startsWith("--engine="))?.slice(9) ?? "chromium";
assert(["chromium", "firefox", "webkit", "edge"].includes(engineName), "unsupported proof engine");
const engine = { chromium, firefox, webkit, edge: chromium }[engineName];
const output = path.join(project, "docs/evidence/ui-delivery/assets", canonicalPrototype?'e09-invitation-command-prototype':canonicalCommand?'e09-invitation-command':dialogs ? "e09-portal-dialog-theme" : "e09-invitation-history", ...(compatibility ? ["compatibility", engineName] : []));
await fs.mkdir(output, { recursive: true });
const adapter = path.join(project, "scripts/proof/e09-invitation-history-ui/adapter.tsx");
const replace = /^(?:@\/(?:hooks\/(?:useTenantContext|useBrandKit|usePortalConfig|useRailEvents|useTierFeatures)|integrations\/supabase\/client|lib\/playbook|components\/ui\/paige|components\/admin\/voice\/DialPadTrigger|components\/dashboard\/PaigeAIChat|components\/tenant-calendar\/TenantCanonicalCalendarWorkspace)|\.\/(?:useTenantRelationshipsData|ClientStanding|PeopleContactEditor))$/;
const bundled = await build({ entryPoints: [path.join(project,"scripts/proof/e09-invitation-history-ui/source.tsx")], bundle:true,write:false,format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"production"',"import.meta.env.DEV":"false"},plugins:[{name:"explicit-read-only-transport",setup(api){
  if(canonicalPrototype)api.onResolve({filter:/^\.\/PortalInvitationManager$/},()=>({path:path.join(project,'scripts/proof/e09-invitation-history-ui/canonical-prototype.tsx')}));
  if(canonicalCommand)api.onResolve({filter:/^@\/integrations\/supabase\/client$/},()=>({path:path.join(project,'scripts/proof/e09-invitation-history-ui/canonical-adapter.tsx')}));
  api.onResolve({filter:replace},()=>({path:adapter}));
  api.onResolve({filter:/^next-themes$/},()=>({path:adapter}));
  api.onResolve({filter:/^@\/pages\/admin\/(ClientsConversations|CalendarAdmin)$/},()=>({path:adapter}));
  api.onResolve({filter:/^@\/components\/admin\/contacts\/ContactPortalPanel$/},()=>({path:adapter}));
}}]});
const styles=(await fs.readdir(path.join(project,"dist/assets"))).filter(f=>f.endsWith(".css"));
// Production loads the entry stylesheet before lazy feature styles. Alphabetic
// concatenation instead lets entry utilities override the native dialog class.
if(dialogs)styles.sort((a,b)=>Number(!a.startsWith("main-"))-Number(!b.startsWith("main-"))||a.localeCompare(b));
let css=(await Promise.all(styles.map(f=>fs.readFile(path.join(project,"dist/assets",f),"utf8")))).join("\n");
for(const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]){
  const url=match[1].replace(/["']/g,""); if(!url.startsWith("/assets/"))continue;
  const bytes=await fs.readFile(path.join(project,"dist",url.slice(1))); css=css.replaceAll(match[0],"url(data:font/woff2;base64,"+bytes.toString("base64")+")");
}
const launch={headless:true};
if(engineName==="edge")launch.executablePath="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
else if(engineName==="chromium")try{await fs.access(chromium.executablePath())}catch{launch.executablePath="C:/Program Files/Google/Chrome/Application/chrome.exe"}
const browser=await engine.launch(launch),cases=[],errors=[];
const runtime={engine:engineName,browserVersion:browser.version(),executable:launch.executablePath??engine.executablePath(),
  os:os.type(),osVersion:os.release(),headless:true,route:canonicalCommand?"actual-source owner Clients/Portal/Client access via intercepted HTTPS document":"actual-source owner Clients/Portal/Client access via setContent",auth:"synthetic actual-subject/tenant fixtures",permissions:"network blocked; no media, file picker, OAuth or customer permission operation"};
async function render(width,height,open,theme,tenant,state="ready",deviceScaleFactor=1,capture=true){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor,reducedMotion:"reduce"});
  let focusOutline=null;
  page.on("pageerror",e=>errors.push(e.message));await page.route("**/*",r=>r.abort());
  await page.setContent('<!doctype html><html data-pg="'+theme+'"><head></head><body><div id="root"></div></body></html>');
  // Prepare history with the native modal assistant folded. Reopen it with the
  // real header control for the requested capture; never click through its backdrop.
  await page.addStyleTag({content:css});await page.evaluate(v=>{window.portalProof=v},{open:false,theme,tenant,state});
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  await page.getByRole("tab",{name:"Client access",exact:true}).click();
  const select=page.locator('select[id$="-invite-client"]');await select.selectOption("e0931000-0000-0000-0000-000000000001");
  if(state==="history-error"){
    await page.getByText("Invitations couldn’t be checked",{exact:true}).waitFor();
    assert.equal(await page.getByRole("region",{name:"Invitation history",exact:true}).count(),0);
    assert.equal(await page.getByRole("button",{name:"Send invitation email",exact:true}).count(),0);
  } else {
    const history=page.getByRole("region",{name:"Invitation history",exact:true});await history.waitFor();
    const summary=history.locator("summary").first();
    // Anchor at the existing selector, then use the real keyboard path. Firefox
    // correctly does not promise focus-visible for programmatic pointer focus.
    await select.focus();let tabsToHistory=0;
    while(!await summary.evaluate(node=>node===document.activeElement)&&tabsToHistory<20){await page.keyboard.press("Tab");tabsToHistory++}
    assert(tabsToHistory>0&&tabsToHistory<20,"history must be reachable by keyboard");
    await page.keyboard.press("Enter");
    focusOutline=await summary.evaluate(node=>{const style=getComputedStyle(node);return{style:style.outlineStyle,width:style.outlineWidth,color:style.outlineColor,focused:node===document.activeElement}});
    assert.equal(focusOutline.focused,true);assert.equal(focusOutline.style,"solid");assert(parseFloat(focusOutline.width)>=2);
    assert(!["transparent","rgba(0, 0, 0, 0)"].includes(focusOutline.color));
    await history.getByText("Accepted for sending",{exact:true}).waitFor();
    assert((await history.textContent()).includes("Delivery unknown"));
    assert((await history.textContent()).includes("Invitation accepted"));
    assert((await history.textContent()).includes("latest 50"));
    const warning=history.getByText("Showing the latest 50 recorded email events for this invitation.",{exact:true});
    await warning.scrollIntoViewIfNeeded();const warningBounds=await warning.boundingBox();
    assert(warningBounds&&warningBounds.y>=0&&warningBounds.y+warningBounds.height<=height);
    assert.equal(await history.locator("a,button").count(),0);
    await summary.scrollIntoViewIfNeeded();
    await page.evaluate(()=>document.fonts.ready);
  }
  if(open)await page.getByRole("button",{name:"Direct PAIGE",exact:true}).click();
  const geometry=await page.evaluate(()=>{const panel=document.querySelector(".trc-panel--portal"),history=document.querySelector(".opd-invitation-history"),backdrop=document.querySelector(".tcs-paige-backdrop");return{documentOverflow:document.documentElement.scrollWidth>innerWidth,scrollOwner:getComputedStyle(panel).overflowY,actualPaigeState:document.querySelector("[data-tenant-shell]").dataset.paige,historyWidth:history?.getBoundingClientRect().width??null,historyOverflow:history?history.scrollWidth>history.clientWidth:false,modalAssistant:!!backdrop&&getComputedStyle(backdrop).display!=="none"}});
  assert.equal(geometry.documentOverflow,false);assert.equal(geometry.scrollOwner,"auto");assert.equal(geometry.actualPaigeState,open?"open":"closed");
  assert.equal(geometry.historyOverflow,false);
  assert(geometry.historyWidth===null||geometry.historyWidth<=862,"history retains the existing readable activity width");
  const filename=width+"-"+height+"-"+(open?"open":"closed")+"-"+theme+"-"+tenant.slice(-1)+"-"+state+".png";
  if(capture)await page.screenshot({path:path.join(output,filename)});
  const snapshot=await page.evaluate(()=>window.invitationProof());assert(snapshot.calls.every(name=>["can_manage_tenant_brand","client_portal_owner_invitations"].includes(name)));
  const display=await page.evaluate(()=>({innerWidth,innerHeight,devicePixelRatio}));
  cases.push({width,height,open,theme,tenant,state,geometry,filename:capture?filename:null,snapshot,focusOutline,keyboardDisclosure:state==="ready",display,
    displayProof:deviceScaleFactor===2?"synthetic DPR2; not physical4K/OS200%":"CSS viewport; OS scaling and physical display untested",zoom:width===320?"320 CSS px reflow equivalence; actual browser400% untested":"100% automated context; actual browser zoom untested"});await page.close();
}
async function renderDialog(width,height,open,theme,kind="invite",state="ready",second=false){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
  page.on("pageerror",e=>errors.push(e.message));await page.route("**/*",r=>r.abort());
  // Deliberately reproduce production: theme variables belong to the native
  // SOLO shell, never html/body. A global marker would mask the portal defect.
  if(canonicalCommand){
    // Production requires HTTPS crypto.randomUUID. Fulfill a secure local test origin
    // without DNS/network instead of changing Web Crypto or inventing client IDs.
    await page.route('https://portal-proof.invalid/',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head></head><body><div id="root"></div></body></html>'}));
    await page.goto('https://portal-proof.invalid/');
  }else await page.setContent('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({content:css});
  await page.evaluate(v=>{window.portalProof=v},{open:false,theme,tenant:"e0921000-0000-0000-0000-00000000000"+(second?"2":"1"),state});
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  const trigger=page.getByRole("button",{name:kind==="invite"?"Invite client":"Preview portal",exact:true});
  await trigger.waitFor();
  if(open)await page.getByRole("button",{name:"Direct PAIGE",exact:true}).click();
  const assistantModal=await page.locator(".tcs-paige-backdrop").evaluateAll(nodes=>nodes.some(node=>getComputedStyle(node).display!=="none"));
  const filename=[width,height,open?"open":"closed",theme,kind,state].join("-")+".png";
  if(assistantModal){
    // Native narrow PAIGE is already modal. Preserve its ownership instead of
    // forcing a click on an inaccessible invitation control behind its backdrop.
    assert(open);assert.equal(await page.locator('.opd-preview-dialog').count(),0);
    cases.push({width,height,open,theme,kind,state,assistantModal:true,dialog:"not opened while native PAIGE modal owns focus",filename:null});
    await page.close();return;
  }
  await trigger.click();const dialog=page.getByRole("dialog",{name:kind==="invite"?"Invite a client":"Portal presentation preview",exact:true});
  await dialog.waitFor();
  if(kind==="invite"){
    await dialog.getByRole("combobox",{name:"Existing client",exact:true}).selectOption("e0931000-0000-0000-0000-000000000001");
    if(state==="history-error"){
      await dialog.getByText("Invitations couldn’t be checked",{exact:true}).waitFor();
      assert.equal(await dialog.getByRole("button",{name:"Send invitation email",exact:true}).count(),0);
    }else{
      if(canonicalFlow){
       await dialog.getByRole('button',{name:'Review invitation',exact:true}).click();
       const card=dialog.getByRole('group',{name:'Needs your OK',exact:true});await card.waitFor({timeout:5000}).catch(async error=>{
        const detail=await page.evaluate(()=>({cryptoUuid:typeof crypto.randomUUID,records:window.invitationCommandPrototype.records(),text:document.body.innerText.slice(-1700)}));
        throw Error(JSON.stringify({error:error.message,errors,detail}));
       });
       await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='group'&&document.activeElement?.getAttribute('aria-label')==='Needs your OK',null,{timeout:5000}).catch(async error=>{
        const focus=await page.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,600),card:document.querySelector('[role="group"][aria-label="Needs your OK"]')?.outerHTML.slice(0,700)}));
        throw Error(JSON.stringify({case:{width,height,open,theme,kind,state},focus,error:error.message}));
       });
       assert(await card.evaluate(node=>node===document.activeElement),'card, not Approve, receives focus');
       await dialog.getByRole('button',{name:'Not now',exact:true}).click();
       await page.waitForFunction(()=>document.activeElement?.textContent==='Review invitation');
       assert.equal(await page.evaluate(()=>window.invitationCommandPrototype.records()[0][1].effects),0);
       await page.evaluate(()=>window.invitationCommandPrototype.setOutcome('uncertain'));
       await dialog.getByRole('button',{name:'Review invitation',exact:true}).click();
       await dialog.getByRole('button',{name:'Approve',exact:true}).click();
       const check=dialog.getByRole('button',{name:'Check status',exact:true});await check.waitFor();
       assert.equal(await dialog.getByRole('button',{name:'Approve',exact:true}).count(),0);
       await check.click();await dialog.getByText(canonicalCommand?'Status checked. The original send remains unconfirmed; no new email was requested.':'Status checked. The original send remains unconfirmed.',{exact:true}).waitFor();
       assert.equal(await page.evaluate(()=>window.invitationCommandPrototype.records()[0][1].effects),1);
       await page.evaluate(()=>window.invitationCommandPrototype.setOutcome('accepted'));
       await dialog.getByRole('button',{name:'Review recovery',exact:true}).click();
       await card.waitFor();await card.scrollIntoViewIfNeeded();
       const cardBounds=await card.boundingBox();assert(cardBounds&&cardBounds.width<=width,'canonical card wraps in native dialog');
       if(width===390||width===1536)await page.screenshot({path:path.join(output,filename.replace('.png','-review.png'))});
       await dialog.getByRole('button',{name:'Approve',exact:true}).click();
       await dialog.getByRole('button',{name:'Refresh history',exact:true}).waitFor();
       await dialog.getByRole('button',{name:'Refresh history',exact:true}).click();
       const record=await page.evaluate(()=>window.invitationCommandPrototype.records()[0][1]);
       assert.equal(record.effects,2);assert.equal(record.reads,2);assert.equal(record.phase,'accepted');
       if(canonicalCommand){
        await dialog.getByRole('button',{name:'Review resend',exact:true}).click();await card.waitFor();
        await page.evaluate(()=>window.invitationCommandPrototype.expireAuth());
        await dialog.getByRole('button',{name:'Approve',exact:true}).click();
        const signIn=dialog.getByRole('link',{name:'Sign in again',exact:true});await signIn.waitFor();await signIn.scrollIntoViewIfNeeded();
        assert((await signIn.getAttribute('href')).startsWith('/auth?mode=login&next='));
        assert.equal(await dialog.getByRole('button',{name:'Approve',exact:true}).count(),0);
        assert.equal(await dialog.getByRole('button',{name:'Review recovery',exact:true}).count(),0);
        assert.equal(await page.evaluate(()=>window.invitationCommandPrototype.records()[0][1].effects),2);
        if(width===390||width===1536)await page.screenshot({path:path.join(output,filename.replace('.png','-session.png'))});
       }
      }
      const history=dialog.getByRole("region",{name:"Invitation history",exact:true});await history.waitFor();
      if(width===390||width===1536){
        await page.evaluate(()=>document.fonts.ready);
        await page.screenshot({path:path.join(output,filename.replace(".png","-entry.png"))});
      }
      const summary=history.locator("summary").first();await summary.focus();await page.keyboard.press("Enter");
      const tail=history.getByText("Showing the latest 50 recorded email events for this invitation.",{exact:true});
      await tail.scrollIntoViewIfNeeded();const box=await tail.boundingBox();assert(box&&box.y>=0&&box.y+box.height<=height,"history tail reachable inside modal");
      await summary.scrollIntoViewIfNeeded();
    }
  }
  await page.evaluate(()=>document.fonts.ready);
  const geometry=await dialog.evaluate(node=>{
    const style=getComputedStyle(node),r=node.getBoundingClientRect(),shell=document.querySelector("[data-tenant-shell]");
    return{background:style.backgroundColor,color:style.color,surface:style.getPropertyValue("--pg-surface").trim(),theme:node.getAttribute("data-pg"),shellTheme:shell.getAttribute("data-pg"),outsideShell:!shell.contains(node),rootUnthemed:!document.documentElement.hasAttribute("data-pg")&&!document.body.hasAttribute("data-pg"),overflow:node.scrollWidth>node.clientWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth,overflowY:style.overflowY,insideViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,assistantState:shell.getAttribute("data-paige")};
  });
  assert(geometry.rootUnthemed&&geometry.outsideShell,"native body-portal boundary must be real");
  assert.equal(geometry.background,theme==="light"?"rgb(245, 242, 236)":"rgb(25, 22, 30)","dialog must have the opaque canonical theme surface");
  assert.equal(geometry.theme,theme);assert.equal(geometry.shellTheme,theme);
  assert(!geometry.overflow&&!geometry.documentOverflow&&geometry.insideViewport,"dialog and controls must fit the viewport");
  assert.equal(geometry.overflowY,"auto");
  const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{const s=v/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4});return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722};
  const levels=[luminance(geometry.background),luminance(geometry.color)].sort((a,b)=>b-a);const contrast=(levels[0]+0.05)/(levels[1]+0.05);assert(contrast>=4.5,"dialog text must meet normal-text contrast");
  await page.keyboard.press("Tab");assert(await dialog.evaluate(node=>node.contains(document.activeElement)),"keyboard focus must stay inside dialog");
  if((width===390||width===1536||kind==="preview")&&state==="ready")await page.screenshot({path:path.join(output,filename)});
  else if(state!=="ready")await page.screenshot({path:path.join(output,filename)});
  await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
  await page.waitForFunction(label=>document.activeElement?.textContent?.trim()===label,kind==="invite"?"Invite client":"Preview portal");
  const snapshot=await page.evaluate(()=>window.invitationProof());assert(snapshot.calls.every(name=>["can_manage_tenant_brand","client_portal_owner_invitations"].includes(name)));
  cases.push({width,height,open,theme,kind,state,geometry,contrast,focusRestored:true,snapshot,filename:((width===390||width===1536||kind==="preview")&&state==="ready")||state!=="ready"?filename:null});await page.close();
}
try{
  if(dialogs){
    for(const[width,height]of[[1536,770],[1366,768],[1024,768],[900,1000]])for(const open of[false,true])for(const theme of["light","dark"])await renderDialog(width,height,open,theme);
    for(const theme of["light","dark"]){await renderDialog(390,844,false,theme,"invite","ready",true);await renderDialog(1366,768,false,theme,"preview");}
    await renderDialog(320,568,false,"light");await renderDialog(768,385,false,"dark");
    await renderDialog(1366,768,false,"light","invite","history-error",true);
  }else if(compatibility){
    const sizes=engineName==="chromium"?[[320,568],[390,844],[768,1024],[1920,1080],[2560,1440],[3840,2160]]
      :engineName==="edge"?[[320,568],[1536,770]]:[[320,568],[768,1024],[1536,770],[3840,2160]];
    for(const [width,height]of sizes)for(const open of[false,true])for(const theme of["light","dark"]){
      const capture=!open&&((width===320&&theme==="light")||(width===3840&&theme==="dark"))
        ||(width===1536&&open&&theme==="light");
      await render(width,height,open,theme,"e0921000-0000-0000-0000-000000000001","ready",1,capture);
    }
    if(engineName==="chromium")await render(1920,1080,false,"light","e0921000-0000-0000-0000-000000000002","ready",2,true);
    await render(1366,768,false,"light","e0921000-0000-0000-0000-000000000002","history-error",1,false);
  }else{
  for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]])for(const open of [false,true])for(const theme of ["light","dark"])await render(width,height,open,theme,"e0921000-0000-0000-0000-000000000001");
  await render(390,844,false,"light","e0921000-0000-0000-0000-000000000002");
  await render(768,385,false,"dark","e0921000-0000-0000-0000-000000000002");
  await render(1366,768,false,"light","e0921000-0000-0000-0000-000000000002","history-error");
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close()}
const files=["src/components/tenant-shell/TenantCommandCenterShell.tsx","src/components/tenant-relationships/TenantRelationshipsClientsWorkspace.tsx","src/components/tenant-relationships/OwnerPortalDashboard.tsx","src/components/tenant-relationships/PortalInvitationHistory.tsx","src/components/tenant-relationships/portalInvitationEvidence.ts","src/components/tenant-relationships/portalDashboardModel.ts","src/components/tenant-relationships/PortalInvitationManager.tsx","src/components/tenant-relationships/usePortalInvitations.ts","src/components/tenant-relationships/owner-portal-dashboard.css","scripts/proof/e09-invitation-history-ui/adapter.tsx","scripts/proof/e09-invitation-history-ui/source.tsx","scripts/proof/e09-invitation-history-ui/check.mjs","scripts/proof/e09-dashboard-ui/adapter.tsx"];
if(dialogs)files.push("src/components/ui/dialog.tsx","src/index.css");
if(canonicalPrototype)files.push('scripts/proof/e09-invitation-history-ui/canonical-prototype.tsx','src/components/chat/PaigeConfirmCard.tsx');
if(canonicalCommand)files.push('scripts/proof/e09-invitation-history-ui/canonical-adapter.tsx','src/components/chat/PaigeConfirmCard.tsx','src/components/tenant-relationships/PortalInvitationCommand.tsx','src/components/tenant-relationships/portalInvitationUiDeadline.ts');
const sourceHashes=await Promise.all(files.map(async file=>({file,sha256:createHash("sha256").update(await fs.readFile(path.join(project,file))).digest("hex")})));
await fs.writeFile(path.join(output,"result.json"),JSON.stringify({runtime,sourceHashes,cases,errors,boundary:"Actual owner shell/dashboard/history/parser/hook; SDK/records/Auth are synthetic, network blocked, PAIGE leaf is placeholder. Automated installed binaries/engine builds only; no real customer/provider operation, legitimate cohort, full customer frame, Safari/iOS/Android/physical-device, OS scaling or actual browser zoom acceptance. Only named screenshot cases received visual artifacts; all cases rendered and exercised."},null,2));
console.log(JSON.stringify({runtime,cases:cases.length,errors,output}));
