import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {resolvePlaywright,buildLaunchOptions} from '../../live-drive.mjs';
const out=path.resolve('docs/evidence/ui-delivery/assets/exp03-sms-final-eligibility');fs.mkdirSync(out,{recursive:true});
const explanation='This text is on hold because message hours or preferences changed. Nothing was sent or scheduled. Review before trying again.';
assert(fs.readFileSync('supabase/functions/send-message/index.ts','utf8').includes(explanation),'rendered copy bound to actual source');
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions()),results=[];
try{
 for(const theme of ['light','dark'])for(const[width,height]of[[1536,770],[1366,768],[1024,768],[900,1000]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());return['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
  await page.goto('http://127.0.0.1:5256/?theme='+theme,{timeout:60000});await page.evaluate(()=>document.fonts.ready);
  const dialog=page.getByRole('dialog',{name:'New conversation',exact:true});await dialog.waitFor();
  const words='Thanks for your inquiry. Use code <1234> & keep this draft.';
  await dialog.locator('textarea').fill(words);
  const send=dialog.locator('[data-composer-send]');await send.focus();await send.press('Enter');
  await page.getByText(explanation,{exact:true}).first().waitFor();
  await page.waitForFunction(text=>[...document.querySelectorAll('[data-sonner-toast]')].some(el=>{const r=el.getBoundingClientRect();return el.textContent.includes(text)&&r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(el).opacity==='1';}),explanation);
  await page.screenshot({path:path.join(out,theme+'-'+width+'.jpg'),type:'jpeg',quality:85});
  assert.equal(await dialog.locator('textarea').inputValue(),words);assert.equal(await dialog.isVisible(),true);
  assert.equal(await page.evaluate(()=>window.smsFinalEligibilityCalls.length),1,'no automatic retry');
  await send.focus();await send.press('Enter');await page.waitForFunction(()=>window.smsFinalEligibilityCalls.length===2);
  const calls=await page.evaluate(()=>window.smsFinalEligibilityCalls);assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.body.body,words);assert.equal(call.body.channel,'sms');}
  const geometry=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return{fits:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,horizontal:document.documentElement.scrollWidth>innerWidth};});
  assert.equal(geometry.fits,true);assert.equal(geometry.horizontal,false);assert.deepEqual(errors,[]);
  await dialog.locator('textarea').press('Escape');await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Reopen conversation'}).click();await dialog.waitFor();assert.equal(await dialog.locator('textarea').inputValue(),'');
  assert.equal(await page.evaluate(()=>window.smsFinalEligibilityCalls.length),2,'reopen does not dispatch');
  results.push({theme,width,height,geometry,inertRequests:2,wordsRetained:true,noAutomaticRetry:true,escapeReopen:true,errors});await page.close();
 }
 const paths=['src/pages/admin/conversations/ComposeThreadDialog.tsx','src/pages/admin/conversations/inbox-shared.ts','supabase/functions/_shared/pre-send-pipeline.ts','supabase/functions/send-message/index.ts',...['index.html','main.tsx','stubs.ts','vite.config.ts','drive.mjs'].map(p=>'scripts/live-drive/harness/exp03-sms-final-eligibility-mount/'+p)];
 fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify({proof:'Unchanged original dialog plus explicitly fictional injected refusal. Separate actual backend/gate tests; no full shell, PAIGE, authenticated, saved-thread or provider proof.',files:Object.fromEntries(paths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))},null,2)+'\n');
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({frames:results.length,results}));
}finally{await browser.close();}
