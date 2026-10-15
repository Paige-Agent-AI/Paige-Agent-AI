import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientPortalSelfProfile } from "@/lib/client-portal-self-profile";

const actorA = "e0911000-0000-0000-0000-000000000001";
const actorB = "e0911000-0000-0000-0000-000000000002";
const initialProfile = (): ClientPortalSelfProfile => ({
  id: "e0931000-0000-0000-0000-000000000001", tenant_id: "e0921000-0000-0000-0000-000000000001",
  linked_user_id: actorA, first_name: "Test", last_name: "Customer", entity_name: null,
  street_address: null, city: null, state: null, zip_code: null, onboarding_stage: "invited",
  is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null,
  updated_at: "2026-10-15T18:00:00Z", email: "customer@tests.invalid", phone: "+12025550109",
  contact_methods: [{ kind: "phone", value: "+12025550109", is_primary: true }],
});
const initialState = () => ({ status: "ready", profile: initialProfile(),
  fields: [{ key: "goal", label: "Your goal", type: "text", required: true }],
  answers: { goal: "Saved goal" }, intake_updated_at: null, intake_submitted_at: null, expected_token: "a".repeat(32) });
type Listener = (event: string, session: { user: { id: string } } | null) => void;
let actor: string | null, native: ReturnType<typeof initialState>, listener: Listener | undefined;
let saveError: { code?: string } | null, pendingSave: Promise<{ data: unknown; error: unknown }> | null;
const rpc = vi.fn(), raw = vi.fn(), headers = vi.fn(), getUser = vi.fn(), getSession = vi.fn();
const refresh = vi.fn(), acceptSavedProfile = vi.fn(), unsubscribe = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...args: unknown[]) => {
    const response = rpc(...args);
    return Object.assign(response, { setHeader: (key: string, value: string) => { headers(key, value); return response; } });
  },
  from: (...args: unknown[]) => {
    raw(...args);
    const read = { eq: () => read, maybeSingle: () => Promise.resolve({ data: { payload: {} }, error: null }) };
    return { select: () => read, update: () => ({ eq: () => Promise.resolve({ error: null }) }), upsert: () => Promise.resolve({ error: null }) };
  },
  auth: { getUser: (...args: unknown[]) => getUser(...args), getSession: () => getSession(), onAuthStateChange: (cb: Listener) => {
    listener = cb; return { data: { subscription: { unsubscribe } } };
  } },
} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "Assistant" }, intake: [
  { key: "foreign", label: "Wrong workspace question", type: "text" },
] }) }));
const { default: Step1Welcome } = await import("./Step1Welcome");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
async function flush() { await act(async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); }); }
function Parent() { return <Outlet context={{ client: initialProfile(), refresh, acceptSavedProfile,
  brand: { tenant_name: "Test service", logo_url: null, primary_color: "#385d4b" } }} />; }
async function mount() {
  act(() => root.render(<MemoryRouter initialEntries={["/onboard/welcome"]}><Routes><Route element={<Parent />}>
    <Route path="/onboard/welcome" element={<Step1Welcome />} /><Route path="/onboard/agreement" element={<p>Agreement route</p>} />
    <Route path="/app" element={<p>Workspace route</p>} />
  </Route></Routes></MemoryRouter>)); await flush();
}
function button(text: string) { return Array.from(host.querySelectorAll("button")).find(x => x.textContent?.trim() === text)!; }
function input(text: string) {
  const label = Array.from(host.querySelectorAll("label")).find(x => x.textContent?.startsWith(text));
  return label?.htmlFor ? host.querySelector<HTMLInputElement>(`#${label.htmlFor}`)! : null;
}
async function change(text: string, value: string) {
  const control = input(text); expect(control).not.toBeNull();
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(control,value);
    control!.dispatchEvent(new Event("input", { bubbles: true })); }); await flush();
}
async function submit() {
  act(() => { const form = host.querySelector("form");
    if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    else button("Continue to agreement")?.click(); }); await flush();
}
beforeEach(() => {
  actor = actorA; native = initialState(); listener = undefined; saveError = null; pendingSave = null;
  for (const mock of [rpc,raw,headers,getUser,getSession,refresh,acceptSavedProfile,unsubscribe]) mock.mockReset();
  acceptSavedProfile.mockReturnValue(true);
  getSession.mockImplementation(async () => ({ data: { session: actor ? { access_token: "synthetic-request-credential" } : null }, error: null }));
  getUser.mockImplementation(async () => ({ data: { user: actor ? { id: actor } : null }, error: null }));
  rpc.mockImplementation(async (name: string, args?: { p_profile: Record<string,string>; p_answers: Record<string,unknown> }) => {
    if (name === "client_portal_save_welcome") {
      if (pendingSave) return pendingSave;
      if (saveError) return { data: null, error: saveError };
      native = { ...native, expected_token: "b".repeat(32), intake_submitted_at: "2026-10-15T19:00:00Z" as never,
        profile: { ...native.profile, ...args!.p_profile, onboarding_stage: "signing_agreement" }, answers: args!.p_answers as { goal: string } };
    }
    return { data: structuredClone(native), error: null };
  });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it("loads only native sponsoring questions and never reads raw intake or selected-workspace Playbook", async () => {
  await mount(); expect(rpc).toHaveBeenCalledWith("client_portal_welcome_state");
  expect(input("Your goal")?.value).toBe("Saved goal"); expect(host.textContent).not.toContain("Wrong workspace"); expect(raw).not.toHaveBeenCalled();
});
it("saves required phone and all answers once, reads canonical state, then adopts and navigates", async () => {
  await mount(); await change("Phone number","+12025550131"); await change("Your goal","Updated goal"); await submit();
  expect(rpc).toHaveBeenCalledWith("client_portal_save_welcome",expect.objectContaining({ p_expected_token:"a".repeat(32),
    p_profile: expect.objectContaining({ phone:"+12025550131" }),p_answers:{goal:"Updated goal"} }));
  expect(headers).toHaveBeenCalledWith("Authorization","Bearer synthetic-request-credential");
  expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_welcome_state")).toHaveLength(2);
  expect(acceptSavedProfile).toHaveBeenCalledWith(expect.objectContaining({phone:"+12025550131",onboarding_stage:"signing_agreement"}));
  expect(host.textContent).toContain("Agreement route"); expect(refresh).not.toHaveBeenCalled(); expect(raw).not.toHaveBeenCalled();
});
it("renders an existing editor's digit-leading question key through the native envelope",async()=>{
  rpc.mockResolvedValue({data:{...initialState(),fields:[{key:"90_day_goal",label:"90 day goal",type:"text",required:true}],
    answers:{"90_day_goal":"Saved native answer"}},error:null});await mount();
  expect(input("90 day goal")?.value).toBe("Saved native answer");expect(raw).not.toHaveBeenCalled();
});
for(const count of [0,3.5,null])it(`saves untouched normalized numeric readback ${String(count)} without re-entry`,async()=>{
  native={...initialState(),fields:[...initialState().fields,{key:"count",label:"Target milestones",type:"number",required:false}],
    answers:{goal:"Saved goal",count}} as ReturnType<typeof initialState>;
  await mount();await submit();
  expect(rpc).toHaveBeenCalledWith("client_portal_save_welcome",expect.objectContaining({p_answers:{goal:"Saved goal",count}}));
  expect(host.textContent).toContain("Agreement route");
});
it("accepts focused decimal input through native form submission without step mismatch",async()=>{
  native={...initialState(),fields:[...initialState().fields,{key:"count",label:"Target milestones",type:"number",required:false}],
    answers:{goal:"Saved goal",count:3}} as ReturnType<typeof initialState>;
  await mount();act(()=>input("Target milestones")!.focus());await change("Target milestones","3.5");
  expect(input("Target milestones")?.value).toBe("3.5");
  expect(input("Target milestones")?.validity.stepMismatch).toBe(false);
  expect(host.querySelector('form')?.checkValidity()).toBe(true);
  await act(async()=>host.querySelector('form')!.requestSubmit());await flush();
  expect(rpc).toHaveBeenCalledWith("client_portal_save_welcome",expect.objectContaining({p_answers:{goal:"Saved goal",count:3.5}}));
  expect(host.textContent).toContain("Agreement route");
});
it("retains a draft on conflict and does not navigate or blindly replay", async () => {
  await mount(); await change("Your goal","Keep draft"); saveError={code:"40001"}; await submit();
  expect(host.textContent).toContain("changed"); expect(input("Your goal")?.value).toBe("Keep draft");
  await submit(); expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_save_welcome")).toHaveLength(1);
  expect(host.textContent).not.toContain("Agreement route"); expect(acceptSavedProfile).not.toHaveBeenCalled();
});
it("uncertain acknowledgement only offers canonical reconciliation, with no second write", async () => {
  await mount(); await change("Your goal","Unconfirmed draft"); saveError={code:"network"}; await submit();
  expect(host.textContent).toContain("confirm"); await submit();
  expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_save_welcome")).toHaveLength(1);
  expect(input("Your goal")?.value).toBe("Unconfirmed draft"); expect(acceptSavedProfile).not.toHaveBeenCalled();
});
it("signed-out pending save cannot adopt a profile or navigate", async () => {
  let resolve!: (v:{data:unknown;error:unknown})=>void;
  await mount(); pendingSave=new Promise(done=>{resolve=done;}); await change("Your goal","Pending"); await submit();
  act(()=>{actor=null;listener?.("SIGNED_OUT",null);}); await flush();
  resolve({data:initialState(),error:null}); await flush();
  expect(acceptSavedProfile).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("Agreement route"); expect(input("Your goal")).toBeNull();
});
it("a credential-level 401 offers ordinary sign-in recovery without needing an Auth event",async()=>{
  await mount();await change("Your goal","Private local draft");
  getSession.mockResolvedValueOnce({data:{session:null},error:{status:401}});
  act(()=>window.dispatchEvent(new Event("focus")));await flush();
  expect(input("First name")).toBeNull();expect(host.textContent).not.toContain("Private local draft");
  expect(host.querySelector('a[href="/auth"]')?.textContent).toBe("Go to sign in");
  expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_save_welcome")).toHaveLength(0);
});

for(const [label,transform] of [
  ["wrong client",(s:ReturnType<typeof initialState>)=>({...s,profile:{...s.profile,id:"e0931000-0000-0000-0000-000000000099"}})],
  ["wrong business",(s:ReturnType<typeof initialState>)=>({...s,profile:{...s.profile,tenant_id:"e0921000-0000-0000-0000-000000000099"}})],
  ["wrong subject",(s:ReturnType<typeof initialState>)=>({...s,profile:{...s.profile,linked_user_id:actorB}})],
  ["private profile widening",(s:ReturnType<typeof initialState>)=>({...s,profile:{...s.profile,current_notes:"PRIVATE"}})],
  ["unpublished answer",(s:ReturnType<typeof initialState>)=>({...s,answers:{...s.answers,secret:"PRIVATE"}})],
  ["contact question",(s:ReturnType<typeof initialState>)=>({...s,fields:[{key:"email",label:"Email",type:"text",required:true}]})],
] as const)it(`refuses ${label} readback without rendering customer data or writing`,async()=>{
  rpc.mockResolvedValue({data:transform(initialState()),error:null});await mount();
  expect(input("First name")).toBeNull();expect(host.textContent).not.toContain("PRIVATE");
  expect(rpc.mock.calls.some(x=>x[0]==="client_portal_save_welcome")).toBe(false);
});
it("configuration-required does not invent default questions or permit advancement",async()=>{
  rpc.mockResolvedValue({data:{...initialState(),status:"configuration_required",fields:[],answers:{},expected_token:null},error:null});
  await mount();expect(host.textContent).toContain("finish setting up");expect(input("First name")).toBeNull();expect(button("Continue to agreement")).toBeUndefined();
});
it("revoked access clears the form and cannot become an invitation self-heal",async()=>{
  await mount();await change("Your goal","Retire this draft");saveError={code:"42501"};await submit();
  expect(input("First name")).toBeNull();expect(host.textContent).toContain("unavailable for this business");
  expect(rpc.mock.calls.some(x=>String(x[0]).includes("self_heal"))).toBe(false);expect(acceptSavedProfile).not.toHaveBeenCalled();
});
it("blocks synchronous duplicate submission before asynchronous Auth work finishes",async()=>{
  await mount();pendingSave=new Promise(()=>{});
  act(()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
    host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});await flush();
  expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_save_welcome")).toHaveLength(1);expect(button("Saving…")?.disabled).toBe(true);
});
it("required contact and questions are checked before a native write",async()=>{
  await mount();await change("Phone number","");await change("Your goal","");await submit();
  expect(host.textContent).toContain("required answers");expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_save_welcome")).toHaveLength(0);
});
it("does not dispatch with a newly verified different Auth subject",async()=>{
  await mount();actor=actorB;await submit();
  expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_save_welcome")).toHaveLength(0);expect(input("First name")).toBeNull();
});
it("late initial read after sign-out cannot hydrate or focus-resurrect private fields",async()=>{
  let resolve!:(v:unknown)=>void;rpc.mockImplementation(()=>new Promise(done=>{resolve=done;}));await mount();
  act(()=>{actor=null;listener?.("SIGNED_OUT",null);});resolve({data:initialState(),error:null});await flush();
  const calls=rpc.mock.calls.length;act(()=>window.dispatchEvent(new Event("focus")));await flush();
  expect(input("First name")).toBeNull();expect(rpc.mock.calls).toHaveLength(calls);expect(host.textContent).toContain("Sign in again");
});
it("same-subject session renewal retains the draft and blocks a newly stale save",async()=>{
  await mount();await change("Your goal","Keep after renewal");native={...native,expected_token:"c".repeat(32)};
  act(()=>listener?.("TOKEN_REFRESHED",{user:{id:actorA}}));await flush();
  expect(input("Your goal")?.value).toBe("Keep after renewal");expect(host.textContent).toContain("changed");
  await submit();expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_save_welcome")).toHaveLength(0);
});
it("transient Auth recovery hides then restores the same local draft",async()=>{
  await mount();await change("Your goal","Keep during outage");getSession.mockResolvedValueOnce({data:{session:null},error:{status:0}});
  act(()=>window.dispatchEvent(new Event("focus")));await flush();expect(input("Your goal")).toBeNull();
  await act(async()=>button("Try again").click());await flush();expect(input("Your goal")?.value).toBe("Keep during outage");
});
it("a mismatched save readback is unconfirmed and never reaches the agreement",async()=>{
  await mount();rpc.mockImplementation(async(name:string)=>name==="client_portal_save_welcome"
    ?{data:{...initialState(),profile:{...initialProfile(),id:"e0931000-0000-0000-0000-000000000099"}},error:null}
    :{data:initialState(),error:null});await submit();
  expect(host.textContent).toContain("confirm");expect(acceptSavedProfile).not.toHaveBeenCalled();
});
it("canonical reconciliation permits continuing after a lost acknowledgement without another write",async()=>{
  await mount();await change("Your goal","Canonical recovery");saveError={code:"network"};await submit();
  native={...native,profile:{...native.profile,onboarding_stage:"signing_agreement"},answers:{goal:"Canonical recovery"},
    expected_token:"b".repeat(32),intake_submitted_at:"2026-10-15T19:00:00Z" as never};
  await act(async()=>button("Check saved information").click());await flush();expect(host.textContent).toContain("matches this form");
  await submit();expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_save_welcome")).toHaveLength(1);
  expect(host.textContent).toContain("Agreement route");
});
it("discard confirmation cancels without losing a conflicted draft",async()=>{
  await mount();await change("Your goal","Draft must stay");saveError={code:"40001"};await submit();
  vi.spyOn(window,"confirm").mockReturnValue(false);await act(async()=>button("Discard edits and reload").click());await flush();
  expect(input("Your goal")?.value).toBe("Draft must stay");expect(window.confirm).toHaveBeenCalled();
});
it("known form validation refusal retains input and can be corrected",async()=>{
  await mount();saveError={code:"22023"};await change("Your goal","Keep valid text");await submit();
  expect(input("Your goal")?.value).toBe("Keep valid text");expect(host.textContent).toContain("Check your contact");
  saveError=null;await submit();expect(host.textContent).toContain("Agreement route");
});
it("a refused parent projection never advances even after the native save",async()=>{
  acceptSavedProfile.mockReturnValue(false);await mount();await submit();
  expect(acceptSavedProfile).toHaveBeenCalled();expect(host.textContent).not.toContain("Agreement route");expect(input("First name")).toBeNull();
  await act(async()=>button("Reload onboarding").click());expect(refresh).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls.filter(x=>x[0]==="client_portal_save_welcome")).toHaveLength(1);
});
