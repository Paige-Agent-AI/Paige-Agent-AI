import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolvePlaywright,buildLaunchOptions} from './live-drive.mjs';
const out='docs/evidence/ui-delivery/assets/sales-invoice-commercial-terms-binding';
fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());
try{const results=[];for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]])for(const theme of ['light','dark'])for(const dock of ['closed','open']){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.setDefaultTimeout(60000);page.on('pageerror',error=>console.error('LOCAL HARNESS:',error.message));
 console.log('Checking local viewport',width,height,theme,dock);await page.goto(`${process.env.SALES_CONDITIONS_HARNESS_URL??'http://127.0.0.1:5298'}/solo/test-account/sales/payments?full-shell=true&view=invoices&theme=${theme}&paige=${dock}&billing-fixture=populated`,{waitUntil:'domcontentloaded',timeout:60000});
 if(dock==='open'&&width<1080)await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
 await page.getByRole('button',{name:'Create invoice',exact:true}).click();console.log('Editor opened');const editor=page.locator('.ide');
 await editor.getByLabel('Client',{exact:true}).selectOption('33333333-3333-4333-8333-333333333333');await editor.getByLabel('Commercial terms / payment plan',{exact:true}).selectOption('99999999-9999-4999-8999-999999999999');await editor.getByLabel('Billing email',{exact:true}).fill('billing@example.test');await editor.getByLabel('Item description 1',{exact:true}).fill('Synthetic principal');await editor.getByLabel('Unit price for item 1',{exact:true}).fill('3500');
 await editor.getByLabel('Billing structure',{exact:true}).selectOption('deposit');await editor.getByLabel('Deposit basis',{exact:true}).selectOption('fixed');await editor.getByLabel('Deposit amount (USD)',{exact:true}).fill('500');await editor.getByLabel('Due date',{exact:true}).fill('2026-11-01');console.log('Principal/deposit entered');
 await editor.getByLabel('Tax treatment',{exact:true}).selectOption('not_applicable');await editor.getByRole('button',{name:'Save draft',exact:true}).click();assert((await editor.textContent()).includes('enter the recorded source'));
 for(const label of ['Tax','Fees']){await editor.getByLabel(`${label} treatment`,{exact:true}).selectOption('not_applicable');await editor.getByLabel(`${label} source`,{exact:true}).fill('Synthetic owner-reviewed terms');await editor.getByLabel(`${label} policy`,{exact:true}).fill(`No ${label.toLowerCase()} applies to this fixture`);}
 await editor.getByRole('checkbox',{name:/Email invoice/}).check();console.log('Conditions entered');await editor.getByLabel('Fees policy',{exact:true}).focus();assert(await editor.getByLabel('Fees policy',{exact:true}).evaluate(e=>e===document.activeElement));await page.keyboard.press('Tab');
 await page.screenshot({path:'work-test-temp/terms-before-review.png'});console.log('Before review',await editor.locator('.ide-notice').allTextContents());await editor.getByRole('button',{name:'Review invoice',exact:true}).click();console.log('After review',await editor.locator('.ide-notice').allTextContents());await editor.getByRole('heading',{name:'Review invoice',exact:true}).waitFor();console.log('Review opened');const summary=editor.getByRole('complementary',{name:'Invoice summary'});assert((await summary.textContent()).includes('$500.00'));assert((await summary.textContent()).includes('$3,000.00'));assert((await editor.textContent()).includes('Synthetic owner-reviewed terms'));
 const geometry=await editor.evaluate(el=>{const r=el.getBoundingClientRect(),s=el.querySelector('.ide-scroll');return {left:r.left,right:r.right,bottom:r.bottom,scrollWidth:s.scrollWidth,clientWidth:s.clientWidth}});assert(geometry.left>=-.5&&geometry.right<=width+.5&&geometry.bottom<=height+.5&&geometry.scrollWidth<=geometry.clientWidth+1,JSON.stringify(geometry));
 await editor.getByRole('button',{name:'Back to details',exact:true}).click();await editor.locator('.ide-conditions').evaluate(el=>{const scroll=el.closest('.ide-scroll');scroll.scrollTop+=el.getBoundingClientRect().top-scroll.getBoundingClientRect().top;});assert.equal(await page.evaluate(()=>window.scrollY),0);if(width===1536&&dock==='closed'||width===900&&dock==='open')await page.screenshot({path:`${out}/${width}-${theme}-${dock}.png`});
 await editor.getByRole('button',{name:'Save draft',exact:true}).click();await editor.waitFor({state:'hidden'});console.log('Fixture save completed');await page.locator('tbody tr').filter({hasText:'Synthetic principal'}).getByRole('button',{name:'Edit',exact:true}).click();await editor.getByLabel('Tax source',{exact:true}).waitFor();assert.equal(await editor.getByLabel('Commercial terms / payment plan',{exact:true}).inputValue(),'99999999-9999-4999-8999-999999999999');assert.equal(await editor.getByLabel('Tax source',{exact:true}).inputValue(),'Synthetic owner-reviewed terms');assert.equal(await editor.getByLabel('Deposit amount (USD)',{exact:true}).inputValue(),'500.00');
 results.push({width,height,theme,requestedDock:dock,actualDock:dock==='open'&&width<1080?'folded-for-editor':dock,geometry});await page.close();
}
const narrowOpen=[];
for(const [width,height] of [[1024,768],[900,1000]])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
 await page.goto(`${process.env.SALES_CONDITIONS_HARNESS_URL??'http://127.0.0.1:5298'}/solo/test-account/sales/payments?view=invoices&theme=${theme}&paige=open`,{waitUntil:'domcontentloaded'});
 const fold=page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last();await fold.waitFor();assert(await fold.isVisible());
 await page.screenshot({path:`${out}/${width}-${theme}-paige-open.png`});await fold.click();assert(await page.getByRole('button',{name:'Create invoice',exact:true}).isVisible());
 narrowOpen.push({width,height,theme,openOverlayVisible:true,foldRestoresSales:true});await page.close();
}
const recovery=await browser.newPage({viewport:{width:1536,height:770}});
await recovery.goto(`${process.env.SALES_CONDITIONS_HARNESS_URL??'http://127.0.0.1:5298'}/solo/test-account/sales/payments?view=invoices&terms-error=true`,{waitUntil:'domcontentloaded'});
await recovery.getByRole('button',{name:'Create invoice',exact:true}).click();const recoveryEditor=recovery.locator('.ide');
await recoveryEditor.getByLabel('Client',{exact:true}).selectOption('33333333-3333-4333-8333-333333333333');
await recoveryEditor.getByText('Commercial terms could not be read. Refresh this workspace.',{exact:true}).waitFor();
await recoveryEditor.getByRole('button',{name:'Refresh commercial terms',exact:true}).click();
await recoveryEditor.getByLabel('Commercial terms / payment plan',{exact:true}).selectOption('99999999-9999-4999-8999-999999999999');
assert((await recoveryEditor.textContent()).includes('schedule'));await recovery.close();
fs.writeFileSync(`${out}/rendered-proof.json`,JSON.stringify({boundary:'Actual Solo components with synthetic auth and in-memory transport. Save/reopen is fixture behavior, not authenticated database persistence or provider proof.',results,narrowOpen},null,2));console.log(`PASS ${results.length} conditions entry/validation/review/save/reopen/keyboard/reflow cases; ${narrowOpen.length} narrow PAIGE overlay/recovery cases`);
}finally{await browser.close();}
