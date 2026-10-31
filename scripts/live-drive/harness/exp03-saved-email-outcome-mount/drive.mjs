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
const out=path.join(repo,'docs/evidence/ui-delivery/assets/exp03-saved-email-outcome',new Date().toISOString().replaceAll(':','-'));
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
async function open(page,variant){
 await page.goto(`http://127.0.0.1:${port}/solo/42/clients/conversations?${new URLSearchParams(variant)}`,{timeout:180000});
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
 await page.getByRole('button',{name:'Edit',exact:true}).first().click();
 await page.getByRole('button',{name:'Save draft',exact:true}).waitFor();return overlay;
}
try{
 const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
 server=spawn(process.execPath,[vite,'--config',path.join(here,'vite.config.ts'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Owned Vite startup timeout: '+log.slice(-2000))),60000);const data=b=>{log+=String(b);if(log.includes('ready in')){clearTimeout(timeout);resolve();}};server.stdout.on('data',data);server.stderr.on('data',data);server.on('error',reject);server.on('exit',c=>{clearTimeout(timeout);reject(Error('Owned Vite exited '+c+': '+log.slice(-2000)));});});
 const {chromium}=await resolvePlaywright();browser=await chromium.launch(buildLaunchOptions());
 const variants=process.argv.includes('--smoke')?[{theme:'light',paige:'closed',w:1366,h:768}]:['light','dark'].flatMap(theme=>['closed','open'].flatMap(paige=>[[1536,770],[1366,768],[1024,768],[900,1000]].map(([w,h])=>({theme,paige,w,h}))));
 for(const variant of variants){
  const context=await browser.newContext({viewport:{width:variant.w,height:variant.h},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol))return route.continue();external.push(url.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   const overlay=await open(page,{theme:variant.theme,paige:variant.paige,door:'ok'});
   const words='Saved durable reply for the original conversation.',textarea=page.locator('[data-composer-writing-surface="true"] textarea');
   await textarea.fill(words);const save=page.getByRole('button',{name:'Save draft',exact:true});await save.focus();await save.press('Space');
   await page.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor({timeout:10000});
   let invoked=await calls(page);assert.equal(invoked.length,1);assert.equal(invoked[0].save_draft,true);assert.equal(invoked[0].approved_fingerprint,undefined);
   const measurement=await save.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,viewport:{w:innerWidth,h:innerHeight},scrollWidth:document.documentElement.scrollWidth,color:s.color,background:s.backgroundColor,focus:document.activeElement===el};});
   const originalMetrics=await page.evaluate(measureOriginal);
   assert(originalMetrics.saveContrast.some(c=>c.text==='Save draft'),'Save contrast actually measured');
   assert(originalMetrics.saveContrast.every(c=>c.disabled||c.incidental||c.ratio>=4.5),'new saved-email utility text contrast');
   assert(measurement.width>=24&&measurement.height>=24,'Save target');assert(measurement.x>=0&&measurement.y>=0&&measurement.right<=variant.w&&measurement.bottom<=variant.h,'Save reachability');assert(measurement.scrollWidth<=variant.w+1,'horizontal overflow');
   await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).first().click();await save.waitFor();assert.equal(await textarea.inputValue(),words);assert.equal((await calls(page)).length,1,'reopen does not send/check');
   await page.evaluate(()=>{const label=document.createElement('div');label.textContent='Harness render · fictional data · not live';Object.assign(label.style,{position:'fixed',right:'8px',bottom:'8px',zIndex:'99999',background:'#fff',color:'#17132e',padding:'4px 8px',font:'12px sans-serif',pointerEvents:'none'});document.body.append(label);});
   const name=`${variant.theme}-${variant.w}-${variant.paige}`;await page.screenshot({path:path.join(out,name+'.png')});results.push({name,pass:true,overlay,measurement,originalMetrics,saveCalls:1,reopenWords:true,proof:'controlled original workspace; not authenticated/provider/Hub-host proof'});
  }finally{await context.close();}
 }
 if(!process.argv.includes('--smoke'))for(const theme of ['light','dark'])for(const recovery of ['save-unknown','save-refuse','accepted']){
  const context=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();external.push(u.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   await open(page,{theme,paige:'closed',door:recovery==='accepted'?'ok':recovery});
   const textarea=page.locator('[data-composer-writing-surface="true"] textarea'),words='Recovery preserves the original saved reply.';
   await textarea.fill(words);await page.getByRole('button',{name:'Save draft',exact:true}).click();
   if(recovery==='save-unknown'){
    const check=page.getByRole('button',{name:'Check save status',exact:true});await check.waitFor();assert(await textarea.isDisabled());
    await check.click();await page.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor();
    const log=await calls(page);assert.equal(log.length,2);assert.deepEqual(log[0],log[1]);assert(log.every(x=>x.save_draft===true));assert.equal(await textarea.inputValue(),words);
   }else if(recovery==='save-refuse'){
    await page.waitForFunction(()=>document.querySelector('[data-composer-writing-surface="true"] textarea')?.disabled===false);
    assert.equal((await calls(page)).length,1);assert.equal(await textarea.inputValue(),words);assert.equal(await page.getByText('Draft saved. Nothing sent.',{exact:false}).count(),0);
   }else{
    await page.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor();await page.locator('[data-composer-send]').click();
    const confirm=page.locator('[data-strip-focus="confirm"]');await confirm.waitFor();let log=await calls(page);
    assert.equal(log.length,2);assert.equal(log[1].approved_fingerprint,undefined);assert.equal(log[1].draft_source.message_id,log[0].draft_source.message_id);
    assert.notEqual(log[1].draft_source.updated_at,log[0].draft_source.updated_at);await confirm.click();
    await page.waitForFunction(()=>window.__harness.rpc.filter(x=>x.name==='functions:comms-email-command').length===3);
    log=await calls(page);assert.equal(log[2].operation_id,log[1].operation_id);assert.equal(log[2].approved_fingerprint,'0123456789abcdef');assert.equal(log[2].approval_id,log[1].approval_id);
    await page.waitForFunction(()=>document.querySelector('[data-governed-reply-status]')?.textContent==='Accepted by the email service.');
    assert((await page.getByText('Accepted',{exact:true}).count())>=1,'visible acceptance receipt');
    assert.equal(await page.getByText('Delivered',{exact:true}).count(),0,'acceptance is never delivery');assert.equal(await textarea.inputValue(),'');
   }
   await page.screenshot({path:path.join(out,`${theme}-${recovery}.png`)});results.push({name:`${theme}-${recovery}`,pass:true,calls:(await calls(page)).length,proof:'fictional door boundary; no provider/authenticated or real Hub-host proof'});
  }finally{await context.close();}
 }
 assert.deepEqual(errors,[],'page errors');assert.deepEqual(external,[],'off-machine requests');
 console.log(JSON.stringify({cases:results.length,pageErrors:errors.length,offMachineRequests:external.length,out}));
}catch(error){results.push({pass:false,error:String(error)});throw error;}
finally{
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,external,proof:'LOCAL_CONTROLLED_WORKSPACE',voice:'UNEXERCISED',paige:'PLACEHOLDER',nativeBrowserZoom:'UNVERIFIED'},null,2));
 try{await browser?.close();}finally{if(server&&server.exitCode===null){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else server.kill('SIGTERM');}}
}
