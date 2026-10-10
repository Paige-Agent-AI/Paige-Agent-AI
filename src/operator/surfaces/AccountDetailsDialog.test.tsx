import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), preview: vi.fn() }));
vi.mock('@/operator/data/accountControls', () => ({ readAccountDetails: h.read, saveAccountDetails: h.save, previewAccountDeletion: h.preview }));
import AccountDetailsDialog from './AccountDetailsDialog';
const details = { id:'test-tenant-a', name:'Example Agency', status:'active', account_type:'agency', parent_tenant_id:null, version:'read-version' };
let root: Root; let host: HTMLDivElement;
beforeEach(() => { vi.resetAllMocks(); h.read.mockResolvedValue(details); host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
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
    fireEvent.click(screen.getByRole('button',{name:'Review deletion'}));
    await screen.findByText('Retained Chat evidence needs cleanup.');expect(screen.getByText('Example Child · sub account')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Delete listed accounts'})).toBeNull();
    expect(h.save).not.toHaveBeenCalled();
  });
});
