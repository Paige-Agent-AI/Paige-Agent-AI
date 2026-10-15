import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {renderSalesInvoiceDocument} from '../../../supabase/functions/_shared/sales-invoice-document.ts';
const exe=[chromium.executablePath(),'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
assert(exe);const server=await createServer({configFile:fileURLToPath(new URL('./vite.config.mjs',import.meta.url))});await server.listen();
const browser=await chromium.launch({executablePath:exe,headless:true});
const context=await browser.newContext({serviceWorkers:'block'}),requests=[],errors=[],cases=[];
const directory='docs/evidence/ui-delivery/assets/e04-client-commercial-status';mkdirSync(directory,{recursive:true});
const id=n=>`ec041105-0000-4000-8000-${String(n).padStart(12,'0')}`;
const document=renderSalesInvoiceDocument({document:{renderer_version:'paige-invoice-html-v2',invoice_number:'SYN-1',currency:'usd',issuer_name:'Synthetic service business',client_name:'Synthetic client',total_cents:350000,
 presentation:{template:'modern',accent:'#475569',footer:'Synthetic proof only',payment_instructions:'Use the authorized request shown with this invoice.'},
 snapshot:{items:[{item:'Agreed services',description:'Development fixture',quantity:1,unit_minor:350000}],due_now_minor:50000,remainder_minor:300000,due_date:'2026-10-15',payment_method_intents:[]}},
 document_input_digest:'a'.repeat(64),manual_recorded_cents:2000,provider_verified_cents:43000,test_provider_cents:3000,allocated_cents:45000,remaining_cents:305000});
assert(document);
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.hostname==='127.0.0.1')return route.continue();
 if(url.hostname!=='fixture.invalid'){requests.push(url.origin);return route.abort();}
 assert.equal(req.method(),'GET');assert.equal(url.searchParams.get('client_id'),id(3));assert.equal(url.searchParams.get('invoice_id'),id(4));
 assert.equal(req.headers().authorization,'Bearer synthetic-browser-transport-only');assert.equal(url.searchParams.has('token'),false);
 const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey','Cache-Control':'no-store'};
 if(url.searchParams.get('format')==='pdf')return route.fulfill({status:503,headers,body:'Synthetic PDF-only failure'});
 if(url.searchParams.get('format')==='payment-request')return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({remaining_cents:305000,payment_request:{amount_minor:50000,currency:'usd',state:'customer_action_required',environment:'test',provider_url:'https://checkout.stripe.com/c/pay/synthetic',expires_at:'2099-10-15T00:00:00Z'}})});
 return route.fulfill({status:200,headers,contentType:'text/html',body:document});
});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
const viewports=[{width:1536,height:770},{width:1366,height:768},{width:1024,height:768},{width:900,height:1000},{width:390,height:844},{width:320,height:720}];
try{
 await page.goto('http://127.0.0.1:54382/scripts/proof/e04-client-commercial-ui/fixtures/index.html',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('heading',{name:'Your invoices'}).waitFor({timeout:60000});
 for(const viewport of viewports){
  await page.setViewportSize(viewport);
  for(const theme of ['light','dark']){
   await page.getByLabel('Theme',{exact:true}).selectOption(theme);
   for(const phase of ['ready','loading','empty','offline','denied','partial','test','large']){
    await page.getByLabel('State',{exact:true}).selectOption(phase);
    const panel=page.locator('.client-commercial-panel');
    const expected={ready:'Invoice SYN-1',loading:'Checking your invoices',empty:'No invoices are available',offline:'could not be read',denied:'no longer available',partial:'More invoices',test:'Test activity is included',large:'Invoice SYN-1'}[phase];
    await panel.getByText(expected,{exact:false}).first().waitFor();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=0,JSON.stringify({viewport,theme,phase,overflow}));
    if(phase==='denied')assert.equal(await panel.getByText('Invoice SYN-1',{exact:true}).count(),0);
    if(phase==='large')assert.equal((await panel.locator('dd').textContent()).replace(/[^0-9]/g,''),'9007199254740993123456');
    const sizes=await panel.locator('button,a').evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().height));assert(sizes.every(height=>height>=44));
    cases.push({viewport,theme,phase,result:'PASS'});
   }
   await page.getByLabel('State',{exact:true}).selectOption('ready');await page.getByText('Invoice SYN-1',{exact:true}).waitFor();
   await page.screenshot({path:`${directory}/${viewport.width}-${theme}.png`,fullPage:true});
  }
 }
 await page.getByLabel('State',{exact:true}).selectOption('partial');await page.getByRole('button',{name:'More invoices',exact:true}).click();await page.getByText('Invoice SYN-2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Previous invoices',exact:true}).click();await page.getByText('Invoice SYN-1',{exact:true}).waitFor();
 const link=page.getByRole('link',{name:'View invoice syn-1 (opens a new tab)',exact:true});await link.focus();assert(await link.evaluate(el=>el===document.activeElement));
 const href=await link.getAttribute('href');assert(href.includes(`invoice_id=${id(4)}`)&&!href.includes('token='));
 await page.getByRole('button',{name:'Simulate sign-out'}).click();await page.getByText('These invoices are no longer available',{exact:false}).waitFor();
 await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Invoice SYN-1',{exact:true}).waitFor();
 await page.goto('http://127.0.0.1:54382/scripts/proof/e04-client-commercial-ui/fixtures/index.html?document=1',{waitUntil:'domcontentloaded'});
 await page.getByRole('link',{name:'Continue to test checkout'}).waitFor();
 for(const viewport of viewports){
  await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
  const frame=page.frameLocator('iframe');assert(await frame.getByRole('heading',{name:'Test payment activity'}).isVisible());
  assert.equal(await frame.getByText('Paid (provider-confirmed)',{exact:true}).count(),0);
  assert((await page.locator('iframe').boundingBox()).height>=120,JSON.stringify({viewport,error:'Invoice frame too small'}));
  await page.screenshot({path:`${directory}/${viewport.width}-document.png`,fullPage:true});
  cases.push({viewport,phase:'actual-document-test-evidence',result:'PASS'});
 }
 await page.getByRole('button',{name:'Download PDF',exact:true}).click();await page.getByText('PDF could not be opened',{exact:false}).waitFor();assert(await page.locator('iframe').isVisible());
 await page.getByRole('button',{name:'Simulate sign-out'}).click();await page.getByText('This invoice is unavailable',{exact:false}).waitFor();assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.getByRole('link',{name:'Continue to test checkout'}).count(),0);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
 const result={result:'PASS',cases:cases.length,details:cases,additional:'Actual source pagination, focus, scope-loss scrubbing, no token URL, document/checkout test labels, PDF-only failure and reduced-motion preference; synthetic SDK/network, not authenticated QA or native print/download'};
 writeFileSync(`${directory}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,details:undefined}));
}finally{await context.close();await browser.close();await server.close();}
