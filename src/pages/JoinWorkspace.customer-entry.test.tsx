import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {MemoryRouter, Routes, Route} from "react-router-dom";
import {HelmetProvider} from "react-helmet-async";
import {beforeEach, afterEach, it, expect, vi} from "vitest";
import JoinWorkspace from "./JoinWorkspace";
const f=vi.hoisted(()=>({
  user:null as null|{id:string;email:string;email_confirmed_at?:string},
  rpc:vi.fn(),signUp:vi.fn(),signIn:vi.fn(),resend:vi.fn(),signOut:vi.fn(),
  listeners:[] as Array<(event:string,session:unknown)=>void>,
}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{
  rpc:(...args:unknown[])=>f.rpc(...args),
  auth:{getUser:async()=>({data:{user:f.user},error:null}),
    signUp:(...args:unknown[])=>f.signUp(...args),signInWithPassword:(...args:unknown[])=>f.signIn(...args),
    resend:(...args:unknown[])=>f.resend(...args),signOut:(...args:unknown[])=>f.signOut(...args),
    onAuthStateChange:(fn:typeof f.listeners[number])=>{f.listeners.push(fn);return{data:{subscription:{unsubscribe:()=>{f.listeners=f.listeners.filter(x=>x!==fn);}}}}},
  },from:()=>{throw Error("No raw table or provisioning reads in customer entry");},
}}));
vi.mock("@/components/legal/ContextualConsentDialog",()=>({ContextualConsentDialog:()=>null}));
vi.mock("sonner",()=>({toast:{error:vi.fn(),success:vi.fn()}}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const tenant="e0921000-0000-0000-0000-000000000001";
let root:Root,host:HTMLDivElement;
const render=async()=>act(async()=>root.render(<HelmetProvider><MemoryRouter initialEntries={["/join/synthetic-recipient-token"]}><Routes><Route path="/join/:token" element={<JoinWorkspace/>}/></Routes></MemoryRouter></HelmetProvider>));
const button=(label:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent?.trim()===label||b.getAttribute("aria-label")===label)!;
const click=async(label:string)=>act(async()=>{const b=button(label);expect(b,`Missing button ${label}`).toBeTruthy();b.click();});
const input=async(id:string,value:string)=>act(async()=>{const el=host.querySelector<HTMLInputElement>(id)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));});
beforeEach(()=>{
  vi.clearAllMocks();f.user=null;f.listeners=[];localStorage.clear();
  vi.stubGlobal("ResizeObserver",class {observe(){}unobserve(){}disconnect(){}});
  f.rpc.mockImplementation(async(name:string)=>name==="peek_tenant_invite"?{data:[{tenant_id:tenant,tenant_name:"Test Service",tenant_slug:"test-service",brand:{primary_color:"#26483e"},kind:"consumer",default_role:"member",expires_at:"2099-01-01",is_valid:true,invited_email:"recipient@tests.invalid"}],error:null}:{data:null,error:null});
  f.signUp.mockResolvedValue({data:{user:{id:"new-subject"},session:null},error:null});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it("offers real recipient signup, keeps the bound email fixed, and waits for confirmation without accepting",async()=>{
  await render();await click("Create your account");
  expect(host.querySelector<HTMLInputElement>('#customer-email')?.readOnly).toBe(true);
  await input('#customer-password','test-password-123');
  await click("I agree to the Terms and Privacy Policy");
  await click("Create account");
  expect(f.signUp).toHaveBeenCalledWith({email:"recipient@tests.invalid",password:"test-password-123",options:{emailRedirectTo:expect.stringContaining("/join/synthetic-recipient-token")}});
  expect(host.textContent).toContain("Check your email");
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
  expect(host.querySelector<HTMLInputElement>('#customer-password')).toBeNull();
});
it("uses existing password sign-in as a separate choice and never silently accepts",async()=>{
  f.signIn.mockResolvedValue({data:{user:{id:"subject"}},error:null});
  await render();await click("Sign in");await input('#customer-password','existing-password');await click("Sign in to continue");
  expect(f.signIn).toHaveBeenCalledWith({email:"recipient@tests.invalid",password:"existing-password"});
  expect(f.signUp).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("refuses a wrong signed-in recipient without consuming or silently replacing that session",async()=>{
  f.user={id:"other-subject",email:"other@tests.invalid",email_confirmed_at:"2026-01-01"};
  await render();expect(host.textContent).toContain("recipient@tests.invalid");
  expect(button("Accept invitation")).toBeUndefined();
  expect(f.signOut).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("recovers an already accepted link for its actor even when the public peek is no longer valid",async()=>{
  f.user={id:"subject",email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
    if(name==="client_portal_invite_status")return{data:{tenant_id:tenant,client_id:"contact-a",accepted_at:"2026-01-01",status:"accepted"},error:null};
    const r=await original(name,...args);if(name==="peek_tenant_invite")r.data[0].is_valid=false;return r;
  });
  await render();expect(host.textContent).toContain("Your invitation is accepted");
  expect(button("Continue to your portal")).toBeTruthy();
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("keeps acceptance uncertain after a lost response and reconciles without submitting it again",async()=>{
  f.user={id:"subject",email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  let accepted=false;const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
    if(name==="accept_tenant_invite"){accepted=true;throw Error("lost response");}
    if(name==="client_portal_invite_status")return{data:accepted?{tenant_id:tenant,client_id:"contact-a",accepted_at:"2026-01-01",status:"accepted"}:null,error:null};
    return original(name,...args);
  });
  await render();await click("Accept invitation");expect(host.textContent).toContain("We couldn’t confirm acceptance");
  await click("Check acceptance");expect(host.textContent).toContain("Your invitation is accepted");
  expect(f.rpc.mock.calls.filter(([name])=>name==="accept_tenant_invite")).toHaveLength(1);
});
it("refuses a foreign-tenant receipt and offers retry without accepting",async()=>{
  f.user={id:"subject",email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==="client_portal_invite_status"?{data:{tenant_id:"foreign",client_id:"contact-a",accepted_at:"2026-01-01",status:"accepted"},error:null}:original(name,...args));
  await render();expect(button("Continue to your portal")).toBeUndefined();expect(button("Try again")).toBeTruthy();
});
it("a session change retires the pending acceptance response",async()=>{
  f.user={id:"subject",email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  let settle!:(value:unknown)=>void;const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation((name:string,...args:unknown[])=>name==="accept_tenant_invite"?new Promise(resolve=>{settle=resolve;}):original(name,...args));
  await render();await click("Accept invitation");
  await act(async()=>{f.user={id:"new-subject",email:"other@tests.invalid",email_confirmed_at:"2026-01-01"};f.listeners.forEach(fn=>fn("SIGNED_IN",{user:f.user}));});
  await act(async()=>settle({data:tenant,error:null}));
  expect(host.textContent).toContain("Use your invited account");expect(button("Continue to your portal")).toBeUndefined();
});
it("a stale invitation cannot start signup",async()=>{
  await render();await click("Create your account");await input('#customer-password','test-password-123');await click("I agree to the Terms and Privacy Policy");
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{const r=await original(name,...args);if(name==="peek_tenant_invite")r.data[0].is_valid=false;return r;});
  await click("Create account");expect(host.textContent).toContain("This invitation is unavailable");expect(f.signUp).not.toHaveBeenCalled();
});
