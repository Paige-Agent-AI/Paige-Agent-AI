import fs from 'node:fs';
import path from 'node:path';
import {resolvePlaywright,buildLaunchOptions} from './live-drive.mjs';
const out=path.resolve('scripts/live-drive/artifacts/sales-invoice-lifecycle');fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());const page=await browser.newPage();page.setDefaultTimeout(15000);
const errors=[],observations=[];page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>dialog.accept());
const geometry=()=>page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,scrollOwners:[...document.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+1&&['auto','scroll'].includes(getComputedStyle(el).overflowY)).map(el=>({className:el.className,height:el.clientHeight,scrollHeight:el.scrollHeight})),controls:[...document.querySelectorAll('.sb-paper input,.sb-paper select,.sb-paper textarea,.sb-paper button,[role="dialog"] button')].filter(el=>el.getClientRects().length).map(el=>({label:el.textContent||el.getAttribute('aria-label'),rect:el.getBoundingClientRect().toJSON(),font:getComputedStyle(el).fontSize}))}));
try{
 for(const theme of ['light','dark'])for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[430,932]])for(const dock of ['closed','open']){
  if(process.env.LIFECYCLE_REP&&(![1366,390].includes(width)||dock!=='closed'))continue;
  const name=`${width}-${height}-${theme}-${dock}`;await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:5287/solo/test-account/sales/payments?theme=${theme}&paige=${dock}&view=invoices`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Record received payment',exact:true}).waitFor();await page.screenshot({path:path.join(out,name+'-records.png')});const record=await geometry();
  const overlay=dock==='open'&&width<1080;if(overlay)await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
  await page.getByRole('button',{name:'Record received payment',exact:true}).click();await page.getByLabel('Amount received (USD)').fill('75.00');await page.getByLabel('Reference',{exact:true}).fill('Human receipt example');
  await page.getByRole('button',{name:'Review received payment',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,name+'-payment.png')});const form=await geometry();
  await page.getByRole('button',{name:'Review received payment',exact:true}).click();await page.getByRole('button',{name:'Prepare review',exact:true}).click();await page.getByRole('button',{name:'Approve action',exact:true}).waitFor();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Cancel',exact:true}).scrollIntoViewIfNeeded();const focusInside=await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]'));await page.screenshot({path:path.join(out,name+'-review.png')});const review=await geometry();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const focusReturned=await page.evaluate(()=>document.activeElement?.textContent==='Review received payment');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Discard changes',exact:true}).click();
  observations.push({name,overlayFoldedBeforeForm:overlay,record,form,review,focusInside,focusReturned});
 }
 fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify({boundary:'Actual production components and Solo shell; synthetic local canonical/RPC/approval fixtures. Hosted authenticated tenant, provider delivery, native mobile hardware/keyboard UNVERIFIED.',errors,observations},null,2));
 if(errors.length)throw Error(errors.join(';'));if(observations.some(o=>o.record.documentWidth>o.record.viewport.width+1||o.form.documentWidth>o.form.viewport.width+1||o.review.documentWidth>o.review.viewport.width+1||!o.focusInside||!o.focusReturned))throw Error('Geometry/focus assertion failed');
 console.log(`PASS ${observations.length} responsive lifecycle cases: records/payment/review captures and focus. Native hardware/auth/provider proof UNVERIFIED.`);
}finally{await browser.close();}
