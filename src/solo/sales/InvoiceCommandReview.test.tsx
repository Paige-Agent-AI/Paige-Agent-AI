import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {InvoiceCommandReview} from './InvoiceCommandReview';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({invoke:vi.fn(),actor:'66666666-6666-4666-8666-666666666666',onAuth:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 functions:{invoke:h.invoke},
 auth:{
  getSession:async()=>({data:{session:{user:{id:h.actor}}}}),
  onAuthStateChange:(callback:typeof h.onAuth)=>{h.onAuth=callback;return {data:{subscription:{unsubscribe(){}}}};},
 },
}}));
let host:HTMLDivElement,root:Root;const done=vi.fn(),close=vi.fn();
const command={action:'invoice.publish' as const,invoice_id:'22222222-2222-4222-8222-222222222222',expected_version:1};
const tenant='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{sessionStorage.clear();h.actor='66666666-6666-4666-8666-666666666666';h.invoke.mockReset();done.mockReset();close.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=async(id=tenant)=>act(async()=>{root.render(<InvoiceCommandReview tenantId={id} command={command} onComplete={done} onClose={close}/>);await Promise.resolve();});
const button=(name:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===name)!;
const click=async(name:string)=>act(async()=>{button(name).click();await Promise.resolve()});
it('proposes then approves the identical immutable command and operation; cancel never executes',async()=>{
 h.invoke.mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Publish frozen invoice'},error:null}).mockResolvedValueOnce({data:{ok:true},error:null});await render();
 await click('Prepare review');expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
 await click('Approve action');const first=h.invoke.mock.calls[0][1].body,last=h.invoke.mock.calls[1][1].body;expect(last).toEqual({...first,approved_fingerprint:'0123456789abcdef'});expect(done).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
});
it('decodes known HTTP refusal without trapping Cancel as unknown',async()=>{h.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({outcome:'refused',message:'Invoice changed'}),{status:422})}});await render();await click('Prepare review');expect(document.body.textContent).toContain('Invoice changed');expect(button('Cancel').disabled).toBe(false);await click('Cancel');expect(close).toHaveBeenCalledOnce();});
it('drops foreign response after workspace changes and issues no old request',async()=>{let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));await render();await click('Prepare review');await render('33333333-3333-4333-8333-333333333333');await act(async()=>resolve({data:{ok:true},error:null}));expect(done).not.toHaveBeenCalled();expect(h.invoke).toHaveBeenCalledOnce();});
it('recovers the same operation after unknown result and remount',async()=>{h.invoke.mockRejectedValueOnce(Error('Network')).mockResolvedValueOnce({data:{ok:true},error:null});await render();await click('Prepare review');const original=h.invoke.mock.calls[0][1].body;expect(button('Cancel').disabled).toBe(true);act(()=>root.unmount());root=createRoot(host);await render();expect(button('Cancel').disabled).toBe(true);await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(close).not.toHaveBeenCalled();await click('Recover original operation');expect(h.invoke.mock.calls[1][1].body).toEqual(original);expect(done).toHaveBeenCalledOnce();});
it('auth refusal during unknown recovery does not erase original operation',async()=>{h.invoke.mockRejectedValueOnce(Error('Network')).mockResolvedValueOnce({data:null,error:{context:new Response(JSON.stringify({outcome:'refused',code:'UNAUTHENTICATED'}),{status:401})}});await render();await click('Prepare review');const original=h.invoke.mock.calls[0][1].body;await click('Recover original operation');expect(h.invoke.mock.calls[1][1].body).toEqual(original);expect(button('Cancel').disabled).toBe(true);expect(sessionStorage.length).toBe(1);});
it('unknown after approval recovers without consumed fingerprint before fresh approval',async()=>{h.invoke.mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'0123456789abcdef'},error:null}).mockRejectedValueOnce(Error('Network')).mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'fedcba9876543210'},error:null}).mockResolvedValueOnce({data:{ok:true},error:null});await render();await click('Prepare review');await click('Approve action');await click('Recover approved operation');const original=h.invoke.mock.calls[0][1].body;expect(h.invoke.mock.calls[2][1].body).toEqual(original);await click('Approve action');expect(h.invoke.mock.calls[3][1].body).toEqual({...original,approved_fingerprint:'fedcba9876543210'});expect(done).toHaveBeenCalledOnce();});
it('another authenticated actor cannot restore prior session operation in same tenant',async()=>{h.invoke.mockRejectedValueOnce(Error('Network')).mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'0123456789abcdef'},error:null});await render();await click('Prepare review');const old=h.invoke.mock.calls[0][1].body;act(()=>root.unmount());h.actor='77777777-7777-4777-8777-777777777777';root=createRoot(host);await render();expect(button('Cancel').disabled).toBe(false);expect(document.body.textContent).not.toContain('Recovering the saved');await click('Prepare review');expect(h.invoke.mock.calls[1][1].body.operation_id).not.toBe(old.operation_id);});

it('freezes the chosen publication template into preparation and approval identity',async()=>{
 h.invoke.mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'0123456789abcdef'},error:null}).mockResolvedValueOnce({data:{ok:true},error:null});await render();
 const select=document.querySelector<HTMLSelectElement>('select')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,'service');select.dispatchEvent(new Event('change',{bubbles:true}));});
 await click('Prepare review');expect(select.disabled).toBe(true);expect(h.invoke.mock.calls[0][1].body.command.template).toBe('service');await click('Approve action');expect(h.invoke.mock.calls[1][1].body.command).toEqual(h.invoke.mock.calls[0][1].body.command);
});

it('shows the server invoice number and never falls back to its internal identifier',async()=>{
 h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',preview:{invoice_number:'INV-0042',remaining_cents:297300},summary:'Publish the reviewed invoice.'},error:null});
 await render();await click('Prepare review');expect(document.body.textContent).toContain('Invoice number');expect(document.body.textContent).toContain('INV-0042');expect(document.body.textContent).not.toContain(command.invoice_id);
});
it('reports an unavailable number rather than exposing a UUID',async()=>{
 h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',preview:{remaining_cents:297300}},error:null});
 await render();await click('Prepare review');expect(document.body.textContent).toContain('Invoice number unavailable');expect(document.body.textContent).not.toContain(command.invoice_id);
});

it('checks an existing payment request using its saved identity and immutable intent',async()=>{
 const operationId='88888888-8888-4888-8888-888888888888';
 const payment={action:'invoice.payment_request' as const,invoice_id:command.invoice_id,expected_version:3,provider:'stripe' as const,purpose:'partial' as const,amount_minor:50000};
 h.invoke.mockResolvedValue({data:{ok:true,outcome:'customer_action_required'},error:null});
 await act(async()=>{root.render(<InvoiceCommandReview tenantId={tenant} command={payment} operationId={operationId} onComplete={done} onClose={close}/>);await Promise.resolve();});
 await click('Recover original operation');expect(h.invoke.mock.calls[0][1].body).toEqual({expected_tenant_id:tenant,operation_id:operationId,command:payment});expect(done).toHaveBeenCalledOnce();
});

it('refuses payment approval when exact customer and merchant facts are missing',async()=>{h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',preview:{invoice_number:'INV-1',remaining_cents:350000}},error:null});await act(async()=>{root.render(<InvoiceCommandReview tenantId={tenant} command={{action:'invoice.payment_request',invoice_id:command.invoice_id,expected_version:1,provider:'stripe',purpose:'partial',amount_minor:50000}} onComplete={done} onClose={close}/>);await Promise.resolve();});await click('Prepare review');expect(button('Approve action').disabled).toBe(true);expect(document.body.textContent).toContain('exact customer');});
it('can close an unknown payment review while retaining recovery identity',async()=>{h.invoke.mockRejectedValue(Error('Network'));await act(async()=>{root.render(<InvoiceCommandReview tenantId={tenant} command={{action:'invoice.payment_request',invoice_id:command.invoice_id,expected_version:1,provider:'stripe',purpose:'partial',amount_minor:50000}} onComplete={done} onClose={close}/>);await Promise.resolve();});await click('Prepare review');await click('Close review');expect(close).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(1);});
