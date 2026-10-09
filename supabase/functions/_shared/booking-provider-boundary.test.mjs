import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
const base = new URL('../', import.meta.url);
function source(name) { return (process.env.BOUNDARY_TEST_BASELINE ? execFileSync('git',['show',`${process.env.BOUNDARY_TEST_BASELINE}:supabase/functions/${name}/index.ts`],{encoding:'utf8'}) : readFileSync(new URL(`${name}/index.ts`, base),'utf8')).replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''); }
function harness(name, allowed, {providerOk=true,remindChannel='email',calendarTenant='tenant'}={}) {
 const writes=[], effects=[], scopes=[]; let planFired=false;
 const booking={id:'booking',tenant_id:'tenant',calendar_id:'calendar',host_user_id:'host',guest_email:'guest@example.test',guest_name:'Guest',status:'scheduled',start_at:new Date(Date.now()-120*60000).toISOString(),end_at:new Date(Date.now()-90*60000).toISOString(),timezone:'UTC',manage_token_version:0};
 const calendar={id:'calendar',tenant_id:calendarTenant,title:'Session',notify_config:{followup_guest:true,followup_offset_min:1}};
 const reminder={id:'reminder',tenant_id:'tenant',title:'Title',summary:'Summary',assigned_to_user_id:'host',remind_channel:remindChannel,metadata:{keep:true}};
 const data={internal_bookings:[booking],calendars:[calendar],tenants:[{id:'tenant',name:'Brand'}],plan_items:[reminder],tenant_invite_tokens:[{id:'invite',tenant_id:'tenant',expires_at:'2099-01-01',email:'guest@example.test',kind:'consumer'}]};
 const admin={rpc:async(name,args)=>{ if(name==='comms_provider_execution_allowed'){scopes.push(args);if(allowed==='throw')throw Error('database unavailable');return allowed==='error'?{data:true,error:{message:'unavailable'}}:{data:allowed,error:null};}return {data:name==='verify_cron_token'?true:null,error:null};}, auth:{admin:{getUserById:async()=>({data:{user:{email:'host@example.test'}}})}},from(table){let mutation=null;const query=new Proxy({}, {get(_,prop){if(prop==='then')return resolve=>resolve({data:mutation?null:(table==='plan_items'&&planFired?[]:(data[table]||[])),error:null});if(prop==='maybeSingle'||prop==='single')return async()=>{if(table==='plan_items'&&mutation){if(planFired)return {data:null,error:null};planFired=true;}return {data:mutation?{id:'reminder'}:(data[table]?.[0]??null),error:null};};return (...args)=>{if(['insert','update','delete'].includes(prop)){mutation=prop;writes.push({table,kind:prop,payload:args[0]});}return query;};}});return query;}};
 const ctx=vm.createContext({console,Response,Request,Headers,URL,TextEncoder,TextDecoder,crypto:webcrypto,btoa,atob,Date,createClient:()=>admin,clientIp:()=> 'test',overRateLimit:async()=>false,parseLifecycle:()=>[],channelsOf:()=>[],targetsOf:()=>[],primaryPhonesForUsers:async()=>new Map(),renderTemplate:(x)=>x,sendSms:async(...args)=>{effects.push({sms:args});return true;},Deno:{env:{get:()=> 'configured'},serve:fn=>ctx.handler=fn},fetch:async(url,options)=>{effects.push({url,payload:JSON.parse(options.body)});return new Response(JSON.stringify({id:'controlled-message'}),{status:providerOk?200:503});}});
 const helper=readFileSync(new URL('_shared/comms-provider-boundary.ts',base),'utf8').replace(/\bexport /g,'');
 vm.runInContext(stripTypeScriptTypes(helper),ctx);
 vm.runInContext(stripTypeScriptTypes(source(name)),ctx);
 if(name==='process-booking-notifications')vm.runInContext('manageUrl=async()=>"https://unit.test/manage";',ctx);
 if(name==='public-booking')vm.runInContext('loadCalendar=async()=>({tenant_id:"tenant",user_id:"host",appointmentTypes:[],horizonDays:60});',ctx);
 if(name==='booking-manage')vm.runInContext('verifyToken=async()=>({ok:true,bookingId:"booking",ver:0});syncZoom=async()=>effects.push({zoom:true});notifyChange=async()=>effects.push({notification:true});',Object.assign(ctx,{effects}));
 return {ctx,writes,effects,scopes,run:async(body)=>ctx.handler(new Request('https://unit.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body??{})}))};
}
for(const mode of [false,'error','throw'])for(const name of ['public-booking','booking-manage','process-booking-notifications','plan-reminder-cron','send-portal-invite'])test(`${name}: ${mode} refuses all provider/queue effects`,async()=>{
 const h=harness(name,mode);const body=name==='public-booking'?{action:'create',slug:'synthetic',guest:{email:'guest@example.test'}}:name==='booking-manage'?{action:'cancel',token:'valid'}:name==='send-portal-invite'?{token:'valid',email:'guest@example.test'}:{};
 const res=await h.run(body);const output=await res.json();assert.equal(h.effects.length,0);assert.equal(h.scopes[0]._tenant_id,'tenant');assert.equal(h.writes.some(w=>['booking_notifications_sent','email_send_log'].includes(w.table)),false);
 if(name!=='plan-reminder-cron')assert.equal(h.writes.some(w=>w.table==='notifications'),false);
 if(name==='process-booking-notifications'){assert.equal(output.blocked,1);assert.equal(h.writes[0].payload.reminder_state.provider_execution,'blocked');}
 else if(name==='plan-reminder-cron'){assert.equal(output.emailed,0);assert.equal(output.in_app,1);assert.equal(output.email_blocked,1);assert.equal(h.writes[1].table,'notifications');assert.equal(h.writes[2].payload.metadata.provider_execution,'blocked');assert.equal(h.writes[2].payload.metadata.keep,true);assert.equal(h.writes.some(w=>w.payload?.status==='cancelled'),false);}
 else{assert.equal(res.status,403);assert.equal(output.code,'COMMS_PROVIDER_EXECUTION_DISABLED');assert.equal(h.writes.length,0);}
});
for(const name of ['send-portal-invite','plan-reminder-cron','process-booking-notifications'])for(const providerOk of [true,false])test(`${name}: ordinary tenant keeps delivery payload and provider failure truthful (${providerOk})`,async()=>{
 const h=harness(name,true,{providerOk});const res=await h.run(name==='send-portal-invite'?{token:'valid',email:'guest@example.test'}:{});const out=await res.json();assert.equal(h.effects.length,1);assert.equal(h.effects[0].url,'https://api.resend.com/emails');assert.deepEqual(Array.from(h.effects[0].payload.to),[name==='plan-reminder-cron'?'host@example.test':'guest@example.test']);assert.ok(h.effects[0].payload.html);assert.ok(h.effects[0].payload.subject);
 if(name==='send-portal-invite')assert.equal(out.emailed,providerOk);else if(name==='plan-reminder-cron')assert.equal(out.emailed,providerOk?1:0);else assert.equal(out.followups,providerOk?1:0);
});
test('public-booking ordinary validation remains unchanged',async()=>{const h=harness('public-booking',true);const res=await h.run({action:'create',slug:'normal'});assert.equal(res.status,400);assert.equal((await res.json()).error,'Invalid time.');});
test('booking-manage ordinary cancel retains exact domain patch and dispatch',async()=>{const h=harness('booking-manage',true);const res=await h.run({action:'cancel',token:'valid'});assert.equal(res.status,200);assert.equal((await res.json()).status,'cancelled');assert.equal(h.effects.length,2);assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].payload)),{status:'cancelled',manage_token_version:1});});

for(const name of ['send-portal-invite','plan-reminder-cron','process-booking-notifications'])test(`${name}: normal provider request is byte-equivalent to pre-repair payload`,async()=>{
 const current=harness(name,true);
 const old=process.env.BOUNDARY_TEST_BASELINE;
 process.env.BOUNDARY_TEST_BASELINE='e82b93943d5807225387e21b3cc437c1e7fc6142';
 const baseline=harness(name,true);
 if(old)process.env.BOUNDARY_TEST_BASELINE=old;else delete process.env.BOUNDARY_TEST_BASELINE;
 const body=name==='send-portal-invite'?{token:'valid',email:'guest@example.test'}:{};
 await current.run(body);await baseline.run(body);
 assert.equal(JSON.stringify(current.effects),JSON.stringify(baseline.effects));
});

for(const mode of [false,'error','throw'])test(`plan-reminder: restricted in_app remains internal-only (${mode})`,async()=>{
 const h=harness('plan-reminder-cron',mode,{remindChannel:'in_app'});
 const out=await (await h.run({})).json();
 assert.equal(out.in_app,1);assert.equal(out.emailed,0);assert.equal(out.email_blocked,0);assert.equal(h.effects.length,0);assert.equal(h.scopes.length,0);
 assert.equal(h.writes.length,2);assert.equal(h.writes[1].table,'notifications');assert.equal(h.writes[0].payload.reminded_at!==null,true);
});

for(const channel of ['email','in_app'])test(`plan-reminder ${channel}: a claimed restricted reminder neither duplicates internal delivery nor retries external delivery`,async()=>{
 const h=harness('plan-reminder-cron',false,{remindChannel:channel});
 const first=await (await h.run({})).json();
 const second=await (await h.run({})).json();
 assert.equal(first.in_app,1);assert.equal(second.in_app,0);assert.equal(second.scanned,0);assert.equal(h.effects.length,0);
 assert.equal(h.writes.filter(w=>w.table==='notifications').length,1);assert.equal(h.scopes.length,channel==='email'?1:0);
});

for(const calendarTenant of [null,42,{},[]])test(`scheduled booking malformed tenant (${JSON.stringify(calendarTenant)}) fails closed`,async()=>{
 const h=harness('process-booking-notifications',false,{calendarTenant});
 const out=await (await h.run({})).json();
 assert.equal(h.scopes.length,0);assert.equal(out.blocked,1);assert.equal(h.effects.length,0);
 assert.equal(h.writes.some(w=>w.table==='booking_notifications_sent'),false);
});
