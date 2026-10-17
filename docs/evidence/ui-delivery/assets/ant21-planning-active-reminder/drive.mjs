// Local synthetic transport only; native persistence/isolation has separate PG proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildLaunchOptions,resolvePlaywright} from '../../../../../scripts/live-drive/live-drive.mjs';
const out=new URL('./',import.meta.url);fs.mkdirSync(out,{recursive:true});
const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());
const results=[];
async function mount(width,height,theme,second=false) {
 const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce',timezoneId:second?'Pacific/Auckland':'America/New_York'}),page=await context.newPage();
 page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:5278/solo/10001/operations/work?screen=operations&theme=${theme}${second?'&tenant=second':''}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('region',{name:'Operations department',exact:true}).waitFor();
 if(await page.getByLabel('Direct PAIGE',{exact:true}).getAttribute('aria-expanded')==='true') {
  await page.locator('#tenant-paige-workspace').getByRole('button',{name:'Fold PAIGE conversation',exact:true}).click();
 }
 await page.evaluate(async second=>{
  const moduleUrl=performance.getEntriesByType('resource').find(e=>e.name.includes('/supabase-paige-stub.ts'))?.name;
  if(!moduleUrl)throw Error('Existing synthetic transport not loaded');const {supabase}=await import(moduleUrl),original=supabase.rpc;
  const tenant=second?'harness-tenant-second':'harness-tenant';window.__planningReads=[];window.__planningWrites=[];window.__planningMode='available';window.__planningWriteMode='acknowledged';
  const item=(id,title,status)=>({id,tenant_id:tenant,plan_id:null,item_type:'reminder',title,summary:'Synthetic saved record. No notification delivery is asserted.',status,priority:'normal',due_at:null,
   remind_at:'2099-01-01T13:00:00Z',remind_target:'user',remind_channel:'in_app',reminded_at:null,assigned_to_user_id:'harness-user',created_by:'harness-user',contact_id:null,linked_action_id:null,updated_at:'2026-10-16T13:00:00Z'});
  const saved=item('00000000-0000-4000-8000-000000000001','Saved reminder','open');
  const cancelled=item('00000000-0000-4000-8000-000000000002','Cancelled reminder','cancelled');
  window.__planningSaved=saved;
  supabase.rpc=(name,args)=>{
   if(name==='plan_list_operations_scoped'){
    window.__planningReads.push({name,args});if(window.__planningMode==='refused')return Promise.resolve({data:null,error:{code:'42501',message:'Synthetic refusal'}});
    return Promise.resolve({error:null,data:{plans:[],loose_items:[{...saved},...(args.p_include_cancelled===true?[{...cancelled}]:[])]}});
   }
   if(name==='plan_reschedule_reminder_versioned'){
    window.__planningWrites.push({name,args});
    const keys=['p_item_id','p_expected_actor_id','p_expected_tenant_id','p_expected_updated_at','p_remind_at'];
    if(Object.keys(args).length!==keys.length||!keys.every(key=>Object.hasOwn(args,key)))throw Error('Unexpected reschedule terms');
    if(args.p_item_id!==saved.id||args.p_expected_actor_id!=='harness-user'||args.p_expected_tenant_id!==tenant)return Promise.resolve({data:null,error:{code:'42501'}});
    if(args.p_expected_updated_at!==saved.updated_at)return Promise.resolve({data:null,error:{code:'40001'}});
    saved.remind_at=args.p_remind_at;saved.updated_at='2026-10-16T13:02:00Z';saved.reminded_at=null;
    if(window.__planningWriteMode==='lost')return Promise.reject(new Error('Synthetic acknowledgement lost after saved record change'));
    return Promise.resolve({error:null,data:{ok:true,item_id:saved.id,actor_id:'harness-user',tenant_id:tenant,remind_at:saved.remind_at,updated_at:saved.updated_at,railRecorded:true,receipt_status:'recorded',receipt_run_id:'00000000-0000-4000-8000-000000000003'}});
   }
   if(name==='operations_crm_work_read')return Promise.resolve({error:null,data:{ok:true,actor_id:'harness-user',tenant_id:tenant,tasks:[],has_more:false}});
   if(name==='is_tenant_admin')return Promise.resolve({error:null,data:true});
   if(name==='plan_item_activity_scoped')return Promise.resolve({error:null,data:{ok:true,item_id:args.p_item_id,actor_id:'harness-user',tenant_id:tenant,
    events:[{recorded_at:'2026-10-16T13:01:00Z',action:args.p_item_id===cancelled.id?'plan_remove_item':'plan_update_item',actor_id:'harness-user',status:null}]}});
   return original(name,args);
  };
 },second);
 await page.getByRole('button',{name:'Refresh work and team profiles',exact:true}).click();
 await page.getByRole('button',{name:/Saved reminder/}).first().waitFor();
 const expected=await page.evaluate(()=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date('2099-01-01T13:00:00Z')));
 assert.ok((await page.getByRole('button',{name:/Saved reminder/}).first().innerText()).includes('Reminder · '+expected));
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
    assert.equal(await page.getByRole('combobox',{name:'Filter work',exact:true}).inputValue(),'all');
    await page.locator('#tenant-paige-workspace:not([hidden])').waitFor();
    const name=`active-${width}x${height}-${theme}-open`;
    await page.screenshot({path:fileURLToPath(new URL(name+'.png',out))});
    await page.locator('#tenant-paige-workspace').getByRole('button',{name:'Fold PAIGE conversation',exact:true}).click();
    results.push({name,nativePaigeOpen:true,nativeFold:true,historyRetained:true,departmentInteraction:'Performed while PAIGE closed; native overlay retained',pageErrors:errors});
    continue;
   }
   const active=page.getByRole('button',{name:/Saved reminder/}).first();await active.focus();await page.keyboard.press('Enter');
   const editor=page.getByRole('dialog');await editor.getByLabel('New reminder time',{exact:true}).fill('2099-02-01T09:30');
   await editor.getByRole('combobox',{name:'Priority',exact:true}).selectOption('high');
   await editor.getByRole('button',{name:'Save change',exact:true}).click();
   await editor.getByText('Review reminder rescheduling separately from other work changes.',{exact:true}).waitFor();
   assert.equal((await page.evaluate(()=>window.__planningWrites)).length,0);
   await editor.getByRole('combobox',{name:'Priority',exact:true}).selectOption('normal');
   await editor.getByRole('button',{name:'Save change',exact:true}).click();
   await editor.getByText('Saved and confirmed in current work.',{exact:true}).waitFor();
   const activeTime=await editor.evaluate(el=>{
    const value=Array.from(el.querySelectorAll('dt')).find(dt=>dt.textContent==='Reminder time')?.nextElementSibling;
    return {actual:value?.textContent,expected:new Date(window.__planningSaved.remind_at).toLocaleString(),fits:Boolean(value&&value.scrollWidth<=value.clientWidth+1)};
   });assert.equal(activeTime.actual,activeTime.expected);assert.equal(activeTime.fits,true);
   const writes=await page.evaluate(()=>window.__planningWrites);assert.equal(writes.length,1);assert.equal(writes[0].name,'plan_reschedule_reminder_versioned');
   await editor.getByLabel('New reminder time',{exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:fileURLToPath(new URL(`active-${width}x${height}-${theme}-closed.png`,out))});
   await page.keyboard.press('Escape');await editor.waitFor({state:'hidden'});assert.equal(await active.evaluate(el=>el===document.activeElement),true);
   const filter=page.getByRole('combobox',{name:'Filter work',exact:true});await filter.selectOption('all');
   await page.getByRole('button',{name:/Cancelled reminder/}).first().waitFor();
   await filter.selectOption('cancelled');assert.equal(await page.getByRole('button',{name:/Saved reminder/}).count(),0);
   const cancelled=page.getByRole('button',{name:/Cancelled reminder/}).first();await cancelled.focus();await page.keyboard.press('Enter');
   const detail=page.getByRole('dialog');await detail.getByText('This work is cancelled. You can inspect its recorded details and activity.',{exact:true}).waitFor();
   await detail.getByText('Work removed',{exact:true}).waitFor();assert.equal(await detail.getByRole('button',{name:'Save change',exact:true}).count(),0);
   const savedTime=await detail.evaluate(el=>{
    const label=Array.from(el.querySelectorAll('dt')).find(dt=>dt.textContent==='Reminder time');
    const value=label?.nextElementSibling;
    return {actual:value?.textContent,expected:new Date('2099-01-01T13:00:00Z').toLocaleString(),fits:Boolean(value&&value.scrollWidth<=value.clientWidth+1)};
   });
   assert.equal(savedTime.actual,savedTime.expected);assert.equal(savedTime.fits,true);
   assert.equal(await detail.getByText('No due date',{exact:true}).count(),0);
   const name=`active-${width}x${height}-${theme}-closed`;
   await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});assert.equal(await cancelled.evaluate(el=>el===document.activeElement),true);
   await filter.selectOption('all');
   results.push({name,activeRescheduled:true,mixedEditRefused:true,exactNativeWrapper:true,independentReadback:true,activeReminderTime:activeTime.actual,cancelledFound:true,inspectOnly:true,activityFound:true,reminderTime:savedTime.actual,dateFits:true,focusRestored:true,pageErrors:errors});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 const {page,context}=await mount(1366,768,'light',true);
 await page.getByRole('button',{name:/Saved reminder/}).first().click();
 const unknown=page.getByRole('dialog');await page.evaluate(()=>window.__planningWriteMode='lost');
 await unknown.getByLabel('New reminder time',{exact:true}).fill('2099-03-01T09:30');await unknown.getByRole('button',{name:'Save change',exact:true}).click();
 await unknown.getByText('The result couldn’t be confirmed. Refresh the work before trying again.',{exact:true}).waitFor();
 assert.equal(await unknown.getByRole('button',{name:'Save change',exact:true}).isDisabled(),true);assert.equal((await page.evaluate(()=>window.__planningWrites)).length,1);
 await unknown.getByRole('button',{name:'Refresh and review',exact:true}).click();
 await unknown.getByText('Current work refreshed. Review the details before making another change.',{exact:true}).waitFor();
 assert.equal(await unknown.getByText('Saved and confirmed in current work.',{exact:true}).count(),0);assert.equal((await page.evaluate(()=>window.__planningWrites)).length,1);
 await page.keyboard.press('Escape');await unknown.waitFor({state:'hidden'});
 await page.evaluate(()=>window.__planningMode='refused');await page.getByRole('button',{name:'Refresh work and team profiles',exact:true}).click();
 await page.getByRole('button',{name:'Retry planning work',exact:true}).waitFor();
 await page.evaluate(()=>window.__planningMode='available');await page.getByRole('button',{name:'Retry planning work',exact:true}).click();await page.getByRole('button',{name:/Saved reminder/}).first().waitFor();
 const reads=await page.evaluate(()=>window.__planningReads);assert.ok(reads.every(r=>r.args.p_expected_tenant_id==='harness-tenant-second'&&r.args.p_include_cancelled===true));
 results.push({name:'second-context-refusal-retry',reads:reads.length,scopeBound:true,lostAcknowledgementHeld:true,readOnlyRecovery:true,noRetry:true,reminderTimeLocalToBrowser:true,timezone:'Pacific/Auckland'});await context.close();
 fs.writeFileSync(new URL('results.json',out),JSON.stringify({proof:'LOCAL SYNTHETIC REAL COMPONENT/SHELL; NOT AUTHENTICATED OR DATABASE ACCEPTANCE',results},null,2)+'\n');
 console.log(`PASS ${results.length} local active reminder reschedule/history interaction cases`);
}finally {await browser.close();}
