import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.190.0/testing/asserts.ts';
import { PDFDocument, PDFName, PDFNumber, degrees } from 'npm:pdf-lib@1.17.1';
import { inspectAgreementPreparationPdf } from './document-preparation.ts';
import { prepareAgreementFields, readAgreementPdfDocument } from './field-preparation.ts';
import { hashDocument, inspectUploadedPdf, renderPresentedPdf, sealAgreementPdf } from './document.ts';
import * as fieldPreparation from './field-preparation.ts';
import {assembleFixedRepaymentSchedule} from '../sales-collections/model.ts';
import {canonicalPresentationJson,commercialPresentationText,prepareCommercialPresentation} from './commercial-presentation.ts';
import {sha256Hex} from './token.ts';

const uid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = () => ({ tenant_id: uid(1), agreement_id: uid(2), client_id: uid(3), version: 4,
  updated_at: '2026-10-22T08:00:00.123456Z', status: 'draft',
  signers: [5, 6].map((n, i) => ({ id: uid(n), full_name: i ? 'Business Signatory' : 'Client Signatory',
    email: `party${n}@example.test`, signer_role: i ? 'tenant_signatory' : 'counterparty', signing_order: i + 1, status: 'pending' })) });
const document = () => ({ sha256: 'a'.repeat(64), byte_length: 1234,
  pages: [{ page: 1, crop_x: 10, crop_y: 20, crop_width: 500, crop_height: 700, rotation: 0, width: 500, height: 700 }] });
const field = (n = 5, index = 0) => ({ id: uid(10 + index), signer_id: uid(n), kind: 'signature', page: 1,
  x: 20, y: 100 + index * 100, width: 180, height: 40, required: true, label: 'Sign here' });
const fields = () => [field(), field(6, 1)];
const invalid = /AGREEMENT_FIELD_PREPARATION_INVALID/;
const unavailable = /AGREEMENT_PREPARATION_PDF_UNAVAILABLE/;

const commercialInput = () => {
  const original=source(),schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,
    deposit_date:'2026-10-22',installment_cents:30000,first_installment_date:'2026-11-22',cadence:'monthly'});
  assert(schedule.state==='ready');
  const treatment={state:'not_applicable',charges:[],source:'Synthetic owner decision',policy:'No applicable charge recorded'};
  return {schema_version:2,engagement:{starts_on:'2026-10-22',ends_on:null,price_basis:'negotiated'},
    source:{tenant_id:original.tenant_id,client_id:original.client_id,agreement_id:original.agreement_id,
      agreement_version:original.version,agreement_updated_at:original.updated_at,offer_id:uid(30),body_source:'paige_draft',
      status:'draft',content_sha256:null,terms_id:uid(31),terms_version:1,terms_updated_at:original.updated_at,
      invoice_id:uid(32),invoice_version:1,invoice_draft_version:1,invoice_updated_at:original.updated_at},
    title:'Service agreement',body_markdown:'Business-supplied example wording.',principal_minor:350000,currency:'usd',
    collection_terms:schedule.terms,conditions:{schema_version:1,tax:treatment,fees:treatment},lines:[{unit_minor:350000,quantity:1}]};
};
type CommercialConstructor=(s:unknown,d:unknown,f:unknown,c:unknown)=>Promise<{
  manifest:{schema_version:number;source:Record<string,unknown>;document:Record<string,unknown>;signers:unknown[];fields:unknown[];
    commercial:{payload:Record<string,unknown>;payload_digest:string;presented_body_markdown:string;presented_body_sha256:string}};
  preparation_sha256:string;ready_for_review:boolean;issues:unknown[];
}>;
const commercialConstructor=()=>{
  const prepare=(fieldPreparation as unknown as Record<string,unknown>).prepareCommercialAgreementFields;
  assert(typeof prepare==='function','Original field-preparation module must compose the canonical commercial manifest');
  return prepare as CommercialConstructor;
};

Deno.test('commercial field preparation composes actual original PDF/fields/formatter without changing source',async()=>{
  const prepare=commercialConstructor(),s=source(),input=commercialInput();
  const presentation=await prepareCommercialPresentation(input),body=commercialPresentationText(input.body_markdown,presentation);
  const bytes=await renderPresentedPdf({title:input.title,bodyMarkdown:body}),before=bytes.slice();
  const pdf=await inspectAgreementPreparationPdf(bytes,await hashDocument(bytes));
  const ordinary=await prepareAgreementFields(s,pdf,fields()),original=structuredClone([s,input]);
  const result=await prepare(s,pdf,fields(),input);
  assertEquals(result.manifest,{...ordinary.manifest,schema_version:2,commercial:{payload:presentation.payload,
    payload_digest:presentation.payload_digest,presented_body_markdown:body,presented_body_sha256:await sha256Hex(body)}});
  assertEquals(result.preparation_sha256,await sha256Hex(canonicalPresentationJson(result.manifest)));
  assertNotEquals(result.preparation_sha256,ordinary.preparation_sha256);assert(result.ready_for_review);
  assertEquals([s,input],original);assertEquals(bytes,before);
  assert(Object.isFrozen(result)&&Object.isFrozen(result.manifest)&&Object.isFrozen(result.manifest.commercial));
  assert(Object.isFrozen(result.manifest.commercial.payload));
});

Deno.test('commercial construction refuses foreign client/source, stale microseconds, legacy or incomplete economics',async t=>{
  const prepare=commercialConstructor();
  for(const [key,value] of [['tenant_id',uid(91)],['client_id',uid(92)],['agreement_id',uid(93)],['agreement_version',5],
    ['agreement_updated_at','2026-10-22T08:00:00.123457Z']] as const){
    await t.step(key,async()=>{const input=commercialInput();Object.assign(input.source,{[key]:value});await assertRejects(()=>prepare(source(),document(),fields(),input));});
  }
  for(const change of [(v:Record<string,unknown>)=>{v.schema_version=1;delete v.engagement;},
    (v:Record<string,unknown>)=>{v.principal_minor=NaN;},(v:Record<string,unknown>)=>{delete v.conditions;},
    (v:Record<string,unknown>)=>{v.extra=true;}]){
    const input=commercialInput();change(input);await assertRejects(()=>prepare(source(),document(),fields(),input));
  }
});

Deno.test('commercial composition retains original missing-field and overlap issues',async()=>{
  const prepare=commercialConstructor(),missing=await prepare(source(),document(),[],commercialInput());
  assert(!missing.ready_for_review);assertEquals(missing.issues,(await prepareAgreementFields(source(),document(),[])).issues);
  const overlap=[field(),{...field(6,1),x:20,y:100}],result=await prepare(source(),document(),overlap,commercialInput());
  assert(!result.ready_for_review);assertEquals(result.issues,(await prepareAgreementFields(source(),document(),overlap)).issues);
});

Deno.test('commercial constructor captures every input before its asynchronous digests',async()=>{
  const prepare=commercialConstructor(),s=source(),d=document(),f=fields(),input=commercialInput();
  const expected=await prepare(s,d,f,input),pending=prepare(s,d,f,input);
  s.signers[0].full_name='Changed after call';d.sha256='b'.repeat(64);f[0].x=300;input.principal_minor=1;input.source.agreement_updated_at='2026-10-22T08:00:00.123457Z';
  assertEquals(await pending,expected);
});

Deno.test('actual native rendered PDF remains unchanged and can still be sealed', async () => {
  const bytes = await renderPresentedPdf({ title: 'Preparation source', bodyMarkdown: 'Business-supplied example wording.' });
  const before = bytes.slice(), sha = await hashDocument(bytes);
  const d = await inspectAgreementPreparationPdf(bytes, sha);
  assertEquals(bytes, before); assertEquals(d.sha256, sha); assertEquals(d.byte_length, bytes.length);
  assertEquals(d.pages.length, (await inspectUploadedPdf(bytes) as { ok: true; pages: number }).pages);
  assert(d.pages[0].width > 0 && d.pages[0].height > 0);
  const sealed = await sealAgreementPdf({ presentedBytes: bytes, presentedSha256: sha, presentedKind: 'file',
    agreementTitle: 'Preparation source', agreementId: uid(2), tenantName: 'Example business', parties: [], events: [], sealedAtIso: '2026-10-22T08:00:00Z' });
  assert((await PDFDocument.load(sealed)).getPageCount() > d.pages.length);
  assertEquals(await hashDocument(bytes), sha);
});

Deno.test('real PDF pages use visible crop/media intersection and all native rotations', async () => {
  const pdf = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270, -90, 450]) {
    const page = pdf.addPage([600, 800]); page.setCropBox(-20, 30, 540, 900); page.setRotation(degrees(rotation));
  }
  const bytes = await pdf.save(), d = await inspectAgreementPreparationPdf(bytes, await hashDocument(bytes));
  assertEquals(d.pages.map(p => [p.crop_x, p.crop_y, p.crop_width, p.crop_height, p.rotation, p.width, p.height]),
    [[0, 30, 520, 770, 0, 520, 770], [0, 30, 520, 770, 90, 770, 520], [0, 30, 520, 770, 180, 520, 770],
      [0, 30, 520, 770, 270, 770, 520], [0, 30, 520, 770, 270, 770, 520], [0, 30, 520, 770, 90, 770, 520]]);
});

Deno.test('byte mutation, wrong hash, empty, fake PDF and unsupported real page geometry refuse', async t => {
  const pdf = await PDFDocument.create(); pdf.addPage([600, 800]); const bytes = await pdf.save(), sha = await hashDocument(bytes);
  const mutated = bytes.slice(); mutated[mutated.length - 10] ^= 1;
  for (const [name, data, expected] of [['mutated', mutated, sha], ['wrong hash', bytes, 'b'.repeat(64)], ['no hash', bytes, null],
    ['empty', new Uint8Array(), sha], ['fake', new TextEncoder().encode('%PDF-fake'), null]] as const)
    await t.step(name, async () => { await assertRejects(() => inspectAgreementPreparationPdf(data, expected ?? '0'.repeat(64)), TypeError, unavailable.source); });
  for (const [name, apply] of [
    ['UserUnit', (p: ReturnType<typeof pdf.addPage>) => p.node.set(PDFName.of('UserUnit'), PDFNumber.of(2))],
    ['empty visible crop', (p: ReturnType<typeof pdf.addPage>) => p.setCropBox(900, 900, 100, 100)],
    ['arbitrary rotation', (p: ReturnType<typeof pdf.addPage>) => p.node.set(PDFName.of('Rotate'), PDFNumber.of(45))],
  ] as const) await t.step(name, async () => {
    const d = await PDFDocument.create(), page = d.addPage([600, 800]); apply(page); const data = await d.save();
    await assertRejects(async () => inspectAgreementPreparationPdf(data, await hashDocument(data)), TypeError, unavailable.source);
  });
});

Deno.test('empty real PDF and preparation page limit refuse without changing native inspector', async () => {
  const empty = await PDFDocument.create(); const bytes = await empty.save({ addDefaultPage: false });
  await assertRejects(async () => inspectAgreementPreparationPdf(bytes, await hashDocument(bytes)), TypeError, unavailable.source);
  const many = await PDFDocument.create(); for (let i = 0; i < 251; i++) many.addPage([100, 100]); const data = await many.save();
  assertEquals(await inspectUploadedPdf(data), { ok: true, pages: 251 });
  await assertRejects(async () => inspectAgreementPreparationPdf(data, await hashDocument(data)), TypeError, unavailable.source);
});

Deno.test('external buffer changes after dispatch do not substitute different page bytes', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([600, 800]); const bytes = await pdf.save(), sha = await hashDocument(bytes);
  const pending = inspectAgreementPreparationPdf(bytes, sha); bytes.fill(0);
  const d = await pending; assertEquals(d.sha256, sha); assertEquals(d.pages[0].width, 600);
});

Deno.test('complete original two-party map is ready for review, not signed or approved', async () => {
  const result = await prepareAgreementFields(source(), document(), fields());
  assert(result.ready_for_review); assertEquals(result.issues, []); assertEquals(result.preparation_sha256.length, 64);
  const serial = JSON.stringify(result); assert(!serial.includes('party5@') && !serial.includes('Client Signatory'));
  assert(!('approved' in result) && !('signed' in result) && !('receipt_id' in result));
  assertEquals(result.manifest.source.updated_at, '2026-10-22T08:00:00.123456Z');
  assertThrows(() => { result.manifest.fields[0].x++; }, TypeError);
  assertThrows(() => { result.manifest.document.pages[0].width++; }, TypeError);
  assertThrows(() => { result.manifest.source.version++; }, TypeError);
  assertThrows(() => { result.manifest.signers.reverse(); }, TypeError);
  assertThrows(() => { result.ready_for_review = false; }, TypeError);
});

Deno.test('draft remains correctable with explicit missing party/signature and overlap issues', async () => {
  const noParty = source(); noParty.signers = []; const none = await prepareAgreementFields(noParty, document(), []);
  assertEquals(none.issues, [{ code: 'missing_signer' }]); assert(!none.ready_for_review);
  const missing = await prepareAgreementFields(source(), document(), [field()]);
  assertEquals(missing.issues, [{ code: 'missing_signature', signer_id: uid(6) }]); assert(!missing.ready_for_review);
  const overlap = fields(); overlap[1].y = overlap[0].y;
  const result = await prepareAgreementFields(source(), document(), overlap);
  assertEquals(result.issues, [{ code: 'overlapping_fields', field_ids: [uid(10), uid(11)] }]); assert(!result.ready_for_review);
});

Deno.test('all five field types, legitimate parallel order and touching edges are supported', async () => {
  const s = source(); s.signers[1].signing_order = 1;
  const f = fields(); f[1].y = f[0].y + f[0].height;
  for (const [i, kind] of ['initials', 'signed_date', 'text', 'checkbox'].entries()) f.push({ ...field(5, i + 2), kind, width: 80, height: 30 });
  const result = await prepareAgreementFields(s, document(), f); assert(result.ready_for_review); assertEquals(result.manifest.fields.length, 6);
});

Deno.test('stable map identity ignores input array/key order and binds every actual source', async t => {
  const initial = await prepareAgreementFields(source(), document(), fields());
  const reordered = source(); reordered.signers.reverse();
  const same = await prepareAgreementFields(reordered, document(), fields().reverse().map(f => Object.fromEntries(Object.entries(f).reverse())));
  assertEquals(same.preparation_sha256, initial.preparation_sha256);
  const variants: [string, (s: ReturnType<typeof source>, d: ReturnType<typeof document>, f: ReturnType<typeof fields>) => void][] = [
    ['tenant', s => { s.tenant_id = uid(20); }], ['agreement', s => { s.agreement_id = uid(20); }], ['client', s => { s.client_id = uid(20); }],
    ['version', s => { s.version++; }], ['exact microsecond CAS', s => { s.updated_at = '2026-10-22T08:00:00.123457Z'; }],
    ['name', s => { s.signers[0].full_name = 'Revised signatory'; }], ['email', s => { s.signers[0].email = 'other@example.test'; }],
    ['order', s => { s.signers[0].signing_order = 3; }], ['role', s => { s.signers[0].signer_role = 'witness'; }],
    ['PDF bytes', (_s, d) => { d.sha256 = 'b'.repeat(64); }], ['PDF length', (_s, d) => { d.byte_length++; }],
    ['PDF crop origin', (_s, d) => { d.pages[0].crop_x++; }], ['placement', (_s, _d, f) => { f[0].x++; }],
    ['label', (_s, _d, f) => { f[0].label = 'Client signature'; }], ['assignment', (_s, _d, f) => { f[0].signer_id = uid(6); }],
  ];
  for (const [name, change] of variants) await t.step(name, async () => {
    const s = source(), d = document(), f = fields(); change(s, d, f);
    assertNotEquals((await prepareAgreementFields(s, d, f)).preparation_sha256, initial.preparation_sha256);
  });
});

Deno.test('strict signer, source and field boundary refuses malformed or invented authority', async t => {
  const variants: [string, (s: Record<string, unknown>, d: Record<string, unknown>, f: Record<string, unknown>[]) => void][] = [
    ['privileged actor', s => { s.actor_user_id = uid(30); }], ['not draft', s => { s.status = 'completed'; }],
    ['bad source UUID', s => { s.client_id = 'unknown'; }], ['impossible date', s => { s.updated_at = '2026-02-30T08:00:00Z'; }],
    ['fractional version', s => { s.version = 1.5; }], ['missing timestamp', s => { delete s.updated_at; }],
    ['foreign signer', (_s, _d, f) => { f[0].signer_id = uid(40); }], ['duplicate field', (_s, _d, f) => { f[1].id = f[0].id; }],
    ['invented field', (_s, _d, f) => { f[0].kind = 'charge'; }], ['optional signature', (_s, _d, f) => { f[0].required = false; }],
    ['preset signature', (_s, _d, f) => { f[0].value = 'Someone signed'; }], ['approval', (_s, _d, f) => { f[0].approved = true; }],
    ['missing label', (_s, _d, f) => { f[0].label = ''; }], ['control label', (_s, _d, f) => { f[0].label = 'Sign\u0000here'; }],
    ['wrong page', (_s, _d, f) => { f[0].page = 2; }], ['negative x', (_s, _d, f) => { f[0].x = -1; }],
    ['negative zero', (_s, _d, f) => { f[0].x = -0; }], ['off right', (_s, _d, f) => { f[0].x = 400; }],
    ['off bottom', (_s, _d, f) => { f[0].y = 690; }], ['empty rectangle', (_s, _d, f) => { f[0].width = 0; }],
    ['NaN', (_s, _d, f) => { f[0].x = NaN; }], ['infinite', (_s, _d, f) => { f[0].height = Infinity; }],
    ['string required', (_s, _d, f) => { f[0].required = 'true'; }], ['invented document authority', (_s, d) => { d.approved = true; }],
  ];
  for (const [name, change] of variants) await t.step(name, async () => {
    const s = source(), d = document(), f = fields(); change(s, d, f);
    await assertRejects(() => prepareAgreementFields(s, d, f), TypeError, invalid.source);
  });
  for (const edit of [(s: ReturnType<typeof source>) => { s.signers[1].id = s.signers[0].id; },
    (s: ReturnType<typeof source>) => { s.signers[0].status = 'signed'; },
    (s: ReturnType<typeof source>) => { s.signers[0].signer_role = 'admin'; }]) {
    const s = source(); edit(s); await assertRejects(() => prepareAgreementFields(s, document(), fields()), TypeError, invalid.source);
  }
});

Deno.test('page descriptor cannot spoof rotation, displayed dimensions, page order or digest', () => {
  for (const edit of [(d: ReturnType<typeof document>) => { d.pages[0].rotation = 45; },
    (d: ReturnType<typeof document>) => { d.pages[0].rotation = 90; }, (d: ReturnType<typeof document>) => { d.pages[0].page = 2; },
    (d: ReturnType<typeof document>) => { d.pages[0].width = 0; }, (d: ReturnType<typeof document>) => { d.sha256 = 'unknown'; }]) {
    const d = document(); edit(d); assertThrows(() => readAgreementPdfDocument(d), TypeError, invalid.source);
  }
});

Deno.test('source/map mutation during async hashing cannot replace the dispatched snapshot', async () => {
  const s = source(), d = document(), f = fields(), expected = await prepareAgreementFields(s, d, f);
  const pending = prepareAgreementFields(s, d, f); s.signers[1].email = 'changed@example.test'; d.sha256 = 'b'.repeat(64); f[1].x++;
  assertEquals((await pending).preparation_sha256, expected.preparation_sha256);
});
