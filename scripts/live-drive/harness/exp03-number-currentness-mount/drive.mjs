import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {resolvePlaywright,buildLaunchOptions} from '../../live-drive.mjs';
const out=path.resolve('docs/evidence/ui-delivery/assets/exp03-number-currentness');fs.mkdirSync(out,{recursive:true});
const text='Nothing was changed. Your permission or active business changed. Return to the correct business and check your access.';
const {chromium}=await resolvePlaywright(),browser=await chromium.launch(buildLaunchOptions()),results=[];
try{for(const theme of ['light','dark'])for(const[width,height]of[[1536,770],[1366,768],[1024,768],[900,1000]])for(const paige of [false,true]){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
 await page.goto(`http://127.0.0.1:5274/solo/1971670/settings/connections?${new URLSearchParams({segment:'communications',theme,callingSeat:'owner',tenant:theme==='dark'?'second':'first'})}`,{timeout:120000,waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Number on this business',exact:true}).waitFor({timeout:60000});
 const fold=page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).first();if(await fold.isVisible())await fold.click();
 if(!await page.getByRole('button',{name:'Send from this',exact:true}).isVisible())console.log('Fictional Settings diagnostic:',await page.locator('body').innerText());
 const choose=page.getByRole('button',{name:'Send from this',exact:true});await choose.scrollIntoViewIfNeeded();await choose.focus();await page.keyboard.press('Enter');await page.getByText(text,{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__exp03NumberCurrentness.attempts.length),1);
 await page.getByRole('button',{name:'Rename',exact:true}).click();await page.getByLabel('Label',{exact:true}).fill('Retain this drafted label');await page.getByRole('button',{name:'Save label',exact:true}).click();await page.getByText(text,{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Label',{exact:true}).inputValue(),'Retain this drafted label');
 if(paige){await page.getByRole('button',{name:'Direct PAIGE',exact:true}).click();await page.locator('#tenant-paige-workspace').waitFor({state:'visible'});}
 const notice=page.getByText(text,{exact:true});await notice.scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready);
 const readGeometry=()=>notice.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{fits:r.top>=0&&r.bottom<=innerHeight+1,unobscured:hit===el||el.contains(hit),horizontalOverflow:document.documentElement.scrollWidth>innerWidth};});
 let geometry=await readGeometry();
 // Original shell <=1080px deliberately uses a modal PAIGE backdrop. Verify
 // that real contract, then verify returning reveals the unchanged refusal/draft.
 // The first run's demand for an unobscured background was wrong, not a product fix.
 if(paige&&width<=1080){
  assert.equal(await page.locator('.tcs-paige-backdrop').isVisible(),true);
  assert.equal(geometry.unobscured,false);
  await page.screenshot({path:path.join(out,`${theme}-${width}-open-overlay.jpg`),type:'jpeg',quality:75});
  await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).first().click();
  await page.locator('#tenant-paige-workspace').waitFor({state:'hidden'});
  await notice.scrollIntoViewIfNeeded();geometry=await readGeometry();
  assert.equal(await page.getByLabel('Label',{exact:true}).inputValue(),'Retain this drafted label');
 }
 console.log(JSON.stringify({theme,width,paige,...geometry}));
 if(!geometry.fits||!geometry.unobscured||geometry.horizontalOverflow)await page.screenshot({path:path.resolve('../exp03-number-currentness-failed-frame.jpg'),type:'jpeg',quality:80});
 assert.equal(geometry.horizontalOverflow,false);assert.equal(geometry.fits,true);assert.equal(geometry.unobscured,true);
 assert.deepEqual(errors,[]);const attempts=await page.evaluate(()=>window.__exp03NumberCurrentness.attempts);assert.equal(attempts.length,2);assert.deepEqual(attempts.map(x=>x.name),['tenant_phone_number_set_primary','tenant_phone_number_rename']);
 const name=`${theme}-${width}-${paige?(width<=1080?'returned-from-overlay':'open'):'closed'}`;await page.screenshot({path:path.join(out,name+'.jpg'),type:'jpeg',quality:75});assert.equal(await notice.isVisible(),true);results.push({name,...geometry,overlayReturnChecked:paige&&width<=1080,attempts:attempts.length,scope:'Actual Settings/source reader; fictional native refusal, no provider/backend/authenticated proof'});await page.close();
}}finally{await browser.close();}
const files=['src/lib/integrations/connectError.ts','src/solo/data/useSoloNumbers.ts','src/solo/settings.tsx',...['main.tsx','stubs.ts','vite.config.ts','drive.mjs'].map(f=>'scripts/live-drive/harness/exp03-number-currentness-mount/'+f)];
fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify({scope:'Captured raw bytes; LF transport hash separately, not production evidence',files:files.map(f=>{const b=fs.readFileSync(f);return{path:f,rawSha256:crypto.createHash('sha256').update(b).digest('hex'),lfSha256:crypto.createHash('sha256').update(b.toString().replaceAll('\r\n','\n')).digest('hex')};})},null,2));
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results},null,2));console.log(JSON.stringify({frames:results.length,allEffectsFictional:true}));
