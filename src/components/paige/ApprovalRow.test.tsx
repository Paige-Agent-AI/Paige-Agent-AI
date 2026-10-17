import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ApprovalQueueRow } from "@/hooks/usePendingApprovals";
const m = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), getUser: vi.fn(), query: vi.fn(), error: vi.fn(), auth: null as null | (() => void),
  context: { activeUserId: "owner", activeTenantId: "tenant", loading: false, accountContextLoading: false, accountContextStatus: "ready" }, impersonating: false }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => m.context }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => ({ isImpersonating: m.impersonating }) }));
vi.mock("sonner", () => ({ toast: { error: m.error } }));
vi.mock("@/components/ui/page", () => ({ PaigeAttribution: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: m.invoke }, rpc: m.rpc,
  auth: { getUser: m.getUser, onAuthStateChange: (cb: () => void) => { m.auth = cb; return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  from: (...args: unknown[]) => m.query(...args) } }));
import { ApprovalRow } from "./ApprovalRow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, resolved: Mock<() => void>, row: ApprovalQueueRow;
const controls: { name: string; value: unknown }[] = [];
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const fixture = () => ({ id: "approval", tenant_id: "tenant", status: "pending", source: "paige_orchestration", category: "owner.task",
  summary: "Review new contact", sla_state: "unscheduled", draft_content: { capability: "owner.task", subject: "Review new contact",
    args: { title: "Review the complete held task " + "carefully ".repeat(30), description: "Read all customer notes.\nPreserve approval requirements." },
    body: "Paige needs approval for the held task." }, metadata: { secret_fixture: "do-not-render-this" } } as unknown as ApprovalQueueRow);
beforeEach(() => {
  row = fixture(); controls.length = 0; resolved = vi.fn<() => void>(); m.context = { activeUserId: "owner", activeTenantId: "tenant", loading: false, accountContextLoading: false, accountContextStatus: "ready" }; m.impersonating = false;
  m.invoke.mockReset(); m.rpc.mockReset(); m.getUser.mockReset(); m.query.mockReset(); m.error.mockReset();
  m.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null }); m.rpc.mockResolvedValue({ data: "tenant", error: null });
  m.invoke.mockResolvedValue({ data: { ok: true, executed: true, approval_id: "approval", act_outcome: "executed" }, error: null });
  const q = { update: (v: unknown) => { controls.push({ name: "update", value: v }); return q; }, eq: (k: string, v: unknown) => { controls.push({ name: k, value: v }); return q; },
    select: () => q, maybeSingle: async () => ({ data: { id: "approval", tenant_id: "tenant", status: "rejected", decision_rationale: "Needs correction" }, error: null }),
    then: (yes: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(yes) };
  m.query.mockReturnValue(q); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const view = () => act(() => root.render(<MemoryRouter><ApprovalRow a={row} showDecline onResolved={resolved} /></MemoryRouter>));
const button = (name: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); };
const text = () => host.textContent ?? "";

describe("shared approval row reports canonical outcomes", () => {
  it.each([null, {}, { ok: true }, { ok: true, executed: true }, { ok: true, executed: true, approval_id: "foreign" },
    { ok: true, executed: true, approval_id: "approval" },
    { ok: true, executed: true, approval_id: "approval", act_outcome: "executed", scheduled: "yes" },
    { ok: true, executed: true, approval_id: "approval", act_outcome: "ambiguous" }])("keeps malformed or foreign acknowledgement %j unknown without collapse", async data => {
    m.invoke.mockResolvedValue({ data, error: null }); view(); await click("Approve");
    expect(resolved).not.toHaveBeenCalled(); expect(text()).toMatch(/could not be confirmed/i); expect(host.querySelector(".cc-collapsing")).toBeNull();
    expect(button("Approve").disabled).toBe(true); await click("Refresh status"); expect(resolved).toHaveBeenCalledTimes(1); expect(m.invoke).toHaveBeenCalledTimes(1);
  });
  it("executes only the approval ID and reports confirmed execution visibly", async () => {
    view(); await click("Approve"); expect(m.invoke).toHaveBeenCalledExactlyOnceWith("execute-approval", { body: { approval_id: "approval" } });
    expect(text()).toMatch(/reviewed action completed/i); expect(resolved).not.toHaveBeenCalled(); expect(host.querySelector(".cc-collapsing")).toBeNull();
  });
  it("preserves a legitimate non-native sender's explicit executed acknowledgement", async () => {
    row = { ...row, source: "conversation", category: "email", draft_content: { subject: "Approved draft", body: "The reviewed email body." } };
    m.invoke.mockResolvedValue({ data: { ok: true, executed: true, channel: "email", approval_id: "approval" }, error: null });
    view(); await click("Approve"); expect(text()).toMatch(/reviewed action completed/i);
  });
  it("supports the ordinary StrictMode lifecycle without disabling its current intent", async () => {
    act(() => root.render(<StrictMode><ApprovalRow a={row} onResolved={resolved}/></StrictMode>));
    await click("Approve"); expect(m.invoke).toHaveBeenCalledTimes(1); expect(text()).toMatch(/reviewed action completed/i);
  });
  it.each([
    [{ scheduled: true }, /scheduled.*nothing has been sent/is], [{ queued: true }, /queued.*not.*confirmed/is],
    [{ acknowledged: true }, /no automated action.*executed/i], [{ already: "approved" }, /already.*handled/i],
    [{ already: "sent" }, /already.*handled/i], [{ already: "in_progress" }, /in progress/i],
  ])("distinguishes a non-executed authoritative reply %j", async (extra, words) => {
    m.invoke.mockResolvedValue({ data: { ok: true, executed: false, approval_id: "approval", ...extra }, error: null }); view(); await click("Approve");
    expect(text()).toMatch(words); expect(text()).not.toContain("reviewed action completed"); expect(resolved).not.toHaveBeenCalled(); expect(button("Approve").disabled).toBe(true);
  });
  it.each(["ambiguous", "accepted_for_execution", "unknown", "approval_pending", "failed"])("keeps native %s truthful and non-replayed", async act_outcome => {
    m.invoke.mockResolvedValue({ data: { ok: false, executed: false, approval_id: "approval", act_outcome }, error: null }); view(); await click("Approve");
    expect(resolved).not.toHaveBeenCalled(); expect(text()).not.toContain("reviewed action completed"); expect(button("Approve").disabled).toBe(true);
  });
  it("does not expose raw server errors or private metadata in the row", async () => {
    m.invoke.mockResolvedValue({ data: { ok: false, error: "secret-server-detail" }, error: { message: "secret-server-detail" } }); view(); await click("Approve");
    expect(text()).not.toContain("secret-server-detail"); expect(text()).not.toContain("do-not-render-this"); expect(resolved).not.toHaveBeenCalled();
  });
  it("handles a thrown transport error without success or an automatic replay", async () => {
    m.invoke.mockRejectedValue(new Error("lost acknowledgement")); view(); await click("Approve"); expect(text()).toMatch(/could not be confirmed/i); expect(m.invoke).toHaveBeenCalledTimes(1);
  });
  it("uses a synchronous one-flight fence before rendering disabled controls", async () => {
    const pending = deferred<{ data: unknown; error: null }>(); m.invoke.mockReturnValue(pending.promise); view();
    await act(async () => { button("Approve").click(); button("Approve").click(); }); expect(m.invoke).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ data: null, error: null })); expect(resolved).not.toHaveBeenCalled();
  });
  it("a newly read canonical row permits a new deliberate decision without automatic replay", async () => {
    m.invoke.mockResolvedValue({ data: null, error: null }); view(); await click("Approve"); await click("Refresh status");
    row = { ...row }; view(); expect(button("Approve").disabled).toBe(false); expect(m.invoke).toHaveBeenCalledTimes(1);
    await click("Approve"); expect(m.invoke).toHaveBeenCalledTimes(2);
  });
});

describe("current actor and workspace own the local intent", () => {
  it.each(["workspace", "actor", "impersonation", "unresolved"])("refuses %s before any approval request", async change => {
    if (change === "workspace") m.context.activeTenantId = "foreign";
    if (change === "actor") m.getUser.mockResolvedValue({ data: { user: { id: "foreign" } }, error: null });
    if (change === "impersonation") m.impersonating = true;
    if (change === "unresolved") m.context.accountContextStatus = "resolving";
    view(); if (button("Approve") && !button("Approve").disabled) await click("Approve"); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("checks the actual current server workspace before an effect", async () => {
    m.rpc.mockResolvedValue({ data: "foreign", error: null }); view(); await click("Approve"); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("a late old-workspace acknowledgement cannot settle the new row", async () => {
    const pending = deferred<{ data: unknown; error: null }>(); m.invoke.mockReturnValue(pending.promise); view(); await click("Approve");
    m.context.activeTenantId = "foreign"; view(); await act(async () => pending.resolve({ data: { ok: true, executed: true, approval_id: "approval" }, error: null }));
    expect(resolved).not.toHaveBeenCalled(); expect(text()).not.toContain("reviewed action completed");
  });
  it("late authentication after leaving and returning never starts the old mutation", async () => {
    const pending = deferred<unknown>(); m.getUser.mockReturnValueOnce(pending.promise); view(); await click("Approve");
    m.context.activeTenantId = "foreign"; view(); m.context.activeTenantId = "tenant"; view();
    await act(async () => pending.resolve({ data: { user: { id: "owner" } }, error: null })); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("unmount suppresses a late acknowledgement", async () => {
    const pending = deferred<{ data: unknown; error: null }>(); m.invoke.mockReturnValue(pending.promise); view(); await click("Approve");
    act(() => root.render(null)); await act(async () => pending.resolve({ data: { ok: true, executed: true, approval_id: "approval" }, error: null })); expect(resolved).not.toHaveBeenCalled();
  });
  it("auth change invalidates a stalled preflight before effect", async () => {
    const pending = deferred<unknown>(); m.getUser.mockReturnValueOnce(pending.promise); view(); await click("Approve");
    await act(async () => m.auth!()); await act(async () => pending.resolve({ data: { user: { id: "owner" } }, error: null })); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("auth changes cannot clear an unknown report into a replayable stale row", async () => {
    m.invoke.mockResolvedValue({ data: null, error: null }); view(); await click("Approve");
    await act(async () => m.auth!()); expect(button("Approve")).toBeUndefined(); expect(text()).toMatch(/may already have gone through/i);
    await click("Refresh status"); expect(resolved).toHaveBeenCalledTimes(1); expect(m.invoke).toHaveBeenCalledTimes(1);
    row = { ...row }; view(); expect(button("Approve").disabled).toBe(false);
  });
  it("bounds stalled authentication; a late response cannot dispatch after expiry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = deferred<unknown>(); m.getUser.mockReturnValueOnce(pending.promise); view(); await click("Approve");
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); }); expect(text()).toMatch(/could not be started/i);
    await act(async () => pending.resolve({ data: { user: { id: "owner" } }, error: null }));
    expect(m.invoke).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("an already-dispatched timeout remains unknown and ignores the late executed acknowledgement", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = deferred<{ data: unknown; error: null }>(); m.invoke.mockReturnValue(pending.promise); view(); await click("Approve");
    expect(m.invoke).toHaveBeenCalledTimes(1); await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(text()).toMatch(/could not be confirmed/i);
    await act(async () => pending.resolve({ data: { ok: true, executed: true, approval_id: "approval", act_outcome: "executed" }, error: null }));
    expect(text()).not.toContain("reviewed action completed"); expect(resolved).not.toHaveBeenCalled(); expect(m.invoke).toHaveBeenCalledTimes(1);
  });
});

describe("full exact task and honest inline inspection", () => {
  it("shows every held task title/description byte without a line clamp or raw metadata", () => {
    view(); const args = row.draft_content.args; expect(text()).toContain(args.title); expect(text()).toContain(args.description);
    expect(host.querySelector(".line-clamp-2")).toBeNull(); expect(host.querySelector('a[href="/choose-account"]')).toBeNull(); expect(button("Edit")).toBeUndefined();
  });
  it("View and Close/Escape inspect in place without mutation and restore focus", async () => {
    view(); await click("View"); expect(button("Close details")).toBeTruthy(); expect(document.activeElement).toBe(button("Close details"));
    await act(async () => button("Close details").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(button("Close details")).toBeUndefined(); expect(document.activeElement).toBe(button("View")); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("decline Cancel leaves records untouched and restores its source focus", async () => {
    view(); await click("Decline"); expect(host.querySelector('label')).toBeTruthy(); await click("Cancel"); expect(m.query).not.toHaveBeenCalled(); expect(document.activeElement).toBe(button("Decline"));
  });
  it("requires exact returned decline identity/status/reason rather than a bare empty update", async () => {
    view(); await click("Decline"); const field = host.querySelector("textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Needs correction"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Decline action"); expect(controls).toContainEqual({ name: "tenant_id", value: "tenant" }); expect(controls).toContainEqual({ name: "status", value: "pending" });
    expect(text()).toMatch(/decline confirmed/i); expect(resolved).not.toHaveBeenCalled();
  });
  it.each([null, { id: "foreign", tenant_id: "tenant", status: "rejected", decision_rationale: "Needs correction" },
    { id: "approval", tenant_id: "foreign", status: "rejected", decision_rationale: "Needs correction" },
    { id: "approval", tenant_id: "tenant", status: "pending", decision_rationale: "Needs correction" },
    { id: "approval", tenant_id: "tenant", status: "rejected", decision_rationale: "Different reason" }])("does not confirm decline from %j", async data => {
    const q = { update: () => q, eq: () => q, select: () => q, maybeSingle: async () => ({ data, error: null }) }; m.query.mockReturnValue(q);
    view(); await click("Decline"); const field = host.querySelector("textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Needs correction"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Decline action"); expect(text()).toMatch(/could not be confirmed/i); expect(resolved).not.toHaveBeenCalled(); expect(button("Approve").disabled).toBe(true);
  });
});

describe("canonical native task rejection uses the existing exact-version domain seam",()=>{
  const approval="00000000-0000-4000-8000-000000000210",tenant="00000000-0000-4000-8000-000000000211",actor="00000000-0000-4000-8000-000000000212";
  const version="2026-10-17T18:30:41.123456+00:00";
  const setup=(response?:Record<string,unknown>)=>{
    row={...fixture(),id:approval,type:"other",tenant_id:tenant,updated_at:version,metadata:{source:"paige_orchestration",capability_id:"owner.task",
      event_id:"00000000-0000-4000-8000-000000000213",act_id:"00000000-0000-4000-8000-000000000214",
      act_execution_id:"00000000-0000-4000-8000-000000000215",automation_id:"00000000-0000-4000-8000-000000000216"}};
    m.context.activeTenantId=tenant;m.context.activeUserId=actor;m.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});
    m.rpc.mockImplementation(async name=>({error:null,data:name==="current_user_tenant_id"?tenant:response??{
      id:approval,tenant_id:tenant,status:"rejected",decision_rationale:"Needs correction",reviewed_by_user_id:actor,
      act_outcome:"cancelled",receipt_recorded:true,receipt_id:"00000000-0000-4000-8000-000000000217",reviewed_at:version,updated_at:version,replayed:false}}));
  };
  const decline=async()=>{await click("Decline");const field=host.querySelector("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"  Needs correction  ");field.dispatchEvent(new Event("input",{bubbles:true}));});
    await click("Decline action");};
  it("sends only exact approval/version/reason; never direct UPDATE, caller identity, task args or approve",async()=>{
    setup();view();await decline();expect(m.rpc).toHaveBeenCalledWith("decline_owner_task_approval",{_approval_id:approval,_expected_updated_at:version,_reason:"Needs correction"});
    expect(m.query).not.toHaveBeenCalled();expect(m.invoke).not.toHaveBeenCalled();expect(text()).toContain("Decline confirmed");expect(text()).not.toContain("action completed");
    expect(button("Approve").disabled).toBe(true);expect(resolved).not.toHaveBeenCalled();await click("Refresh status");expect(resolved).toHaveBeenCalledTimes(1);
    expect(m.rpc.mock.calls.filter(([name])=>name==="decline_owner_task_approval")).toHaveLength(1);
  });
  it("requires the real version and never fabricates a browser timestamp",async()=>{
    setup();row={...row,updated_at:undefined as unknown as string};view();await decline();expect(text()).toMatch(/could not be started/i);
    expect(m.rpc.mock.calls.some(([name])=>name==="decline_owner_task_approval")).toBe(false);expect(m.query).not.toHaveBeenCalled();
  });
  it.each([{}, {id:approval,tenant_id:tenant,status:"rejected",decision_rationale:"Needs correction"},
    {id:approval,tenant_id:tenant,status:"rejected",decision_rationale:"Needs correction",receipt_recorded:false,act_outcome:"cancelled"}])("does not confirm incomplete or unreceipted native decision %j",async result=>{
    setup(result);view();await decline();expect(text()).toMatch(/could not be confirmed/i);expect(m.query).not.toHaveBeenCalled();
  });
  it("truthfully reports original already-declined result when another reviewer/reason exists",async()=>{
    setup({id:approval,tenant_id:tenant,status:"rejected",decision_rationale:"Original reason",reviewed_by_user_id:"00000000-0000-4000-8000-000000000218",
      act_outcome:"cancelled",receipt_recorded:true,receipt_id:"00000000-0000-4000-8000-000000000219",reviewed_at:version,updated_at:version,replayed:true});view();await decline();
    expect(text()).toContain("Decline confirmed");expect(text()).not.toContain("Needs correction");expect(m.query).not.toHaveBeenCalled();
  });
  it("records bounded rationale without claiming an unverified learning outcome",async()=>{
    setup();view();await click("Decline");expect(host.querySelector("textarea")?.maxLength).toBe(2000);
    expect(host.querySelector("textarea")?.placeholder).toContain("reason will be recorded");expect(host.querySelector("textarea")?.placeholder).not.toContain("learn");
  });
});
