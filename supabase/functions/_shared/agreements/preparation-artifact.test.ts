import assert from 'node:assert/strict';
import {PDFDocument} from 'npm:pdf-lib@1.17.1';
import {PreparationArtifactUnavailable,preparationArtifactKey,retainPreparationArtifact,type PreparationArtifactIntent,type PreparationStorage} from './preparation-artifact.ts';
import {sha256Hex} from './token.ts';

const intent:PreparationArtifactIntent={tenantId:'aaaaaaaa-0000-4000-8000-000000000001',agreementId:'bbbbbbbb-0000-4000-8000-000000000001',requestId:'cccccccc-0000-4000-8000-000000000001',actorUserId:'dddddddd-0000-4000-8000-000000000001',sourceSha256:'a'.repeat(64)};
async function pdf(){const doc=await PDFDocument.create();doc.addPage([612,792]);return doc.save();}
async function fixture(){
  const first=await pdf(),alternate=await PDFDocument.load(first);alternate.setCreationDate(new Date('2026-10-21T00:00:00Z'));const other=await alternate.save();
  let stored:Uint8Array|null=null,metadata:Record<string,unknown>|null=null;
  const calls={render:0,upload:0,download:0,info:0};
  const state={infoError:null as unknown,uploadThrows:false,infoChange:false,downloadChange:false,context:true,contextCalls:0};
  const path=preparationArtifactKey(intent);
  const storage:PreparationStorage={from(bucket){assert.equal(bucket,'paige-agreements');return {
    async info(key){assert.equal(key,path);calls.info++;if(state.infoError)return {data:null,error:state.infoError};if(!stored)return {data:null,error:{statusCode:404,code:'NoSuchKey'}};
      return {data:{id:'eeeeeeee-0000-4000-8000-000000000001',version:state.infoChange&&calls.download?'changed-version':'one',name:path,bucketId:bucket,contentType:'application/pdf',size:stored.length,metadata},error:null};},
    async upload(key,bytes,options){assert.equal(key,path);assert.equal(options.upsert,false);assert.equal(options.cacheControl,'0');calls.upload++;if(!stored){stored=bytes.slice();metadata=structuredClone(options.metadata);}if(state.uploadThrows)throw Error('Original response lost');return {error:null};},
    async download(key){assert.equal(key,path);calls.download++;const data=stored;return {data:data?{size:data.length,async arrayBuffer(){const captured=data.slice();if(state.downloadChange)captured[0]^=1;return captured.buffer;}}:null,error:null};},
  };}};
  return {first,other,storage,calls,state,render:async()=>{calls.render++;return first;},current:async()=>{state.contextCalls++;return state.context;},
    set(bytes:Uint8Array|null,meta:Record<string,unknown>|null){stored=bytes;metadata=meta;},
    async seed(patch:Record<string,unknown>={}){stored=first;metadata={schemaVersion:1,kind:'draft_document_preparation',...intent,documentSha256:await sha256Hex(first),byteLength:first.length,...patch};},
  };
}
const refusal=(code:PreparationArtifactUnavailable['code'])=>(error:unknown)=>error instanceof PreparationArtifactUnavailable&&error.code===code;
Deno.test('actual native PDF first preparation retains one private object and verifies its real geometry/bytes',async()=>{
  const f=await fixture(),result=await retainPreparationArtifact(intent,f.storage,f.render,f.current);
  assert.equal(result.storageKey,preparationArtifactKey(intent));assert.deepEqual(result.bytes,f.first);assert.equal(result.document.pages[0].width,612);assert.equal(result.document.sha256,await sha256Hex(f.first));assert.equal(f.calls.upload,1);assert.equal(f.calls.render,1);
});
Deno.test('lost upload response and later same-intent retry adopt original timestamped bytes without rendering or overwriting again',async()=>{
  const f=await fixture();f.state.uploadThrows=true;
  const first=await retainPreparationArtifact(intent,f.storage,f.render,f.current);
  const second=await retainPreparationArtifact(intent,f.storage,async()=>{throw Error('MUST NOT render retry');},f.current);
  assert.deepEqual(second.bytes,first.bytes);assert.equal(second.document.sha256,first.document.sha256);assert.equal(f.calls.render,1);assert.equal(f.calls.upload,1);
});
Deno.test('concurrent same-intent contenders adopt one winning object despite different native renderer timestamps',async()=>{
  const f=await fixture();let arriving=0,release:()=>void=()=>{};
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  const storage:PreparationStorage={from(bucket){const original=f.storage.from(bucket);return {...original,async info(path){
    const before=await original.info(path);if(++arriving<=2){if(arriving===2)release();await barrier;}return before;
  }};}};
  assert.notEqual(await sha256Hex(f.first),await sha256Hex(f.other));
  const [a,b]=await Promise.all([retainPreparationArtifact(intent,storage,async()=>f.first,f.current),retainPreparationArtifact(intent,storage,async()=>f.other,f.current)]);
  assert.equal(f.calls.upload,2);assert.equal(a.document.sha256,b.document.sha256);assert.deepEqual(a.bytes,b.bytes);
});
Deno.test('unknown storage outcomes never mean absence or authorize another render',async t=>{
  for(const error of [{statusCode:403,code:'AccessDenied'},{statusCode:404,code:'NoSuchBucket'},{statusCode:503,code:'Unavailable'},new Error('deadline')])await t.step(String((error as {code?:string}).code??'transport'),async()=>{
    const f=await fixture();f.state.infoError=error;await assert.rejects(()=>retainPreparationArtifact(intent,f.storage,f.render,f.current),refusal('STORAGE_UNVERIFIED'));assert.equal(f.calls.render,0);assert.equal(f.calls.upload,0);
  });
});
Deno.test('missing, foreign or changed original metadata cannot be adopted',async t=>{
  for(const patch of [{actorUserId:'dddddddd-0000-4000-8000-000000000002'},{sourceSha256:'b'.repeat(64)},{requestId:'cccccccc-0000-4000-8000-000000000002'},{agreementId:'bbbbbbbb-0000-4000-8000-000000000002'},{extra:'caller invention'},{documentSha256:null}])await t.step(Object.keys(patch)[0],async()=>{
    const f=await fixture();await f.seed(patch);await assert.rejects(()=>retainPreparationArtifact(intent,f.storage,f.render,f.current),refusal('STORAGE_UNVERIFIED'));assert.equal(f.calls.render,0);assert.equal(f.calls.upload,0);
  });
  const f=await fixture();f.set(f.first,null);await assert.rejects(()=>retainPreparationArtifact(intent,f.storage,f.render,f.current),refusal('STORAGE_UNVERIFIED'));
});
Deno.test('actual corrupt bytes and object-version changes during download refuse',async t=>{
  for(const mode of ['downloadChange','infoChange']as const)await t.step(mode,async()=>{const f=await fixture();await f.seed();f.state[mode]=true;await assert.rejects(()=>retainPreparationArtifact(intent,f.storage,f.render,f.current),refusal('STORAGE_UNVERIFIED'));assert.equal(f.calls.upload,0);});
});
Deno.test('context retirement before a write or after readback cannot publish an artifact',async t=>{
  await t.step('before any I/O',async()=>{const f=await fixture();f.state.context=false;await assert.rejects(()=>retainPreparationArtifact(intent,f.storage,f.render,f.current),refusal('CONTEXT_RETIRED'));assert.equal(f.calls.info,0);assert.equal(f.calls.upload,0);});
  await t.step('during original render',async()=>{const f=await fixture();await assert.rejects(()=>retainPreparationArtifact(intent,f.storage,async()=>{f.state.context=false;return f.first;},f.current),refusal('CONTEXT_RETIRED'));assert.equal(f.calls.upload,0);});
  await t.step('after actual download',async()=>{const f=await fixture();await f.seed();await assert.rejects(()=>retainPreparationArtifact(intent,f.storage,f.render,async()=>f.calls.download===0),refusal('CONTEXT_RETIRED'));assert.equal(f.calls.upload,0);});
});
Deno.test('invalid private path/intent and non-PDF output refuse before upload',async()=>{
  const f=await fixture();for(const patch of [{tenantId:'../foreign'},{requestId:'foreign'},{actorUserId:null},{sourceSha256:'bad'},{extra:true}])await assert.rejects(()=>retainPreparationArtifact({...intent,...patch}as PreparationArtifactIntent,f.storage,f.render,f.current),refusal('INTENT_INVALID'));
  await assert.rejects(()=>retainPreparationArtifact(intent,f.storage,async()=>new TextEncoder().encode('not a PDF'),f.current),refusal('DOCUMENT_UNAVAILABLE'));assert.equal(f.calls.upload,0);
});
Deno.test('caller mutation after an await cannot replace captured source/actor/request identity',async()=>{
  const f=await fixture(),mutable={...intent};let first=true;
  const result=await retainPreparationArtifact(mutable,f.storage,f.render,async()=>{if(first){first=false;mutable.sourceSha256='b'.repeat(64);mutable.actorUserId='dddddddd-0000-4000-8000-000000000002';}return true;});
  assert.equal(result.storageKey,preparationArtifactKey(intent));assert.equal(f.calls.upload,1);
});
