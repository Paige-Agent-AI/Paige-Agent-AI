// Derived original Clients-workspace proof. All data/door results are fictional.
// Reuses original shell mount; PAIGE placeholder and absent voice remain divergences.
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildLaunchOptions,resolvePlaywright} from '../../live-drive.mjs';
const require=createRequire(import.meta.url),here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../../..');
const actionEntry=process.argv.includes('--action-entry');
const legacyQueue=process.argv.includes('--legacy-queue');
const openingFeedback=process.argv.includes('--opening-feedback');
const fullShell=process.argv.includes('--full-shell');
const out=path.join(repo,'docs/evidence/ui-delivery/assets',fullShell?'exp03-saved-reply-full-shell':openingFeedback?'exp03-saved-reply-opening':legacyQueue?'exp03-legacy-reply-version':actionEntry?'exp03-saved-email-action-entry':'exp03-saved-email-outcome',new Date().toISOString().replaceAll(':','-'));
fs.mkdirSync(out,{recursive:true});
const port=5227,results=[],errors=[],external=[];let server,browser,log='';
// Reuse the original metric implementation; only expose one extra result projection
// for this utility. No copied contrast algorithm and no shared-default mutation.
const metricOwner=fs.readFileSync(path.join(here,'../exp03-composer-inline-check-mount/drive.mjs'),'utf8');
const metricStart=metricOwner.indexOf('function measure() {'),metricEnd=metricOwner.indexOf('\nasync function burnLabel(',metricStart);
assert(metricStart>=0&&metricEnd>metricStart);const metricSource=metricOwner.slice(metricStart,metricEnd).trim();
const metricAnchor='    tagged, low, textCount: contrast.length,';assert.equal(metricSource.split(metricAnchor).length,2);
const measureOriginal=new Function('return ('+metricSource.replace(metricAnchor,metricAnchor+' saveContrast: contrast.filter(c=>/^(Save draft|Check save status|Draft saved\\.)/.test(c.text)),')+');')();

const calls=page=>page.evaluate(()=>window.__harness.rpc.filter(x=>x.name==='functions:comms-email-command').map(x=>x.args));
async function labelMock(page){await page.evaluate(()=>{if(document.querySelector('[data-exp03-proof-label]'))return;const label=document.createElement('div');label.setAttribute('data-exp03-proof-label','');label.textContent='Harness render · fictional data · not live';Object.assign(label.style,{position:'fixed',right:'8px',bottom:'8px',zIndex:'99999',background:'#fff',color:'#17132e',padding:'4px 8px',font:'12px sans-serif',pointerEvents:'none'});document.body.append(label);});}
async function open(page,variant){
 await page.goto(`http://127.0.0.1:${port}/solo/42/clients/conversations?${new URLSearchParams({...variant,...actionEntry?{entry:'action'}:{}})}`,{timeout:180000});
 await page.locator('[data-canonical-conversations]').waitFor({timeout:60000});await page.evaluate(()=>document.fonts.ready);
 await page.locator('[data-thread-key]').filter({hasText:'Jordan Rivera'}).first().click();
 let overlay=null;
 if(variant.paige==='open'&&page.viewportSize().width<=1080){
  overlay=await page.locator('.tcs-paige').evaluate(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height,left:r.left,top:r.top,interiorHit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el,fixtureFolded:true,hostProof:false,backdrop:'not mounted by original harness'};});
  assert.equal(overlay.width,410,'original <=1080 dock overlay width');assert.equal(overlay.top,0);assert(overlay.interiorHit,'placeholder overlay must own its actual covered region');
  await page.screenshot({path:path.join(out,`${variant.theme}-${page.viewportSize().width}-modal-overlay.png`)});
  // Boundary control only: the original mount has a PLACEHOLDER dock, no real
  // fold button. This does not establish E08/native dock-close behavior.
  await page.evaluate(()=>{document.querySelector('[data-tenant-shell]').dataset.paige='closed';document.querySelector('.tcs-paige').hidden=true;});
 }
 await page.getByRole('button',{name:actionEntry?'Edit and review reply':'Edit',exact:true}).first().click();
 if(!legacyQueue)await page.getByRole('button',{name:'Save draft',exact:true}).waitFor();return overlay;
}
try{
 const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
 server=spawn(process.execPath,[vite,'--config',path.join(here,'vite.config.ts'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Owned Vite startup timeout: '+log.slice(-2000))),60000);const data=b=>{log+=String(b);if(log.includes('ready in')){clearTimeout(timeout);resolve();}};server.stdout.on('data',data);server.stderr.on('data',data);server.on('error',reject);server.on('exit',c=>{clearTimeout(timeout);reject(Error('Owned Vite exited '+c+': '+log.slice(-2000)));});});
 const {chromium}=await resolvePlaywright();browser=await chromium.launch(buildLaunchOptions());
 if(fullShell)for(const theme of ['light','dark'])for(const[width,height]of (process.argv.includes('--smoke')?[[1366,768]]:[[1536,770],[1366,768],[1024,768],[900,1000]]))for(const paige of ['closed','open']){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
  const blockedFontStyles=[];
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();if(u.hostname==='fonts.googleapis.com'){blockedFontStyles.push(u.origin);return route.fulfill({status:200,contentType:'text/css',body:'/* External font stylesheet withheld; existing local fixture fonts only. */'});}external.push(u.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const diagnostics=[];page.on('console',m=>{if(m.type()==='error')diagnostics.push(m.text().slice(0,500));});page.on('response',r=>{if(r.status()>=400)diagnostics.push(`${r.status()} ${r.url()}`);});
  try{
   await page.goto(`http://127.0.0.1:${port}/solo/42/clients/conversations?${new URLSearchParams({theme,shell:'real',opening:'hold'})}`,{timeout:180000});
   await page.locator('[data-canonical-conversations]').waitFor({timeout:60000});await page.evaluate(()=>document.fonts.ready);
   if(await page.locator('[data-tenant-shell]').getAttribute('data-paige')==='open')await page.locator('#tenant-paige-workspace').getByRole('button',{name:'Fold PAIGE conversation',exact:true}).click();
   await page.locator('[data-thread-key]').filter({hasText:'Jordan Rivera'}).first().click();
   const edit=page.getByRole('button',{name:'Edit',exact:true}).first();await edit.focus();await edit.press('Space');
   const pending=page.getByRole('status').filter({hasText:'Opening saved reply…'});await pending.waitFor();assert(await edit.isDisabled());
   const textarea=page.locator('[data-composer-writing-surface="true"] textarea');
   if(paige==='open'){
    await page.getByRole('button',{name:'Direct PAIGE',exact:true}).click();await page.locator('#tenant-paige-workspace').waitFor({state:'visible'});
   }else await pending.scrollIntoViewIfNeeded();
   await labelMock(page);await page.screenshot({path:path.join(out,`${theme}-${width}-${paige}-pending.png`)});
   const geometry=await page.evaluate(()=>{const shell=document.querySelector('[data-tenant-shell]'),status=[...document.querySelectorAll('[role="status"]')].find(e=>e.textContent==='Opening saved reply…'),r=status.getBoundingClientRect(),dock=document.querySelector('#tenant-paige-workspace'),d=dock.getBoundingClientRect();return{shellTheme:shell.getAttribute('data-pg'),shellPaige:shell.getAttribute('data-paige'),rootScrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,status:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},dock:{x:d.x,y:d.y,width:d.width,height:d.height},placeholder:!!document.querySelector('[aria-label="PAIGE dock (harness placeholder)"]')};});
   assert.equal(geometry.shellTheme,theme);assert.equal(geometry.shellPaige,paige);assert.equal(geometry.placeholder,false);assert(geometry.rootScrollWidth<=width+1,'no document horizontal scroll');
   await page.evaluate(()=>window.__harness.releaseOpeningRead());await page.getByRole('button',{name:'Save draft',exact:true}).waitFor({state:'attached'});assert.equal(await textarea.inputValue(),'Saved original reply words.');
   if(paige==='open'){
    assert.equal(await textarea.evaluate(el=>document.activeElement===el),false,'opening source must not steal focus from PAIGE');
    await page.locator('#tenant-paige-workspace').getByRole('button',{name:'Fold PAIGE conversation',exact:true}).click();
   }else assert(await textarea.evaluate(el=>document.activeElement===el),'initiating keyboard focus returns to original editor');
   await textarea.scrollIntoViewIfNeeded();const focusBounds=await textarea.evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};});
   assert(focusBounds.left>=0&&focusBounds.right<=width+1&&focusBounds.top>=0&&focusBounds.bottom<=height+1,'original editor reachable after fold');
   assert.equal((await calls(page)).length,0);await page.screenshot({path:path.join(out,`${theme}-${width}-${paige}-settled.png`)});
   results.push({name:`${theme}-${width}-${paige}`,pass:true,geometry,focusBounds,blockedFontStyles,writerCalls:0,proof:'original shell and PAIGE renderer; fictional ports/local fixture fonts, not authenticated/second-tenant/native-zoom proof'});
  }catch(error){await page.screenshot({path:path.join(out,`${theme}-${width}-${paige}-failure.png`)});results.push({pass:false,diagnostics,serverLog:log.slice(-5000),visibleText:(await page.locator('body').innerText()).slice(0,2000)});throw error;}finally{await context.close();}
 }
 if(openingFeedback)for(const theme of ['light','dark'])for(const width of [1366,900])for(const how of ['keyboard','other-focus','newer-words']){
  const context=await browser.newContext({viewport:{width,height:width===900?1000:768},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();external.push(u.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(`http://127.0.0.1:${port}/solo/42/clients/conversations?${new URLSearchParams({theme,paige:'closed',opening:'hold'})}`,{timeout:180000});
   await page.locator('[data-canonical-conversations]').waitFor();await page.evaluate(()=>document.fonts.ready);
   await page.locator('[data-thread-key]').filter({hasText:'Jordan Rivera'}).first().click();
   const edit=page.getByRole('button',{name:'Edit',exact:true}).first(),textarea=page.locator('[data-composer-writing-surface="true"] textarea');
   await edit.focus();await edit.press('Space');
   const pending=page.getByRole('status').filter({hasText:'Opening saved reply…'});await pending.waitFor();assert(await edit.isDisabled());
   assert.equal((await calls(page)).length,0,'opening never invokes writer');
   await labelMock(page);await pending.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`${theme}-${width}-${how}-pending.png`)});
   if(how==='other-focus')await page.getByRole('button',{name:'Attach',exact:true}).focus();
   if(how==='newer-words')await textarea.fill('Keep my newer unsent words.');
   await page.evaluate(()=>window.__harness.releaseOpeningRead());
   if(how==='newer-words'){
    await page.getByText('Your reply changed while opening the saved email. Keep or clear your current reply, then reopen it.',{exact:true}).waitFor();
    assert.equal(await textarea.inputValue(),'Keep my newer unsent words.');assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).count(),0);
   }else{
    await page.getByRole('button',{name:'Save draft',exact:true}).waitFor();assert.equal(await textarea.inputValue(),'Saved original reply words.');
    const target=how==='keyboard'?textarea:page.getByRole('button',{name:'Attach',exact:true});
    assert(await target.evaluate(el=>document.activeElement===el),'opening restores initiating keyboard focus but preserves a different connected control');
   }
   assert.equal(await pending.count(),0);assert.equal((await calls(page)).length,0,'read-only opening and recovery never check/save/send');
   await page.screenshot({path:path.join(out,`${theme}-${width}-${how}-settled.png`)});
   results.push({name:`${theme}-${width}-${how}`,pass:true,openingVisible:true,writerCalls:0,proof:'controlled original workspace; fictional source; not authenticated/provider/Hub proof'});
  }finally{await context.close();}
 }
 const variants=(openingFeedback||fullShell)?[]:legacyQueue?['light','dark'].flatMap(theme=>['missing','invalid'].map(queueVersion=>({theme,queueVersion,paige:'closed',w:1366,h:768}))):(process.argv.includes('--accepted-only')||process.argv.includes('--reflow-only'))?[]:process.argv.includes('--smoke')?[{theme:'light',paige:'closed',w:1366,h:768}]:['light','dark'].flatMap(theme=>['closed','open'].flatMap(paige=>[[1536,770],[1366,768],[1024,768],[900,1000]].map(([w,h])=>({theme,paige,w,h}))));
 for(const variant of variants){
  const context=await browser.newContext({viewport:{width:variant.w,height:variant.h},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol))return route.continue();external.push(url.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   const overlay=await open(page,{theme:variant.theme,paige:variant.paige,door:'ok',...legacyQueue?{queueVersion:variant.queueVersion}:{}});
   if(legacyQueue){
    await labelMock(page);await page.screenshot({path:path.join(out,`${variant.theme}-${variant.queueVersion}-opened.png`)});
    assert.equal(await page.locator('[data-composer-writing-surface="true"] textarea').inputValue(),'Saved original reply words.','legacy original reply opens for review');
    assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).count(),0,'missing/unreadable version never grants Save');
    assert.equal((await calls(page)).length,0,'opening never dispatches');
    await page.getByRole('button',{name:'Review reply',exact:true}).click();await page.getByRole('button',{name:'Approve',exact:true}).waitFor();
    const reviewed=await calls(page);assert.equal(reviewed.length,1);assert.equal(reviewed[0].approval_id,'e0300000-0000-4000-8000-0000000b0002');
    assert.equal(reviewed[0].command.body,'Saved original reply words.');assert.equal(reviewed[0].save_draft,undefined);assert.equal(reviewed[0].draft_source,undefined);assert.equal(reviewed[0].action_draft_source,undefined);assert.equal(reviewed[0].approved_fingerprint,undefined);
    results.push({name:`${variant.theme}-${variant.queueVersion}-original-review`,pass:true,saveWithheld:true,proof:'controlled original workspace; no approval/send/authenticated claim'});continue;
   }
   const words='Saved durable reply for the original conversation.',textarea=page.locator('[data-composer-writing-surface="true"] textarea');
   if(actionEntry){await labelMock(page);await page.screenshot({path:path.join(out,`${variant.theme}-${variant.w}-${variant.paige}-before-save.png`)});}
   await textarea.fill(words);const save=page.getByRole('button',{name:'Save draft',exact:true});await save.focus();await save.press('Space');
   await page.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor({timeout:10000});
   if(actionEntry)assert(await textarea.evaluate(el=>document.activeElement===el),'successful Save restores keyboard focus to original editor');
   let invoked=await calls(page);assert.equal(invoked.length,1);assert.equal(invoked[0].save_draft,true);assert.equal(invoked[0].approved_fingerprint,undefined);
   const measurement=await save.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,viewport:{w:innerWidth,h:innerHeight},scrollWidth:document.documentElement.scrollWidth,color:s.color,background:s.backgroundColor,focus:document.activeElement===el};});
   const originalMetrics=await page.evaluate(measureOriginal);
   assert(originalMetrics.saveContrast.some(c=>c.text==='Save draft'),'Save contrast actually measured');
   assert(originalMetrics.saveContrast.every(c=>c.disabled||c.incidental||c.ratio>=4.5),'new saved-email utility text contrast');
   assert(measurement.width>=24&&measurement.height>=24,'Save target');assert(measurement.x>=0&&measurement.y>=0&&measurement.right<=variant.w&&measurement.bottom<=variant.h,'Save reachability');assert(measurement.scrollWidth<=variant.w+1,'horizontal overflow');
   await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).first().click();await save.waitFor();assert.equal(await textarea.inputValue(),words);assert.equal((await calls(page)).length,1,'reopen does not send/check');
   await labelMock(page);
   const name=`${variant.theme}-${variant.w}-${variant.paige}`;await page.screenshot({path:path.join(out,name+'.png')});results.push({name,pass:true,overlay,measurement,originalMetrics,saveCalls:1,reopenWords:true,proof:'controlled original workspace; not authenticated/provider/Hub-host proof'});
  }finally{await context.close();}
 }
 if(!fullShell&&!openingFeedback&&!legacyQueue&&!process.argv.includes('--smoke')&&!process.argv.includes('--reflow-only'))for(const theme of ['light','dark'])for(const recovery of (process.argv.includes('--accepted-only')?['accepted']:['save-unknown','save-refuse','accepted'])){
  const context=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();external.push(u.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   await open(page,{theme,paige:'closed',door:recovery==='accepted'?'ok':recovery});
   const textarea=page.locator('[data-composer-writing-surface="true"] textarea'),words='Recovery preserves the original saved reply.';
   await textarea.fill(words);await page.getByRole('button',{name:'Save draft',exact:true}).click();
   if(recovery==='save-unknown'){
    const check=page.getByRole('button',{name:'Check save status',exact:true});await check.waitFor();assert(await textarea.isDisabled());
    if(actionEntry)assert(await check.evaluate(el=>document.activeElement===el),'uncertain Save focuses original recovery control');
    await check.click();await page.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor();
    const log=await calls(page);assert.equal(log.length,2);assert.deepEqual(log[0],log[1]);assert(log.every(x=>x.save_draft===true));assert.equal(await textarea.inputValue(),words);
   }else if(recovery==='save-refuse'){
    await page.waitForFunction(()=>document.querySelector('[data-composer-writing-surface="true"] textarea')?.disabled===false);
    assert.equal((await calls(page)).length,1);assert.equal(await textarea.inputValue(),words);assert.equal(await page.getByText('Draft saved. Nothing sent.',{exact:false}).count(),0);
   }else{
    await page.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor();await page.locator('[data-composer-send]').click();
    const confirm=page.locator('[data-strip-focus="confirm"]');await confirm.waitFor();let log=await calls(page);
    assert.equal(log.length,2);assert.equal(log[1].approved_fingerprint,undefined);assert.equal(log[1].draft_source.message_id,actionEntry?'e0300000-0000-4000-8000-0000000f0001':log[0].draft_source.message_id);
    assert.notEqual(log[1].draft_source.updated_at,(log[0].draft_source??log[0].action_draft_source).updated_at);await confirm.click();
    await page.waitForFunction(()=>window.__harness.rpc.filter(x=>x.name==='functions:comms-email-command').length===3);
    log=await calls(page);assert.equal(log[2].operation_id,log[1].operation_id);assert.equal(log[2].approved_fingerprint,'0123456789abcdef');assert.equal(log[2].approval_id,log[1].approval_id);
    await page.waitForFunction(()=>document.querySelector('[data-governed-reply-status]')?.textContent==='Accepted by the email service.');
    assert((await page.getByText('Accepted',{exact:true}).count())>=1,'visible acceptance receipt');
    await page.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor({state:'hidden',timeout:1500});
    assert.equal(await page.getByText('Delivered',{exact:true}).count(),0,'acceptance is never delivery');assert.equal(await textarea.inputValue(),'');
   }
   await page.screenshot({path:path.join(out,`${theme}-${recovery}.png`)});results.push({name:`${theme}-${recovery}`,pass:true,calls:(await calls(page)).length,proof:'fictional door boundary; no provider/authenticated or real Hub-host proof'});
  }finally{await context.close();}
 }
 // Pointer setup selects the original conversation and opens its saved draft.
 // From that entry, exercise editing/save/cancel/reopen/check/approve only by keyboard.
 if(!fullShell&&!openingFeedback&&!legacyQueue&&!process.argv.includes('--smoke')&&!process.argv.includes('--accepted-only')&&!process.argv.includes('--reflow-only'))for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();external.push(u.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const tabTo=async selector=>{for(let i=0;i<100;i++){if(await page.evaluate(sel=>document.activeElement?.matches(sel),selector))return;await page.keyboard.press('Tab');}throw new Error('Keyboard target unreachable: '+selector);};
  try{
   await open(page,{theme,paige:'closed',door:'ok'});
   const textSelector='[data-composer-writing-surface="true"] textarea',words='Keyboard preserves this saved reply.';
   await tabTo(textSelector);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type(words);
   const tabButton=async(name,travel='Tab')=>{for(let i=0;i<100;i++){if(await page.evaluate(n=>document.activeElement?.tagName==='BUTTON'&&document.activeElement.textContent.trim()===n,name))return;await page.keyboard.press(travel);}throw new Error('Keyboard button unreachable: '+name);};
   await tabButton('Save draft');await page.keyboard.press('Enter');await page.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor();
   await tabButton('Cancel','Shift+Tab');await page.keyboard.press('Enter');await tabButton('Edit');await page.keyboard.press('Enter');
   assert.equal(await page.locator(textSelector).inputValue(),words);assert.equal((await calls(page)).length,1);
   await tabTo('[data-composer-send]');await page.keyboard.press('Enter');await page.locator('[data-strip-focus="confirm"]').waitFor();
   await tabTo('[data-strip-focus="confirm"]');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelector('[data-governed-reply-status]')?.textContent==='Accepted by the email service.');
   assert.equal((await calls(page)).length,3);await page.screenshot({path:path.join(out,`${theme}-keyboard-saved-entry.png`)});
   results.push({name:`${theme}-keyboard-saved-entry`,pass:true,pointerSetup:'original conversation selection and saved Edit entry',keyboard:'edit/save/cancel/reopen/check/approve',proof:'controlled workspace only; no authenticated/host/native zoom claim'});
  }finally{await context.close();}
 }
 // CSS viewport observed during the separate native 200% Chrome drive (1134x762 -> 567x381).
 // This repeatable viewport check is not itself native browser zoom or authenticated-host proof.
 if(!fullShell&&!openingFeedback&&!legacyQueue&&!process.argv.includes('--smoke')&&!process.argv.includes('--accepted-only'))for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:567,height:381},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();external.push(u.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   await open(page,{theme,paige:'closed',door:'ok'});
   if(actionEntry){await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor();}
   await page.getByRole('button',{name:'Send edited',exact:true}).click();
   await page.waitForFunction(()=>document.activeElement?.matches('[data-strip-focus="edit"]'));
   const focus=await page.evaluate(()=>{const e=document.activeElement,r=e.getBoundingClientRect();return{text:e.textContent.trim(),x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height,viewport:{w:innerWidth,h:innerHeight},visible:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};});
   await page.screenshot({path:path.join(out,`${theme}-reflow-review-focus.png`)});
   assert.equal(focus.text,'Edit','check never focuses the approval action');assert(focus.visible,'inline check focus must be revealed in the existing scroll owner');
   assert.equal((await calls(page)).length,actionEntry?2:1);assert.equal((await calls(page)).at(-1).approved_fingerprint,undefined);
   results.push({name:`${theme}-reflow-review-focus`,pass:true,focus,proof:'repeatable 567x381 CSS reflow; separate native zoom observation; no provider/authenticated/full host claim'});
  }finally{await context.close();}
 }
 assert.deepEqual(errors,[],'page errors');assert.deepEqual(external,[],'off-machine requests');
 console.log(JSON.stringify({cases:results.length,pageErrors:errors.length,offMachineRequests:external.length,out}));
}catch(error){results.push({pass:false,error:String(error)});throw error;}
finally{
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,external,proof:'LOCAL_CONTROLLED_WORKSPACE',voice:'UNEXERCISED',paige:fullShell?'ORIGINAL_SHELL_AND_WORKSPACE_FICTIONAL_PORTS':'PLACEHOLDER',nativeBrowserZoom:'UNVERIFIED'},null,2));
 try{await browser?.close();}finally{if(server&&server.exitCode===null){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else server.kill('SIGTERM');}}
}
