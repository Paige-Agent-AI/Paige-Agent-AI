import assert from 'node:assert/strict';
import {handleOwnerPreparation} from './owner-preparation-http.ts';
import {fixture,tenant,agreement,request,next,prepare,save} from './test-fixtures/owner-preparation.ts';
import {sha256Hex} from './token.ts';

const base='https://source-fixture.invalid/agreement-document';
const post=(body:unknown,query='')=>new Request(base+query,{method:'POST',headers:{Authorization:'Bearer local-fixture-only','Content-Type':'application/json'},body:JSON.stringify(body)});
const get=(mode:string,id:string|null=request,extra='')=>new Request(`${base}?preparation=${mode}&businessId=${tenant}&agreementId=${agreement}${id?'&preparationId='+id:''}${extra}`,{headers:{Authorization:'Bearer local-fixture-only'}});
const headers={'Access-Control-Allow-Origin':'*'};

Deno.test('actual owner HTTP prepare/save/read/PDF returns native receipts and exact uncached bytes',async()=>{
  const f=await fixture(),run=(r:Request)=>handleOwnerPreparation(r,f.caller,f.service,headers,async()=>false);
  const first=await run(post(prepare()));assert.equal(first.status,200);assert.equal((await first.json()).receipt.id,request);
  const saved=await run(post(save()));assert.equal(saved.status,200);const result=await saved.json();assert.equal(result.receipt.id,next);assert.equal(result.receipt.revision_no,2);
  const metadata=await run(get('metadata',next));assert.equal(metadata.status,200);assert.equal(metadata.headers.get('cache-control'),'no-store, private');
  const wire=await metadata.text();assert(!wire.includes('content_storage_key'));assert(!wire.includes('manifest_canonical'));assert(!wire.includes('draft-preparation-'));
  const pdf=await run(get('pdf',next,'&download=1'));assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert(pdf.headers.get('content-disposition')?.startsWith('attachment;'));
  assert.equal(pdf.headers.get('cache-control'),'no-store, private');assert.equal(pdf.headers.get('x-content-type-options'),'nosniff');
  assert.equal(await sha256Hex(new Uint8Array(await pdf.arrayBuffer())),result.receipt.document_sha256);assert.equal(f.calls.write,2);assert.equal(f.calls.upload,1);
});
Deno.test('unconfirmed HTTP response does not claim rollback and same exact request recovers',async()=>{
  const f=await fixture();f.state.writeLost=true;const run=(r:Request)=>handleOwnerPreparation(r,f.caller,f.service,headers,async()=>false);
  const unknown=await run(post(prepare()));assert.equal(unknown.status,503);assert.equal((await unknown.json()).code,'unconfirmed');
  const recovered=await run(post(prepare()));assert.equal(recovered.status,200);assert.equal((await recovered.json()).receipt.state,'recovered');assert.equal(f.calls.write,1);
});
Deno.test('token/Portal/legacy and duplicate query keys cannot cross into the new owner path',async t=>{
  for(const query of ['?token=local-token','?portal=1','?agreementId='+agreement,'?preparation=metadata'])await t.step(query.split('=')[0],async()=>{
    const f=await fixture();const r=await handleOwnerPreparation(post(prepare(),query),f.caller,f.service,headers,async()=>false);assert.equal(r.status,400);assert.equal(f.calls.service,0);assert.equal(f.calls.upload,0);
  });
  const f=await fixture();const r=await handleOwnerPreparation(get('metadata',request,'&businessId='+tenant),f.caller,f.service,headers,async()=>false);assert.equal(r.status,400);assert.equal(f.calls.source,0);
});
Deno.test('bounded JSON refuses oversize, malformed UTF8/JSON and unsupported media before original writer',async t=>{
  const inputs=[new Request(base,{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(1048577)}),new Request(base,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(prepare())}),new Request(base,{method:'POST',headers:{'Content-Type':'application/json'},body:'{' }),new Request(base,{method:'POST',headers:{'Content-Type':'application/json'},body:new Uint8Array([0xc3,0x28])})];
  for(const [n,input]of inputs.entries())await t.step(String(n),async()=>{const f=await fixture();const r=await handleOwnerPreparation(input,f.caller,f.service,headers,async()=>false);assert.equal(r.status,400);assert.equal(f.calls.source,0);assert.equal(f.calls.write,0);});
});
Deno.test('original rate hold and actual native revocation remain distinct from a saved result',async()=>{
  const f=await fixture();let r=await handleOwnerPreparation(post(prepare()),f.caller,f.service,headers,async()=>true);assert.equal(r.status,429);assert.equal(f.calls.write,0);
  f.state.admin=false;r=await handleOwnerPreparation(post(prepare()),f.caller,f.service,headers,async()=>false);assert.equal(r.status,403);assert.equal((await r.json()).code,'access_unverified');assert.equal(f.calls.write,0);
});
Deno.test('original commercial source is explicitly held instead of silently missing its economics',async()=>{
  const f=await fixture();f.original.offer_id='55555555-0000-4000-8000-000000000001';
  const r=await handleOwnerPreparation(post(prepare()),f.caller,f.service,headers,async()=>false);assert.equal(r.status,409);assert.equal((await r.json()).code,'commercial_review_required');assert.equal(f.calls.upload,0);
});
Deno.test('provider/native exceptions never expose private path, words, identity or secrets',async()=>{
  const f=await fixture();f.service.rpc=async()=>{throw Error('SECRET raw-private-key SIGNER@example.test private terms');};
  const r=await handleOwnerPreparation(post(prepare()),f.caller,f.service,headers,async()=>false);assert.equal(r.status,503);const body=await r.text();assert(!/SECRET|raw-private|SIGNER|private terms/.test(body));assert.equal(JSON.parse(body).code,'unconfirmed');
});
