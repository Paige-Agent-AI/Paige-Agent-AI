import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {resolvePlaywright,buildLaunchOptions} from './live-drive.mjs';
const out=path.resolve('scripts/live-drive/artifacts/catalog-search');fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());
const observations=[];const errors=[];
try {
 for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]]) for(const theme of ['light','dark']) for(const paige of ['closed','open']) {
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:5251/solo/test-account/growth/catalog?full-shell=1&theme=${theme}&paige=${paige}`);
  const search=page.getByRole('searchbox',{name:'Search offers by name'});await search.waitFor();
  await search.focus();await search.pressSequentially('TOOLKIT');
  await page.waitForFunction(()=>document.querySelectorAll('.co-row').length===1);
  assert.match(await page.locator('.co-row').innerText(),/Onboarding toolkit/);
  await search.fill('no matching offer');await page.getByRole('status').filter({hasText:'No offers match'}).waitFor();
  const clear=page.getByRole('button',{name:'Clear search',exact:true});await clear.focus();await clear.press('Enter');
  assert.equal(await search.inputValue(),'');assert.equal(await search.evaluate(e=>document.activeElement===e),true);
  assert.equal(await page.locator('.co-row').count(),2);
  const geometry=await page.evaluate(()=>{const input=document.querySelector('.co-search input'),r=input.getBoundingClientRect();return {document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],search:{x:r.x,y:r.y,width:r.width,height:r.height},overflow:getComputedStyle(document.querySelector('.campaigns-scroll')).overflowY,focusOutline:getComputedStyle(input).outlineStyle}});
  assert.ok(geometry.document[0]<=width&&geometry.document[1]<=height);assert.ok(geometry.search.x>=0&&geometry.search.x+geometry.search.width<=width);assert.notEqual(geometry.focusOutline,'none');
  await page.screenshot({path:path.join(out,`${width}-${height}-${theme}-${paige}.png`),fullPage:true});
  observations.push({width,height,theme,paige,geometry,search:'literal case-insensitive match; no-match; keyboard clear restores focus',boundary:width<1080&&paige==='open'?'Existing PAIGE overlay: keyboard drive, pointer interception not claimed':'Local actual-shell fixture only'});await page.close();
 }
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({boundary:'Actual production shell and Catalog component with synthetic source/auth fixtures; no hosted tenant readback or provider proof',observations,errors},null,2));
 console.log(JSON.stringify({cases:observations.length,errors}));
} finally {await browser.close();}
