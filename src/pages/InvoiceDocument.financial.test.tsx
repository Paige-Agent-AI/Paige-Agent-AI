import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,it,expect,vi} from 'vitest';
import InvoiceDocument from './InvoiceDocument';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const context=(hash='a'.repeat(64),standing='recorded')=>({invoice_id:'test-invoice',invoice_version:2,source_hash:hash as string|null,standing});
const packet=(changes:Record<string,unknown>={}):Record<string,unknown>&{financial_summary:Record<string,unknown>}=>({
 invoice_number:'INV-CURRENT',invoice_id:'test-invoice',invoice_version:2,currency:'usd',remaining_cents:210000,
 payment_evidence_version:2,financial_evidence_version:3,payment_request:null,
 financial_summary:{schema_version:3,invoice_id:'test-invoice',invoice_version:2,currency:'usd',standing:'recorded',outstanding_minor:210000,
  refund_payable_minor:15000,credit_minor:20000,manual_recorded_minor:50000,provider_confirmed_minor:85000,provider_net_minor:70000,test_provider_minor:30000,source_hash:'a'.repeat(64)},...changes});
const doc=(value=context())=>new Response('<html><body>Original issued document</body></html>',{headers:{'X-PAIGE-Invoice-Financial-Context':JSON.stringify(value)}});
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
async function mount(fetchMock:ReturnType<typeof vi.fn>){
 vi.stubGlobal('fetch',fetchMock);history.replaceState(null,'','/invoice?token='+'b'.repeat(64));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>{root.render(<InvoiceDocument/>);await new Promise(r=>setTimeout(r,0));});
 return {host,close:()=>{act(()=>root.unmount());host.remove();}};
}
async function click(host:HTMLElement,text:string){
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent===text);expect(button).toBeTruthy();
 await act(async()=>{button!.click();await new Promise(r=>setTimeout(r,0));});
}
afterEach(()=>vi.unstubAllGlobals());
it('shows current outstanding, credit and refund separately from historical TEST money',async()=>{
 const h=await mount(vi.fn(async(url:string)=>url.includes('format=payment-request')?json(packet()):doc()));
 try{expect(h.host.textContent).toContain('Outstanding balance: $2,100.00');expect(h.host.textContent).toContain('Refund still due: $150.00');expect(h.host.textContent).toContain('Credit applied: $200.00');
  expect(h.host.textContent).toContain('TEST payment evidence: $300.00. No money moved.');expect(h.host.textContent).not.toContain('Payment confirmed');expect(h.host.querySelector('a')).toBeNull();expect(location.search).toBe('');
 }finally{h.close();}
});
it.each(['unavailable','needs_review','allocation_required'])('retains unknown amounts and no checkout for %s',async standing=>{
 const value=packet();Object.assign(value.financial_summary,{standing,outstanding_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null,source_hash:null});
 const current={...value,remaining_cents:null};
 const h=await mount(vi.fn(async(url:string)=>url.includes('format=payment-request')?json(current):doc({...context(),standing,source_hash:null})));
 try{expect(h.host.textContent).toContain('Balance awaiting verification');expect(h.host.textContent).not.toContain('No amount due');expect(h.host.textContent).not.toContain('Outstanding balance: $0');expect(h.host.querySelector('a')).toBeNull();}finally{h.close();}
});
it('zero debt with a credit never asserts that money was collected',async()=>{
 const value=packet();value.remaining_cents=0;value.financial_summary.outstanding_minor=0;
 const h=await mount(vi.fn(async(url:string)=>url.includes('format=payment-request')?json(value):doc()));
 try{expect(h.host.textContent).toContain('No amount due');expect(h.host.textContent).toContain('Credit applied');expect(h.host.textContent).not.toContain('Paid');expect(h.host.querySelector('a')).toBeNull();}finally{h.close();}
});
it('marks a TEST checkout separately from actual money',async()=>{
 const value=packet({payment_request:{amount_minor:50000,currency:'usd',state:'customer_action_required',environment:'test',provider_url:'https://checkout.stripe.com/c/pay/test',expires_at:'2099-01-01T00:00:00Z'}});
 const h=await mount(vi.fn(async(url:string)=>url.includes('format=payment-request')?json(value):doc()));
 try{expect(h.host.textContent).toContain('TEST checkout. No real payment will be collected.');expect(h.host.querySelector('a')?.textContent).toBe('Continue to TEST checkout');}finally{h.close();}
});
it('retires mismatched document and link, then recovers through the SAME bearer without a payment write',async()=>{
 let changed=false,docs=0;const fetchMock=vi.fn(async(url:string)=>{
  if(url.includes('format=payment-request')){const value=packet();if(changed)value.financial_summary.source_hash='b'.repeat(64);return json(value);}
  docs++;return doc(context(changed?'b'.repeat(64):'a'.repeat(64)));
 });
 const h=await mount(fetchMock);
 try{changed=true;await click(h.host,'Refresh payment status');expect(h.host.textContent).toContain('This invoice changed.');expect(h.host.querySelector('iframe')).toBeNull();expect(h.host.querySelector('a')).toBeNull();
  expect([...h.host.querySelectorAll('button')].find(b=>b.textContent==='Download PDF')?.disabled).toBe(true);
  await click(h.host,'Refresh invoice');expect(docs).toBe(2);expect(h.host.querySelector('iframe')).toBeTruthy();expect(h.host.textContent).toContain('Outstanding balance: $2,100.00');
  expect(h.host.textContent).not.toContain('This invoice changed.');expect(location.search).toBe('');
  expect(fetchMock.mock.calls.every(([url])=>String(url).includes('sales-invoice-document?token=')&&!String(url).includes('command'))).toBe(true);
 }finally{h.close();}
});
it('refuses an older financial payload and retries without guessing zero or reissuing a payment',async()=>{
 let fail=true;const fetchMock=vi.fn(async(url:string)=>url.includes('format=payment-request')?json(fail?{remaining_cents:0,payment_request:null}:packet()):doc());
 const h=await mount(fetchMock);try{expect(h.host.textContent).toContain('Payment status could not be checked.');expect(h.host.textContent).not.toContain('No amount due');expect(h.host.querySelector('a')).toBeNull();
  fail=false;await click(h.host,'Refresh payment status');expect(h.host.textContent).toContain('Outstanding balance: $2,100.00');expect(fetchMock).toHaveBeenCalledTimes(3);
 }finally{h.close();}
});
