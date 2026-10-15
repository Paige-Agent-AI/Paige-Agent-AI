import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import AgreementSigning from './AgreementSigning';

const fixture=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),create:vi.fn(),revoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:fixture.rpc,functions:{invoke:fixture.invoke}}}));
vi.mock('react-helmet-async',()=>({Helmet:()=>null}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const token='a'.repeat(64),nextToken='b'.repeat(64);
const row=()=>({document_title:'Synthetic agreement A',document_body:null,document_path:'retained-document',business_name:'Synthetic business',brand:{},signer_display_name:'Synthetic Signer',amount_minor:350000,amount_currency:'usd',term_summary:'custom',expires_at:'2099-10-15T00:00:00Z',signature_state:'sent',is_valid:true});
const OriginalURL=URL;
let host:HTMLDivElement,root:Root,router:ReturnType<typeof createMemoryRouter>;
beforeEach(()=>{
  fixture.rpc.mockReset().mockResolvedValue({data:[row()],error:null});
  fixture.invoke.mockReset().mockImplementation(async()=>({data:new Blob(['%PDF-1.7\nsynthetic component transport'],{type:'application/pdf'}),error:null}));
  fixture.create.mockReset().mockReturnValue('blob:synthetic-retained-pdf');fixture.revoke.mockReset();
  vi.stubGlobal('URL',class extends OriginalURL{static createObjectURL=fixture.create;static revokeObjectURL=fixture.revoke;});
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  router=createMemoryRouter([{path:'/sign/:token',element:<AgreementSigning/>}],{initialEntries:['/sign/'+token]});
});
afterEach(()=>{act(()=>root.unmount());router.dispose();host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
const render=async()=>{await act(async()=>root.render(<RouterProvider router={router}/>));};
const signButton=()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Sign and complete')!;
it('uses the existing exact-token PDF door for the retained document, with consent still required',async()=>{
  await render();expect(host.querySelector('iframe')?.getAttribute('src')).toBe('blob:synthetic-retained-pdf');
  expect(host.querySelector('.ags-gate')?.getAttribute('data-locked')).toBe('true');
  expect(host.querySelector('input.ags-sig')?.matches(':disabled')).toBe(true);
  expect([...host.querySelectorAll('input[type=checkbox]')].every(input=>input.matches(':disabled'))).toBe(true);
  expect(host.textContent).not.toContain('The document is shown above. You can sign it now.');
  act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  expect(host.querySelector('.ags-gate')?.getAttribute('data-locked')).toBe('false');
  expect(host.querySelector('input.ags-sig')?.matches(':disabled')).toBe(false);
  expect(host.textContent).toContain('$3,500.00');expect(signButton().disabled).toBe(true);
  expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith('agreement-document?token='+token,{method:'GET'});
  expect(host.textContent).not.toContain('Read 100%');expect(fixture.rpc).toHaveBeenCalledWith('peek_agreement_signing',{_token:token});
});
it('keeps the signing gate locked while retained document delivery is pending or refused',async()=>{
  let resolve!:(reply:unknown)=>void;fixture.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  await render();expect(host.querySelector('iframe')).toBeNull();expect(signButton().disabled).toBe(true);
  await act(async()=>resolve({data:{ok:false},error:null}));
  expect(host.querySelector('iframe')).toBeNull();expect(signButton().disabled).toBe(true);expect(host.textContent).toContain('signing stays locked');expect(fixture.create).not.toHaveBeenCalled();
});
it('preserves legacy text-only review without fetching a different PDF or inventing economics',async()=>{
  fixture.rpc.mockResolvedValue({data:[{...row(),document_body:'Historical text-only agreement.',document_path:null,amount_minor:null,amount_currency:null}],error:null});
  await render();expect(host.textContent).toContain('Historical text-only agreement.');expect(fixture.invoke).not.toHaveBeenCalled();expect(host.textContent).not.toContain('$3,500.00');
});
it('retires the previous document and consent as soon as the exact signing token changes',async()=>{
  await render();expect(host.querySelector('iframe')).not.toBeNull();
  let resolve!:(reply:unknown)=>void;fixture.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  await act(async()=>{await router.navigate('/sign/'+nextToken);});
  expect(host.querySelector('iframe')).toBeNull();expect(host.textContent).not.toContain('Synthetic agreement A');
  expect(host.querySelector('input.ags-sig')).toBeNull();expect(fixture.revoke).toHaveBeenCalledWith('blob:synthetic-retained-pdf');
  await act(async()=>resolve({data:[{...row(),document_title:'Synthetic agreement B'}],error:null}));
  expect(host.textContent).toContain('Synthetic agreement B');expect(signButton().disabled).toBe(true);
  expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(input=>!input.checked)).toBe(true);
});
it('does not create a retained-document URL from a response arriving after the ceremony unmounts',async()=>{
  let resolve!:(reply:unknown)=>void;fixture.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  await render();act(()=>root.render(<p>Different surface</p>));
  await act(async()=>resolve({data:new Blob(['%PDF-1.7\nlate synthetic'],{type:'application/pdf'}),error:null}));
  expect(fixture.create).not.toHaveBeenCalled();expect(host.querySelector('iframe')).toBeNull();
});
it.each([false,undefined,true])('reports recorded signature separately from completed=%s without claiming email delivery',async(completed)=>{
  fixture.invoke.mockImplementation(async(name:string)=>name==='sign-agreement'?{data:{ok:true,completed},error:null}:{data:new Blob(['%PDF-1.7\nsynthetic component transport'],{type:'application/pdf'}),error:null});
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));
  expect(signButton().disabled).toBe(false);await act(async()=>signButton().click());
  expect(host.querySelector('h2')?.textContent).toBe(completed===true?'Signed and completed':'Your signature is recorded');
  expect(host.textContent).not.toContain('a copy is on its way');expect(host.textContent).not.toContain('has been told');
  expect(host.querySelector('.ags-sign')).toBeNull();
});
it.each([null,{ok:'true'},{ok:1}])('keeps an unknown/malformed signing outcome unconfirmed: %s',async(data)=>{
  fixture.invoke.mockImplementation(async(name:string)=>name==='sign-agreement'?{data,error:null}:{data:new Blob(['%PDF-1.7\nsynthetic component transport'],{type:'application/pdf'}),error:null});
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));
  await act(async()=>signButton().click());expect(host.textContent).toContain('Signing could not be confirmed');expect(host.textContent).not.toContain('Nothing was signed');expect(host.querySelector('h2')).toBeNull();
});
it('cancels a decline without submitting a decision',async()=>{
  vi.spyOn(window,'prompt').mockReturnValueOnce(null);await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==="I don't agree to these terms")!.click());
  expect(fixture.rpc).toHaveBeenCalledTimes(1);expect(host.querySelector('iframe')).not.toBeNull();
});
