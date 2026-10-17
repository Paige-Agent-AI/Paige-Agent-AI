// Local synthetic transport only; native persistence/isolation has separate PG proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildLaunchOptions,resolvePlaywright} from '../../../../../scripts/live-drive/live-drive.mjs';
const out=new URL('./',import.meta.url);fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());
const results=[];
async function mount(width,height,theme,second=false) {
 const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage();
 page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:5278/solo/10001/operations/work?screen=operations&theme=${theme}${second?'&tenant=second':''}`,{waitUntil:'domcontentloaded',timeout:20000});
 await page.getByRole('region',{name:'Operations department',exact:true}).waitFor();
 if(await page.getByLabel('Direct PAIGE',{exact:true}).getAttribute('aria-expanded')==='true') {
  await page.locator('#tenant-paige-workspace').getByRole('button',{name:'Fold PAIGE conversation',exact:true}).click();
 }
 await page.evaluate(async second=>{
  const moduleUrl=performance.getEntriesByType('resource').find(e=>e.name.includes('/supabase-paige-stub.ts'))?.name;
  if(!moduleUrl)throw Error('Existing synthetic transport not loaded');const {supabase}=await import(moduleUrl),original=supabase.rpc;
  const tenant=second?'harness-tenant-second':'harness-tenant';window.__planningReads=[];window.__planningMode='available';
  const item=(id,title,status)=>({id,tenant_id:tenant,plan_id:null,item_type:'reminder',title,summary:'Synthetic saved record. No notification delivery is asserted.',status,priority:'normal',due_at:null,
   remind_at:'2099-01-01T13:00:00Z',remind_target:'user',remind_channel:'in_app',reminded_at:null,assigned_to_user_id:'harness-user',created_by:'harness-user',contact_id:null,linked_action_id:null,updated_at:'2026-10-16T13:00:00Z'});
  supabase.rpc=(name,args)=>{
   if(name==='plan_list_operations_scoped'){
    window.__planningReads.push({name,args});if(window.__planningMode==='refused')return Promise.resolve({data:null,error:{code:'42501',message:'Synthetic refusal'}});
    return Promise.resolve({error:null,data:{plans:[],loose_items:[item('00000000-0000-4000-8000-000000000001','Saved reminder','open'),...(args.p_include_cancelled===true?[item('00000000-0000-4000-8000-000000000002','Cancelled reminder','cancelled')]:[])]}});
   }
   if(name==='operations_crm_work_read')return Promise.resolve({error:null,data:{ok:true,actor_id:'harness-user',tenant_id:tenant,tasks:[],has_more:false}});
   if(name==='is_tenant_admin')return Promise.resolve({error:null,data:true});
   if(name==='plan_item_activity_scoped')return Promise.resolve({error:null,data:{ok:true,item_id:args.p_item_id,actor_id:'harness-user',tenant_id:tenant,
    events:[{recorded_at:'2026-10-16T13:01:00Z',action:'plan_remove_item',actor_id:'harness-user',status:null}]}});
   return original(name,args);
  };
 },second);
 await page.getByRole('button',{name:'Refresh work and team profiles',exact:true}).click();
 await page.getByRole('button',{name:/Saved reminder/}).first().waitFor();
 assert.ok((await page.evaluate(()=>window.__planningReads)).every(read=>read.args.p_include_cancelled===true));
 return {page,context,errors};
}
try {
 for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]])for(const theme of ['light','dark']) {
  const {page,context,errors}=await mount(width,height,theme);
  for(const open of [false,true]) {
   const launcher=page.getByLabel('Direct PAIGE',{exact:true});
   if(open&&await launcher.getAttribute('aria-expanded')!=='true')await launcher.click();
   if(!open&&await launcher.getAttribute('aria-expanded')==='true')await page.locator('#tenant-paige-workspace').getByRole('button',{name:'Fold PAIGE conversation',exact:true}).click();
   assert.equal(await launcher.getAttribute('aria-expanded'),String(open));
   if(open) {
    assert.equal(await page.getByRole('combobox',{name:'Filter work',exact:true}).inputValue(),'cancelled');
    await page.locator('#tenant-paige-workspace:not([hidden])').waitFor();
    const name=`history-${width}x${height}-${theme}-open`;
    await page.screenshot({path:fileURLToPath(new URL(name+'.png',out))});
    await page.locator('#tenant-paige-workspace').getByRole('button',{name:'Fold PAIGE conversation',exact:true}).click();
    results.push({name,nativePaigeOpen:true,nativeFold:true,historyRetained:true,departmentInteraction:'Performed while PAIGE closed; native overlay retained',pageErrors:errors});
    continue;
   }
   const filter=page.getByRole('combobox',{name:'Filter work',exact:true});await filter.selectOption('all');
   await page.getByRole('button',{name:/Cancelled reminder/}).first().waitFor();
   await filter.selectOption('cancelled');assert.equal(await page.getByRole('button',{name:/Saved reminder/}).count(),0);
   const cancelled=page.getByRole('button',{name:/Cancelled reminder/}).first();await cancelled.focus();await page.keyboard.press('Enter');
   const detail=page.getByRole('dialog');await detail.getByText('This work is cancelled. You can inspect its recorded details and activity.',{exact:true}).waitFor();
   await detail.getByText('Work removed',{exact:true}).waitFor();assert.equal(await detail.getByRole('button',{name:'Save change',exact:true}).count(),0);
   const name=`history-${width}x${height}-${theme}-${open?'open':'closed'}`;await page.screenshot({path:fileURLToPath(new URL(name+'.png',out))});
   await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});assert.equal(await cancelled.evaluate(el=>el===document.activeElement),true);
   results.push({name,cancelledFound:true,inspectOnly:true,activityFound:true,focusRestored:true,pageErrors:errors});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 const {page,context}=await mount(1366,768,'light',true);
 await page.evaluate(()=>window.__planningMode='refused');await page.getByRole('button',{name:'Refresh work and team profiles',exact:true}).click();
 await page.getByRole('button',{name:'Retry planning work',exact:true}).waitFor();
 await page.evaluate(()=>window.__planningMode='available');await page.getByRole('button',{name:'Retry planning work',exact:true}).click();await page.getByRole('button',{name:/Saved reminder/}).first().waitFor();
 const reads=await page.evaluate(()=>window.__planningReads);assert.ok(reads.every(r=>r.args.p_expected_tenant_id==='harness-tenant-second'&&r.args.p_include_cancelled===true));
 results.push({name:'second-context-refusal-retry',reads:reads.length,scopeBound:true});await context.close();
 fs.writeFileSync(new URL('results.json',out),JSON.stringify({proof:'LOCAL SYNTHETIC REAL COMPONENT/SHELL; NOT AUTHENTICATED OR DATABASE ACCEPTANCE',results},null,2)+'\n');
 console.log(`PASS ${results.length} local Planning history interaction cases`);
}finally {await browser.close();}
