import fs from 'node:fs';
import {resolvePlaywright,buildLaunchOptions} from './live-drive.mjs';
const {chromium}=await resolvePlaywright();
const browser=await chromium.launch(buildLaunchOptions());
const dir='scripts/live-drive/artifacts/sales-legacy-cutover';
fs.mkdirSync(dir,{recursive:true});
const evidence=[];
try {
 for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]]) for(const theme of ['light','dark']) for(const dock of ['closed','open']) {
  const page=await browser.newPage({viewport:{width,height}});
  for(const branch of ['growth','sales']) {
   await page.goto(`http://127.0.0.1:5264/solo/test-account/${branch}/overview?theme=${theme}&paige=${dock}`);
   await page.getByRole('tab',{name:'Overview',exact:true}).waitFor();
   const labels=await page.getByRole('tab').allTextContents();
   const expected=branch==='growth'?['Overview','Campaigns','Lead capture','Social','Analytics']:['Overview','Opportunities','Pipeline','Offers','Terms & Agreements','Payments','Performance'];
   if(JSON.stringify(labels.map(x=>x.trim()))!==JSON.stringify(expected))throw Error(`Wrong ${branch} tabs: ${labels}`);
   const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
   if(geometry.scrollWidth>width+1)throw Error('Document horizontal overflow');
   const path=`${dir}/${width}-${height}-${theme}-${dock}-${branch}.png`;
   await page.screenshot({path});evidence.push({branch,width,height,theme,dock,labels,geometry,path});
  }
  await page.close();
 }
 const page=await browser.newPage({viewport:{width:1536,height:770}});
 for(const [legacy,destination] of [['sales?view=revenue','sales/payments?view=revenue'],['sales?view=terms&resume=terms','sales/agreements?resume=terms'],['pipeline?deal=test-deal-a','sales/pipeline?deal=test-deal-a'],['catalog','sales/offers'],['catalog?type=page','growth/lead-capture?type=page']]) {
  await page.goto(`http://127.0.0.1:5264/solo/test-account/growth/${legacy}`);
  await page.waitForURL(`**/solo/test-account/${destination}`);
  await page.screenshot({path:`${dir}/legacy-${legacy.split('?')[0]}-${evidence.length}.png`});
  evidence.push({legacy,destination,url:page.url(),status:'PASS'});
 }
 await page.goto('http://127.0.0.1:5264/solo/test-account/growth/sales?view=invoices&billing-fixture=populated');
 await page.getByRole('button',{name:'Edit',exact:true}).first().click();
 await page.locator('.ide-body textarea').fill('Cutover unsaved draft');
 await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('alertdialog').waitFor();
 await page.getByRole('button',{name:'Continue editing',exact:true}).click();
 if(await page.locator('.ide-body textarea').inputValue()!=='Cutover unsaved draft')throw Error('Lost canonical draft');
 await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('alertdialog').waitFor();
 await page.getByRole('button',{name:'Discard changes',exact:true}).click();await page.waitForURL('**/sales/overview');
 evidence.push({canonicalDraft:'PASS legacy invoice entry retains canonical Keep/Discard guard',authenticated:'UNVERIFIED'});
 fs.writeFileSync(`${dir}/result.json`,JSON.stringify(evidence,null,2));console.log(`PASS ${evidence.length} cutover checks; local fixtures only`);
}finally {await browser.close();}
