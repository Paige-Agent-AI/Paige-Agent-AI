import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {resolvePlaywright,buildLaunchOptions} from '../../live-drive.mjs';
const out=path.resolve('../exp03-contact-zone-prototype');fs.mkdirSync(out,{recursive:true});
const results=[],errors=[];const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());
async function open(scenario='success',theme='light',width=1366,height=768){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
 await page.goto(`http://127.0.0.1:5273/?${new URLSearchParams({scenario,theme})}`,{timeout:60000,waitUntil:"domcontentloaded"});
 await page.getByRole('tab',{name:/Relationship & consent/}).first().waitFor({timeout:60000});await page.getByRole('tab',{name:/Relationship & consent/}).click();
 await page.getByLabel('Contact’s time zone',{exact:true}).waitFor();
 await page.evaluate(()=>document.fonts.ready);
 return page;
}
async function fill(page){await page.getByLabel('Contact’s time zone',{exact:true}).fill('America/Chicago');assert.equal(await page.getByRole('checkbox').isChecked(),false);await page.getByRole('checkbox').check();}
async function capture(page,name){const geometry=await page.evaluate(()=>({horizontalOverflow:document.documentElement.scrollWidth>innerWidth,editor:!!document.querySelector('[data-contact-editor]'),viewport:[innerWidth,innerHeight]}));assert.equal(geometry.horizontalOverflow,false);await page.screenshot({path:path.join(out,name+'.jpg'),type:'jpeg',quality:78});results.push({name,...geometry});}
try{
 for(const theme of ['light','dark'])for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]]){
  const page=await open('success',theme,width,height);await fill(page);await capture(page,`${theme}-${width}-confirm`);
  await page.getByRole('button',{name:'Save changes',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Contact saved',exact:true}).waitFor();
  const log=await page.evaluate(()=>window.__exp03ContactPrototype);assert.equal(log.attempts.length,1);assert.equal(log.attempts[0].p_patch.expected_updated_at,'2026-10-30T18:00:00.123456+00:00');assert.equal(log.attempts[0].p_patch.expected_timezone,'America/New_York');assert.equal(log.attempts[0].p_patch.timezone_verified,true);
  await page.getByRole('button',{name:'Return to saved contact',exact:true}).click();await page.getByRole('button',{name:'Reopen contact',exact:true}).click();await page.getByRole('tab',{name:/Relationship & consent/}).click();assert.equal(await page.getByLabel('Contact’s time zone',{exact:true}).inputValue(),'America/Chicago');assert.equal(await page.getByRole('checkbox').isChecked(),true);
  await page.getByLabel('Contact’s time zone',{exact:true}).fill('America/Denver');assert.equal(await page.getByRole('checkbox').isChecked(),false);await page.close();
 }
 for(const [theme,width,height]of[['light',1366,768],['dark',900,1000]])for(const scenario of ['stale','refused','unknown','unavailable','offline','validation','cancel']){
  const page=await open(['validation','cancel'].includes(scenario)?'success':scenario,theme,width,height);
  if(scenario==='validation')await page.getByLabel('Contact’s time zone',{exact:true}).fill('EST');else await fill(page);
  if(scenario==='offline'){assert.equal(await page.getByRole('button',{name:'Save changes',exact:true}).isDisabled(),true);}
  else if(scenario==='cancel'){await page.keyboard.press('Escape');await page.getByRole('alertdialog',{name:'Continue editing?',exact:true}).waitFor();await page.getByRole('button',{name:'Resume draft',exact:true}).click();assert.equal(await page.getByLabel('Contact’s time zone',{exact:true}).inputValue(),'America/Chicago');}
  else{
   await page.getByRole('button',{name:'Save changes',exact:true}).click();
   await page.getByRole('status').filter({hasText:scenario==='validation'?'Choose a regional time zone':scenario==='unknown'?'save result is unknown':scenario==='stale'?'contact changed after':scenario==='refused'?'permission or active business changed':'compatible release is ready'}).waitFor();
   assert.equal(await page.getByLabel('Contact’s time zone',{exact:true}).inputValue(),scenario==='validation'?'EST':'America/Chicago');
   if(['stale','refused','unknown'].includes(scenario)){
    assert.equal(await page.getByRole('button',{name:'Retry save',exact:true}).isDisabled(),true);
    await page.locator('textarea').fill('Keep this draft after refusal');
    await page.getByRole('tab',{name:/Business context/}).click();await page.getByRole('tab',{name:/Relationship & consent/}).click();
    assert.equal(await page.getByRole('button',{name:'Save changes',exact:true}).isDisabled(),true);
    await page.getByRole('status').filter({hasText:scenario==='unknown'?'save result is unknown':scenario==='stale'?'contact changed after':'permission or active business changed'}).waitFor();
    assert.equal(await page.locator('textarea').inputValue(),'Keep this draft after refusal');
   }
  }
  const log=await page.evaluate(()=>window.__exp03ContactPrototype);assert.equal(log.attempts.length,['offline','validation','cancel'].includes(scenario)?0:1);await capture(page,`${theme}-${width}-${scenario}`);await page.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'LOCAL PROTOTYPE ONLY; no backend/auth/provider/full-shell/both-chat/legal or customer proof',results,errors},null,2));console.log(JSON.stringify({captures:results.length,errors}));
}finally{await browser.close();}
