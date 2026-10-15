import fs from 'node:fs';
import path from 'node:path';
import {resolvePlaywright,buildLaunchOptions} from './live-drive.mjs';
const out=path.resolve('scripts/live-drive/artifacts/sales-collections');fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright(),browser=await chromium.launch(buildLaunchOptions()),page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.setDefaultTimeout(15000);
try{
 await page.goto('http://127.0.0.1:5293/solo/test-account/sales/payments?theme=dark&paige=closed&view=collections',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Open',exact:true}).nth(1).click();await page.getByRole('button',{name:'Record received payment',exact:true}).click();
 await page.getByLabel('Amount received (USD)').fill('100.00');await page.getByLabel('Date received').fill('2026-10-04');await page.getByLabel('Reference',{exact:true}).fill('Synthetic partial receipt');
 await page.screenshot({animations:'disabled',path:path.join(out,'390-dark-imported-receipt-form.png')});
 await page.getByRole('button',{name:'Review received payment',exact:true}).click();await page.getByRole('button',{name:'Prepare review',exact:true}).click();await page.getByRole('button',{name:'Approve action',exact:true}).waitFor();
 const card=page.locator('.sc-command-dialog').last();await card.getByText('$650.00',{exact:true}).waitFor();await page.screenshot({animations:'disabled',path:path.join(out,'390-dark-imported-receipt-consequence.png')});
 await page.keyboard.press('Tab');const keyboardFocusInside=await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]'));await page.getByRole('button',{name:'Approve action',exact:true}).click();
 await page.locator('.sc-detail-total').getByText('$650.00',{exact:true}).waitFor();await page.locator('.sc-trail').getByText('Synthetic partial receipt',{exact:false}).waitFor();await page.screenshot({animations:'disabled',path:path.join(out,'390-dark-imported-receipt-readback.png')});
 const reducedMotion=await page.evaluate(()=>({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:getComputedStyle(document.querySelector('.sc-drawer')).animationName}));
 fs.writeFileSync(path.join(out,'receipt-interaction.json'),JSON.stringify({boundary:'Actual imported Collections receipt form/review/readback with deterministic local RPC mutation. No authenticated tenant, real payment or provider execution.',initial_remaining_minor:75000,recorded_minor:10000,remaining_minor:65000,currency:'usd',receipt_reference:'Synthetic partial receipt',keyboardFocusInside,reducedMotion},null,2));if(!keyboardFocusInside||!reducedMotion.matches||reducedMotion.animation!=='none')throw Error('Keyboard/reduced-motion assertion failed');console.log('PASS imported partial receipt canonical-shaped local approval/readback + keyboard focus + reduced motion. Auth/payment/provider UNVERIFIED.');
}catch(error){await page.screenshot({path:path.join(out,'receipt-failure.png')});throw error}finally{await browser.close()}
