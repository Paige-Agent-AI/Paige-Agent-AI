import fs from 'node:fs';
import {resolvePlaywright,buildLaunchOptions} from './live-drive.mjs';
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());const results=[];
try {
 const page=await browser.newPage({viewport:{width:1536,height:770}});
 for(const search of ['?resume=terms','?view=invoices&resume=terms']) {
  await page.goto(`http://127.0.0.1:5264/solo/test-account/growth/sales${search}`);
  await page.waitForURL('**/sales/agreements?view=terms');
  await page.locator('.so-agreement-editor').waitFor();
  await page.screenshot({path:`scripts/live-drive/artifacts/sales-legacy-cutover/resume-editor-${results.length}.png`});
  results.push({legacy:search,canonical:page.url(),selected:await page.getByRole('tab',{name:'Terms & Agreements',exact:true}).getAttribute('aria-selected'),editor:await page.locator('.so-agreement-editor').count(),authenticated:'UNVERIFIED'});
 }
 fs.writeFileSync('scripts/live-drive/artifacts/sales-legacy-cutover/resume-result.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
} finally {await browser.close();}
