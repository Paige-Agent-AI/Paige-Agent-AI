import assert from 'node:assert/strict';
import {executeOwnerPreparation,readOwnerPreparation,readOwnerPreparationPdf,parseOwnerPreparationCommand,OwnerPreparationUnavailable,type OwnerPreparationCaller,type OwnerPreparationService} from './owner-preparation.ts';
import {canonicalPresentationJson} from './preparation-json.ts';
import {sha256Hex} from './token.ts';
import type {PreparationStorage} from './preparation-artifact.ts';
import {PDFDocument} from 'npm:pdf-lib@1.17.1';

import {fixture,tenant,agreement,request,next,prepare,field,save,actor} from "./test-fixtures/owner-preparation.ts";

const refuses=(code:OwnerPreparationUnavailable['code'])=>(e:unknown)=>e instanceof OwnerPreparationUnavailable&&e.code===code;
Deno.test('actual native words→PDF→empty version→assigned fields→same PDF and original receipts',async()=>{
  const f=await fixture(),first=await executeOwnerPreparation(prepare(),f.caller,f.service);
  assert.equal(first.receipt.state,'recorded');assert.equal(first.receipt.id,request);assert.equal(f.calls.upload,1);assert.equal(f.calls.write,1);
  const saved=await executeOwnerPreparation(save(),f.caller,f.service);
  assert.equal(saved.receipt.id,next);assert.equal(saved.receipt.revision_no,2);assert.equal(saved.receipt.document_sha256,first.receipt.document_sha256);
  assert.equal(f.calls.upload,1);assert.equal(f.calls.write,2);assert.equal(f.rows.get(request)?.is_selected,false);assert.equal(f.rows.get(next)?.is_selected,true);
  const visible=JSON.stringify(saved);assert(!visible.includes('content_storage_key'));assert(!visible.includes('manifest_canonical'));
  const actual=await readOwnerPreparationPdf(tenant,agreement,next,f.caller,f.service);assert.equal(actual.sha256,saved.receipt.document_sha256);assert.equal(new TextDecoder().decode(actual.bytes.subarray(0,5)),'%PDF-');
});
Deno.test('original uploaded PDF is copied byte-for-byte, never replaced with rendered pasted words',async()=>{
  const f=await fixture(),pdf=await PDFDocument.create();pdf.addPage([420,595]);const bytes=await pdf.save();
  f.original.body_source='tenant_upload';f.original.body_markdown=null;f.original.has_source_document=true;f.original.title='Original source 文書';
  f.state.uploadPath=tenant+'/source/controlled.pdf';f.state.uploadBytes=bytes;
  const result=await executeOwnerPreparation(prepare(),f.caller,f.service);
  assert.equal(result.receipt.document_sha256,await sha256Hex(bytes));assert.deepEqual([...f.objects.values()][0].bytes,bytes);assert.equal(f.calls.write,1);assert.equal(f.calls.upload,1);
});
Deno.test('a foreign or transit-rewritable canonical upload path refuses before any private write',async()=>{
  for(const path of ['foreign/source/file.pdf',tenant+'/source/../foreign.pdf',tenant+'/source/%2e%2e/file.pdf']){
    const f=await fixture();f.original.body_source='tenant_upload';f.original.body_markdown=null;f.original.has_source_document=true;f.state.uploadPath=path;
    await assert.rejects(()=>executeOwnerPreparation(prepare(),f.caller,f.service));assert.equal(f.calls.upload,0);assert.equal(f.calls.write,0);
  }
});
Deno.test('lost native write and reload recover the SAME actual event, never another version or render',async()=>{
  const f=await fixture();f.state.writeLost=true;
  await assert.rejects(()=>executeOwnerPreparation(prepare(),f.caller,f.service),refuses('UNCONFIRMED'));
  const actual=await readOwnerPreparation(tenant,agreement,request,f.caller,f.service);assert.equal(actual.state,'retained');
  const replay=await executeOwnerPreparation(prepare(),f.caller,f.service);assert.equal(replay.receipt.state,'recovered');assert.equal(replay.receipt.event_id,f.rows.get(request)?.event_id);assert.equal(f.calls.write,1);assert.equal(f.calls.upload,1);
});
Deno.test('saved fields replay after source revision remains historical and cannot reselect or create another obligation',async()=>{
  const f=await fixture();await executeOwnerPreparation(prepare(),f.caller,f.service);const saved=await executeOwnerPreparation(save(),f.caller,f.service);
  f.original.version=2;f.original.updated_at='2026-10-22T13:00:00.654321+00:00';
  const replay=await executeOwnerPreparation(save(),f.caller,f.service);assert.equal(replay.receipt.state,'recovered');assert.equal(replay.receipt.event_id,saved.receipt.event_id);assert.equal(replay.view.state,'retained');assert.equal(replay.view.state==='retained'&&replay.view.can_edit,false);assert.equal(f.calls.write,2);
});
Deno.test('same accepted field command ordering is deterministic for retry',async()=>{
  const f=await fixture();await executeOwnerPreparation(prepare(),f.caller,f.service);
  const a=field('22222222-0000-4000-8000-000000000002'),b={...field(),y:160};
  const command=save([a,b]);const first=await executeOwnerPreparation(command,f.caller,f.service),again=await executeOwnerPreparation(command,f.caller,f.service);
  assert.equal(first.receipt.event_id,again.receipt.event_id);assert.equal(again.receipt.state,'recovered');assert.equal(f.calls.write,2);
});
Deno.test('changed intent on the same recorded UUID cannot rewrite history',async()=>{
  const f=await fixture();await executeOwnerPreparation(prepare(),f.caller,f.service);await executeOwnerPreparation(save(),f.caller,f.service);
  await assert.rejects(()=>executeOwnerPreparation(save([{...field(),label:'Different retained intent'}]),f.caller,f.service),refuses('SOURCE_CHANGED'));assert.equal(f.calls.write,2);
});
Deno.test('foreign business, non-admin, anonymous and invalid authority refuse before Storage',async t=>{
  for(const kind of ['activeTenant','admin','anonymous']as const)await t.step(kind,async()=>{const f=await fixture();if(kind==='activeTenant')f.state.activeTenant='aaaaaaaa-0000-4000-8000-000000000002';else if(kind==='admin')f.state.admin=false;else f.state.anonymous=true;
    await assert.rejects(()=>executeOwnerPreparation(prepare(),f.caller,f.service),refuses('ACCESS_UNVERIFIED'));assert.equal(f.calls.service,0);assert.equal(f.calls.upload,0);assert.equal(f.calls.write,0);
  });
});
Deno.test('public membership success cannot replace original native active-profile floor',async()=>{
  const f=await fixture();f.state.profile=false;await assert.rejects(()=>executeOwnerPreparation(prepare(),f.caller,f.service),refuses('ACCESS_UNVERIFIED'));assert.equal(f.calls.upload,0);assert.equal(f.calls.write,0);
});
Deno.test('stale source and commercial-linked document refuse before rendering or Storage',async t=>{
  await t.step('exact CAS',async()=>{const f=await fixture();f.original.version=2;await assert.rejects(()=>executeOwnerPreparation(prepare(),f.caller,f.service),refuses('SOURCE_CHANGED'));assert.equal(f.calls.upload,0);});
  for(const kind of ['offer_id','commercial_terms_id']as const)await t.step(kind,async()=>{const f=await fixture();f.original[kind]='55555555-0000-4000-8000-000000000001';await assert.rejects(()=>executeOwnerPreparation(prepare(),f.caller,f.service),refuses('COMMERCIAL_REVIEW_REQUIRED'));assert.equal(f.calls.upload,0);assert.equal(f.calls.write,0);});
});
Deno.test('actual native CAS refusal at final writer is a source refusal, not success',async()=>{
  const f=await fixture();f.state.beforeWrite=()=>{f.original.version=2;};await assert.rejects(()=>executeOwnerPreparation(prepare(),f.caller,f.service),refuses('SOURCE_CHANGED'));assert.equal(f.calls.write,0);assert.equal(f.calls.upload,1);
});
Deno.test('revocation during actual artifact download cannot publish a PDF or field version',async()=>{
  const f=await fixture();await executeOwnerPreparation(prepare(),f.caller,f.service);f.state.onDownload=()=>{f.state.profile=false;};
  await assert.rejects(()=>readOwnerPreparationPdf(tenant,agreement,request,f.caller,f.service));assert.equal(f.calls.write,1);
});
Deno.test('corrupt actual retained bytes cannot be presented or used for new fields',async()=>{
  const f=await fixture();await executeOwnerPreparation(prepare(),f.caller,f.service);f.state.corrupt=true;
  await assert.rejects(()=>readOwnerPreparationPdf(tenant,agreement,request,f.caller,f.service));await assert.rejects(()=>executeOwnerPreparation(save(),f.caller,f.service));assert.equal(f.calls.write,1);
});
Deno.test('a different legitimate actor may read but cannot claim another actor same-request receipt',async()=>{
  const f=await fixture();await executeOwnerPreparation(prepare(),f.caller,f.service);f.state.actor='cccccccc-0000-4000-8000-000000000002';
  assert.equal((await readOwnerPreparation(tenant,agreement,request,f.caller,f.service)).state,'retained');
  await assert.rejects(()=>executeOwnerPreparation(prepare(),f.caller,f.service),refuses('SOURCE_CHANGED'));assert.equal(f.calls.write,1);
});
Deno.test('missing requested version is UNCONFIRMED, never a false rollback or fresh command',async()=>{
  const f=await fixture();await assert.rejects(()=>readOwnerPreparation(tenant,agreement,request,f.caller,f.service),refuses('UNCONFIRMED'));assert.equal(f.calls.upload,0);assert.equal(f.calls.write,0);
});
Deno.test('closed wire command refuses supplied actor/path/manifest, foreign source and same parent/request UUID',()=>{
  for(const patch of [{actor_user_id:actor},{storage_key:'foreign/file.pdf'},{manifest:{}},{expected_source:{...prepare().expected_source,extra:true}}])assert.throws(()=>parseOwnerPreparationCommand({...prepare(),...patch}),refuses('INVALID_REQUEST'));
  assert.throws(()=>parseOwnerPreparationCommand({...save(),request_id:request}),refuses('INVALID_REQUEST'));
  const parsed=parseOwnerPreparationCommand(save([field()]));assert.equal(parsed.action,'retain_fields');
  assert.equal(canonicalPresentationJson(parsed.action==='retain_fields'?parsed.fields:[]),canonicalPresentationJson([field()]));
});
