import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {resolvePlaywright,buildLaunchOptions} from '../../live-drive.mjs';
const out=path.resolve('docs/evidence/ui-delivery/assets/exp03-sms-uncertain');fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions()),results=[];
try{
for(const theme of ['light','dark'])for(const[width,height]of[[1536,770],[1366,768],[1024,768],[900,1000]]){
const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{const u=new URL(route.request().url());return['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
await page.goto('http://127.0.0.1:5255/?theme='+theme,{timeout:60000});
const dialog=page.getByRole('dialog',{name:'New conversation',exact:true});await dialog.waitFor();
const words='Thanks for your inquiry. We will follow up here.';
await dialog.locator('textarea').fill(words);
const send=dialog.locator('[data-composer-send]');await send.focus();await send.press('Enter');
await dialog.waitFor({state:'hidden'});
await page.waitForFunction(()=>window.smsUncertainReturns===1);
await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(el=>{const r=el.getBoundingClientRect();return el.textContent.includes("We couldn't confirm it was sent")&&r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(el).opacity==='1';}));
const calls=await page.evaluate(()=>window.smsUncertainCalls);assert.equal(calls.length,1);assert.equal(calls[0].body.body,words);assert.equal(calls[0].body.channel,'sms');
assert.equal(await page.locator('[data-composer-send]').count(),0,'closed original attempt offers no send button');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
await page.screenshot({path:path.join(out,theme+'-'+width+'.jpg'),type:'jpeg',quality:85});
await page.getByRole('button',{name:'Reopen conversation'}).click();await dialog.waitFor();assert.equal(await dialog.locator('textarea').inputValue(),'');
assert.equal(await page.evaluate(()=>window.smsUncertainCalls.length),1,'opening a new dialog does not resend the uncertain attempt');
results.push({theme,width,height,requestCount:1,originalWords:true,originalWarningVisible:true,closedAttempt:true,reopenDoesNotResend:true,errors});await page.close();
}
const paths=['src/pages/admin/conversations/ComposeThreadDialog.tsx','src/pages/admin/conversations/inbox-shared.ts','supabase/functions/send-message/index.ts',...['index.html','main.tsx','stubs.ts','vite.config.ts','drive.mjs'].map(p=>'scripts/live-drive/harness/exp03-sms-uncertain-mount/'+p)];
fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify({proof:'Actual original dialog, injected fictional response. Separate actual backend handler tests; no provider/customer/fullshell/PAIGE or saved-thread proof.',files:Object.fromEntries(paths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))},null,2)+'\n');
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({frames:results.length,results}));
}finally{await browser.close();}
