import {beforeEach,expect,it,vi} from 'vitest';
import {invoiceDisplayState,owedPhrase,parseInvoicePage,readPortalInvoices,readPortalInvoicePayment,type PortalBillingReadContext} from './useClientPortalInvoices';

const f=vi.hoisted(()=>({reply:vi.fn(),calls:[] as Array<{name:string;args:Record<string,unknown>;headers:Record<string,string>}>}));
const actor='e044c211-0000-4000-8000-000000000001',tenant='e044c211-0000-4000-8000-000000000002',client='e044c211-0000-4000-8000-000000000003',invoiceId='e044c211-0000-4000-8000-000000000004';
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(name:string,args:Record<string,unknown>)=>{
 const headers:Record<string,string>={};const query={setHeader:(key:string,value:string)=>{headers[key]=value;return query;},then:(resolve:(value:unknown)=>unknown,reject?:(reason:unknown)=>unknown)=>Promise.resolve().then(()=>{const call={name,args,headers:{...headers}};f.calls.push(call);return f.reply(call);}).then(resolve,reject)};return query;
},auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getSession:async()=>({data:{session:{user:{id:actor},access_token:'synthetic-current-financial-read'}},error:null})}}}));
const context:PortalBillingReadContext={scope:{actorId:actor,tenantId:tenant,clientId:client},current:()=>true};
const fields={financial_standing:'recorded',refund_payable_minor:'15000',credit_minor:'20000',provider_net_minor:'-1000'};
const page=(row:Record<string,unknown>={},balance:Record<string,unknown>={})=>({schema_version:4,payment_evidence_version:2,financial_evidence_version:3,financial_revision:'a'.repeat(64),tenant_id:tenant,business_name:'Test Advisory',
 invoices:[{financial_revision:'a'.repeat(64),id:invoiceId,invoice_number:'SYN-1',status:'issued',currency:'usd',issued_at:'2026-10-29T00:15:00Z',due_date:'2026-11-01',issued_snapshot_version:1,amount_minor:'350000',remaining_minor:'210000',provider_verified_minor:'50000',manual_recorded_minor:'70000',test_provider_minor:'50000',payable:false,past_due:false,...fields,...row}],
 balances:[{currency:'usd',remaining_minor:'210000',provider_verified_minor:'50000',manual_recorded_minor:'70000',test_provider_minor:'50000',...fields,...balance}],invoice_count:1,open_count:1,has_more:false,next_cursor:null,read_at:'2026-11-01T00:15:00Z',calendar:{state:'configured',zone:'America/New_York',local_date:'2026-10-31'}});
const payment=(patch:Record<string,unknown>={})=>({invoice_id:invoiceId,invoice_number:'SYN-1',remaining_cents:210000,test_provider_cents:50000,payment_evidence_version:2,financial_evidence_version:3,financial_revision:'a'.repeat(64),financial_standing:'recorded',refund_payable_minor:15000,credit_minor:20000,provider_net_minor:-1000,payment_request:null,...patch});
beforeEach(()=>{f.calls=[];f.reply.mockReset();f.reply.mockResolvedValue({data:page(),error:null});});

it('copies current debt, credits, refund liability and signed net without redoing allocation math',()=>{
 const p=parseInvoicePage(page())!,i=p.invoices[0];expect(i).toMatchObject({remaining_minor:210000,refund_payable_minor:15000,credit_minor:20000,provider_net_minor:-1000,financial_evidence_version:3,financial_standing:'recorded'});
 expect(p.balances[0]).toMatchObject({remaining_minor:210000,refund_payable_minor:15000,credit_minor:20000,provider_net_minor:-1000});expect(invoiceDisplayState(i)).toBe('refund_owed');
});
it.each(['needs_review','allocation_required','unavailable'])('retains %s null money and unknown aggregate rather than paid/zero',standing=>{
 const held={financial_standing:standing,remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null,past_due:null};const p=parseInvoicePage({...page(held,{financial_standing:'needs_review',remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null}),open_count:null})!;
 expect(p.open_count).toBeNull();expect(p.invoices[0].remaining_minor).toBeNull();expect(p.balances[0].remaining_minor).toBeNull();expect(invoiceDisplayState(p.invoices[0])).toBe('verification_pending');expect(owedPhrase(p.balances)).toBe('Balance awaiting verification');
});
it('zero after an authorized credit says no amount due without claiming provider payment',()=>{
 const i=parseInvoicePage(page({remaining_minor:'0',refund_payable_minor:'0',credit_minor:'350000',payable:false}))!.invoices[0];expect(invoiceDisplayState(i)).toBe('no_amount_due');
});
it('current void retains its distinct not-applicable state',()=>{
 const i=parseInvoicePage(page({status:'void',financial_standing:'not_applicable',remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null,past_due:false,payable:false}))!.invoices[0];expect(invoiceDisplayState(i)).toBe('voided');
});
it.each([{remaining_minor:null},{refund_payable_minor:null},{credit_minor:'-1'},{provider_net_minor:'1.5'},{financial_standing:'paid'},{financial_standing:'not_applicable'},{_native_sources:{private:true}}])('refuses malformed current invoice %j',patch=>{
 expect(()=>parseInvoicePage(page(patch))).toThrow();
});
it('refuses held financial facts with a fabricated amount, pay flag or overdue judgment',()=>{
 for(const extra of [{remaining_minor:'0'},{payable:true},{past_due:true}])expect(()=>parseInvoicePage(page({financial_standing:'needs_review',remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null,past_due:null,...extra}))).toThrow();
});
it('explicit current reads use the original scoped transport/identity and header3',async()=>{
 expect((await readPortalInvoices({context,financialVersion:3}))?.invoices[0].remaining_minor).toBe(210000);expect(f.calls).toEqual([{name:'client_portal_invoices_calendar_scoped',args:{p_tenant_id:tenant,p_expected_client_id:client,p_limit:20,p_after:null},headers:{'x-client-portal-business':tenant,Authorization:'Bearer synthetic-current-financial-read','X-PAIGE-Invoice-Evidence-Version':'3'}}]);
});
it('explicit current requests refuse a valid older server representation without unscoped fallback',async()=>{
 const old:Record<string,unknown>={...page(),schema_version:3};delete old.financial_evidence_version;delete old.financial_revision;for(const row of [...old.invoices as Array<Record<string,unknown>>,...old.balances as Array<Record<string,unknown>>])for(const k of [...Object.keys(fields),'financial_revision'])delete row[k];
 f.reply.mockResolvedValue({data:old,error:null});await expect(readPortalInvoices({context,financialVersion:3})).rejects.toThrow();expect(f.calls).toHaveLength(1);
});
it('per-invoice current read retains the same nullable source facts and header',async()=>{
 f.reply.mockResolvedValue({data:payment({financial_standing:'needs_review',remaining_cents:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null}),error:null});
 expect(await readPortalInvoicePayment({invoiceId,tenantId:tenant,context,financialVersion:3})).toMatchObject({state:'ready',remainingMinor:null,financialEvidenceVersion:3,financialStanding:'needs_review',refundPayableMinor:null,creditMinor:null,providerNetMinor:null,request:null});expect(f.calls[0].headers['X-PAIGE-Invoice-Evidence-Version']).toBe('3');
});
it('per-invoice current read copies separate known financial facts',async()=>{
 f.reply.mockResolvedValue({data:payment(),error:null});expect(await readPortalInvoicePayment({invoiceId,tenantId:tenant,context,financialVersion:3})).toMatchObject({remainingMinor:210000,refundPayableMinor:15000,creditMinor:20000,providerNetMinor:-1000,financialEvidenceVersion:3});
});
it.each([{financial_evidence_version:2},{financial_evidence_version:undefined},{remaining_cents:null},{refund_payable_minor:null},{provider_net_minor:'-1000'},{source_hash:'private'},{financial_standing:'needs_review',remaining_cents:0}])('current payment refuses malformed/private/stale shape %j',async patch=>{
 f.reply.mockResolvedValue({data:payment(patch),error:null});await expect(readPortalInvoicePayment({invoiceId,tenantId:tenant,context,financialVersion:3})).rejects.toThrow();expect(f.calls).toHaveLength(1);
});

it.each([undefined,null,'not-a-revision',{},'A'.repeat(64)])('refuses an absent or malformed current page revision %j',revision=>{
 expect(()=>parseInvoicePage({...page(),financial_revision:revision})).toThrow();
});
it.each([undefined,null,'bad',{}])('a recorded invoice cannot omit or forge its original financial revision %j',revision=>{
 expect(()=>parseInvoicePage(page({financial_revision:revision}))).toThrow();
});
it.each([undefined,null,'bad',{}])('a recorded payment cannot omit or forge its original financial revision %j',async revision=>{
 f.reply.mockResolvedValue({data:payment({financial_revision:revision}),error:null});await expect(readPortalInvoicePayment({invoiceId,tenantId:tenant,context,financialVersion:3})).rejects.toThrow();
});
