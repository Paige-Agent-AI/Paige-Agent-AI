/** Actual Solo components; synthetic transport only. No authenticated/provider acceptance. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolvePlaywright, buildLaunchOptions } from './live-drive.mjs';
const { chromium } = await resolvePlaywright();
const browser = await chromium.launch(buildLaunchOptions());
const output = path.resolve('scripts/live-drive/artifacts/sales-merchant');
mkdirSync(output, { recursive: true });
const results = [];
try {
 for (const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844]]) {
  for (const theme of ['light','dark']) for (const paige of ['closed','open']) {
   const page = await browser.newPage({ viewport: { width,height }, reducedMotion:'reduce' });
   await page.goto(`http://127.0.0.1:5203/?theme=${theme}&paige=${paige}&merchant=empty`);
   await page.getByRole('button', { name:/Stripe.*Not connected/i }).click();
   await page.getByRole('dialog').waitFor();
   await page.getByRole('button',{name:'Connect Stripe (TEST)'}).waitFor();
   await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
   const geometry = await page.getByRole('dialog').evaluate(el => {
    const box=el.getBoundingClientRect();
    const body=el.querySelector('.ig-panel-body');
    return { x:box.x,y:box.y,width:box.width,height:box.height,viewport:innerWidth,
     horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,
     bodyOverflow:body.scrollWidth>body.clientWidth+1,
     scrollOwner:getComputedStyle(body).overflowY };
   });
   if(geometry.x< -1||geometry.x+geometry.width>width+1||geometry.horizontalOverflow||geometry.bodyOverflow)throw Error(JSON.stringify({width,height,theme,paige,geometry}));
   await page.screenshot({path:path.join(output,`${width}-${theme}-${paige}.png`)});
   await page.keyboard.press('Escape');
   if(await page.getByRole('dialog').count())throw Error('Escape did not close');
   results.push({width,height,theme,paige,geometry,escape:'PASS'});
   await page.close();
  }
 }
 for(const merchant of ['incomplete','restricted','ready','live','unknown','stale','error','readonly']){
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  await page.goto(`http://127.0.0.1:5203/?theme=dark&merchant=${merchant}`);
  await page.locator('.ig-card').filter({hasText:'Stripe'}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:'Refresh status'}).waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
  await page.screenshot({path:path.join(output,`state-${merchant}.png`)});
  results.push({merchant,text:await page.getByRole('dialog').innerText()});
  await page.close();
 }
 const keyboard=await browser.newPage({viewport:{width:1366,height:768}});
 await keyboard.goto('http://127.0.0.1:5203/?theme=light&merchant=empty');
 const opener=keyboard.getByRole('button',{name:/Stripe.*Not connected/i});
 await opener.click(); await keyboard.getByRole('dialog').waitFor();
 await keyboard.evaluate(() => Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
 for(const key of ['Tab','Tab','Tab','Tab','Shift+Tab','Shift+Tab','Shift+Tab','Shift+Tab']){
  await keyboard.keyboard.press(key);
  if(!await keyboard.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')))throw Error('Focus escaped modal');
 }
 await keyboard.keyboard.press('Escape');
 if(!await opener.evaluate(el=>el===document.activeElement))throw Error('Opener focus not restored');
 await opener.click();
 await keyboard.addStyleTag({content:'html { zoom: 2; }'});
 await keyboard.getByRole('button',{name:'Refresh status'}).scrollIntoViewIfNeeded();
 const zoom=await keyboard.getByRole('button',{name:'Refresh status'}).boundingBox();
 if(!zoom||zoom.x<0||zoom.y<0||zoom.x+zoom.width>1366||zoom.y+zoom.height>768)throw Error('200% zoom recovery control unreachable');
 await keyboard.screenshot({path:path.join(output,'zoom200-light.png')});
 results.push({keyboard:'PASS',openerRestoration:'PASS',zoom:'CSS 200% reflow, recovery control reachable',zoomBox:zoom});
 await keyboard.close();
 writeFileSync(path.join(output,'results.json'),JSON.stringify({proofClass:'LOCAL_RENDER_SYNTHETIC_TRANSPORT',results},null,2));
 console.log(`${results.length} rendered cases PASS; authenticated/provider acceptance UNVERIFIED`);
} finally {await browser.close();}
