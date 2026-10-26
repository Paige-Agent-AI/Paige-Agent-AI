import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const f = vi.hoisted(() => ({tenant:'test-business-a',actor:'test-owner-a',brand:{} as Record<string, unknown>,
  calls:[] as {fn:string;args:Record<string,unknown>}[],fail:false,lose:false,readFail:false,mismatch:false,
  pending:false,resume:null as null|(()=>void)}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>({activeTenantId:f.tenant,activeUserId:f.actor})}));
vi.mock('@/hooks/useFinanceEntitlement',()=>({useFinanceEntitlement:()=>({entitled:false})}));
vi.mock('@/integrations/supabase/client',()=>{
  const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{name:'Northwind Studio',brand:structuredClone(f.brand),features:{}},error:f.readFail?new Error('Read unavailable'):null})};
  return {supabase:{from:()=>chain,rpc:async(fn:string,args:Record<string,unknown>)=>{
    if(fn==='resolve_tenant_brand')return{data:{support_email:'platform-inheritance@example.com'},error:null};
    f.calls.push({fn,args});
    if(f.pending)await new Promise<void>(r=>{f.resume=r;});
    if(f.fail)return{data:null,error:new Error('Permission denied')};
    f.brand={...f.brand,...args._patch as object};
    if(f.mismatch)f.brand.support_email='newer@northwind.example';
    return{data:f.brand,error:f.lose?new Error('Lost response'):null};
  },storage:{from:()=>({})}}};
});
import PortalStudio from './PortalStudio';
let host:HTMLDivElement,root:Root,qc:QueryClient;
const flush=async()=>{for(let n=0;n<6;n++)await act(async()=>{await new Promise(r=>setTimeout(r,0));});};
const render=async()=>{await act(async()=>root.render(<QueryClientProvider client={qc}><PortalStudio embedded /></QueryClientProvider>));await flush();};
const field=()=>host.querySelector<HTMLInputElement>('#portal-support-email')!;
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;
const click=async(text:string)=>{await act(async()=>button(text).click());await flush();};
const change=async(value:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field(),value);field().dispatchEvent(new Event('input',{bubbles:true}));});};
beforeEach(async()=>{
  Object.assign(f,{tenant:'test-business-a',actor:'test-owner-a',brand:{support_email:'help@northwind.example',font:'Original',invoice_preferences:{existing:true}},calls:[],fail:false,lose:false,readFail:false,mismatch:false,pending:false,resume:null});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});await render();
});
afterEach(()=>{act(()=>root.unmount());qc.clear();host.remove();});
describe('Support email in the original Portal editor and brand writer',()=>{
  it('writes only the contact, checks the original saved source and returns to it later',async()=>{
    await change(' care@northwind.example ');await click('Save support email');
    expect(f.calls).toEqual([{fn:'set_tenant_brand',args:{_tenant_id:f.tenant,_patch:{support_email:'care@northwind.example'}}}]);
    expect(f.brand.invoice_preferences).toEqual({existing:true});expect(f.brand.font).toBe('Original');
    expect(host.textContent).toContain('Support email saved and checked.');expect(button('Save support email').disabled).toBe(true);
    await act(async()=>{root.unmount();root=createRoot(host);});await render();expect(field().value).toBe('care@northwind.example');
  });
  it('clears the original field without saving inherited platform contact',async()=>{
    await change('');await click('Save support email');expect(f.brand.support_email).toBe('');expect(field().value).toBe('');
    expect(host.textContent).not.toContain('platform-inheritance@example.com');
  });
  it('withholds malformed legacy JSON instead of treating it as a contact',async()=>{
    f.brand={support_email:{private:'not a public email'}};qc.clear();await render();
    expect(field().value).toBe('');expect(host.textContent).not.toContain('not a public email');expect(f.calls).toEqual([]);
  });
  it.each(['bad','privacy@paigeagent.ai','support@mail.paigeagent.ai','a@example.com?bcc=other@example.com'])('refuses invalid or platform address %s without writing',async value=>{
    await change(value);await click('Save support email');expect(f.calls).toEqual([]);expect(field().getAttribute('aria-invalid')).toBe('true');expect(document.activeElement).toBe(field());
  });
  it('reconciles an interrupted acknowledgment with a read and no duplicate write',async()=>{
    await change('care@northwind.example');f.lose=true;await click('Save support email');
    expect(field().disabled).toBe(true);expect(host.textContent).toContain("couldn't confirm");
    await click('Check saved email');expect(f.calls).toHaveLength(1);expect(host.textContent).toContain('saved and checked');
  });
  it('keeps the draft through failed readback, then reads without repeating the write',async()=>{
    await change('care@northwind.example');f.readFail=true;await click('Save support email');
    expect(field().value).toBe('care@northwind.example');expect(host.textContent).toContain("couldn't confirm");
    f.readFail=false;await click('Check saved email');expect(f.calls).toHaveLength(1);expect(host.textContent).toContain('saved and checked');
  });
  it('does not claim success or overwrite when another saved value wins',async()=>{
    await change('care@northwind.example');f.mismatch=true;await click('Save support email');
    expect(host.textContent).toContain('differs from your draft');expect(host.textContent).not.toContain('saved and checked');
    await click('Review draft');expect(field().value).toBe('care@northwind.example');expect(document.activeElement).toBe(field());await click('Discard changes');expect(field().value).toBe('newer@northwind.example');expect(f.calls).toHaveLength(1);
  });
  it('preserves a denied draft and requires read reconciliation before retry',async()=>{
    await change('care@northwind.example');f.fail=true;await click('Save support email');expect(field().value).toBe('care@northwind.example');
    await click('Check saved email');expect(f.calls).toHaveLength(1);await click('Review draft');expect(field().disabled).toBe(false);
  });
  it('retires old drafts and late results on business change',async()=>{
    await change('care@northwind.example');f.pending=true;await click('Save support email');
    const release=f.resume!;
    f.tenant='test-business-b';
    f.brand={support_email:'help@harbor.example'};await render();expect(field().value).toBe('help@harbor.example');
    await act(async()=>{f.pending=false;release();});await flush();expect(field().value).toBe('help@harbor.example');expect(host.textContent).not.toContain('saved and checked');
  });
  it('retires an unsent support draft on actor change within the same business',async()=>{
    await change('unsaved@northwind.example');f.actor='test-owner-b';await render();
    expect(field().value).toBe('help@northwind.example');expect(f.calls).toEqual([]);
  });
});
