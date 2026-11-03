// Real original SoloApp/Team/dialog/CSS, fictional transport. Not Auth/customer/durable proof.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,statfsSync} from 'node:fs';
import {createServer} from 'vite';
import {freemem} from 'node:os';
import {resolvePlaywright,resolveExecutablePath} from '../../live-drive.mjs';
const disk=statfsSync(process.cwd());assert(disk.bavail*disk.bsize>=768*1024*1024,'Insufficient headroom; no browser launched');
assert(freemem()>=1536*1024*1024,'Insufficient available memory for real-SoloApp browser proof; no server/browser launched');
const recoveryOnly=process.argv.includes('--recovery-only');const permissionOnly=process.argv.includes('--permission-only');assert(!(recoveryOnly&&permissionOnly));assert(process.argv.slice(2).every(arg=>['--recovery-only','--permission-only'].includes(arg)));
const out='docs/evidence/ui-delivery/assets/exp08-owner-work-profile';mkdirSync(out,{recursive:true});
const report={scope:'real SoloApp / synthetic local transport / no customer/Auth/provider proof',geometry:[],states:[],failures:[],offMachineRequests:0};
const server=await createServer({configFile:new URL('./team-owner-profile-config.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),logLevel:'error'});
await server.listen();const base=server.resolvedUrls.local[0].replace(/\/$/,'');
assert.equal(new URL(base).hostname,'127.0.0.1');
const {chromium}=await resolvePlaywright();let browser;
async function open(tenant,theme,mode,width=1366,height=768){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();report.offMachineRequests++;return route.abort();});
 await page.goto(`${base}/solo/${tenant==='a'?'3855':'4120'}/settings/team?theme=${theme}&tenant=${tenant}&ownerProfile=${mode}`,{waitUntil:'domcontentloaded',timeout:60000});
 const name=page.getByRole('button',{name:'Taylor Reed, edit details',exact:true});
 try{await name.waitFor({timeout:60000});}catch(error){
  report.failures.push(JSON.stringify({phase:'original Team row mount',url:page.url(),pageErrors:errors,body:(await page.locator('body').innerText().catch(()=>'<unavailable>')).slice(0,8000)}));
  throw error;
 }
 const shell=page.locator('[data-tenant-shell]');if(await shell.getAttribute('data-paige')!=='closed')await page.keyboard.press('Control+Backslash');
 await name.focus();await name.press('Enter');const dialog=page.locator('.stw-modal');await dialog.waitFor();
 return{page,dialog,errors,shell,name};
}
try{
 browser=await chromium.launch({headless:true,...(resolveExecutablePath()?{executablePath:resolveExecutablePath()}:{}),args:['--no-proxy-server']});
 for(const tenant of ((recoveryOnly||permissionOnly)?[]:['a','b']))for(const theme of ['light','dark'])for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]])for(const paige of ['closed','open']){
  const{page,dialog,errors,shell,name}=await open(tenant,theme,'other',width,height);
  assert(await dialog.getByRole('textbox',{name:'Title',exact:true}).getAttribute('readonly')!==null);
  assert.equal(await dialog.getByRole('button',{name:'Save work details',exact:true}).count(),0);
  assert(await dialog.locator('h2').evaluate(el=>el===document.activeElement),'Approved read-only heading initial focus');
  assert((await dialog.locator('#stw-owner-profile-explanation').textContent()).includes('account holder'));
  if(paige==='open')await page.keyboard.press('Control+Backslash');
  await page.waitForFunction(state=>document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige')===state,paige);
  await page.evaluate(()=>document.fonts.ready);
  const geometry=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,documentOverflow:document.documentElement.scrollWidth-innerWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight};});
  assert(geometry.width>0&&geometry.height>0&&geometry.left>=-1&&geometry.right<=width+1&&geometry.top>=-1&&geometry.bottom<=height+1&&geometry.documentOverflow<=1);
  const label=`${tenant}-${theme}-${width}-${paige}`;await page.screenshot({path:`${out}/${label}.png`});
  if(paige==='open')await page.keyboard.press('Control+Backslash');
  await page.waitForFunction(()=>document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige')==='closed');
  const close=dialog.locator('.stw-modal-actions').getByRole('button',{name:'Close',exact:true});
  let reachable=false;for(let i=0;i<40;i++){if(await close.evaluate(el=>el===document.activeElement)){reachable=true;break;}await page.keyboard.press('Tab');}
  assert(reachable,'Read-only Close reachable by keyboard');await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert(await name.evaluate(el=>el===document.activeElement),'Return focus to original Team row');
  assert.equal(await page.evaluate(()=>window.__ownerProfileEvidence.attempts.length),0);assert.equal(errors.length,0,errors.join('\n'));
  report.geometry.push({label,geometry,keyboardClose:true,returnFocus:true,syntheticWrites:0,errors});await page.close();
 }
 for(const mode of (permissionOnly?[]:recoveryOnly?['committed-unknown']:['holder','self','unknown','missing','foreign','transport','refusal','committed-unknown'])){
  const{page,dialog,errors}=await open('a','dark',mode);
  const save=dialog.getByRole('button',{name:'Save work details',exact:true});
  if(mode==='unknown'){assert.equal(await save.count(),0);report.states.push({mode,readOnly:true});await page.close();continue;}
  await dialog.getByRole('textbox',{name:'Title',exact:true}).fill('Verified delivery lead');await save.click();
  if(['holder','self'].includes(mode)){
   await page.getByText('Work details saved. Permission was not changed.',{exact:true}).first().waitFor();
   await page.waitForFunction(()=>document.querySelector('input[placeholder="e.g. Client Success Manager"]')?.value==='Verified delivery lead');
  }else{
   await page.getByText(/Reopen Team/).first().waitFor();assert.equal(await dialog.getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Verified delivery lead');
   if(mode!=='refusal')assert(await save.isDisabled(),'Unknown outcome requires reconcile before repeat');
  }
  if(mode==='committed-unknown'){
   await dialog.locator('.stw-modal-actions').getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});
   const row=page.getByRole('button',{name:'Taylor Reed, edit details',exact:true});await row.waitFor();await row.click();await dialog.waitFor();
   assert.equal(await dialog.getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Verified delivery lead');
   assert(await dialog.getByRole('button',{name:'Save work details',exact:true}).isDisabled(),'Actual original roster reopens committed values without a duplicate save');
   await page.screenshot({path:`${out}/committed-unknown-reopened.png`});
  }
  assert.equal(await page.evaluate(()=>window.__ownerProfileEvidence.attempts.length),1);assert.equal(errors.length,0,errors.join('\n'));
  report.states.push({mode,attempts:1,errors});await page.close();
 }
 for(const mode of (permissionOnly?['permission-success','permission-drafts','permission-unknown']:[])){
  const{page,dialog,errors}=await open('a','dark',mode);
  if(mode==='permission-drafts')await dialog.getByRole('textbox',{name:'Title',exact:true}).fill('Unsent delivery title');
  await dialog.locator('.stw-permission-change').getByRole('radio',{name:/Admin/}).click();
  await dialog.getByRole('button',{name:'Confirm access change',exact:true}).click();
  if(mode==='permission-unknown'){
   await page.getByText(/Reopen Team/).first().waitFor();
   assert(await dialog.locator('.stw-permission-change').getByRole('radio',{name:/Admin/}).isDisabled());
  }else{
   await page.getByText('Admin access confirmed.',{exact:true}).first().waitFor();
   if(mode==='permission-success')await dialog.waitFor({state:'detached'});
   else assert.equal(await dialog.getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Unsent delivery title');
  }
  if(mode!=='permission-success'){
   await page.screenshot({path:`${out}/${mode}.png`});
   await dialog.locator('.stw-modal-actions').getByRole('button',{name:mode==='permission-drafts'?'Cancel':'Close',exact:true}).click();await dialog.waitFor({state:'detached'});
  }
  await page.getByRole('button',{name:'Taylor Reed, edit details',exact:true}).click();await dialog.waitFor();
  assert.equal(await dialog.locator('.stw-permission-change [role="radio"][aria-checked="true"]').textContent().then(t=>t.includes('Admin')),true);
  assert.equal(await dialog.getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Delivery lead');
  assert.equal(await page.evaluate(()=>window.__ownerProfileEvidence.attempts.length),1);
  assert.equal(errors.length,0,errors.join('\n'));
  await page.screenshot({path:`${out}/${mode}-reopened.png`});
  report.states.push({mode,attempts:1,reopened:true,errors});await page.close();
 }
 assert.equal(report.geometry.length,(recoveryOnly||permissionOnly)?0:32);assert.equal(report.states.length,permissionOnly?3:recoveryOnly?1:8);
}catch(error){report.failures.push(String(error));console.error(String(error));throw error;}
finally{writeFileSync(`${out}/${permissionOnly?'permission-report.json':recoveryOnly?'recovery-report.json':'report.json'}`,JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();await server.close();}
console.log(JSON.stringify({geometry:report.geometry.length,states:report.states.length,failures:report.failures,scope:report.scope}));
