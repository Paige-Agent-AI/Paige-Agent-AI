import fs from 'node:fs';
import path from 'node:path';
import {resolvePlaywright,buildLaunchOptions} from './live-drive.mjs';
const out=path.resolve('scripts/live-drive/artifacts/sales-collections-provider-balance');fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright(),browser=await chromium.launch(buildLaunchOptions()),page=await browser.newPage();page.setDefaultTimeout(30000);
const errors=[],results=[];page.on('pageerror',error=>errors.push(error.message));
try{
 for(const mode of ['partial','full'])for(const theme of ['light','dark'])for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844]]){
  const name=`${mode}-${theme}-${width}-${height}`;await page.setViewportSize({width,height});
  await page.goto(`http://127.0.0.1:5293/solo/test-account/sales/payments?view=collections&provider=${mode}&theme=${theme}&paige=closed`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Create collection',exact:true}).waitFor();
  await page.getByRole('button',{name:'Receipts',exact:true}).click();
  await page.getByText('Provider confirmed',{exact:false}).first().waitFor();
  if(await page.getByText('Human recorded',{exact:true}).count())throw Error('Provider mislabelled as human');
  await page.screenshot({path:path.join(out,`${name}-receipts.png`),animations:'disabled'});
  await page.getByRole('button',{name:'Due & upcoming',exact:true}).click();
  if(mode==='full'){
   const upcoming=await page.locator('.sc-facts article').filter({hasText:'Upcoming'}).locator('strong').innerText();
   if(upcoming!=='1')throw Error(`Satisfied invoice included in upcoming count: ${upcoming}`);
  }
  await page.getByRole('button',{name:'Open',exact:true}).first().click();
  const expected=mode==='full'?'$150.00':'$50.00';
  await page.getByText(`Provider confirmed: ${expected}.`,{exact:true}).waitFor();
  await page.getByText('Payments & records',{exact:true}).waitFor();
  const conservation=await page.locator('.sc-detail-total').innerText();
  if(!conservation.includes(mode==='full'?'$0.00':'$100.00'))throw Error('Remaining balance not shown');
  const geometry=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,drawerOpacity:getComputedStyle(document.querySelector('.sc-drawer')).opacity}));
  if(geometry.documentWidth>width+1||geometry.drawerOpacity!=='1')throw Error('Balance drawer geometry failed');
  await page.screenshot({path:path.join(out,`${name}-balance.png`),animations:'disabled'});
  results.push({name,conservation,geometry});
 }
 if(errors.length)throw Error(errors.join(';'));
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({boundary:'Synthetic component/RPC evidence only. No authenticated tenant/provider/payment execution.',errors,results},null,2));
 console.log(`PASS ${results.length} provider-balance fixture cases: provenance, conserved partial/full balance, satisfied-obligation due exclusion, drawer geometry.`);
}finally{await browser.close();}
