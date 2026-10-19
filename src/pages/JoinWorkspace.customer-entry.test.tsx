import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {MemoryRouter, Routes, Route} from "react-router-dom";
import {HelmetProvider} from "react-helmet-async";
import {beforeEach, afterEach, it, expect, vi} from "vitest";
import JoinWorkspace from "./JoinWorkspace";
import {ConsumerInvitation} from "./ConsumerInvitation";
const f=vi.hoisted(()=>({
  user:null as null|{id:string;email:string;email_confirmed_at?:string},
  rpc:vi.fn(),signUp:vi.fn(),signIn:vi.fn(),resend:vi.fn(),signOut:vi.fn(),
  listeners:[] as Array<(event:string,session:unknown)=>void>,
  accepted:false,
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
const subject="e0911000-0000-0000-0000-000000000001";
const client="e0931000-0000-0000-0000-000000000001";
const profile=()=>({id:client,tenant_id:tenant,linked_user_id:f.user?.id,first_name:"Test",last_name:"Customer",entity_name:null,street_address:null,city:null,state:null,zip_code:null,onboarding_stage:"invited",is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,updated_at:null,email:"recipient@tests.invalid",phone:null,contact_methods:[]});
let root:Root,host:HTMLDivElement;
const render=async()=>act(async()=>root.render(<HelmetProvider><MemoryRouter initialEntries={["/join/synthetic-recipient-token"]}><Routes><Route path="/join/:token" element={<JoinWorkspace/>}/><Route path="/app" element={<p>Portal destination</p>}/><Route path="/onboard/welcome" element={<p>Unrequested Welcome detour</p>}/></Routes></MemoryRouter></HelmetProvider>));
const button=(label:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent?.trim()===label||b.getAttribute("aria-label")===label)!;
const click=async(label:string)=>act(async()=>{const b=button(label);expect(b,`Missing button ${label}`).toBeTruthy();b.click();});
const input=async(id:string,value:string)=>act(async()=>{const el=host.querySelector<HTMLInputElement>(id)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));});
beforeEach(()=>{
  vi.clearAllMocks();f.user=null;f.listeners=[];f.accepted=false;localStorage.clear();
  vi.stubGlobal("ResizeObserver",class {observe(){}unobserve(){}disconnect(){}});
  f.rpc.mockImplementation(async(name:string)=>{
    if(name==="peek_tenant_invite")return{data:[{tenant_id:tenant,tenant_name:"Test Service",tenant_slug:"test-service",brand:{primary_color:"#26483e"},kind:"consumer",default_role:"member",expires_at:"2099-01-01",is_valid:true,invited_email:"recipient@tests.invalid"}],error:null};
    if(name==="client_portal_invite_status")return{data:f.accepted?{tenant_id:tenant,client_id:client,accepted_at:"2026-01-01",status:"accepted"}:null,error:null};
    if(name==="accept_tenant_invite"){f.accepted=true;return{data:tenant,error:null};}
    if(name==="client_portal_self_profile")return{data:profile(),error:null};
    throw Error("Unexpected customer entry write or reader");
  });
  f.signUp.mockResolvedValue({data:{user:{id:"new-subject"},session:null},error:null});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const remount=async()=>{await act(async()=>root.unmount());root=createRoot(host);await render();};
it("a confirmation redirect remount resumes the explicit signup and joins exactly once",async()=>{
  await render();await click("Create your account");await input('#customer-password','test-password-123');await click("I agree to the Terms and Privacy Policy");await click("Create account and join");
  expect(host.textContent).toContain("Check your email");
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  await remount();
  expect(host.textContent).toBe("Portal destination");
  expect(f.rpc.mock.calls.filter(([name])=>name==="accept_tenant_invite")).toHaveLength(1);
  await remount();
  expect(host.textContent).toBe("Portal destination");
  expect(f.rpc.mock.calls.filter(([name])=>name==="accept_tenant_invite")).toHaveLength(1);
});
const storedIntent=(overrides:Record<string,unknown>={})=>localStorage.setItem("paige_customer_join_intent",JSON.stringify({token:"synthetic-recipient-token",tenantId:tenant,email:"recipient@tests.invalid",at:Date.now(),...overrides}));
it.each([
  {at:Date.now()-31*60*1000},{at:Date.now()+60*1000},{at:"invalid"},
  {token:"other-invitation"},{tenantId:"other-business"},{email:"other@tests.invalid"},
])("does not resume expired, malformed or differently scoped intent %j",async(overrides)=>{
  storedIntent(overrides);f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  await render();expect(button("Open your portal")).toBeTruthy();
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("persisted intent cannot join a wrong or unconfirmed recipient",async()=>{
  storedIntent();f.user={id:"other",email:"other@tests.invalid",email_confirmed_at:"2026-01-01"};
  await render();expect(host.textContent).toContain("Use your invited account");
  expect(localStorage.getItem("paige_customer_join_intent")).toBeNull();
  storedIntent();f.user={id:subject,email:"recipient@tests.invalid"};await remount();
  expect(host.textContent).toContain("Check your email");
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("a resumed lost acceptance response is checked after remount without a second write",async()=>{
  storedIntent();f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
    if(name==="accept_tenant_invite"){f.accepted=true;throw Error("lost response");}
    return original(name,...args);
  });
  await render();expect(host.textContent).toContain("We couldn’t confirm acceptance");
  expect(localStorage.getItem("paige_customer_join_intent")).toBeNull();
  await remount();expect(host.textContent).toBe("Portal destination");
  expect(f.rpc.mock.calls.filter(([name])=>name==="accept_tenant_invite")).toHaveLength(1);
});
it("a signup error retires saved intent before the browser returns",async()=>{
  f.signUp.mockResolvedValue({data:{user:null,session:null},error:{status:500}});
  await render();await click("Create your account");await input('#customer-password','test-password-123');await click("I agree to the Terms and Privacy Policy");await click("Create account and join");
  expect(localStorage.getItem("paige_customer_join_intent")).toBeNull();
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};await remount();
  expect(button("Open your portal")).toBeTruthy();expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("sign-out retires the saved request rather than joining on a later login",async()=>{
  storedIntent();f.user={id:subject,email:"recipient@tests.invalid"};await render();
  await act(async()=>{f.user=null;f.listeners.forEach(fn=>fn("SIGNED_OUT",null));});
  expect(localStorage.getItem("paige_customer_join_intent")).toBeNull();
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};await remount();
  expect(button("Open your portal")).toBeTruthy();expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("storage refusal leaves a usable explicit join instead of fabricating resumed intent",async()=>{
  const storage=vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw Error("storage blocked");});
  try{
    f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};await render();
    expect(button("Open your portal")).toBeTruthy();await click("Open your portal");
    expect(host.textContent).toBe("Portal destination");
  }finally{storage.mockRestore();}
});
it("offers real recipient signup, keeps the bound email fixed, and waits for confirmation without accepting",async()=>{
  await render();await click("Create your account");
  expect(host.querySelector<HTMLInputElement>('#customer-email')?.readOnly).toBe(true);
  await input('#customer-password','test-password-123');
  await click("I agree to the Terms and Privacy Policy");
  await click("Create account and join");
  expect(f.signUp).toHaveBeenCalledWith({email:"recipient@tests.invalid",password:"test-password-123",options:{emailRedirectTo:expect.stringContaining("/join/synthetic-recipient-token")}});
  expect(host.textContent).toContain("Check your email");
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
  expect(host.querySelector<HTMLInputElement>('#customer-password')).toBeNull();
});
it("uses existing password sign-in as a separate choice and never silently accepts",async()=>{
  f.signIn.mockResolvedValue({data:{user:{id:subject}},error:null});
  await render();await click("Sign in");await input('#customer-password','existing-password');await click("Sign in and open portal");
  expect(f.signIn).toHaveBeenCalledWith({email:"recipient@tests.invalid",password:"existing-password"});
  expect(f.signUp).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("refuses a wrong signed-in recipient without consuming or silently replacing that session",async()=>{
  f.user={id:"other-subject",email:"other@tests.invalid",email_confirmed_at:"2026-01-01"};
  await render();expect(host.textContent).toContain("recipient@tests.invalid");
  expect(button("Open your portal")).toBeUndefined();
  expect(f.signOut).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("recovers an already accepted link for its actor even when the public peek is no longer valid",async()=>{
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
    if(name==="client_portal_invite_status")return{data:{tenant_id:tenant,client_id:client,accepted_at:"2026-01-01",status:"accepted"},error:null};
    const r=await original(name,...args);if(name==="peek_tenant_invite")r.data[0].is_valid=false;return r;
  });
  await render();expect(host.textContent).toBe("Portal destination");
  expect(button("Continue to your portal")).toBeUndefined();
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("keeps acceptance uncertain after a lost response and reconciles without submitting it again",async()=>{
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  let accepted=false;const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
    if(name==="accept_tenant_invite"){accepted=true;throw Error("lost response");}
    if(name==="client_portal_invite_status")return{data:accepted?{tenant_id:tenant,client_id:client,accepted_at:"2026-01-01",status:"accepted"}:null,error:null};
    return original(name,...args);
  });
  await render();await click("Open your portal");expect(host.textContent).toContain("We couldn’t confirm acceptance");
  await click("Check acceptance");expect(host.textContent).toBe("Portal destination");
  expect(f.rpc.mock.calls.filter(([name])=>name==="accept_tenant_invite")).toHaveLength(1);
});
it("refuses a foreign-tenant receipt and offers retry without accepting",async()=>{
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==="client_portal_invite_status"?{data:{tenant_id:"foreign",client_id:client,accepted_at:"2026-01-01",status:"accepted"},error:null}:original(name,...args));
  await render();expect(button("Continue to your portal")).toBeUndefined();expect(button("Try again")).toBeTruthy();
});
it("a session change retires the pending acceptance response",async()=>{
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  let settle!:(value:unknown)=>void;const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation((name:string,...args:unknown[])=>name==="accept_tenant_invite"?new Promise(resolve=>{settle=resolve;}):original(name,...args));
  await render();await click("Open your portal");
  await act(async()=>{f.user={id:"new-subject",email:"other@tests.invalid",email_confirmed_at:"2026-01-01"};f.listeners.forEach(fn=>fn("SIGNED_IN",{user:f.user}));});
  await act(async()=>settle({data:tenant,error:null}));
  expect(host.textContent).toContain("Use your invited account");expect(button("Continue to your portal")).toBeUndefined();
});
it("a stale invitation cannot start signup",async()=>{
  await render();await click("Create your account");await input('#customer-password','test-password-123');await click("I agree to the Terms and Privacy Policy");
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{const r=await original(name,...args);if(name==="peek_tenant_invite")r.data[0].is_valid=false;return r;});
  await click("Create account and join");expect(host.textContent).toContain("This invitation is unavailable");expect(f.signUp).not.toHaveBeenCalled();
});
it("a signed-out returning recipient can sign in through a consumed link and recover existing access",async()=>{
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
    if(name==="client_portal_invite_status")return{data:f.user?{tenant_id:tenant,client_id:client,accepted_at:"2026-01-01",status:"accepted"}:null,error:null};
    const r=await original(name,...args);if(name==="peek_tenant_invite")r.data[0].is_valid=false;return r;
  });
  f.signIn.mockImplementation(async()=>{f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};return{data:{user:f.user},error:null};});
  await render();await click("Sign in to check existing access");await input('#customer-password','existing-password');await click("Sign in and open portal");
  expect(host.textContent).toBe("Portal destination");expect(f.signUp).not.toHaveBeenCalled();
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("an invitation revoked after page load becomes unavailable on recovery",async()=>{
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  let revoked=false;const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
    if(name==="accept_tenant_invite"){revoked=true;return{data:null,error:{code:"42501"}};}
    const r=await original(name,...args);if(name==="peek_tenant_invite")r.data[0].is_valid=!revoked;return r;
  });
  await render();await click("Open your portal");await click("Check acceptance");
  expect(host.textContent).toContain("This invitation is unavailable");expect(button("Open your portal")).toBeUndefined();
});
it("a failed explicit sign-out leaves a retryable account boundary",async()=>{
  f.user={id:"other",email:"other@tests.invalid",email_confirmed_at:"2026-01-01"};f.signOut.mockRejectedValue(Error("offline"));
  await render();await click("Sign out of this session");
  expect(host.textContent).toContain("Sign-out could not be confirmed");expect(button("Sign out of this session").disabled).toBe(false);
});
it("Back from consumed-link sign-in does not reopen the create-account choice",async()=>{
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{const r=await original(name,...args);if(name==="peek_tenant_invite")r.data[0].is_valid=false;return r;});
  await render();await click("Sign in to check existing access");await click("Back");
  expect(button("Create your account")).toBeUndefined();expect(button("Sign in to check existing access")).toBeTruthy();
});
it("verified acceptance opens the existing portal without Welcome or a full page reload",async()=>{
  const subject="e0911000-0000-0000-0000-000000000001",client="e0931000-0000-0000-0000-000000000001";
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  const saved={tenant_id:tenant,client_id:client,accepted_at:"2026-01-01",status:"accepted"};
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
    if(name==="client_portal_invite_status")return{data:saved,error:null};
    if(name==="client_portal_self_profile")return{data:{id:client,tenant_id:tenant,linked_user_id:subject,first_name:"Test",last_name:"Customer",entity_name:null,street_address:null,city:null,state:null,zip_code:null,onboarding_stage:"invited",is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,updated_at:null,email:"recipient@tests.invalid",phone:null,contact_methods:[]},error:null};
    return original(name,...args);
  });
  await render();expect(host.textContent).toBe("Portal destination");
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});

it("an explicit password sign-in joins once and opens the actual authorized relationship",async()=>{
  f.signIn.mockImplementation(async()=>{
    f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
    f.listeners.forEach(fn=>fn("SIGNED_IN",{user:f.user}));
    return{data:{user:f.user,session:{user:f.user}},error:null};
  });
  await render();await click("Sign in");await input('#customer-password','existing-password');await click("Sign in and open portal");
  expect(host.textContent).toBe("Portal destination");
  expect(f.rpc.mock.calls.filter(([name])=>name==="accept_tenant_invite")).toHaveLength(1);
  expect(f.rpc.mock.calls.some(([name])=>/welcome|advance_onboarding|agreement|provision/.test(name))).toBe(false);
});
it("signup waits for verified email and then enters without an extra acceptance screen",async()=>{
  await render();await click("Create your account");await input('#customer-password','test-password-123');await click("I agree to the Terms and Privacy Policy");await click("Create account and join");
  expect(host.textContent).toContain("Check your email");
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
  await act(async()=>{
    f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
    f.listeners.forEach(fn=>fn("SIGNED_IN",{user:f.user}));
  });
  expect(host.textContent).toBe("Portal destination");
  expect(f.rpc.mock.calls.filter(([name])=>name==="accept_tenant_invite")).toHaveLength(1);
});
it("a server signup failure stays editable and never says account setup succeeded",async()=>{
  f.signUp.mockResolvedValue({data:{user:null,session:null},error:{status:500,code:"unexpected_failure",message:"private provider configuration detail"}});
  await render();await click("Create your account");await input('#customer-password','test-password-123');await click("I agree to the Terms and Privacy Policy");await click("Create account and join");
  expect(host.textContent).toContain("We couldn’t finish account setup");
  expect(host.textContent).not.toContain("Check your email");expect(host.textContent).not.toContain("private provider");
  expect(host.querySelector<HTMLInputElement>('#customer-password')?.value).toBe('test-password-123');
  expect(button("Create account and join").disabled).toBe(false);
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("a signed-in but unconfirmed recipient cannot join even after submitting a password",async()=>{
  f.signIn.mockImplementation(async()=>{
    f.user={id:subject,email:"recipient@tests.invalid"};return{data:{user:f.user,session:{user:f.user}},error:null};
  });
  await render();await click("Sign in");await input('#customer-password','existing-password');await click("Sign in and open portal");
  expect(host.textContent).toContain("Check your email");expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("a recorded acceptance cannot open a foreign customer profile",async()=>{
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};f.accepted=true;
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==="client_portal_self_profile"?{data:{...profile(),tenant_id:"foreign"},error:null}:original(name,...args));
  await render();expect(host.textContent).not.toBe("Portal destination");expect(button("Try again")).toBeTruthy();
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("a password submission cannot carry automatic join intent into a different invitation",async()=>{
  const info={tenant_id:tenant,tenant_name:"Test Service",is_valid:true,invited_email:"recipient@tests.invalid",brand:null};
  const direct=async(token:string)=>act(async()=>root.render(<HelmetProvider><MemoryRouter><ConsumerInvitation token={token} info={info}/></MemoryRouter></HelmetProvider>));
  await direct("first-recipient-token");await click("Create your account");await input('#customer-password','test-password-123');await click("I agree to the Terms and Privacy Policy");await click("Create account and join");
  expect(host.textContent).toContain("Check your email");
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  await direct("different-recipient-token");
  expect(button("Open your portal")).toBeTruthy();
  expect(f.rpc.mock.calls.some(([name])=>name==="accept_tenant_invite")).toBe(false);
});
it("changing invitation retires the old password draft and consent checkbox",async()=>{
  const info={tenant_id:tenant,tenant_name:"Test Service",is_valid:true,invited_email:"recipient@tests.invalid",brand:null};
  const direct=async(token:string)=>act(async()=>root.render(<HelmetProvider><MemoryRouter><ConsumerInvitation token={token} info={info}/></MemoryRouter></HelmetProvider>));
  await direct("first-recipient-token");await click("Create your account");await input('#customer-password','private-draft-password');await click("I agree to the Terms and Privacy Policy");
  await direct("different-recipient-token");await click("Create your account");
  expect(host.querySelector<HTMLInputElement>('#customer-password')?.value).toBe("");
  expect(host.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe("false");
  expect(f.signUp).not.toHaveBeenCalled();
});
// E09 Slice 7: the business paused or ended this person's access after they joined. The old link's
// status says so; the page names it in the business's words instead of "Let's try again", and never
// reaches for the portal it no longer opens.
it.each([
  ["paused","Your access to Test Service is paused."],
  ["ended","Your access to Test Service has ended."],
] as const)("an accepted link whose access is %s says so instead of a generic error",async(state,title)=>{
  f.user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name:string,...args:unknown[])=>{
    if(name==="client_portal_invite_status")return{data:{tenant_id:tenant,client_id:client,accepted_at:"2026-01-01",status:state},error:null};
    return original(name,...args);
  });
  await render();
  expect(host.querySelector("h1")?.textContent).toBe(title);
  expect(host.textContent).not.toContain("Let’s try again");
  expect(host.textContent).not.toBe("Portal destination");
  expect(button("Sign out")).toBeTruthy();
  expect(f.rpc.mock.calls.some(([name])=>name==="client_portal_self_profile"||name==="accept_tenant_invite")).toBe(false);
});
