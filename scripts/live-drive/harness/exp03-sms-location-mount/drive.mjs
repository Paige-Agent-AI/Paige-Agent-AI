import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {resolvePlaywright,buildLaunchOptions} from '../../live-drive.mjs';
const out=path.resolve('docs/evidence/ui-delivery/assets/exp03-sms-location');fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions()),results=[];
try{
for(const theme of ['light','dark'])for(const[width,height]of[[1536,770],[1366,768],[1024,768],[900,1000]]){
const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{const u=new URL(route.request().url());return['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
await page.goto('http://127.0.0.1:5254/?theme='+theme,{timeout:60000});
const dialog=page.getByRole('dialog',{name:'New conversation',exact:true});await dialog.waitFor();
await dialog.locator('textarea').fill('Thanks for your inquiry. We will follow up here.');
const send=dialog.locator('[data-composer-send]');await send.waitFor();await send.focus();await send.press('Enter');
await page.getByText("Couldn't verify the recipient's time zone. Confirm their current location before sending this text.",{exact:true}).first().waitFor();
assert.equal(await dialog.locator('textarea').inputValue(),'Thanks for your inquiry. We will follow up here.');
await send.focus();await send.press('Enter');
await page.waitForFunction(()=>window.smsLocationCalls?.length===2);
const calls=await page.evaluate(()=>window.smsLocationCalls);assert.equal(calls.length,2);for(const call of calls){assert.equal(call.result.proceed,false);assert.equal(call.result.queueUntil,null);}
const geometry=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return{fits:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,horizontal:document.documentElement.scrollWidth>innerWidth};});
assert.equal(geometry.fits,true);assert.equal(geometry.horizontal,false);assert.deepEqual(errors,[]);
await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(el=>{const r=el.getBoundingClientRect();return el.textContent.includes("Couldn't verify the recipient's time zone")&&r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(el).opacity==='1';}));
await page.screenshot({path:path.join(out,theme+'-'+width+'.jpg'),type:'jpeg',quality:85});
await dialog.locator('textarea').press('Escape');await dialog.waitFor({state:'hidden'});
await page.getByRole('button',{name:'Reopen conversation'}).click();await dialog.waitFor();assert.equal(await dialog.locator('textarea').inputValue(),'');
results.push({theme,width,height,geometry,heldCalls:calls.length,wordsRetained:true,escapeReopen:true,errors});await page.close();
}
const paths=['src/pages/admin/conversations/ComposeThreadDialog.tsx','supabase/functions/_shared/pre-send-pipeline.ts',...['index.html','main.tsx','stubs.ts','vite.config.ts','drive.mjs'].map(p=>'scripts/live-drive/harness/exp03-sms-location-mount/'+p)];
fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify({proof:'Actual original dialog plus actual dispatch decision; fictional transport/identity. No full shell/PAIGE dock or authenticated/provider proof.',files:Object.fromEntries(paths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))},null,2)+'\n');
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({frames:results.length,results}));
}finally{await browser.close();}
