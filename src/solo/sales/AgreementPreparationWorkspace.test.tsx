import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgreementPreparation } from './agreementPreparationApi';
const fixtures = vi.hoisted(() => ({ context: {} as Record<string, unknown>, read: vi.fn(), recover: vi.fn(), create: vi.fn(), history: vi.fn(), template:vi.fn(), correct: vi.fn(), saveSigner:vi.fn(), recoverSigner:vi.fn() }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => fixtures.context }));
vi.mock('./agreementPreparationApi', () => ({ readAgreementPreparation: fixtures.read, recoverAgreementCreation: fixtures.recover, createAgreementDraft: fixtures.create }));
vi.mock('./agreementTemplateApi',()=>({readAgreementTemplate:fixtures.template}));
vi.mock('./agreementRevisionApi', () => ({ readAgreementRevisions: fixtures.history, readAgreementRetainedWording: vi.fn() }));
vi.mock('./agreementCorrectionApi', async importOriginal => ({...await importOriginal<typeof import('./agreementCorrectionApi')>(),saveAgreementCorrection:fixtures.correct}));
vi.mock('./agreementSignerApi',async importOriginal=>({...await importOriginal<typeof import('./agreementSignerApi')>(),saveAgreementSigner:fixtures.saveSigner,recoverAgreementSigner:fixtures.recoverSigner}));
// Flow tests exercise real scope/receipt/leave state. The actual rich editor is
// verified by the separate framework-native browser drive, not this textarea.
vi.mock('./AgreementBodyEditor', () => ({ AgreementBodyEditor: ({ value, onChange, readOnly }: { value: string; onChange: (value: string) => void; readOnly: boolean }) => <label>Agreement content<textarea value={value} readOnly={readOnly} onChange={event => onChange(event.target.value)} /></label> }));
import { AgreementPreparationWorkspace } from './AgreementPreparationWorkspace';

// Use the repository's native React DOM test idiom; no extra test runtime.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
function render(element: React.ReactNode) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(element));
  return { rerender: (next: React.ReactNode) => act(() => root.render(next)) };
}
const matches = (actual: string, expected: string | RegExp) => typeof expected === 'string' ? actual.trim() === expected : expected.test(actual);
function text(expected: string | RegExp) {
  return [...document.body.querySelectorAll<HTMLElement>('*')].find(node => matches(node.textContent ?? '', expected) && ![...node.children].some(child => matches(child.textContent ?? '', expected))) ?? null;
}
function required<T>(value: T | null): T { if (!value) throw new Error('Expected visible test element'); return value; }
function label(expected: string) {
  return [...document.querySelectorAll('label')].find(node => [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim() === expected)?.control ?? null;
}
function role(expected: string, name?: string) {
  const selector = expected === 'button' ? 'button' : `[role="${expected}"]`;
  return [...document.querySelectorAll<HTMLElement>(selector)].find(node => !name || matches(node.getAttribute('aria-label') ?? node.textContent ?? '', name)) ?? null;
}
async function waitFor<T>(assertion: () => T): Promise<T> {
  const deadline = Date.now() + 1500;
  while (true) {
    try { return assertion(); } catch (error) {
      if (Date.now() >= deadline) throw error;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  }
}
const screen = {
  getByLabelText: (name: string, _options?: unknown) => required(label(name)),
  queryByLabelText: (name: string) => label(name),
  getByRole: (name: string, options?: { name?: string }) => required(role(name, options?.name)),
  findByRole: (name: string, options?: { name?: string }) => waitFor(() => required(role(name, options?.name))),
  getByText: (name: string | RegExp) => required(text(name)),
  queryByText: (name: string | RegExp) => text(name),
  findByText: (name: string | RegExp) => waitFor(() => required(text(name))),
};
const fireEvent = {
  click: (node: HTMLElement) => act(() => node.click()),
  change: (node: HTMLElement, event: { target: { value: string } }) => act(() => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, event.target.value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }),
};

const tenant = 'aaaaaaaa-0000-4000-8000-000000000001', other = 'aaaaaaaa-0000-4000-8000-000000000002';
const user = 'bbbbbbbb-0000-4000-8000-000000000001', client = 'cccccccc-0000-4000-8000-000000000001';
const id = 'dddddddd-0000-4000-8000-000000000001', request = 'eeeeeeee-0000-4000-8000-000000000001';
function original(): AgreementPreparation {
  return { agreement: { id, contact_id: client, offer_id: null, commercial_terms_id: null, title: 'Synthetic retained agreement', body_source: 'paige_draft', source_version_id: null, body_markdown: 'Original retained wording.', has_source_document: false, status: 'draft', version: 1, updated_at: '2026-10-21T20:00:00Z', expires_at: null, can_edit: true, content_sha256: null, sealed_sha256: null }, signers: [] };
}
const receipt = () => ({ state: 'created', signing_id: id, signature_state: 'draft', version: 1, updated_at: '2026-10-21T20:00:00Z', creation_event_id: 'ffffffff-0000-4000-8000-000000000001' });
function props() {
  return { tenantId: tenant, canManage: true, authorityUnknown: false, authorizationReady: true,
    clients: [{ id: client, name: 'Sample Client' }], clientsReady: true, clientsReadable: true,
    agreementId: 'new', requestId: request, requestTenantId: tenant, freshlyOpened: true, onDraftAttempted: vi.fn(),
    onOpenRecord: vi.fn(), onClose: vi.fn(), onOpenClients: vi.fn(), onRefresh: vi.fn(),
    signings: { signingEvents: vi.fn(async () => ({ ok: true, events: [], truncated: false } as const)), signedCopyUrl: vi.fn(async () => ({ ok: false, message: 'Synthetic unavailable copy' } as const)) } };
}
const fill = () => {
  fireEvent.change(screen.getByLabelText('Client', { exact: true }), { target: { value: client } });
  fireEvent.change(screen.getByLabelText('Agreement title'), { target: { value: 'New private wording' } });
  fireEvent.change(screen.getByLabelText('Agreement content'), { target: { value: 'Private draft body in RAM.' } });
};
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save agreement draft' }));
beforeEach(() => {
  fixtures.context = { accountContextStatus: 'ready', activeUserId: user, activeTenantId: tenant };
  fixtures.read.mockReset().mockResolvedValue({ ok: true, value: original() });
  fixtures.recover.mockReset().mockResolvedValue({ ok: true, value: { state: 'unconfirmed' } });
  fixtures.create.mockReset().mockResolvedValue({ ok: true, value: receipt() });
  fixtures.correct.mockReset().mockResolvedValue({ok:false,reason:'unconfirmed',message:'Synthetic lost response.'});
  fixtures.saveSigner.mockReset().mockResolvedValue({ok:false,reason:'unconfirmed',message:'Synthetic lost signer response.'});
  fixtures.recoverSigner.mockReset().mockResolvedValue({ok:true,value:{state:'unconfirmed'}});
  fixtures.template.mockReset().mockResolvedValue({ok:true,value:{id:'99999999-0000-4000-8000-000000000001',title:'Supplied template wording',body_markdown:'Original supplied template words.\n',version:2,preparation_purpose:'client_engagement',is_active:true,has_uploaded_source:false,source_mode:'tenant_fork',preparation_options:{jurisdiction:'Business jurisdiction',review_route:'qualified_legal',reviewer:'Designated team'}}});
  fixtures.history.mockReset().mockResolvedValue({ ok: true, value: { agreement_id: id, current_source_version: 1, current_updated_at: '2026-10-21T20:00:00Z', revisions: [], truncated: false, next_before_revision_no: null } });
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers(); });

describe('checked original signer preparation flow',()=>{
  const signerId='99999999-0000-4000-8000-000000000001';
  const signerReceipt=(sid=signerId)=>({schema_version:1,state:'recorded',agreement_id:id,client_id:client,signer_id:sid,full_name:'Sample Recipient',email:'recipient@example.test',signer_role:'counterparty',signing_order:1,status:'pending',source_version:2,source_updated_at:'2026-10-21T20:01:00.123456+00:00',event_id:'88888888-0000-4000-8000-000000000001'});
  async function openSigner(){
    const p={...props(),agreementId:id,requestId:null,freshlyOpened:false,onSignerRequestRetained:vi.fn()};
    const mounted=render(<AgreementPreparationWorkspace {...p}/>);
    await screen.findByText('Original retained wording.');fireEvent.click(screen.getByRole('button',{name:'Add signer'}));
    await screen.findByText('Prepare signers');return {...mounted,p};
  }
  const fillSigner=()=>{
    fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Sample Recipient'}});
    fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'recipient@example.test'}});
  };
  const submitSigner=()=>fireEvent.click(screen.getByRole('button',{name:'Save signer'}));
  it('opens the original ordered roster and focuses the first required field without writing',async()=>{
    await openSigner();expect(document.activeElement).toBe(screen.getByLabelText('Full name'));expect(fixtures.saveSigner).not.toHaveBeenCalled();expect(fixtures.recoverSigner).not.toHaveBeenCalled();
    const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(false);expect(document.querySelectorAll('[aria-label="Agreement history and files"]')).toHaveLength(0);
  });
  it('focuses invalid name/email/position and never sends incomplete details',async()=>{
    await openSigner();submitSigner();expect(document.activeElement).toBe(screen.getByLabelText('Full name'));
    fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Sample Recipient'}});submitSigner();expect(document.activeElement).toBe(screen.getByLabelText('Email address'));
    fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'recipient@example.test'}});fireEvent.change(screen.getByLabelText('Signing position'),{target:{value:'1.5'}});submitSigner();expect(document.activeElement).toBe(screen.getByLabelText('Signing position'));expect(fixtures.saveSigner).not.toHaveBeenCalled();
  });
  it('uses the exact source, stable request and original native receipt before reading current signer status',async()=>{
    const {p}=await openSigner();fillSigner();
    fixtures.saveSigner.mockImplementation(async command=>({ok:true,value:signerReceipt(command.signerId)}));
    const current=original();current.agreement.version=2;current.signers=[{id:signerId,full_name:'Sample Recipient',email:'recipient@example.test',signer_role:'counterparty',signing_order:1,status:'signed',signed_at:'2026-10-21T20:03:00Z',declined_at:null}];fixtures.read.mockResolvedValue({ok:true,value:current});
    submitSigner();await screen.findByText(/Signer preparation acknowledged/);expect(fixtures.saveSigner.mock.calls[0][0]).toMatchObject({agreementId:id,clientId:client,expectedVersion:1,expectedUpdatedAt:'2026-10-21T20:00:00Z',fullName:'Sample Recipient',email:'recipient@example.test',order:null});
    const request=fixtures.saveSigner.mock.calls[0][0].signerId;expect(p.onSignerRequestRetained.mock.calls).toEqual([[request],[null]]);expect(fixtures.read).toHaveBeenCalledTimes(2);expect(document.body.textContent).toContain('Signature recorded');expect(document.body.textContent).toContain('Current signing status is shown separately below.');expect(fixtures.create).not.toHaveBeenCalled();expect(document.activeElement).toBe(screen.getByRole('button',{name:'Add signer'}));
  });
  it('suppresses repeated save events while the original write is pending',async()=>{
    await openSigner();fillSigner();let resolve!:(value:unknown)=>void;fixtures.saveSigner.mockReturnValueOnce(new Promise(done=>{resolve=done;}));const button=screen.getByRole('button',{name:'Save signer'});act(()=>{button.click();button.click();});expect(fixtures.saveSigner).toHaveBeenCalledTimes(1);expect(screen.queryByText('Save signer')).toBeNull();await act(async()=>resolve({ok:false,reason:'unconfirmed',message:'Lost response'}));await screen.findByText('Check original signer request');
  });
  it('does not write if the original opaque recovery location cannot be retained',async()=>{
    const {p,rerender}=await openSigner();fillSigner();const replace=vi.fn();rerender(<AgreementPreparationWorkspace {...p} onSignerRequestRetained={()=>({url:'https://outside.example.test/private',replace})}/>);submitSigner();await screen.findByText(/recovery reference could not be retained/);expect(fixtures.saveSigner).not.toHaveBeenCalled();expect(replace).not.toHaveBeenCalled();expect((screen.getByLabelText('Full name') as HTMLInputElement).readOnly).toBe(false);
  });
  it('locks an uncertain command and retries the identical source/identity without a replacement request',async()=>{
    const {p}=await openSigner();fillSigner();submitSigner();await screen.findByText('Check original signer request');
    expect((screen.getByLabelText('Full name') as HTMLInputElement).readOnly).toBe(true);fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Injected different intent'}});
    fireEvent.click(screen.getByRole('button',{name:'Retry same signer request'}));await waitFor(()=>expect(fixtures.saveSigner).toHaveBeenCalledTimes(2));expect(fixtures.saveSigner.mock.calls[0][0]).toBe(fixtures.saveSigner.mock.calls[1][0]);expect(fixtures.saveSigner.mock.calls[1][0].fullName).toBe('Sample Recipient');expect(p.onSignerRequestRetained.mock.calls[0][0]).toBe(p.onSignerRequestRetained.mock.calls[1][0]);expect(fixtures.recoverSigner).not.toHaveBeenCalled();
  });
  it('recovers a lost acknowledgment through the same original request without another write',async()=>{
    await openSigner();fillSigner();submitSigner();await screen.findByText('Check original signer request');const sid=fixtures.saveSigner.mock.calls[0][0].signerId;
    fixtures.recoverSigner.mockResolvedValueOnce({ok:true,value:{...signerReceipt(sid),state:'recovered'}});fireEvent.click(screen.getByRole('button',{name:'Check original signer request'}));await screen.findByText(/Signer preparation acknowledged/);expect(fixtures.recoverSigner).toHaveBeenCalledWith(tenant,id,client,sid);expect(fixtures.saveSigner).toHaveBeenCalledTimes(1);
  });
  it('reloads using opaque request metadata and performs only actor-bound read recovery',async()=>{
    const p={...props(),agreementId:id,requestId:null,requestTenantId:tenant,freshlyOpened:false,signerRequestId:signerId,onSignerRequestRetained:vi.fn()};fixtures.recoverSigner.mockResolvedValueOnce({ok:true,value:{...signerReceipt(),state:'recovered'}});
    render(<AgreementPreparationWorkspace {...p}/>);await screen.findByText(/Signer preparation acknowledged/);expect(fixtures.recoverSigner).toHaveBeenCalledWith(tenant,id,client,signerId);expect(fixtures.saveSigner).not.toHaveBeenCalled();expect(fixtures.create).not.toHaveBeenCalled();expect(p.onSignerRequestRetained).toHaveBeenCalledWith(null);
  });
  it('keeps absent reloaded recovery unconfirmed without an invented retry payload or new identity',async()=>{
    render(<AgreementPreparationWorkspace {...props()} agreementId={id} requestId={null} requestTenantId={tenant} freshlyOpened={false} signerRequestId={signerId}/>);await screen.findByText('Check original signer request');expect(screen.queryByLabelText('Full name')).toBeNull();expect(screen.queryByText('Retry same signer request')).toBeNull();expect(fixtures.saveSigner).not.toHaveBeenCalled();expect(document.body.textContent).toContain('does not establish cancellation');
  });
  it('refuses a reloaded business mismatch before any canonical/private read',()=>{
    render(<AgreementPreparationWorkspace {...props()} agreementId={id} requestId={null} requestTenantId={other} freshlyOpened={false} signerRequestId={signerId}/>);expect(fixtures.read).not.toHaveBeenCalled();expect(fixtures.recoverSigner).not.toHaveBeenCalled();expect(screen.queryByLabelText('Full name')).toBeNull();
  });
  it('uses the existing one leave dialog to retain/discard private unsaved recipient details',async()=>{
    await openSigner();fillSigner();fireEvent.click(screen.getByRole('button',{name:'Return to current agreement'}));expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Continue editing'}));expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Sample Recipient');fireEvent.click(screen.getByRole('button',{name:'Return to current agreement'}));fireEvent.click(screen.getByRole('button',{name:'Discard changes'}));await screen.findByText('Original retained wording.');expect(screen.queryByLabelText('Full name')).toBeNull();
  });
  it('does not mistake a current-record read for acknowledgment after a stale-source refusal',async()=>{
    await openSigner();fillSigner();fixtures.saveSigner.mockResolvedValueOnce({ok:false,reason:'conflict',message:'Stale source'});submitSigner();await screen.findByText(/reviewed agreement or preparation identity changed/);expect(screen.queryByText(/Signer preparation acknowledged/)).toBeNull();expect(screen.queryByText('Retry same signer request')).toBeNull();expect(fixtures.recoverSigner).not.toHaveBeenCalled();
  });
  it('hides private work during unknown authority and ignores the old successful response',async()=>{
    const {p,rerender}=await openSigner();fillSigner();let resolve!:(value:unknown)=>void;fixtures.saveSigner.mockReturnValueOnce(new Promise(done=>{resolve=done;}));submitSigner();const sid=fixtures.saveSigner.mock.calls[0][0].signerId;
    rerender(<AgreementPreparationWorkspace {...p} authorityUnknown/>);expect(screen.queryByLabelText('Full name')).toBeNull();await act(async()=>resolve({ok:true,value:signerReceipt(sid)}));expect(p.onRefresh).not.toHaveBeenCalled();rerender(<AgreementPreparationWorkspace {...p}/>);await screen.findByText('Check original signer request');expect((screen.getByLabelText('Full name') as HTMLInputElement).readOnly).toBe(true);expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Sample Recipient');expect(screen.queryByText(/Signer preparation acknowledged/)).toBeNull();
  });
  it('releases an interrupted recovery read and ignores its stale receipt before explicit recheck',async()=>{
    const {p,rerender}=await openSigner();fillSigner();submitSigner();await screen.findByText('Check original signer request');let resolve!:(value:unknown)=>void;fixtures.recoverSigner.mockReturnValueOnce(new Promise(done=>{resolve=done;}));fireEvent.click(screen.getByRole('button',{name:'Check original signer request'}));const sid=fixtures.saveSigner.mock.calls[0][0].signerId;
    rerender(<AgreementPreparationWorkspace {...p} authorityUnknown/>);rerender(<AgreementPreparationWorkspace {...p}/>);await screen.findByText('Check original signer request');await act(async()=>resolve({ok:true,value:{...signerReceipt(sid),state:'recovered'}}));expect(screen.queryByText(/Signer preparation acknowledged/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Check original signer request'}));await waitFor(()=>expect(fixtures.recoverSigner).toHaveBeenCalledTimes(2));
  });
  it('retires private recipient work after a conclusive permission loss and rejects late completion',async()=>{
    const {p,rerender}=await openSigner();fillSigner();let resolve!:(value:unknown)=>void;fixtures.saveSigner.mockReturnValueOnce(new Promise(done=>{resolve=done;}));submitSigner();const sid=fixtures.saveSigner.mock.calls[0][0].signerId;rerender(<AgreementPreparationWorkspace {...p} canManage={false}/>);await act(async()=>resolve({ok:true,value:signerReceipt(sid)}));rerender(<AgreementPreparationWorkspace {...p}/>);await screen.findByText('Original retained wording.');expect(screen.queryByLabelText('Full name')).toBeNull();expect(screen.queryByText(/Signer preparation acknowledged/)).toBeNull();expect(p.onRefresh).not.toHaveBeenCalled();
  });
  it('retires an actual native authority refusal and returns a usable canonical error state',async()=>{
    const {p}=await openSigner();fillSigner();fixtures.saveSigner.mockResolvedValueOnce({ok:false,reason:'refused',refusal:'authority',message:'Refused'});submitSigner();await screen.findByText('The agreement could not be opened');expect(screen.queryByLabelText('Full name')).toBeNull();expect(p.onRefresh).toHaveBeenCalledTimes(1);expect((screen.getByRole('button',{name:'Try again'}) as HTMLButtonElement).disabled).toBe(false);
  });
  it('provides original-request recovery after native refusal without admitting a replacement signer',async()=>{
    const p={...props(),agreementId:id,requestId:null,requestTenantId:tenant,freshlyOpened:false,signerRequestId:signerId};
    fixtures.recoverSigner.mockResolvedValueOnce({ok:false,reason:'refused',refusal:'authority',message:'Refused'});
    render(<AgreementPreparationWorkspace {...p}/>);await screen.findByText('The agreement could not be opened');fireEvent.click(screen.getByRole('button',{name:'Try again'}));await screen.findByText('Check retained signer request');expect((screen.getByRole('button',{name:'Add signer'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Check retained signer request'}));await screen.findByText('Check original signer request');expect(fixtures.recoverSigner).toHaveBeenCalledTimes(2);expect(fixtures.saveSigner).not.toHaveBeenCalled();expect(screen.queryByLabelText('Full name')).toBeNull();
  });
  it.each([{status:'completed'},{can_edit:false},{content_sha256:'a'.repeat(64)},{sealed_sha256:'b'.repeat(64)}])('does not mount recipient mutation on a retained/ineligible record %j',async patch=>{
    const current=original();Object.assign(current.agreement,patch);fixtures.read.mockResolvedValue({ok:true,value:current});render(<AgreementPreparationWorkspace {...props()} agreementId={id} requestId={null} freshlyOpened={false}/>);await screen.findByText('Agreement details');expect(screen.queryByText('Add signer')).toBeNull();expect(fixtures.saveSigner).not.toHaveBeenCalled();
  });
});

describe('original agreement correction flow',()=>{
  async function openCorrection(){
    const p={...props(),agreementId:id,requestId:null,freshlyOpened:false};
    const mounted=render(<AgreementPreparationWorkspace {...p}/>);
    await screen.findByText('Original retained wording.');fireEvent.click(screen.getByRole('button',{name:'Correct draft wording'}));
    await screen.findByText('Review the correction');return {...mounted,p};
  }
  const propose=()=>fireEvent.change(screen.getByLabelText('Agreement content'),{target:{value:'Proposed private correction.'}});
  const submitCorrection=()=>fireEvent.click(screen.getByRole('button',{name:'Save revised draft'}));
  it('focuses missing required wording before any write',async()=>{
    await openCorrection();fireEvent.change(screen.getByLabelText('Draft title'),{target:{value:''}});submitCorrection();
    expect(document.activeElement).toBe(screen.getByLabelText('Draft title'));expect(fixtures.correct).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Draft title'),{target:{value:'Reviewed title'}});
    fireEvent.change(screen.getByLabelText('Agreement content'),{target:{value:''}});submitCorrection();
    expect(document.activeElement).toBe(screen.getByLabelText('Agreement content'));expect(fixtures.correct).not.toHaveBeenCalled();
  });
  it('returns from verified same-record correction through a fresh native read and restores focus',async()=>{
    const {p}=await openCorrection();propose();
    const current=original();current.agreement.body_markdown='Proposed private correction.';current.agreement.version=2;current.agreement.updated_at='2026-10-21T20:01:00Z';
    fixtures.correct.mockResolvedValueOnce({ok:true,value:{agreementId:id,version:2,updatedAt:current.agreement.updated_at}});
    fixtures.read.mockResolvedValue({ok:true,value:current});submitCorrection();
    await waitFor(()=>expect(screen.queryByText('Review the correction')).toBeNull());await screen.findByText('Proposed private correction.');
    expect(fixtures.read).toHaveBeenCalledTimes(2);expect(fixtures.correct.mock.calls[0][0]).toMatchObject({agreementId:id,clientId:client,expectedUpdatedAt:'2026-10-21T20:00:00Z'});
    expect(fixtures.create).not.toHaveBeenCalled();expect(p.onOpenRecord).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Draft correction acknowledged · content version 2.');
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'Correct draft wording'}));
    const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(false);
  });
  it('keeps an unchanged correction clean and protects actual unsaved changes on return',async()=>{
    await openCorrection();let leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(false);
    propose();leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Return to current agreement'}));expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Continue editing'}));expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Proposed private correction.');
    fireEvent.click(screen.getByRole('button',{name:'Return to current agreement'}));fireEvent.click(screen.getByRole('button',{name:'Discard changes'}));
    await screen.findByText('Original retained wording.');expect(fixtures.correct).not.toHaveBeenCalled();
  });
  it('focuses the original heading when fresh readback is retained and no longer offers correction',async()=>{
    await openCorrection();propose();const current=original();current.agreement.body_markdown='Proposed private correction.';current.agreement.version=2;current.agreement.can_edit=false;current.agreement.content_sha256='a'.repeat(64);
    fixtures.correct.mockResolvedValueOnce({ok:true,value:{agreementId:id,version:2,updatedAt:'2026-10-21T20:01:00Z'}});fixtures.read.mockResolvedValue({ok:true,value:current});submitCorrection();
    await waitFor(()=>expect(screen.queryByText('Review the correction')).toBeNull());await screen.findByText('Proposed private correction.');
    expect(screen.queryByText('Correct draft wording')).toBeNull();expect(document.activeElement).toBe(document.querySelector('.e04-preparation h2'));
  });
  it('freezes uncertain input, reads current state separately and retries exactly the original command',async()=>{
    await openCorrection();propose();submitCorrection();await screen.findByText('Correction not confirmed');
    expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).readOnly).toBe(true);expect(fixtures.correct).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Read current agreement'}));await screen.findByRole('button',{name:'Retry original correction'});
    expect(document.querySelector('[aria-label="Current stored wording"]')?.textContent).toContain('Original retained wording.');
    fixtures.correct.mockResolvedValueOnce({ok:false,reason:'conflict',message:'Synthetic native conflict.'});
    fireEvent.click(screen.getByRole('button',{name:'Retry original correction'}));await screen.findByText('Current agreement has changed');
    expect(fixtures.correct.mock.calls[1][0]).toBe(fixtures.correct.mock.calls[0][0]);expect(fixtures.correct.mock.calls[1][0].expectedUpdatedAt).toBe('2026-10-21T20:00:00Z');expect(fixtures.create).not.toHaveBeenCalled();
  });
  it('does not claim an acknowledgment or enable overwrite when a later read matches the proposal',async()=>{
    await openCorrection();propose();submitCorrection();await screen.findByText('Correction not confirmed');
    const current=original();current.agreement.body_markdown='Proposed private correction.';current.agreement.version=2;current.agreement.updated_at='2026-10-21T20:01:00Z';fixtures.read.mockResolvedValue({ok:true,value:current});
    fireEvent.click(screen.getByRole('button',{name:'Read current agreement'}));await waitFor(()=>expect(document.querySelector('[aria-label="Current stored wording"]')?.textContent).toContain('Proposed private correction.'));
    expect(screen.queryByText('Retry original correction')).toBeNull();expect(screen.getByText('Correction not confirmed')).toBeTruthy();expect(fixtures.correct).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('Draft correction acknowledged');
    fireEvent.click(screen.getByRole('button',{name:'Return to current agreement'}));expect(screen.getByText('Leave while the save is unconfirmed?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Continue editing'}));expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Proposed private correction.');
  });
  it('preserves a refused-state proposal but retires it on conclusive native authority refusal',async()=>{
    const {p}=await openCorrection();propose();fixtures.correct.mockResolvedValueOnce({ok:false,reason:'refused',refusal:'state',message:'Synthetic retained source.'});submitCorrection();
    await screen.findByText('Correction unavailable');expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Proposed private correction.');
    fixtures.read.mockResolvedValueOnce({ok:false,reason:'refused',message:'Synthetic authority changed.'});fireEvent.click(screen.getByRole('button',{name:'Read current agreement'}));
    await screen.findByText('Agreement access could not be confirmed. Recheck the original business and record.');expect(screen.queryByLabelText('Agreement content')).toBeNull();expect(document.body.textContent).not.toContain('Proposed private correction.');expect(p.onRefresh).toHaveBeenCalled();
  });
  it('hides unknown authority, ignores a late acknowledgment and resumes the locked original proposal',async()=>{
    const {p,rerender}=await openCorrection();propose();let resolve!:(value:unknown)=>void;fixtures.correct.mockReturnValueOnce(new Promise(done=>{resolve=done;}));submitCorrection();
    rerender(<AgreementPreparationWorkspace {...p} authorityUnknown/>);expect(screen.queryByLabelText('Agreement content')).toBeNull();
    await act(async()=>resolve({ok:true,value:{agreementId:id,version:2,updatedAt:'2026-10-21T20:01:00Z'}}));expect(p.onRefresh).not.toHaveBeenCalled();
    rerender(<AgreementPreparationWorkspace {...p}/>);await screen.findByText('Correction not confirmed');expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Proposed private correction.');expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).readOnly).toBe(true);
  });
  it.each([{can_edit:false},{status:'completed'},{body_source:'tenant_upload',body_markdown:null,has_source_document:true}])('does not offer correction for retained/nontext state %j',async patch=>{
    const current=original();Object.assign(current.agreement,patch);fixtures.read.mockResolvedValue({ok:true,value:current});
    render(<AgreementPreparationWorkspace {...props()} agreementId={id} requestId={null} freshlyOpened={false}/>);await screen.findByText('Agreement details');expect(screen.queryByText('Correct draft wording')).toBeNull();expect(fixtures.correct).not.toHaveBeenCalled();
  });
});

describe('native agreement preparation flow', () => {
  it('opens a fresh authoring request without a record or reconciliation write', () => {
    render(<AgreementPreparationWorkspace {...props()} />);
    expect(screen.getByLabelText('Agreement content')).toBeTruthy();
    expect(fixtures.read).not.toHaveBeenCalled(); expect(fixtures.create).not.toHaveBeenCalled(); expect(fixtures.recover).not.toHaveBeenCalled();
  });
  it('focuses each required missing field before issuing a request', () => {
    render(<AgreementPreparationWorkspace {...props()} />); save();
    expect(document.activeElement).toBe(screen.getByLabelText('Client', { exact: true }));
    fireEvent.change(screen.getByLabelText('Client', { exact: true }), { target: { value: client } }); save();
    expect(document.activeElement).toBe(screen.getByLabelText('Agreement title'));
    fireEvent.change(screen.getByLabelText('Agreement title'), { target: { value: 'Scope' } }); save();
    expect(document.activeElement).toBe(screen.getByLabelText('Agreement content')); expect(fixtures.create).not.toHaveBeenCalled();
  });
  it('saves one captured request and opens only its actual acknowledged record', async () => {
    const p = props(); render(<AgreementPreparationWorkspace {...p} />); fill(); save();
    await waitFor(() => expect(p.onOpenRecord).toHaveBeenCalledWith(id));
    expect(fixtures.create).toHaveBeenCalledWith({ tenantId: tenant, requestId: request, clientId: client, title: 'New private wording', body: 'Private draft body in RAM.' });
    expect(p.onDraftAttempted).toHaveBeenCalledWith(request);
  });
  it('reuses the same request after uncertainty without a read-then-create replacement', async () => {
    fixtures.create.mockResolvedValueOnce({ ok: false, reason: 'unconfirmed', message: 'Synthetic uncertain save' }).mockResolvedValueOnce({ ok: true, value: { ...receipt(), state: 'recovered' } });
    const p = props(); render(<AgreementPreparationWorkspace {...p} />); fill(); save();
    await screen.findByRole('button', { name: 'Continue this draft' }); fireEvent.click(screen.getByRole('button', { name: 'Continue this draft' }));
    expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Private draft body in RAM.'); save();
    await waitFor(() => expect(p.onOpenRecord).toHaveBeenCalledWith(id));
    expect(fixtures.create.mock.calls.map(call => call[0].requestId)).toEqual([request, request]); expect(fixtures.recover).not.toHaveBeenCalled();
  });
  it('recovers a reloaded original using only its opaque request, with no private browser payload', async () => {
    fixtures.recover.mockResolvedValue({ ok: true, value: { ...receipt(), state: 'recovered' } });
    const p = { ...props(), freshlyOpened: false }; render(<AgreementPreparationWorkspace {...p} />);
    await waitFor(() => expect(p.onOpenRecord).toHaveBeenCalledWith(id));
    expect(fixtures.recover).toHaveBeenCalledWith(tenant, request); expect(fixtures.create).not.toHaveBeenCalled();
  });
  it('does not call an unconfirmed original absent or silently create a new request', async () => {
    render(<AgreementPreparationWorkspace {...props()} freshlyOpened={false} />);
    await screen.findByText(/The original save is not confirmed yet/);
    expect(fixtures.create).not.toHaveBeenCalled(); expect(screen.queryByText('Nothing was saved')).toBeNull();
  });
  it('retains entered wording when reconciliation finds an original and requires an explicit leave decision', async () => {
    fixtures.create.mockResolvedValue({ ok: false, reason: 'unconfirmed', message: 'Synthetic uncertain save' });
    fixtures.recover.mockResolvedValue({ ok: true, value: { ...receipt(), state: 'recovered' } });
    const p = props(); render(<AgreementPreparationWorkspace {...p} />); fill(); save();
    await screen.findByRole('button', { name: 'Check original save' }); fireEvent.click(screen.getByRole('button', { name: 'Check original save' }));
    await screen.findByRole('button', { name: 'Open recorded draft' }); expect(p.onOpenRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open recorded draft' }));
    const dialog = await screen.findByRole('alertdialog'); expect(dialog.textContent).toContain('Leaving this editor does not apply its current wording');
    expect(dialog.textContent).not.toContain('Your changes have not been saved');
    fireEvent.click(screen.getByRole('button', { name: 'Leave current editor' })); expect(p.onOpenRecord).toHaveBeenCalledWith(id);
  });
  it('hides but preserves same-subject RAM work while authority is unknown', () => {
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill();
    view.rerender(<AgreementPreparationWorkspace {...p} authorizationReady={false} />);
    expect(screen.queryByLabelText('Agreement content')).toBeNull(); expect(screen.queryByText('Private draft body in RAM.')).toBeNull();
    view.rerender(<AgreementPreparationWorkspace {...p} />);
    expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Private draft body in RAM.');
  });
  it('retires private RAM wording after conclusive author revocation', async () => {
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill();
    view.rerender(<AgreementPreparationWorkspace {...p} canManage={false} />);
    expect(screen.queryByLabelText('Agreement content')).toBeNull();
    view.rerender(<AgreementPreparationWorkspace {...p} />);
    await waitFor(() => expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe(''));
  });
  it('never displays another business or subject draft during context changes', () => {
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill();
    fixtures.context = { ...fixtures.context, activeTenantId: other };
    view.rerender(<AgreementPreparationWorkspace {...p} />);
    expect(screen.queryByLabelText('Agreement content')).toBeNull(); expect(screen.queryByText('Sample Client')).toBeNull();
    fixtures.context = { ...fixtures.context, activeTenantId: tenant, activeUserId: 'bbbbbbbb-0000-4000-8000-000000000002' };
    view.rerender(<AgreementPreparationWorkspace {...p} />);
    expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('');
  });
  it('does not open a late save after the authority frame retired', async () => {
    let finish!: (value: unknown) => void; fixtures.create.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill(); save();
    view.rerender(<AgreementPreparationWorkspace {...p} canManage={false} />);
    await act(async () => { finish({ ok: true, value: receipt() }); await Promise.resolve(); });
    expect(p.onOpenRecord).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Agreement content')).toBeNull();
  });
  it('keeps an unfinished request bound to its original business when both ready ports switch', () => {
    const p = props(); const view = render(<AgreementPreparationWorkspace {...p} />); fill();
    fixtures.context = { ...fixtures.context, activeTenantId: other };
    view.rerender(<AgreementPreparationWorkspace {...p} tenantId={other} />);
    expect(screen.queryByLabelText('Agreement content')).toBeNull();
    expect(fixtures.recover).not.toHaveBeenCalled(); expect(fixtures.create).not.toHaveBeenCalled();
  });
  it('reopens the selected real wording and keeps signatures separate from payment/service completion', async () => {
    const p = { ...props(), agreementId: id, requestId: null, freshlyOpened: false };
    render(<AgreementPreparationWorkspace {...p} />);
    await screen.findByText('Original retained wording.');
    expect(fixtures.read).toHaveBeenCalledWith(tenant, id);
    expect(screen.getByText(/does not establish payment or completion/)).toBeTruthy();
  });
  it('does not label an unreadable selected agreement as a draft', async () => {
    fixtures.read.mockResolvedValue({ ok: false, reason: 'unconfirmed', message: 'Synthetic read failure' });
    render(<AgreementPreparationWorkspace {...props()} agreementId={id} requestId={null} freshlyOpened={false} />);
    await screen.findByText('Record unavailable'); expect(screen.queryByText('Draft preparation')).toBeNull();
  });
  it('reads audit activity through the existing scoped reader and handles a rejected read', async () => {
    const p = { ...props(), agreementId: id, requestId: null, freshlyOpened: false };
    p.signings.signingEvents.mockRejectedValue(new Error('Synthetic failure'));
    render(<AgreementPreparationWorkspace {...p} />); await screen.findByText('Original retained wording.');
    fireEvent.click(screen.getByRole('button', { name: 'View signing history' }));
    await screen.findByText('Agreement history could not be read. Try the original record again.');
    expect(p.signings.signingEvents).toHaveBeenCalledWith(id, tenant);
  });
  it('returns keyboard focus to the original history entry after its view is mounted', async () => {
    fixtures.read.mockResolvedValueOnce({ok:true,value:original()}).mockResolvedValueOnce({ok:true,value:{...original(),agreement:{...original().agreement,version:2,body_markdown:'Latest canonical correction.'}}});
    render(<AgreementPreparationWorkspace {...props()} agreementId={id} requestId={null} freshlyOpened={false} />);
    await screen.findByText('Original retained wording.');fireEvent.click(screen.getByRole('button',{name:'Inspect wording history'}));
    await screen.findByText('No retained wording was returned. The current document remains available.');
    fireEvent.click(screen.getByRole('button',{name:'Return to current agreement'}));
    await screen.findByText('Latest canonical correction.');expect(screen.getByText('Recorded wording · content version 2')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'Inspect wording history'}));expect(fixtures.read).toHaveBeenCalledTimes(2);
  });
  it('hides the previous current record when returning from history cannot establish native access', async () => {
    fixtures.read.mockResolvedValueOnce({ok:true,value:original()}).mockResolvedValueOnce({ok:false,reason:'refused',message:'Synthetic native access changed.'});
    render(<AgreementPreparationWorkspace {...props()} agreementId={id} requestId={null} freshlyOpened={false}/>);
    await screen.findByText('Original retained wording.');fireEvent.click(screen.getByRole('button',{name:'Inspect wording history'}));
    await screen.findByText('No retained wording was returned. The current document remains available.');fireEvent.click(screen.getByRole('button',{name:'Return to current agreement'}));
    await screen.findByText('Synthetic native access changed.');expect(screen.queryByText('Original retained wording.')).toBeNull();expect(screen.queryByText('Synthetic retained agreement')).toBeNull();
  });
  it('retires the cached current legal wording when the native history reader refuses access', async () => {
    const p={...props(),agreementId:id,requestId:null,freshlyOpened:false};fixtures.history.mockResolvedValue({ok:false,reason:'refused',message:'Synthetic refusal'});
    render(<AgreementPreparationWorkspace {...p}/>);await screen.findByText('Original retained wording.');fireEvent.click(screen.getByRole('button',{name:'Inspect wording history'}));
    await screen.findByText('Agreement access could not be confirmed. Recheck the original business and record.');
    expect(screen.queryByText('Original retained wording.')).toBeNull();expect(screen.queryByText('Inspect wording history')).toBeNull();expect(p.onRefresh).toHaveBeenCalledTimes(1);
  });
});


describe('exact native template into original agreement',()=>{
 const template='99999999-0000-4000-8000-000000000001';
 it('loads supplied wording/options, asks for the actual client and saves its original source ID',async()=>{
  const p=props();render(<AgreementPreparationWorkspace {...p} templateVersionId={template}/>);
  await screen.findByRole('button',{name:'Save agreement draft'});
  expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Original supplied template words.\n');
  expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe('');
  save();expect(fixtures.create).not.toHaveBeenCalled();expect(document.activeElement).toBe(screen.getByLabelText('Client'));
  fireEvent.change(screen.getByLabelText('Client'),{target:{value:client}});save();
  await waitFor(()=>expect(p.onOpenRecord).toHaveBeenCalledWith(id));
  expect(fixtures.create.mock.calls[0][0]).toMatchObject({tenantId:tenant,clientId:client,source:'tenant_template',sourceVersionId:template,body:'Original supplied template words.\n'});
  expect(screen.getByText('Source-template options do not record completed review. Review this agreement’s actual wording before signing.')).not.toBeNull();
 });
 it('does not replace a missing or inactive source with a blank authored agreement',async()=>{
  fixtures.template.mockResolvedValue({ok:true,value:{id:template,preparation_purpose:'client_engagement',is_active:false,source_mode:'tenant_fork',has_uploaded_source:false,body_markdown:'Old words'}});
  render(<AgreementPreparationWorkspace {...props()} templateVersionId={template}/>);
  await screen.findByText('Select an active retained client template with supplied text wording before preparing this agreement.');
  expect(screen.queryByLabelText('Agreement content')).toBeNull();expect(fixtures.create).not.toHaveBeenCalled();
 });
 it('transient authority hides loaded source work and does not silently reload over later edits',async()=>{
  const p=props(),view=render(<AgreementPreparationWorkspace {...p} templateVersionId={template}/>);
  await screen.findByRole('button',{name:'Save agreement draft'});fireEvent.change(screen.getByLabelText('Agreement content'),{target:{value:'Owner corrected actual agreement words'}});
  view.rerender(<AgreementPreparationWorkspace {...p} templateVersionId={template} authorityUnknown/>);expect(screen.queryByLabelText('Agreement content')).toBeNull();
  view.rerender(<AgreementPreparationWorkspace {...p} templateVersionId={template}/>);await screen.findByRole('button',{name:'Save agreement draft'});
  expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('Owner corrected actual agreement words');expect(fixtures.template).toHaveBeenCalledOnce();
 });
 it('hard reload recovers the original agreement request rather than copying the template again',async()=>{
  render(<AgreementPreparationWorkspace {...props()} templateVersionId={template} freshlyOpened={false}/>);
  await screen.findByText('The original save is not confirmed yet. Check again, inspect recent agreements, or continue the same draft.');
  expect(fixtures.template).not.toHaveBeenCalled();expect(fixtures.create).not.toHaveBeenCalled();expect(fixtures.recover).toHaveBeenCalledWith(tenant,request);
 });
});
