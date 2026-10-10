import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), preview: vi.fn(), archive: vi.fn(), execute: vi.fn(), outcome: vi.fn() }));
vi.mock('@/operator/data/accountControls', async importOriginal => ({ ...await importOriginal<typeof import('@/operator/data/accountControls')>(), readAccountDetails: h.read, saveAccountDetails: h.save, previewAccountDeletion: h.preview, previewAccountArchive: h.archive, executeLifecycle: h.execute, readLifecycleOutcome: h.outcome }));
import { AccountRpcError } from '@/operator/data/accountControls';
import AccountDetailsDialog from './AccountDetailsDialog';
const details = { id:'test-tenant-a', name:'Example Agency', status:'active', account_type:'agency', parent_tenant_id:null, version:'read-version' };
let root: Root; let host: HTMLDivElement;
beforeEach(() => { (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true; vi.resetAllMocks(); h.read.mockResolvedValue(details); host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
afterEach(() => { act(()=>root.unmount()); host.remove(); });
const button = (name: string) => Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') ?? b.textContent) === name) ?? null;
const screen = {
  getByRole: (_role: string, {name}: {name:string}) => { const b=button(name); if(!b) throw new Error(`Missing button: ${name}`); return b; },
  queryByRole: (_role: string, {name}: {name:string}) => button(name),
  findByRole: async (_role:string,{name}:{name:string}) => { await vi.waitFor(()=>expect(button(name)).not.toBeNull()); return button(name); },
  getByLabelText: (name:string) => { const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent===name); const input=label?.htmlFor && document.getElementById(label.htmlFor); if(!input) throw new Error('Missing input'); return input; },
  queryByText: (text:string) => Array.from(document.querySelectorAll('p,li')).find(e=>e.textContent===text)??null,
  getByText: (text:string) => {const e=screen.queryByText(text); if(!e) throw new Error('Missing text'); return e;},
  findByText: async (text:string) => {await vi.waitFor(()=>expect(screen.queryByText(text)).not.toBeNull());return screen.getByText(text);},
};
const fireEvent = {
  click: (element:HTMLElement) => act(()=>element.click()),
  change: (element:HTMLElement,event:{target:{value:string}}) => act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,event.target.value);element.dispatchEvent(new Event('input',{bubbles:true}));}),
};
const waitFor = vi.waitFor;
const open = async () => { const changed=vi.fn(), close=vi.fn(); await act(async()=>root.render(<AccountDetailsDialog tenantId={details.id} onClose={close} onChanged={changed}/>)); await screen.findByRole('button',{name:'Edit account'}); return {changed,close}; };
describe('account controls — actual dialog interaction', () => {
  it('preserves edited input through Cancel / Keep editing', async () => {
    await open(); fireEvent.click(screen.getByRole('button',{name:'Edit account'}));
    fireEvent.change(screen.getByLabelText('Account name'),{target:{value:'Revised example'}});
    fireEvent.click(screen.getByRole('button',{name:'Cancel'})); fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));
    expect((screen.getByLabelText('Account name') as HTMLInputElement).value).toBe('Revised example');
    expect(h.save).not.toHaveBeenCalled();
  });
  it('requires review before saving, then refreshes only after verified readback', async () => {
    const {changed}=await open();h.save.mockResolvedValue({...details,name:'Revised example'});
    fireEvent.click(screen.getByRole('button',{name:'Edit account'}));fireEvent.change(screen.getByLabelText('Account name'),{target:{value:'Revised example'}});
    fireEvent.click(screen.getByRole('button',{name:'Review changes'}));expect(h.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
    await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
    expect(h.save).toHaveBeenCalledWith(details,'Revised example','active');
  });
  it('does not announce success or blindly retry an uncertain save', async () => {
    const {changed}=await open();h.save.mockRejectedValue(new Error('Save outcome unknown'));
    fireEvent.click(screen.getByRole('button',{name:'Edit account'}));fireEvent.change(screen.getByLabelText('Account name'),{target:{value:'Revised example'}});
    fireEvent.click(screen.getByRole('button',{name:'Review changes'}));fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
    await screen.findByRole('button',{name:'Read current account'});
    expect(changed).not.toHaveBeenCalled(); expect(screen.queryByText('Account changes saved and read back.')).toBeNull();
    expect((screen.getByRole('button',{name:'Save changes'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows the server tree and blockers without offering destructive execution', async () => {
    await open();h.preview.mockResolvedValue({tenant_id:details.id,accounts:[{id:details.id,name:details.name,account_type:'agency'},{id:'test-tenant-b',name:'Example Child',account_type:'sub_account'}],blockers:['Retained Chat evidence needs cleanup.'],execution_available:false});
    fireEvent.click(screen.getByRole('button',{name:'Permanently delete account'}));
    await screen.findByText('Retained Chat evidence needs cleanup.');expect(screen.getByText('Example Child · sub account')).toBeTruthy();
    expect((screen.getByRole('button',{name:'Permanently delete listed accounts'}) as HTMLButtonElement).disabled).toBe(true);
    expect(h.save).not.toHaveBeenCalled();
  });
  it('requires exact scope confirmation before archive and dispatches once while pending', async () => {
    const {changed}=await open(); h.archive.mockResolvedValue({tenant_id:details.id,accounts:[details],blockers:[],execution_available:true,version:'scope-version'});
    let finish!: (v:unknown)=>void; h.execute.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    fireEvent.click(screen.getByRole('button',{name:'Archive account'}));
    await screen.findByRole('button',{name:'Archive listed accounts'});
    await waitFor(()=>expect(document.getElementById('fleet-lifecycle-confirm')).not.toBeNull());
    const confirm=document.getElementById('fleet-lifecycle-confirm')!;
    fireEvent.change(confirm,{target:{value:'Wrong account'}});
    expect((screen.getByRole('button',{name:'Archive listed accounts'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(confirm,{target:{value:details.name}});
    const submit=screen.getByRole('button',{name:'Archive listed accounts'});
    fireEvent.click(submit); fireEvent.click(submit);
    expect(h.execute).toHaveBeenCalledTimes(1);expect(changed).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledWith(details.id,'archive',expect.any(String),details.name,'scope-version');
    await act(async()=>finish({tenant_id:details.id,operation_id:'test-operation',state:'archived',account_count:1}));
    expect(changed).toHaveBeenCalledTimes(1);expect(document.body.textContent).toContain('COMPLETED');
  });
  it('requires both typed name and irreversible consent for an archived deletion', async () => {
    h.read.mockResolvedValue({...details,archived_at:'2026-01-01',archive_operation_id:'test-operation'});
    const changed=vi.fn();await act(async()=>root.render(<AccountDetailsDialog tenantId={details.id} onClose={()=>{}} onChanged={changed}/>));
    await screen.findByRole('button',{name:'Restore archived account'});
    h.preview.mockResolvedValue({tenant_id:details.id,accounts:[details],blockers:[],execution_available:true,version:'delete-version'});
    h.execute.mockResolvedValue({tenant_id:details.id,operation_id:'test-operation',state:'deleted',account_count:1});
    fireEvent.click(screen.getByRole('button',{name:'Permanently delete account'}));
    await waitFor(()=>expect(document.getElementById('fleet-lifecycle-confirm')).not.toBeNull());
    fireEvent.change(document.getElementById('fleet-lifecycle-confirm')!,{target:{value:details.name}});
    const submit=screen.getByRole('button',{name:'Permanently delete listed accounts'});
    expect((submit as HTMLButtonElement).disabled).toBe(true);fireEvent.click(document.querySelector('input[type=checkbox]')! as HTMLElement);
    fireEvent.click(submit);await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
    expect(h.execute).toHaveBeenCalledWith(details.id,'delete','test-operation',details.name,'delete-version');
  });
  it('an unknown archive recovers by receipt without dispatching again', async () => {
    const {changed}=await open();h.archive.mockResolvedValue({tenant_id:details.id,accounts:[details],blockers:[],execution_available:true,version:'scope-version'});h.execute.mockRejectedValue(new Error('Transport interrupted'));
    fireEvent.click(screen.getByRole('button',{name:'Archive account'}));await waitFor(()=>expect(document.getElementById('fleet-lifecycle-confirm')).not.toBeNull());fireEvent.change(document.getElementById('fleet-lifecycle-confirm')!,{target:{value:details.name}});fireEvent.click(screen.getByRole('button',{name:'Archive listed accounts'}));
    await screen.findByRole('button',{name:'Read operation'});expect(changed).not.toHaveBeenCalled();
    h.outcome.mockResolvedValue({tenant_id:details.id,operation_id:'test-operation',state:'archived',account_count:1});fireEvent.click(screen.getByRole('button',{name:'Read operation'}));await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));expect(h.execute).toHaveBeenCalledTimes(1);expect(h.outcome).toHaveBeenCalledWith(details.id,expect.any(String),'archive');
  });
  it('a stale preflight clears irreversible confirmation and demands a fresh review', async () => {
    await open();h.archive.mockResolvedValue({tenant_id:details.id,accounts:[details],blockers:[],execution_available:true,version:'scope-version'});h.execute.mockRejectedValue(new AccountRpcError('Scope changed','40001'));
    fireEvent.click(screen.getByRole('button',{name:'Archive account'}));await waitFor(()=>expect(document.getElementById('fleet-lifecycle-confirm')).not.toBeNull());fireEvent.change(document.getElementById('fleet-lifecycle-confirm')!,{target:{value:details.name}});fireEvent.click(screen.getByRole('button',{name:'Archive listed accounts'}));await waitFor(()=>expect(document.body.textContent).toContain('FAILED'));
    expect(screen.queryByRole('button',{name:'Read operation'})).toBeNull();expect(document.getElementById('fleet-lifecycle-confirm')).toBeNull();expect((screen.getByRole('button',{name:'Archive listed accounts'}) as HTMLButtonElement).disabled).toBe(true);
  });
});
