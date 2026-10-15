import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ClientDeliveryPortalContext,type ClientDeliveryPortalView} from './client-delivery-portal-context';
import {ClientInvoices} from './ClientInvoices';

const id=(n:number)=>`ec041103-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),client=id(3),invoice=id(4),date='2026-10-14T12:00:00+00:00';
const fixture=vi.hoisted(()=>({user:vi.fn(),limit:vi.fn(),rpc:vi.fn(),listen:vi.fn(),unsubscribe:vi.fn(),listener:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:fixture.user,onAuthStateChange:fixture.listen},
  from:()=>({select:()=>({eq:()=>({is:()=>({limit:fixture.limit})})})}),rpc:fixture.rpc}}));
vi.mock('react-router-dom',()=>({useOutletContext:()=>({session:{user:{id:'ec041103-0000-4000-8000-000000000001'}}})}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const row={id:invoice,invoice_number:'SYN-1',status:'issued',currency:'usd',issued_at:date,due_date:'2026-10-15',issued_snapshot_version:1,
  amount_minor:'350000',allocated_minor:'45000',remaining_minor:'305000',manual_recorded_minor:'2000',provider_verified_minor:'43000',test_provider_minor:'0',document_available:true};
const envelope=()=>({schema_version:1,actor_id:actor,tenant_id:tenant,client_id:client,invoices:[{...row}],invoice_count:1,has_more:false,next_cursor:null,
  balances:[{currency:'usd',remaining_minor:'305000',manual_recorded_minor:'2000',provider_verified_minor:'43000',test_provider_minor:'0'}],invoice:null,
  next_payment:{state:'unavailable',reason:'effective_due_obligation_not_recorded'},engagement_completion:{state:'not_evaluated'},balance_basis:'canonical_invoice_allocations',read_at:date});
let host:HTMLDivElement,root:Root;
const portal=(preview=false):ClientDeliveryPortalView=>({preview,work:{actorId:actor,loading:false,result:null},opening:null,notice:'',attachList:()=>()=>{},refresh:()=>{},open:async()=>{}});
const render=async(preview=false)=>{await act(async()=>{root.render(<ClientDeliveryPortalContext.Provider value={portal(preview)}><ClientInvoices/></ClientDeliveryPortalContext.Provider>);});};
beforeEach(()=>{
  fixture.user.mockReset().mockResolvedValue({data:{user:{id:actor}},error:null});
  fixture.limit.mockReset().mockResolvedValue({data:[{id:client,tenant_id:tenant}],error:null});
  fixture.rpc.mockReset().mockResolvedValue({data:envelope(),error:null});
  fixture.listen.mockReset().mockImplementation(listener=>{fixture.listener=listener;return {data:{subscription:{unsubscribe:fixture.unsubscribe}}};});
  fixture.unsubscribe.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();fixture.listener=null;});
it('shows canonical balances and an exact authenticated document destination with no URL token',async()=>{
  await render();expect(host.textContent).toContain('$3,050.00');expect(host.textContent).toContain('Invoice SYN-1');
  const link=host.querySelector('a')!;const target=new URL(link.href);
  expect(target.pathname).toBe('/invoice');expect(target.searchParams.get('invoice_id')).toBe(invoice);
  expect(target.searchParams.get('client_id')).toBe(client);expect(target.searchParams.get('tenant_id')).toBe(tenant);
  expect(target.searchParams.has('token')).toBe(false);expect(link.target).toBe('_blank');expect(link.rel).toBe('noopener noreferrer');
});
it('scrubs completed data immediately when the actual session signs out',async()=>{
  await render();expect(host.textContent).toContain('$3,050.00');
  act(()=>fixture.listener?.('SIGNED_OUT',null));
  expect(host.textContent).not.toContain('$3,050.00');expect(host.textContent).not.toContain('Invoice SYN-1');
  expect(host.textContent).toContain('no longer available');expect(host.textContent).not.toContain('Checking your invoices');
});
it('does not render a late response after session retirement',async()=>{
  let resolve!:(value:{data:ReturnType<typeof envelope>;error:null})=>void;
  fixture.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));await render();
  expect(host.textContent).toContain('Checking your invoices');act(()=>fixture.listener?.('SIGNED_OUT',null));
  await act(async()=>resolve({data:envelope(),error:null}));
  expect(host.textContent).not.toContain('Invoice SYN-1');expect(host.textContent).toContain('no longer available');
});
it('disables admin/client preview instead of borrowing the displayed identity',async()=>{
  await render(true);expect(host.textContent).toContain('Open your own client session');
  expect(fixture.rpc).not.toHaveBeenCalled();expect(fixture.user).not.toHaveBeenCalled();
});
it('shows an empty record separately from unavailable source data',async()=>{
  const empty=envelope();empty.invoices=[];empty.balances=[];empty.invoice_count=0;
  fixture.rpc.mockResolvedValue({data:empty,error:null});await render();
  expect(host.textContent).toContain('No invoices are available');expect(host.textContent).not.toContain('$0');
});
it('can retry an unavailable read without asserting a zero or changing a financial record',async()=>{
  fixture.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}});await render();
  expect(host.textContent).toContain('could not be read');expect(host.textContent).not.toContain('$0');
  fixture.rpc.mockResolvedValue({data:envelope(),error:null});
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Try again')!.click();});
  expect(host.textContent).toContain('Invoice SYN-1');
  expect(fixture.rpc.mock.calls.every(call=>call[0]==='read_client_commercial_status_scoped')).toBe(true);
});
it('refuses source role/tenant denials without leaving old financial values visible',async()=>{
  await render();fixture.rpc.mockResolvedValue({data:null,error:{code:'42501'}});
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Check balances again')!.click();});
  expect(host.textContent).not.toContain('$3,050.00');expect(host.textContent).toContain('no longer available');
});
it('labels test activity and keeps large canonical amounts exact',async()=>{
  const value=envelope();value.balances[0].remaining_minor='9007199254740993123456';value.balances[0].test_provider_minor='3000';
  fixture.rpc.mockResolvedValue({data:value,error:null});await render();
  expect(host.textContent).toContain('Test activity is included');expect(host.textContent).toContain('90,071,992,547,409,931,234.56');
  expect(host.textContent).not.toContain('Payment confirmed');
});
