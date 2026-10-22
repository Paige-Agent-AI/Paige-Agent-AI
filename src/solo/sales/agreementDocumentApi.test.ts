import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {Blob as NativeBlob} from 'node:buffer';
import fixture from './fixtures/agreement-document-source.json';
import {prepareAgreementFields,type AgreementFieldPreparation} from '../../../supabase/functions/_shared/agreements/field-preparation';
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
