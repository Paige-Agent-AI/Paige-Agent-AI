import assert from 'node:assert/strict';
import {sha256Hex} from './token.ts';
const modulePath='./prepared-signature'+'-credentials.ts';
const candidate=await import(modulePath).catch(error=>{if(String(error).includes('prepared-signature-credentials.ts')&&/Module not found|Cannot find module/.test(String(error)))return {};throw error;});
const actor='11111111-0000-4000-8000-000000000001',tenant='aaaaaaaa-0000-4000-8000-000000000001';
const agreement='11111111-0000-4000-8000-000000000002',operation='11111111-0000-4000-8000-000000000003',preparation='11111111-0000-4000-8000-000000000004';
const signer='11111111-0000-4000-8000-000000000005',second='11111111-0000-4000-8000-000000000006',work='11111111-0000-4000-8000-000000000007',event='11111111-0000-4000-8000-000000000008';
const scope=()=>({actorId:actor,tenantId:tenant,operationId:operation,agreementId:agreement,preparationId:preparation,requestSha256:'a'.repeat(64),preparationSha256:'b'.repeat(64),documentSha256:'c'.repeat(64)});
const receipt=(hashes:Array<{signer_id:string;token_hash:string|null}>)=>({kind:'prepared_agreement_credentials',state:'recorded',tenant_id:tenant,actor_id:actor,operation_id:operation,agreement_id:agreement,preparation_id:preparation,request_sha256:'a'.repeat(64),preparation_sha256:'b'.repeat(64),document_sha256:'c'.repeat(64),work_id:work,event_id:event,credentials:hashes.map(h=>({...h,expires_at:'2099-01-01T00:00:00.123456+00:00'}))});
type Service={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
type Scope=ReturnType<typeof scope>;
type Issued={receipt:ReturnType<typeof receipt>;recovered:boolean;takeCredential(id:string):string|null;dispose():void};
type Store={read():Promise<ReturnType<typeof receipt>|null>;issue():Promise<Issued>};
const factory=()=>{const fn=Object.getOwnPropertyDescriptor(candidate,'preparedSignatureCredentialStore')?.value;assert.equal(typeof fn,'function','Missing canonical prepared credential bridge');return fn as (service:Service,scope:Scope,signers:readonly string[])=>Store;};
const harness=()=>{const calls:Array<{name:string;args:Record<string,unknown>}>=[];let stored:unknown=null,lost=false,drop=false;let mutate=(v:unknown)=>v;let onRead=async()=>{};
 const service:Service={async rpc(name,args){calls.push({name,args:structuredClone(args)});
  if(name==='_read_prepared_agreement_credentials'){await onRead();return {data:structuredClone(stored),error:null};}
  assert.equal(name,'_issue_prepared_agreement_credentials');const hashes=args._credentials as Array<{signer_id:string;token_hash:string}>;
  const r=receipt(hashes);if(!drop)stored=mutate(r);return lost?{data:null,error:{message:'Synthetic private transport detail'}}:{data:mutate(r),error:null};
 }};
 return {calls,service,set(v:unknown){stored=v;},lose(v=true){lost=v;},drop(){drop=true;},mutate(fn:(v:unknown)=>unknown){mutate=fn;},onRead(fn:()=>Promise<void>){onRead=fn;}};
};
const refusal=(fn:()=>Promise<unknown>)=>assert.rejects(fn,/^Error: PREPARED_AGREEMENT_CREDENTIALS_(INVALID|READBACK_REQUIRED)$/);
Deno.test('prepared credential bridge commits only hashes from the original CSPRNG before exposing transient credentials',async()=>{
 const h=harness(),store=factory()(h.service,scope(),[signer,second]),issued=await store.issue();
 assert.equal(issued.recovered,false);assert.deepEqual(h.calls.map(c=>c.name),['_read_prepared_agreement_credentials','_issue_prepared_agreement_credentials']);
 const raw=issued.takeCredential(signer);assert.equal(typeof raw,'string');assert.match(raw!,/^[a-f0-9]{64}$/);
 const hashes=h.calls[1].args._credentials as Array<{signer_id:string;token_hash:string}>;
 assert.equal(await sha256Hex(raw!),hashes[0].token_hash);assert.notEqual(raw,hashes[0].token_hash);
 assert.equal(JSON.stringify(h.calls).includes(raw!),false,'RPC retains hashes, never a raw credential');assert.equal(JSON.stringify(issued).includes(raw!),false,'Serializable result contains no raw credential');
 assert.equal(issued.takeCredential(signer),null);assert.equal(issued.takeCredential(work),null);assert.match(issued.takeCredential(second)!,/^[a-f0-9]{64}$/);
 assert.deepEqual(Object.keys(h.calls[1].args).sort(),['_actor','_credentials','_operation','_request_sha256','_tenant']);
});
Deno.test('historical prepared credential evidence never rotates links or exposes a replacement raw token',async()=>{
 const h=harness(),r=receipt([{signer_id:signer,token_hash:'d'.repeat(64)}]);h.set(r);const store=factory()(h.service,scope(),[signer]);
 assert.deepEqual(await store.read(),r);const issued=await store.issue();assert.equal(issued.recovered,true);assert.equal(issued.takeCredential(signer),null);assert.equal(h.calls.some(c=>c.name==='_issue_prepared_agreement_credentials'),false);
});
Deno.test('original void history survives removed signer hashes without rotating or reconstructing a credential',async()=>{
 const h=harness(),r=receipt([{signer_id:signer,token_hash:null},{signer_id:second,token_hash:null}]);h.set(r);
 const store=factory()(h.service,scope(),[signer,second]);assert.deepEqual(await store.read(),r);
 const issued=await store.issue();assert.equal(issued.recovered,true);assert.equal(issued.takeCredential(signer),null);assert.equal(issued.takeCredential(second),null);
 assert.equal(h.calls.some(c=>c.name==='_issue_prepared_agreement_credentials'),false);
});
Deno.test('removed-hash acknowledgement is never authority to release a newly staged raw credential',async()=>{
 const h=harness();h.mutate(v=>({...v as Record<string,unknown>,credentials:receipt([{signer_id:signer,token_hash:null}]).credentials}));
 const store=factory()(h.service,scope(),[signer]);await refusal(()=>store.issue());await refusal(()=>store.issue());
 assert.equal(h.calls.filter(c=>c.name==='_issue_prepared_agreement_credentials').length,1);
});
Deno.test('lost native ACK reconciles the exact original stored hashes once without issuing again',async()=>{
 const h=harness();h.lose();const issued=await factory()(h.service,scope(),[signer]).issue(),token=issued.takeCredential(signer);
 assert.match(token!,/^[a-f0-9]{64}$/);assert.equal(await sha256Hex(token!),issued.receipt.credentials[0].token_hash);
 assert.deepEqual(h.calls.map(c=>c.name),['_read_prepared_agreement_credentials','_issue_prepared_agreement_credentials','_read_prepared_agreement_credentials']);
});
Deno.test('unknown acknowledgement without exact stored evidence cannot issue twice or return a raw credential',async()=>{
 const h=harness();h.lose();h.drop();const store=factory()(h.service,scope(),[signer]);await refusal(()=>store.issue());await refusal(()=>store.issue());assert.equal(h.calls.filter(c=>c.name==='_issue_prepared_agreement_credentials').length,1);
});
Deno.test('concurrent local issuers share one native operation and each raw credential is consumed once',async()=>{
 const h=harness(),store=factory()(h.service,scope(),[signer]),[one,two]=await Promise.all([store.issue(),store.issue()]);
 assert.equal(h.calls.filter(c=>c.name==='_issue_prepared_agreement_credentials').length,1);assert.equal(one,two);assert.match(one.takeCredential(signer)!,/^[a-f0-9]{64}$/);assert.equal(two.takeCredential(signer),null);
});
Deno.test('foreign malformed extra or provider-success projections cannot release a signing credential',async()=>{
 const make=factory();for(const patch of [{actor_id:work},{tenant_id:work},{operation_id:work},{agreement_id:work},{preparation_id:work},{request_sha256:'0'.repeat(64)},{preparation_sha256:'0'.repeat(64)},{document_sha256:'0'.repeat(64)},{state:'provider_accepted'},{raw_token:'private'},{work_id:'bad'}]){
  const h=harness();h.mutate(v=>({...v as Record<string,unknown>,...patch}));await refusal(()=>make(h.service,scope(),[signer]).issue());assert.equal(h.calls.filter(c=>c.name==='_issue_prepared_agreement_credentials').length,1);
 }
 for(const credentials of [[],[{signer_id:work,token_hash:'d'.repeat(64),expires_at:'2099-01-01T00:00:00Z'}],[{signer_id:signer,token_hash:'not-a-hash',expires_at:'2099-01-01T00:00:00Z'}]]){const h=harness();h.set({...receipt([]),credentials});await refusal(()=>make(h.service,scope(),[signer]).read());}
});
Deno.test('prepared credential bridge captures original scope and signer identities before async work',async()=>{
 const h=harness(),s=scope(),ids=[signer],store=factory()(h.service,s,ids);h.onRead(async()=>{s.actorId=work;s.operationId=work;ids[0]=work;});const issued=await store.issue();
 assert.equal(issued.receipt.actor_id,actor);assert.equal(h.calls[1].args._actor,actor);assert.equal(h.calls[1].args._operation,operation);assert.match(issued.takeCredential(signer)!,/^[a-f0-9]{64}$/);
});
Deno.test('invalid scope and recipients refuse before native reads while disposal cannot mint replacements',async()=>{
 const h=harness(),make=factory();for(const s of [{...scope(),actorId:'bad'},{...scope(),preparationSha256:'bad'},{...scope(),documentSha256:'bad'}])assert.throws(()=>make(h.service,s,[signer]),/^Error: PREPARED_AGREEMENT_CREDENTIALS_INVALID$/);
 for(const ids of [[],[signer,signer],[tenant.toUpperCase()]])assert.throws(()=>make(h.service,scope(),ids),/^Error: PREPARED_AGREEMENT_CREDENTIALS_INVALID$/);assert.equal(h.calls.length,0);
 const store=make(h.service,scope(),[signer]),issued=await store.issue();issued.dispose();assert.equal(issued.takeCredential(signer),null);assert.equal(await store.issue(),issued);assert.equal(h.calls.filter(c=>c.name==='_issue_prepared_agreement_credentials').length,1);
});
