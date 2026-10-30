// Start this isolated Vite root on5252, then run this deterministic read-only drive.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {resolvePlaywright,buildLaunchOptions} from '../../live-drive.mjs';
const out=path.resolve('docs/evidence/ui-delivery/assets/exp03-new-conversation-door');fs.mkdirSync(out,{recursive:true});
const results=[];const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());
const SUBJECT='Your inquiry',BODY='Thanks for asking.';
async function open({theme='light',paige='closed',width=1366,height=768,door='ok',empty=false}={}){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
  await page.goto(`http://127.0.0.1:5252/solo/42/clients/conversations?${new URLSearchParams({theme,paige,door})}`,{timeout:60000});
  await page.getByRole('button',{name:'New conversation',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'New conversation',exact:true});
  if(!empty){await dialog.getByRole('combobox').filter({hasText:'Select a customer'}).click();await page.getByRole('option').filter({hasText:'Jordan Rivera'}).click();
    await dialog.getByPlaceholder('Subject',{exact:true}).fill(SUBJECT);await dialog.locator('textarea').fill(BODY);}
  return {page,dialog,errors};
}
async function check(dialog){const send=dialog.locator('[data-composer-send]');await send.focus();await send.press('Enter');}
async function capture(page,name,extra={}){
  const geometry=await page.evaluate(()=>{const d=document.querySelector('[role="dialog"]'),r=d?.getBoundingClientRect();return{width:innerWidth,height:innerHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,dialog:r?{x:r.x,y:r.y,width:r.width,height:r.height,fits:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}:null,focus:document.activeElement?.getAttribute('data-strip-focus')??document.activeElement?.tagName};});
  await page.screenshot({path:path.join(out,`${name}.jpg`),type:'jpeg',quality:75});results.push({name,...geometry,...extra});
}
try{
  for(const theme of ['light','dark'])for(const [width,height]of[[1536,770],[1366,768],[1024,768],[900,1000]])for(const paige of ['closed','open']){
    const {page,dialog,errors}=await open({theme,width,height,paige});await check(dialog);await dialog.getByRole('button',{name:'Send now',exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Send now',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(top===el||el.contains(top));}),true,'actual confirmation target is visible and unobscured');
    assert.equal(await dialog.locator('[data-composer-send]').count(),0);assert.equal(await page.evaluate(()=>window.__harness.rpc.filter(r=>r.name==='functions:comms-email-command'&&r.args?.approved_fingerprint).length),0);
    assert.deepEqual(errors,[]);await capture(page,`${theme}-${width}-${paige}`,{nothingSent:true,errors,dock:'inherited mocked background; actual dock not verified'});await page.close();
  }
  for(const theme of ['light','dark'])for(const state of ['empty','scheduled','file','accepted','unknown','sending','expired','suppressed','member','offline','cancel']){
    const door=({unknown:'unknown',sending:'hang',expired:'expire',suppressed:'suppressed',member:'member'})[state]??'ok';
    const {page,dialog,errors}=await open({theme,door,empty:state==='empty'});let behaviour={};
    if(state==='empty')assert.equal(await dialog.locator('[data-composer-send]').isDisabled(),true);
    else{
      if(state==='scheduled'){await dialog.getByRole('button',{name:'Schedule',exact:true}).click();await page.getByRole('button',{name:'In 1 hour',exact:true}).click();}
      if(state==='file')await dialog.locator('input[type="file"]').setInputFiles({name:'brief.txt',mimeType:'text/plain',buffer:Buffer.from('brief')});
      if(state==='offline')await page.context().setOffline(true);
      await check(dialog);
      if(state==='offline')await dialog.locator('[data-governed-reply-strip]').getByText("You're offline.",{exact:false}).waitFor();
      else if(state==='suppressed')await dialog.getByText(/Can't send to Jordan Rivera/).first().waitFor();
      else if(state==='member')await dialog.getByText('Only an owner or admin sends email for the business.',{exact:true}).waitFor();
      else if(state==='expired')await dialog.getByRole('group',{name:'Check expired',exact:true}).waitFor({timeout:12000});
      else{
        const confirm=dialog.getByRole('button',{name:state==='scheduled'?'Schedule send':'Send now',exact:true});await confirm.waitFor();
        if(state==='file'){await dialog.getByText('brief.txt',{exact:true}).last().waitFor();behaviour.filesLocked=await dialog.getByRole('button',{name:'Remove brief.txt',exact:true}).isDisabled();assert.equal(behaviour.filesLocked,true);}
        if(state==='scheduled')behaviour.sendAt=await page.evaluate(()=>window.__harness.rpc.find(r=>r.name==='functions:comms-email-command').args.send_at);
        if(['accepted','unknown','sending'].includes(state)){
          await confirm.click();
          if(state==='accepted'){await dialog.waitFor({state:'hidden'});await page.getByText('Accepted by the email service. Delivery is not confirmed.',{exact:true}).waitFor();}
          if(state==='sending'){await dialog.getByText('Sending…',{exact:true}).waitFor();assert.equal(await dialog.locator('textarea').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);}
          if(state==='unknown'){await dialog.getByRole('button',{name:'Check status',exact:true}).waitFor();await dialog.getByRole('button',{name:'Check status',exact:true}).click();await dialog.getByRole('button',{name:'Check status',exact:true}).waitFor();
            const calls=await page.evaluate(()=>window.__harness.rpc.filter(r=>r.name==='functions:comms-email-command').map(r=>r.args));assert.equal(calls.length,3);assert.equal(calls[0].operation_id,calls[2].operation_id);assert.equal(calls.filter(c=>c.approved_fingerprint).length,1);behaviour.sameOperationStatus=true;}
        }
        if(state==='cancel'){await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);assert.equal(await dialog.getByPlaceholder('Subject',{exact:true}).inputValue(),SUBJECT);assert.equal(await dialog.locator('textarea').inputValue(),BODY);assert.equal(await dialog.locator('textarea').evaluate(e=>e===document.activeElement),true);
          await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});behaviour.escapeKeptWordsThenExplicitCancel=true;}
      }
    }
    assert.deepEqual(errors,[]);await capture(page,`${theme}-${state}`,{state,errors,...behaviour});await page.close();
  }
}finally{await browser.close();}
const files=['src/pages/admin/ClientsConversations.tsx','src/pages/admin/conversations/ComposeThreadDialog.tsx','src/pages/admin/conversations/LeadReplyDrafts.test.tsx','src/pages/admin/conversations/useGovernedEmailReply.tsx','src/pages/admin/conversations/GovernedReplyStrip.tsx',...['index.html','main.tsx','stubs.ts','vite.config.ts','drive.mjs'].map(n=>`scripts/live-drive/harness/exp03-new-conversation-door-mount/${n}`)];
fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify({proof:'Actual native inbox/dialog/check; synthetic session, data, door, storage and outcomes only. No real auth/database/provider execution.',files:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))},null,2)+'\n');
fs.writeFileSync(path.join(out,'state-proof.json'),JSON.stringify({at:new Date().toISOString(),results},null,2)+'\n');console.log(JSON.stringify({frames:results.length,out}));
