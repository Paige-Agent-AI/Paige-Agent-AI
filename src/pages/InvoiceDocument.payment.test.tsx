import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import InvoiceDocument from './InvoiceDocument';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const documentHeaders={'X-PAIGE-Invoice-Financial-Context':JSON.stringify({invoice_id:'test-invoice',invoice_version:2,source_hash:'a'.repeat(64),standing:'recorded'})};
function currentPacket(value:{remaining_cents:number;payment_request:{currency:string;[key:string]:unknown}}){
 return {...value,invoice_number:'INV-CURRENT',invoice_id:'test-invoice',invoice_version:2,currency:value.payment_request.currency,payment_evidence_version:2,financial_evidence_version:3,
  payment_request:{...value.payment_request,environment:'live'},financial_summary:{schema_version:3,invoice_id:'test-invoice',invoice_version:2,currency:value.payment_request.currency,
   standing:'recorded',outstanding_minor:value.remaining_cents,refund_payable_minor:0,credit_minor:0,manual_recorded_minor:0,provider_confirmed_minor:0,provider_net_minor:0,test_provider_minor:0,source_hash:'a'.repeat(64)}};
}

it('reads the existing bearer grant and offers only current hosted checkout without dispatching money',async()=>{
 const token='a'.repeat(64),fetchMock=vi.fn(async(url:string)=>String(url).includes('format=payment-request')?new Response(JSON.stringify(currentPacket({remaining_cents:300000,payment_request:{amount_minor:50000,currency:'usd',state:'customer_action_required',provider_url:'https://checkout.stripe.com/c/pay/test',expires_at:new Date(Date.now()+60000).toISOString()}})),{headers:{'Content-Type':'application/json'}}):new Response('<html><body>Invoice</body></html>',{headers:documentHeaders}));
 vi.stubGlobal('fetch',fetchMock);history.replaceState(null,'',`/invoice?token=${token}`);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>{root.render(<InvoiceDocument/>);await new Promise(r=>setTimeout(r,0));});expect(location.search).toBe('');expect(host.textContent).toContain('Payment requested');expect(host.textContent).not.toContain('Payment confirmed');expect(host.querySelector('a')?.href).toBe('https://checkout.stripe.com/c/pay/test');expect(host.querySelector('a')?.rel).toBe('noopener noreferrer');expect(fetchMock).toHaveBeenCalledTimes(2);for(const call of fetchMock.mock.calls){expect(call[0]).toContain('sales-invoice-document');expect(call[0]).not.toContain('sales-invoice-command');}}finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});

it.each([
 {currency:'usd',expected:'$90,071,992,547,409.91'},
 {currency:'kwd',expected:'KWD\u00a09,007,199,254,740.991'},
 {currency:'jpy',expected:'¥9,007,199,254,740,991'},
 {currency:'zzz',expected:'ZZZ 9007199254740991 (minor units; currency precision unavailable)'},
])('the actual invoice renders exact $currency source units without claiming settlement',async({currency,expected})=>{
 const fetchMock=vi.fn(async(url:string)=>String(url).includes('format=payment-request')?new Response(JSON.stringify(currentPacket({remaining_cents:Number.MAX_SAFE_INTEGER,payment_request:{amount_minor:Number.MAX_SAFE_INTEGER,currency,state:'provider_accepted',provider_url:'https://checkout.stripe.com/c/pay/test',expires_at:new Date(Date.now()+60000).toISOString()}})),{headers:{'Content-Type':'application/json'}}):new Response('<html><body>Synthetic original invoice</body></html>',{headers:documentHeaders}));
 vi.stubGlobal('fetch',fetchMock);history.replaceState(null,'','/invoice?token='+'b'.repeat(64));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>{root.render(<InvoiceDocument/>);await new Promise(r=>setTimeout(r,0));});
  expect(host.textContent).toContain('Outstanding balance: '+expected);
  expect(host.textContent).toContain('Payment has not been confirmed yet');
  expect(host.textContent).not.toContain('Payment confirmed');
  expect(host.querySelector('a')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(location.search).toBe('');
 }finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
