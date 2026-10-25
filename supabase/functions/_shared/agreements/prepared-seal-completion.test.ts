import assert from 'node:assert/strict';
import {sealAndComplete} from './seal.ts';
import {preparedSealFixture} from './test-fixtures/prepared-seal.ts';
import {canonicalPresentationJson} from './preparation-json.ts';
import {sha256Hex} from './token.ts';

// Actual original PDF renderer/sealer and native-RPC consumer. These controlled
// transport ports cannot establish hosted Storage, customer or provider proof.
async function fixture(mode:'record'|'lost_ack'|'unknown'|'winner'|'winner_unreadable'|'completed_unreadable'|'foreign'){
 const f=await preparedSealFixture(),source=f.preparedFields.preparation.manifest.source,party=f.parties[0];
 const signer={id:party.signerId,full_name:party.fullName,email:party.email,signer_role:party.role,signing_order:party.signingOrder,
  status:'signed',typed_name:party.typedName,signed_at:party.signedAt,esign_consent_at:party.consentAt,
  esign_consent_slug:party.consentSlug,esign_consent_version:party.consentVersion,signing_ip:null,signing_user_agent:null,signature_image_png:null};
 const presentedKey=source.tenant_id+'/'+source.agreement_id+'/presented.pdf';
 const wire={state:'prepared',tenant_id:source.tenant_id,agreement_id:source.agreement_id,client_id:source.client_id,
  source_version:source.version,document_sha256:f.presentedSha256,content_storage_key:presentedKey,
  prepared_fields:structuredClone(f.preparedFields),signers:[signer]};
 const sourceSha=await sha256Hex(canonicalPresentationJson(wire));
 const row={id:source.agreement_id,tenant_id:source.tenant_id,contact_id:source.client_id,version:source.version,
  title:f.agreementTitle,status:'partially_signed',body_source:'tenant_upload',body_markdown:null,
  content_storage_key:presentedKey,content_sha256:f.presentedSha256,sealed_sha256:null,sealed_storage_key:null};
 const files=new Map<string,Uint8Array>([[presentedKey,Uint8Array.from(f.presentedBytes)]]),removed:string[]=[],calls:string[]=[];
 const inputs:Record<string,unknown>[]=[];let directWrites=0,receipt:Record<string,unknown>|null=null;
 const db={
  async rpc(name:string,args:Record<string,unknown>){
   calls.push(name);
   if(name==='_read_prepared_agreement_seal'){
    assert.deepEqual(args,{_agreement:source.agreement_id});return {data:wire,error:null};
   }
   assert.equal(name,'_complete_prepared_agreement_seal');inputs.push(structuredClone(args));
   assert.equal(args._tenant,source.tenant_id);assert.equal(args._agreement,source.agreement_id);
   if(args._source_sha256===null){
    assert.equal(args._sealed_storage_key,null);assert.equal(args._sealed_sha256,null);
    return {data:receipt?{...receipt,replayed:true}:{state:'unavailable',agreement_id:source.agreement_id,tenant_id:source.tenant_id},error:null};
   }
   assert.equal(args._source_sha256,sourceSha);
   const key=String(args._sealed_storage_key),bytes=files.get(key);assert(bytes);
   assert.equal(args._sealed_sha256,await sha256Hex(bytes),'consumer passes actual uploaded/read-back original sealed bytes');
   if(mode==='unknown')return {data:null,error:{code:'SYNTHETIC_ACK_UNKNOWN'}};
   const winnerKey=source.tenant_id+'/'+source.agreement_id+'/sealed-70000000-0000-4000-8000-000000000001.pdf';
   const winner=mode==='winner'||mode==='winner_unreadable';
   if(winner)files.set(winnerKey,Uint8Array.from(bytes));
   receipt={state:'recorded',replayed:winner,agreement_id:mode==='foreign'?'70000000-0000-4000-8000-000000000099':source.agreement_id,
    tenant_id:source.tenant_id,preparation_id:f.preparedFields.preparation_id,source_sha256:sourceSha,
    sealed_storage_key:winner?winnerKey:key,sealed_sha256:args._sealed_sha256,completed_at:'2026-10-25T12:00:00.000Z',
    sealed_event_id:'70000000-0000-4000-8000-000000000002',completed_event_id:'70000000-0000-4000-8000-000000000003'};
   if(mode==='lost_ack')return {data:null,error:{code:'SYNTHETIC_ACK_LOST_AFTER_COMMIT'}};
   return {data:receipt,error:null};
  },
  from(table:string){let head=false;const q={
   select(_columns?:string,options?:{head?:boolean}){head=options?.head===true;return q;},eq(){return q;},neq(){return q;},order(){return q;},
   maybeSingle(){return Promise.resolve({data:table==='tenants'?{name:f.tenantName}:row,error:null});},
   update(){directWrites++;throw Error('Prepared completion cannot use direct update or rotate a credential');},
   insert(){directWrites++;throw Error('Original audit writes belong to the SAME native transaction');},
   then(resolve:(value:unknown)=>unknown){return Promise.resolve(resolve({data:table==='paige_agreement_signers'?[signer]:[],count:head?0:undefined,error:null}));},
  };return q;},
  storage:{from(bucket:string){assert.equal(bucket,'paige-agreements');return{
   async upload(key:string,bytes:Uint8Array,options:{upsert:boolean}){assert.equal(options.upsert,false);assert(!files.has(key));files.set(key,Uint8Array.from(bytes));return {error:null};},
   download(key:string){calls.push('download:'+key);const bytes=files.get(key);
    const unavailable=receipt&&(mode==='completed_unreadable'||mode==='winner_unreadable')&&receipt.sealed_storage_key===key;
    return Promise.resolve({data:bytes&&!unavailable?new Blob([Uint8Array.from(bytes)]):null,error:!bytes||unavailable?{message:'Controlled retained-copy read failure'}:null});},
   remove(keys:string[]){for(const key of keys){assert.notEqual(key,receipt?.sealed_storage_key,'winning retained copy is immutable');removed.push(key);files.delete(key);}return Promise.resolve({error:null});},
  };}},
 };
 const result=await sealAndComplete(db,source.agreement_id);
 return {result,inputs,removed,calls,directWrites,files,receipt,presentedKey};
}

Deno.test('prepared completion uses one original native transaction and real retained PDF readback',async()=>{
 const r=await fixture('record');assert(r.result.ok);assert.equal(r.result.notificationState,'not_requested');
 assert.equal(r.inputs.length,1);assert.equal(r.directWrites,0);assert.equal(r.removed.length,0);
 assert(r.files.get(r.result.sealedKey));assert.equal(r.result.sealedSha256,await sha256Hex(r.files.get(r.result.sealedKey)!));
});
Deno.test('lost completion acknowledgement reconciles once with empty evidence and never repeats the act',async()=>{
 const r=await fixture('lost_ack');assert(r.result.ok);assert.equal(r.inputs.length,2);
 assert.notEqual(r.inputs[0]._source_sha256,null);assert.equal(r.inputs[1]._source_sha256,null);
 assert.equal(r.directWrites,0);assert.equal(r.removed.length,0);
});
Deno.test('unknown completion preserves a possibly committed candidate and reports uncertainty',async()=>{
 const r=await fixture('unknown');assert.equal(r.result.ok,false);assert.equal(r.inputs.length,2);
 assert.equal(r.inputs[1]._source_sha256,null);assert.equal(r.removed.length,0);assert.equal(r.files.size,2);assert.equal(r.directWrites,0);
});
Deno.test('an acknowledged concurrent winner is verified before only our losing candidate is removed',async()=>{
 const r=await fixture('winner');assert(r.result.ok);assert.equal(r.inputs.length,1);assert.equal(r.removed.length,1);
 assert.notEqual(r.removed[0],r.result.sealedKey);assert(r.files.has(r.result.sealedKey));assert.equal(r.directWrites,0);
});
for(const mode of ['winner_unreadable','completed_unreadable','foreign'] as const)Deno.test('unverified '+mode+' cannot claim a completed copy or remove a candidate',async()=>{
 const r=await fixture(mode);assert.equal(r.result.ok,false);assert.equal(r.removed.length,0);assert.equal(r.directWrites,0);
});
