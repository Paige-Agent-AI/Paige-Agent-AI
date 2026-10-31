import {beforeEach,expect,it,vi} from 'vitest';
import {invoiceDisplayState,liveProviderMinor,parseInvoicePage,readPortalInvoices,type PortalBillingReadContext} from './useClientPortalInvoices';

const f=vi.hoisted(()=>({reply:vi.fn(),calls:[] as Array<{name:string;args:Record<string,unknown>;headers:Record<string,string>}>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(name:string,args:Record<string,unknown>)=>{
 const headers:Record<string,string>={};const query={setHeader:(key:string,value:string)=>{headers[key]=value;return query;},
  then:(resolve:(value:unknown)=>unknown,reject?:(reason:unknown)=>unknown)=>Promise.resolve().then(()=>{
   const call={name,args,headers:{...headers}};f.calls.push(call);return f.reply(call);
  }).then(resolve,reject)};return query;
 },auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),
  getSession:async()=>({data:{session:{user:{id:actor},access_token:'synthetic-financial-read'}},error:null})}}}));
const actor='e0446500-0000-4000-8000-000000000001',tenant='e0446500-0000-4000-8000-000000000002',client='e0446500-0000-4000-8000-000000000003';
const context:PortalBillingReadContext={scope:{actorId:actor,tenantId:tenant,clientId:client},current:()=>true};
const financialPage=(patch:Record<string,unknown>={})=>({
 schema_version:3,payment_evidence_version:2,tenant_id:tenant,business_name:'Test Advisory',
 invoices:[{id:'e0446500-0000-4000-8000-000000000004',invoice_number:'TEST-001',status:'issued',currency:'usd',issued_at:'2026-10-29T00:15:00Z',due_date:'2026-11-01',issued_snapshot_version:1,
  amount_minor:'100000',remaining_minor:'100000',provider_verified_minor:'0',manual_recorded_minor:'0',test_provider_minor:'50000',payable:false,past_due:false,...patch}],
 balances:[{currency:'usd',remaining_minor:'100000',provider_verified_minor:'0',manual_recorded_minor:'0',test_provider_minor:'50000'}],
 invoice_count:1,open_count:1,has_more:false,next_cursor:null,read_at:'2026-10-29T00:15:00Z',
 calendar:{state:'configured',zone:'America/Los_Angeles',local_date:'2026-10-28'},
});
beforeEach(()=>{f.calls=[];f.reply.mockReset();f.reply.mockResolvedValue({data:financialPage(),error:null});});

it('keeps TEST confirmation separate from actual client debt and live provider cash',()=>{
 const page=parseInvoicePage(financialPage())!,invoice=page.invoices[0];
 expect(invoice).toMatchObject({remaining_minor:100000,provider_verified_minor:0,test_provider_minor:50000,payment_evidence_version:2});
 expect(page.balances[0]).toMatchObject({remaining_minor:100000,payment_evidence_version:2});
 expect(liveProviderMinor(invoice)).toBe(0);expect(invoiceDisplayState(invoice)).toBe('open');
});
it('never subtracts TEST a second time from the native LIVE amount',()=>{
 const invoice=parseInvoicePage(financialPage({remaining_minor:'50000',provider_verified_minor:'50000'}))!.invoices[0];
 expect(liveProviderMinor(invoice)).toBe(50000);expect(invoiceDisplayState(invoice)).toBe('partially_paid');
});
it('retains a mixed native business position and source-backed past-due state',()=>{
 const invoice=parseInvoicePage(financialPage({remaining_minor:'60000',provider_verified_minor:'30000',manual_recorded_minor:'10000',test_provider_minor:'20000',past_due:true}))!.invoices[0];
 expect(invoice.remaining_minor).toBe(60000);expect(liveProviderMinor(invoice)).toBe(30000);expect(invoiceDisplayState(invoice)).toBe('past_due');
});
it('actual real settlement stays paid even when separate historical TEST evidence exists',()=>{
 const invoice=parseInvoicePage(financialPage({remaining_minor:'0',provider_verified_minor:'100000'}))!.invoices[0];
 expect(liveProviderMinor(invoice)).toBe(100000);expect(invoiceDisplayState(invoice)).toBe('paid');
});
it('preserves both older calendar and legacy TEST simulation contracts without adding new evidence',()=>{
 const source:Record<string,unknown>={...financialPage({remaining_minor:'0',provider_verified_minor:'100000',test_provider_minor:'100000'}),schema_version:2};
 delete source.payment_evidence_version;
 const calendar=parseInvoicePage(source)!;expect(calendar.invoices[0]).not.toHaveProperty('payment_evidence_version');
 expect(liveProviderMinor(calendar.invoices[0])).toBe(0);expect(invoiceDisplayState(calendar.invoices[0])).toBe('test_settled');
 const legacy:Record<string,unknown>={...source,schema_version:1};delete legacy.calendar;
 legacy.invoices=(source.invoices as Array<Record<string,unknown>>).map(row=>{const original={...row};delete original.issued_snapshot_version;return original;});
 expect(parseInvoicePage(legacy)?.invoices[0]).not.toHaveProperty('payment_evidence_version');
});
it.each([undefined,null,1,3,'2',['2']])('rejects an unsupported financial representation marker %j',marker=>{
 expect(()=>parseInvoicePage({...financialPage(),payment_evidence_version:marker})).toThrow();
});
it('cannot smuggle a financial reinterpretation or private fields into old or new payloads',()=>{
 expect(()=>parseInvoicePage({...financialPage(),schema_version:2})).toThrow();
 expect(()=>parseInvoicePage({...financialPage(),_native_sources:{private:'not public'}})).toThrow();
 expect(()=>parseInvoicePage(financialPage({internal_notes:'not public'}))).toThrow();
});
it('uses the same one scoped read and identity while requesting only the financial representation',async()=>{
 const page=await readPortalInvoices({context});expect(page?.invoices[0].remaining_minor).toBe(100000);
 expect(f.calls).toEqual([{name:'client_portal_invoices_calendar_scoped',args:{p_tenant_id:tenant,p_expected_client_id:client,p_limit:20,p_after:null},
  headers:{'x-client-portal-business':tenant,Authorization:'Bearer synthetic-financial-read','X-PAIGE-Invoice-Evidence-Version':'2'}}]);
});
it('keeps a current old server response compatible without a second request or invented financial version',async()=>{
 const source:Record<string,unknown>={...financialPage(),schema_version:2};delete source.payment_evidence_version;
 f.reply.mockResolvedValue({data:source,error:null});const page=await readPortalInvoices({context});
 expect(page?.invoices[0]).not.toHaveProperty('payment_evidence_version');expect(f.calls).toHaveLength(1);
});
it('retains refusal and stale-context guards without an unscoped fallback',async()=>{
 f.reply.mockResolvedValue({data:null,error:{code:'42501',message:'CLIENT_INVOICE_UNAVAILABLE'}});
 await expect(readPortalInvoices({context})).rejects.toThrow();expect(f.calls).toHaveLength(1);
 f.calls=[];await expect(readPortalInvoices({context:{...context,current:()=>false}})).rejects.toThrow();expect(f.calls).toHaveLength(0);
});
it('refuses another business financial result under the original selected relationship',async()=>{
 f.reply.mockResolvedValue({data:{...financialPage(),tenant_id:'e0446500-0000-4000-8000-000000000099'},error:null});
 await expect(readPortalInvoices({context})).rejects.toThrow();expect(f.calls).toHaveLength(1);
});
