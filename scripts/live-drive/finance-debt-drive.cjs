const fs = require('fs');
fs.mkdirSync('docs/evidence/ui-delivery/assets/finance-debt-credit', {recursive:true});
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const tenant = '11111111-1111-4111-8111-111111111111';
const test = fs.readFileSync('src/solo/sales/invoiceLifecycleApi.test.ts', 'utf8');
// Reuse the existing synthetic Sales test contract, not a parallel parser.
const snapshot = Function('return (' + test.match(/const snapshot=(.*);\r?\n/)[1] + ')')();
const rows = [3200000, 4000000, 1200000].map((amount, index) => {
  const snap = {...snapshot, total_minor: amount, due_now_minor: amount, items: [{...snapshot.items[0], item: ['Conseil / debt reconciliation', 'Delivery services', 'Original source wording'][index], unit_minor: amount}]};
  return {id:`22222222-2222-4222-8222-22222222222${index}`,tenant_id:tenant,status:'issued',invoice_number:`SYN-${1048+index}`,billing_draft_version:1,version:2,amount_total_cents:amount,billing_draft:snap,issued_snapshot_version:1,document:{renderer_version:'paige-invoice-html-v1',snapshot:snap},document_input_digest:'a'.repeat(64),manual_recorded_cents:0,remaining_cents:amount,payments:[],payments_count:0,payments_has_more:false};
});
function metric(args) {
 const now=new Date().toISOString();
 const amount = args.p_metric_key.includes('overdue') ? '3200000' : args.p_metric_key.includes('cash') ? '9840000' : args.p_metric_key.includes('issued_amount') ? '11200000' : '8400000';
 return {metric_key:args.p_metric_key,metric_version:'1.0.0',owner_department:'sales',label:'Synthetic source metric',definition:'Synthetic canonical contract fixture. Not authenticated financial evidence.',formula:'Canonical server computation',range:{key:args.p_range_key,start:args.p_range_start,end:args.p_range_end,bounds:'[start,end)',timezone:'UTC',semantics:'current_snapshot'},dimensions:{},values:{kind:'currency_totals',by_currency:[{currency:'usd',amount_minor:amount,record_count:3}],breakdown:args.p_metric_key.includes('cash')?[{currency:'usd',source:'human_recorded',amount_minor:'840000',record_count:1},{currency:'usd',source:'provider_verified_live',amount_minor:'9000000',record_count:2}]:[]},unit:'currency_minor',source_refs:['public.paige_invoices'],as_of:now,freshness:{queried_at:now,source_updated_through:null},coverage:{state:'complete',candidate_count:3,contributing_count:3,excluded_count:0},exclusions:[],truth_state:'LIVE',caveats:['SYNTHETIC render fixture; not real company finances.'],source_revision_ref:'sr_v1_'+ 'a'.repeat(64),account_epoch:args.p_account_epoch,account_epoch_ref:'ae_v1_'+ 'b'.repeat(64),evidence_ref:'aneb_v1_'+ 'c'.repeat(64),reference_expires_at:new Date(Date.now()+900000).toISOString()};
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
 const report={kind:'actual source components; synthetic RPC fixtures; not authenticated',frames:[],checks:[],errors:[]};
 let mode='ready', requests=0;
 const page=await browser.newPage({reducedMotion:'reduce'});
 page.on('pageerror',e=>report.errors.push(e.message));
 async function debtGoto(url){await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('.debt-credit-workspace').waitFor();await page.evaluate(()=>document.fonts.ready);}
 await page.addInitScript(()=>{localStorage.setItem('paige.agentRail.sessionCount','10');localStorage.setItem('paige.agentRail.collapsed',new URLSearchParams(location.search).get('paige')==='open'?'false':'true');});
 await page.route('http://harness.invalid/**',async route=>{
  const request=route.request();const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
  if(request.method()==='OPTIONS')return route.fulfill({status:200,headers});
  requests++;const args=request.postDataJSON()??{};
  if(mode==='error')return route.fulfill({status:503,headers,json:{message:'Synthetic source error'}});
  if(mode==='denied')return route.fulfill({status:403,headers,json:{code:'42501',message:'Synthetic refusal'}});
  const data=request.url().includes('list_sales_invoices')?{rows:mode==='empty'?[]:rows,has_more:false,next_cursor:null}:metric(args);
  if(mode==='partial' && data.metric_key){data.truth_state='PARTIAL';data.coverage={state:'partial',candidate_count:4,contributing_count:3,excluded_count:1};data.exclusions=[{reason:'missing_source',count:1}];}
  await route.fulfill({status:200,headers,json:data});
 });
 for(const theme of ['dark','light']) for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844]]) for(const paige of ['closed','open']) {
  await page.setViewportSize({width,height});
  await page.goto(`http://127.0.0.1:5199/finance.html?theme=${theme}&paige=${paige}`,{waitUntil:'networkidle'});
  await page.locator('.finance-value').first().waitFor();
  for(const index of [0,1,2,3,4,5,6]){
   // Narrow PAIGE overlay is folded to reach the underlying department; record the real state.
   if(width<=1024 && index>0 && await page.locator('[data-tenant-shell]').getAttribute('data-paige')==='open') await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
   const tab=page.getByRole('tab').nth(index);await tab.click({force:width<=1024 && paige==='open' && index===0});
   const label=await tab.innerText();
   if(paige==='open' && await page.locator('[data-tenant-shell]').getAttribute('data-paige')==='closed') await page.keyboard.press('Control+Backslash');
   await page.waitForTimeout(60);
   const geometry=await page.evaluate(()=>({bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth,panelWidth:document.querySelector('.finance-content').clientWidth,panelScroll:document.querySelector('.finance-content').scrollHeight,paige:document.querySelector('[data-tenant-shell]').dataset.paige,theme:document.querySelector('[data-tenant-shell]').dataset.pg}));
   const file=`docs/evidence/ui-delivery/assets/finance-debt-credit/finance-runtime-${theme}-${width}-${paige}-${index}.png`;
   await page.screenshot({path:file});report.frames.push({theme,width,height,requestedPaige:paige,label,geometry,file,bannerCount:await page.locator(".finance-executive,.finance-page-heading,.finance-content > h1").count()});
  }
 }
 await page.setViewportSize({width:1536,height:770});
 await page.goto('http://127.0.0.1:5199/finance.html?theme=dark&tab=receivables',{waitUntil:'networkidle'});
 const input=page.getByLabel('Find invoice');await input.fill('SYN-1048');report.checks.push({name:'search retains focus',pass:await input.evaluate(node=>node===document.activeElement)});
 await page.getByRole('button',{name:'Inspect SYN-1048',exact:true}).click();
 await page.getByRole('dialog').waitFor();await page.waitForTimeout(550);report.checks.push({name:'original invoice line wording',pass:(await page.getByRole('dialog').innerText()).includes('Conseil / debt reconciliation')});
 await page.screenshot({path:'docs/evidence/ui-delivery/assets/finance-debt-credit/finance-runtime-invoice-evidence.png'});await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 report.checks.push({name:'drawer Escape recovery',pass:await page.getByRole('dialog').count()===0});
 const before=requests;await page.getByRole('button',{name:'Refresh sources',exact:true}).click();await page.waitForTimeout(250);report.checks.push({name:'refresh rereads canonical sources',pass:requests>before});
 for(const state of ['empty','partial','error','denied']){mode=state;await page.reload({waitUntil:'networkidle'});const text=await page.locator('body').innerText();report.checks.push({name:state,pass:state==='empty'?text.includes('No matching invoices'):state==='partial'?text.includes('PARTIAL'):state==='denied'?text.includes('Financial access is restricted'):text.includes('Invoice records could not load')});await page.screenshot({path:`docs/evidence/ui-delivery/assets/finance-debt-credit/finance-runtime-state-${state}.png`});}
 for(const theme of ['dark','light']) for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844]]) for(const paige of ['closed','open']) {
  await page.setViewportSize({width,height});await debtGoto(`http://127.0.0.1:5199/finance-debt-credit.html?theme=${theme}&paige=${paige}`);
  const geometry=await page.evaluate(()=>({bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth,panelWidth:document.querySelector('.finance-content').clientWidth,panelScroll:document.querySelector('.finance-content').scrollHeight,paige:document.querySelector('[data-tenant-shell]').dataset.paige,theme:document.querySelector('[data-tenant-shell]').dataset.pg}));
  const file=`docs/evidence/ui-delivery/assets/finance-debt-credit/populated-${theme}-${width}-${paige}.png`;await page.screenshot({path:file});report.frames.push({theme,width,height,requestedPaige:paige,label:'Populated synthetic Debt & Credit',geometry,file,bannerCount:0});
 }
 await page.setViewportSize({width:1536,height:770});await debtGoto('http://127.0.0.1:5199/finance-debt-credit.html?theme=dark&paige=closed');
 report.checks.push({name:'multiple same-institution cards and credit lines',pass:(await page.locator('.dc-table-scroll').innerText()).includes('Operations card')&&(await page.locator('.dc-table-scroll').innerText()).includes('Seasonal credit line')});
 await page.getByLabel('Financing type').selectOption('business_card');report.checks.push({name:'product filter keeps two separate cards',pass:(await page.locator('.dc-table-scroll').innerText()).includes('Operations card')&&!(await page.locator('.dc-table-scroll').innerText()).includes('Seasonal credit line')});
 await page.getByRole('button',{name:'Travel & supplier card',exact:true}).click();await page.getByRole('dialog').waitFor();await page.waitForTimeout(600);await page.screenshot({path:'docs/evidence/ui-delivery/assets/finance-debt-credit/account-evidence.png'});await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});report.checks.push({name:'debt drawer Escape and focus restoration',pass:await page.getByRole('button',{name:'Travel & supplier card',exact:true}).evaluate(n=>n===document.activeElement)});
 await page.getByRole('button',{name:'Coverage & source matching',exact:true}).click();await page.getByRole('dialog').waitFor();report.checks.push({name:'coverage excludes unverified matches',pass:(await page.getByRole('dialog').innerText()).includes('explicit verified matches')});await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 for(const state of ['loading','empty','partial','error','denied','unavailable','expired']){await debtGoto(`http://127.0.0.1:5199/finance-debt-credit.html?theme=dark&paige=closed&state=${state}`);const text=await page.locator('body').innerText();report.checks.push({name:'debt '+state,pass:state==='denied'?!text.includes('Operations card'):state==='expired'?text.includes('Evidence expired'):state==='loading'?text.includes('Reading financial sources'):state==='partial'?text.includes('Partial source coverage'):state==='error'?text.includes('could not load'):state==='empty'?text.includes('No source accounts match'):text.includes('Company financing sources needed')});await page.screenshot({path:`docs/evidence/ui-delivery/assets/finance-debt-credit/state-${state}.png`});}
 await debtGoto('http://127.0.0.1:5199/finance-debt-credit.html?theme=dark&paige=closed&epoch=other');report.checks.push({name:'different epoch withholds financial facts',pass:!(await page.locator('body').innerText()).includes('Operations card')});
 fs.writeFileSync('docs/evidence/ui-delivery/assets/finance-debt-credit/finance-runtime-proof.json' ,JSON.stringify(report,null,2));await browser.close();
 console.log(JSON.stringify({frames:report.frames.length,checks:report.checks,errors:report.errors,overflows:report.frames.filter(frame=>frame.geometry.bodyWidth>frame.width)}));
 process.exitCode=report.errors.length||report.checks.some(check=>!check.pass)||report.frames.some(frame=>frame.geometry.bodyWidth>frame.width || frame.bannerCount>0)?1:0;
})().catch(error=>{console.error(error);process.exit(1)});
