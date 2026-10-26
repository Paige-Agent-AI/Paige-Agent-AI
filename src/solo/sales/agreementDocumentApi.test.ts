import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {Blob as NativeBlob} from 'node:buffer';
import fixture from './fixtures/agreement-document-source.json';
import {prepareAgreementFields,prepareCommercialAgreementFields,type AgreementFieldPreparation} from '../../../supabase/functions/_shared/agreements/field-preparation';
import {assembleFixedRepaymentSchedule} from '../../../supabase/functions/_shared/sales-collections/model';
import {prepareCommercialPresentation,commercialPresentationText} from '../../../supabase/functions/_shared/agreements/commercial-presentation';
import {projectPreparedSignatureReview} from '../../../supabase/functions/_shared/agreements/prepared-signature-review-contract';
import {commsEmailBodyHtml} from '../../../supabase/functions/_shared/comms-email/contract';
import {canonicalPresentationJson} from '../../../supabase/functions/_shared/agreements/preparation-json';
import {sha256Hex} from '../../../supabase/functions/_shared/agreements/token';
import * as documentSDK from './agreementDocumentApi';
const {getSession,invoke,rpc,setHeader,abortSignal}=vi.hoisted(()=>({getSession:vi.fn(),invoke:vi.fn(),rpc:vi.fn(),setHeader:vi.fn(),abortSignal:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getSession},functions:{invoke},rpc}}));
import {listAgreementDocumentHistory,prepareAgreementDocumentCommand,readAgreementDocument,readAgreementDocumentPdf,saveAgreementDocument,type AgreementDocumentContext,type AgreementDocumentView} from './agreementDocumentApi';

const actor='a1111111-0000-4000-8000-000000000001',request='b1111111-0000-4000-8000-000000000001',event='f1111111-0000-4000-8000-000000000001';
const context=():AgreementDocumentContext=>({tenantId:fixture.source.tenant_id,agreementId:fixture.source.agreement_id,actorId:actor,isCurrent:()=>true});
const session=()=>({data:{session:{user:{id:actor,is_anonymous:false},access_token:'controlled-auth-token'}},error:null});
let prepared:AgreementFieldPreparation;
function retained():Extract<AgreementDocumentView,{state:'retained'}>{return {state:'retained',title:'Controlled agreement',source:structuredClone(fixture.source) as AgreementDocumentView['source'],can_prepare:true,preparation_hold:null,document_signers:structuredClone(fixture.signers) as AgreementDocumentView['document_signers'],can_edit:true,
  preparation:{id:request,agreement_id:fixture.source.agreement_id,client_id:fixture.source.client_id,revision_no:1,source_version:1,source_updated_at:fixture.source.updated_at,actor_user_id:actor,document_sha256:fixture.document.sha256,document_byte_length:fixture.document.byte_length,manifest:structuredClone(prepared.manifest),preparation_sha256:prepared.preparation_sha256,event_id:event,is_selected:true,created_at:'2026-10-22T13:00:00.123456+00:00',source_scope:'agreement_and_parties',source_matches:true,commercial_verification:'not_applicable'}};}
function none():AgreementDocumentView{const {title,source,can_prepare,preparation_hold,document_signers}=retained();return {state:'none',title,source,can_prepare,preparation_hold,document_signers};}
function written(view=retained()){const p=view.preparation;return {ok:true,view,receipt:{state:'recorded',historical_receipt:true,id:p.id,event_id:p.event_id,revision_no:p.revision_no,document_sha256:p.document_sha256,preparation_sha256:p.preparation_sha256,is_selected:p.is_selected}};}
const reply=(view:AgreementDocumentView=retained())=>({data:{ok:true,view},error:null});
function held<T>(){let resolve!:(value:T)=>void;return {promise:new Promise<T>(done=>{resolve=done;}),resolve:(value:T)=>resolve(value)};}
beforeEach(async()=>{vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',NativeBlob);vi.clearAllMocks();getSession.mockResolvedValue(session());prepared=await prepareAgreementFields(fixture.source,fixture.document,[]);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

const commercialInvoice='77777777-0000-4000-8000-000000000001';
function commercialInput(){
  const s=fixture.source,schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,
    deposit_date:'2026-10-22',installment_cents:30000,first_installment_date:'2026-11-22',cadence:'monthly'});
  if(schedule.state!=='ready')throw Error('Canonical fixture unavailable');
  const treatment={state:'not_applicable',charges:[],source:'Synthetic owner decision',policy:'No applicable charge recorded'};
  return {schema_version:2,engagement:{starts_on:'2026-10-22',ends_on:null,price_basis:'negotiated'},
    source:{tenant_id:s.tenant_id,client_id:s.client_id,agreement_id:s.agreement_id,agreement_version:s.version,agreement_updated_at:s.updated_at,
      offer_id:'55555555-0000-4000-8000-000000000001',body_source:'paige_draft',status:'draft',content_sha256:null,
      terms_id:'66666666-0000-4000-8000-000000000001',terms_version:1,terms_updated_at:s.updated_at,invoice_id:commercialInvoice,invoice_version:1,invoice_draft_version:1,invoice_updated_at:s.updated_at},
    title:'Controlled agreement',body_markdown:'Neutral commercial source.',principal_minor:350000,currency:'usd',collection_terms:schedule.terms,
    conditions:{schema_version:1,tax:treatment,fees:treatment},lines:[{unit_minor:350000,quantity:1}]};
}
type CommercialSDK={
  readAgreementCommercialSources:(ctx:AgreementDocumentContext,cursor?:string|null)=>Promise<{ok:boolean;value?:unknown}>;
  readAgreementCommercialReview:(ctx:AgreementDocumentContext,invoice:string)=>Promise<{ok:boolean;value?:unknown}>;
  prepareAgreementCommercialCommand:(ctx:AgreementDocumentContext,id:string,view:AgreementDocumentView,review:unknown)=>unknown;
};
function commercialSDK(){const sdk=documentSDK as unknown as CommercialSDK;
  expect(sdk.readAgreementCommercialSources).toBeTypeOf('function');expect(sdk.readAgreementCommercialReview).toBeTypeOf('function');expect(sdk.prepareAgreementCommercialCommand).toBeTypeOf('function');return sdk;}

describe('canonical commercial document SDK',()=>{
  it('refuses a self-consistent native receipt for different commercial terms than the reviewed command',async()=>{
    const input=commercialInput(),intended=await prepareCommercialPresentation(input);
    input.source.terms_version=2;const commercial=await prepareCommercialAgreementFields(fixture.source,fixture.document,[],input),original=retained();
    const raw={...original,preparation:{...original.preparation,manifest:commercial.manifest,preparation_sha256:commercial.preparation_sha256,commercial_verification:'not_checked'},commercial_readback:{state:'current',invoice_id:commercialInvoice,payload_digest:commercial.manifest.commercial.payload_digest}};
    const p=raw.preparation;invoke.mockResolvedValue({data:{ok:true,view:raw,receipt:{state:'recorded',historical_receipt:true,id:p.id,event_id:p.event_id,revision_no:p.revision_no,document_sha256:p.document_sha256,preparation_sha256:p.preparation_sha256,is_selected:true}},error:null});
    const command={tenant_id:fixture.source.tenant_id,agreement_id:fixture.source.agreement_id,request_id:request,expected_source:{client_id:fixture.source.client_id,version:fixture.source.version,updated_at:fixture.source.updated_at},action:'prepare_commercial_document' as const,expected_current_id:null,invoice_id:commercialInvoice,commercial_payload_digest:intended.payload_digest};
    expect((await saveAgreementDocument(context(),command)).ok).toBe(false);
  });
  it('reads same scoped original invoice choices using the captured owner context',async()=>{
    const sdk=commercialSDK();invoke.mockResolvedValue({data:{ok:true,sources:{tenant_id:fixture.source.tenant_id,agreement_id:fixture.source.agreement_id,
      items:[{invoice_id:commercialInvoice,invoice_number:'DRAFT-TEST',total_minor:350000,currency:'usd'}],has_more:false,next_cursor:null}},error:null});
    expect(await sdk.readAgreementCommercialSources(context())).toMatchObject({ok:true,value:{items:[{invoice_id:commercialInvoice,total_minor:350000}]}});
    expect(invoke.mock.calls[0][0]).toBe(`agreement-document?preparation=commercial_sources&businessId=${fixture.source.tenant_id}&agreementId=${fixture.source.agreement_id}`);
  });
  it('recomputes original review presentation and binds a closed immutable prepare command',async()=>{
    const sdk=commercialSDK(),input=commercialInput(),presentation=await prepareCommercialPresentation(input);
    const wire={state:'ready',tenant_id:fixture.source.tenant_id,agreement_id:fixture.source.agreement_id,invoice_id:commercialInvoice,input,presentation,
      payload_digest:presentation.payload_digest,presented_body_markdown:commercialPresentationText(input.body_markdown,presentation)};
    invoke.mockResolvedValue({data:{ok:true,review:wire},error:null});const result=await sdk.readAgreementCommercialReview(context(),commercialInvoice);
    expect(result.ok).toBe(true);const command=sdk.prepareAgreementCommercialCommand(context(),request,none(),result.value);
    expect(command).toMatchObject({action:'prepare_commercial_document',invoice_id:commercialInvoice,commercial_payload_digest:presentation.payload_digest,expected_current_id:null});
    expect(Object.isFrozen(command)).toBe(true);
    wire.payload_digest='f'.repeat(64);expect((await sdk.readAgreementCommercialReview(context(),commercialInvoice)).ok).toBe(false);
  });
  it('reads a native commercial2 manifest and preserves its economics through another preparation command',async()=>{
    const input=commercialInput(),commercial=await prepareCommercialAgreementFields(fixture.source,fixture.document,[],input),original=retained();
    const raw={...original,preparation:{...original.preparation,manifest:commercial.manifest,preparation_sha256:commercial.preparation_sha256,commercial_verification:'not_checked'},
      commercial_readback:{state:'current',invoice_id:commercialInvoice,payload_digest:commercial.manifest.commercial.payload_digest}};
    invoke.mockResolvedValue({data:{ok:true,view:raw},error:null});const result=await readAgreementDocument(context(),request);expect(result.ok).toBe(true);
    if(!result.ok)throw Error('Expected exact commercial view');
    expect(result.value.state==='retained'&&'derived_fields_sha256' in result.value.preparation?result.value.preparation.derived_fields_sha256:null).toBe(prepared.preparation_sha256);
    expect(prepareAgreementDocumentCommand(context(),'b1111111-0000-4000-8000-000000000002',result.value)).toMatchObject({action:'prepare_commercial_document',invoice_id:commercialInvoice,commercial_payload_digest:commercial.manifest.commercial.payload_digest});
  });
  it('refuses mismatched commercial source/readback and any edit claim on changed economics',async()=>{
    const input=commercialInput(),commercial=await prepareCommercialAgreementFields(fixture.source,fixture.document,[],input),original=retained();
    const raw={...original,preparation:{...original.preparation,manifest:commercial.manifest,preparation_sha256:commercial.preparation_sha256,commercial_verification:'not_checked'},
      commercial_readback:{state:'changed',invoice_id:commercialInvoice,payload_digest:commercial.manifest.commercial.payload_digest}};
    invoke.mockResolvedValue({data:{ok:true,view:raw},error:null});expect((await readAgreementDocument(context(),request)).ok).toBe(false);
    raw.can_edit=false;raw.can_prepare=false;raw.preparation.source_matches=false;
    const result=await readAgreementDocument(context(),request);expect(result.ok).toBe(true);if(result.ok)expect(prepareAgreementDocumentCommand(context(),request,result.value)).toBeNull();
  });
});

async function signingReview(value=retained()){
  return projectPreparedSignatureReview({tenant_id:value.source.tenant_id,agreement_id:value.source.agreement_id,preparation_id:value.preparation.id,
    preparation_sha256:value.preparation.preparation_sha256,expected_source:{client_id:value.source.client_id,version:value.source.version,updated_at:value.source.updated_at}},value);
}
type MutableReviewWire<T>={-readonly [Key in keyof T]:T[Key] extends object?MutableReviewWire<T[Key]>:T[Key]};
describe('saved signature review on the original owner document SDK',()=>{
  it('reads the exact retained tuple with the actual actor token and preserves honest unready field work',async()=>{
    const value=retained(),review=await signingReview(value);invoke.mockResolvedValue({data:{ok:true,review},error:null});
    const result=await documentSDK.readAgreementSigningReview(context(),value);expect(result).toEqual({ok:true,value:review});
    expect(review.ready_for_review).toBe(false);expect(review.approval).toBe('not_requested');expect(review.sending).toBe('not_connected');
    const [name,args]=invoke.mock.calls[0],url=new URL('https://local-fixture.invalid/'+name);
    expect(url.searchParams.get('preparation')).toBe('signing_review');expect(url.searchParams.get('preparationId')).toBe(request);
    expect(url.searchParams.get('preparationSha256')).toBe(value.preparation.preparation_sha256);expect(url.searchParams.get('sourceUpdatedAt')).toBe(fixture.source.updated_at);
    expect(args).toMatchObject({method:'GET',headers:{Authorization:'Bearer controlled-auth-token'}});expect(args.body).toBeUndefined();expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['digest','document','signer','source','approved','sending','unknown_field','missing_issue'] as const)('refuses changed or expanded %s review evidence',async variant=>{
    const value=retained(),review=structuredClone(await signingReview(value)) as MutableReviewWire<Awaited<ReturnType<typeof signingReview>>>;
    if(variant==='digest')review.review_sha256='0'.repeat(64);if(variant==='document')review.document.sha256='0'.repeat(64);
    if(variant==='signer')review.signers[0].email='other@example.test';if(variant==='source')review.request.expected_source.version++;
    if(variant==='approved')Object.assign(review,{approval:'approved'});if(variant==='sending')Object.assign(review,{sending:'sent'});
    if(variant==='unknown_field')Object.assign(review,{token:'forbidden'});if(variant==='missing_issue')Object.assign(review,{issues:[],ready_for_review:true});
    invoke.mockResolvedValue({data:{ok:true,review},error:null});expect(await documentSDK.readAgreementSigningReview(context(),value)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it.each(['historical','changed_source','foreign_scope','not_editable'] as const)('refuses %s retained work before requesting review',async variant=>{
    const value=retained();if(variant==='historical')value.preparation.is_selected=false;if(variant==='changed_source')value.preparation.source_matches=false;
    if(variant==='foreign_scope')value.source.tenant_id=event;if(variant==='not_editable')value.can_edit=false;
    expect((await documentSDK.readAgreementSigningReview(context(),value)).ok).toBe(false);expect(invoke).not.toHaveBeenCalled();expect(getSession).not.toHaveBeenCalled();
  });
  it('captures both the source and context before awaits instead of mixing later caller edits',async()=>{
    const value=retained(),ctx=context(),review=await signingReview(value),auth=held<ReturnType<typeof session>>();getSession.mockReturnValue(auth.promise);
    invoke.mockResolvedValue({data:{ok:true,review},error:null});const waiting=documentSDK.readAgreementSigningReview(ctx,value);
    value.source.version++;ctx.tenantId=event;ctx.actorId=event;await vi.waitFor(()=>expect(getSession).toHaveBeenCalledOnce());auth.resolve(session());
    expect(await waiting).toEqual({ok:true,value:review});expect(invoke.mock.calls[0][0]).toContain(fixture.source.tenant_id);
  });
  it('retires a late signature review after the original access epoch changes',async()=>{
    let active=true;const value=retained(),review=await signingReview(value),work=held<{data:unknown;error:null}>();invoke.mockReturnValue(work.promise);
    const waiting=documentSDK.readAgreementSigningReview({...context(),isCurrent:()=>active},value);await vi.waitFor(()=>expect(invoke).toHaveBeenCalledOnce());active=false;work.resolve({data:{ok:true,review},error:null});
    expect(await waiting).toMatchObject({ok:false,reason:'retired'});
  });
  it('withholds the source when the actual current actor differs and never makes a request',async()=>{
    const auth=session();auth.data.session.user.id=event;getSession.mockResolvedValue(auth);
    expect(await documentSDK.readAgreementSigningReview(context(),retained())).toMatchObject({ok:false,reason:'access_unverified'});expect(invoke).not.toHaveBeenCalled();
  });
  it('keeps unknown read recovery distinct from a possibly executed preparation command',async()=>{
    invoke.mockRejectedValue(Error('SECRET raw provider detail'));const result=await documentSDK.readAgreementSigningReview(context(),retained());
    expect(result).toMatchObject({ok:false,reason:'unconfirmed'});expect(JSON.stringify(result)).not.toMatch(/SECRET|already.*recorded|may.*recorded/i);expect(JSON.stringify(result)).toContain('Retry the review');
  });
});

describe('same original owner document SDK boundary',()=>{
  it('uses the existing SDK with the actual captured actor token and exact scoped request',async()=>{
    invoke.mockResolvedValue(reply());const result=await readAgreementDocument(context(),request);expect(result).toMatchObject({ok:true,value:{state:'retained',preparation:{id:request}}});
    const [name,args]=invoke.mock.calls[0];expect(name).toBe(`agreement-document?preparation=metadata&businessId=${fixture.source.tenant_id}&agreementId=${fixture.source.agreement_id}&preparationId=${request}`);expect(args).toMatchObject({method:'GET',headers:{Authorization:'Bearer controlled-auth-token'}});expect(args.signal).toBeInstanceOf(AbortSignal);
  });
  it.each(['absent','wrong_actor','anonymous','failed'] as const)('refuses %s session before dispatch',async variant=>{
    const auth=session();if(variant==='absent')auth.data.session=null as never;if(variant==='wrong_actor')auth.data.session.user.id=event;if(variant==='anonymous')auth.data.session.user.is_anonymous=true;if(variant==='failed')auth.error={message:'private'} as never;
    getSession.mockResolvedValue(auth);expect(await readAgreementDocument(context())).toMatchObject({ok:false,reason:'access_unverified'});expect(invoke).not.toHaveBeenCalled();
  });
  it('never dispatches after an A to B to A access epoch changes while Auth is pending',async()=>{
    let epoch=1;const auth=held<ReturnType<typeof session>>();getSession.mockReturnValue(auth.promise);const pending=readAgreementDocument({...context(),isCurrent:()=>epoch===1});epoch=2;epoch=3;auth.resolve(session());expect(await pending).toMatchObject({ok:false,reason:'retired'});expect(invoke).not.toHaveBeenCalled();
  });
  it('retires a late response without returning private document metadata',async()=>{
    let active=true;const work=held<ReturnType<typeof reply>>();invoke.mockReturnValue(work.promise);const waiting=readAgreementDocument({...context(),isCurrent:()=>active});await vi.waitFor(()=>expect(invoke).toHaveBeenCalledOnce());active=false;work.resolve(reply());expect(await waiting).toMatchObject({ok:false,reason:'retired'});
  });
  it('copies the original scope before awaiting Auth',async()=>{
    const ctx=context(),auth=held<ReturnType<typeof session>>();getSession.mockReturnValue(auth.promise);invoke.mockResolvedValue(reply());const waiting=readAgreementDocument(ctx,request);ctx.tenantId=event;ctx.agreementId=event;ctx.actorId=event;auth.resolve(session());expect(await waiting).toMatchObject({ok:true});expect(invoke.mock.calls[0][0]).toContain(fixture.source.tenant_id);
  });
  it.each(['tenant','agreement','request','digest','expanded','geometry'] as const)('withholds %s response mismatches',async variant=>{
    const v=retained();if(variant==='tenant')v.source.tenant_id=event;if(variant==='agreement')v.preparation.agreement_id=event;if(variant==='request')v.preparation.id=event;if(variant==='digest')v.preparation.preparation_sha256='0'.repeat(64);if(variant==='expanded')Object.assign(v,{private_key:'not-public'});if(variant==='geometry')v.preparation.manifest.document.pages[1].width=400;
    invoke.mockResolvedValue(reply(v));expect(await readAgreementDocument(context(),request)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('returns only the original safe native hold, never legal sufficiency or signing success',async()=>{
    const v=none();v.can_prepare=false;v.preparation_hold='commercial_review_required';invoke.mockResolvedValue(reply(v));expect(await readAgreementDocument(context())).toMatchObject({ok:true,value:{state:'none',can_prepare:false,preparation_hold:'commercial_review_required'}});expect(prepareAgreementDocumentCommand(context(),request,v)).toBeNull();
  });
  it('captures the exact microsecond source CAS and immutable proposal before any dispatch',async()=>{
    const c=prepareAgreementDocumentCommand(context(),request,none())!;expect(c).toMatchObject({action:'prepare_document',expected_current_id:null,expected_source:{updated_at:fixture.source.updated_at}});expect(Object.isFrozen(c)).toBe(true);expect(Object.isFrozen(c.expected_source)).toBe(true);
    invoke.mockResolvedValue({data:written(),error:null});expect(await saveAgreementDocument(context(),c)).toMatchObject({ok:true,value:{receipt:{event_id:event}}});expect(invoke.mock.calls[0][1].body).toEqual(c);
  });
  it('freezes assigned fields and refuses another original source, document or historical selection',async()=>{
    const next='b2222222-0000-4000-8000-000000000002';const field={id:event,signer_id:fixture.signers[0].id,kind:'signature' as const,page:1,x:20,y:20,width:120,height:40,required:true,label:'Signature'};
    const fields=structuredClone(await prepareAgreementFields(fixture.source,fixture.document,[field])),v=retained();const c=prepareAgreementDocumentCommand(context(),next,v,fields)!;expect(c.action).toBe('retain_fields');if(c.action!=='retain_fields')throw Error('Expected fields');fields.manifest.fields[0].label='Different';expect(c.fields[0].label).toBe('Signature');expect(Object.isFrozen(c.fields[0])).toBe(true);
    v.preparation.is_selected=false;expect(prepareAgreementDocumentCommand(context(),next,v,prepared)).toBeNull();v.preparation.is_selected=true;const other=structuredClone(prepared);other.manifest.document.sha256='0'.repeat(64);expect(prepareAgreementDocumentCommand(context(),next,v,other)).toBeNull();other.manifest.document.sha256=fixture.document.sha256;other.manifest.source.version=2;expect(prepareAgreementDocumentCommand(context(),next,v,other)).toBeNull();
  });
  it.each(['event','request','source_time','receipt_hash','revision','selection'] as const)('never reports success for mismatched %s write receipt',async variant=>{
    const value=written();if(variant==='event')value.receipt.event_id=request;if(variant==='request')value.receipt.id=event;if(variant==='source_time')value.view.preparation.source_updated_at='2026-10-21T12:00:00.123+00:00';if(variant==='receipt_hash')value.receipt.document_sha256='0'.repeat(64);if(variant==='revision')value.receipt.revision_no=9;if(variant==='selection')value.receipt.is_selected=false;
    invoke.mockResolvedValue({data:value,error:null});expect(await saveAgreementDocument(context(),prepareAgreementDocumentCommand(context(),request,none())!)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('recovers the original historical receipt without reselecting it or claiming current source matches',async()=>{
    const value=written();value.receipt.state='recovered';value.receipt.is_selected=false;value.view.source.version=2;value.view.preparation.source_matches=false;value.view.preparation.is_selected=false;value.view.can_edit=false;value.view.document_signers=[];
    invoke.mockResolvedValue({data:value,error:null});expect(await saveAgreementDocument(context(),prepareAgreementDocumentCommand(context(),request,none())!)).toMatchObject({ok:true,value:{view:{can_edit:false,preparation:{is_selected:false,source_matches:false}},receipt:{state:'recovered',historical_receipt:true}}});
  });
  it('bounds pending Auth and never sends a command after its deadline',async()=>{
    vi.useFakeTimers();const auth=held<ReturnType<typeof session>>();getSession.mockReturnValue(auth.promise);const waiting=readAgreementDocument(context());await vi.advanceTimersByTimeAsync(20001);expect(await waiting).toMatchObject({ok:false,reason:'unconfirmed'});auth.resolve(session());await Promise.resolve();expect(invoke).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it.each([['source_changed','source_changed'],['unrecognized','unconfirmed']])('maps a bounded original %s error without private text',async(code,reason)=>{
    invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({code,message:'private provider data'}),{headers:{'Content-Type':'application/json'}})}});const result=await readAgreementDocument(context());expect(result).toMatchObject({ok:false,reason});expect(JSON.stringify(result)).not.toContain('private provider data');
  });
  it.each(['html','oversized'])('withholds %s provider error contents',async variant=>{
    invoke.mockResolvedValue({data:null,error:{context:new Response(variant==='html'?'<html>private</html>':JSON.stringify({code:'source_changed',private:'x'.repeat(3000)}),{headers:{'Content-Type':variant==='html'?'text/html':'application/json'}})}});expect(await readAgreementDocument(context())).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('verifies actual retained PDF bytes before returning them in memory',async()=>{
    const bytes=Uint8Array.from(Buffer.from(fixture.bytes,'base64'));invoke.mockResolvedValue({data:new NativeBlob([bytes],{type:'application/pdf'}),error:null});const result=await readAgreementDocumentPdf(context(),retained());expect(result.ok).toBe(true);if(result.ok)expect(result.value).toEqual(bytes);expect(invoke.mock.calls[0][0]).toContain('preparation=pdf');
  });
  it.each(['corrupt','truncated','wrong_mime'])('refuses %s document bytes',async variant=>{
    let bytes=Uint8Array.from(Buffer.from(fixture.bytes,'base64'));if(variant==='corrupt')bytes[100]^=1;if(variant==='truncated')bytes=bytes.slice(0,-1);invoke.mockResolvedValue({data:new NativeBlob([bytes],{type:variant==='wrong_mime'?'text/plain':'application/pdf'}),error:null});expect(await readAgreementDocumentPdf(context(),retained())).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('pins history to the same actual actor token, original native RPC and bounded cursor',async()=>{
    const value={items:[],has_more:false};rpc.mockReturnValue({setHeader});setHeader.mockReturnValue({abortSignal});abortSignal.mockResolvedValue({data:value,error:null});expect(await listAgreementDocumentHistory(context(),4)).toEqual({ok:true,value});expect(rpc).toHaveBeenCalledWith('list_agreement_document_preparations',{_expected_tenant_id:fixture.source.tenant_id,_agreement_id:fixture.source.agreement_id,_limit:20,_before_revision:4});expect(setHeader).toHaveBeenCalledWith('Authorization','Bearer controlled-auth-token');expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
  it('rejects malformed scope and history cursor without any Auth or native operation',async()=>{
    expect(await readAgreementDocument({...context(),actorId:'missing'})).toMatchObject({ok:false,reason:'invalid_request'});expect(await listAgreementDocumentHistory(context(),0)).toMatchObject({ok:false,reason:'invalid_request'});expect(getSession).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();expect(invoke).not.toHaveBeenCalled();
  });
});


const senderId='d1111111-0000-4000-8000-000000000001';
const requestMarker='[[PAIGE_AGREEMENT_SIGNING_LINK]]';
async function readyRequestFixture(){
  const value=retained();const fields=fixture.signers.map((signer,index)=>({id:'f1111111-0000-4000-8000-00000000000'+(index+1),signer_id:signer.id,kind:'signature' as const,page:1,x:20,y:20+index*80,width:120,height:40,required:true,label:'Signature'}));
  const saved=await prepareAgreementFields(fixture.source,fixture.document,fields);
  value.preparation.manifest=structuredClone(saved.manifest);value.preparation.preparation_sha256=saved.preparation_sha256;
  const review=await signingReview(value),sender={connector_id:senderId,from_address:'hello@studio.example.test',state:'ready' as const,reason:null};
  const draft={operation_id:event,connector_id:senderId,messages:review.signers.map(s=>({signer_id:s.id,subject:'Review your agreement',body_text:'Please review before signing.\n'+requestMarker}))};
  expect(review.ready_for_review).toBe(true);
  return {review,sender,draft};
}
describe('complete request review through the original agreement SDK',()=>{
  it('reads closed sender choices using original caller authorization, never a primary-client lookup',async()=>{
    const {review}=await readyRequestFixture();
    invoke.mockResolvedValue({data:{ok:true,review:{kind:'prepared_signature_sender_choices',review_sha256:review.review_sha256,
      senders:[{connector_id:senderId,from_address:'hello@studio.example.test',state:'ready',reason:null}],provider_execution_verified:false,approval:'not_requested',execution:'unavailable'}},error:null});
    expect(documentSDK.readAgreementSigningSenders).toBeTypeOf('function');
    const result=await documentSDK.readAgreementSigningSenders(context(),event,review);
    expect(result).toMatchObject({ok:true,value:{senders:[{connector_id:senderId}]}});
    expect(invoke.mock.calls[0][0]).toBe('agreement-send?review=senders');
    expect(invoke.mock.calls[0][1]).toMatchObject({method:'POST',headers:{Authorization:'Bearer controlled-auth-token'},body:{operation_id:event,review:review.request,expected_review_sha256:review.review_sha256}});
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['changed_digest','executed','duplicate','foreign_field'])('withholds %s sender choices instead of treating them as ready',async variant=>{
    const {review,sender}=await readyRequestFixture();
    const response={kind:'prepared_signature_sender_choices',review_sha256:review.review_sha256,senders:[sender],provider_execution_verified:false,approval:'not_requested',execution:'unavailable'};
    if(variant==='changed_digest')response.review_sha256='0'.repeat(64);
    if(variant==='executed')Object.assign(response,{execution:'sent'});
    if(variant==='duplicate')response.senders.push(sender);
    if(variant==='foreign_field')Object.assign(response,{token:'forbidden'});
    invoke.mockResolvedValue({data:{ok:true,review:response},error:null});
    expect(documentSDK.readAgreementSigningSenders).toBeTypeOf('function');
    expect(await documentSDK.readAgreementSigningSenders(context(),event,review)).toMatchObject({ok:false,reason:'unconfirmed'});
  });
  it('keeps an unknown read distinct from a possibly executed action',async()=>{
    const {review}=await readyRequestFixture();invoke.mockRejectedValue(Error('private transport detail'));
    expect(documentSDK.readAgreementSigningSenders).toBeTypeOf('function');
    const result=await documentSDK.readAgreementSigningSenders(context(),event,review);
    expect(result).toMatchObject({ok:false,reason:'unconfirmed'});
    expect(JSON.stringify(result)).not.toMatch(/private transport|may.*recorded|already.*recorded/);
  });
  it('retires a late identity read after an actual business or role change',async()=>{
    const {review}=await readyRequestFixture(),work=held<{data:unknown;error:null}>();let active=true;invoke.mockReturnValue(work.promise);
    expect(documentSDK.readAgreementSigningSenders).toBeTypeOf('function');
    const waiting=documentSDK.readAgreementSigningSenders({...context(),isCurrent:()=>active},event,review);
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledOnce());active=false;work.resolve({data:{},error:null});
    expect(await waiting).toMatchObject({ok:false,reason:'retired'});
  });
});

async function requestWire(x:Awaited<ReturnType<typeof readyRequestFixture>>){
  const args={agreementId:x.review.request.agreement_id,expectedTenantId:x.review.request.tenant_id,operationId:x.draft.operation_id,
    preparationId:x.review.request.preparation_id,preparationSha256:x.review.request.preparation_sha256,reviewSha256:x.review.review_sha256,
    source:x.review.request.expected_source,title:x.review.title,document:x.review.document,recipients:x.review.signers,requestSchemaVersion:1,
    sender:{connector_id:senderId,provider:'sendgrid',from_address:x.sender.from_address,from_name:'Studio',reply_to:null},
    messages:x.review.signers.map(s=>{const m=x.draft.messages.find(m=>m.signer_id===s.id)!;return {...m,to:s.email,
      body_html:commsEmailBodyHtml(m.body_text)};})};
  return {kind:'prepared_signature_request_review',tool:'agreement_send',args,request_sha256:await sha256Hex(canonicalPresentationJson(args)),
    approval:'not_requested',execution:'unavailable'};
}
describe('originating signature approval and original return references',()=>{
 beforeEach(()=>invoke.mockReset());
 afterEach(()=>invoke.mockReset());
 const ref=(wire:Awaited<ReturnType<typeof requestWire>>)=>({operation_id:wire.args.operationId,request_sha256:wire.request_sha256});
 const nativeResult=(wire:Awaited<ReturnType<typeof requestWire>>)=>({kind:'prepared_signature_request_result',state:'provider_accepted',tenant_id:fixture.source.tenant_id,
  actor_id:actor,operation_id:wire.args.operationId,request_sha256:wire.request_sha256,agreement_id:fixture.source.agreement_id,work_id:request,receipt_id:event});
 it('submits the whole checked content to the original HIGH door without inventing approval',async()=>{
  const x=await readyRequestFixture(),wire=await requestWire(x),proposal={state:'approval_required',capability:'agreement_send',fingerprint:'a'.repeat(16),operation_id:wire.args.operationId,request_sha256:wire.request_sha256,summary:'Review the exact agreement and invitations.',expires_at:'2026-12-01T12:00:00Z'};
  invoke.mockResolvedValue({data:{ok:true,result:proposal},error:null});
  expect(documentSDK.submitAgreementSignatureRequest).toBeTypeOf('function');
  expect(await documentSDK.submitAgreementSignatureRequest(context(),wire)).toEqual({ok:true,value:proposal});
  expect(invoke).toHaveBeenCalledOnce();expect(invoke.mock.calls[0][0]).toBe('agreement-send?command=prepared-request');
  expect(invoke.mock.calls[0][1]).toMatchObject({method:'POST',headers:{Authorization:'Bearer controlled-auth-token'},body:{operation_id:wire.args.operationId,review:x.review.request,
   expected_review_sha256:x.review.review_sha256,expected_request_sha256:wire.request_sha256,connector_id:senderId,messages:x.draft.messages}});
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty('approved_fingerprint');expect(rpc).not.toHaveBeenCalled();
 });
 it.each(['missing_receipt','foreign_actor','foreign_operation','changed_digest','delivery'])('withholds %s apparent execution success',async variant=>{
  const x=await readyRequestFixture(),wire=await requestWire(x),result=nativeResult(wire);
  if(variant==='missing_receipt')Object.assign(result,{receipt_id:null});if(variant==='foreign_actor')result.actor_id=request;
  if(variant==='foreign_operation')result.operation_id=request;if(variant==='changed_digest')result.request_sha256='0'.repeat(64);if(variant==='delivery')result.state='delivered';
  invoke.mockResolvedValue({data:{ok:true,result},error:null});expect(documentSDK.submitAgreementSignatureRequest).toBeTypeOf('function');
  expect(await documentSDK.submitAgreementSignatureRequest(context(),wire,'a'.repeat(16))).toMatchObject({ok:false,reason:'unconfirmed'});
 });
 it('retains the exact approval fingerprint and original receipt, and never retries an uncertain send',async()=>{
  const x=await readyRequestFixture(),wire=await requestWire(x);invoke.mockResolvedValueOnce({data:{ok:true,result:nativeResult(wire)},error:null});
  expect(documentSDK.submitAgreementSignatureRequest).toBeTypeOf('function');
  expect(await documentSDK.submitAgreementSignatureRequest(context(),wire,'a'.repeat(16))).toMatchObject({ok:true,value:{state:'provider_accepted',receipt_id:event}});
  expect(invoke.mock.calls[0][1].body.approved_fingerprint).toBe('a'.repeat(16));invoke.mockReset();invoke.mockRejectedValue(Error('Controlled transport interruption'));
  const failed=await documentSDK.submitAgreementSignatureRequest(context(),wire,'a'.repeat(16));expect(failed).toMatchObject({ok:false,reason:'unconfirmed'});
  if(failed.ok===false)expect(failed.message).toMatch(/original request/i);expect(invoke).toHaveBeenCalledOnce();
 });
 it('reads the original native result from only its opaque return reference',async()=>{
  const x=await readyRequestFixture(),wire=await requestWire(x),result=nativeResult(wire);invoke.mockResolvedValue({data:{ok:true,result},error:null});
  expect(documentSDK.readAgreementSignatureRecovery).toBeTypeOf('function');expect(await documentSDK.readAgreementSignatureRecovery(context(),ref(wire))).toEqual({ok:true,value:result});
  expect(invoke.mock.calls[0][0]).toBe('agreement-send?review=request-recovery');expect(invoke.mock.calls[0][1].body).toEqual({tenant_id:fixture.source.tenant_id,agreement_id:fixture.source.agreement_id,operation_id:wire.args.operationId,expected_request_sha256:wire.request_sha256});
 });
 it('restores only the source-checked original draft for another deliberate review',async()=>{
  const x=await readyRequestFixture(),wire=await requestWire(x),command={operation_id:wire.args.operationId,review:x.review.request,expected_review_sha256:x.review.review_sha256,
   connector_id:senderId,messages:x.draft.messages,expected_request_sha256:wire.request_sha256};
  invoke.mockResolvedValue({data:{ok:true,result:{kind:'prepared_signature_request_review_recovery',state:'review_available',...ref(wire),command,review:wire}},error:null});
  expect(documentSDK.readAgreementSignatureRecovery).toBeTypeOf('function');
  expect(await documentSDK.readAgreementSignatureRecovery(context(),ref(wire))).toMatchObject({ok:true,value:{state:'review_available',command}});
  expect(invoke).toHaveBeenCalledOnce();
  command.messages[0].body_text+=' changed';expect(await documentSDK.readAgreementSignatureRecovery(context(),ref(wire))).toMatchObject({ok:false,reason:'unconfirmed'});
 });
 it('keeps consumed and expired approval states separate from actual sending and never renews them',async()=>{
  const x=await readyRequestFixture(),wire=await requestWire(x);expect(documentSDK.readAgreementSignatureRecovery).toBeTypeOf('function');
  for(const reason of ['consumed','expired','unverified']){const result={kind:'prepared_signature_request_review_recovery',state:'review_unavailable',...ref(wire),reason};
   invoke.mockResolvedValue({data:{ok:true,result},error:null});expect(await documentSDK.readAgreementSignatureRecovery(context(),ref(wire))).toEqual({ok:true,value:result});}
  invoke.mockResolvedValue({data:{ok:true,result:null},error:null});expect(await documentSDK.readAgreementSignatureRecovery(context(),ref(wire))).toEqual({ok:true,value:null});
  expect(invoke.mock.calls.every(([name])=>name==='agreement-send?review=request-recovery')).toBe(true);
 });
 it('rejects a forged checked digest before dispatch and retires a late original-history response',async()=>{
  const x=await readyRequestFixture(),wire=await requestWire(x);expect(documentSDK.submitAgreementSignatureRequest).toBeTypeOf('function');expect(documentSDK.readAgreementSignatureRecovery).toBeTypeOf('function');
  expect(await documentSDK.submitAgreementSignatureRequest(context(),{...wire,request_sha256:'0'.repeat(64)})).toMatchObject({ok:false,reason:'invalid_request'});expect(invoke).not.toHaveBeenCalled();
  const pending=held<{data:unknown;error:null}>();let active=true;invoke.mockReturnValue(pending.promise);
  const reading=documentSDK.readAgreementSignatureRecovery({...context(),isCurrent:()=>active},ref(wire));await vi.waitFor(()=>expect(invoke).toHaveBeenCalledOnce());active=false;
  pending.resolve({data:{ok:true,result:nativeResult(wire)},error:null});expect(await reading).toMatchObject({ok:false,reason:'retired'});
 });
});
it('reads the complete exact request through the original SDK without claiming approval or execution',async()=>{
  const x=await readyRequestFixture(),wire=await requestWire(x);invoke.mockResolvedValue({data:{ok:true,review:wire},error:null});
  expect(documentSDK.readAgreementSignatureRequest).toBeTypeOf('function');
  expect(await documentSDK.readAgreementSignatureRequest(context(),x.review,x.sender,x.draft)).toEqual({ok:true,value:wire});
  expect(invoke.mock.calls[0][0]).toBe('agreement-send?review=prepared-request');
  expect(invoke.mock.calls[0][1].body.messages).toEqual(x.draft.messages);
  expect(rpc).not.toHaveBeenCalled();
});
it.each(['subject','recipient','document','source','digest','approval','unknown','sender'] as const)('withholds a changed %s complete-request response',async variant=>{
  const x=await readyRequestFixture(),wire=await requestWire(x);
  if(variant==='subject')wire.args.messages[0].subject='Different wording';
  if(variant==='recipient')wire.args.messages[0].to='other@example.test';
  if(variant==='document')wire.args.document={...wire.args.document,sha256:'0'.repeat(64)};
  if(variant==='source')wire.args.source={...wire.args.source,version:2};
  if(variant==='digest')wire.request_sha256='0'.repeat(64);
  if(variant==='approval')wire.approval='approved';
  if(variant==='unknown')Object.assign(wire,{token:'forbidden'});
  if(variant==='sender')wire.args.sender.from_address='other@example.test';
  invoke.mockResolvedValue({data:{ok:true,review:wire},error:null});
  expect(documentSDK.readAgreementSignatureRequest).toBeTypeOf('function');
  expect(await documentSDK.readAgreementSignatureRequest(context(),x.review,x.sender,x.draft)).toMatchObject({ok:false,reason:'unconfirmed'});
});
