import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import AgreementSigning from './AgreementSigning';
import documentFixture from '@/solo/sales/fixtures/agreement-document-source.json';

const fixture=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),fields:vi.fn(),create:vi.fn(),revoke:vi.fn(),pdfAuto:true,pdfFrames:[] as Array<{page:number;zoom:'fit'|number;sha256:string;ready:(r:unknown)=>void}>}));
// Preserve every original act/document assertion; the added ordinary field-read
// has its own spy and explicit scope/recovery tests below.
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:fixture.rpc,functions:{invoke:(name:string,options?:{body?:Record<string,unknown>})=>options?.body?.action==='fields'?fixture.fields(name,options):fixture.invoke(name,options)}}}));
// Component tests drive readiness, not PDF pixels. Actual original-renderer
// browser evidence is separate; this avoids fetching font assets in jsdom.
vi.mock('@/solo/sales/AgreementPdfPage',()=>({AgreementPdfPage:({document:doc,pageNumber,zoom,onReady,onRetry,children}: {document:{sha256:string};pageNumber:number;zoom:'fit'|number;onReady:(r:unknown)=>void;onRetry:()=>void;children:React.ReactNode})=>{
 const cb=React.useRef(onReady);cb.current=onReady;
 React.useEffect(()=>{const ready=cb.current,frame={page:pageNumber,sha256:doc.sha256,zoom,ready};fixture.pdfFrames.push(frame);if(fixture.pdfAuto)ready({page:pageNumber,sha256:doc.sha256,zoom});return()=>ready(null);},[doc.sha256,pageNumber,zoom]);
 return <div aria-label={'Synthetic PDF readiness page '+pageNumber}>{children}<button onClick={onRetry}>Reload original document</button></div>;
}}));
vi.mock('react-helmet-async',()=>({Helmet:()=>null}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const token='a'.repeat(64),nextToken='b'.repeat(64);
const row=()=>({document_title:'Synthetic agreement A',document_body:null,document_path:'retained-document',business_name:'Synthetic business',brand:{},signer_display_name:'Synthetic Signer',amount_minor:350000,amount_currency:'usd',term_summary:'custom',expires_at:'2099-10-15T00:00:00Z',signature_state:'sent',is_valid:true});
const signingReceipt=(patch:Record<string,unknown>={})=>({ok:true,state:'recorded',signed_at:'2026-10-23T12:00:00Z',audit_complete:true,replayed:false,...patch});
const OriginalURL=URL;
let host:HTMLDivElement,root:Root,router:ReturnType<typeof createMemoryRouter>;
beforeEach(()=>{
  fixture.pdfAuto=true;fixture.pdfFrames=[];
  fixture.rpc.mockReset().mockResolvedValue({data:[row()],error:null});
  fixture.fields.mockReset().mockResolvedValue({data:{kind:'legacy'},error:null});
  fixture.invoke.mockReset().mockImplementation(async()=>({data:new Blob(['%PDF-1.7\nsynthetic component transport'],{type:'application/pdf'}),error:null}));
  fixture.create.mockReset().mockReturnValue('blob:synthetic-retained-pdf');fixture.revoke.mockReset();
  vi.stubGlobal('URL',class extends OriginalURL{static createObjectURL=fixture.create;static revokeObjectURL=fixture.revoke;});
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  router=createMemoryRouter([{path:'/sign/:token',element:<AgreementSigning/>}],{initialEntries:['/sign/'+token]});
});
afterEach(()=>{act(()=>root.unmount());router.dispose();host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
const render=async()=>{await act(async()=>root.render(<RouterProvider router={router}/>));};
const signButton=()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Sign agreement')!;
const ownText='f1111111-0000-4000-8000-000000000001',ownBox='f1111111-0000-4000-8000-000000000002',ownSign='f1111111-0000-4000-8000-000000000003',ownDate='f1111111-0000-4000-8000-000000000004';
const recipientPacket=()=>({kind:'prepared',preparation_id:'a1111111-0000-4000-8000-000000000001',preparation_sha256:'a'.repeat(64),document:documentFixture.document,fields:[
 {id:ownText,kind:'text',page:1,x:40,y:140,width:240,height:38,required:true,label:'Service contact'},
 {id:ownBox,kind:'checkbox',page:2,x:40,y:90,width:20,height:20,required:true,label:'Checklist value'},
 {id:ownSign,kind:'signature',page:2,x:40,y:160,width:220,height:42,required:true,label:'Your signature'},
 {id:ownDate,kind:'signed_date',page:2,x:300,y:160,width:150,height:42,required:true,label:'Date signed'},
]});
const prepareOwn=()=>{
 fixture.fields.mockResolvedValue({data:recipientPacket(),error:null});
 fixture.invoke.mockImplementation(async(name:string)=>name==='sign-agreement'?{data:signingReceipt({completed:false}),error:null}:{data:new Blob([Uint8Array.from(atob(documentFixture.bytes),c=>c.charCodeAt(0))],{type:'application/pdf'}),error:null});
};
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;
const answer=(id:string,text:string)=>{const el=host.querySelector<HTMLInputElement>('#field-'+id)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));};
const completeAnswers=async()=>{act(()=>{answer(ownText,'Controlled Contact');host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click();});await act(async()=>button('Next page').click());await act(async()=>button('Continue to signature').click());};
it('checks the original token-only field door before using the explicit legacy result',async()=>{
 await render();expect(fixture.fields).toHaveBeenCalledExactlyOnceWith('sign-agreement',{body:{token,action:'fields'}});expect(host.querySelector('iframe')).not.toBeNull();
});
it('never infers legacy or unsigned status from a failed field read and checks only the original receipt',async()=>{
 fixture.fields.mockResolvedValue({data:null,error:{context:new Response('{}',{status:503})}});
 fixture.invoke.mockResolvedValue({data:signingReceipt({replayed:true,completed:false}),error:null});
 await render();expect(host.querySelector('iframe')).toBeNull();expect(signButton().disabled).toBe(true);expect(host.textContent).not.toContain('Nothing has been signed');
 expect(fixture.invoke).not.toHaveBeenCalled();await act(async()=>button('Check recorded status').click());
 expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith('sign-agreement',{body:{token,check_only:true}});expect(host.querySelector('h2')?.textContent).toBe('Your signature is recorded');
});
it('requires every exact page and explicit own answers before a fresh consent step; date is never supplied',async()=>{
 prepareOwn();await render();expect(host.querySelector('iframe')).toBeNull();expect(signButton().disabled).toBe(true);expect(button('Continue to signature').disabled).toBe(true);
 act(()=>{answer(ownText,'Controlled Contact');host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click();});expect(button('Continue to signature').disabled).toBe(true);
 await act(async()=>button('Next page').click());expect(button('Continue to signature').disabled).toBe(false);
 await act(async()=>button('Continue to signature').click());await act(async()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));expect(document.activeElement).toBe(host.querySelector('input.ags-sig'));expect(signButton().disabled).toBe(true);
 act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));await act(async()=>signButton().click());
 expect(fixture.invoke).toHaveBeenLastCalledWith('sign-agreement',{body:{token,typed_name:'Synthetic Signer',signature_image_base64:null,consent_read:true,consent_esign:true,preparation_id:recipientPacket().preparation_id,preparation_sha256:'a'.repeat(64),field_values:[{field_id:ownText,value:'Controlled Contact'},{field_id:ownBox,value:false},{field_id:ownSign,value:true}]}});
 expect(host.querySelector('h2')?.textContent).toBe('Your signature is recorded');
});
it('invalidates previous consents when a prepared answer is corrected and keeps the correction',async()=>{
 prepareOwn();await render();await completeAnswers();act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));expect(signButton().disabled).toBe(false);
 act(()=>answer(ownText,'Corrected Contact'));expect(signButton().disabled).toBe(true);expect(host.querySelector('.ags-gate')?.getAttribute('data-locked')).toBe('true');
 await act(async()=>button('Continue to signature').click());expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(i=>!i.checked)).toBe(true);
 expect(host.querySelector<HTMLInputElement>('#field-'+ownText)?.value).toBe('Corrected Contact');expect(fixture.invoke.mock.calls.filter(c=>c[0]==='sign-agreement')).toHaveLength(0);
});
it('locks prepared answers during the real act request and uses no field values in uncertain recovery',async()=>{
 prepareOwn();await render();await completeAnswers();let resolve!:(r:unknown)=>void;
 fixture.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));await act(async()=>signButton().click());
 expect(host.querySelector<HTMLInputElement>('#field-'+ownText)?.disabled).toBe(true);expect(button('Next page').disabled).toBe(true);expect(host.querySelector<HTMLInputElement>('input.ags-sig')?.matches(':disabled')).toBe(true);
 await act(async()=>resolve({data:null,error:new Error('lost acknowledgement')}));expect(host.querySelector('h2')?.textContent).toBe('Signing is not yet confirmed');
 fixture.invoke.mockResolvedValue({data:signingReceipt({replayed:true,completed:false}),error:null});await act(async()=>button('Check recorded status').click());expect(fixture.invoke).toHaveBeenLastCalledWith('sign-agreement',{body:{token,check_only:true}});
});
it('retires a late own-field reply before a different token can display or fetch it',async()=>{
 let late!:(r:unknown)=>void;fixture.fields.mockImplementation((_name:string,options:{body:{token:string}})=>options.body.token===token?new Promise(r=>{late=r;}):Promise.resolve({data:{kind:'legacy'},error:null}));
 await render();expect(host.textContent).toContain('Checking the exact document');fixture.rpc.mockResolvedValue({data:[{...row(),document_title:'Current agreement B'}],error:null});
 await act(async()=>{await router.navigate('/sign/'+nextToken);});expect(host.querySelector('iframe')).not.toBeNull();
 await act(async()=>late({data:recipientPacket(),error:null}));expect(host.textContent).toContain('Current agreement B');expect(host.querySelector('.ags-prepared-document')).toBeNull();
 expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith('agreement-document?token='+nextToken,{method:'GET'});expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(i=>!i.checked)).toBe(true);
});
it('retains same-source private answers across unavailable rereads and requires page review and fresh consent again',async()=>{
 prepareOwn();fixture.fields.mockResolvedValueOnce({data:recipientPacket(),error:null}).mockResolvedValueOnce({data:null,error:new Error('unavailable')}).mockResolvedValue({data:recipientPacket(),error:null});
 await render();await completeAnswers();act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(i=>i.click()));await act(async()=>button('Reload original document').click());
 expect(host.querySelector('.ags-recipient-answers')).toBeNull();expect(host.textContent).toContain('Your signing document is unavailable');
 await act(async()=>button('Try reading again').click());expect(host.querySelector<HTMLInputElement>('#field-'+ownText)?.value).toBe('Controlled Contact');expect(button('Continue to signature').disabled).toBe(true);
 await act(async()=>button('Next page').click());await act(async()=>button('Continue to signature').click());expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(i=>!i.checked)).toBe(true);expect(signButton().disabled).toBe(true);
});
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
  fixture.invoke.mockImplementation(async(name:string)=>name==='sign-agreement'?{data:signingReceipt({completed}),error:null}:{data:new Blob(['%PDF-1.7\nsynthetic component transport'],{type:'application/pdf'}),error:null});
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));
  expect(signButton().disabled).toBe(false);await act(async()=>signButton().click());
  expect(host.querySelector('h2')?.textContent).toBe(completed===true?'Signed and completed':'Your signature is recorded');
  expect(document.activeElement).toBe(host.querySelector('h2'));
  expect(host.textContent).not.toContain('a copy is on its way');expect(host.textContent).not.toContain('has been told');
  expect(fixture.invoke).toHaveBeenCalledWith('sign-agreement',{body:{token,typed_name:'Synthetic Signer',signature_image_base64:null,consent_read:true,consent_esign:true}});
  // Primary styling now also serves safe status/download actions. Hold the
  // original no-resigning contract by exact action identity, not its CSS class.
  expect(signButton()).toBeUndefined();
  expect([...host.querySelectorAll('button')].map(b=>b.textContent)).toEqual([completed===true?'Download completed copy':'Check recorded status']);
});
it.each([null,{ok:'true'},{ok:1},{ok:true},signingReceipt({signed_at:null}),signingReceipt({audit_complete:'true'})])('keeps an unknown/malformed signing outcome unconfirmed: %s',async(data)=>{
  fixture.invoke.mockImplementation(async(name:string)=>name==='sign-agreement'?{data,error:null}:{data:new Blob(['%PDF-1.7\nsynthetic component transport'],{type:'application/pdf'}),error:null});
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));
  await act(async()=>signButton().click());expect(host.textContent).toContain('Signing could not be confirmed');expect(host.textContent).not.toContain('Nothing was signed');
  expect(host.querySelector('h2')?.textContent).toBe('Signing is not yet confirmed');expect(document.activeElement).toBe(host.querySelector('h2'));
  expect([...host.querySelectorAll('button')].map(button=>button.textContent)).toEqual(['Check recorded status']);
});
it('recovers a lost acknowledgement using only the original token and check-only flag',async()=>{
  let resolve!:(reply:unknown)=>void,attempts=0;
  fixture.invoke.mockImplementation(async(name:string)=>{
    if(name!=='sign-agreement')return {data:new Blob(['%PDF-1.7\nsynthetic component transport'],{type:'application/pdf'}),error:null};
    attempts++;
    if(attempts===1)return {data:null,error:{message:'FunctionsHttpError non-2xx',context:new Response(JSON.stringify({ok:false,state:'verification_pending',code:'SIGNATURE_VERIFICATION_PENDING'}),{status:503})}};
    return new Promise(r=>{resolve=r;});
  });
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));
  await act(async()=>signButton().click());expect(host.textContent).not.toContain('FunctionsHttpError');
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Check recorded status')!.click());
  expect(host.querySelector('button')?.disabled).toBe(true);expect(host.querySelector('[role=status]')?.textContent).toContain('No signature is being submitted');
  expect(fixture.invoke).toHaveBeenLastCalledWith('sign-agreement',{body:{token,check_only:true}});
  await act(async()=>resolve({data:signingReceipt({replayed:true,completed:false}),error:null}));
  expect(host.querySelector('h2')?.textContent).toBe('Your signature is recorded');expect(attempts).toBe(2);
  expect(document.activeElement).toBe(host.querySelector('h2'));expect(host.textContent).not.toContain('sent');
});
it('shows a known refusal from the actual non-2xx response and preserves the correctable form',async()=>{
  fixture.invoke.mockImplementation(async(name:string)=>name==='sign-agreement'?{data:null,error:{message:'FunctionsHttpError non-2xx',context:new Response(JSON.stringify({ok:false,code:'SIGNATURE_IMAGE_UNRENDERABLE',error:'Draw that signature again or type your name.'}),{status:400})}}:{data:new Blob(['%PDF-1.7\nsynthetic component transport'],{type:'application/pdf'}),error:null});
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));
  await act(async()=>signButton().click());expect(host.querySelector('[role=alert]')?.textContent).toContain('Draw that signature again');
  expect((host.querySelector('input.ags-sig') as HTMLInputElement).value).toBe('Synthetic Signer');expect(host.textContent).not.toContain('FunctionsHttpError');expect(signButton()).toBeDefined();
});
it('keeps a historical signed record visible while explicitly reporting its audit gap',async()=>{
  fixture.invoke.mockImplementation(async(name:string)=>name==='sign-agreement'?{data:signingReceipt({replayed:true,audit_complete:false,completed:true}),error:null}:{data:new Blob(['%PDF-1.7\nsynthetic component transport'],{type:'application/pdf'}),error:null});
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));
  await act(async()=>signButton().click());expect(host.querySelector('h2')?.textContent).toBe('Your signature is recorded');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('history could not be fully verified');expect(host.textContent).not.toContain('Signed and completed');
});
it('retrieves the same recorded signature after reload even when the original peek denies a signed link',async()=>{
  fixture.rpc.mockResolvedValue({data:[{is_valid:false}],error:null});
  fixture.invoke.mockResolvedValue({data:signingReceipt({replayed:true,completed:false,document_title:'Original retained agreement'}),error:null});
  await render();expect(fixture.invoke).not.toHaveBeenCalled();
  expect(host.querySelector('h2')?.textContent).toBe('This signing link is no longer available');
  await act(async()=>host.querySelector('button')!.click());
  expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith('sign-agreement',{body:{token,check_only:true}});
  expect(host.querySelector('h2')?.textContent).toBe('Your signature is recorded');expect(host.textContent).toContain('Original retained agreement');
  expect(host.textContent).toContain('Recorded');expect(host.querySelector('input.ags-sig')).toBeNull();
});
it('keeps a revoked or expired reload credential closed after native verification',async()=>{
  fixture.rpc.mockResolvedValue({data:[{is_valid:false}],error:null});
  fixture.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({ok:false}),{status:404})}});
  await render();await act(async()=>host.querySelector('button')!.click());
  expect(host.querySelector('h2')?.textContent).toBe('This signing link is no longer available');expect(host.querySelector('button')).toBeNull();
  expect(host.querySelector('input.ags-sig')).toBeNull();expect(document.activeElement).toBe(host.querySelector('h2'));
});
it('cancels a decline without submitting a decision',async()=>{
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==="I don't agree to these terms")!.click());await act(async()=>button('Keep reviewing').click());
  expect(fixture.rpc).toHaveBeenCalledTimes(1);expect(host.querySelector('iframe')).not.toBeNull();
});
it('allows a genuine decline without filling or accepting the prepared signing answers',async()=>{
  prepareOwn();fixture.rpc.mockImplementation(async(name:string)=>name==='peek_agreement_signing'?{data:[row()],error:null}:{data:{ok:true},error:null});
  await render();
  expect(signButton().disabled).toBe(true);expect(button('Continue to signature').disabled).toBe(true);
  const control=button("I don't agree to these terms");expect(control.disabled).toBe(false);
  await act(async()=>control.click());act(()=>fillDeclineReason("Synthetic decline before acceptance"));await act(async()=>button('Decline agreement').click());
  expect(host.querySelector('h2')?.textContent).toBe('You declined this agreement');
  expect(fixture.rpc).toHaveBeenLastCalledWith('decline_agreement_signing',{_token:token,_reason:'Synthetic decline before acceptance'});
  expect(fixture.invoke.mock.calls.filter(([name])=>name==='sign-agreement')).toHaveLength(0);
});
it('exposes unconfirmed decline feedback even while prepared signing remains locked',async()=>{
  prepareOwn();fixture.rpc.mockImplementation(async(name:string)=>name==='peek_agreement_signing'?{data:[row()],error:null}:{data:{ok:false},error:null});
  await render();
  const control=button("I don't agree to these terms");expect(control.disabled).toBe(false);
  await act(async()=>control.click());act(()=>fillDeclineReason("Synthetic unconfirmed decline"));await act(async()=>button('Decline agreement').click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Declining could not be confirmed');
  expect(host.querySelector('[role=alert]')?.closest('[aria-hidden=true]')).toBeNull();
  expect(host.textContent).not.toContain('You declined this agreement');expect(signButton().disabled).toBe(true);
});
it('labels a pending decline as a decision without claiming a signature is being recorded',async()=>{
  let resolve!:(value:{data:{ok:boolean};error:null})=>void;
  fixture.rpc.mockImplementation((name:string)=>name==='peek_agreement_signing'?Promise.resolve({data:[row()],error:null}):new Promise(r=>{resolve=r;}));
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  await act(async()=>button("I don't agree to these terms").click());act(()=>fillDeclineReason("Synthetic pending decline"));await act(async()=>button('Decline agreement').click());
  expect(host.textContent).not.toContain('Recording your signature');expect(button('Recording your decision…').disabled).toBe(true);
  await act(async()=>resolve({data:{ok:true},error:null}));expect(host.querySelector('h2')?.textContent).toBe('You declined this agreement');
});
it('holds both decisions after an unconfirmed decline instead of submitting another act',async()=>{
  fixture.rpc.mockImplementation(async(name:string)=>name==='peek_agreement_signing'?{data:[row()],error:null}:{data:{ok:false},error:null});
  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));expect(signButton().disabled).toBe(false);
  await act(async()=>button("I don't agree to these terms").click());act(()=>fillDeclineReason("Synthetic uncertain decision"));await act(async()=>button('Decline agreement').click());
  expect(signButton().disabled).toBe(true);expect(button("I don't agree to these terms").disabled).toBe(true);
  await act(async()=>{signButton().click();button("I don't agree to these terms").click();});
  expect(fixture.rpc.mock.calls.filter(([name])=>name==='decline_agreement_signing')).toHaveLength(1);
  expect(fixture.invoke.mock.calls.filter(([name])=>name==='sign-agreement')).toHaveLength(0);
});
it.each([false,null,undefined,0,'true'])('requires an explicitly valid peek before showing the ceremony: %s',async(is_valid)=>{
  fixture.rpc.mockResolvedValue({data:[{...row(),is_valid}],error:null});
  await render();
  expect(host.querySelector('h2')?.textContent).toBe('This signing link is no longer available');
  expect(host.querySelector('input.ags-sig')).toBeNull();expect(fixture.invoke).not.toHaveBeenCalled();
});
it.each([{ok:false},null,{}, {ok:'true'}, {ok:1}])('withholds an unacknowledged decline receipt: %s',async(data)=>{
  fixture.rpc.mockImplementation(async(name:string)=>name==='peek_agreement_signing'?{data:[row()],error:null}:{data,error:null});

  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==="I don't agree to these terms")!.click());act(()=>fillDeclineReason("Synthetic review reason"));await act(async()=>button('Decline agreement').click());
  expect(host.textContent).not.toContain('You declined this agreement');
  expect(host.textContent).toContain('Declining could not be confirmed');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Declining could not be confirmed');
  expect(host.querySelector('iframe')).not.toBeNull();
});
it('shows a recorded decline only after the native positive receipt, without claiming delivery',async()=>{
  fixture.rpc.mockImplementation(async(name:string)=>name==='peek_agreement_signing'?{data:[row()],error:null}:{data:{ok:true},error:null});

  await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==="I don't agree to these terms")!.click());act(()=>fillDeclineReason("Synthetic review reason"));await act(async()=>button('Decline agreement').click());
  expect(host.querySelector('h2')?.textContent).toBe('You declined this agreement');
  expect(document.activeElement).toBe(host.querySelector('h2'));
  expect(host.textContent).toContain('Your decision is recorded');expect(host.textContent).not.toContain('has been told');
  expect(fixture.rpc).toHaveBeenLastCalledWith('decline_agreement_signing',{_token:token,_reason:'Synthetic review reason'});
});

// The reviewed inline decision retains the original native contract. No browser
// prompt, signature consent or completed assigned answers can authorize it.
const reasonInput=()=>host.querySelector<HTMLTextAreaElement>('.ags-decline-panel textarea');
const fillDeclineReason=(value:string)=>{const input=reasonInput()!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
const openDeclineReview=async()=>{await act(async()=>button("I don't agree to these terms").click());expect(reasonInput()).not.toBeNull();};
it('requires explicit inline review without invoking a browser prompt or native decision',async()=>{
 const prompt=vi.spyOn(window,'prompt').mockReturnValue(null);prepareOwn();await render();await openDeclineReview();
 expect(prompt).not.toHaveBeenCalled();expect(host.textContent).toContain('This closes the signing request for everyone');
 expect(reasonInput()?.maxLength).toBe(500);expect(document.activeElement).toBe(reasonInput());
 expect(fixture.rpc.mock.calls.filter(([name])=>name==='decline_agreement_signing')).toHaveLength(0);
 expect(fixture.invoke.mock.calls.filter(([name])=>name==='sign-agreement')).toHaveLength(0);
});
it('cancels inline review with Escape, restores focus and retains the private reason without retaining consent',async()=>{
 vi.spyOn(window,'prompt').mockReturnValue(null);await render();act(()=>host.querySelector('iframe')!.dispatchEvent(new Event('load')));
 act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click()));expect(signButton().disabled).toBe(false);
 await openDeclineReview();act(()=>fillDeclineReason('Synthetic private draft'));
 act(()=>reasonInput()!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await act(async()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
 expect(reasonInput()).toBeNull();expect(document.activeElement).toBe(button("I don't agree to these terms"));expect(signButton().disabled).toBe(true);
 await openDeclineReview();expect(reasonInput()?.value).toBe('Synthetic private draft');
 expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(input=>!input.checked)).toBe(true);
 expect(fixture.rpc.mock.calls.filter(([name])=>name==='decline_agreement_signing')).toHaveLength(0);
});
it('keeps prepared answers and signing actions locked only while the inline decision is open',async()=>{
 vi.spyOn(window,'prompt').mockReturnValue(null);prepareOwn();await render();await openDeclineReview();
 expect(host.querySelector<HTMLInputElement>('#field-'+ownText)?.disabled).toBe(true);expect(button('Next page').disabled).toBe(true);
 expect(signButton().matches(':disabled')).toBe(true);await act(async()=>button('Keep reviewing').click());
 expect(host.querySelector<HTMLInputElement>('#field-'+ownText)?.disabled).toBe(false);expect(button('Next page').disabled).toBe(false);
 expect(fixture.invoke.mock.calls.filter(([name])=>name==='sign-agreement')).toHaveLength(0);
});
it('allows one native decision for rapid confirms and cannot cancel an in-flight decision',async()=>{
 vi.spyOn(window,'prompt').mockReturnValue(null);let resolve!:(value:unknown)=>void;
 fixture.rpc.mockImplementation((name:string)=>name==='peek_agreement_signing'?Promise.resolve({data:[row()],error:null}):new Promise(r=>{resolve=r;}));
 await render();await openDeclineReview();const confirm=button('Decline agreement');
 await act(async()=>{confirm.click();confirm.click();});
 expect(fixture.rpc.mock.calls.filter(([name])=>name==='decline_agreement_signing')).toHaveLength(1);
 expect(button('Keep reviewing').disabled).toBe(true);expect(button('Recording your decision…').disabled).toBe(true);
 act(()=>reasonInput()!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(reasonInput()).not.toBeNull();
 expect(host.textContent).not.toContain('Recording your signature');
 await act(async()=>resolve({data:null,error:new Error('Synthetic interrupted decision')}));
 expect(reasonInput()).toBeNull();expect(button("I don't agree to these terms").disabled).toBe(true);
 expect(document.activeElement).toBe(host.querySelector('[role=alert]'));
});
it('discards an unsubmitted reason at the original token boundary',async()=>{
 vi.spyOn(window,'prompt').mockReturnValue(null);await render();await openDeclineReview();act(()=>fillDeclineReason('Previous recipient draft'));
 await act(async()=>router.navigate('/sign/'+nextToken));expect(reasonInput()).toBeNull();await openDeclineReview();expect(reasonInput()?.value).toBe('');
 expect(fixture.rpc.mock.calls.filter(([name])=>name==='decline_agreement_signing')).toHaveLength(0);
});
it('preserves the original exact-token decline and 500-character limit after unavailable field reads',async()=>{
 vi.spyOn(window,'prompt').mockReturnValue(null);fixture.fields.mockResolvedValue({data:null,error:new Error('Synthetic read unavailable')});
 fixture.rpc.mockImplementation(async(name:string)=>name==='peek_agreement_signing'?{data:[row()],error:null}:{data:{ok:true},error:null});
 await render();await openDeclineReview();act(()=>fillDeclineReason('x'.repeat(600)));await act(async()=>button('Decline agreement').click());
 expect(fixture.rpc).toHaveBeenLastCalledWith('decline_agreement_signing',{_token:token,_reason:'x'.repeat(500)});
 expect(host.querySelector('h2')?.textContent).toBe('You declined this agreement');expect(fixture.invoke).not.toHaveBeenCalled();
});

const zoomControl=()=>host.querySelector<HTMLSelectElement>('select[aria-label="Document zoom"]')!;
const changeZoom=async(value:string)=>{await act(async()=>{const el=zoomControl();expect(el).not.toBeNull();el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});};
const lastPdf=()=>fixture.pdfFrames[fixture.pdfFrames.length-1];
const showPdf=(frame:ReturnType<typeof lastPdf>,patch:Record<string,unknown>={})=>act(()=>frame.ready({page:frame.page,sha256:frame.sha256,zoom:frame.zoom,...patch}));
it('offers native document magnification, retains answers, and requires fresh review and consents without another remote read',async()=>{
 prepareOwn();await render();await completeAnswers();act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(i=>i.click()));expect(signButton().disabled).toBe(false);
 expect([...zoomControl().options].map(o=>o.text)).toEqual(['Fit width','100%','150%','200%']);const calls=fixture.invoke.mock.calls.length;
 await changeZoom('2');expect(lastPdf().zoom).toBe(2);expect(host.querySelector<HTMLInputElement>('#field-'+ownText)?.value).toBe('Controlled Contact');expect(host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].checked).toBe(true);
 expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(i=>!i.checked&&i.matches(':disabled'))).toBe(true);expect(signButton().disabled).toBe(true);expect(fixture.invoke.mock.calls).toHaveLength(calls);expect(fixture.fields).toHaveBeenCalledTimes(1);
 await act(async()=>button('Continue to signature').click());expect(host.querySelector<HTMLInputElement>('input.ags-sig')?.matches(':disabled')).toBe(false);expect(signButton().disabled).toBe(true);expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(i=>!i.checked)).toBe(true);
 await act(async()=>button('Fit width').click());expect(zoomControl().value).toBe('fit');expect(lastPdf().zoom).toBe('fit');expect(button('Fit width')).toBeUndefined();expect(host.querySelector<HTMLInputElement>('#field-'+ownText)?.value).toBe('Controlled Contact');
});
it('refuses stale and mismatched page, bytes and magnification receipts until the current render finishes',async()=>{
 prepareOwn();await render();await completeAnswers();const retired=lastPdf();fixture.pdfAuto=false;await changeZoom('1.5');const current=lastPdf();expect(button('Continue to signature').disabled).toBe(true);
 showPdf(retired);expect(button('Continue to signature').disabled).toBe(true);
 for(const patch of [{zoom:'fit'},{page:1},{sha256:'b'.repeat(64)}]){showPdf(current,patch);expect(button('Continue to signature').disabled).toBe(true);}
 showPdf(current);expect(button('Continue to signature').disabled).toBe(false);expect(signButton().disabled).toBe(true);
 act(()=>current.ready(null));expect(button('Continue to signature').disabled).toBe(true);expect(fixture.invoke.mock.calls.filter(([name])=>name==='sign-agreement')).toHaveLength(0);
});
it('retires an earlier fit-width callback even after a round trip to the same page and magnification',async()=>{
 prepareOwn();await render();await completeAnswers();const previousFit=lastPdf();fixture.pdfAuto=false;await changeZoom('2');const previous200=lastPdf();await changeZoom('fit');const currentFit=lastPdf();
 showPdf(previousFit);showPdf(previous200);expect(button('Continue to signature').disabled).toBe(true);showPdf(currentFit);expect(button('Continue to signature').disabled).toBe(false);
 act(()=>previousFit.ready(null));expect(button('Continue to signature').disabled).toBe(false);
});
it('cannot count a retired page callback as review of the next page',async()=>{
 prepareOwn();await render();act(()=>{answer(ownText,'Controlled Contact');host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click();});const previous=lastPdf();fixture.pdfAuto=false;
 await act(async()=>button('Next page').click());const current=lastPdf();showPdf(previous,{page:2});expect(button('Continue to signature').disabled).toBe(true);expect(host.textContent).toContain('1 of 2 pages shown');showPdf(current);expect(button('Continue to signature').disabled).toBe(false);
});
it('preserves document scale across assigned-field navigation and rejects an invalid scale',async()=>{
 prepareOwn();await render();await changeZoom('1');await act(async()=>[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Go to Your signature on page 2')!.click());expect(lastPdf().page).toBe(2);expect(lastPdf().zoom).toBe(1);
 await changeZoom('99');expect(lastPdf().zoom).toBe(1);expect(zoomControl().value).toBe('1');expect(fixture.fields).toHaveBeenCalledTimes(1);expect(fixture.invoke).toHaveBeenCalledTimes(1);
});
it('locks zoom and fit reset during the original in-flight signature and never repeats the act',async()=>{
 prepareOwn();await render();await completeAnswers();await changeZoom('2');await act(async()=>button('Continue to signature').click());let finish!:(v:unknown)=>void;fixture.invoke.mockImplementation(()=>new Promise(r=>{finish=r;}));act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(i=>i.click()));await act(async()=>signButton().click());
 expect(zoomControl().disabled).toBe(true);expect(button('Fit width').disabled).toBe(true);await changeZoom('1');expect(lastPdf().zoom).toBe(2);expect(fixture.invoke.mock.calls.filter(([name])=>name==='sign-agreement')).toHaveLength(1);
 await act(async()=>finish({data:null,error:new Error('Synthetic acknowledgement lost')}));expect(host.textContent).toContain('Signing is not yet confirmed');
});

const mountRecorded=async(patch:Record<string,unknown>={})=>{
 fixture.rpc.mockResolvedValue({data:[{...row(),is_valid:false}],error:null});
 fixture.invoke.mockResolvedValue({data:signingReceipt({replayed:true,completed:false,completion_state:'verification_pending',completion_recovery_available:true,...patch}),error:null});
 await render();await act(async()=>button('Check recorded status').click());
};
it('offers explicit prepared completion only after original read-only status establishes it',async()=>{
 await mountRecorded();expect(host.querySelector('h2')?.textContent).toBe('Your signature is recorded');
 expect(button('Finish completed copy')).toBeDefined();expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith('sign-agreement',{body:{token,check_only:true}});
 fixture.invoke.mockResolvedValue({data:signingReceipt({replayed:true,completed:true,completion_state:'verified',completion_recovery_available:false}),error:null});
 await act(async()=>button('Finish completed copy').click());expect(fixture.invoke).toHaveBeenLastCalledWith('sign-agreement',{body:{token,action:'complete-recorded'}});
 expect(host.querySelector('h2')?.textContent).toBe('Signed and completed');expect(button('Download completed copy')).toBeDefined();expect(document.activeElement).toBe(host.querySelector('h2'));
});
it('does not offer completion while other signatures or original history remain unverified',async()=>{
 await mountRecorded({completion_state:'waiting_for_signatures',completion_recovery_available:false});
 expect(button('Finish completed copy')).toBeUndefined();expect(button('Check recorded status')).toBeDefined();expect(host.textContent).toContain('Other signatures');
});
it('keeps a recorded signature through an uncertain completion and checks before another attempt',async()=>{
 await mountRecorded();fixture.invoke.mockRejectedValue(new Error('Controlled lost reply'));
 await act(async()=>button('Finish completed copy').click());expect(host.querySelector('h2')?.textContent).toBe('Your signature is recorded');
 expect(button('Finish completed copy')).toBeUndefined();expect(button('Check recorded status')).toBeDefined();expect(signButton()).toBeUndefined();expect(fixture.invoke).toHaveBeenCalledTimes(2);
 fixture.invoke.mockResolvedValue({data:signingReceipt({replayed:true,completed:true,completion_state:'verified'}),error:null});
 await act(async()=>button('Check recorded status').click());expect(fixture.invoke).toHaveBeenLastCalledWith('sign-agreement',{body:{token,check_only:true}});expect(host.querySelector('h2')?.textContent).toBe('Signed and completed');
});
it('a failed status read preserves the signature already verified in this ceremony',async()=>{
 await mountRecorded({completion_recovery_available:false});fixture.invoke.mockRejectedValue(new Error('Controlled read unavailable'));
 await act(async()=>button('Check recorded status').click());expect(host.querySelector('h2')?.textContent).toBe('Your signature is recorded');expect(signButton()).toBeUndefined();
});
it('one explicit completion remains one request while it is pending',async()=>{
 await mountRecorded();let finish!:(v:unknown)=>void;fixture.invoke.mockImplementation(()=>new Promise(r=>{finish=r;}));
 await act(async()=>{button('Finish completed copy').click();button('Finish completed copy').click();});
 expect(fixture.invoke).toHaveBeenCalledTimes(2);expect([...host.querySelectorAll<HTMLButtonElement>('button')].every(b=>b.disabled)).toBe(true);
 await act(async()=>finish({data:signingReceipt({replayed:true,completed:true,completion_state:'verified'}),error:null}));expect(host.querySelector('h2')?.textContent).toBe('Signed and completed');
});
it('a retired credential closes recovery without disclosing the old private agreement',async()=>{
 await mountRecorded();fixture.invoke.mockResolvedValue({data:null,error:{context:new Response('{}',{status:404})}});
 await act(async()=>button('Finish completed copy').click());expect(host.querySelector('h2')?.textContent).toBe('This signing link is no longer available');expect(button('Download completed copy')).toBeUndefined();
});
it('downloads only through the original token document door after verified completion',async()=>{
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});await mountRecorded({completed:true,completion_state:'verified',completion_recovery_available:false});
 fixture.invoke.mockResolvedValue({data:new Blob([Uint8Array.from(atob(documentFixture.bytes),c=>c.charCodeAt(0))],{type:'application/pdf'}),error:null});
 await act(async()=>button('Download completed copy').click());expect(fixture.invoke).toHaveBeenLastCalledWith('agreement-document?token='+token,{method:'GET'});
 expect(click).toHaveBeenCalledTimes(1);expect(fixture.create).toHaveBeenCalledTimes(1);expect(host.querySelector('h2')?.textContent).toBe('Signed and completed');expect(host.textContent).toContain('ready to save');
});
it('a failed download retains verified completion and supports the same original read again',async()=>{
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});await mountRecorded({completed:true,completion_state:'verified',completion_recovery_available:false});
 fixture.invoke.mockResolvedValue({data:new Blob(['not a PDF'],{type:'text/html'}),error:null});
 await act(async()=>button('Download completed copy').click());expect(host.querySelector('h2')?.textContent).toBe('Signed and completed');expect(click).not.toHaveBeenCalled();expect(button('Try download again')).toBeDefined();
 fixture.invoke.mockResolvedValue({data:new Blob(['%PDF-1.7 controlled transport'],{type:'application/pdf'}),error:null});
 await act(async()=>button('Try download again').click());expect(click).toHaveBeenCalledTimes(1);expect(fixture.invoke).toHaveBeenLastCalledWith('agreement-document?token='+token,{method:'GET'});
});
it('retires a late completed-copy download before another credential can initiate it',async()=>{
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});await mountRecorded({completed:true,completion_state:'verified',completion_recovery_available:false});
 let late!:(v:unknown)=>void;fixture.invoke.mockImplementation(()=>new Promise(r=>{late=r;}));await act(async()=>button('Download completed copy').click());
 await act(async()=>router.navigate('/sign/'+nextToken));await act(async()=>late({data:new Blob(['%PDF-1.7 controlled transport'],{type:'application/pdf'}),error:null}));
 expect(click).not.toHaveBeenCalled();expect(fixture.create).not.toHaveBeenCalled();expect(host.querySelector('h2')?.textContent).toBe('This signing link is no longer available');
});
for(const code of ['SIGNING_FIELD_INPUT_INVALID','SIGNING_FIELD_UNRENDERABLE'])it('keeps exact answers editable after a known non-acting field refusal: '+code,async()=>{
 prepareOwn();await render();await completeAnswers();act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(i=>i.click()));
 fixture.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({ok:false,code,error:'Correct this assigned answer.'}),{status:400})}});
 await act(async()=>signButton().click());expect(host.querySelector<HTMLInputElement>('#field-'+ownText)?.value).toBe('Controlled Contact');expect(host.querySelector('[role=alert]')?.textContent).toContain('Correct this assigned answer');expect(signButton()).toBeDefined();expect(host.textContent).not.toContain('Signing is not yet confirmed');
});
