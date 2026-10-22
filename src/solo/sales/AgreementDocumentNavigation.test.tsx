import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const tenant='aaaaaaaa-0000-4000-8000-000000000001',actor='bbbbbbbb-0000-4000-8000-000000000001',client='cccccccc-0000-4000-8000-000000000001',agreement='dddddddd-0000-4000-8000-000000000001',request='eeeeeeee-0000-4000-8000-000000000001';
const ports=vi.hoisted(()=>({read:vi.fn(),refresh:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn()}}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>({activeTenantId:'aaaaaaaa-0000-4000-8000-000000000001',activeUserId:'bbbbbbbb-0000-4000-8000-000000000001',accountContextStatus:'ready'})}));
vi.mock('./agreementPreparationApi',()=>({readAgreementPreparation:ports.read,createAgreementDraft:vi.fn(),recoverAgreementCreation:vi.fn()}));
vi.mock('./AgreementDocumentPreparation',()=>({AgreementDocumentPreparation:(props:{onRetainRequest:(id:string)=>boolean;onGuard:(value:{draft:never[];busy:boolean;uncertain:boolean})=>void;onRequest:(action:()=>void)=>void;onReturn:()=>void;onAccessRefused:()=>void})=><div data-document-pane>
  <button onClick={()=>{if(!props.onRetainRequest(request))throw Error('Expected exact checkpoint');props.onGuard({draft:[],busy:false,uncertain:true});}}>Controlled lost request</button>
  <button onClick={()=>props.onRequest(props.onReturn)}>Return from controlled document</button><button onClick={props.onAccessRefused}>Controlled access refusal</button></div>}));
import {AgreementPreparationWorkspace} from './AgreementPreparationWorkspace';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
function Harness(){const [reference,setReference]=React.useState<string|null>(null);return <AgreementPreparationWorkspace tenantId={tenant} canManage authorizationReady authorityUnknown={false} clients={[]} clientsReady clientsReadable agreementId={agreement} requestId={null} requestTenantId={reference?tenant:null} freshlyOpened={false} documentRequestId={reference}
  onDocumentRequestRetained={id=>{const target=`?agreement=${agreement}`+(id?`&agreement_document_request=${id}&agreement_business=${tenant}`:'');return {url:target,replace:()=>{history.replaceState(null,'',target);setReference(id);}};}}
  onDraftAttempted={()=>{}} onOpenRecord={()=>{}} onClose={()=>{}} signings={{signingEvents:vi.fn().mockResolvedValue({ok:true,events:[],truncated:false}),signedCopyUrl:vi.fn()}} onRefresh={ports.refresh}/>;}
async function click(name:string){const button=[...host.querySelectorAll<HTMLButtonElement>('button')].find(value=>value.textContent?.trim()===name);if(!button)throw Error('Expected '+name);await act(async()=>button.click());}
beforeEach(async()=>{vi.clearAllMocks();ports.read.mockResolvedValue({ok:true,value:{agreement:{id:agreement,contact_id:client,offer_id:null,commercial_terms_id:null,title:'Controlled original agreement',body_source:'paige_draft',source_version_id:null,body_markdown:'Controlled source wording.',has_source_document:false,status:'draft',version:1,updated_at:'2026-10-22T14:00:00Z',expires_at:null,can_edit:true,content_sha256:null,sealed_sha256:null},signers:[]}});history.replaceState(null,'',`/solo/alpha/sales/agreements?agreement=${agreement}`);host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<Harness/>));});
afterEach(()=>{act(()=>root?.unmount());host.remove();history.replaceState(null,'','/');});
it('can leave an unconfirmed document for its agreement while keeping its recovery reference, without automatically reopening it',async()=>{
  await click('Prepare document and fields');await click('Controlled lost request');await click('Return from controlled document');expect(host.querySelectorAll('[role=alertdialog]')).toHaveLength(1);await click('Leave and check later');expect(host.querySelector('[data-document-pane]')).toBeNull();expect(location.search).toContain(request);expect(host.textContent).toContain('Recorded wording');
});
it('a document access refusal never creates an automatic reopen and refresh loop',async()=>{
  await click('Prepare document and fields');await click('Controlled lost request');await click('Controlled access refusal');expect(host.querySelector('[data-document-pane]')).toBeNull();expect(ports.refresh).toHaveBeenCalledOnce();
});
