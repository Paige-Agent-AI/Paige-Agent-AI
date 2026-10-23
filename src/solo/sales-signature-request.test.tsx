import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
import {SignatureSender} from './sales-ops';

// Actual original panel/portal/focus code; request/link/void transports are
// controlled, never a real customer send, signing token or payment.
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement,signings:{sendForSignature:ReturnType<typeof vi.fn>;issueLink:ReturnType<typeof vi.fn>;voidSigning:ReturnType<typeof vi.fn>},close:ReturnType<typeof vi.fn>,voided:ReturnType<typeof vi.fn>;
const tenant='aaaaaaaa-0000-4000-8000-000000000001',agreement='cccccccc-0000-4000-8000-000000000001';
const accepted=()=>({ok:true,sent:['client@example.test'],notDelivered:[],failed:[]});
async function mount(state='draft'){await act(async()=>root.render(<SignatureSender signings={signings} signing={{id:agreement,documentTitle:'Controlled unsigned document',displayState:state}} clientName="Controlled Client" agreedLabel="Recorded amount" tenantId={tenant} onClose={close} onVoided={voided}/>));}
function dialog(){const value=document.querySelector<HTMLElement>('[role="dialog"]');if(!value)throw Error('Original signature-request dialog missing');return value;}
function button(name:string){const value=[...dialog().querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name);if(!value)throw Error('Missing '+name);return value;}
async function click(name:string){await act(async()=>button(name).click());}
beforeEach(()=>{close=vi.fn();voided=vi.fn();signings={sendForSignature:vi.fn().mockResolvedValue(accepted()),issueLink:vi.fn().mockResolvedValue({ok:true,token:'controlled-local-token',expiresAt:null}),voidSigning:vi.fn().mockResolvedValue({ok:true})};host=document.createElement('div');host.className='paige-solo';document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root?.unmount());host?.remove();vi.restoreAllMocks();});
it('does no effect on entry and does not invent a never-sent assertion for an existing agreement',async()=>{
  await mount('sent');expect(signings.sendForSignature).not.toHaveBeenCalled();expect(dialog().textContent).not.toContain('Nothing has been sent yet.');expect(dialog().querySelectorAll('[role="dialog"]')).toHaveLength(0);
});
it('provider acceptance is displayed separately from delivery, opening and signature evidence',async()=>{
  await mount();await click('Send it to Controlled');expect(dialog().textContent).toContain('Accepted for sending');expect(dialog().textContent).not.toContain('has a private link');expect(dialog().textContent).not.toContain('The record now shows this document as sent.');expect(dialog().textContent).toContain('Delivery');
});
it('preserves partial recipient issues and record warnings instead of promising a complete result',async()=>{
  signings.sendForSignature.mockResolvedValue({...accepted(),failed:[{email:'other@example.test',reason:'Link activation requires inspection.'}],notDelivered:['prior@example.test'],warning:'Recorded status needs inspection.'});await mount();await click('Send it to Controlled');expect(dialog().textContent).toContain('other@example.test');expect(dialog().textContent).toContain('prior@example.test');expect(dialog().textContent).toContain('inspection');expect(dialog().textContent).not.toContain('did not receive it');expect(dialog().textContent).not.toContain('No message reached anybody');
});
it('does not repeat the legacy sender delivery inference as an established outcome',async()=>{
  signings.sendForSignature.mockResolvedValue({...accepted(),failed:[{email:'other@example.test',reason:'the email could not be delivered'}]});await mount();await click('Send it to Controlled');expect(dialog().textContent).toContain('other@example.test');expect(dialog().textContent).toContain('did not confirm provider acceptance');expect(dialog().textContent).not.toContain('the email could not be delivered');
});
it('unknown outcome holds immediate repeat/link/void actions and returns to the original record',async()=>{
  signings.sendForSignature.mockResolvedValue({ok:false,state:'unconfirmed',message:'The request may have completed.'});await mount('sent');await click('Send it to Controlled');expect(dialog().textContent).toContain('Signing request not verified');expect([...dialog().querySelectorAll('button')].some(b=>b.textContent==='Send it to Controlled')).toBe(false);expect(dialog().textContent).not.toContain('Or copy a link');expect(dialog().textContent).not.toContain('Stop the current link');await click('Return to agreement');expect(close).toHaveBeenCalledOnce();expect(signings.sendForSignature).toHaveBeenCalledOnce();expect(signings.issueLink).not.toHaveBeenCalled();expect(signings.voidSigning).not.toHaveBeenCalled();
});
it('a conclusive local refusal remains correctable without claiming delivery',async()=>{
  signings.sendForSignature.mockResolvedValue({ok:false,state:'refused',message:'This page did not request a send.'});await mount();await click('Send it to Controlled');expect(dialog().textContent).toContain('This page did not request a send.');expect(dialog().textContent).not.toContain('Signing request not verified');expect(button('Send it to Controlled').disabled).toBe(false);
});
it('two gestures before the render completes invoke the original request only once',async()=>{
  let resolve!:(value:ReturnType<typeof accepted>)=>void;signings.sendForSignature.mockReturnValue(new Promise(done=>{resolve=done;}));await mount();await act(async()=>{const send=button('Send it to Controlled');send.click();send.click();});expect(signings.sendForSignature).toHaveBeenCalledOnce();await act(async()=>resolve(accepted()));
});
it('preserves the original copy-link and explicit void capabilities without asserting client delivery',async()=>{
  await mount();await click('Or copy a link to send yourself');await click('Make the link');expect(signings.issueLink).toHaveBeenCalledWith(agreement,14,tenant);expect(dialog().textContent).toContain('The link — copy it now');expect(dialog().textContent).not.toContain('The record now shows this document as sent.');
});
