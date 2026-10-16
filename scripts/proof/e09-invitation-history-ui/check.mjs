import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright";
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.join(project, "docs/evidence/ui-delivery/assets/e09-invitation-history");
await fs.mkdir(output, { recursive: true });
const adapter = path.join(project, "scripts/proof/e09-invitation-history-ui/adapter.tsx");
const replace = /^(?:@\/(?:hooks\/(?:useTenantContext|useBrandKit|usePortalConfig|useRailEvents|useTierFeatures)|integrations\/supabase\/client|lib\/playbook|components\/ui\/paige|components\/admin\/voice\/DialPadTrigger|components\/dashboard\/PaigeAIChat|components\/tenant-calendar\/TenantCanonicalCalendarWorkspace)|\.\/(?:useTenantRelationshipsData|ClientStanding|PeopleContactEditor))$/;
const bundled = await build({ entryPoints: [path.join(project,"scripts/proof/e09-invitation-history-ui/source.tsx")], bundle:true,write:false,format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"production"',"import.meta.env.DEV":"false"},plugins:[{name:"explicit-read-only-transport",setup(api){
  api.onResolve({filter:replace},()=>({path:adapter}));
  api.onResolve({filter:/^next-themes$/},()=>({path:adapter}));
  api.onResolve({filter:/^@\/pages\/admin\/(ClientsConversations|CalendarAdmin)$/},()=>({path:adapter}));
  api.onResolve({filter:/^@\/components\/admin\/contacts\/ContactPortalPanel$/},()=>({path:adapter}));
}}]});
let css=(await Promise.all((await fs.readdir(path.join(project,"dist/assets"))).filter(f=>f.endsWith(".css")).map(f=>fs.readFile(path.join(project,"dist/assets",f),"utf8")))).join("\n");
for(const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]){
  const url=match[1].replace(/["']/g,""); if(!url.startsWith("/assets/"))continue;
  const bytes=await fs.readFile(path.join(project,"dist",url.slice(1))); css=css.replaceAll(match[0],"url(data:font/woff2;base64,"+bytes.toString("base64")+")");
}
const launch={headless:true};try{await fs.access(chromium.executablePath())}catch{launch.executablePath="C:/Program Files/Google/Chrome/Application/chrome.exe"}
const browser=await chromium.launch(launch),cases=[],errors=[];
async function render(width,height,open,theme,tenant,state="ready"){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
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
    const summary=history.locator("summary").first();await summary.focus();await page.keyboard.press("Enter");
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
  const filename=width+"-"+height+"-"+(open?"open":"closed")+"-"+theme+"-"+tenant.slice(-1)+"-"+state+".png";
  await page.screenshot({path:path.join(output,filename)});
  const snapshot=await page.evaluate(()=>window.invitationProof());assert(snapshot.calls.every(name=>["can_manage_tenant_brand","client_portal_owner_invitations"].includes(name)));
  cases.push({width,height,open,theme,tenant,state,geometry,filename,snapshot,focusOutline,keyboardDisclosure:state==="ready"});await page.close();
}
try{
  for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]])for(const open of [false,true])for(const theme of ["light","dark"])await render(width,height,open,theme,"e0921000-0000-0000-0000-000000000001");
  await render(390,844,false,"light","e0921000-0000-0000-0000-000000000002");
  await render(768,385,false,"dark","e0921000-0000-0000-0000-000000000002");
  await render(1366,768,false,"light","e0921000-0000-0000-0000-000000000002","history-error");
  assert.deepEqual(errors,[]);
}finally{await browser.close()}
const files=["src/components/tenant-shell/TenantCommandCenterShell.tsx","src/components/tenant-relationships/TenantRelationshipsClientsWorkspace.tsx","src/components/tenant-relationships/OwnerPortalDashboard.tsx","src/components/tenant-relationships/PortalInvitationHistory.tsx","src/components/tenant-relationships/portalInvitationEvidence.ts","src/components/tenant-relationships/portalDashboardModel.ts","src/components/tenant-relationships/PortalInvitationManager.tsx","src/components/tenant-relationships/usePortalInvitations.ts","src/components/tenant-relationships/owner-portal-dashboard.css","scripts/proof/e09-invitation-history-ui/adapter.tsx","scripts/proof/e09-invitation-history-ui/source.tsx","scripts/proof/e09-invitation-history-ui/check.mjs","scripts/proof/e09-dashboard-ui/adapter.tsx"];
const sourceHashes=await Promise.all(files.map(async file=>({file,sha256:createHash("sha256").update(await fs.readFile(path.join(project,file))).digest("hex")})));
await fs.writeFile(path.join(output,"result.json"),JSON.stringify({sourceHashes,cases,errors,boundary:"Actual owner shell/dashboard/history/parser/hook; SDK/records/Auth are synthetic, network blocked, PAIGE leaf is placeholder. No real customer/provider operation, legitimate cohort, full customer frame, physical-device or zoom acceptance."},null,2));
console.log(JSON.stringify({cases:cases.length,errors,output}));
