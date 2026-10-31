// Real SoloApp render with fictional read/refusal ports. No customer/Auth/RLS proof.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,statfsSync} from 'node:fs';
import {resolvePlaywright,resolveExecutablePath} from '../../live-drive.mjs';
const base=process.env.TEAM_DEPARTURE_URL??'http://127.0.0.1:5298';
assert.equal(new URL(base).hostname,'127.0.0.1','Disposable local mount only');
const disk=statfsSync(process.cwd());
assert(disk.bavail*disk.bsize>=768*1024*1024,'Insufficient local disk headroom for this browser proof; no browser started');
const out='docs/evidence/ui-delivery/assets/exp08-protected-departure';
mkdirSync(out,{recursive:true});
const report={scope:'real SoloApp / synthetic transport / not authenticated / no membership effect',records:[],failures:[]};
const {chromium}=await resolvePlaywright();
const browser=await chromium.launch({headless:true,...(resolveExecutablePath()?{executablePath:resolveExecutablePath()}:{}),args:['--no-proxy-server']});
try{
 for(const tenant of ['a','b'])for(const theme of ['light','dark'])for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]])for(const paige of ['closed','open']){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const name=tenant==='a'?'Priya Nair':'Rowan Parker',account=tenant==='a'?'3855':'4120';
  await page.goto(`${base}/solo/${account}/settings/team?theme=${theme}&tenant=${tenant}`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:`Actions for ${name}`,exact:true}).waitFor({timeout:45000});
  const shell=page.locator('[data-tenant-shell]');
  if(await shell.getAttribute('data-paige')!=='closed')await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).first().click();
  const open=async()=>{
   await page.getByRole('button',{name:`Actions for ${name}`,exact:true}).focus();
   await page.keyboard.press('Enter');await page.getByRole('menuitem',{name:/Remove from team/}).press('Enter');
   await page.locator('.stw-drawer').getByText(`${name} holds nothing to hand over`,{exact:true}).waitFor();
  };
  await open();
  const drawer=page.locator('.stw-drawer');await drawer.getByRole('button',{name:'Continue',exact:true}).press('Enter');
  await drawer.getByRole('button',{name:`Remove ${name}`,exact:true}).press('Enter');
  const alert=drawer.getByRole('alert'),expected=`${name}'s Paige account is protected, so they can't be removed from the business here. Nothing changed.`;
  await alert.getByText(expected,{exact:true}).waitFor();
  assert(await drawer.getByRole('button',{name:'Try again',exact:true}).isDisabled());
  assert.equal(await page.evaluate(()=>window.__departureEvidence.attempts.length),1);
  const measure=()=>alert.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {
   width:r.width,height:r.height,overflow:document.documentElement.scrollWidth-innerWidth,text:el.textContent,
   covered:!hit||!el.contains(hit),paige:document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige'),
  };});
  // The original drawer backdrop covers the command field; use the shell's real Ctrl+\ shortcut.
  if(paige==='open')await page.keyboard.press('Control+Backslash');
  await page.waitForFunction(state=>document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige')===state,paige);
  assert.equal(await shell.getAttribute('data-paige'),paige);
  await page.evaluate(()=>document.fonts.ready);
  const capturedGeometry=await measure(),overlayPermitted=paige==='open'&&width<=1080;
  assert.equal(capturedGeometry.paige,paige);assert(capturedGeometry.width>0&&capturedGeometry.height>0&&capturedGeometry.overflow<=1);
  assert.equal(capturedGeometry.text,expected);assert(overlayPermitted||!capturedGeometry.covered,'Refusal must be exposed outside the incumbent narrow PAIGE overlay');
  const label=`${tenant}-${theme}-${width}-${paige}`;
  await page.screenshot({path:`${out}/${label}.png`});
  if(paige==='open')await page.keyboard.press('Control+Backslash');
  await page.waitForFunction(()=>document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige')==='closed');
  await alert.scrollIntoViewIfNeeded();
  const restoredGeometry=await measure();
  assert(restoredGeometry.width>0&&restoredGeometry.height>0&&restoredGeometry.overflow<=1&&!restoredGeometry.covered);
  assert.equal(restoredGeometry.text,expected);assert.equal(restoredGeometry.paige,'closed');
  await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});
  await open();assert.equal(await page.evaluate(()=>window.__departureEvidence.attempts.length),1,'Reopening must not retry removal');
  assert.equal(await drawer.getByRole('alert').count(),0);
  await page.evaluate(next=>window.__harnessSwitchTenant(next),tenant==='a'?'b':'a');
  await drawer.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.__departureEvidence.attempts.length),1,'Workspace switch must not retry removal');
  assert.equal(errors.length,0,errors.join('\n'));report.records.push({label,capturedGeometry,overlayPermitted,restoredGeometry,keyboardActionSequence:true,reopenedWithoutRetry:true,workspaceSwitchClosed:true,errors});
  await page.close();
 }
 assert.equal(report.records.length,32);
}catch(e){report.failures.push(String(e));throw e;}
finally{await browser.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({records:report.records.length,failures:report.failures}));
