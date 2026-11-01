import {expect,it} from 'vitest';
import {collectInvoiceLedger as collect} from '../../../supabase/functions/_shared/sales-invoice-ledger';
const digest='a'.repeat(64),revision='b'.repeat(64);
function page(more=false,count=1,ordinal=1){
 return {invoice_id:'original-invoice',version:5,status:'issued',currency:'usd',document_input_digest:digest,
 document:{currency:'usd',invoice_number:'INV-1',snapshot:{memo:'Original retained document'}},
 payment_evidence_version:2,financial_evidence_version:3,remaining_cents:7000,
 manual_recorded_cents:0,provider_verified_cents:5000,test_provider_verified_cents:2500,allocated_cents:5000,
 financial_summary:{schema_version:3,invoice_id:'original-invoice',invoice_version:5,currency:'usd',standing:'recorded',
 outstanding_minor:7000,refund_payable_minor:0,credit_minor:0,manual_recorded_minor:0,provider_confirmed_minor:5000,provider_net_minor:3000,test_provider_minor:2500,source_hash:revision},
 payment_ledger:{rows:Array.from({length:count===0?0:1},()=>({id:'original-'+ordinal})),count,as_of:'2026-11-01',receipt_total_cents:7500,reversal_total_cents:0},
 has_more:more,next_cursor:more?{ordinal}:null};
}
function client(pages:unknown[],headers:string[][]=[],calls:Array<{name:string;args:Record<string,unknown>}> = []){
 return {rpc:(name:string,args:Record<string,unknown>)=>{calls.push({name,args});const q=Object.assign(Promise.resolve({data:pages.shift(),error:null}),{setHeader(key:string,value:string){headers.push([key,value]);return q;}});return q;}};
}
it('default document reads request the current representation on the same original scoped RPC',async()=>{
 const headers:string[][]=[],calls:Array<{name:string;args:Record<string,unknown>}>=[];const p=page();const result=await collect(client([p],headers,calls),'read_sales_invoice_payment_ledger',{_expected_tenant_id:'original-business',_invoice_id:'original-invoice'});
 expect(result).toMatchObject({financial_evidence_version:3,remaining_cents:7000,ledger_complete:true});expect(result?.financial_summary).toEqual(p.financial_summary);
 expect(headers).toEqual([['X-PAIGE-Invoice-Evidence-Version','3']]);expect(calls).toEqual([{name:'read_sales_invoice_payment_ledger',args:{_expected_tenant_id:'original-business',_invoice_id:'original-invoice',_limit:100,_cursor:null}}]);
});
it('valid older source is refused by an explicit current document read without fallback',async()=>{
 const older={...page(),financial_evidence_version:undefined,financial_summary:undefined};const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 expect(await collect(client([older],[],calls),'client_portal_invoice_ledger',{p_invoice_id:'original-invoice'})).toBeNull();expect(calls).toHaveLength(1);
});
it('a transport unable to request current native evidence cannot pretend to obtain it',async()=>{
 expect(await collect({rpc:async()=>({data:page(),error:null})},'client_portal_invoice_ledger',{})).toBeNull();
});
it.each([{invoice_id:'foreign'},{invoice_version:6},{currency:'eur'},{source_hash:null},{outstanding_minor:0},{schema_version:2},{extra:'private'}])('refuses malformed or contradictory current financial summary %j',async patch=>{
 const p=page();expect(await collect(client([{...p,financial_summary:{...p.financial_summary,...patch}}]),'read_sales_invoice_payment_ledger',{_invoice_id:'original-invoice'})).toBeNull();
});
it('binds current financial identity to the exact requested original invoice',async()=>{
 expect(await collect(client([page()]),'read_sales_invoice_payment_ledger',{_invoice_id:'another-invoice'})).toBeNull();
});
it('original same-source paging keeps all current native facts and cursor',async()=>{
 const headers:string[][]=[],calls:Array<{name:string;args:Record<string,unknown>}>=[];const result=await collect(client([page(true,2,1),page(false,2,2)],headers,calls),'read_public_sales_invoice_payment_ledger',{_token_hash:'synthetic-original-hash'});
 expect(result?.ledger_complete).toBe(true);expect((result?.payment_ledger as {rows:unknown[]}).rows).toHaveLength(2);
 expect(headers.every(h=>h[1]==='3')).toBe(true);expect(calls[1].args).toEqual({_token_hash:'synthetic-original-hash',_limit:100,_cursor:{ordinal:1}});
});
it('an equal-amount changed financial source cannot produce one mixed document',async()=>{
 const next=page(false,2,2);next.financial_summary.source_hash='c'.repeat(64);
 expect(await collect(client([page(true,2,1),next]),'client_portal_invoice_ledger',{p_invoice_id:'original-invoice'})).toBeNull();
});
it('unknown debt remains null in a complete current record, without a zero conversion',async()=>{
 const p=page(),held={...p,remaining_cents:null,financial_summary:{...p.financial_summary,standing:'needs_review',outstanding_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null}};
 expect(await collect(client([held]),'client_portal_invoice_ledger',{p_invoice_id:'original-invoice'})).toMatchObject({remaining_cents:null,financial_summary:{standing:'needs_review',outstanding_minor:null},ledger_complete:true});
});
it('current source does not waive retained document identity or original cursor protections',async()=>{
 const next={...page(false,2,2),document_input_digest:'c'.repeat(64)};
 expect(await collect(client([page(true,2,1),next]),'read_sales_invoice_payment_ledger',{})).toBeNull();
 const same=page(true,20,1),calls:Array<{name:string;args:Record<string,unknown>}>=[];
 expect(await collect(client([same,same],[],calls),'client_portal_invoice_ledger',{})).toBeNull();expect(calls).toHaveLength(2);
});
it('current source retains the original1000 history cap without claiming complete',async()=>{
 let count=0;const result=await collect({rpc:()=>{count++;const p=page(true,1001,count*100);p.payment_ledger.rows=Array.from({length:100},(_,i)=>({id:'record-'+(count*100+i)}));return Object.assign(Promise.resolve({data:p,error:null}),{setHeader(){return this;}});}},'read_sales_invoice_payment_ledger',{});
 expect(count).toBe(10);expect(result?.ledger_complete).toBe(false);expect((result?.payment_ledger as {rows:unknown[]}).rows).toHaveLength(1000);
});
it('legacy compatibility is an explicit accurate representation, separate from the default current read',async()=>{
 const old={...page(false,0),financial_evidence_version:undefined,financial_summary:undefined};delete old.financial_evidence_version;delete old.financial_summary;
 const headers:string[][]=[];expect(await collect(client([old],headers),'client_portal_invoice_ledger',{},2)).not.toBeNull();expect(headers).toEqual([['X-PAIGE-Invoice-Evidence-Version','2']]);
});
