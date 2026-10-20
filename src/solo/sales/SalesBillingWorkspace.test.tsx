import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SalesBillingWorkspace } from './SalesBillingWorkspace';
import { normalizeInvoiceSnapshot } from './invoiceDraftSnapshot';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ tenant: '11111111-1111-4111-8111-111111111111', phase: 'ready', save: vi.fn(), invoke:vi.fn(), rpc:vi.fn(), actor:'66666666-6666-4666-8666-666666666666', catalogOptions:vi.fn(), catalogRetry:vi.fn(), catalogMore:false, rows: [] as unknown[], offers: [] as unknown[], canManage: true, clients: [] as { id: string; name: string; primaryEmail?: string | null }[] }));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc,functions:{invoke:h.invoke},auth:{getSession:async()=>({data:{session:{user:{id:h.actor}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}));
vi.mock('../useSalesInvoiceDrafts', () => ({ useSalesInvoiceDrafts: () => ({ tenantId: h.tenant, phase: h.phase, rows: h.rows.map((value)=>{const r=value as {facts:Record<string,unknown>;totalMinor:number;dueNowMinor:number;remainderMinor:number};return ({...r,snapshot:normalizeInvoiceSnapshot({...r.facts,due_now_minor:r.dueNowMinor,remainder_minor:r.remainderMinor,price_snapshot:r.facts.price_id?{price_id:r.facts.price_id,product_id:'66666666-6666-4666-8666-666666666666',product_name:r.facts.item,unit_minor:r.facts.unit_minor,currency:'usd',billing_interval:'one_time',interval_count:null}:null},r.totalMinor)})}), hasMore: false, nextCursor: null, message: '', save: h.save, retry: vi.fn() }) }));
vi.mock('../useSoloCommercialTerms', () => ({ useSoloCommercialTerms: () => ({ tenantId: h.tenant, phase: 'ready', clientsReadable: true, canManage: h.canManage, clients: h.clients }) }));
vi.mock('../useCatalogOffers', () => ({ useCatalogOffers: (options:unknown) => {h.catalogOptions(options);return ({ tenantId: h.tenant, phase: 'ready', offers: h.offers, referencedOffers: [], hasMore:h.catalogMore,retry:h.catalogRetry })} }));
vi.mock('./useInvoiceBillingSources',()=>({useInvoiceBillingSources:()=>({tenantId:h.tenant,phase:'ready',agreements:[],customers:h.clients.map(c=>({...c,address:null,methods:c.primaryEmail?[{id:'88888888-8888-4888-8888-888888888888',kind:'email',value:c.primaryEmail,label:'Billing',isPrimary:true}]:[]}))})}));
vi.mock('./useInvoiceCommercialTermsSources',()=>({useInvoiceCommercialTermsSources:()=>({commercialTerms:[{id:'55555555-5555-4555-8555-555555555555',clientId:'22222222-2222-4222-8222-222222222222',title:'Synthetic installment terms',version:2,status:'draft',termsCurrent:true}],phase:'ready',hasMore:false,loadingMore:false,error:'',retry:vi.fn(),loadMore:vi.fn()})}));
let host: HTMLDivElement; let root: Root;
beforeEach(() => { h.clients = [{ id: '22222222-2222-4222-8222-222222222222', name: 'Test client', primaryEmail: 'primary@example.test' }, { id: '77777777-7777-4777-8777-777777777777', name: 'No email client', primaryEmail: null }]; h.phase = 'ready'; h.canManage = true; h.rows = []; h.offers = []; h.tenant = '11111111-1111-4111-8111-111111111111'; h.actor='66666666-6666-4666-8666-666666666666';sessionStorage.clear();h.invoke.mockReset();h.rpc.mockReset();h.rpc.mockResolvedValue({data:null,error:null});h.save.mockReset();h.catalogOptions.mockReset();h.catalogRetry.mockReset();h.catalogMore=false; host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<SalesBillingWorkspace view="invoices" />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function button(text: string) { return [...host.querySelectorAll('button')].find(b => b.textContent === text)!; }
function click(text: string) { act(() => button(text).click()); }
function field(text: string, value: string) { const el = [...host.querySelectorAll('label')].find(l => l.textContent?.startsWith(text))!.querySelector('input,select,textarea')!; act(() => { const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
function fill() { click('Create invoice'); field('Client', '22222222-2222-4222-8222-222222222222'); const description=host.querySelector('[aria-label="Item description 1"]')!; act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(description,'Custom service');description.dispatchEvent(new Event('input',{bubbles:true}));}); const amount=host.querySelector('[aria-label="Unit price for item 1"]')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(amount,'150.25');amount.dispatchEvent(new Event('input',{bubbles:true}));});field('Due date','2026-12-01'); }
it('distinguishes unavailable storage from no records and disables creation', () => { h.phase = 'unavailable'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(host.textContent).toContain('Billing draft storage unavailable'); expect(button('Create invoice').disabled).toBe(true); });
it('refuses editing for a member even with readable records', () => { h.canManage = false; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(button('Create invoice').disabled).toBe(true); });
it('preserves input on refused saves', async () => { h.save.mockResolvedValue({ ok: false, outcome: 'refused', message: 'Access refused' }); fill(); await act(async () => button('Save draft').click()); expect(host.textContent).toContain('Access refused'); expect((host.querySelector('input[value="Custom service"]') as HTMLInputElement)?.value).toBe('Custom service'); });
it('recovers an uncertain save with exactly the original operation and input', async () => { h.save.mockResolvedValueOnce({ ok: false, outcome: 'unknown', message: 'Unknown save' }).mockResolvedValueOnce({ ok: true, value: {} }); fill(); await act(async () => button('Save draft').click()); const original = h.save.mock.calls[0][0]; expect(button('Back to records').disabled).toBe(true); await act(async () => button('Recover original save').click()); expect(h.save.mock.calls[1][0]).toBe(original); expect(host.textContent).not.toContain('Unknown save'); });
it('asks before discarding changed input and keeps editing by default', () => { fill(); click('Back to records'); expect(host.querySelector('[role="alertdialog"]')).not.toBeNull(); click('Continue editing'); expect(host.querySelector('[role="alertdialog"]')).toBeNull(); expect(host.textContent).toContain('Create invoice'); });
it('clears the editor immediately when the workspace changes', () => { fill(); h.tenant = '33333333-3333-4333-8333-333333333333'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(host.querySelector('input[value="Custom service"]')).toBeNull(); });
it('uses the existing discard guard before internal Campaigns tab navigation', () => { fill(); const nav = document.createElement('div'); nav.className = 'so-subnav'; const tab = document.createElement('button'); tab.textContent = 'Payments'; const navigate = vi.fn(); tab.addEventListener('click', navigate); nav.append(tab); document.body.append(nav); act(() => tab.click()); expect(navigate).not.toHaveBeenCalled(); expect(host.querySelector('[role="alertdialog"]')).not.toBeNull(); click('Discard changes'); expect(navigate).toHaveBeenCalledTimes(1); nav.remove(); });
function reopenCatalog(currentUnit = 15000) {
  h.rows = [{ id: '44444444-4444-4444-8444-444444444444', tenantId: h.tenant, version: 3, number: 'DRAFT-test-catalog', totalMinor: 20000, dueNowMinor: 20000, remainderMinor: 0, facts: { client_id: '22222222-2222-4222-8222-222222222222', price_id: '55555555-5555-4555-8555-555555555555', item: 'Catalog service', unit_minor: 10000, quantity: 2, kind: 'one_time', deposit_basis_points: null, provider: 'stripe', currency: 'usd', due_date: null, recipient_email: null, memo: null, cadence: null } }];
  h.offers = [{ id: '66666666-6666-4666-8666-666666666666', name: 'Catalog service', availability: 'active', prices: [{ id: '55555555-5555-4555-8555-555555555555', active: true, currency: 'usd', unitAmount: currentUnit, kind: 'one_time', billingInterval: 'one_time' }] }];
  act(() => root.render(<SalesBillingWorkspace view="invoices" />)); click('Edit');
}
it('reopens a changed Catalog draft with matching current amount and explicit repricing',async()=>{reopenCatalog();expect(host.textContent).toContain('Catalog price changed from $100.00 to $150.00 per unit');expect(host.textContent).toContain('$300.00');field('Due date','2026-12-01');h.save.mockResolvedValue({ok:false,outcome:'refused',message:'Test refusal'});await act(async()=>button('Save draft').click());expect(h.save.mock.calls[0][0]).toMatchObject({expectedVersion:3,draft:{items:[{price_id:'55555555-5555-4555-8555-555555555555',unit_minor:null,quantity:2}]}});});
it('keeps unknown Catalog recovery pricing and operation immutable while the Catalog changes', async () => {
  reopenCatalog(); field('Due date','2026-12-01'); h.save.mockResolvedValue({ ok: false, outcome: 'unknown', message: 'Unknown save' });
  await act(async () => button('Save draft').click()); const original = h.save.mock.calls[0][0];
  h.offers = [{ id: '66666666-6666-4666-8666-666666666666', name: 'Catalog service', availability: 'active', prices: [{ id: '55555555-5555-4555-8555-555555555555', active: true, currency: 'usd', unitAmount: 25000, kind: 'one_time', billingInterval: 'one_time' }] }];
  act(() => root.render(<SalesBillingWorkspace view="invoices" />));
  expect(host.textContent).toContain('$300.00');expect(host.textContent).not.toContain('$500.00');
  await act(async () => button('Recover original save').click()); expect(h.save.mock.calls[1][0]).toBe(original);
});
it('refuses saving when a saved Catalog price current source is missing',async()=>{reopenCatalog();field('Due date','2026-12-01');h.offers=[];act(()=>root.render(<SalesBillingWorkspace view="invoices"/>));await act(async()=>button('Save draft').click());expect(host.textContent).toContain('A Catalog price is unavailable');expect(h.save).not.toHaveBeenCalled();});

function billingEmail() { return [...host.querySelectorAll('label')].find(l => l.textContent?.startsWith('Billing email'))!.querySelector('input')!.value; }
it('prefills canonical email on selection and clears old contact on missing or empty client', () => { fill(); expect(billingEmail()).toBe('primary@example.test'); field('Billing email', 'manual@example.test'); field('Client', '77777777-7777-4777-8777-777777777777'); expect(billingEmail()).toBe(''); field('Client', '22222222-2222-4222-8222-222222222222'); expect(billingEmail()).toBe('primary@example.test'); field('Client', ''); expect(billingEmail()).toBe(''); });
it('retains manual email through refreshed CRM data and saves the billing snapshot', async () => { fill(); field('Billing email', 'billing@example.test'); h.clients[0].primaryEmail = 'changed@example.test'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(billingEmail()).toBe('billing@example.test'); h.save.mockResolvedValue({ok:false,outcome:'refused',message:'Test refusal'}); await act(async () => button('Save draft').click()); expect(h.save.mock.calls[0][0].draft.recipient_email).toBe('billing@example.test'); });
it('reopens the saved billing email instead of current CRM email', () => { reopenCatalog(); click('Back to records'); (h.rows[0] as {facts:{recipient_email:string}}).facts.recipient_email = 'snapshot@example.test'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); click('Edit'); expect(billingEmail()).toBe('snapshot@example.test'); });
it('freezes selected billing email and original request during unknown recovery', async () => { fill(); h.save.mockResolvedValue({ok:false,outcome:'unknown',message:'Unknown'}); await act(async () => button('Save draft').click()); const original=h.save.mock.calls[0][0]; h.clients[0].primaryEmail='later@example.test'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(billingEmail()).toBe('primary@example.test'); await act(async () => button('Recover original save').click()); expect(h.save.mock.calls[1][0]).toBe(original); expect(original.draft.recipient_email).toBe('primary@example.test'); });

it('keeps Catalog search and later pages reachable inside the editor and resolves saved product references',()=>{h.catalogMore=true;reopenCatalog();field('Find Catalog offer','Older offer');expect(h.catalogOptions.mock.calls.at(-1)?.[0]).toMatchObject({search:'Older offer',page:0});click('Next Catalog page');expect(h.catalogOptions.mock.calls.at(-1)?.[0]).toMatchObject({search:'Older offer',page:1,referenceIds:['66666666-6666-4666-8666-666666666666']});expect(host.querySelector('.ide')).not.toBeNull();});
it('stacks custom offers with independent integer quantities in the saved snapshot',async()=>{fill();click('Custom item');function change(selector:string,value:string){const el=host.querySelector<HTMLInputElement>(selector)!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}change('[aria-label="Item description 2"]','Second service');change('[aria-label="Unit price for item 2"]','100.10');change('[aria-label="Quantity for item 2"]','3');h.save.mockResolvedValue({ok:false,outcome:'refused',message:'Test refusal'});await act(async()=>button('Save draft').click());expect(h.save.mock.calls[0][0].draft.items).toEqual([{price_id:null,item:'Custom service',unit_minor:15025,quantity:1},{price_id:null,item:'Second service',unit_minor:10010,quantity:3}]);expect(host.textContent).toContain('$450.55');});

it('refreshes Catalog on editor entry and explicit picker refresh without resetting entered lines',()=>{click('Create invoice');expect(h.catalogRetry).toHaveBeenCalledOnce();field('Client','22222222-2222-4222-8222-222222222222');click('Refresh offers');expect(h.catalogRetry).toHaveBeenCalledTimes(2);expect(host.querySelector('select')?.value).toBe('22222222-2222-4222-8222-222222222222');});

it('review saves first and proposes publication from returned canonical ID/version only',async()=>{fill();act(()=>{Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.startsWith('Email invoice'))!.querySelector('input')!.click();});click('Review invoice');h.save.mockResolvedValue({ok:true,value:{id:'99999999-9999-4999-8999-999999999999',version:7}});h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'0123456789abcdef'},error:null});await act(async()=>button('Save and review publication').click());const prepare=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Prepare review')!;await act(async()=>prepare.click());expect(h.invoke.mock.calls[0][1].body.command).toEqual({action:'invoice.publish',invoice_id:'99999999-9999-4999-8999-999999999999',expected_version:7});expect(h.save).toHaveBeenCalledTimes(1);});
it('unknown review save never proposes publication and freezes the original operation',async()=>{fill();act(()=>{Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.startsWith('Email invoice'))!.querySelector('input')!.click();});click('Review invoice');h.save.mockResolvedValue({ok:false,outcome:'unknown',message:'Unknown save'});await act(async()=>button('Save and review publication').click());expect(h.invoke).not.toHaveBeenCalled();expect(button('Save and review publication').disabled).toBe(true);expect(button('Recover original save').disabled).toBe(false);});
it('role loss during publication save prevents stale review handoff',async()=>{fill();act(()=>{Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.startsWith('Email invoice'))!.querySelector('input')!.click();});click('Review invoice');let resolve!:(v:unknown)=>void;h.save.mockImplementation(()=>new Promise(r=>resolve=r));await act(async()=>button('Save and review publication').click());h.canManage=false;act(()=>root.render(<SalesBillingWorkspace view="invoices"/>));await act(async()=>resolve({ok:true,value:{id:'99999999-9999-4999-8999-999999999999',version:7}}));expect(document.body.textContent).not.toContain('Prepare review');expect(h.invoke).not.toHaveBeenCalled();});

it('same-tenant authenticated actor switch prevents saved publication handoff',async()=>{fill();act(()=>{Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.startsWith('Email invoice'))!.querySelector('input')!.click();});click('Review invoice');let resolve!:(v:unknown)=>void;h.save.mockImplementation(()=>new Promise(r=>resolve=r));await act(async()=>button('Save and review publication').click());h.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await act(async()=>resolve({ok:true,value:{id:'99999999-9999-4999-8999-999999999999',version:7}}));expect(document.body.textContent).not.toContain('Prepare review');expect(h.invoke).not.toHaveBeenCalled();});

 it('saves the independently selected canonical terms version through the existing draft writer',async()=>{fill();field('Commercial terms / payment plan','55555555-5555-4555-8555-555555555555');h.save.mockResolvedValue({ok:false,outcome:'refused',message:'Test refusal'});await act(async()=>button('Save draft').click());expect(h.save.mock.calls[0][0].draft.commercial_terms_reference).toEqual({id:'55555555-5555-4555-8555-555555555555',version:2});expect(h.save.mock.calls[0][0].draft.agreement_id).toBeNull();});

const focusedId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function focusedRecord(patch:Record<string,unknown>={}) {
 const snapshot={schema_version:2,client_id:'22222222-2222-4222-8222-222222222222',items:[{price_id:null,item:'Older recurring service',unit_minor:1000,quantity:1,price_snapshot:null}],kind:'recurring',deposit_basis_points:null,currency:'usd',cadence:'monthly',recipient_email:null,recipient_phone:null,email_source_method_id:null,phone_source_method_id:null,billing_address:null,agreement_id:null,agreement_snapshot:null,processor_intent:null,payment_method_intents:[],delivery_channel_intents:[],due_date:null,memo:null,total_minor:1000,due_now_minor:1000,remainder_minor:0};
 return {id:focusedId,tenant_id:h.tenant,status:'draft',invoice_number:'DRAFT-older',billing_draft_version:1,version:1,amount_total_cents:1000,billing_draft:snapshot,manual_recorded_cents:0,remaining_cents:1000,payments:[],payments_count:0,payments_has_more:false,...patch};
}
function seedVisibleRow(){reopenCatalog();click('Back to records');}
it('reviews an exact saved invoice outside the register page/search and recurring filter without editing it',async()=>{
 seedVisibleRow();field('Search invoices','No visible match');h.rpc.mockResolvedValue({data:focusedRecord(),error:null});
 await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[focusedId]}/>));
 expect(host.textContent).toContain('Older recurring service');expect(host.textContent).not.toContain('Catalog service');expect(host.querySelector('.ide')).toBeNull();
 expect(h.rpc).toHaveBeenCalledWith('read_sales_invoice',{_expected_tenant_id:h.tenant,_invoice_id:focusedId});expect(h.save).not.toHaveBeenCalled();expect(h.invoke).not.toHaveBeenCalled();expect(button('Open actions & records')).toBeDefined();
});
it.each([['bad-id'],[''],[focusedId,focusedId]].map(ids=>({ids})))('shows invalid exact link without a register fallback or create editor %j',async({ids})=>{
 seedVisibleRow();await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={ids}/>));
 expect(host.textContent).toContain('This invoice link is invalid');expect(host.textContent).not.toContain('Catalog service');expect(host.textContent).not.toContain('Create invoice');expect(h.rpc).not.toHaveBeenCalled();
});
it.each([{data:null,error:null},{data:null,error:{code:'42501'}},{data:focusedRecord({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),error:null}])('keeps missing/refused/wrong-id focused records out of the unrelated register %j',async response=>{
 seedVisibleRow();h.rpc.mockResolvedValue(response);await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[focusedId]}/>));
 expect(host.textContent).not.toContain('Catalog service');expect(host.textContent).not.toContain('Older recurring service');expect(button('Retry invoice')).toBeDefined();expect(host.textContent).not.toContain('Create invoice');
});
it('retries a failed focused record and returns to the original filtered list only on explicit back',async()=>{
 seedVisibleRow();field('Search invoices','No visible match');const clear=vi.fn(()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[]} onClearInvoiceFocus={clear}/>));
 h.rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValue({data:focusedRecord(),error:null});
 await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[focusedId]} onClearInvoiceFocus={clear}/>));
 await act(async()=>button('Retry invoice').click());expect(host.textContent).toContain('Older recurring service');act(()=>button('Back to invoices').focus());expect(document.activeElement).toBe(button('Back to invoices'));click('Back to invoices');
 expect(clear).toHaveBeenCalledOnce();expect(host.textContent).toContain('No matching drafts');expect(host.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('No visible match');expect(document.activeElement).toBe(host.querySelector<HTMLInputElement>('input[type="search"]'));expect(host.textContent).not.toContain('Older recurring service');
});
it('holds a same-surface focused link until dirty draft close is explicitly allowed',async()=>{
 fill();h.rpc.mockResolvedValue({data:focusedRecord(),error:null});await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[focusedId]}/>));
 expect(host.querySelector('input[value="Custom service"]')).not.toBeNull();expect(h.rpc).not.toHaveBeenCalled();click('Back to records');click('Continue editing');expect(h.rpc).not.toHaveBeenCalled();
 click('Back to records');await act(async()=>button('Discard changes').click());expect(host.textContent).toContain('Older recurring service');expect(h.save).not.toHaveBeenCalled();
});
it('preserves draft review when a same-surface exact invoice link arrives',async()=>{
 fill();act(()=>{Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.startsWith('Email invoice'))!.querySelector('input')!.click();});click('Review invoice');await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[focusedId]}/>));
 expect(host.textContent).toContain('Custom service');expect(button('Save and review publication')).toBeDefined();expect(h.rpc).not.toHaveBeenCalled();expect(h.save).not.toHaveBeenCalled();
});
it('keeps a pending original save mounted when a same-surface exact invoice link arrives',async()=>{
 fill();let resolve!:(value:unknown)=>void;h.save.mockImplementation(()=>new Promise(r=>{resolve=r;}));await act(async()=>button('Save draft').click());
 await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[focusedId]}/>));expect(button('Back to records').disabled).toBe(true);expect(h.rpc).not.toHaveBeenCalled();
 await act(async()=>resolve({ok:false,outcome:'refused',message:'Access refused'}));expect(host.querySelector('input[value="Custom service"]')).not.toBeNull();expect(host.textContent).toContain('Access refused');expect(h.rpc).not.toHaveBeenCalled();
});
it('preserves unknown original draft recovery when a focused link arrives',async()=>{
 fill();h.save.mockResolvedValueOnce({ok:false,outcome:'unknown',message:'Unknown save'});await act(async()=>button('Save draft').click());const original=h.save.mock.calls[0][0];h.rpc.mockResolvedValue({data:focusedRecord(),error:null});
 await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[focusedId]}/>));expect(button('Back to records').disabled).toBe(true);expect(h.rpc).not.toHaveBeenCalled();expect(host.querySelector('input[value="Custom service"]')).not.toBeNull();
 h.save.mockResolvedValue({ok:true,value:{id:original.invoiceId,version:1}});await act(async()=>button('Recover original save').click());expect(h.save.mock.calls[1][0]).toBe(original);expect(host.textContent).toContain('Older recurring service');
});

const secondFocusedId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function pageButton(text:string){return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===text)!;}
function issuedFocusRecord(id:string){return focusedRecord({id,status:'issued',invoice_number:'INV-saved',version:2,issued_snapshot_version:1,document:{},document_input_digest:'a'.repeat(64)});}
function lifecycleReads(){
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('<p>Local invoice preview</p>')));
 HTMLElement.prototype.scrollIntoView??=()=>{};
 h.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>({data:name==='read_sales_invoice'?issuedFocusRecord(String(args._invoice_id)):name==='list_sales_invoice_payment_operations'?{rows:[]}:[],error:null}));
}
async function openVoidReview(origin:'focused'|'register'){
 lifecycleReads();
 if(origin==='register'){seedVisibleRow();(h.rows[0] as {status:string}).status='issued';await act(async()=>root.render(<SalesBillingWorkspace view="invoices"/>));}
 else await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[focusedId]}/>));
 await act(async()=>button('Open actions & records').click());await act(async()=>pageButton('Void invoice').click());
 const reason=Array.from(document.querySelectorAll('label')).find(l=>l.textContent?.startsWith('Reason for voiding'))!.querySelector('textarea')!;
 act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(reason,'Review the original saved invoice');reason.dispatchEvent(new Event('input',{bubbles:true}));});
 return reason;
}
it.each(['focused','register'] as const)('retains the %s invoice action and dirty void form until its canonical close allows the next focused link',async origin=>{
 const reason=await openVoidReview(origin);await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[secondFocusedId]}/>));
 expect(reason.isConnected).toBe(true);expect(reason.value).toBe('Review the original saved invoice');expect(h.rpc.mock.calls.some(([name,args])=>name==='read_sales_invoice'&&args._invoice_id===secondFocusedId)).toBe(false);
 const originalId=origin==='focused'?focusedId:'44444444-4444-4444-8444-444444444444';
 await act(async()=>window.dispatchEvent(new Event(`invoice-workspace-close:${h.tenant}:${originalId}`)));expect(pageButton('Continue editing')).toBeDefined();
 await act(async()=>pageButton('Continue editing').click());expect(reason.isConnected).toBe(true);expect(h.rpc.mock.calls.some(([name,args])=>name==='read_sales_invoice'&&args._invoice_id===secondFocusedId)).toBe(false);
 await act(async()=>window.dispatchEvent(new Event(`invoice-workspace-close:${h.tenant}:${originalId}`)));await act(async()=>pageButton('Discard changes').click());
 expect(h.rpc.mock.calls.some(([name,args])=>name==='read_sales_invoice'&&args._invoice_id===secondFocusedId)).toBe(true);expect(h.invoke).not.toHaveBeenCalled();
});
it.each(['focused','register'] as const)('retains the %s original pending/unknown command and recovery identity across incoming focus',async origin=>{
 await openVoidReview(origin);await act(async()=>pageButton('Review void').click());let resolve!:(value:unknown)=>void;
 h.invoke.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await act(async()=>pageButton('Prepare review').click());const original=h.invoke.mock.calls[0][1].body;
 await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[secondFocusedId]}/>));expect(pageButton('Checking…').disabled).toBe(true);expect(h.rpc.mock.calls.some(([name,args])=>name==='read_sales_invoice'&&args._invoice_id===secondFocusedId)).toBe(false);
 await act(async()=>resolve({data:{outcome:'unknown'},error:null}));expect(pageButton('Recover original operation')).toBeDefined();expect(pageButton('Cancel').disabled).toBe(true);
 h.invoke.mockResolvedValue({data:{outcome:'refused',message:'Synthetic refusal'},error:null});await act(async()=>pageButton('Recover original operation').click());
 expect(h.invoke.mock.calls[1][1].body).toEqual(original);expect(h.rpc.mock.calls.some(([name,args])=>name==='read_sales_invoice'&&args._invoice_id===secondFocusedId)).toBe(false);
});
it('shows only a loading state while the exact saved invoice is unresolved',async()=>{
 seedVisibleRow();let resolve!:(value:unknown)=>void;h.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await act(async()=>root.render(<SalesBillingWorkspace view="invoices" focusInvoiceIds={[focusedId]}/>));expect(host.textContent).toContain('Reading this invoice');expect(host.textContent).not.toContain('Catalog service');expect(host.textContent).not.toContain('Create invoice');
 await act(async()=>resolve({data:focusedRecord(),error:null}));expect(host.textContent).toContain('Older recurring service');
});
