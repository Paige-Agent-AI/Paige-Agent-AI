import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import InvoiceDocument from './InvoiceDocument';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('reads the existing bearer grant and offers only current hosted checkout without dispatching money',async()=>{
 const token='a'.repeat(64),fetchMock=vi.fn(async(url:string)=>String(url).includes('format=payment-request')?new Response(JSON.stringify({remaining_cents:300000,payment_request:{amount_minor:50000,currency:'usd',state:'customer_action_required',provider_url:'https://checkout.stripe.com/c/pay/test',expires_at:new Date(Date.now()+60000).toISOString()}}),{headers:{'Content-Type':'application/json'}}):new Response('<html><body>Invoice</body></html>'));
 vi.stubGlobal('fetch',fetchMock);history.replaceState(null,'',`/invoice?token=${token}`);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>{root.render(<InvoiceDocument/>);await new Promise(r=>setTimeout(r,0));});expect(location.search).toBe('');expect(host.textContent).toContain('Payment requested');expect(host.textContent).not.toContain('Payment confirmed');expect(host.querySelector('a')?.href).toBe('https://checkout.stripe.com/c/pay/test');expect(host.querySelector('a')?.rel).toBe('noopener noreferrer');expect(fetchMock).toHaveBeenCalledTimes(2);for(const call of fetchMock.mock.calls){expect(call[0]).toContain('sales-invoice-document');expect(call[0]).not.toContain('sales-invoice-command');}}finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
