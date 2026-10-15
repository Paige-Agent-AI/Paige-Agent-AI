import fs from 'node:fs';
import path from 'node:path';
import {resolvePlaywright,buildLaunchOptions} from './live-drive.mjs';
const out=path.resolve('scripts/live-drive/artifacts/sales-workspace-refinements');fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const observations=[];
const geometry = async (target = page) => target.evaluate(() => {
  const rect = el => el.getBoundingClientRect().toJSON();
  const controls = [...document.querySelectorAll('.sales-tabs button,.sales-payments-tabs button,.ide-toolbar button,.ide-footer button,.ide-item button')].filter(el => el.getClientRects().length).map(el => {
    const box = el.getBoundingClientRect(); let clipped = box.right > innerWidth + 1 || box.bottom > innerHeight + 1 || box.left < -1 || box.top < -1;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node); const parent = node.getBoundingClientRect();
      if (['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX) && (box.left < parent.left - 1 || box.right > parent.right + 1)) clipped = true;
      if (['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowY) && (box.top < parent.top - 1 || box.bottom > parent.bottom + 1)) clipped = true;
    }
    return { label: el.textContent || el.getAttribute('aria-label'), rect: rect(el), clipped };
  });
  return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, main: rect(document.querySelector('#tenant-shell-main')), palette: getComputedStyle(document.querySelector('[data-tenant-shell]') ?? document.querySelector('#tenant-shell-main')).getPropertyValue('--pg-canvas'), controls, scrollOwners: [...document.querySelectorAll('*')].filter(el => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)).map(el => ({ class: el.className, height: el.clientHeight, scrollHeight: el.scrollHeight })) };
});
try {
 for(const theme of ['light','dark'])for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[430,932]])for(const paige of ['closed','open']){
 const name=width+'-'+height+'-'+paige+'-'+theme;await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:5267/solo/test-account/sales/payments?billing-fixture=populated&theme='+theme+'&paige='+paige,{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('button',{name:'Create invoice',exact:true}).waitFor();await page.waitForTimeout(150);const register=await geometry();await page.screenshot({path:path.join(out,name+'-register.png')});
 const paymentTabs=await page.locator('.sales-payments-tabs button').allTextContents();if(paymentTabs.includes('Overview'))throw Error('Duplicate Overview');if(await page.locator('.sales-payments-tabs button').first().getAttribute('aria-pressed')!=='true')throw Error('Default not Invoices');
 if(paige==='open'&&width<1080)await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
 await page.locator('.sb-register').getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('checkbox',{name:'Zelle',exact:true}).check();await page.getByLabel('Offer description 1',{exact:true}).fill('Customer scope\nEditable multiline detail');await page.screenshot({path:path.join(out,name+'-editor.png')});const editor=await geometry();await page.getByRole('button',{name:'Review invoice',exact:true}).click();await page.getByText('Customer scope',{exact:false}).first().waitFor();await page.screenshot({path:path.join(out,name+'-review.png')});const review=await geometry();const region=page.getByRole('region',{name:'Invoice details and review',exact:true});await region.focus();await page.keyboard.press('End');const keyboardScroll=await region.evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop}));await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Payment preferences: zelle',{exact:true}).waitFor();await page.getByText('Customer scope',{exact:false}).first().waitFor();observations.push({name,register,editor,review,paymentTabs,keyboardScroll,saveReadback:true,overlayExpected:paige==='open'&&width<1080});
 }
 fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify({boundary:'Production components/shell with local network/auth fixtures. Hosted auth/payment execution UNVERIFIED.',errors,observations},null,2));if(errors.length)throw Error(errors.join(';'));console.log('PASS: '+observations.length+' responsive register/editor/review/save-readback cases. Geometry finish review still required.');
}finally{await browser.close();}
