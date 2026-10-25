import assert from 'node:assert/strict';
import type {OwnerPreparationCaller} from './owner-preparation.ts';
const modulePath='./prepared-signature'+'-outcome.ts';
const candidate=await import(modulePath).catch(error=>{if(String(error).includes('prepared-signature-outcome.ts')&&/Module not found|Cannot find module/.test(String(error)))return {};throw error;});
const actor='11111111-0000-4000-8000-000000000001',tenant='aaaaaaaa-0000-4000-8000-000000000001',agreement='11111111-0000-4000-8000-000000000002';
const operation='11111111-0000-4000-8000-000000000003',work='11111111-0000-4000-8000-000000000004';
const input=()=>({tenant_id:tenant,agreement_id:agreement,operation_id:operation,expected_request_sha256:'a'.repeat(64)});
const outcome=()=>({kind:'prepared_signature_request_result',state:'prepared',tenant_id:tenant,actor_id:actor,operation_id:operation,request_sha256:'a'.repeat(64),agreement_id:agreement,work_id:work,receipt_id:null});
type Service={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
type Reader=(value:unknown,caller:OwnerPreparationCaller,service:Service,expectedActor:string)=>Promise<unknown>;
const reader=()=>{const fn=Object.getOwnPropertyDescriptor(candidate,'readPreparedSignatureOutcome')?.value;assert.equal(typeof fn,'function','Missing original prepared-request status reader');return fn as Reader;};
const harness=()=>{const calls:Array<{name:string;args?:Record<string,unknown>}>=[];let row:unknown=outcome(),error:unknown=null,owner=true,active=tenant,user=actor,anonymous=false;
 const caller:OwnerPreparationCaller={auth:{async getUser(){return {data:{user:{id:user,is_anonymous:anonymous}}};}},async rpc(name,args){calls.push({name,args});return {data:name==='current_user_tenant_id'?active:name==='is_tenant_admin'?owner:null,error:null};}};
 let hook=async()=>{};const service:Service={async rpc(name,args){calls.push({name,args});await hook();return {data:row,error};}};
 return {calls,caller,service,setRow(v:unknown,e:unknown=null){row=v;error=e;},setOwner(v:boolean){owner=v;},setTenant(v:string){active=v;},setUser(v:string){user=v;},setAnonymous(v:boolean){anonymous=v;},onRead(fn:()=>Promise<void>){hook=fn;}};};
const rejects=(fn:()=>Promise<unknown>)=>assert.rejects(fn,/^Error: PREPARED_SIGNATURE_STATUS_(INVALID|ACCESS_UNVERIFIED|UNAVAILABLE)$/);
Deno.test('original outcome read retains native identity and never issues, claims, retries or executes',async()=>{
 const h=harness();assert.deepEqual(await reader()(input(),h.caller,h.service,actor),outcome());
 assert.deepEqual(h.calls.filter(c=>c.name.startsWith('_')),[{name:'_read_prepared_agreement_request_status',args:{_actor:actor,_tenant:tenant,_operation:operation,_request_sha256:'a'.repeat(64)}}]);
});
Deno.test('original outcome preserves missing and uncertain history without reporting failed Work as not sent',async()=>{
 const h=harness(),read=reader();h.setRow(null);assert.equal(await read(input(),h.caller,h.service,actor),null);
 h.setRow({...outcome(),state:'outcome_unknown'});assert.deepEqual(await read(input(),h.caller,h.service,actor),{...outcome(),state:'outcome_unknown'});
 h.setRow(null,new Error('Synthetic private server detail'));await rejects(()=>read(input(),h.caller,h.service,actor));
});
Deno.test('original outcome retains provider acceptance only with its original native publication receipt',async()=>{
 const h=harness(),read=reader(),receipt='11111111-0000-4000-8000-000000000005';
 for(const state of ['provider_accepted','provider_partial']){
  const expected={...outcome(),state,receipt_id:receipt};h.setRow(expected);
  assert.deepEqual(await read(input(),h.caller,h.service,actor),expected);
 }
 assert.equal(h.calls.filter(c=>c.name.startsWith('_')).length,2);
});
Deno.test('original publication states cannot erase or invent a receipt',async()=>{
 const h=harness(),read=reader(),receipt='11111111-0000-4000-8000-000000000005';
 for(const patch of [{state:'provider_partial',receipt_id:null},{state:'provider_accepted',receipt_id:'bad'},
  {state:'prepared',receipt_id:receipt},{state:'outcome_unknown',receipt_id:receipt},
  {state:'delivered',receipt_id:receipt},{state:'signed',receipt_id:receipt},{state:'paid',receipt_id:receipt}]){
  h.setRow({...outcome(),...patch});await rejects(()=>read(input(),h.caller,h.service,actor));
 }
});
Deno.test('original outcome refuses provider/signature/payment claims and foreign or extra projections',async()=>{
 const h=harness(),read=reader();for(const patch of [{state:'provider_accepted'},{state:'not_sent'},{state:'paid'},{receipt_id:work},{actor_id:work},{tenant_id:work},{agreement_id:work},{operation_id:work},{request_sha256:'0'.repeat(64)},{work_id:'bad'},{raw_token:'private'},{state:new String('prepared')}]){h.setRow({...outcome(),...patch});await rejects(()=>read(input(),h.caller,h.service,actor));}
});
Deno.test('original outcome validates closed detached input before any private read',async()=>{
 const h=harness(),read=reader();for(const value of [{...input(),actor_id:actor},{...input(),tenant_id:tenant.toUpperCase()},{...input(),expected_request_sha256:'bad'},{...input(),operation_id:null},null])await rejects(()=>read(value,h.caller,h.service,actor));
 assert.equal(h.calls.length,0);const value=input();h.onRead(async()=>{value.agreement_id=work;value.tenant_id=work;});assert.deepEqual(await read(value,h.caller,h.service,actor),outcome());
});
Deno.test('original outcome checks actual owner business and principal before reading',async()=>{
 const read=reader();for(const mutate of [(h:ReturnType<typeof harness>)=>h.setOwner(false),(h:ReturnType<typeof harness>)=>h.setTenant(work),(h:ReturnType<typeof harness>)=>h.setUser(work),(h:ReturnType<typeof harness>)=>h.setAnonymous(true)]){const h=harness();mutate(h);await rejects(()=>read(input(),h.caller,h.service,actor));assert.equal(h.calls.some(c=>c.name.startsWith('_')),false);}
});
Deno.test('original outcome retires private readback after actor role business or principal changes during await',async()=>{
 const read=reader();for(const mutate of [(h:ReturnType<typeof harness>)=>h.setOwner(false),(h:ReturnType<typeof harness>)=>h.setTenant(work),(h:ReturnType<typeof harness>)=>h.setUser(work),(h:ReturnType<typeof harness>)=>h.setAnonymous(true)]){const h=harness();h.onRead(async()=>mutate(h));await rejects(()=>read(input(),h.caller,h.service,actor));assert.equal(h.calls.filter(c=>c.name.startsWith('_')).length,1);}
});
Deno.test('original outcome bounds transport errors and cannot turn a missing acknowledgement into another act',async()=>{
 const h=harness(),read=reader();h.onRead(async()=>{throw Error('Synthetic credential provider raw detail');});await rejects(()=>read(input(),h.caller,h.service,actor));assert.equal(h.calls.filter(c=>c.name.startsWith('_')).length,1);
});

Deno.test('original agreement-send request-status is a private bounded ordinary read before legacy effects',async t=>{
 const previous={serve:Deno.serve,env:Deno.env.get,fetch:globalThis.fetch};let handler!:(req:Request)=>Promise<Response>;
 let row:unknown=outcome(),nativeError=false,owner=true,active=tenant,anonymous=false,retire=false;
 const nativeCalls:Array<{name:string;args:Record<string,unknown>}>=[],unexpected:string[]=[];
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
 try{
  Deno.serve=((fn:typeof handler)=>{handler=fn;return {} as never;}) as unknown as typeof Deno.serve;
  Deno.env.get=name=>({SUPABASE_URL:'https://prepared-status.invalid',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'} as Record<string,string>)[name];
  globalThis.fetch=async(url,options)=>{const req=new Request(url,options),u=new URL(req.url);assert.equal(u.origin,'https://prepared-status.invalid','No external requests');
   if(u.pathname==='/auth/v1/user'){assert.equal(req.headers.get('authorization'),'Bearer synthetic-owner');return json({id:actor,is_anonymous:anonymous});}
   if(u.pathname.startsWith('/rest/v1/rpc/')){const name=u.pathname.slice('/rest/v1/rpc/'.length),args=await req.json();
    if(['current_user_tenant_id','is_tenant_admin'].includes(name)){assert.equal(req.headers.get('apikey'),'synthetic-anon');return json(name==='current_user_tenant_id'?active:owner);}
    if(name==='check_public_rate_limit'){assert.equal(req.headers.get('apikey'),'synthetic-service');assert.equal(args._bucket,'agreement-review:'+tenant+':'+actor);return json(true);}
    if(name==='_read_prepared_agreement_request_status'){assert.equal(req.headers.get('apikey'),'synthetic-service');nativeCalls.push({name,args});if(retire)active=work;return nativeError?json({code:'42501',message:'Synthetic private cause'},403):json(row);}
   }
   if(u.pathname==='/rest/v1/tenants'&&req.method==='GET'){assert.equal(u.searchParams.get('id'),'eq.'+tenant);return json({name:'Test business',account_type:'solo',parent_tenant_id:null});}
   unexpected.push(req.method+' '+u.pathname);throw Error('Unexpected effect/query');
  };
  await import('../../agreement-send/index.ts?prepared-status-proof');
  const invoke=(v:unknown=input(),query='?review=request-status',headers:Record<string,string>={})=>handler(new Request('https://prepared-status.invalid/agreement-send'+query,{method:'POST',headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json',...headers},body:JSON.stringify(v)}));
  await t.step('original native status identity returns with private no-store headers',async()=>{const r=await invoke();assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,result:outcome()});assert.equal(r.headers.get('Cache-Control'),'no-store, private');assert.equal(r.headers.get('Vary'),'Authorization');assert.deepEqual(nativeCalls.at(-1)?.args,{_actor:actor,_tenant:tenant,_operation:operation,_request_sha256:'a'.repeat(64)});});
  await t.step('missing original Work is null, never success or resend permission',async()=>{row=null;const r=await invoke();assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,result:null});row=outcome();});
  await t.step('unreadable native outcome remains unavailable with no private error',async()=>{nativeError=true;const r=await invoke();assert.equal(r.status,503);assert.equal((await r.text()).includes('private cause'),false);nativeError=false;});
  await t.step('foreign scope or request-authored approval cannot reach private read',async()=>{const n=nativeCalls.length;assert.equal((await invoke({...input(),tenant_id:work})).status,403);assert.equal((await invoke({...input(),approved:true})).status,400);assert.equal(nativeCalls.length,n);});
  await t.step('late business retirement withholds original private result',async()=>{retire=true;const r=await invoke();assert.equal(r.status,403);retire=false;active=tenant;});
  await t.step('anonymous and member callers cannot read original status',async()=>{const n=nativeCalls.length;anonymous=true;assert.equal((await invoke()).status,403);anonymous=false;owner=false;assert.equal((await invoke()).status,403);owner=true;assert.equal(nativeCalls.length,n);});
  await t.step('duplicate or foreign query cannot fall through into sending',async()=>{assert.equal((await invoke(input(),'?review=request-status&review=request-status')).status,400);assert.equal((await invoke(input(),'?review=request-status&resend=true')).status,400);});
  await t.step('bounded JSON and authentication stay on the original door',async()=>{assert.equal((await invoke(input(),'?review=request-status',{'Content-Type':'text/plain'})).status,400);assert.equal((await invoke(input(),'?review=request-status',{Authorization:''})).status,401);});
  assert.deepEqual(unexpected,[]);
 }finally{Deno.serve=previous.serve;Deno.env.get=previous.env;globalThis.fetch=previous.fetch;}
});
