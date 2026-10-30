import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {InvoiceCommandReview} from './InvoiceCommandReview';
import {acceptedPlanFixture} from '../../../scripts/live-drive/sales-payments/accepted-plan-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({invoke:vi.fn(),actor:'66666666-6666-4666-8666-666666666666',sessionRead:null as null|(()=>Promise<{data:{session:{user:{id:string}}|null}}>),onAuth:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 functions:{invoke:h.invoke},
 auth:{
  getSession:async()=>h.sessionRead?await h.sessionRead():({data:{session:{user:{id:h.actor}}}}),
  onAuthStateChange:(callback:typeof h.onAuth)=>{h.onAuth=callback;return {data:{subscription:{unsubscribe(){}}}};},
 },
}}));
let host:HTMLDivElement,root:Root;const done=vi.fn(),close=vi.fn();
const command={action:'invoice.publish' as const,invoice_id:'22222222-2222-4222-8222-222222222222',expected_version:1};
const tenant='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{sessionStorage.clear();h.actor='66666666-6666-4666-8666-666666666666';h.sessionRead=null;h.onAuth=null;h.invoke.mockReset();done.mockReset();close.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=async(id=tenant)=>act(async()=>{root.render(<InvoiceCommandReview tenantId={id} command={command} onComplete={done} onClose={close}/>);await Promise.resolve();});
const button=(name:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===name)!;
const click=async(name:string)=>act(async()=>{button(name).click();await Promise.resolve()});
const manualReview=async(echo:'exact'|'missing'|'changed')=>{
 const fixture=await acceptedPlanFixture(),allocations=[{obligation:fixture.view.obligations[0],amount_cents:50000},{obligation:fixture.view.obligations[1],amount_cents:30000}];
 const received={action:'invoice.record_manual_payment' as const,invoice_id:fixture.invoice.id,expected_version:fixture.invoice.version,amount_cents:80000,currency:'usd',method:'cash',received_at:'2026-10-30T12:00:00.000Z',reference:null,notes:null,allocations};
 const copy=structuredClone(allocations);if(echo==='changed')copy[1]={...copy[1],obligation:{...copy[1].obligation,due_date:'2027-02-15'}};
 h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Record received payment',preview:{invoice_number:'INV-1042',remaining_cents:350000,currency:'usd',...(echo==='missing'?{}:{manual_allocations:copy})}},error:null});
 await act(async()=>{root.render(<InvoiceCommandReview tenantId={tenant} command={received} onComplete={done} onClose={close}/>);await Promise.resolve()});await click('Prepare review');return received;
};
it('shows exact deposit and installment assignments before approving the original immutable manual receipt',async()=>{
 const received=await manualReview('exact');expect(document.querySelector('[aria-label="Reviewed received-payment assignments"]')?.textContent).toContain('Payment 1 · $500.00');expect(document.body.textContent).toContain('Payment 2 · $300.00');expect(document.body.textContent).toContain('Accepted terms version 3');expect(button('Approve action').disabled).toBe(false);
 h.invoke.mockResolvedValueOnce({data:{ok:true},error:null});await click('Approve action');expect(h.invoke.mock.calls[1][1].body).toEqual({...h.invoke.mock.calls[0][1].body,approved_fingerprint:'0123456789abcdef'});expect(h.invoke.mock.calls[1][1].body.command).toEqual(received);expect(done).toHaveBeenCalledOnce();
});
it.each(['missing','changed'] as const)('refuses approval when the native allocation review is %s without guessing a review',async echo=>{
 await manualReview(echo);expect(button('Approve action').disabled).toBe(true);expect(document.body.textContent).toContain('exact accepted payment assignments could not be verified');expect(document.querySelector('[aria-label="Reviewed received-payment assignments"]')).toBeNull();await click('Approve action');expect(h.invoke).toHaveBeenCalledOnce();await click('Cancel');expect(close).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
});
it('can leave a pending account check without invoking an invoice action',async()=>{
 let resolve!:(value:{data:{session:{user:{id:string}}|null}})=>void;
 h.sessionRead=()=>new Promise(r=>{resolve=r});await render();
 expect(document.body.textContent).toContain('Checking your account');expect(button('Return to invoice')).toBeDefined();
 await click('Return to invoice');expect(close).toHaveBeenCalledOnce();expect(h.invoke).not.toHaveBeenCalled();
 await act(async()=>{root.render(null);resolve({data:{session:{user:{id:h.actor}}}});await Promise.resolve()});expect(done).not.toHaveBeenCalled();
});
it('provides a focused return when a session is unavailable, without granting an action',async()=>{
 h.sessionRead=async()=>({data:{session:null}});await render();
 expect(document.body.textContent).toContain('Sign in to review');expect(button('Return to invoice')).toBeDefined();
 expect(document.activeElement).toBe(button('Return to invoice'));await click('Return to invoice');expect(close).toHaveBeenCalledOnce();expect(h.invoke).not.toHaveBeenCalled();expect(done).not.toHaveBeenCalled();
});
it('retains the original uncertain operation when sign-out requires returning to the invoice',async()=>{
 h.invoke.mockRejectedValue(Error('Synthetic interruption'));await render();await click('Prepare review');
 const stored=sessionStorage.getItem(sessionStorage.key(0)!);expect(stored).not.toBeNull();
 await act(async()=>{h.onAuth?.('SIGNED_OUT',null);await Promise.resolve()});
 expect(button('Return to invoice')).toBeDefined();await click('Return to invoice');expect(close).toHaveBeenCalledOnce();
 expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(stored);expect(h.invoke).toHaveBeenCalledOnce();expect(done).not.toHaveBeenCalled();
});
it('proposes then approves the identical immutable command and operation; cancel never executes',async()=>{
 h.invoke.mockResolvedValueOnce({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Publish frozen invoice'},error:null}).mockResolvedValueOnce({data:{ok:true},error:null});await render();
 await click('Prepare review');expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
 await click('Approve action');const first=h.invoke.mock.calls[0][1].body,last=h.invoke.mock.calls[1][1].body;expect(last).toEqual({...first,approved_fingerprint:'0123456789abcdef'});expect(done).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
});
it('decodes known HTTP refusal without trapping Cancel as unknown',async()=>{h.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({outcome:'refused',message:'Invoice changed'}),{status:422})}});await render();await click('Prepare review');expect(document.body.textContent).toContain('Invoice changed');expect(button('Cancel').disabled).toBe(false);await click('Cancel');expect(close).toHaveBeenCalledOnce();});
it('gives a refused publication review a draft correction path without offering approval',async()=>{
 h.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({outcome:'refused',code:'SALES_INVOICE_INELIGIBLE',preview:{eligible:false}}),{status:422})}});
 await render();await click('Prepare review');
 expect(document.body.textContent).toContain('Check the saved invoice’s current version, amount, due date and payment methods');
 expect(document.body.textContent).not.toContain('The action was refused. Reload the invoice before trying again.');
 expect(button('Approve action')).toBeUndefined();expect(done).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
 expect(h.invoke.mock.calls[0][1].body).not.toHaveProperty('approved_fingerprint');await click('Cancel');expect(close).toHaveBeenCalledOnce();
});
it('describes the proposed publication preview amount as unissued instead of outstanding',async()=>{
 h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',preview:{invoice_number:'DRAFT-22222222-2222-4222-8222-222222222222',remaining_cents:350000,currency:'usd',status:'draft'},summary:'Review the draft'},error:null});
 await render();await click('Prepare review');expect(document.body.textContent).toContain('Unissued draft amount');expect(document.body.textContent).not.toContain('Current outstanding');expect(document.body.textContent).toContain('$3,500.00');
 await click('Cancel');expect(close).toHaveBeenCalledOnce();expect(done).not.toHaveBeenCalled();expect(h.invoke).toHaveBeenCalledOnce();
});
it('retains the original unknown operation when a recovery read refuses publication',async()=>{
 h.invoke.mockRejectedValueOnce(Error('Synthetic interruption')).mockResolvedValueOnce({data:{outcome:'refused',code:'SALES_INVOICE_INELIGIBLE'},error:null});
 await render();await click('Prepare review');const original=h.invoke.mock.calls[0][1].body;const stored=sessionStorage.getItem(sessionStorage.key(0)!);
 await click('Recover original operation');expect(h.invoke.mock.calls[1][1].body).toEqual(original);expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(stored);
 expect(document.body.textContent).toContain('Keep its original identity');expect(document.body.textContent).not.toContain('prepare a fresh review');expect(button('Cancel').disabled).toBe(true);expect(button('Approve action')).toBeUndefined();expect(done).not.toHaveBeenCalled();
});
it('retains the issued amount label when reviewing an original void command',async()=>{
 h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',preview:{invoice_number:'INV-0042',remaining_cents:350000,currency:'usd',status:'issued'}},error:null});
 await act(async()=>{root.render(<InvoiceCommandReview tenantId={tenant} command={{...command,action:'invoice.void',reason:'Synthetic audit correction'}} onComplete={done} onClose={close}/>);await Promise.resolve()});
 await click('Prepare review');expect(document.body.textContent).toContain('Current outstanding');expect(document.body.textContent).not.toContain('Unissued draft amount');await click('Cancel');expect(h.invoke).toHaveBeenCalledOnce();expect(done).not.toHaveBeenCalled();
});
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
