import assert from 'node:assert/strict';
import {executeOwnerPreparation,readOwnerPreparation,readOwnerPreparationPdf,parseOwnerPreparationCommand,OwnerPreparationUnavailable,type OwnerPreparationCaller,type OwnerPreparationService} from './owner-preparation.ts';
import {canonicalPresentationJson} from './preparation-json.ts';
import {sha256Hex} from './token.ts';
import type {PreparationStorage} from './preparation-artifact.ts';
import {PDFDocument} from 'npm:pdf-lib@1.17.1';

import {fixture,commercialFixture,tenant,agreement,request,next,prepare,field,save,actor} from "./test-fixtures/owner-preparation.ts";
import * as ownerPreparation from './owner-preparation.ts';

const refuses=(code:OwnerPreparationUnavailable['code'])=>(e:unknown)=>e instanceof OwnerPreparationUnavailable&&e.code===code;
type CommercialReads={
  listOwnerCommercialPreparationSources:(tenant:string,agreement:string,cursor:string|null,caller:OwnerPreparationCaller,service:OwnerPreparationService)=>Promise<{items:{invoice_id:string;invoice_number:string;total_minor:number;currency:string}[];has_more:boolean;next_cursor:string|null}>;
  reviewOwnerCommercialPreparation:(tenant:string,agreement:string,invoice:string,caller:OwnerPreparationCaller,service:OwnerPreparationService)=>Promise<{state:'ready'|'needs_input';fields?:string[];input?:Record<string,unknown>;payload_digest?:string;presented_body_markdown?:string}>;
};
const commercialReads=()=>{
  const domain=ownerPreparation as unknown as CommercialReads;
  assert.equal(typeof domain.listOwnerCommercialPreparationSources,'function','Original owner door must reuse canonical invoice pagination');
  assert.equal(typeof domain.reviewOwnerCommercialPreparation,'function','Original owner door must review canonical commercial source');
  return domain;
};

Deno.test('commercial source choices reuse original invoice RPC and create no commercial or document effect',async()=>{
  const domain=commercialReads(),f=await commercialFixture();
  const rows=await domain.listOwnerCommercialPreparationSources(tenant,agreement,null,f.caller,f.service);
  assert.deepEqual(rows,{items:[{invoice_id:f.commercial.invoiceId,invoice_number:'DRAFT-TEST',total_minor:350000,currency:'usd'}],has_more:false,next_cursor:null});
  assert.equal(f.calls.upload,0);assert.equal(f.calls.write,0);assert.equal(f.objects.size,0);assert.equal(f.rows.size,0);
  f.commercial.invoice.billing_draft.client_id='dddddddd-0000-4000-8000-000000000002';
  assert.deepEqual((await domain.listOwnerCommercialPreparationSources(tenant,agreement,null,f.caller,f.service)).items,[]);
});
Deno.test('commercial review returns exact original canonical economics/wording, with no PDF upload or write',async()=>{
  const domain=commercialReads(),f=await commercialFixture();
  const before=structuredClone([f.original,f.commercial.terms,f.commercial.invoice]);
  const reviewed=await domain.reviewOwnerCommercialPreparation(tenant,agreement,f.commercial.invoiceId,f.caller,f.service);
  assert.equal(reviewed.state,'ready');assert.match(reviewed.payload_digest??'',/^[a-f0-9]{64}$/);
  assert.equal(reviewed.input?.body_markdown,f.original.body_markdown);assert.equal(reviewed.input?.principal_minor,350000);
  assert.match(reviewed.presented_body_markdown??'',/3,500\.00/);assert.match(reviewed.presented_body_markdown??'',/500\.00/);
  assert.deepEqual([f.original,f.commercial.terms,f.commercial.invoice],before);assert.equal(f.calls.write,0);assert.equal(f.calls.upload,0);
});
Deno.test('commercial review refuses foreign source and retired actor; incomplete facts remain needs input',async()=>{
  const domain=commercialReads(),f=await commercialFixture();
  f.commercial.invoice.contact_id='dddddddd-0000-4000-8000-000000000002';
  await assert.rejects(()=>domain.reviewOwnerCommercialPreparation(tenant,agreement,f.commercial.invoiceId,f.caller,f.service),refuses('SOURCE_CHANGED'));
  f.commercial.invoice.contact_id=prepare().expected_source.client_id;
  Object.assign(f.commercial.terms,{starts_on:null});
  const missing=await domain.reviewOwnerCommercialPreparation(tenant,agreement,f.commercial.invoiceId,f.caller,f.service);
  assert.equal(missing.state,'needs_input');assert(missing.fields?.includes('commercial_service_start'));
  f.commercial.terms.starts_on='2026-10-22';f.commercial.onRead=()=>{f.state.actor='cccccccc-0000-4000-8000-000000000002';};
  await assert.rejects(()=>domain.reviewOwnerCommercialPreparation(tenant,agreement,f.commercial.invoiceId,f.caller,f.service),refuses('ACCESS_UNVERIFIED'));
  assert.equal(f.calls.write,0);assert.equal(f.calls.upload,0);
});
Deno.test('commercial preparation command binds exact selected invoice and reviewed digest; legacy command remains',()=>{
  const command={...prepare(),action:'prepare_commercial_document',invoice_id:'77777777-0000-4000-8000-000000000001',commercial_payload_digest:'a'.repeat(64)};
  const parsed=parseOwnerPreparationCommand(command);assert.equal(parsed.action,'prepare_commercial_document');
  for(const patch of [{actor_user_id:actor},{commercial_payload_digest:'bad'},{invoice_id:'bad'},{manifest:{}}])assert.throws(()=>parseOwnerPreparationCommand({...command,...patch}),refuses('INVALID_REQUEST'));
  assert.equal(parseOwnerPreparationCommand(prepare()).action,'prepare_document');
});
Deno.test('commercial exact review→real PDF→fields uses original immutable source and one request/event',async()=>{
  const domain=commercialReads(),f=await commercialFixture();
  const review=await domain.reviewOwnerCommercialPreparation(tenant,agreement,f.commercial.invoiceId,f.caller,f.service);
  const command={...prepare(),action:'prepare_commercial_document',invoice_id:f.commercial.invoiceId,commercial_payload_digest:review.payload_digest};
  const before=structuredClone([f.original,f.commercial.terms,f.commercial.invoice]);
  const first=await executeOwnerPreparation(command,f.caller,f.service);
  assert.equal(first.receipt.id,request);assert.equal(f.calls.write,1);assert.equal(f.calls.upload,1);
  const stored=f.rows.get(request)!,manifest=JSON.parse(String(stored.manifest_canonical));
  assert.equal(manifest.schema_version,2);assert.equal(manifest.commercial.payload_digest,review.payload_digest);
  assert.equal(manifest.commercial.presented_body_markdown,review.presented_body_markdown);
  const pdf=await readOwnerPreparationPdf(tenant,agreement,request,f.caller,f.service);assert((await PDFDocument.load(pdf.bytes)).getPageCount()>0);
  assert.equal(pdf.sha256,manifest.document.sha256);assert.deepEqual([f.original,f.commercial.terms,f.commercial.invoice],before);
  const second=await executeOwnerPreparation(save(),f.caller,f.service);
  assert.equal(f.calls.upload,1);assert.equal(f.calls.write,2);
  assert.equal(second.receipt.document_sha256,first.receipt.document_sha256);
  assert.equal(JSON.parse(String(f.rows.get(next)!.manifest_canonical)).commercial.payload_digest,review.payload_digest);
  const replay=await executeOwnerPreparation(command,f.caller,f.service);
  assert.equal(replay.receipt.state,'recovered');assert.equal(replay.receipt.event_id,first.receipt.event_id);assert.equal(f.calls.write,2);
});
Deno.test('commercial preparation refuses changed reviewed economics before upload; lost result retains original receipt',async()=>{
  const domain=commercialReads(),f=await commercialFixture();
  const review=await domain.reviewOwnerCommercialPreparation(tenant,agreement,f.commercial.invoiceId,f.caller,f.service);
  const command={...prepare(),action:'prepare_commercial_document',invoice_id:f.commercial.invoiceId,commercial_payload_digest:review.payload_digest};
  f.commercial.invoice.billing_draft_version=2;
  await assert.rejects(()=>executeOwnerPreparation(command,f.caller,f.service),refuses('SOURCE_CHANGED'));
  assert.equal(f.calls.upload,0);assert.equal(f.calls.write,0);
  f.commercial.invoice.billing_draft_version=1;f.state.writeLost=true;
  await assert.rejects(()=>executeOwnerPreparation(command,f.caller,f.service),refuses('UNCONFIRMED'));
  assert.equal(f.calls.upload,1);assert.equal(f.calls.write,1);f.state.writeLost=false;
  f.commercial.terms.collection_terms_version=2;
  const replay=await executeOwnerPreparation(command,f.caller,f.service);
  assert.equal(replay.receipt.state,'recovered');assert.equal(f.calls.write,1);
  assert.equal(replay.view.state==='retained'&&replay.view.can_edit,false);
});
Deno.test('final native source read cannot publish earlier source-current editing status',async()=>{
  const f=await fixture();await executeOwnerPreparation(prepare(),f.caller,f.service);let reads=0;
  f.state.onCurrentRead=()=>{if(++reads===2)f.original.version=2;};
  const view=await readOwnerPreparation(tenant,agreement,request,f.caller,f.service);
  assert.equal(view.state,'retained');assert.equal(view.state==='retained'&&view.can_edit,false);
  assert.equal(view.state==='retained'&&view.preparation.source_matches,false);
});
Deno.test('commercial readback never calls completed historical terms changed without a current comparison',async()=>{
  const f=await commercialFixture(),review=await ownerPreparation.reviewOwnerCommercialPreparation(tenant,agreement,f.commercial.invoiceId,f.caller,f.service);
  if(review.state!=='ready')throw Error('Canonical commercial review expected');
  await executeOwnerPreparation({...prepare(),action:'prepare_commercial_document',invoice_id:f.commercial.invoiceId,commercial_payload_digest:review.payload_digest},f.caller,f.service);
  f.original.status='completed';const view=await readOwnerPreparation(tenant,agreement,request,f.caller,f.service);
  assert.equal(view.state,'retained');assert.equal(view.state==='retained'&&view.can_edit,false);
  assert.equal(view.state==='retained'&&view.commercial_readback?.state,'unavailable');
});
Deno.test('commercial review asynchronous reads cannot republish an earlier selected document as editable',async()=>{
  const f=await commercialFixture(),review=await ownerPreparation.reviewOwnerCommercialPreparation(tenant,agreement,f.commercial.invoiceId,f.caller,f.service);
  if(review.state!=='ready')throw Error('Canonical commercial review expected');
  await executeOwnerPreparation({...prepare(),action:'prepare_commercial_document',invoice_id:f.commercial.invoiceId,commercial_payload_digest:review.payload_digest},f.caller,f.service);
  let changed=false;f.commercial.onRead=table=>{if(table==='tenant_client_agreements')f.state.onCurrentRead=()=>{if(changed)return;changed=true;const original=f.rows.get(request)!;original.is_selected=false;f.rows.set(next,{...original,id:next,is_selected:true,event_id:'44444444-0000-4000-8000-000000000002',revision_no:2});};};
  const view=await readOwnerPreparation(tenant,agreement,request,f.caller,f.service);assert.equal(changed,true);
  assert.equal(view.state==='retained'&&view.preparation.is_selected,false);assert.equal(view.state==='retained'&&view.can_edit,false);
});
Deno.test('final native selection read cannot publish an obsolete selected version as editable',async()=>{
  const f=await fixture();await executeOwnerPreparation(prepare(),f.caller,f.service);let reads=0;
  f.state.onCurrentRead=()=>{if(++reads===2){const original=f.rows.get(request)!;original.is_selected=false;f.rows.set(next,{...original,id:next,is_selected:true,event_id:'44444444-0000-4000-8000-000000000002',revision_no:2});}};
  const view=await readOwnerPreparation(tenant,agreement,request,f.caller,f.service);
  assert.equal(view.state,'retained');assert.equal(view.state==='retained'&&view.can_edit,false);
  assert.equal(view.state==='retained'&&view.preparation.is_selected,false);
});
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
