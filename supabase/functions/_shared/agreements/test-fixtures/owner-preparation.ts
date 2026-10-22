import assert from "node:assert/strict";
import type {OwnerPreparationCaller,OwnerPreparationService} from "../owner-preparation.ts";
import type {PreparationStorage} from "../preparation-artifact.ts";
import {sha256Hex} from "../token.ts";

// Actual native renderer/parser/field constructor; ONLY identity, RPC and Storage
// transport are local ports. The original218 native SQL assertions own actual
// locks/RLS/actor evidence; these tests do not claim to repeat or replace them.
const tenant='aaaaaaaa-0000-4000-8000-000000000001',agreement='bbbbbbbb-0000-4000-8000-000000000001',actor='cccccccc-0000-4000-8000-000000000001';
const client='dddddddd-0000-4000-8000-000000000001',signer='eeeeeeee-0000-4000-8000-000000000001';
const request='11111111-0000-4000-8000-000000000001',next='11111111-0000-4000-8000-000000000002';
const at='2026-10-22T12:00:00.123456+00:00';
const prepare=()=>({action:'prepare_document',tenant_id:tenant,agreement_id:agreement,request_id:request,expected_source:{client_id:client,version:1,updated_at:at},expected_current_id:null});
const field=(id='22222222-0000-4000-8000-000000000001')=>({id,signer_id:signer,kind:'signature',page:1,x:40,y:80,width:120,height:30,required:true,label:'Signature'});
const save=(fields:unknown[]=[field()])=>({action:'retain_fields',tenant_id:tenant,agreement_id:agreement,request_id:next,expected_source:{client_id:client,version:1,updated_at:at},source_preparation_id:request,fields});
async function fixture(){
  const state={activeTenant:tenant,actor,admin:true,profile:true,anonymous:false,writeLost:false,corrupt:false,beforeWrite:null as null|(()=>void),onDownload:null as null|(()=>void),uploadPath:null as string|null,uploadBytes:null as Uint8Array|null};
  const original={id:agreement,contact_id:client,offer_id:null as string|null,commercial_terms_id:null as string|null,title:'Controlled supplied source',body_source:'paige_draft',source_version_id:null,body_markdown:'Neutral source fixture. No legal sufficiency, signature or provider claim.' as string|null,has_source_document:false,status:'draft',version:1,updated_at:at,expires_at:null,can_edit:true,content_sha256:null,sealed_sha256:null};
  const parties=[{id:signer,full_name:'Controlled Counterparty',email:'recipient@example.test',signer_role:'counterparty',signing_order:1,status:'pending',signed_at:null,declined_at:null}];
  const rows=new Map<string,Record<string,unknown>>(),objects=new Map<string,{bytes:Uint8Array;metadata:Record<string,unknown>}>();
  const calls={service:0,write:0,upload:0,download:0,source:0};
  const caller:OwnerPreparationCaller={auth:{getUser:async()=>({data:{user:{id:state.actor,is_anonymous:state.anonymous}},error:null})},rpc:async(name,args)=>{
    if(name==='current_user_tenant_id')return {data:state.activeTenant,error:null};
    if(name==='is_tenant_admin')return {data:state.admin,error:null};
    assert.equal(name,'read_paige_agreement_preparation');assert.deepEqual(args,{_expected_tenant_id:tenant,_signing_id:agreement});calls.source++;
    return {data:{agreement:structuredClone(original),signers:structuredClone(parties)},error:null};
  }};
  const storage:PreparationStorage={from(bucket){if(bucket==='tenant-agreements')return {
    info:async()=>{throw Error('Must not ask original upload to act as a managed preparation');},upload:async()=>{throw Error('Must never overwrite original uploaded source');},
    download:async(path)=>{assert.equal(path,state.uploadPath);const data=state.uploadBytes?.slice();return {data:data?{size:data.length,arrayBuffer:async()=>data.slice().buffer}:null,error:data?null:{code:'NotFound'}};},
  };assert.equal(bucket,'paige-agreements');return {
    async info(path){const stored=objects.get(path);return stored?{data:{id:'33333333-0000-4000-8000-000000000001',version:'one',name:path,bucketId:bucket,contentType:'application/pdf',size:stored.bytes.length,metadata:stored.metadata},error:null}:{data:null,error:{statusCode:404,code:'NoSuchKey'}};},
    async upload(path,bytes,options){calls.upload++;assert.equal(options.upsert,false);if(!objects.has(path))objects.set(path,{bytes:bytes.slice(),metadata:structuredClone(options.metadata)});return {error:null};},
    async download(path){calls.download++;state.onDownload?.();const o=objects.get(path);if(!o)return {data:null,error:{code:'NotFound'}};const bytes=o.bytes.slice();if(state.corrupt)bytes[0]^=1;return {data:{size:bytes.length,arrayBuffer:async()=>bytes.buffer},error:null};},
  };}};
  const service:OwnerPreparationService={storage,originalUploadPath:async(scopedTenant,scopedAgreement)=>{assert.equal(scopedTenant,tenant);assert.equal(scopedAgreement,agreement);return state.uploadPath;},rpc:async(name,args)=>{
    calls.service++;assert.equal(args._actor,state.actor);assert.equal(args._tenant,tenant);assert.equal(args._agreement,agreement);
    if(!state.profile||!state.admin||state.activeTenant!==tenant)return {data:null,error:{code:'42501'}};
    if(name==='_read_agreement_document_preparation'){
      const id=args._preparation;
      const p=id?rows.get(String(id)):[...rows.values()].find(row=>row.is_selected);
      if(!p)return id?{data:null,error:{code:'42501'}}:{data:{state:'none'},error:null};
      return {data:{...p,source_matches:p.source_version===original.version&&p.source_updated_at===original.updated_at&&original.status==='draft'},error:null};
    }
    assert.equal(name,'_retain_agreement_document_preparation');state.beforeWrite?.();
    if(args._version!==original.version||args._updated_at!==original.updated_at)return {data:null,error:{code:'23514'}};
    assert.equal(args._client,client);assert.equal(args._commercial_payload_digest,null);
    const selected=[...rows.values()].find(row=>row.is_selected);
    if((selected?.id??null)!==args._expected_current)return {data:null,error:{code:'23514'}};
    assert.equal(typeof args._manifest_canonical,'string');const manifest=JSON.parse(String(args._manifest_canonical));
    assert.equal(await sha256Hex(String(args._manifest_canonical)),args._manifest_digest);
    assert.equal(manifest.source.tenant_id,tenant);assert.equal(manifest.source.agreement_id,agreement);assert.equal(manifest.source.updated_at,at);
    if(rows.has(String(args._request)))throw Error('Test expected recovery before another native write');
    for(const row of rows.values())row.is_selected=false;
    calls.write++;const id=String(args._request),event=`44444444-0000-4000-8000-${String(calls.write).padStart(12,'0')}`;
    const p={state:'retained',id,agreement_id:agreement,tenant_id:tenant,client_id:client,revision_no:calls.write,source_version:args._version,source_updated_at:args._updated_at,actor_user_id:state.actor,
      content_storage_key:args._storage_key,document_sha256:manifest.document.sha256,document_byte_length:manifest.document.byte_length,manifest_canonical:args._manifest_canonical,manifest,
      preparation_sha256:args._manifest_digest,commercial_payload_digest:null,event_id:event,is_selected:true,created_at:at,source_scope:'agreement_and_parties',commercial_verification:'not_applicable',source_matches:true};
    rows.set(id,p);return state.writeLost?{data:null,error:{code:'PGRST000'}}:{data:{state:'recorded',id,event_id:event},error:null};
  }};
  return {state,original,parties,rows,objects,calls,caller,service};
}

export {fixture,tenant,agreement,actor,client,signer,request,next,at,prepare,field,save};
