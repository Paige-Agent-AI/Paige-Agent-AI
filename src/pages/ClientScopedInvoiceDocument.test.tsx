import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ClientScopedInvoiceDocument from './ClientScopedInvoiceDocument';

const id=(n:number)=>`ec041104-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),target={tenantId:id(2),clientId:id(3),invoiceId:id(4)};
const fixture=vi.hoisted(()=>({user:vi.fn(),session:vi.fn(),profile:vi.fn(),raw:vi.fn(),listen:vi.fn(),unsubscribe:vi.fn(),download:vi.fn(),listener:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:fixture.user,getSession:fixture.session,onAuthStateChange:fixture.listen},
  from:fixture.raw,rpc:fixture.profile}}));
vi.mock('@/solo/sales/invoicePdf',async original=>({...await original<typeof import('@/solo/sales/invoicePdf')>(),downloadInvoicePdf:fixture.download}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;const fetchMock=vi.fn();
const html=()=>new Response('<html><body>Frozen client invoice</body></html>',{headers:{'Content-Type':'text/html'}});
beforeEach(()=>{
  fixture.user.mockReset().mockResolvedValue({data:{user:{id:actor}},error:null});
  fixture.session.mockReset().mockResolvedValue({data:{session:{user:{id:actor},access_token:'synthetic-transport-only'}},error:null});
  fixture.profile.mockReset().mockResolvedValue({data:{id:target.clientId,tenant_id:target.tenantId,linked_user_id:actor},error:null});
  fixture.raw.mockReset().mockImplementation(()=>{throw Error('Raw CRM fallback is forbidden');});
  fixture.listen.mockReset().mockImplementation(listener=>{fixture.listener=listener;return {data:{subscription:{unsubscribe:fixture.unsubscribe}}};});
  fixture.download.mockReset();fixture.unsubscribe.mockReset();fetchMock.mockReset().mockImplementation(async()=>html());
  vi.stubGlobal('fetch',fetchMock);history.replaceState(null,'','/invoice?'+new URLSearchParams({invoice_id:target.invoiceId,tenant_id:target.tenantId,client_id:target.clientId}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();fixture.listener=null;vi.unstubAllGlobals();history.replaceState(null,'','/');expect(fixture.raw).not.toHaveBeenCalled();expect(fixture.profile.mock.calls.every(([name,args])=>name==='client_portal_self_profile'&&args!==null&&typeof args==='object'&&Object.keys(args).length===0)).toBe(true);});
const render=async(selected=target)=>{await act(async()=>{root.render(<ClientScopedInvoiceDocument target={selected}/>);});};
it('loads the exact scoped invoice with header-only session transport and stable reload identity',async()=>{
  await render();expect(host.querySelector('iframe')?.srcdoc).toContain('Frozen client invoice');
  expect(fixture.profile).toHaveBeenCalledWith('client_portal_self_profile',{});
  expect(location.search).toContain('invoice_id=');expect(location.search).not.toContain('token=');
  const [url,options]=fetchMock.mock.calls[0];expect(url).toContain('client_id='+target.clientId);expect(url).toContain('invoice_id='+target.invoiceId);
  expect(url).not.toContain('synthetic-transport-only');expect(options).toMatchObject({cache:'no-store',referrerPolicy:'no-referrer',headers:{Authorization:'Bearer synthetic-transport-only'}});
  expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-same-origin allow-modals');
});
it('refuses another client before fetching a document',async()=>{
  await render({...target,clientId:id(8)});expect(fetchMock).not.toHaveBeenCalled();expect(host.querySelector('iframe')).toBeNull();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('unavailable');
});
it('scrubs the document immediately on actual sign-out',async()=>{
  await render();expect(host.querySelector('iframe')).not.toBeNull();act(()=>fixture.listener?.('SIGNED_OUT',null));
  expect(host.querySelector('iframe')).toBeNull();expect(host.textContent).toContain('unavailable');
});
it('does not restore a late document after sign-out',async()=>{
  let resolve!:(value:Response)=>void;fetchMock.mockImplementation(()=>new Promise(r=>{resolve=r;}));await render();
  act(()=>fixture.listener?.('SIGNED_OUT',null));await act(async()=>resolve(html()));
  expect(host.querySelector('iframe')).toBeNull();expect(host.textContent).toContain('unavailable');
});
it('retains a known document through a PDF-only failure without claiming download success',async()=>{
  await render();fetchMock.mockResolvedValue(new Response('Unavailable',{status:503}));
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Download PDF')!.click();});
  expect(host.querySelector('iframe')?.srcdoc).toContain('Frozen client invoice');
  expect(host.textContent).toContain('PDF could not be opened');expect(fixture.download).not.toHaveBeenCalled();
});
it('reauthorizes after fetching a PDF and refuses to download it after relation loss',async()=>{
  await render();expect(host.querySelector('iframe')?.srcdoc).toContain('Frozen client invoice');fetchMock.mockImplementation(async()=>{fixture.profile.mockResolvedValue({data:null,error:null});return new Response('%PDF-1.7\nsynthetic',{headers:{'Content-Type':'application/pdf'}});});
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Download PDF')!.click();});
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('format=pdf'))).toBe(true);expect(fixture.download).not.toHaveBeenCalled();expect(host.querySelector('iframe')).toBeNull();expect(host.textContent).toContain('unavailable');
});
it('does not fetch a document when the safe profile belongs to another actual subject',async()=>{
  fixture.profile.mockResolvedValue({data:{id:target.clientId,tenant_id:target.tenantId,linked_user_id:id(8)},error:null});await render();expect(fetchMock).not.toHaveBeenCalled();expect(host.querySelector('iframe')).toBeNull();expect(host.textContent).toContain('unavailable');
});
it('does not revive raw CRM access when the safe profile producer refuses',async()=>{
  fixture.profile.mockResolvedValue({data:null,error:{code:'42501'}});await render();expect(fetchMock).not.toHaveBeenCalled();expect(host.querySelector('iframe')).toBeNull();expect(host.textContent).toContain('unavailable');
});
it('reloads the same canonical invoice rather than retaining a stale balance artifact',async()=>{
  await render();fetchMock.mockResolvedValue(new Response('<html><body>Corrected current balance</body></html>',{headers:{'Content-Type':'text/html'}}));
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Check invoice again')!.click();});
  expect(host.querySelector('iframe')?.srcdoc).toContain('Corrected current balance');
  expect(fetchMock.mock.calls.every(call=>String(call[0]).includes('invoice_id='+target.invoiceId))).toBe(true);
});
it('shows approved test checkout with explicit environment and no invented signature or settlement',async()=>{
  fetchMock.mockImplementation(async url=>String(url).includes('format=payment-request')
    ?new Response(JSON.stringify({remaining_cents:305000,payment_request:{amount_minor:50000,currency:'usd',state:'customer_action_required',environment:'test',provider_url:'https://checkout.stripe.com/c/pay/synthetic',expires_at:'2099-10-15T00:00:00Z'}}),{headers:{'Content-Type':'application/json'}}):html());
  await render();expect(host.textContent).toContain('Test mode · no live payment');
  expect([...host.querySelectorAll('a')].find(link=>link.textContent==='Continue to test checkout')?.href).toBe('https://checkout.stripe.com/c/pay/synthetic');
  expect(host.textContent).not.toContain('Payment confirmed');expect(host.textContent).not.toContain('Agreement signed');
  expect(fetchMock.mock.calls.filter(([url])=>String(url).includes('payment-request'))[0][1].headers.Authorization).toBe('Bearer synthetic-transport-only');
});
it('scrubs checkout as well as the document when client standing disappears during readback',async()=>{
  fetchMock.mockImplementation(async url=>{
    if(!String(url).includes('format=payment-request'))return html();
    fixture.profile.mockResolvedValue({data:null,error:null});
    return new Response(JSON.stringify({remaining_cents:305000,payment_request:{amount_minor:50000,currency:'usd',state:'customer_action_required',environment:'live',provider_url:'https://checkout.stripe.com/c/pay/synthetic',expires_at:'2099-10-15T00:00:00Z'}}),{headers:{'Content-Type':'application/json'}});
  });
  await render();expect(fetchMock.mock.calls.some(([url])=>String(url).includes('format=payment-request'))).toBe(true);expect(host.querySelector('iframe')).toBeNull();expect(host.querySelector('a[href^="https://checkout"]')).toBeNull();expect(host.textContent).toContain('unavailable');
});
