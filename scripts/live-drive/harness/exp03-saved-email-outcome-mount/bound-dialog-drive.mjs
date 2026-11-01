// Existing real workspace + original bound dialog. Fictional ports; no customer/provider proof.
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildLaunchOptions,resolvePlaywright} from '../../live-drive.mjs';
const require=createRequire(import.meta.url),here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../../..');
const out=path.join(repo,'docs/evidence/ui-delivery/assets/exp03-saved-email-bound-dialog',new Date().toISOString().replaceAll(':','-'));
fs.mkdirSync(out,{recursive:true});
const port=5227,results=[],errors=[],external=[];let server,browser,log='';
const contact='e0300000-0000-4000-8000-0000000c0001',approval='e0300000-0000-4000-8000-0000000b0002';
try{
 const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
 server=spawn(process.execPath,[vite,'--config',path.join(here,'vite.config.ts'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(log.slice(-2000))),60000);const data=b=>{log+=String(b);if(log.includes('ready in')){clearTimeout(timer);resolve();}};server.stdout.on('data',data);server.stderr.on('data',data);server.on('error',reject);server.on('exit',c=>{clearTimeout(timer);reject(Error('Vite exited '+c+log.slice(-2000)));});});
 const {chromium}=await resolvePlaywright();browser=await chromium.launch(buildLaunchOptions());
 for(const theme of ['light','dark'])for(const [w,h] of [[1366,768],[1024,768],[900,1000],[567,381]]){
  const context=await browser.newContext({viewport:{width:w,height:h},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();external.push(u.origin);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(`http://127.0.0.1:${port}/solo/42/clients/conversations?${new URLSearchParams({entry:'action',surface:'bound-dialog',theme,contact,approval})}`,{timeout:180000});
   const dialog=page.getByRole('dialog');await dialog.waitFor();await page.evaluate(()=>document.fonts.ready);
   await dialog.getByRole('button',{name:'Edit and review reply',exact:true}).click();
   const textarea=dialog.locator('textarea');await textarea.fill('Saved bound-dialog words.');
   const save=dialog.getByRole('button',{name:'Save draft',exact:true});await save.focus();await save.press('Space');
   await dialog.getByText('Draft saved. Nothing sent.',{exact:false}).first().waitFor();
   assert(await textarea.evaluate(el=>document.activeElement===el),'Save focus returns to writing surface');
   const calls=await page.evaluate(()=>window.__harness.rpc.filter(x=>x.name==='functions:comms-email-command').map(x=>x.args));
   assert.equal(calls.length,1);assert.equal(calls[0].save_draft,true);assert.equal(calls[0].approved_fingerprint,undefined);
   await save.scrollIntoViewIfNeeded();const geometry=await save.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth+1};});
   assert(geometry.width>=24&&geometry.height>=24);assert(geometry.x>=0&&geometry.y>=0&&geometry.right<=w+1&&geometry.bottom<=h+1);assert.equal(geometry.overflow,false);
   await page.evaluate(()=>{const e=document.createElement('div');e.textContent='Harness render · fictional data · not live';Object.assign(e.style,{position:'fixed',bottom:'4px',right:'4px',zIndex:99999,background:'white',color:'black',font:'12px sans-serif',pointerEvents:'none'});document.body.append(e);});
   await page.screenshot({path:path.join(out,`${theme}-${w}-saved.png`)});
   await dialog.getByRole('button',{name:'Review reply',exact:true}).click();
   await dialog.getByRole('button',{name:'Edit',exact:true}).waitFor();
   const checks=await page.evaluate(()=>window.__harness.rpc.filter(x=>x.name==='functions:comms-email-command').map(x=>x.args));
   assert.equal(checks.length,2);assert.equal(checks[1].draft_source.message_id,'e0300000-0000-4000-8000-0000000f0001');assert.equal(checks[1].approved_fingerprint,undefined);
   await dialog.getByRole('button',{name:'Edit',exact:true}).click();
   await dialog.getByRole('button',{name:'Cancel reply edit',exact:true}).click();
   // Original Router navigation, preserving the same fictional transport's saved row.
   // A full document reload would reset this fixture, so no reload-persistence claim.
   await page.evaluate(()=>{const u=new URL(location.href);u.searchParams.delete('contact');u.searchParams.delete('approval');history.pushState({},'',u);dispatchEvent(new PopStateEvent('popstate'));});
   await page.waitForFunction(()=>!new URL(location.href).searchParams.has('contact'));
   await page.evaluate(({contact,approval})=>{const u=new URL(location.href);u.searchParams.set('contact',contact);u.searchParams.set('approval',approval);history.pushState({},'',u);dispatchEvent(new PopStateEvent('popstate'));},{contact,approval});
   await dialog.getByRole('button',{name:'Open saved reply',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('[role="dialog"] textarea')?.value==='Saved bound-dialog words.');
   assert.equal((await page.evaluate(()=>window.__harness.rpc.filter(x=>x.name==='functions:comms-email-command'))).length,2,'reopen only reads original saved source');
   results.push({theme,w,h,pass:true,geometry,proof:'LOCAL_CONTROLLED_ORIGINAL_WORKSPACE_DIALOG',authenticated:false,provider:false});
  }finally{await context.close();}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({cases:results.length,errors,external,out}));
}catch(error){results.push({pass:false,error:String(error)});throw error;}
finally{
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,external,proof:'LOCAL_CONTROLLED_ORIGINAL_WORKSPACE_DIALOG',nativeZoom:'UNVERIFIED',hub:'UNEXERCISED'},null,2));
 try{await browser?.close();}finally{if(server&&server.exitCode===null){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else server.kill('SIGTERM');}}
}
