// Original real-shell negative-state render. Synthetic transport only, never a provider or signed-in account.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out='docs/evidence/ui-delivery/assets/exp08-team-hub-uncapped';
mkdirSync(out,{recursive:true});
const report={label:'harness render · synthetic data · not live',records:[],failures:[]};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-proxy-server']});
try {
 for(const tenant of ['a','b']) for(const theme of ['dark','light']) for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]]) for(const paige of ['closed','open']) {
  const page=await browser.newPage({viewport:{width,height}});const errors=[];const remote=[];
  page.on('pageerror',error=>errors.push(String(error).slice(0,180)));
  await page.route('**/*',route=>{const url=new URL(route.request().url());
   if(url.hostname==='127.0.0.1')return route.continue();remote.push(url.origin);return route.abort();});
  const account=tenant==='b'?'4120':'3855';
  await page.goto(`http://127.0.0.1:5297/solo/${account}/team-hub?theme=${theme}&tenant=${tenant}&agentOutcome=rate_limited&message=e8000000-0000-4000-8000-0000000b0042`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('.th-list').waitFor();
  if(await page.locator('[data-tenant-shell]').getAttribute('data-paige')!=='closed')await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).first().click();
  const thread=page.locator('aside[aria-label="Thread"]');await thread.waitFor();
  const ask=thread.getByRole('button',{name:'Ask again',exact:true});await ask.waitFor({timeout:20000});await ask.focus();await ask.press('Enter');
  const failure=thread.locator('.th-ag-fail').filter({hasText:'Too many requests right now. Try again shortly.'});await failure.waitFor({timeout:20000});
  await failure.scrollIntoViewIfNeeded();
  if(paige==='open')await page.locator('[data-tenant-paige-command]').click();
  await page.waitForTimeout(350);
  const measured=await failure.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {
   text:el.textContent,role:el.getAttribute('role'),failureStatuses:document.querySelectorAll('.th-ag-fail[role="status"]').length,announcement:document.querySelector('.th-sr[aria-live="polite"][role="status"]')?.textContent,agentColour:el.hasAttribute('data-ag'),actions:el.querySelectorAll('button').length,
   rect:{x:r.x,y:r.y,w:r.width,h:r.height},covered:!hit||!el.contains(hit),
   overflowX:document.documentElement.scrollWidth-innerWidth,overflowY:document.documentElement.scrollHeight-innerHeight,
   paige:document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige')};});
  const name=`${tenant}-${theme}-${width}-${paige}`;
  await page.evaluate(label=>{const e=document.createElement('div');e.textContent=label;e.style.cssText='position:fixed;bottom:4px;left:4px;background:#111;color:white;padding:3px 6px;font:11px sans-serif;z-index:2147483647';document.body.append(e);},report.label);
  await page.screenshot({path:`${out}/${name}.png`});
  if(paige==='open'){
   await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).first().click();
   await failure.waitFor();await failure.scrollIntoViewIfNeeded();
  }
  const restored=await failure.isVisible();
  const invokes=await page.evaluate(()=>window.__harnessCalls.calls.filter(name=>name.startsWith('invoke:')));
  report.records.push({name,tenant,theme,width,height,...measured,restored,invokes,errors,blockedRemote:remote});
  // Ask-again outcomes use their own status row; approval-card announcements use the separate shared region.
  if(measured.text!=='Too many requests right now. Try again shortly.'||measured.role!=='status'||measured.failureStatuses!==1||measured.announcement!==''||measured.agentColour||measured.actions!==0
   ||measured.rect.w<=0||measured.rect.h<=0||measured.overflowX>1||measured.overflowY>1||measured.paige!==paige
   ||(paige==='closed'&&measured.covered)||!restored||invokes.length!==1||invokes[0]!=='invoke:paige-ai-chat'||errors.length)report.failures.push(name);
  await page.close();
 }
} catch(error) {report.failures.push(String(error).slice(0,300));throw error;}
finally {await browser.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({records:report.records.length,failures:report.failures},null,2));
if(report.failures.length)process.exitCode=1;
