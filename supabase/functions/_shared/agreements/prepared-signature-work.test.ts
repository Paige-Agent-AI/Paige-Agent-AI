import assert from 'node:assert/strict';

const modulePath='./prepared-signature'+'-work.ts';
const candidate=await import(modulePath).catch(error=>{if(String(error).includes('prepared-signature-work.ts')&&/Module not found|Cannot find module/.test(String(error)))return {};throw error;});
type Scope={actorId:string;tenantId:string;operationId:string;requestSha256:string;agreementId:string;preparationId:string};
type Service={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
type Store={read():Promise<unknown>;register(v:unknown):Promise<unknown>};
const ids={actorId:'11111111-0000-4000-8000-000000000001',tenantId:'aaaaaaaa-0000-4000-8000-000000000001',operationId:'11111111-0000-4000-8000-000000000002',requestSha256:'a'.repeat(64),agreementId:'11111111-0000-4000-8000-000000000003',preparationId:'11111111-0000-4000-8000-000000000004'};
const approved={confirmationId:'11111111-0000-4000-8000-000000000005',requestNonce:'11111111-0000-4000-8000-000000000006',fingerprint:'b'.repeat(16),auditId:'11111111-0000-4000-8000-000000000007'};
const row=()=>({kind:'prepared_signature_work',execution:'unavailable',work_id:'11111111-0000-4000-8000-000000000008',work_status:'claimed',operation_id:ids.operationId,request_sha256:ids.requestSha256,agreement_id:ids.agreementId,preparation_id:ids.preparationId});
const factory=()=>{const value=Object.getOwnPropertyDescriptor(candidate,'preparedSignatureWorkStore')?.value;assert.equal(typeof value,'function','Missing concrete original Work bridge');return value as (service:Service,scope:Scope)=>Store;};
const harness=()=>{const calls:Array<{name:string;args:Record<string,unknown>}>=[];let data:unknown=row(),error:unknown=null;const service:Service={async rpc(name,args){calls.push({name,args});return {data,error};}};return {calls,service,set(v:unknown,e:unknown=null){data=v;error=e;}};};
Deno.test('prepared Work reads the exact original actor/tenant/intent/digest and never creates work',async()=>{
 const h=harness(),store=factory()(h.service,{...ids});assert.deepEqual(await store.read(),row());assert.deepEqual(h.calls,[{name:'_read_prepared_agreement_work',args:{_actor:ids.actorId,_tenant:ids.tenantId,_operation:ids.operationId,_request_sha256:ids.requestSha256}}]);
});
Deno.test('prepared Work registration binds original approval/decision references and returns no execution success',async()=>{
 const h=harness(),store=factory()(h.service,{...ids});assert.deepEqual(await store.register(approved),row());assert.deepEqual(h.calls,[{name:'_register_prepared_agreement_work',args:{_actor:ids.actorId,_tenant:ids.tenantId,_confirmation:approved.confirmationId,_request_nonce:approved.requestNonce,_fingerprint:approved.fingerprint,_audit:approved.auditId}}]);
});
Deno.test('prepared Work detaches factory scope before an await and does not trust alias mutation',async()=>{
 const h=harness(),scope={...ids},store=factory()(h.service,scope);scope.actorId=approved.auditId;scope.tenantId=approved.auditId;scope.requestSha256='0'.repeat(64);await store.read();assert.equal(h.calls[0].args._actor,ids.actorId);assert.equal(h.calls[0].args._tenant,ids.tenantId);assert.equal(h.calls[0].args._request_sha256,ids.requestSha256);
});
Deno.test('prepared Work refuses foreign/extra/provider-success projections rather than leaking them',async()=>{
 const h=harness(),store=factory()(h.service,{...ids});for(const patch of [{operation_id:approved.auditId},{agreement_id:approved.auditId},{preparation_id:approved.auditId},{request_sha256:'0'.repeat(64)},{work_status:'provider_accepted'},{work_status:new String('claimed')},{execution:'completed'},{raw_token:'private'},{work_id:'bad'}]){h.set({...row(),...patch});await assert.rejects(()=>store.read(),/^Error: PREPARED_SIGNATURE_WORK_UNAVAILABLE$/);}
});
Deno.test('prepared Work keeps missing/read failures and lost registration acknowledgements distinct without a retry',async()=>{
 const h=harness(),store=factory()(h.service,{...ids});h.set(null);assert.equal(await store.read(),null);await assert.rejects(()=>store.register(approved),/^Error: PREPARED_SIGNATURE_WORK_UNAVAILABLE$/);assert.equal(h.calls.length,2);
 h.set(row(),new Error('Synthetic private provider detail'));await assert.rejects(()=>store.register(approved),/^Error: PREPARED_SIGNATURE_WORK_UNAVAILABLE$/);assert.equal(h.calls.length,3);h.set(row());assert.deepEqual(await store.read(),row());assert.equal(h.calls.length,4);assert.equal(h.calls.filter(x=>x.name==='_register_prepared_agreement_work').length,2);
});
Deno.test('prepared Work accepts canonical work states without calling them payment or signing completion',async()=>{
 const h=harness(),store=factory()(h.service,{...ids});for(const status of ['claimed','succeeded','failed','blocked','cancelled','expired','outcome_unknown']){h.set({...row(),work_status:status});assert.deepEqual(await store.read(),{...row(),work_status:status});}
});
Deno.test('prepared Work rejects malformed scope and extra registration authority before any native call',async()=>{
 const h=harness(),make=factory();for(const patch of [{actorId:'bad'},{tenantId:'AAAAAAAA-0000-4000-8000-000000000001'},{requestSha256:'a'.repeat(63)}])assert.throws(()=>make(h.service,{...ids,...patch}),/^Error: PREPARED_SIGNATURE_WORK_UNAVAILABLE$/);
 const store=make(h.service,{...ids});for(const patch of [{actorId:approved.auditId},{fingerprint:'a'},{confirmationId:'bad'},{requestNonce:null},{auditId:'bad'}])await assert.rejects(()=>store.register({...approved,...patch}),/^Error: PREPARED_SIGNATURE_WORK_UNAVAILABLE$/);assert.equal(h.calls.length,0);
});
