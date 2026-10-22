import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientReleasedWork } from "./ClientReleasedWork";
import {ClientPortalFrameProvider} from "@/hooks/useClientPortalFrame";
import {CustomerIdentityProvider,type CustomerIdentityState} from "@/lib/portal/customerIdentity";

const actor = "e0914000-0000-4000-8000-000000000001", tenant = "e0924000-0000-4000-8000-000000000001", contact = "e0934000-0000-4000-8000-000000000001";
const releaseId = "e0954000-0000-4000-8000-000000000001", submissionId = "e0964000-0000-4000-8000-000000000001";
const f = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), actualActor: "", state: "awaiting_client" as string, decision: null as null | { state: string; note: string | null } }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", forcedTheme: undefined }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: {
    getUser: async () => ({ data: { user: { id: f.actualActor } }, error: null }),
    getSession: async () => ({ data: { session: { user: { id: actor }, access_token: "synthetic-portal-review" } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
  },
  rpc: (...a: unknown[]) => {const q=Promise.resolve(f.rpc(...a));return Object.assign(q,{setHeader:()=>q,abortSignal:()=>q});}, from: (...a: unknown[]) => f.from(...a),
} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const profile = { id: contact, tenant_id: tenant, linked_user_id: actor, first_name: "Jordan", last_name: "Rivera", entity_name: null, street_address: null, city: null, state: null, zip_code: null, onboarding_stage: null, is_signup_contact: false, paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: "2026-01-01T00:00:00Z", email: "jordan@example.test", phone: null, contact_methods: [] };
const artifact = () => ({ actor_id: actor, tenant_id: tenant, release_id: releaseId, submission_id: submissionId, state: f.decision?.state ?? "awaiting_client", revision_no: 1, artifact_digest: "b".repeat(64),
  title: "Brand launch plan", body: "Week one: the new homepage. Week two: the announcement.", updated_at: f.decision ? "2026-01-03T00:00:00Z" : "2026-01-02T00:00:00Z",
  decision_by: f.decision ? actor : null, decision_at: f.decision ? "2026-01-03T00:00:00Z" : null, client_note: f.decision?.note ?? null });
let releases: unknown[] = [];
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); f.decision = null; f.actualActor = actor;
  releases = [{ release_id: releaseId, submission_id: submissionId, state: "awaiting_client", revision_no: 1, artifact_digest: "b".repeat(64), title: "Brand launch plan", updated_at: "2026-01-02T00:00:00Z" }];
  f.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "client_portal_self_profile") return { data: profile, error: null };
    if (name === "operations_delivery_client_reviews_scoped") return { data: { actor_id: actor, tenant_id: tenant, releases, unavailable_count: 0, has_more: false }, error: null };
    if (name === "operations_delivery_client_read_scoped") return { data: artifact(), error: null };
    if (name === "operations_delivery_client_decide_scoped") {
      f.decision = { state: String(args.p_decision), note: (args.p_note as string | null) ?? null };
      releases = [{ ...(releases[0] as object), state: f.decision.state, updated_at: "2026-01-03T00:00:00Z" }];
      return { data: artifact(), error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const flush = async () => act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); });
const render = async () => { await act(async () => root.render(<ClientReleasedWork businessName="Northwind Studio" />)); await flush(); };
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.trim() === label)!;
const type = async (value: string) => {
  const note = document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, value); note.dispatchEvent(new Event("input", { bubbles: true })); });
};

it("renders nothing when no work has been released", async () => {
  releases = []; await render();
  expect(host.innerHTML).toBe("");
});
it("renders nothing for a business that cannot release work", async () => {
  f.rpc.mockImplementation(async (name: string) => name === "client_portal_self_profile" ? { data: profile, error: null }
    : { data: null, error: { code: "42501", message: "DELIVERY_CLIENT_REVIEWS_UNAVAILABLE" } });
  await render();
  expect(host.innerHTML).toBe("");
});
it("says when the list could not be checked, rather than hiding it", async () => {
  f.rpc.mockImplementation(async (name: string) => name === "client_portal_self_profile" ? { data: profile, error: null }
    : { data: null, error: { code: "PGRST000", message: "network" } });
  await render();
  expect(host.textContent).toContain("couldn’t be checked");
});
it("lists released work in the customer's words and never reads the clients table", async () => {
  await render();
  expect(host.textContent).toContain("Work for your review");
  expect(host.textContent).toContain("Brand launch plan");
  expect(host.textContent).toContain("Waiting for you");
  expect(f.from).not.toHaveBeenCalled();
});
it("accepts through the decide RPC, in a dialog with no Solo theme class of its own", async () => {
  await render();
  await act(async () => button("Review").click()); await flush();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.classList.contains("paige-solo")).toBe(false);
  expect(dialog.textContent).toContain("Week one: the new homepage.");
  await act(async () => button("Accept this version").click());
  await act(async () => button("Confirm acceptance").click()); await flush();
  expect(f.rpc).toHaveBeenCalledWith("operations_delivery_client_decide_scoped", expect.objectContaining({ p_release_id: releaseId, p_decision: "accepted", p_expected_actor_id: actor, p_expected_tenant_id: tenant }));
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Your acceptance is recorded for version 1.");
  await flush();
  expect(host.textContent).toContain("Accepted");
});
it("requests changes with a note through the decide RPC", async () => {
  await render();
  await act(async () => button("Review").click()); await flush();
  await type("Please move the launch a week later.");
  await act(async () => button("Request changes").click());
  await act(async () => button("Confirm changes").click()); await flush();
  expect(f.rpc).toHaveBeenCalledWith("operations_delivery_client_decide_scoped", expect.objectContaining({ p_decision: "client_revision_requested", p_note: "Please move the launch a week later." }));
  await flush();
  expect(host.textContent).toContain("You asked for changes");
});
it("keeps the review open while an unsaved note would be lost", async () => {
  await render();
  await act(async () => button("Review").click()); await flush();
  await type("Half a thought");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => document.querySelector<HTMLElement>('[role="dialog"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Finish or clear your review note before closing.");
});

const scopedRender=async(phase:CustomerIdentityState["phase"]="ready",business=tenant)=>{
 const scopedProfile={...profile,tenant_id:business,id:business===tenant?contact:"e0934000-0000-4000-8000-000000000002"};
 await act(async()=>root.render(<CustomerIdentityProvider state={{phase,frame:{actorId:actor,profile:scopedProfile,brand:{tenant_name:"Northwind Practice"},config:{}} as never}}><ClientReleasedWork businessName="Northwind Practice"/></CustomerIdentityProvider>));await flush();
};
it("a transient same-business access check masks the review but retains its private draft",async()=>{
 await scopedRender();await act(async()=>button("Review").click());await flush();await type("My private version-specific draft");
 const reads=f.rpc.mock.calls.length;
 await scopedRender("error");
 const checking=document.querySelector('[role="dialog"]')!;
 expect(checking).not.toBeNull();expect(checking.textContent).not.toContain("Brand launch plan");expect(checking.textContent).not.toContain("Week one:");expect(checking.textContent).not.toContain("My private version-specific draft");
 expect(checking.textContent).toContain("Your review note is kept");expect(f.rpc.mock.calls).toHaveLength(reads);
 await scopedRender();expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!.value).toBe("My private version-specific draft");
 expect(f.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(0);
 await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
it("a same-business recheck preserves an uncertain original decision and requires recorded-state recovery",async()=>{
 await scopedRender();await act(async()=>button("Review").click());await flush();
 await act(async()=>button("Accept this version").click());f.rpc.mockResolvedValueOnce({data:null,error:{code:"08006"}});
 await act(async()=>button("Confirm acceptance").click());expect(button("Accept this version").disabled).toBe(true);
 await scopedRender("error");expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Week one:");
 await scopedRender();expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Your decision could not be confirmed");expect(button("Accept this version").disabled).toBe(true);
 f.decision={state:"accepted",note:null};await act(async()=>button("Check recorded review").click());await flush();
 expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Your acceptance is recorded for version 1.");
 expect(f.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(1);
});
it("switching business closes the earlier review and never publishes its pending result into the new business",async()=>{
 await scopedRender();await act(async()=>button("Review").click());await flush();
 let resolve!:(value:unknown)=>void;const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==="operations_delivery_client_decide_scoped")return new Promise(r=>{resolve=r;});
  if(args.p_tenant_id==="e0924000-0000-4000-8000-000000000002")return {data:{...profile,id:"e0934000-0000-4000-8000-000000000002",tenant_id:args.p_tenant_id},error:null};
  if(args.p_expected_tenant_id==="e0924000-0000-4000-8000-000000000002")return {data:{actor_id:actor,tenant_id:args.p_expected_tenant_id,releases:[],unavailable_count:0,has_more:false},error:null};
  return original(name,args);
 });
 await act(async()=>button("Accept this version").click());await act(async()=>button("Confirm acceptance").click());
 await scopedRender("ready","e0924000-0000-4000-8000-000000000002");expect(document.querySelector('[role="dialog"]')).toBeNull();expect(host.textContent).not.toContain("Brand launch plan");
 await act(async()=>resolve({data:{...artifact(),state:"accepted"},error:null}));await flush();
 expect(host.textContent).not.toContain("Brand launch plan");expect(host.textContent).not.toContain("Your acceptance is recorded");expect(f.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(1);
});

it("the real shared gate masks a portalled draft and retries through that same original reader",async()=>{
 const currentFrame={actorId:actor,profile,brand:{tenant_name:"Northwind Practice"},config:{}} as never;
 const retry:ReturnType<typeof vi.fn>=vi.fn(()=>root.render(tree(false)));
 const tree=(checking:boolean)=><ClientPortalFrameProvider value={{actorId:actor,value:{frame:currentFrame,phase:"ready",checking,reload:retry}} as never}><CustomerIdentityProvider state={{frame:currentFrame,phase:"ready"}}><ClientReleasedWork businessName="Northwind Practice"/></CustomerIdentityProvider></ClientPortalFrameProvider>;
 await act(async()=>root.render(tree(false)));await flush();await act(async()=>button("Review").click());await flush();await type("Preserved original review draft");
 await act(async()=>root.render(tree(true)));await flush();
 const modal=document.querySelector('[role="dialog"]')!;
 expect(modal.textContent).toContain("Checking review access");expect(modal.textContent).not.toContain("Brand launch plan");expect(modal.textContent).not.toContain("Week one:");expect(modal.textContent).not.toContain("Preserved original review draft");
 expect(button("Check portal access")).toBeDefined();await act(async()=>button("Check portal access").click());await flush();
 expect(retry).toHaveBeenCalledOnce();expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!.value).toBe("Preserved original review draft");expect(document.activeElement).toBe(document.querySelector('[role="dialog"] textarea'));
 expect(f.rpc.mock.calls.some(c=>c[0]==="client_portal_frame")).toBe(false);
 expect(f.rpc.mock.calls.some(c=>c[0]==="operations_delivery_client_decide_scoped")).toBe(false);
});

it("clean close after an uncertain decision recovery refreshes only the original list's recorded status",async()=>{
 await scopedRender();await act(async()=>button("Review").click());await flush();await act(async()=>button("Accept this version").click());
 f.rpc.mockResolvedValueOnce({data:null,error:{code:"08006"}});await act(async()=>button("Confirm acceptance").click());
 f.decision={state:"accepted",note:null};releases=[{...(releases[0] as object),state:"accepted",updated_at:"2026-01-03T00:00:00Z"}];
 await act(async()=>button("Check recorded review").click());await flush();
 await act(async()=>document.querySelector<HTMLButtonElement>('[role="dialog"] button>span.sr-only')?.parentElement?.click());await flush();
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(host.textContent).toContain("Accepted");expect(host.textContent).not.toContain("Waiting for you");
 expect(f.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(1);
});

it("the Portal dialog exposes no stale release title when actual Auth is refused before dispatch",async()=>{
 await scopedRender();await act(async()=>button("Review").click());await flush();await act(async()=>button("Accept this version").click());
 f.actualActor="other-actual-user";await act(async()=>button("Confirm acceptance").click());await flush();
 const dialog=document.querySelector('[role="dialog"]')!;
 expect(dialog.textContent).toContain("Your decision wasn't sent");expect(dialog.textContent).not.toContain("Brand launch plan");expect(dialog.textContent).not.toContain("Week one:");
 expect(f.rpc.mock.calls.filter(c=>c[0]==="operations_delivery_client_decide_scoped")).toHaveLength(0);
});
