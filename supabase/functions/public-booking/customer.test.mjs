// Actual original handler and scheduling functions, injected SDK/provider IO.
// This is not authenticated Supabase, provider or customer acceptance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as portal from '../_shared/client-portal-booking.ts';

const id=n=>`e09b9000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture({type='personal',allowed=true}={}){
 const actor=id(1),tenant=id(2),client=id(3),host=id(4),secondHost=id(5),calendar=id(6);
 const profile={id:client,tenant_id:tenant,linked_user_id:actor,first_name:'Avery',last_name:'River',email:'client@example.test',phone:null};
 let activeActor=actor,visibleProfile=profile,lost=false,handler;
 const traces=[],commits=[],records=new Map(),rows=[],effects=[];
 let sequence=100;
 const cal={id:calendar,tenant_id:tenant,slug:'test-consultation',type,title:'Consultation',description:'Business-approved session',logo_url:null,accent:null,
  duration_min:30,buffer_before_min:0,buffer_after_min:0,min_notice_min:0,timezone:'UTC',enabled:true,theme:'light',subtitle:null,
  show_company_name:true,location_type:'phone',location_value:null,notify_config:{confirm_guest:false,confirm_host:false},
  location_options:[{type:'phone',value:null}],booking_horizon_days:60,redirect_url:null,intake_questions:[],appointment_types:[],date_overrides:[],capacity:2,
  assignment_strategy:{mode:'priority'},availability_json:Array.from({length:7},(_,day)=>({day,start:'09:00',end:'17:00'}))};
 const roster=[{calendar_id:calendar,user_id:host,priority:0,availability_json:null,timezone:null},
  ...(['collective','round_robin'].includes(type)?[{calendar_id:calendar,user_id:secondHost,priority:1,availability_json:null,timezone:null}]:[])];
 const source={calendars:[cal],calendar_hosts:roster,internal_bookings:rows,
  tenants:[{id:tenant,name:'Northwind Studio',settings_json:{}}],profiles:[],staff_calendar_settings:[]};
 const envelope=(a,state,booking=null)=>({schema_version:1,actor_id:a.p_verified_actor_id??activeActor,tenant_id:a.p_tenant_id,
  client_id:a.p_expected_client_id,request_id:a.p_request_id,state,booking});
 const caller={auth:{getUser:async()=>{traces.push({kind:'auth'});return {data:{user:activeActor?{id:activeActor}:null},error:activeActor?null:{message:'expired'}};}},
  rpc:async(name,a)=>{
   traces.push({kind:'caller',name,args:a});
   if(name==='client_portal_self_profile')return {data:a.p_tenant_id===tenant?visibleProfile:null,error:null};
   if(name==='client_portal_booking_request'){
    const record=records.get(a.p_request_id),same=activeActor===actor&&a.p_tenant_id===tenant&&a.p_expected_client_id===client;
    return {data:same?envelope(a,record?'saved':'not_found',record?.booking??null):null,error:same?null:{code:'42501'}};
   }
   throw Error('Unexpected caller method '+name);
  }};
 function query(table){
  let filters=[],order=null,selection='',insert=null,update=null,operation='read';
  const q={select:(value)=>{selection=value;return q;},eq:(k,v)=>{filters.push(x=>x[k]===v);return q;},neq:(k,v)=>{filters.push(x=>x[k]!==v);return q;},
   gte:(k,v)=>{filters.push(x=>x[k]>=v);return q;},lte:(k,v)=>{filters.push(x=>x[k]<=v);return q;},
   gt:(k,v)=>{filters.push(x=>x[k]>v);return q;},lt:(k,v)=>{filters.push(x=>x[k]<v);return q;},
   in:(k,v)=>{filters.push(x=>v.includes(x[k]));return q;},order:(k)=>{order=k;return q;},limit:()=>q,
   insert:(value)=>{operation='insert';insert=value;return q;},update:(value)=>{operation='update';update=value;return q;},delete:()=>{operation='delete';return q;},
   maybeSingle:()=>Promise.resolve(answer(true)),single:()=>Promise.resolve(answer(true)),then:(yes,no)=>Promise.resolve(answer(false)).then(yes,no)};
  function answer(single){
   traces.push({kind:'table',table,operation,selection});
   if(operation!=='read'){
    if(table==='internal_bookings'&&operation==='insert'){
     const inputs=Array.isArray(insert)?insert:[insert],created=inputs.map(value=>({id:id(++sequence),...value}));rows.push(...created);
     return {data:single?created[0]:created,error:null};
    }
    if(operation==='update')for(const row of source[table]??[])if(filters.every(f=>f(row)))Object.assign(row,update);
    return {data:single?null:[],error:null};
   }
   let data=(source[table]??[]).filter(row=>filters.every(f=>f(row)));if(order)data=[...data].sort((a,b)=>a[order]<b[order]?-1:1);
   // PostgREST's calendar select is an allowlist, excluding the lookup-only slug.
   if(table==='calendars'&&selection)data=data.map(row=>Object.fromEntries(selection.split(',').map(k=>k.trim()).map(k=>[k,row[k]??null])));
   return {data:single?data[0]??null:data,count:data.length,error:null};
  }
  return q;
 }
 const service={from:query,auth:{admin:{getUserById:async()=>({data:{user:{email:'host@example.test'}},error:null})}},
  functions:{invoke:async(name,args)=>{effects.push({kind:'internal',name,args});return {data:{ok:true},error:null};}},
  rpc:async(name,a)=>{
   traces.push({kind:'service',name,args:a});
   if(name==='client_portal_reconcile_booking'){
    const record=records.get(a.p_request_id),state=record?(JSON.stringify(record.intent)===JSON.stringify(a.p_expected_intent)?'saved':'conflict'):'not_found';
    return {data:{...envelope(a,state,state==='saved'?record.booking:null),replayed:true,execution:null},error:null};
   }
   if(name==='client_portal_commit_booking'){
    commits.push(a);const p=a.p_plan;
    const booking={id:id(++sequence),title:p.title,start_at:p.start_at,end_at:p.end_at,timezone:'UTC',status:'scheduled'};
    records.set(a.p_request_id,{booking,intent:a.p_request_intent});
    for(const user of p.host_ids)rows.push({...booking,host_user_id:user,calendar_id:calendar,tenant_id:tenant,contact_id:client,booking_kind:p.booking_kind});
    if(lost)throw Error('native response lost');
    return {data:{...envelope(a,'saved',booking),replayed:false,
     execution:{booking_kind:p.booking_kind,host_ids:p.host_ids,collective_group_id:p.booking_kind==='collective'?id(++sequence):null}},error:null};
   }
   if(name==='create_class_booking'){
    const booking={id:id(++sequence),title:a._title,start_at:a._start_at,end_at:a._end_at,host_user_id:a._host_user_id,contact_id:a._contact_id};
    rows.push(booking);return {data:booking,error:null};
   }
   return {data:null,error:null};
  }};
 let currentAllowed=allowed;
 const context=vm.createContext({Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Intl,Date,console,crypto:webcrypto,
  setTimeout,clearTimeout,structuredClone,...portal,
  Deno:{env:{get:name=>({SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[name]},serve:fn=>{handler=fn;}},
  createClient:(_url,key)=>{traces.push({kind:'sdk',key});return key==='synthetic-public'?caller:service;},
  commsProviderExecutionAllowed:async()=>currentAllowed,clientIp:()=> '127.0.0.1',overRateLimit:async()=>false,
  findClientIdByAddress:async()=>{traces.push({kind:'email-identity-lookup'});return client;},insertClientWithAddresses:async()=>{throw Error('Unexpected duplicate CRM');},
  primaryPhonesForUsers:async()=>[],emailOptOut:async()=> 'clear',parseLifecycle:()=>[],channelsOf:()=>[],targetsOf:()=>[],renderTemplate:v=>v,
  lifecycleEmailHtml:()=>'',sendSms:async()=>{effects.push({kind:'external-sms'});return true;},
  sendPlatformEmail:async()=>{effects.push({kind:'external-email'});return {ok:true};},createZoomMeeting:async()=>{effects.push({kind:'external-zoom'});return null;},
 });
 const raw=fs.readFileSync(new URL('./index.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
 vm.runInContext(stripTypeScriptTypes(raw,{mode:'transform'}),context);
 const date=new Date(Date.now()+2*86400000);date.setUTCHours(12,0,0,0);
 const body={mode:'customer',action:'create',slug:'test-consultation',calendar_id:calendar,tenant_id:tenant,client_id:client,request_id:id(7),start:date.toISOString(),
  guest:{name:'Forged Guest',email:'unrelated@example.test',phone:'+15550009999'},actor_id:id(99),role:'owner',p_plan:{host_ids:[id(99)]}};
 return {actor,tenant,client,host,secondHost,calendar,body,cal,rows,records,traces,commits,effects,
  setActor:v=>{activeActor=v;},setProfile:v=>{visibleProfile=v;},setAllowed:v=>{currentAllowed=v;},loseResponse:()=>{lost=true;},
  run:async(value=body,{authorization='Bearer synthetic-customer'}={})=>{
   const req=new Request('https://example.invalid/functions/v1/public-booking',{method:'POST',headers:authorization?{authorization}:{},body:JSON.stringify(value)});
   const response=await handler(req);return {status:response.status,data:await response.json()};
  }};
}

for(const type of ['personal','round_robin','collective','event'])test('actual handler uses original scheduling and one atomic private constructor: '+type,async()=>{
 const f=fixture({type}),r=await f.run();assert.equal(r.status,200);assert.equal(r.data.state,'saved');assert.equal(f.commits.length,1);
 const a=f.commits[0];assert.equal(a.p_verified_actor_id,f.actor);assert.equal(a.p_tenant_id,f.tenant);assert.equal(a.p_expected_client_id,f.client);
 assert.equal(a.p_plan.guest_email,'client@example.test');assert.equal(a.p_plan.guest_phone,null);assert.equal(a.p_plan.guest_name,'Avery River');
 assert.deepEqual(a.p_plan.host_ids,type==='collective'?[f.host,f.secondHost]:[f.host]);
 assert.equal(a.p_plan.booking_kind,type==='event'?'class_seat':type==='collective'?'collective':'single');
 assert.equal(f.traces.filter(x=>x.kind==='email-identity-lookup').length,0);
 assert.equal(f.traces.filter(x=>x.kind==='table'&&x.table==='internal_bookings'&&x.operation==='insert').length,0);
 assert.equal(f.traces.filter(x=>x.kind==='service'&&x.name==='create_class_booking').length,0);
 assert(f.traces.findIndex(x=>x.kind==='auth')<f.traces.findIndex(x=>x.kind==='sdk'&&x.key==='synthetic-service'));
 for(const hidden of ['calendar_source','hosts_source','guest_email','host_ids',f.actor])assert(!JSON.stringify(r.data).includes(hidden));
});
for(const type of ['personal','round_robin','collective','event'])test('the original public booking writer and receipt stay available: '+type,async()=>{
 const f=fixture({type}),body={...f.body};delete body.mode;
 const r=await f.run(body,{authorization:''});assert.equal(r.status,200);assert.equal(r.data.ok,true);assert.equal(typeof r.data.booking.id,'string');
 assert.deepEqual(Object.keys(r.data).sort(),['booking','ok']);assert.equal(f.commits.length,0);
 assert.equal(f.traces.filter(x=>x.kind==='email-identity-lookup').length,1);
 assert.equal(f.traces.filter(x=>x.kind==='auth').length,0);
 assert.equal(f.traces.filter(x=>x.kind==='service'&&x.name==='create_class_booking').length,type==='event'?1:0);
});
test('same exact request recovers before a closed calendar, with no second native write or notification',async()=>{
 const f=fixture(),first=await f.run();assert.equal(first.status,200);f.cal.enabled=false;
 const original=f.rows[0],effects=f.effects.length,second=await f.run();assert.equal(second.status,200);assert.equal(second.data.replayed,true);
 assert.equal(second.data.booking.id,original.id);assert.equal(f.commits.length,1);assert.equal(f.effects.length,effects);
});
test('lost native response returns unverified and later read-only recovery finds the same real work',async()=>{
 const f=fixture();f.loseResponse();const lost=await f.run();assert.equal(lost.status,202);assert.equal(lost.data.state,'unverified');
 assert.equal(f.commits.length,1);assert.equal(f.effects.length,0);
 const recovered=await f.run({mode:'customer',action:'reconcile',tenant_id:f.tenant,client_id:f.client,request_id:f.body.request_id});
 assert.equal(recovered.status,200);assert.equal(recovered.data.booking.id,f.rows[0].id);assert.equal(f.commits.length,1);assert.equal(f.effects.length,0);
});
test('another intent cannot relabel an old request as a newly booked appointment',async()=>{
 const f=fixture();await f.run();const r=await f.run({...f.body,notes:'Different appointment request'});
 assert.equal(r.status,409);assert.equal(r.data.code,'REQUEST_ID_CONFLICT');assert.equal(f.commits.length,1);
});
for(const mode of ['no bearer','expired','owner identity','wrong client','wrong business'])test('actual handler refuses before privileged reads/writes: '+mode,async()=>{
 const f=fixture();let body=f.body,opts={};if(mode==='no bearer')opts={authorization:''};if(mode==='expired')f.setActor(null);
 if(mode==='owner identity')f.setActor(f.host);if(mode==='wrong client')body={...body,client_id:id(88)};if(mode==='wrong business')body={...body,tenant_id:id(88)};
 const r=await f.run(body,opts);assert([401,403].includes(r.status));assert.equal(f.commits.length,0);assert.equal(f.effects.length,0);
 assert.equal(f.traces.filter(x=>x.kind==='sdk'&&x.key==='synthetic-service').length,0);
});
test('private lookup cannot fall back to another business calendar or a legacy staff page',async()=>{
 const f=fixture(),r=await f.run({...f.body,calendar_id:id(88)});assert.equal(r.status,404);assert.equal(f.commits.length,0);
 assert.equal(f.traces.filter(x=>x.table==='staff_calendar_settings').length,0);
});
test('original asynchronous Communications gate holds customer booking before any native create',async()=>{
 const f=fixture({allowed:false}),r=await f.run();assert.equal(r.status,403);assert.equal(r.data.code,'COMMS_PROVIDER_EXECUTION_DISABLED');
 assert.equal(f.commits.length,0);assert.equal(f.effects.length,0);
});
test('original real office-hours validation refuses a private off-hours slot',async()=>{
 const f=fixture(),date=new Date(f.body.start);date.setUTCHours(3);const r=await f.run({...f.body,start:date.toISOString()});
 assert.equal(r.status,409);assert.equal(f.commits.length,0);assert.equal(f.effects.length,0);
});
test('private availability returns the original service/intake choices without host configuration or provider data',async()=>{
 const f=fixture();f.cal.intake_questions=[{id:'goal',label:'What would you like to work on?',type:'text',required:true}];
 const r=await f.run({...f.body,action:'availability',from:f.body.start,to:new Date(Date.parse(f.body.start)+86400000).toISOString()});
 assert.equal(r.status,200);assert(r.data.slots.length>0);assert.equal(r.data.calendar.intakeQuestions[0].id,'goal');
 for(const hidden of ['calendar_source','hosts_source','notify_config','assignment_strategy',f.host,f.actor])assert(!JSON.stringify(r.data).includes(hidden));
});
