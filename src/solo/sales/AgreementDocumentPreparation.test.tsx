import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import fixture from './fixtures/agreement-document-source.json';
import {prepareAgreementFields} from '../../../supabase/functions/_shared/agreements/field-preparation';
import {prepareCommercialPresentation,commercialPresentationText} from '../../../supabase/functions/_shared/agreements/commercial-presentation';
import {assembleFixedRepaymentSchedule} from '../../../supabase/functions/_shared/sales-collections/model';
import type {AgreementDocumentView,AgreementDocumentCommand,AgreementCommercialReview,AgreementSignatureReference} from './agreementDocumentApi';
import {sha256Hex} from '../../../supabase/functions/_shared/agreements/token';
import {projectPreparedSignatureReview} from '../../../supabase/functions/_shared/agreements/prepared-signature-review-contract';
import type {AssignedField} from './agreementDocumentModel';
import {useSalesDraftExit} from '../sales-dialog';
const ports=vi.hoisted(()=>({read:vi.fn(),pdf:vi.fn(),save:vi.fn(),history:vi.fn(),sources:vi.fn(),review:vi.fn(),signing:vi.fn(),senders:vi.fn(),requestReview:vi.fn(),submit:vi.fn(),recovery:vi.fn(),signatureRetained:vi.fn(),retained:vi.fn(),return:vi.fn(),refused:vi.fn(),checkpoints:[] as string[],fieldWork:null as Promise<unknown>|null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('./agreementDocumentApi',async original=>({...await original<typeof import('./agreementDocumentApi')>(),readAgreementDocument:ports.read,readAgreementDocumentPdf:ports.pdf,saveAgreementDocument:ports.save,listAgreementDocumentHistory:ports.history,readAgreementCommercialSources:ports.sources,readAgreementCommercialReview:ports.review,readAgreementSigningReview:ports.signing,readAgreementSigningSenders:ports.senders,readAgreementSignatureRequest:ports.requestReview,submitAgreementSignatureRequest:ports.submit,readAgreementSignatureRecovery:ports.recovery}));
vi.mock('./AgreementDocumentFields',()=>({AgreementDocumentFields:(props:{canEdit:boolean;lockedReason?:string;source:unknown;document:unknown;bytes:Uint8Array;fields:AssignedField[];savedPreparationSha:string;onChange:(fields:AssignedField[])=>void;onSave:(value:Awaited<ReturnType<typeof prepareAgreementFields>>)=>void})=><div data-field-inspector data-editable={props.canEdit} data-saved-fields-sha={props.savedPreparationSha}><p>{props.lockedReason}</p>
  <span data-displayed-byte-length>{props.bytes.length}</span><span>{props.fields.length} proposed fields</span><button disabled={!props.canEdit} onClick={()=>props.onChange([...props.fields,{id:'f1111111-0000-4000-8000-000000000001',signer_id:fixture.signers[0].id,kind:'signature',page:1,x:20,y:20,width:120,height:40,required:true,label:'Signature'}])}>Place controlled field</button>
  <button disabled={!props.canEdit} onClick={()=>{ports.fieldWork=prepareAgreementFields(props.source,props.document,props.fields).then(props.onSave);}}>Save controlled fields</button></div>}));
import {AgreementDocumentPreparation,type DocumentGuard} from './AgreementDocumentPreparation';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor='b1111111-0000-4000-8000-000000000001',request='b2222222-0000-4000-8000-000000000002',event='f2222222-0000-4000-8000-000000000002';
let root:Root,host:HTMLDivElement,current=true,record:Extract<AgreementDocumentView,{state:'retained'}>;
const empty=():AgreementDocumentView=>({state:'none',title:'Controlled agreement',source:structuredClone(fixture.source) as AgreementDocumentView['source'],can_prepare:true,preparation_hold:null,document_signers:[]});
const good=<T,>(view:T)=>({ok:true,value:view});
const absent=()=>({ok:false,reason:'unconfirmed',message:'Original request is not confirmed.'});
async function writeReply(command:AgreementDocumentCommand,source=record.source,document=record.preparation.manifest.document){
  const prepared=await prepareAgreementFields(source,document,command.action==='retain_fields'?command.fields:[]),next=structuredClone(record);
  next.source=structuredClone(source);next.preparation={...next.preparation,id:command.request_id,revision_no:2,event_id:crypto.randomUUID(),source_version:source.version,source_updated_at:source.updated_at,manifest:prepared.manifest,preparation_sha256:prepared.preparation_sha256,document_sha256:document.sha256,document_byte_length:document.byte_length};
  return {ok:true,value:{view:next,receipt:{state:'recorded',historical_receipt:true,id:next.preparation.id,event_id:next.preparation.event_id,revision_no:2,document_sha256:document.sha256,preparation_sha256:prepared.preparation_sha256,is_selected:true}}};
}
function Harness({requestId=null,resume={draft:[],busy:false,uncertain:false},signatureReference=null}:{requestId?:string|null;resume?:DocumentGuard;signatureReference?:AgreementSignatureReference|null}){
  const [guard,setGuard]=React.useState<DocumentGuard>(resume),[signature,setSignature]=React.useState(signatureReference);const exit=useSalesDraftExit({fields:guard.draft,invitations:guard.signatureDraft??null},guard.busy,ports.return,{uncertain:guard.uncertain,uncertainKind:guard.signatureUncertain?'signature_request':undefined});
  const adoptBaseline=exit.adoptBaseline;
  React.useLayoutEffect(()=>{adoptBaseline([]);},[adoptBaseline]);
  return <><AgreementDocumentPreparation tenantId={fixture.source.tenant_id} actorId={actor} agreementId={fixture.source.agreement_id} requestId={requestId} authorityKey="controlled" isCurrent={()=>current&&exit.alive.current}
    resume={guard} onGuard={(next,baseline)=>{setGuard(next);if(baseline)exit.adoptBaseline({fields:baseline,invitations:next.signatureDraft??null});}}
    onRetainRequest={id=>{if(!ports.retained(id))return false;ports.checkpoints.push(id??'');return true;}} signatureReference={signature} onRetainSignatureRequest={reference=>{if(ports.signatureRetained(reference)!==true)return false;setSignature(reference);return true;}}
    onRequest={exit.request} onReturn={ports.return} onAddSigners={vi.fn()} onAccessRefused={ports.refused}/>{exit.confirmation}</>;
}
async function mount(requestId:string|null=null,resume?:DocumentGuard,signatureReference?:AgreementSignatureReference){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<Harness requestId={requestId} resume={resume} signatureReference={signatureReference}/>));}
function button(name:string){const found=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name);if(!found)throw Error('Expected '+name);return found;}
async function click(name:string){await act(async()=>button(name).click());}
beforeEach(async()=>{vi.stubGlobal('crypto',webcrypto);vi.clearAllMocks();ports.checkpoints.length=0;ports.fieldWork=null;current=true;ports.retained.mockReturnValue(true);ports.pdf.mockResolvedValue({ok:true,value:Uint8Array.from(Buffer.from(fixture.bytes,'base64'))});
  const prepared=await prepareAgreementFields(fixture.source,fixture.document,[]);record={...empty(),state:'retained',can_edit:true,document_signers:structuredClone(fixture.signers) as AgreementDocumentView['document_signers'],preparation:{id:request,agreement_id:fixture.source.agreement_id,client_id:fixture.source.client_id,revision_no:1,source_version:1,source_updated_at:fixture.source.updated_at,actor_user_id:actor,document_sha256:fixture.document.sha256,document_byte_length:fixture.document.byte_length,manifest:structuredClone(prepared.manifest),preparation_sha256:prepared.preparation_sha256,event_id:event,is_selected:true,created_at:fixture.source.updated_at,source_scope:'agreement_and_parties',source_matches:true,commercial_verification:'not_applicable'}};
});
afterEach(()=>{act(()=>root?.unmount());host?.remove();vi.unstubAllGlobals();});
const invoice='77777777-0000-4000-8000-000000000001';
const held=():AgreementDocumentView=>({...empty(),can_prepare:false,preparation_hold:'commercial_review_required'});
const choices=()=>({ok:true,value:{tenant_id:fixture.source.tenant_id,agreement_id:fixture.source.agreement_id,items:[{invoice_id:invoice,invoice_number:'DRAFT-TEST',total_minor:350000,currency:'usd'}],has_more:false,next_cursor:null}});
async function terms():Promise<AgreementCommercialReview>{
  const s=fixture.source,schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-22',installment_cents:30000,first_installment_date:'2026-11-22',cadence:'monthly'});
  if(schedule.state!=='ready')throw Error('Canonical schedule expected');
  const treatment={state:'not_applicable',charges:[],source:'Synthetic owner decision',policy:'No applicable charge recorded'};
  const input={schema_version:2,engagement:{starts_on:'2026-10-22',ends_on:null,price_basis:'negotiated'},source:{tenant_id:s.tenant_id,client_id:s.client_id,agreement_id:s.agreement_id,agreement_version:s.version,agreement_updated_at:s.updated_at,offer_id:'55555555-0000-4000-8000-000000000001',body_source:'paige_draft',status:'draft',content_sha256:null,terms_id:'66666666-0000-4000-8000-000000000001',terms_version:1,terms_updated_at:s.updated_at,invoice_id:invoice,invoice_version:1,invoice_draft_version:1,invoice_updated_at:s.updated_at},title:'Controlled agreement',body_markdown:'Neutral commercial source.',principal_minor:350000,currency:'usd',collection_terms:schedule.terms,conditions:{schema_version:1,tax:treatment,fees:treatment},lines:[{unit_minor:350000,quantity:1}]};
  const presentation=await prepareCommercialPresentation(input);return {state:'ready',invoice_id:invoice,presentation,payload_digest:presentation.payload_digest,presented_body_markdown:commercialPresentationText(input.body_markdown,presentation)};
}
async function selectInvoice(value=invoice){await act(async()=>{const control=host.querySelector<HTMLSelectElement>('select[aria-label="Agreement invoice"]');expect(control).not.toBeNull();control!.value=value;control!.dispatchEvent(new Event('change',{bubbles:true}));});}
it('requires an explicit invoice choice and canonical review before any commercial preparation write',async()=>{
  const review=await terms();ports.read.mockResolvedValue(good(held()));ports.sources.mockResolvedValue(choices());ports.review.mockResolvedValue({ok:true,value:review});ports.save.mockResolvedValue(absent());await mount();
  expect(ports.sources).toHaveBeenCalledOnce();expect(ports.review).not.toHaveBeenCalled();expect(ports.save).not.toHaveBeenCalled();expect(button('Review recorded terms').disabled).toBe(true);
  await selectInvoice();await click('Review recorded terms');expect(ports.review.mock.calls[0][1]).toBe(invoice);expect(host.textContent).toContain('Neutral commercial source.');expect(document.activeElement).toBe(host.querySelector('[data-commercial-review-heading]'));
  await click('Prepare exact PDF');const command=ports.save.mock.calls[0][1];expect(command).toMatchObject({action:'prepare_commercial_document',invoice_id:invoice,commercial_payload_digest:review.state==='ready'?review.payload_digest:'',expected_current_id:null});expect(ports.checkpoints).toEqual([command.request_id]);expect(host.textContent).toContain('Check the same preparation');await click('Retry same request');expect(ports.save.mock.calls[1][1]).toBe(command);expect(host.textContent).not.toContain('Review recorded terms');
});
it('keeps missing original facts correctable without generating document words or a write',async()=>{
  ports.read.mockResolvedValue(good(held()));ports.sources.mockResolvedValue(choices());ports.review.mockResolvedValue({ok:true,value:{state:'needs_input',fields:['Installment due dates']}});await mount();await selectInvoice();await click('Review recorded terms');expect(host.textContent).toContain('Installment due dates');expect(host.textContent).toContain('Complete the original terms');expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Prepare exact PDF')).toBe(false);expect(ports.save).not.toHaveBeenCalled();
});
it('discards the prior invoice review when another invoice is chosen and ignores its late read',async()=>{
  let release!:(value:unknown)=>void;const review=await terms(),second='77777777-0000-4000-8000-000000000002',page=choices();page.value.items.push({...page.value.items[0],invoice_id:second,invoice_number:'DRAFT-SECOND'});
  ports.read.mockResolvedValue(good(held()));ports.sources.mockResolvedValue(page);ports.review.mockReturnValue(new Promise(done=>{release=done;}));await mount();await selectInvoice();await click('Review recorded terms');await selectInvoice(second);await act(async()=>release({ok:true,value:review}));expect(host.textContent).not.toContain('Neutral commercial source.');expect(ports.save).not.toHaveBeenCalled();expect(button('Review recorded terms').disabled).toBe(false);
});
it('handles empty choices and read failures with a read-only retry',async()=>{
  ports.read.mockResolvedValue(good(held()));ports.sources.mockResolvedValueOnce({ok:false,reason:'unconfirmed',message:'Connection unavailable.'}).mockResolvedValueOnce({...choices(),value:{...choices().value,items:[]}});await mount();expect(host.textContent).toContain('Connection unavailable.');await click('Retry invoice choices');expect(host.textContent).toContain('No linked invoice was returned');expect(ports.save).not.toHaveBeenCalled();expect(ports.review).not.toHaveBeenCalled();
});
it('clears the commercial surface on native access refusal and suppresses a late retired read',async()=>{
  ports.read.mockResolvedValue(good(held()));ports.sources.mockResolvedValue({ok:false,reason:'access_unverified',message:'Access changed.'});await mount();expect(ports.refused).toHaveBeenCalledOnce();expect(host.querySelector('[data-commercial-review]')).toBeNull();expect(ports.save).not.toHaveBeenCalled();
});
it('compares unchanged commercial fields with the original field digest, preserving the full native digest',async()=>{
  record.preparation.derived_fields_sha256='a'.repeat(64);record.preparation.preparation_sha256='b'.repeat(64);ports.read.mockResolvedValue(good(record));await mount();expect(host.querySelector('[data-field-inspector]')?.getAttribute('data-saved-fields-sha')).toBe('a'.repeat(64));expect(record.preparation.preparation_sha256).toBe('b'.repeat(64));
});
it('lets a conclusively refused source request return through a fresh review without retrying stale intent',async()=>{
  ports.read.mockResolvedValue(good(held()));ports.sources.mockResolvedValue(choices());ports.review.mockResolvedValue({ok:true,value:await terms()});ports.save.mockResolvedValue({ok:false,reason:'source_changed',message:'The original terms changed.'});await mount();await selectInvoice();await click('Review recorded terms');await click('Prepare exact PDF');
  expect(host.textContent).toContain('Preparation was refused');expect(host.textContent).not.toContain('Check the same preparation');expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Retry same request')).toBe(false);
  await click('Read current agreement source');expect(ports.read).toHaveBeenCalledTimes(2);expect(ports.read.mock.calls[1][1]).toBeNull();expect(ports.checkpoints.at(-1)).toBe('');expect(ports.save).toHaveBeenCalledOnce();expect(button('Review recorded terms').disabled).toBe(true);
});
it('gives the reviewed document the workspace instead of repeating its source chooser',async()=>{
  ports.read.mockResolvedValue(good(held()));ports.sources.mockResolvedValue(choices());ports.review.mockResolvedValue({ok:true,value:await terms()});await mount();await selectInvoice();await click('Review recorded terms');expect(host.querySelector('select[aria-label="Agreement invoice"]')).toBeNull();expect(host.textContent).not.toContain('Review the recorded terms');await click('Choose another invoice');expect(host.querySelector('select[aria-label="Agreement invoice"]')).not.toBeNull();expect(button('Review recorded terms').disabled).toBe(true);
});
it('does no write on entry and retains a recovery reference before the first real SDK command',async()=>{
  ports.read.mockResolvedValue(good(empty()));ports.save.mockImplementation(async(_ctx,command)=>{expect(ports.checkpoints).toEqual([command.request_id]);return absent();});await mount();expect(ports.save).not.toHaveBeenCalled();await click('Prepare exact PDF');expect(ports.save).toHaveBeenCalledOnce();expect(host.textContent).toContain('Check the same preparation');expect(host.textContent).not.toContain('Document preparation recorded.');
});
it('refuses dispatch when the original navigation checkpoint cannot be retained',async()=>{
  ports.read.mockResolvedValue(good(empty()));ports.retained.mockReturnValue(false);await mount();await click('Prepare exact PDF');expect(ports.save).not.toHaveBeenCalled();expect(host.textContent).toContain('No preparation request was sent.');
});
it('moves keyboard focus to the verified document result after the old save control is replaced',async()=>{
  ports.read.mockResolvedValue(good(empty()));ports.save.mockImplementation(async(_ctx,command)=>{
    const next=structuredClone(record);next.preparation.id=command.request_id;
    return {ok:true,value:{view:next,receipt:{state:'recorded',historical_receipt:true,id:command.request_id,event_id:event,revision_no:1,document_sha256:fixture.document.sha256,preparation_sha256:next.preparation.preparation_sha256,is_selected:true}}};
  });await mount();act(()=>button('Prepare exact PDF').focus());await click('Prepare exact PDF');expect(document.activeElement).toBe(host.querySelector('.e04-native-preparation-heading h3'));expect(host.textContent).toContain('Document preparation recorded.');
});
it('an interrupted request retries the identical frozen command and cannot start a fresh identity',async()=>{
  ports.read.mockResolvedValue(good(empty()));ports.save.mockResolvedValue(absent());await mount();await click('Prepare exact PDF');const first=ports.save.mock.calls[0][1];expect(Object.isFrozen(first)).toBe(true);await click('Retry same request');expect(ports.save.mock.calls[1][1]).toBe(first);expect(ports.checkpoints).toEqual([first.request_id,first.request_id]);expect(host.textContent).not.toContain('Prepare exact PDF');
});
it('reload with an opaque request only reads that request and never recreates work',async()=>{
  ports.read.mockResolvedValue(good(record));await mount(request);expect(ports.read.mock.calls[0][1]).toBe(request);expect(ports.save).not.toHaveBeenCalled();expect(ports.pdf).toHaveBeenCalledOnce();expect(host.textContent).toContain('Preparation 1');expect(host.textContent).toContain('0 proposed fields');
});
it('checkpoints an explicitly opened existing selected document so reload returns to that same version',async()=>{
  ports.read.mockResolvedValue(good(record));await mount();expect(ports.retained).toHaveBeenCalledWith(request);expect(ports.checkpoints).toEqual([request]);expect(ports.save).not.toHaveBeenCalled();expect(host.textContent).toContain('Preparation 1');
});
it('uses the ONE parent leave guard and preserves fields after canceling an exit',async()=>{
  ports.read.mockResolvedValue(good(record));await mount();await click('Place controlled field');const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);await click('Return to agreement');expect(host.querySelectorAll('[role=alertdialog]')).toHaveLength(1);await click('Continue editing');expect(host.textContent).toContain('1 proposed fields');expect(ports.return).not.toHaveBeenCalled();
});
it('holds historical preparations read-only without relabeling their signers',async()=>{
  record.preparation.is_selected=false;record.preparation.source_matches=false;record.document_signers=[];record.can_edit=false;ports.read.mockResolvedValue(good(record));await mount(request);expect(host.querySelector('[data-field-inspector]')?.getAttribute('data-editable')).toBe('false');expect(button('Place controlled field').disabled).toBe(true);expect(host.textContent).toContain('Earlier version');expect(ports.save).not.toHaveBeenCalled();
});
it('preserves an unsaved same-document proposal through a fresh authority read',async()=>{
  const draft:AssignedField[]=[{id:event,signer_id:fixture.signers[0].id,kind:'text',page:1,x:20,y:20,width:120,height:30,required:true,label:'Provided detail'}];ports.read.mockResolvedValue(good(record));await mount(null,{draft,busy:false,uncertain:false,preparationId:request});expect(ports.read.mock.calls[0][1]).toBe(request);expect(host.textContent).toContain('1 proposed fields');expect(host.textContent).toContain('Your unsaved field proposal is still here.');const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
});
it('keeps unsaved-field exit protection active WHILE an authority recheck is still pending',async()=>{
  const draft:AssignedField[]=[{id:event,signer_id:fixture.signers[0].id,kind:'text',page:1,x:20,y:20,width:120,height:30,required:true,label:'Unsaved provided detail'}];
  ports.read.mockReturnValue(new Promise(()=>{}));await mount(null,{draft,busy:false,uncertain:false,preparationId:request});
  const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);expect(ports.save).not.toHaveBeenCalled();
});
it('never unlocks fields after a corrupt or unavailable PDF read',async()=>{
  ports.read.mockResolvedValue(good(record));ports.pdf.mockResolvedValue(absent());await mount();expect(host.querySelector('[data-field-inspector]')).toBeNull();expect(host.textContent).toContain('Retained PDF unavailable');expect(ports.save).not.toHaveBeenCalled();
});
it('retires held metadata after authority changes and cannot publish it later',async()=>{
  let release!:(value:unknown)=>void;ports.read.mockReturnValue(new Promise(done=>{release=done;}));await mount();current=false;await act(async()=>release(good(record)));expect(host.querySelector('[data-field-inspector]')).toBeNull();expect(ports.pdf).not.toHaveBeenCalled();
});
it('an explicit native authorization refusal clears the document and returns to the parent access state',async()=>{
  ports.read.mockResolvedValue({ok:false,reason:'access_unverified',message:'Access changed.'});await mount();expect(ports.refused).toHaveBeenCalledOnce();expect(host.querySelector('[data-field-inspector]')).toBeNull();expect(ports.pdf).not.toHaveBeenCalled();
});
it('a late earlier-PDF retry cannot overwrite the newly retained document bytes',async()=>{
  const old=structuredClone(record);old.source.version=2;old.source.updated_at='2026-10-22T14:01:00.123456+00:00';old.preparation.source_matches=false;old.can_edit=false;old.document_signers=[];
  const originalBytes=Uint8Array.from(Buffer.from(fixture.bytes,'base64')),newBytes=new Uint8Array([...originalBytes,10]);const document={...fixture.document,byte_length:newBytes.length,sha256:await sha256Hex(newBytes)} as typeof record.preparation.manifest.document;
  let release!:(value:unknown)=>void;ports.read.mockResolvedValue(good(old));ports.pdf.mockResolvedValueOnce(absent()).mockReturnValueOnce(new Promise(done=>{release=done;})).mockResolvedValueOnce({ok:true,value:newBytes});ports.save.mockImplementation((_ctx,command)=>writeReply(command,old.source,document));
  await mount();await click('Retry retained PDF');await act(async()=>{button('Prepare current agreement version').click();expect(ports.save).toHaveBeenCalledOnce();await ports.save.mock.results[0].value;});expect(host.querySelector('[data-displayed-byte-length]')?.textContent).toBe(String(newBytes.length));
  await act(async()=>release({ok:true,value:originalBytes}));expect(host.querySelector('[data-displayed-byte-length]')?.textContent).toBe(String(newBytes.length));
});
it('an earlier history read cannot republish stale selection after a new preparation is retained',async()=>{
  let release!:(value:unknown)=>void;ports.read.mockResolvedValue(good(record));ports.history.mockReturnValue(new Promise(done=>{release=done;}));ports.save.mockImplementation((_ctx,command)=>writeReply(command));await mount();await click('Place controlled field');await click('Inspect preparation history');await act(async()=>{button('Save controlled fields').click();await ports.fieldWork;expect(ports.save).toHaveBeenCalledOnce();await ports.save.mock.results[0].value;});expect(host.textContent).toContain('Preparation 2');
  const p=record.preparation;await act(async()=>release({ok:true,value:{items:[{id:p.id,revision_no:p.revision_no,source_version:p.source_version,created_at:p.created_at,is_selected:true,document_sha256:p.document_sha256,preparation_sha256:p.preparation_sha256,event_id:p.event_id,actor_user_id:p.actor_user_id}],has_more:false}}));
  expect(host.querySelector('select[aria-label="Retained document version"]')).toBeNull();
});

async function savedReview(){const s=record.source,p=record.preparation;return projectPreparedSignatureReview({tenant_id:s.tenant_id,agreement_id:s.agreement_id,preparation_id:p.id,preparation_sha256:p.preparation_sha256,
  expected_source:{client_id:s.client_id,version:s.version,updated_at:s.updated_at}},record);}
it('reviews the saved source in the original pane, reports missing fields and returns focus without an approval or send',async()=>{
  ports.read.mockResolvedValue(good(record));ports.signing.mockResolvedValue({ok:true,value:await savedReview()});await mount();await click('Review saved signing request');
  expect(ports.signing).toHaveBeenCalledOnce();expect(ports.signing.mock.calls[0][1]).toEqual(record);expect(host.textContent).toContain('Field corrections needed');
  expect(host.textContent).toContain('Controlled Client needs a required signature field');expect(host.textContent).toContain('Approval and sending are not connected');
  expect(host.querySelector('[data-field-inspector]')?.getAttribute('data-editable')).toBe('false');expect(document.activeElement?.textContent).toBe('Review signing request');
  expect(ports.save).not.toHaveBeenCalled();await click('Back to document');expect(document.activeElement).toBe(button('Review saved signing request'));expect(host.querySelector('[data-field-inspector]')?.getAttribute('data-editable')).toBe('true');
});
it('requires unsaved field edits to be saved before reviewing the old saved map',async()=>{
  ports.read.mockResolvedValue(good(record));await mount();await click('Place controlled field');expect(button('Review saved signing request').disabled).toBe(true);expect(host.textContent).toContain('Save your field changes');
  await click('Review saved signing request');expect(ports.signing).not.toHaveBeenCalled();expect(ports.save).not.toHaveBeenCalled();
});
it('does not offer signing review while the original save outcome is uncertain',async()=>{
  ports.read.mockResolvedValue(good(record));ports.save.mockResolvedValue(absent());await mount();await click('Place controlled field');await act(async()=>{button('Save controlled fields').click();await ports.fieldWork;});
  expect(host.textContent).toContain('Check the same preparation');expect(host.textContent).not.toContain('Review saved signing request');expect(ports.signing).not.toHaveBeenCalled();
});
it('retries an unknown read against the same saved source without executing a preparation',async()=>{
  ports.read.mockResolvedValue(good(record));ports.signing.mockResolvedValueOnce({ok:false,reason:'unconfirmed',message:'The saved review could not be confirmed.'}).mockResolvedValueOnce({ok:true,value:await savedReview()});
  await mount();await click('Review saved signing request');expect(host.textContent).toContain('Review unavailable');await click('Retry saved review');
  expect(ports.signing).toHaveBeenCalledTimes(2);expect(ports.signing.mock.calls[0][1]).toEqual(ports.signing.mock.calls[1][1]);expect(host.textContent).toContain('Field corrections needed');expect(ports.save).not.toHaveBeenCalled();
});
it('requires explicit source read after source change instead of silently approving different saved work',async()=>{
  ports.read.mockResolvedValue(good(record));ports.signing.mockResolvedValue({ok:false,reason:'source_changed',message:'The saved source changed.'});await mount();await click('Review saved signing request');
  expect(ports.read).toHaveBeenCalledOnce();expect(host.textContent).toContain('Read current document source');await click('Read current document source');expect(ports.read).toHaveBeenCalledTimes(2);expect(host.querySelector('[aria-label="Saved signing request review"]')).toBeNull();expect(ports.save).not.toHaveBeenCalled();
});
it('retires private document and review data through the original parent when review authority is refused',async()=>{
  ports.read.mockResolvedValue(good(record));ports.signing.mockResolvedValue({ok:false,reason:'access_unverified',message:'Access unavailable.'});await mount();await click('Review saved signing request');
  expect(ports.refused).toHaveBeenCalledOnce();expect(host.querySelector('[data-field-inspector]')).toBeNull();expect(host.querySelector('[aria-label="Saved signing request review"]')).toBeNull();expect(host.textContent).not.toContain('Controlled Client');
});
it('does not reopen a canceled read when its late source response arrives',async()=>{
  let release!:(value:unknown)=>void;ports.read.mockResolvedValue(good(record));ports.signing.mockReturnValue(new Promise(done=>{release=done;}));await mount();await click('Review saved signing request');
  expect(host.textContent).toContain('Checking the saved document');await click('Back to document');await act(async()=>release({ok:true,value:await savedReview()}));expect(host.querySelector('[aria-label="Saved signing request review"]')).toBeNull();expect(document.activeElement).toBe(button('Review saved signing request'));expect(ports.save).not.toHaveBeenCalled();
});


const choiceId='e1111111-0000-4000-8000-000000000001';
async function openInvitations(){
  const fields=fixture.signers.map((signer,index)=>({id:'f1111111-0000-4000-8000-00000000000'+(index+1),signer_id:signer.id,kind:'signature' as const,page:1,x:20,y:20+index*80,width:120,height:40,required:true,label:'Signature'}));
  const prepared=await prepareAgreementFields(fixture.source,fixture.document,fields);
  record.preparation.manifest=structuredClone(prepared.manifest);record.preparation.preparation_sha256=prepared.preparation_sha256;
  const review=await savedReview();expect(review.ready_for_review).toBe(true);
  ports.read.mockResolvedValue(good(record));ports.signing.mockResolvedValue(good(review));
  ports.senders.mockResolvedValue(good({kind:'prepared_signature_sender_choices',review_sha256:review.review_sha256,
    senders:[{connector_id:choiceId,from_address:'hello@studio.example.test',state:'ready',reason:null}],
    provider_execution_verified:false,approval:'not_requested',execution:'unavailable'}));
  await mount();await click('Review saved signing request');return review;
}
function setControl(control:Element,value:string){const prototype=control instanceof HTMLSelectElement?HTMLSelectElement.prototype:control instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(control,value);control.dispatchEvent(new Event(control instanceof HTMLSelectElement?'change':'input',{bubbles:true}));}
async function chooseSender(){
  const select=host.querySelector<HTMLSelectElement>('select[aria-label="Send from"]');
  expect(select).not.toBeNull();await act(async()=>setControl(select!,choiceId));
}
it('prepares per-signer messages inside the original saved review and protects them with the ONE parent guard',async()=>{
  await openInvitations();expect(button('Check complete request').disabled).toBe(true);await chooseSender();
  const input=host.querySelector('textarea[aria-label="Invitation message"]')!;
  await act(async()=>setControl(input,'A corrected invitation for the client.'));
  const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
  await click('Back to document');expect(host.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);await click('Continue editing');
  expect((host.querySelector('textarea[aria-label="Invitation message"]') as HTMLTextAreaElement).value).toBe('A corrected invitation for the client.');
  expect(ports.save).not.toHaveBeenCalled();expect(ports.requestReview).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('[[PAIGE_AGREEMENT_SIGNING_LINK]]');
});
it('keeps invitation edits through an unavailable identity read and distinguishes a genuinely empty retry',async()=>{
  await openInvitations();await chooseSender();ports.senders.mockResolvedValueOnce({ok:false,reason:'sender_choices_unverified',message:'Email identities could not be checked.'})
    .mockResolvedValueOnce(good({senders:[]}));await click('Refresh email identities');expect(host.textContent).toContain('Email identities could not be checked.');
  await click('Retry email identities');expect(host.textContent).toContain('No usable business email was returned');expect(button('Check complete request').disabled).toBe(true);
  expect(ports.requestReview).not.toHaveBeenCalled();expect(ports.save).not.toHaveBeenCalled();
});
it('stops a pending check without losing invitations and ignores its late response',async()=>{
  await openInvitations();await chooseSender();let release!:(v:unknown)=>void;ports.requestReview.mockReturnValue(new Promise(done=>{release=done;}));
  await click('Check complete request');expect(host.textContent).toContain('Checking complete request');await click('Stop waiting');
  await act(async()=>release(good({args:{sender:{from_address:'private@unexpected.test'}}})));
  expect(host.textContent).not.toContain('private@unexpected.test');expect(host.textContent).not.toContain('Request checked · not sent');
  expect(button('Check complete request').disabled).toBe(false);expect(ports.save).not.toHaveBeenCalled();
});
it('retires private invitations and the document when actual request-review access is refused',async()=>{
  await openInvitations();await chooseSender();ports.requestReview.mockResolvedValue({ok:false,reason:'access_unverified',message:'Access changed.'});
  await click('Check complete request');expect(ports.refused).toHaveBeenCalledOnce();expect(host.textContent).not.toContain('Controlled Client');
  expect(host.querySelector('[aria-label="Signature invitation preparation"]')).toBeNull();expect(ports.save).not.toHaveBeenCalled();
});

it('shows the actual complete checked request, restores focus and keeps approval and sending distinct',async()=>{
  const review=await openInvitations();await chooseSender();
  ports.requestReview.mockImplementation(async(_ctx,_review,sender,draft)=>good({
    kind:'prepared_signature_request_review',tool:'agreement_send',approval:'not_requested',execution:'unavailable',request_sha256:'a'.repeat(64),
    args:{agreementId:review.request.agreement_id,expectedTenantId:review.request.tenant_id,operationId:draft.operation_id,
      preparationId:review.request.preparation_id,preparationSha256:review.request.preparation_sha256,reviewSha256:review.review_sha256,
      source:review.request.expected_source,title:review.title,document:review.document,recipients:review.signers,requestSchemaVersion:1,
      sender:{connector_id:sender.connector_id,provider:'sendgrid',from_address:sender.from_address,from_name:'Controlled Studio',reply_to:null},
      messages:draft.messages.map((m:{signer_id:string;subject:string;body_text:string})=>({...m,to:review.signers.find(s=>s.id===m.signer_id)!.email,body_html:'unused in this view'}))}}));
  await click('Check complete request');expect(host.textContent).toContain('Request checked · not sent');
  expect(document.activeElement?.textContent).toContain('Request checked · not sent');
  expect(host.textContent).toContain('Controlled Client');expect(host.textContent).toContain('Controlled Business Signer');
  expect(host.textContent).toContain('Approval, sending, delivery and signatures have not occurred.');
  expect(host.textContent).not.toContain('[[PAIGE_AGREEMENT_SIGNING_LINK]]');
  await click('Edit invitations');expect(host.textContent).not.toContain('Request checked · not sent');
  expect(document.activeElement).toBe(host.querySelector('input[aria-label="Invitation subject"]'));
  expect(ports.save).not.toHaveBeenCalled();expect(ports.requestReview).toHaveBeenCalledOnce();
});
it('keeps separate client and business messages when the active recipient changes',async()=>{
  await openInvitations();await chooseSender();
  await act(async()=>setControl(host.querySelector('textarea[aria-label="Invitation message"]')!,'Client invitation with requested details.'));
  await act(async()=>setControl(host.querySelector('select[aria-label="Invitation recipient"]')!,fixture.signers[1].id));
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Please review the agreement before signing.');
  await act(async()=>setControl(host.querySelector('textarea')!,'Business signer invitation.'));
  await act(async()=>setControl(host.querySelector('select[aria-label="Invitation recipient"]')!,fixture.signers[0].id));
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Client invitation with requested details.');
});

async function checkedInvitations(){
  const review=await openInvitations();await chooseSender();ports.signatureRetained.mockReturnValue(true);
  ports.requestReview.mockImplementation(async(_ctx,_review,sender,draft)=>good({kind:'prepared_signature_request_review',tool:'agreement_send',approval:'not_requested',execution:'unavailable',request_sha256:'a'.repeat(64),args:{
    agreementId:review.request.agreement_id,expectedTenantId:review.request.tenant_id,operationId:draft.operation_id,preparationId:review.request.preparation_id,
    preparationSha256:review.request.preparation_sha256,reviewSha256:review.review_sha256,source:review.request.expected_source,title:review.title,document:review.document,recipients:review.signers,requestSchemaVersion:1,
    sender:{connector_id:sender.connector_id,provider:'sendgrid',from_address:sender.from_address,from_name:'Controlled Studio',reply_to:null},
    messages:draft.messages.map((m:{signer_id:string;subject:string;body_text:string})=>({...m,to:review.signers.find(s=>s.id===m.signer_id)!.email,body_html:'unused in this view'}))}}));
  ports.submit.mockImplementation(async(_ctx,wire,approved)=>good(approved?{kind:'prepared_signature_request_result',state:'provider_accepted',tenant_id:fixture.source.tenant_id,actor_id:actor,
    operation_id:wire.args.operationId,request_sha256:wire.request_sha256,agreement_id:fixture.source.agreement_id,work_id:request,receipt_id:event}:
    {state:'approval_required',capability:'agreement_send',fingerprint:'b'.repeat(16),operation_id:wire.args.operationId,request_sha256:wire.request_sha256,summary:'Review these exact invitations.',expires_at:'2099-12-01T12:00:00Z'}));
  await click('Check complete request');return review;
}
it('requires a retained return reference and deliberate canonical approval before sending',async()=>{
  await checkedInvitations();expect(ports.submit).not.toHaveBeenCalled();ports.signatureRetained.mockReturnValue(false);
  await click('Prepare approval');expect(ports.submit).not.toHaveBeenCalled();expect(host.textContent).toContain('return reference');
  ports.signatureRetained.mockReturnValue(true);await click('Prepare approval');expect(ports.submit).toHaveBeenCalledOnce();
  expect(ports.submit.mock.calls[0][2]).toBeUndefined();expect(ports.signatureRetained).toHaveBeenCalledWith({operation_id:ports.submit.mock.calls[0][1].args.operationId,request_sha256:'a'.repeat(64)});
  expect(host.textContent).toContain('Review before sending');expect(host.textContent).not.toContain('Signature completed');
  await click('Approve and send signing requests');expect(ports.submit).toHaveBeenCalledTimes(2);expect(ports.submit.mock.calls[1][2]).toBe('b'.repeat(16));
  expect(host.textContent).toContain('Email provider accepted the requests');expect(host.textContent).toContain('does not confirm delivery');expect(host.textContent).toContain(event);
});
it('keeps an interrupted approved attempt guarded and reads the original receipt without another send',async()=>{
  await checkedInvitations();await click('Prepare approval');ports.submit.mockResolvedValueOnce({ok:false,reason:'unconfirmed',message:'Check the original request.'});
  await click('Approve and send signing requests');expect(host.textContent).toContain('Verification pending');
  const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
  const wire=ports.submit.mock.calls[0][1];ports.recovery.mockResolvedValue(good({kind:'prepared_signature_request_result',state:'provider_partial',tenant_id:fixture.source.tenant_id,actor_id:actor,
    operation_id:wire.args.operationId,request_sha256:wire.request_sha256,agreement_id:fixture.source.agreement_id,work_id:request,receipt_id:event}));
  await click('Check original request');expect(ports.submit).toHaveBeenCalledTimes(2);expect(ports.recovery).toHaveBeenCalledOnce();expect(host.textContent).toContain('Some requests were accepted');
  expect([...host.querySelectorAll('button')].some(b=>b.textContent?.includes('Approve and send'))).toBe(false);
});

it('keeps history available for a noneditable signed-request source without opening another approval',async()=>{
  record.can_edit=false;record.can_prepare=false;record.source.status='sent';ports.read.mockResolvedValue(good(record));
  const reference={operation_id:request,request_sha256:'a'.repeat(64)};
  ports.recovery.mockResolvedValue(good({kind:'prepared_signature_request_result',state:'provider_accepted',tenant_id:fixture.source.tenant_id,actor_id:actor,
    ...reference,agreement_id:fixture.source.agreement_id,work_id:request,receipt_id:event}));
  await mount(null,undefined,reference);expect(host.textContent).toContain('Email provider accepted the requests');expect(host.textContent).toContain(event);
  expect(ports.recovery.mock.calls[0][1]).toEqual(reference);expect(ports.submit).not.toHaveBeenCalled();expect(ports.signing).not.toHaveBeenCalled();
  expect(host.querySelector('[data-field-inspector]')?.getAttribute('data-editable')).toBe('false');
});
it('returns keyboard focus to original history when an uncertain request disables a fresh review',async()=>{
  await checkedInvitations();await click('Prepare approval');ports.submit.mockResolvedValueOnce({ok:false,reason:'unconfirmed',message:'Check the original request.'});await click('Approve and send signing requests');
  const wire=ports.submit.mock.calls[0][1];ports.recovery.mockResolvedValue(good({kind:'prepared_signature_request_result',state:'outcome_unknown',tenant_id:fixture.source.tenant_id,actor_id:actor,
    operation_id:wire.args.operationId,request_sha256:wire.request_sha256,agreement_id:fixture.source.agreement_id,work_id:request,receipt_id:null}));
  await click('Back to document');expect(host.querySelectorAll('[role=alertdialog]')).toHaveLength(1);expect(host.textContent).toContain('Leaving does not cancel the signing request.');
  await click('Leave and check later');expect(document.activeElement?.textContent).toBe('Original signing request');expect(button('Review saved signing request').disabled).toBe(true);
  expect(host.textContent).toContain('The original request needs verification');expect(ports.recovery).toHaveBeenCalledOnce();expect(ports.submit).toHaveBeenCalledTimes(2);
});
it('cannot double-dispatch a batched approval click',async()=>{
  await checkedInvitations();await click('Prepare approval');
  await act(async()=>{button('Approve and send signing requests').click();button('Approve and send signing requests').click();});expect(ports.submit).toHaveBeenCalledTimes(2);
});
it('shows a genuine expired review without issuing another approval or automatic action',async()=>{
  await checkedInvitations();ports.submit.mockImplementationOnce(async(_ctx,wire)=>good({state:'approval_required',capability:'agreement_send',fingerprint:'b'.repeat(16),
    operation_id:wire.args.operationId,request_sha256:wire.request_sha256,summary:'Original expired review.',expires_at:'2000-01-01T00:00:00Z'}));
  await click('Prepare approval');expect(host.textContent).toContain('This approval review expired');expect(button('Approve and send signing requests').disabled).toBe(true);
  expect(ports.submit).toHaveBeenCalledOnce();expect(ports.recovery).not.toHaveBeenCalled();
});

it('unlocks a fresh review only after the original native reader confirms expiry',async()=>{
  await checkedInvitations();ports.submit.mockImplementationOnce(async(_ctx,wire)=>good({state:'approval_required',capability:'agreement_send',fingerprint:'b'.repeat(16),
    operation_id:wire.args.operationId,request_sha256:wire.request_sha256,summary:'Original expired review.',expires_at:'2000-01-01T00:00:00Z'}));
  await click('Prepare approval');const wire=ports.submit.mock.calls[0][1];ports.recovery.mockResolvedValue(good({kind:'prepared_signature_request_review_recovery',state:'review_unavailable',reason:'expired',operation_id:wire.args.operationId,request_sha256:wire.request_sha256}));
  await click('Check original request');expect(host.textContent).toContain('Approval review expired');expect(button('Edit invitations').disabled).toBe(false);
  await click('Edit invitations');expect(host.textContent).not.toContain('Review before sending');expect(ports.submit).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(host.querySelector('input[aria-label="Invitation subject"]'));
  await click('Check complete request');expect(ports.requestReview.mock.calls.at(-1)![3].operation_id).not.toBe(wire.args.operationId);expect(ports.submit).toHaveBeenCalledOnce();
});

it('checks a distinct operation after leaving an issued review to refresh the sending identity',async()=>{
  await checkedInvitations();await click('Prepare approval');const original=ports.submit.mock.calls[0][1].args.operationId;
  await click('Refresh email identities');await click('Check complete request');
  expect(ports.requestReview.mock.calls.at(-1)![3].operation_id).not.toBe(original);expect(ports.submit).toHaveBeenCalledOnce();
});

it('shows an actual canonical refusal without claiming a send or automatic retry',async()=>{
  await checkedInvitations();ports.submit.mockResolvedValueOnce(good({state:'refused',code:'CAPABILITY_UNAVAILABLE'}));
  await click('Prepare approval');expect(host.textContent).toContain('Request refused');expect(host.textContent).not.toContain('Email provider accepted');
  expect(ports.submit).toHaveBeenCalledOnce();expect(ports.recovery).not.toHaveBeenCalled();
});

it('retires private signing content when current canonical authority is withdrawn during preparation',async()=>{
  await checkedInvitations();ports.submit.mockResolvedValueOnce(good({state:'refused',code:'ACCESS_UNVERIFIED'}));
  await click('Prepare approval');expect(ports.refused).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain('client@example.test');expect(host.textContent).not.toContain('Review before sending');
  expect(host.textContent).toContain('Original document unavailable');expect(document.activeElement?.textContent).toBe('Signing document');
  expect(ports.submit).toHaveBeenCalledOnce();expect(ports.recovery).not.toHaveBeenCalled();
});
