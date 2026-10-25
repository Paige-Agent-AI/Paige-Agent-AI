import assert from 'node:assert/strict';
import {preparedSealFixture} from '../_shared/agreements/test-fixtures/prepared-seal.ts';
import {canonicalPresentationJson} from '../_shared/agreements/preparation-json.ts';
import {sha256Hex} from '../_shared/agreements/token.ts';

// Actual original HTTP handler, SDK and PDF sealer. All Auth/native/Storage
// transports below are controlled ports, never hosted/customer acceptance.
Deno.test('recorded prepared completion reuses original authority without another signature or sender',async t=>{
 const serve=Deno.serve,envGet=Deno.env.get,fetch=globalThis.fetch;
 const f=await preparedSealFixture(),source=f.preparedFields.preparation.manifest.source,party=f.parties[0];
 const token='a'.repeat(64),hash=await sha256Hex(token),key=source.tenant_id+'/'+source.agreement_id+'/presented.pdf';
 const signer={id:party.signerId,agreement_id:source.agreement_id,tenant_id:source.tenant_id,status:'signed',signing_order:1,
  full_name:party.fullName,email:party.email,token_hash:hash,token_expires_at:'2099-01-01T00:00:00Z',token_revoked_at:null,
  typed_name:party.typedName,signed_at:party.signedAt,esign_consent_at:party.consentAt,esign_consent_slug:party.consentSlug,
  esign_consent_version:party.consentVersion,signer_role:party.role,signing_ip:null,signing_user_agent:null,signature_image_png:null};
 const wire={state:'prepared',tenant_id:source.tenant_id,agreement_id:source.agreement_id,client_id:source.client_id,
  source_version:source.version,document_sha256:f.presentedSha256,content_storage_key:key,
  prepared_fields:f.preparedFields,signers:[Object.fromEntries(['id','full_name','email','signer_role','signing_order','status','typed_name','signed_at',
   'esign_consent_at','esign_consent_slug','esign_consent_version','signing_ip','signing_user_agent','signature_image_png'].map(name=>[name,signer[name as keyof typeof signer]]))]};
 const sourceSha=await sha256Hex(canonicalPresentationJson(wire));
 const base={id:source.agreement_id,tenant_id:source.tenant_id,contact_id:source.client_id,version:source.version,title:f.agreementTitle,
  status:'partially_signed',body_source:'tenant_upload',body_markdown:null,content_storage_key:key,content_sha256:f.presentedSha256,
  sealed_storage_key:null,sealed_sha256:null,expires_at:'2099-01-01T00:00:00Z'};
 let row:Record<string,unknown>={...base},signerPatch:Record<string,unknown>={},outstanding=0,audit=true;
 let mode='prepared',ack='record',unreadable=false,signatureError:string|null=null;
 let signatureReads=0,completionActs=0,completionReads=0,sourceReads=0,uploads=0,notices=0,writes=0,removals=0;
 let completed:Record<string,unknown>|null=null;
 const files=new Map<string,Uint8Array>();let handler!:(request:Request)=>Promise<Response>;
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 const receipt=()=>({state:'recorded',replayed:true,signing_id:source.agreement_id,signer_id:party.signerId,signed_at:party.signedAt,
  consented_event_id:audit?'70000000-0000-4000-8000-000000000001':null,
  signed_event_id:audit?'70000000-0000-4000-8000-000000000002':null,audit_complete:audit,
  outstanding_count:outstanding,agreement_status:row.status});
 const reset=()=>{row={...base};signerPatch={};outstanding=0;audit=true;mode='prepared';ack='record';unreadable=false;signatureError=null;
  signatureReads=0;completionActs=0;completionReads=0;sourceReads=0;uploads=0;notices=0;writes=0;removals=0;completed=null;
  files.clear();files.set(key,Uint8Array.from(f.presentedBytes));};
 try{
  Deno.serve=((callback:typeof handler)=>{handler=callback;return {} as never;}) as unknown as typeof Deno.serve;
  Deno.env.get=(name:string)=>name==='SUPABASE_URL'?'https://synthetic.invalid':name==='SUPABASE_SERVICE_ROLE_KEY'||name==='RESEND_API_KEY'?'synthetic-forbidden-legacy-fallback':undefined;
  globalThis.fetch=async(input,init)=>{
   const req=new Request(input,init),url=new URL(req.url);assert.equal(url.origin,'https://synthetic.invalid');
   if(url.pathname==='/rest/v1/rpc/check_public_rate_limit')return json(true);
   if(url.pathname==='/rest/v1/rpc/_record_agreement_signature'){
    signatureReads++;const args=await req.json();assert.equal(args._token_hash,hash);
    for(const name of ['_agreement_version','_content_sha256','_content_storage_key','_typed_name','_signature_image_png','_consent_slug','_consent_version','_consent_sha256','_ip','_user_agent'])assert.equal(args[name],null,'recovery supplies no signature/source evidence');
    assert.equal(args._consent_read,false);assert.equal(args._consent_esign,false);assert(!Object.hasOwn(args,'_prepared_fields'));
    return signatureError?json({code:signatureError,message:'Controlled original authority refusal'},signatureError==='42501'?403:503):json(receipt());
   }
   if(url.pathname==='/rest/v1/rpc/_read_prepared_agreement_seal'){
    sourceReads++;assert.deepEqual(await req.json(),{_agreement:source.agreement_id});
    return json(mode==='prepared'?wire:{state:mode,agreement_id:source.agreement_id,tenant_id:source.tenant_id});
   }
   if(url.pathname==='/rest/v1/rpc/_complete_prepared_agreement_seal'){
    const args=await req.json();assert.equal(args._tenant,source.tenant_id);assert.equal(args._agreement,source.agreement_id);
    if(args._source_sha256===null){completionReads++;assert.equal(args._sealed_storage_key,null);assert.equal(args._sealed_sha256,null);
     return ack==='unknown'?json({code:'CONTROLLED_UNKNOWN',message:'Unknown read'},503):json({...completed,replayed:true});}
    completionActs++;assert.equal(args._source_sha256,sourceSha);const bytes=files.get(args._sealed_storage_key);assert(bytes);
    assert.equal(args._sealed_sha256,await sha256Hex(bytes));
    completed={state:'recorded',replayed:false,agreement_id:source.agreement_id,tenant_id:source.tenant_id,
     preparation_id:f.preparedFields.preparation_id,source_sha256:sourceSha,sealed_storage_key:args._sealed_storage_key,sealed_sha256:args._sealed_sha256,
     completed_at:'2026-10-25T12:00:00.000Z',sealed_event_id:'70000000-0000-4000-8000-000000000003',completed_event_id:'70000000-0000-4000-8000-000000000004'};
    row={...row,status:'completed',sealed_storage_key:args._sealed_storage_key,sealed_sha256:args._sealed_sha256};
    return ack==='record'?json(completed):json({code:'CONTROLLED_ACK_LOST',message:'Lost completion reply'},504);
   }
   if(url.pathname.startsWith('/rest/v1/')){
    if(req.method!=='GET'&&req.method!=='HEAD'){writes++;throw Error('Recovery must use original native transactions, never direct writes');}
    if(url.pathname==='/rest/v1/paige_agreements')return json(row);
    if(url.pathname==='/rest/v1/paige_agreement_signers'){
     if(req.method==='HEAD')return new Response(null,{headers:{'Content-Range':'0-0/'+(url.searchParams.has('signing_order')?0:outstanding)}});
     return json(url.searchParams.has('token_hash')?{...signer,...signerPatch}:[signer]);
    }
    if(url.pathname==='/rest/v1/paige_agreement_events')return json([]);
    if(url.pathname==='/rest/v1/tenants')return json({name:f.tenantName});
    if(url.pathname==='/rest/v1/tenant_members')return json(null);
   }
   if(url.pathname.startsWith('/storage/v1/object/')){
    const segments=url.pathname.split('/'),bucket=segments.indexOf('paige-agreements');assert(bucket>0);
    const storageKey=decodeURIComponent(segments.slice(bucket+1).join('/'));
    if(req.method==='POST'){uploads++;assert(storageKey.startsWith(source.tenant_id+'/'+source.agreement_id+'/sealed-'));assert(!files.has(storageKey));
     assert.equal(req.headers.get('x-upsert'),'false');files.set(storageKey,new Uint8Array(await req.arrayBuffer()));return json({Key:'paige-agreements/'+storageKey});}
    if(req.method==='DELETE'){removals++;throw Error('Unknown recovery cannot delete a possibly retained copy');}
    const bytes=files.get(storageKey);return bytes&&!(unreadable&&storageKey!==key)?new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'application/pdf'}}):json({message:'Controlled file unavailable'},404);
   }
   if(url.pathname==='/functions/v1/send-transactional-email'){notices++;throw Error('No legacy notification authority in prepared recovery');}
   throw Error('Unexpected controlled transport: '+req.method+' '+url.pathname);
  };
  await import('./index.ts');
  const invoke=(body:Record<string,unknown>)=>handler(new Request('https://synthetic.invalid/sign-agreement',{method:'POST',body:JSON.stringify({token,...body})}));
  await t.step('read-only status exposes prepared recovery only from original all-signed source',async()=>{
   reset();const response=await invoke({check_only:true}),r=await response.json();assert.equal(response.status,200);assert(r.ok);
   assert.equal(r.completed,false);assert.equal(r.completion_recovery_available,true);assert.equal(signatureReads,1);assert.equal(sourceReads,1);
   assert.equal(uploads,0);assert.equal(completionActs,0);assert.equal(notices,0);assert.equal(writes,0);
  });
  await t.step('explicit prepared recovery seals the real PDF once without resubmitting any mark',async()=>{
   reset();const response=await invoke({action:'complete-recorded'}),r=await response.json();assert.equal(response.status,200);assert(r.ok&&r.completed);
   assert.equal(r.completion_recovery_available,false);assert.equal(signatureReads,1);assert.equal(completionActs,1);assert.equal(uploads,1);assert.equal(writes,0);assert.equal(notices,0);
   const replay=await(await invoke({action:'complete-recorded'})).json();assert(replay.completed);assert.equal(uploads,1);assert.equal(completionActs,1);assert.equal(notices,0);
  });
  for(const lost of ['lost_ack','unknown'])await t.step('lost completion response never resends a signature or repeats an uncertain effect: '+lost,async()=>{
   reset();ack=lost;const response=await invoke({action:'complete-recorded'}),r=await response.json();assert.equal(response.status,200);assert(r.ok);
   assert.equal(r.completed,lost==='lost_ack');assert.equal(completionActs,1);assert.equal(completionReads,1);assert.equal(uploads,1);assert.equal(removals,0);assert.equal(notices,0);
   ack='record';const checked=await(await invoke({check_only:true})).json();assert(checked.completed);assert.equal(completionActs,1);assert.equal(uploads,1);
  });
  for(const unavailable of ['legacy','unavailable'])await t.step('completion cannot fall back to a legacy or unavailable source: '+unavailable,async()=>{
   reset();mode=unavailable;const response=await invoke({action:'complete-recorded'}),r=await response.json();assert.equal(response.status,200);assert(r.ok&&!r.completed);
   assert.equal(uploads,0);assert.equal(completionActs,0);assert.equal(writes,0);assert.equal(notices,0);
  });
  for(const kind of ['outstanding','audit'])await t.step('incomplete original obligations cannot admit a completion: '+kind,async()=>{
   reset();if(kind==='outstanding')outstanding=1;else audit=false;
   const response=await invoke({action:'complete-recorded'}),r=await response.json();assert.equal(response.status,200);assert(r.ok&&!r.completed);
   assert.equal(r.completion_recovery_available,false);assert.equal(uploads,0);assert.equal(sourceReads,0);assert.equal(completionActs,0);assert.equal(notices,0);
  });
  for(const patch of [{typed_name:'Another mark'},{consent_read:true},{check_only:true},{preparation_id:f.preparedFields.preparation_id}])await t.step('recovery rejects client-authored mark/source evidence: '+Object.keys(patch),async()=>{
   reset();const response=await invoke({action:'complete-recorded',...patch});assert.equal(response.status,400);assert.equal(signatureReads,0);assert.equal(uploads,0);assert.equal(notices,0);
  });
  for(const patch of [{token_revoked_at:'2026-01-01T00:00:00Z'},{token_expires_at:'2020-01-01T00:00:00Z'},{tenant_id:'70000000-0000-4000-8000-000000000099'}])await t.step('current credential and tenant authority still gate recovery: '+Object.keys(patch),async()=>{
   reset();signerPatch=patch;const response=await invoke({action:'complete-recorded'});assert.equal(response.status,404);assert.equal(signatureReads,0);assert.equal(uploads,0);assert.equal(sourceReads,0);
  });
  await t.step('an unreadable existing winning copy never causes replacement sealing',async()=>{
   reset();assert((await(await invoke({action:'complete-recorded'})).json()).completed);unreadable=true;
   const r=await(await invoke({action:'complete-recorded'})).json();assert(r.ok&&!r.completed);assert.equal(uploads,1);assert.equal(completionActs,1);assert.equal(notices,0);
  });
  for(const error of ['42501','CONTROLLED_UNAVAILABLE'])await t.step('original empty-evidence verification refusal cannot admit recovery: '+error,async()=>{
   reset();signatureError=error;const response=await invoke({action:'complete-recorded'});assert.equal(response.status,error==='42501'?404:503);
   assert.equal(uploads,0);assert.equal(sourceReads,0);assert.equal(completionActs,0);assert.equal(notices,0);
  });
 }finally{Deno.serve=serve;Deno.env.get=envGet;globalThis.fetch=fetch;}
});
