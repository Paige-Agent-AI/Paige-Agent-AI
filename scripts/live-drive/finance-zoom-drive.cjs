const fs = require('fs');
fs.mkdirSync('docs/evidence/ui-delivery/assets/finance-compact', {recursive:true});
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
 const path=require('path'),os=require('os');
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'finance-zoom-'));
 fs.mkdirSync(path.join(profile,'Default'));
 fs.writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(2)/Math.log(1.2)}}}));
 const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROME_BIN,headless:true,viewport:null,args:['--window-size=1536,770']});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://harness.invalid/**',async route=>{const req=route.request();const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};if(req.method()==='OPTIONS')return route.fulfill({status:200,headers});const args=req.postDataJSON()??{};await route.fulfill({status:200,headers,json:req.url().includes('list_sales_invoices')?{rows,has_more:false,next_cursor:null}:metric(args)});});
 await page.goto('http://127.0.0.1:5199/finance.html?theme=light&paige=closed&tab=receivables',{waitUntil:'networkidle'});
 if(await page.locator('[data-tenant-shell]').getAttribute('data-paige')==='open') await page.keyboard.press('Control+Backslash');
 const geometry=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,bodyWidth:document.documentElement.scrollWidth,scrollOwner:getComputedStyle(document.querySelector('.finance-content')).overflowY}));
 const tabs=await page.getByRole('tab').count();await page.getByLabel('Find invoice').fill('SYN-1048');await page.getByRole('button',{name:'Inspect SYN-1048',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 const result={kind:'actual Chrome default browser zoom 200 percent; isolated profile; synthetic source only',codeCommit:'5e39e97a9e591dcab976e367f8bff90bc7b5aea0',geometry,tabs,drawerClosed:await page.getByRole('dialog').count()===0,errors};
 fs.mkdirSync('docs/evidence/ui-delivery/assets/finance-compact',{recursive:true});await page.screenshot({path:'docs/evidence/ui-delivery/assets/finance-compact/finance-zoom-200.png'});
 fs.writeFileSync('docs/evidence/ui-delivery/assets/finance-compact/finance-zoom-proof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await context.close();process.exitCode=errors.length||geometry.dpr!==2||geometry.bodyWidth>geometry.width||tabs!==6||!result.drawerClosed?1:0;
})().catch(e=>{console.error(e);process.exit(1)});



