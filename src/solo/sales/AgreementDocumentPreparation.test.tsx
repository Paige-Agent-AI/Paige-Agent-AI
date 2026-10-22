import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import fixture from './fixtures/agreement-document-source.json';
import {prepareAgreementFields} from '../../../supabase/functions/_shared/agreements/field-preparation';
import type {AgreementDocumentView} from './agreementDocumentApi';
import type {AssignedField} from './agreementDocumentModel';
import {useSalesDraftExit} from '../sales-dialog';
const ports=vi.hoisted(()=>({read:vi.fn(),pdf:vi.fn(),save:vi.fn(),history:vi.fn(),retained:vi.fn(),return:vi.fn(),refused:vi.fn(),checkpoints:[] as string[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('./agreementDocumentApi',async original=>({...await original<typeof import('./agreementDocumentApi')>(),readAgreementDocument:ports.read,readAgreementDocumentPdf:ports.pdf,saveAgreementDocument:ports.save,listAgreementDocumentHistory:ports.history}));
vi.mock('./AgreementDocumentFields',()=>({AgreementDocumentFields:(props:{canEdit:boolean;source:unknown;document:unknown;fields:AssignedField[];onChange:(fields:AssignedField[])=>void;onSave:(value:Awaited<ReturnType<typeof prepareAgreementFields>>)=>void})=><div data-field-inspector data-editable={props.canEdit}>
  <span>{props.fields.length} proposed fields</span><button disabled={!props.canEdit} onClick={()=>props.onChange([...props.fields,{id:'f1111111-0000-4000-8000-000000000001',signer_id:fixture.signers[0].id,kind:'signature',page:1,x:20,y:20,width:120,height:40,required:true,label:'Signature'}])}>Place controlled field</button>
  <button disabled={!props.canEdit} onClick={()=>{void prepareAgreementFields(props.source,props.document,props.fields).then(props.onSave);}}>Save controlled fields</button></div>}));
import {AgreementDocumentPreparation,type DocumentGuard} from './AgreementDocumentPreparation';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor='b1111111-0000-4000-8000-000000000001',request='b2222222-0000-4000-8000-000000000002',event='f2222222-0000-4000-8000-000000000002';
let root:Root,host:HTMLDivElement,current=true,record:Extract<AgreementDocumentView,{state:'retained'}>;
const empty=():AgreementDocumentView=>({state:'none',title:'Controlled agreement',source:structuredClone(fixture.source) as AgreementDocumentView['source'],can_prepare:true,preparation_hold:null,document_signers:[]});
const good=(view:AgreementDocumentView)=>({ok:true,value:view});
const absent=()=>({ok:false,reason:'unconfirmed',message:'Original request is not confirmed.'});
function Harness({requestId=null,resume={draft:[],busy:false,uncertain:false}}:{requestId?:string|null;resume?:DocumentGuard}){
  const [guard,setGuard]=React.useState<DocumentGuard>(resume);const exit=useSalesDraftExit(guard.draft,guard.busy,ports.return,{uncertain:guard.uncertain});
  const adoptBaseline=exit.adoptBaseline;
  React.useLayoutEffect(()=>{adoptBaseline([]);},[adoptBaseline]);
  return <><AgreementDocumentPreparation tenantId={fixture.source.tenant_id} actorId={actor} agreementId={fixture.source.agreement_id} requestId={requestId} authorityKey="controlled" isCurrent={()=>current&&exit.alive.current}
    resume={guard} onGuard={(next,baseline)=>{setGuard(next);if(baseline)exit.adoptBaseline(baseline);}}
    onRetainRequest={id=>{if(!ports.retained(id))return false;ports.checkpoints.push(id??'');return true;}}
    onRequest={exit.request} onReturn={ports.return} onAddSigners={vi.fn()} onAccessRefused={ports.refused}/>{exit.confirmation}</>;
}
async function mount(requestId:string|null=null,resume?:DocumentGuard){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<Harness requestId={requestId} resume={resume}/>));}
function button(name:string){const found=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name);if(!found)throw Error('Expected '+name);return found;}
async function click(name:string){await act(async()=>button(name).click());}
beforeEach(async()=>{vi.stubGlobal('crypto',webcrypto);vi.clearAllMocks();ports.checkpoints.length=0;current=true;ports.retained.mockReturnValue(true);ports.pdf.mockResolvedValue({ok:true,value:Uint8Array.from(Buffer.from(fixture.bytes,'base64'))});
  const prepared=await prepareAgreementFields(fixture.source,fixture.document,[]);record={...empty(),state:'retained',can_edit:true,document_signers:structuredClone(fixture.signers) as AgreementDocumentView['document_signers'],preparation:{id:request,agreement_id:fixture.source.agreement_id,client_id:fixture.source.client_id,revision_no:1,source_version:1,source_updated_at:fixture.source.updated_at,actor_user_id:actor,document_sha256:fixture.document.sha256,document_byte_length:fixture.document.byte_length,manifest:structuredClone(prepared.manifest),preparation_sha256:prepared.preparation_sha256,event_id:event,is_selected:true,created_at:fixture.source.updated_at,source_scope:'agreement_and_parties',source_matches:true,commercial_verification:'not_applicable'}};
});
afterEach(()=>{act(()=>root?.unmount());host?.remove();vi.unstubAllGlobals();});
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
