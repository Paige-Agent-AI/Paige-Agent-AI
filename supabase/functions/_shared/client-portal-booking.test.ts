import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolvePortalBookingActor,resolvePortalBookingCustomer,readPortalBookingReceipt,commitPortalBooking,reconcilePortalBooking,portalBookingRequest} from './client-portal-booking.ts';

const id=(n:number)=>`e09b2000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const intent=()=>({tenantId:id(1),clientId:id(2),requestId:id(3)});
const profile=()=>({id:id(2),tenant_id:id(1),linked_user_id:id(4),first_name:'Avery',last_name:'River',phone:null});
const receipt=()=>({schema_version:1,actor_id:id(4),tenant_id:id(1),client_id:id(2),request_id:id(3),
 state:'saved',booking:{id:id(5),title:'Consultation',start_at:'2026-11-01T10:00:00Z',end_at:'2026-11-01T10:30:00Z',timezone:'UTC',status:'scheduled'}});
function fixture(){
 let user:string|null=id(4),authError:unknown=null,scope:unknown=profile(),rpcError:unknown=null,result:unknown=receipt();
 let onCall:((name:string)=>void)|null=null,throwRead=false,receiptError:unknown=null;
 const calls:{kind:string;name?:string;args?:Record<string,unknown>}[]=[];
 const caller={auth:{getUser:async()=>{calls.push({kind:'auth'});return {data:{user:user?{id:user}:null},error:authError};}},
  rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({kind:'rpc',name,args});onCall?.(name);if(throwRead)throw Error('unavailable');return {data:name==='client_portal_self_profile'?scope:result,error:name==='client_portal_booking_request'?receiptError:rpcError};}};
 return {caller,calls,setUser:(v:string|null)=>{user=v;},setAuthError:(v:unknown)=>{authError=v;},
  setProfile:(v:unknown)=>{scope=v;},setError:(v:unknown)=>{rpcError=v;},setReceiptError:(v:unknown)=>{receiptError=v;},setResult:(v:unknown)=>{result=v;},
  during:(v:(name:string)=>void)=>{onCall=v;},throwRead:()=>{throwRead=true;}};
}

test('booking actor comes from verified Auth and the existing selected-business self projection',async()=>{
 const f=fixture(),r=await resolvePortalBookingActor(f.caller,intent());
 assert.deepEqual(r,{actorId:id(4),tenantId:id(1),clientId:id(2)});
 assert.deepEqual(f.calls.map(x=>x.kind),['auth','rpc','auth']);
 assert.equal(f.calls[1].name,'client_portal_self_profile');assert.deepEqual(f.calls[1].args,{p_tenant_id:id(1)});
});
test('booking recipient is the current verified customer original primary contact, never a typed guest',async()=>{
 const f=fixture();f.setProfile({...profile(),email:'  CUSTOMER@example.test  ',phone:' +15550000123 ',private_note:'withheld'});
 const r=await resolvePortalBookingCustomer(f.caller,{...intent(),guest:{email:'unrelated@example.test'}});
 assert.deepEqual(r,{binding:{actorId:id(4),tenantId:id(1),clientId:id(2)},guest:{name:'Avery River',email:'customer@example.test',phone:'+15550000123'}});
 assert.deepEqual(f.calls.map(x=>x.kind),['auth','rpc','auth']);
});
test('a missing primary booking recipient does not invent an address or block ordinary authorized reads',async()=>{
 const f=fixture(),r=await resolvePortalBookingCustomer(f.caller,intent());
 assert.equal(r?.guest,null);assert.equal(r?.binding.actorId,id(4));
});
for(const [name,mutate] of [
 ['no current session',(f:ReturnType<typeof fixture>)=>f.setUser(null)],
 ['Auth error',(f:ReturnType<typeof fixture>)=>f.setAuthError({message:'refused'})],
 ['projection error',(f:ReturnType<typeof fixture>)=>f.setError({code:'42501'})],
 ['missing relationship',(f:ReturnType<typeof fixture>)=>f.setProfile(null)],
 ['other customer',(f:ReturnType<typeof fixture>)=>f.setProfile({...profile(),id:id(90)})],
 ['other business',(f:ReturnType<typeof fixture>)=>f.setProfile({...profile(),tenant_id:id(90)})],
 ['owner or another actor',(f:ReturnType<typeof fixture>)=>f.setProfile({...profile(),linked_user_id:id(90)})],
 ['session changes during read',(f:ReturnType<typeof fixture>)=>f.during(()=>f.setUser(id(90)))],
 ['session expires during read',(f:ReturnType<typeof fixture>)=>f.during(()=>f.setUser(null))],
 ['projection connection fails',(f:ReturnType<typeof fixture>)=>f.throwRead()],
] as const)test('booking admission refuses '+name,async()=>{
 const f=fixture();mutate(f);assert.equal(await resolvePortalBookingActor(f.caller,intent()),null);
 assert(f.calls.every(x=>x.kind==='auth'||x.name==='client_portal_self_profile'));
});
for(const [name,value] of [['missing business',{clientId:id(2)}],['missing client',{tenantId:id(1)}],
 ['route instead of UUID',{tenantId:'1234567',clientId:id(2)}],['email instead of customer',{tenantId:id(1),clientId:'client@example.test'}]] as const)
test('invalid booking intent refuses before any Auth/domain IO: '+name,async()=>{
 const f=fixture();assert.equal(await resolvePortalBookingActor(f.caller,value),null);assert.deepEqual(f.calls,[]);
});
test('model/body role and actor labels never replace the actual Auth subject',async()=>{
 const f=fixture();const r=await resolvePortalBookingActor(f.caller,{...intent(),actorId:id(90),role:'owner',email:'owner@example.test'});
 assert.equal(r?.actorId,id(4));
});
test('captured business intent is refused if its supplied object changes while resolving',async()=>{
 const f=fixture(),i=intent();f.during(()=>{i.tenantId=id(90);});assert.equal(await resolvePortalBookingActor(f.caller,i),null);
});
test('receipt recovery reads the same original work and returns only a bounded saved booking',async()=>{
 const f=fixture(),r=await readPortalBookingReceipt(f.caller,intent());
 assert.deepEqual(r,{state:'saved',booking:receipt().booking});
 assert.equal(f.calls.filter(x=>x.name==='client_portal_booking_request').length,1);
 assert.deepEqual(f.calls.find(x=>x.name==='client_portal_booking_request')?.args,
  {p_tenant_id:id(1),p_expected_client_id:id(2),p_request_id:id(3)});
 assert(f.calls.every(x=>!x.name||['client_portal_self_profile','client_portal_booking_request'].includes(x.name)));
});
for(const [name,mutate] of [
 ['no matching saved record',(r:ReturnType<typeof receipt>)=>({...r,state:'not_found',booking:null})],
 ['missing native contract',()=>null],['another actor',(r:ReturnType<typeof receipt>)=>({...r,actor_id:id(90)})],
 ['another business',(r:ReturnType<typeof receipt>)=>({...r,tenant_id:id(90)})],
 ['another customer',(r:ReturnType<typeof receipt>)=>({...r,client_id:id(90)})],
 ['another request',(r:ReturnType<typeof receipt>)=>({...r,request_id:id(90)})],
 ['unrecognized version',(r:ReturnType<typeof receipt>)=>({...r,schema_version:2})],
 ['unexpected native fields',(r:ReturnType<typeof receipt>)=>({...r,private_notes:'withheld'})],
 ['unexpected booking fields',(r:ReturnType<typeof receipt>)=>({...r,booking:{...r.booking,host_user_id:id(90)}})],
 ['invalid work identity',(r:ReturnType<typeof receipt>)=>({...r,booking:{...r.booking,id:'not-a-booking'}})],
 ['reversed time',(r:ReturnType<typeof receipt>)=>({...r,booking:{...r.booking,end_at:r.booking.start_at}})],
 ['invalid timestamp',(r:ReturnType<typeof receipt>)=>({...r,booking:{...r.booking,start_at:'tomorrow'}})],
 ['unrecognized status',(r:ReturnType<typeof receipt>)=>({...r,booking:{...r.booking,status:'delivered'}})],
] as const)test('receipt recovery withholds '+name+' and never retries a create',async()=>{
 const f=fixture();f.setResult(mutate(receipt()));assert.deepEqual(await readPortalBookingReceipt(f.caller,intent()),{state:'unverified'});
 assert(f.calls.every(x=>!x.name||['client_portal_self_profile','client_portal_booking_request'].includes(x.name)));
});
test('receipt recovery rejects an interrupted read without dispatching any effect',async()=>{
 const f=fixture();f.during(name=>{if(name==='client_portal_booking_request')f.setReceiptError({message:'connection interrupted'});});
 assert.deepEqual(await readPortalBookingReceipt(f.caller,intent()),{state:'unverified'});
});
test('receipt is withheld when the actor changes after the original read',async()=>{
 const f=fixture();f.during(name=>{if(name==='client_portal_booking_request')f.setUser(id(90));});
 assert.deepEqual(await readPortalBookingReceipt(f.caller,intent()),{state:'access_unavailable'});
});
test('receipt is withheld when access/relationship changes after the read',async()=>{
 const f=fixture();f.during(name=>{if(name==='client_portal_booking_request')f.setProfile(null);});
 assert.deepEqual(await readPortalBookingReceipt(f.caller,intent()),{state:'access_unavailable'});
});
test('late mutation of native response cannot alter a receipt captured before rechecking Auth',async()=>{
 const f=fixture(),native=receipt();f.setResult(native);let reads=0;
 f.during(name=>{if(name==='client_portal_self_profile'&&++reads===2)native.booking.title='late private mutation';});
 const recovered=await readPortalBookingReceipt(f.caller,intent());assert.equal(recovered.state,'saved');
 if(recovered.state==='saved')assert.equal(recovered.booking.title,'Consultation');
});
test('a request changed while recovering cannot publish the preceding request receipt',async()=>{
 const f=fixture(),i=intent();f.during(name=>{if(name==='client_portal_booking_request')i.requestId=id(90);});
 assert.deepEqual(await readPortalBookingReceipt(f.caller,i),{state:'access_unavailable'});
});
test('a request cleared while recovering cannot publish the preceding request receipt',async()=>{
 const f=fixture(),i=intent();f.during(name=>{if(name==='client_portal_booking_request')i.requestId=null as unknown as string;});
 assert.deepEqual(await readPortalBookingReceipt(f.caller,i),{state:'access_unavailable'});
});

function commitFixture(){
 const f=fixture(),i=intent(),request={calendar_id:id(10),start:'2026-11-01T10:00:00Z',notes:null,answers:{}};
 const plan={calendar_id:id(10),host_ids:[id(6)],booking_kind:'single',calendar_source:{id:id(10)},hosts_source:[]};
 let current=true,allowed=true,error:unknown=null,throwCall=false;
 let native:unknown={...receipt(),replayed:false,execution:{booking_kind:'single',host_ids:[id(6)],collective_group_id:null}};
 let during=()=>{};const writes:{name:string;args:Record<string,unknown>}[]=[];
 const deps={caller:f.caller,current:()=>current,executionAllowed:()=>allowed,service:{rpc:async(name:string,args:Record<string,unknown>)=>{
  writes.push({name,args});during();if(throwCall)throw Error('response lost');return {data:native,error};}}};
 return {f,i,request,plan,deps,writes,run:()=>commitPortalBooking(deps,i,request,plan),
  setCurrent:(x:boolean)=>{current=x;},setAllowed:(x:boolean)=>{allowed=x;},setError:(x:unknown)=>{error=x;},
  setNative:(x:unknown)=>{native=x;},throwCall:()=>{throwCall=true;},during:(x:()=>void)=>{during=x;}};
}
test('the thin booking adapter dispatches one native commit using the actual verified Auth subject',async()=>{
 const f=commitFixture(),r=await f.run();assert.equal(r.state,'saved');assert.equal(f.writes.length,1);
 assert.deepEqual(f.writes[0],{name:'client_portal_commit_booking',args:{p_verified_actor_id:id(4),p_tenant_id:id(1),
  p_expected_client_id:id(2),p_request_id:id(3),p_request_intent:f.request,p_plan:f.plan}});
 if(r.state==='saved'){assert.equal(r.replayed,false);assert.deepEqual(r.execution,{booking_kind:'single',host_ids:[id(6)],collective_group_id:null});}
});
test('booking never borrows a body actor or owner-role label for native authority',async()=>{
 const f=commitFixture();Object.assign(f.i,{actorId:id(90),role:'owner'});await f.run();assert.equal(f.writes[0]?.args.p_verified_actor_id,id(4));
});
for(const which of ['retired request','existing provider restriction','unverified Auth','changed relationship'] as const)
test('booking refuses before native dispatch: '+which,async()=>{
 const f=commitFixture();if(which==='retired request')f.setCurrent(false);
 if(which==='existing provider restriction')f.setAllowed(false);
 if(which==='unverified Auth')f.f.setUser(null);
 if(which==='changed relationship')f.f.setProfile({...profile(),id:id(90)});
 assert.equal((await f.run()).state,'refused');assert.deepEqual(f.writes,[]);
});
test('a request retired in the Auth continuation cannot dispatch a booking',async()=>{
 const f=commitFixture();f.f.during(()=>f.setCurrent(false));assert.equal((await f.run()).state,'refused');assert.deepEqual(f.writes,[]);
});
test('a provider gate closed in the Auth continuation cannot dispatch a booking',async()=>{
 const f=commitFixture();f.f.during(()=>f.setAllowed(false));assert.equal((await f.run()).state,'refused');assert.deepEqual(f.writes,[]);
});
test('the actual asynchronous provider predicate is awaited; its Promise is never treated as permission',async()=>{
 const f=commitFixture();const r=await commitPortalBooking({...f.deps,executionAllowed:async()=>false},f.i,f.request,f.plan);
 assert.equal(r.state,'refused');assert.deepEqual(f.writes,[]);
});
test('a request retired while awaiting the provider predicate cannot dispatch',async()=>{
 const f=commitFixture();const r=await commitPortalBooking({...f.deps,executionAllowed:async()=>{f.setCurrent(false);return true;}},f.i,f.request,f.plan);
 assert.equal(r.state,'refused');assert.deepEqual(f.writes,[]);
});
test('a late asynchronous provider restriction retains saved work and withholds follow-ups',async()=>{
 const f=commitFixture();let calls=0;
 const r=await commitPortalBooking({...f.deps,executionAllowed:async()=>++calls<3},f.i,f.request,f.plan);
 assert.equal(r.state,'saved');if(r.state==='saved')assert.equal(r.execution,null);
});
test('a native SQL refusal proves rollback and is not represented as saved work',async()=>{
 const f=commitFixture();f.setError({code:'23P01',message:'exclusion constraint'});assert.equal((await f.run()).state,'refused');assert.equal(f.writes.length,1);
});
for(const which of ['transport refusal','lost response'] as const)test('uncertain native outcome stays unverified: '+which,async()=>{
 const f=commitFixture();if(which==='transport refusal')f.setError({message:'gateway unavailable'});else f.throwCall();
 assert.deepEqual(await f.run(),{state:'unverified'});assert.equal(f.writes.length,1);
});
test('a replay is saved history and provides no instruction for another provider action',async()=>{
 const f=commitFixture();f.setNative({...receipt(),replayed:true,execution:null});
 const r=await f.run();assert.equal(r.state,'saved');if(r.state==='saved'){assert.equal(r.replayed,true);assert.equal(r.execution,null);}
 assert.equal(f.writes.length,1);
});
for(const [name,change]of [
 ['foreign actor',{actor_id:id(90)}],['foreign business',{tenant_id:id(90)}],['foreign customer',{client_id:id(90)}],
 ['foreign request',{request_id:id(90)}],['unexpected field',{private_notes:'withheld'}],
 ['wrong execution host',{execution:{booking_kind:'single',host_ids:[id(90)],collective_group_id:null}}],
 ['replay carrying another execution instruction',{replayed:true}],
] as const)test('native booking result withholds '+name,async()=>{
 const f=commitFixture();f.setNative({...receipt(),replayed:false,execution:{booking_kind:'single',host_ids:[id(6)],collective_group_id:null},...change});
 assert.deepEqual(await f.run(),{state:'unverified'});
});
test('an in-flight sign-in/relationship change withholds results without pretending the commit was undone',async()=>{
 const f=commitFixture();f.during(()=>f.f.setUser(id(90)));assert.deepEqual(await f.run(),{state:'unverified'});
});
test('an in-flight input change withholds the preceding booking result',async()=>{
 const f=commitFixture();f.during(()=>{f.request.notes='changed' as unknown as null;});assert.deepEqual(await f.run(),{state:'unverified'});
});
test('a gate closed after a genuine native save retains the appointment and holds provider follow-ups',async()=>{
 const f=commitFixture();f.during(()=>f.setAllowed(false));const r=await f.run();assert.equal(r.state,'saved');
 if(r.state==='saved'){assert.equal(r.replayed,false);assert.equal(r.execution,null);assert.equal(r.booking.id,id(5));}
});

test('exact-intent reconciliation is one read of original work, with no create or provider instruction',async()=>{
 const f=commitFixture();f.setNative({...receipt(),replayed:true,execution:null});
 const r=await reconcilePortalBooking(f.deps,f.i,f.request);assert.equal(r.state,'saved');
 assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0],{name:'client_portal_reconcile_booking',args:{p_verified_actor_id:id(4),
  p_tenant_id:id(1),p_expected_client_id:id(2),p_request_id:id(3),p_expected_intent:f.request}});
 if(r.state==='saved'){assert.equal(r.replayed,true);assert.equal(r.execution,null);}
});
for(const state of ['not_found','conflict','unverified'] as const)test('source-backed reconciliation state never dispatches a create: '+state,async()=>{
 const f=commitFixture();f.setNative({...receipt(),state,booking:null,replayed:true,execution:null});
 assert.deepEqual(await reconcilePortalBooking(f.deps,f.i,f.request),{state});
 assert.deepEqual(f.writes.map(x=>x.name),['client_portal_reconcile_booking']);
});
test('provider restrictions do not block read-only recovery of an already saved appointment',async()=>{
 const f=commitFixture();f.setAllowed(false);f.setNative({...receipt(),replayed:true,execution:null});
 assert.equal((await reconcilePortalBooking(f.deps,f.i,f.request)).state,'saved');
});
test('reconciliation with a wrong actor or an execution instruction is withheld',async()=>{
 for(const change of [{actor_id:id(90)},{execution:{booking_kind:'single',host_ids:[id(6)],collective_group_id:null}}]){
  const f=commitFixture();f.setNative({...receipt(),replayed:true,execution:null,...change});
  assert.deepEqual(await reconcilePortalBooking(f.deps,f.i,f.request),{state:'unverified'});
 }
});
test('reconciliation lost response never falls through to a new native create',async()=>{
 const f=commitFixture();f.throwCall();assert.deepEqual(await reconcilePortalBooking(f.deps,f.i,f.request),{state:'unverified'});
 assert.deepEqual(f.writes.map(x=>x.name),['client_portal_reconcile_booking']);
});
test('reconciliation revalidates current Auth/relationship before returning saved work',async()=>{
 const f=commitFixture();f.setNative({...receipt(),replayed:true,execution:null});f.during(()=>f.f.setProfile(null));
 assert.deepEqual(await reconcilePortalBooking(f.deps,f.i,f.request),{state:'unverified'});
});
const bookingBody=()=>({tenant_id:id(1),client_id:id(2),request_id:id(3),calendar_id:id(10),start:'2026-11-01T10:00:00-05:00',
 appointmentTypeId:'consultation',location:'phone',notes:'  A question  ',answers:{goal:'Plan the next month'},
 guest:{email:'unrelated@example.test',name:'Ignored body name'},actor_id:id(90),role:'owner',p_plan:{host_ids:[id(90)]}});
test('customer request normalization captures explicit booking input without body identity or a supplied execution plan',()=>{
 assert.deepEqual(portalBookingRequest(bookingBody()),{scope:intent(),request:{calendar_id:id(10),start:'2026-11-01T15:00:00.000Z',
  appointment_type_id:'consultation',location:'phone',notes:'A question',answers:{goal:'Plan the next month'}}});
});
for(const [name,change]of [['missing business',{tenant_id:null}],['missing client',{client_id:null}],
 ['invalid request',{request_id:'not-a-uuid'}],['invalid calendar',{calendar_id:'not-a-uuid'}],
 ['invalid time',{start:'not-a-time'}],['oversized answers',{answers:{goal:'x'.repeat(66000)}}]] as const)
test('customer request refuses invalid input before execution: '+name,()=>assert.equal(portalBookingRequest({...bookingBody(),...change}),null));
test('normalized request is a detached snapshot of user answers, not a mutable body alias',()=>{
 const body=bookingBody(),r=portalBookingRequest(body);body.answers.goal='Changed';assert.equal(r?.request.answers.goal,'Plan the next month');
});
