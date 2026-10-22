import {it} from 'https://deno.land/std@0.190.0/testing/bdd.ts';
import assert from 'node:assert/strict';
import {prepareRetainedAgreementArtifact} from './prepare-retained.ts';
import {renderPresentedPdf} from './document.ts';
import {e04CommercialFixture} from './test-fixtures/commercial-source.ts';
import {sha256Hex} from './token.ts';

// In-memory Storage transport only; actual renderer/parser/hash remain native.
// No real Storage project, business identity, sender or provider is exercised.
function objectStore(){
  const objects=new Map<string,{bytes:Uint8Array;metadata:unknown}>();
  const calls:{method:string;path:string;options?:unknown}[]=[];
  const bucket={
    info:async(path:string)=>{
      calls.push({method:'info',path});const saved=objects.get(path);
      return saved?{data:{id:'99999999-0000-4000-8000-000000000001',version:'original-version',name:path,bucketId:'paige-agreements',size:saved.bytes.length,contentType:'application/pdf',metadata:saved.metadata},error:null}
        :{data:null,error:{statusCode:'404',code:'NoSuchKey'}};
    },
    upload:async(path:string,bytes:Uint8Array,options:{upsert:false;metadata?:unknown})=>{
      calls.push({method:'upload',path,options});
      if(objects.has(path))return {error:{statusCode:'409',code:'KeyAlreadyExists'}};
      objects.set(path,{bytes:bytes.slice(),metadata:structuredClone(options.metadata)});return {error:null};
    },
    download:async(path:string)=>{
      calls.push({method:'download',path});const saved=objects.get(path);
      return {data:saved?new Blob([new Uint8Array(saved.bytes)]):null,error:saved?null:{statusCode:'404',code:'NoSuchKey'}};
    },
  };
  return {objects,calls,bucket,storage:{from:(name:string)=>{assert.equal(name,'paige-agreements');return bucket;}}};
}

it('render-once recovery retains the original PDF after an interrupted upload and later timestamp',async()=>{
  const f=await e04CommercialFixture(),store=objectStore();let renders=0;
  const render=async(input:{title:string;bodyMarkdown:string})=>{renders++;return await renderPresentedPdf(input);};
  const first=await prepareRetainedAgreementArtifact(f.tenant,f.operation,f.command,f.caller,store.storage,async()=>true,render);
  assert.equal(renders,1);assert.equal(store.objects.size,1);
  await new Promise(resolve=>setTimeout(resolve,1200));
  const recovered=await prepareRetainedAgreementArtifact(f.tenant,f.operation,f.command,f.caller,store.storage,async()=>true,render);
  assert.equal(recovered.content_storage_key,first.content_storage_key);
  assert.equal(recovered.document_sha256,first.document_sha256);
  assert.equal(renders,1,'A retained original must be read, never rendered again');
  assert.equal(store.calls.filter(c=>c.method==='upload').length,1);
});

async function setup(){
  const f=await e04CommercialFixture(),store=objectStore();let renders=0;
  const render=async(input:{title:string;bodyMarkdown:string})=>{renders++;return await renderPresentedPdf(input);};
  const run=(current=async()=>true)=>prepareRetainedAgreementArtifact(f.tenant,f.operation,f.command,f.caller,store.storage,current,render);
  return {...f,store,run,renders:()=>renders};
}
it('records only original object source/hash metadata and returns an internal artifact without a business receipt',async()=>{
  const f=await setup(),result=await f.run();
  const upload=f.store.calls.find(c=>c.method==='upload');assert(upload);
  const options=upload.options as {upsert:boolean;cacheControl:string;contentType:string;metadata:Record<string,unknown>};
  assert.equal(options.upsert,false);assert.equal(options.cacheControl,'0');assert.equal(options.contentType,'application/pdf');
  assert.deepEqual(Object.keys(options.metadata).sort(),['schemaVersion','tenantId','agreementId','operationId','actorUserId','payloadDigest','presentedBodySha256','documentSha256','byteLength'].sort());
  assert.equal(options.metadata.actorUserId,f.authority.actor);
  assert.equal(options.metadata.payloadDigest,f.command.payload_digest);
  assert.equal(options.metadata.documentSha256,result.document_sha256);
  assert.deepEqual(Object.keys(result).sort(),['payload','payload_digest','presented_body_markdown','presented_body_sha256','content_storage_key','document_sha256'].sort());
  assert.equal(f.store.calls.filter(c=>c.method==='info').length,3);
});
it('recovers actual original bytes when the accepted upload response is lost',async()=>{
  const f=await setup(),upload=f.store.bucket.upload;
  f.store.bucket.upload=async(...args)=>{await upload(...args);throw Error('Synthetic lost upload response');};
  const result=await f.run();assert.equal(f.renders(),1);assert.equal(f.store.objects.size,1);
  assert.equal(result.document_sha256,await sha256Hex(f.store.objects.get(result.content_storage_key)!.bytes));
});
it('concurrent exact operations adopt the one retained winner without overwrite despite different render timestamps',async()=>{
  const f=await setup(),originalInfo=f.store.bucket.info;let firstReads=0,release!:()=>void;
  const both=new Promise<void>(resolve=>release=resolve);
  f.store.bucket.info=async(path)=>{
    if(firstReads<2){firstReads++;if(firstReads===2)release();await both;return {data:null,error:{statusCode:'404',code:'NoSuchKey'}};}
    return originalInfo(path);
  };
  let renders=0;
  const render=async(input:{title:string;bodyMarkdown:string})=>{if(++renders===2)await new Promise(resolve=>setTimeout(resolve,1200));return renderPresentedPdf(input);};
  const run=()=>prepareRetainedAgreementArtifact(f.tenant,f.operation,f.command,f.caller,f.store.storage,async()=>true,render);
  const [a,b]=await Promise.all([run(),run()]);
  assert.equal(a.document_sha256,b.document_sha256);assert.equal(a.content_storage_key,b.content_storage_key);
  assert.equal(f.store.objects.size,1);assert.equal(renders,2);
  assert.equal(f.store.calls.filter(c=>c.method==='upload').length,2);
});
for(const [key,changed] of [
  ['tenantId','00000099-0000-4000-8000-000000000001'],
  ['agreementId','00000099-0000-4000-8000-000000000001'],
  ['operationId','00000099-0000-4000-8000-000000000001'],
  ['actorUserId','00000099-0000-4000-8000-000000000001'],
  ['payloadDigest','b'.repeat(64)],['presentedBodySha256','b'.repeat(64)],['documentSha256','b'.repeat(64)],
  ['schemaVersion',2],['byteLength',1],['unexpected','private-fixture-only'],
] as const){
  it(`refuses altered retained ${key} without rendering a replacement`,async()=>{
    const f=await setup(),original=await f.run(),entry=f.store.objects.get(original.content_storage_key)!;
    (entry.metadata as Record<string,unknown>)[key]=changed;
    await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);
    assert.equal(f.renders(),1);assert.equal(f.store.calls.filter(c=>c.method==='upload').length,1);
  });
}
it('does not bless an old object without matching original source metadata',async()=>{
  const f=await setup(),original=await f.run();f.store.objects.get(original.content_storage_key)!.metadata=null;
  await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);assert.equal(f.renders(),1);
});
it('refuses a same-length retained byte change',async()=>{
  const f=await setup(),original=await f.run(),entry=f.store.objects.get(original.content_storage_key)!;
  entry.bytes[entry.bytes.length-1]^=1;
  await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);assert.equal(f.renders(),1);
});
it('uses the native seal parser, refusing even a matching checksum over an invalid PDF header-only body',async()=>{
  const f=await setup(),original=await f.run(),entry=f.store.objects.get(original.content_storage_key)!;
  entry.bytes=new TextEncoder().encode('%PDF-1.7\nNot a valid document');
  Object.assign(entry.metadata as object,{documentSha256:await sha256Hex(entry.bytes),byteLength:entry.bytes.length});
  await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);assert.equal(f.renders(),1);
});
for(const error of [{statusCode:'404',code:'NoSuchBucket'},{statusCode:'403',code:'AccessDenied'},{statusCode:'503',code:'Unavailable'}]){
  it(`treats Storage ${error.code} as unverified rather than absent`,async()=>{
    const f=await setup();f.store.bucket.info=async()=>({data:null,error});
    await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);assert.equal(f.renders(),0);assert.equal(f.store.objects.size,0);
  });
}
it('refuses an info transport failure without rendering or starting another upload',async()=>{
  const f=await setup();f.store.bucket.info=async()=>{throw Error('Synthetic private detail');};
  await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);assert.equal(f.renders(),0);
});
it('refuses a new invalid PDF before upload',async()=>{
  const f=await setup();
  await assert.rejects(prepareRetainedAgreementArtifact(f.tenant,f.operation,f.command,f.caller,f.store.storage,async()=>true,
    async()=>new TextEncoder().encode('%PDF-1.7\nNot a valid document')),/RENDER_UNAVAILABLE/);
  assert.equal(f.store.objects.size,0);assert.equal(f.store.calls.filter(c=>c.method==='upload').length,0);
});
it('retains uncertainty when upload did not establish any original object',async()=>{
  const f=await setup();f.store.bucket.upload=async()=>{throw Error('Synthetic ambiguous transport');};
  await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);assert.equal(f.store.objects.size,0);
});
it('refuses download transport failure without a second render',async()=>{
  const f=await setup();await f.run();f.store.bucket.download=async()=>{throw Error('Synthetic private detail');};
  await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);assert.equal(f.renders(),1);
});
it('refuses original-object version replacement during readback',async()=>{
  const f=await setup();await f.run();const info=f.store.bucket.info;let reads=0;
  f.store.bucket.info=async(path)=>{const result=await info(path);if(result.data&&++reads===2)result.data.version='replacement-version';return result;};
  await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);assert.equal(f.renders(),1);
});
it('refuses changed source before rendering or reading a retained object',async()=>{
  const f=await setup();f.rows.paige_agreements.body_markdown='Changed supplied wording';
  await assert.rejects(f.run(),/SOURCE_CHANGED/);assert.equal(f.renders(),0);assert.equal(f.store.calls.length,0);
});
it('refuses an account change after render before any upload',async()=>{
  const f=await setup();
  const render=async(input:{title:string;bodyMarkdown:string})=>{const bytes=await renderPresentedPdf(input);f.authority.actor=f.client;return bytes;};
  await assert.rejects(prepareRetainedAgreementArtifact(f.tenant,f.operation,f.command,f.caller,f.store.storage,async()=>true,render),/WORKSPACE_CHANGED/);
  assert.equal(f.store.calls.filter(c=>c.method==='upload').length,0);
});
it('retires authority after upload without claiming the original object was never written',async()=>{
  const f=await setup(),upload=f.store.bucket.upload;
  f.store.bucket.upload=async(...args)=>{const result=await upload(...args);f.authority.admin=false;return result;};
  await assert.rejects(f.run(),/WORKSPACE_CHANGED/);assert.equal(f.store.objects.size,1);
  assert.equal(f.store.calls.filter(c=>c.method==='download').length,0);
});
it('the supplied current callback cannot override a real active-workspace mismatch',async()=>{
  const f=await setup();f.authority.tenant=f.client;
  await assert.rejects(f.run(async()=>true),/WORKSPACE_CHANGED/);
  assert.equal(f.renders(),0);assert.equal(f.store.calls.length,0);
});
it('refuses an original object with mismatched provider identity or type',async()=>{
  const f=await setup();await f.run();const info=f.store.bucket.info;
  f.store.bucket.info=async(path)=>{const result=await info(path);if(result.data)result.data.bucketId='foreign-bucket';return result;};
  await assert.rejects(f.run(),/STORAGE_UNVERIFIED/);assert.equal(f.renders(),1);
});
