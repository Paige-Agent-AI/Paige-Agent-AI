import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CrmWorkRecord } from "./operations-native-work";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { setScopedUserId } from "@/lib/scopedUser";

const harness = vi.hoisted(() => ({ tenant: "test-tenant-a", user: "test-user", status: "ready", foreign: false,
  crmTasks:[] as CrmWorkRecord[], crmError:null as string|null, planningError:null as string|null, members:[] as TeamMemberRecord[], guard:null as string|null, planningOptions: [] as unknown[], planningOverrides:{} as Record<string,unknown> }));
const weekly = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn(), taskRead: vi.fn() }));
vi.mock("./operations-weekly-source", async importOriginal => ({ ...await importOriginal<typeof import("./operations-weekly-source")>(), readWeeklyPlanningSource: weekly.read }));
const paige = vi.hoisted(() => ({ handoff: vi.fn(), clearClient: vi.fn(), clearPublic: vi.fn() }));
vi.mock("@/lib/paigePromptHandoff", () => ({ handOffPaigePrompt: paige.handoff }));
vi.mock("@/solo/paigeClientScope", () => ({ clearPaigeClientScope: paige.clearClient }));
vi.mock("@/solo/paigePublicPresenceScope", () => ({ clearPaigePublicPresenceScope: paige.clearPublic }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: harness.tenant,
  activeUserId: harness.user, loading: false, accountContextStatus: harness.status }) }));
vi.mock("./useOperationsPeople", () => ({ useOperationsPeople: () => ({ members: harness.members, loading: false,
  error: null, partial: false, refresh: vi.fn() }) }));
vi.mock("@/hooks/usePlanList", () => ({ usePlanList: (options: unknown) => { harness.planningOptions.push(options); return ({ plans: [], loading: false, error: harness.planningError,
  forbidden: false, refresh: weekly.refresh, allItems: [{ id: "test-item", tenant_id: harness.foreign ? "test-foreign" : harness.tenant,
    plan_id: null, title: `${harness.tenant} assigned work`, summary: "Test source", status: "open", priority: "normal",
    item_type: "task", assigned_to_user_id: null, due_at: null,...harness.planningOverrides }] }); } }));
vi.mock("./OperationsDelivery", () => ({ default: () => <div>Delivery test seam</div> }));
const release = vi.hoisted(() => ({ standalone: false }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => true, tierKey: "solo", soloStandalone: release.standalone, loading: false }) }));
vi.mock("./OperationsItemRelease", () => ({
  OperationsItemRelease: ({ item }: { item: { id: string } }) => <div data-testid="release-flow">Release flow for {item.id}</div> }));
vi.mock("./OperationsPlaybooks", () => ({ OperationsPlaybooks: () => <div>Playbook test seam</div> }));
vi.mock("./OperationsWorkEditor", () => ({ OperationsWorkEditor: ({ refresh, onNavigationGuardChange }: {
  refresh: () => Promise<void>; onNavigationGuardChange?: (guard: (() => string | null) | null) => void;
}) => {
  React.useLayoutEffect(() => { onNavigationGuardChange?.(() => harness.guard); return () => onNavigationGuardChange?.(null); }, [onNavigationGuardChange]);
  return <div>Work edit test seam<button onClick={() => void refresh()}>Refresh linked editor</button></div>;
} }));
vi.mock("./OperationsCrmWorkEditor",()=>({OperationsCrmWorkEditor:()=> <div>Native assignment/date edit test seam</div>}));
vi.mock("./OperationsProjectCreator", () => ({ OperationsProjectCreator: ({ onRecover }: { onRecover: (id?: string) => Promise<void> }) => <div data-testid="project-creator"><button onClick={() => void onRecover()}>Refresh unknown project</button><button onClick={() => void onRecover("test-project")}>Inspect acknowledged project</button></div> }));
vi.mock("./useOperationsCrmWork",()=>({useOperationsCrmWork:()=>({tasks:harness.crmTasks,loading:false,error:harness.crmError,forbidden:false,hasMore:false,refresh:vi.fn(),readTask:weekly.taskRead})}));
vi.mock("./OperationsCrmStageReview",()=>({OperationsCrmStageReview:({operation}:{operation:{taskId:string}})=><div>Recovery test seam: {operation.taskId}</div>}));
import { OperationsWorkspace } from "./OperationsWorkspace";
let container: HTMLDivElement;
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { setScopedUserId(null); harness.tenant = "test-tenant-a"; harness.user = "test-user"; harness.status = "ready";
  vi.clearAllMocks();
  harness.planningOptions=[];
  harness.planningOverrides={};release.standalone=false;
  sessionStorage.clear();harness.crmTasks=[];harness.crmError=null;harness.planningError=null;harness.members=[];harness.guard=null;
  weekly.read.mockResolvedValue({kind:"unavailable"});weekly.refresh.mockResolvedValue(undefined);
  harness.foreign = false; container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); setScopedUserId(null); container.remove(); });
it.each([["2099-01-02T13:15:00+03:00",new Date("2099-01-02T13:15:00+03:00").toLocaleString()],
  [null,"Not scheduled"],["invalid-date","Date unavailable"],[undefined,"Date unavailable"]])("inspects the reminder time truthfully without reading due_at (%s)",async(remindAt,expected)=>{
  harness.planningOverrides={item_type:"reminder",remind_at:remindAt,due_at:"2099-08-20T12:00:00Z"};
  await act(async()=>root.render(<OperationsWorkspace view="work" />));
  await act(async()=>container.querySelector<HTMLButtonElement>(".ops-work-card")!.click());
  const labels=Array.from(document.querySelectorAll(".ops-detail-content dt"));
  const date=labels.find(label=>label.textContent==="Reminder time");
  expect(date).toBeTruthy();expect(date?.nextElementSibling?.textContent).toBe(expected);
});
it.each(["task","milestone"])("retains the %s inspector's native due date",async(itemType)=>{
  const dueAt="2099-08-20T12:00:00Z";
  harness.planningOverrides={item_type:itemType,remind_at:"2099-01-02T13:15:00+03:00",due_at:dueAt};
  await act(async()=>root.render(<OperationsWorkspace view="work" />));
  await act(async()=>container.querySelector<HTMLButtonElement>(".ops-work-card")!.click());
  const date=Array.from(document.querySelectorAll(".ops-detail-content dt")).find(label=>label.textContent==="Due date");
  expect(date?.nextElementSibling?.textContent).toBe(new Date(dueAt).toLocaleString());
  expect(document.querySelector(".ops-detail-content")?.textContent).not.toContain("Reminder time");
});
it("opts into native cancellation history only for Work", async () => {
  await act(async () => root.render(<OperationsWorkspace />));
  expect(harness.planningOptions.at(-1)).toMatchObject({ includeCancelled: false });
  const work = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Work")!;
  await act(async () => work.click());
  expect(harness.planningOptions.at(-1)).toMatchObject({ includeCancelled: true });
  const projects = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Projects")!;
  await act(async () => projects.click());
  expect(harness.planningOptions.at(-1)).toMatchObject({ includeCancelled: false });
});
it("effective client view immediately removes business work and its open inspection", async () => {
  await act(async () => root.render(<OperationsWorkspace view="work" />));
  const task = container.querySelector<HTMLButtonElement>(".ops-work-card");
  await act(async () => task?.click());
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  await act(async () => setScopedUserId("client"));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain("test-tenant-a assigned work");
  expect(container.textContent).toContain("Business work is unavailable in this view");
});
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent === text);
  expect(button).toBeTruthy(); await act(async () => button?.click());
}
it("removes old workspace work and the open detail drawer on switching", async () => {
  await act(async () => root.render(<OperationsWorkspace />));
  await click("Work");
  const task = container.querySelector<HTMLButtonElement>(".ops-work-card");
  await act(async () => task?.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("test-tenant-a assigned work");
  harness.tenant = "test-tenant-b";
  await act(async () => root.render(<OperationsWorkspace />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain("test-tenant-a assigned work");
});
it("refuses an inconsistent source bundle instead of rendering foreign work", async () => {
  harness.foreign = true;
  await act(async () => root.render(<OperationsWorkspace />));
  expect(container.textContent).toContain("Project work is unavailable");
  expect(container.textContent).not.toContain("test-tenant-a assigned work");
  expect(container.querySelector(".ops-work-card")).toBeNull();
});
it("does not mount the department while authenticated context is unresolved or failed", async () => {
  harness.status = "error";
  await act(async () => root.render(<OperationsWorkspace />));
  expect(container.textContent).toContain("Choose your workspace");
  expect(container.querySelector(".ops-department-controls")).toBeNull();
});
it("closes details when a canonical URL-controlled view changes", async () => {
  await act(async () => root.render(<OperationsWorkspace view="work" onViewChange={vi.fn()} />));
  await act(async () => container.querySelector<HTMLButtonElement>(".ops-work-card")?.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => root.render(<OperationsWorkspace view="capacity" onViewChange={vi.fn()} />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.render(<OperationsWorkspace view="work" onViewChange={vi.fn()} />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("hands a bounded review draft to existing PAIGE after clearing old customer scope", async () => {
  const open = vi.fn();
  await act(async () => root.render(<OperationsWorkspace openPaige={open} />));
  await click("Review with PAIGE");
  expect(paige.clearClient).toHaveBeenCalledOnce(); expect(paige.clearPublic).toHaveBeenCalledOnce();
  expect(paige.handoff).toHaveBeenCalledWith(expect.stringContaining("Use current work records"));
  expect(open).toHaveBeenCalledOnce();
});

it("retains uncertain project creation after refresh without an identity", async () => {
  await act(async () => root.render(<OperationsWorkspace view="projects" onViewChange={vi.fn()} />));
  await click("New project");
  await click("Refresh unknown project");
  expect(container.querySelector('[data-testid="project-creator"]')).not.toBeNull();
  await click("Inspect acknowledged project");
  expect(container.querySelector('[data-testid="project-creator"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("keeps native CRM work usable while Planning is unavailable",async()=>{
 harness.planningError="Explicit Planning refusal";harness.crmTasks=[{id:"native-crm",tenant_id:harness.tenant,user_id:harness.user,title:"Native CRM work",description:null,
  status:"pending",due_date:null,updated_at:"2026-10-10T12:00:00Z",created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null}];
 await act(async()=>root.render(<OperationsWorkspace view="work"/>));
 expect(container.textContent).toContain("Planning work is unavailable");expect(container.querySelectorAll(".ops-work-card")).toHaveLength(1);
 expect(container.querySelector(".ops-work-card")?.textContent).toContain("Native CRM work");
 await act(async()=>container.querySelector<HTMLButtonElement>(".ops-work-card")?.click());
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("CRM task");
 expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Work edit test seam");
});

it("inspects overdue native work from Overview while disclosing the missing project source",async()=>{
 harness.planningError="Explicit Planning refusal";
 harness.crmTasks=[{id:"native-overdue",tenant_id:harness.tenant,user_id:harness.user,title:"Native overdue obligation",description:null,
  status:"pending",due_date:"2000-01-01T12:00:00Z",updated_at:"2026-10-10T12:00:00Z",created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null}];
 await act(async()=>root.render(<OperationsWorkspace view="overview"/>));
 expect(container.textContent).toContain("Project work is unavailable");
 expect(container.querySelector(".ops-decision-spotlight")?.textContent).toContain("Native overdue obligation");
 await click("Inspect work");
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("CRM task");
 harness.tenant="test-tenant-b";await act(async()=>root.render(<OperationsWorkspace view="overview"/>));
 expect(document.querySelector('[role="dialog"]')).toBeNull();
 expect(container.textContent).not.toContain("Native overdue obligation");
 expect(container.textContent).toContain("CRM tasks couldn’t be verified for this workspace");
});

it("keeps native capacity assignments visible with an explicit Planning gap",async()=>{
 harness.members=[{user_id:harness.user,membership_id:"test-membership",full_name:"Sample Person",avatar_url:null} as TeamMemberRecord];
 harness.planningError="Explicit Planning refusal";harness.crmTasks=[{id:"native-capacity",tenant_id:harness.tenant,user_id:harness.user,title:"Native capacity assignment",description:null,
  status:"pending",due_date:null,updated_at:"2026-10-10T12:00:00Z",created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:60}];
 await act(async()=>root.render(<OperationsWorkspace view="capacity"/>));
 expect(container.textContent).toContain("Planning assignments are unavailable");
 expect(container.textContent).toContain("Native capacity assignment");
 expect(container.textContent).toContain("60 minutes of recorded estimated effort.");
 expect(container.textContent).toContain("Availability unknown");
 await act(async()=>container.querySelector<HTMLButtonElement>(".ops-capacity-blocks button")?.click());
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("CRM task");
 harness.tenant="test-tenant-b";await act(async()=>root.render(<OperationsWorkspace view="capacity"/>));
 expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("offers scoped retained recovery even when the original task is outside the loaded read",async()=>{
 sessionStorage.setItem(`paige:operations-crm-stage:${harness.user}:${harness.tenant}`,JSON.stringify({actorId:harness.user,tenantId:harness.tenant,key:"original-key",taskId:"original-native-task",targetStatus:"completed",
  command:{action:"task.complete",task_id:"original-native-task",expected_updated_at:"2026-10-10T12:00:00Z"}}));
 await act(async()=>root.render(<OperationsWorkspace view="work"/>));await click("Recover pending task change");
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Recovery test seam: original-native-task");
 harness.tenant="test-tenant-b";await act(async()=>root.render(<OperationsWorkspace view="work"/>));
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(container.textContent).not.toContain("Recover pending task change");
});

it("shows the original pending task before confirmation instead of the newly selected task",async()=>{
 const task={id:"task-b",tenant_id:harness.tenant,user_id:harness.user,title:"Newly selected task B",description:null,status:"pending" as const,due_date:null,updated_at:"2026-10-10T12:00:00Z",created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null};
 harness.crmTasks=[task,{...task,id:"task-a",title:"Original pending task A"}];
 sessionStorage.setItem(`paige:operations-crm-stage:${harness.user}:${harness.tenant}`,JSON.stringify({actorId:harness.user,tenantId:harness.tenant,key:"original-key",taskId:"task-a",targetStatus:"completed",command:{action:"task.complete",task_id:"task-a",expected_updated_at:task.updated_at}}));
 await act(async()=>root.render(<OperationsWorkspace view="work"/>));
 const card=Array.from(container.querySelectorAll<HTMLButtonElement>(".ops-work-card")).find(entry=>entry.textContent?.includes(task.title));
 await act(async()=>card?.click());
 const select=document.querySelector<HTMLSelectElement>('select[aria-label="Review CRM task stage"]');
 await act(async()=>{if(select){select.value="done";select.dispatchEvent(new Event("change",{bubbles:true}));}});
 const dialog=document.querySelector('[role="dialog"]');
 expect(dialog?.querySelector("h2")?.textContent).toBe("Recover the earlier task change: Original pending task A");
 expect(dialog?.textContent).toContain("Recovery test seam: task-a");
 expect(dialog?.textContent).not.toContain(task.title);
});

it("offers the existing In progress selector for pending CRM work and routes it to review",async()=>{
 const task={id:"progress-task",tenant_id:harness.tenant,user_id:harness.user,title:"Start scoped work",description:null,status:"pending" as const,due_date:null,updated_at:"2026-10-10T12:00:00.123456Z",created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null};
 harness.crmTasks=[task];await act(async()=>root.render(<OperationsWorkspace view="work"/>));
 await act(async()=>container.querySelector<HTMLButtonElement>('[data-work-key="crm:progress-task"]')?.click());
 const select=document.querySelector<HTMLSelectElement>('select[aria-label="Review CRM task stage"]')!;
 expect(Array.from(select.options).some(option=>option.value==="in_progress")).toBe(true);
 await act(async()=>{select.value="in_progress";select.dispatchEvent(new Event("change",{bubbles:true}));});
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Recovery test seam: progress-task");expect(task.status).toBe("pending");
});

it.each(["completed","cancelled"] as const)("excludes In progress from a %s CRM task selector",async status=>{
 harness.crmTasks=[{id:"terminal-task",tenant_id:harness.tenant,user_id:harness.user,title:"Terminal scoped work",description:null,status,due_date:null,updated_at:"2026-10-10T12:00:00Z",created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null}];
 await act(async()=>root.render(<OperationsWorkspace view="work"/>));
 const filter=container.querySelector<HTMLSelectElement>(".ops-view-toolbar select")!;
 await act(async()=>{filter.value="all";filter.dispatchEvent(new Event("change",{bubbles:true}));});
 await act(async()=>container.querySelector<HTMLButtonElement>('[data-work-key="crm:terminal-task"]')?.click());
 const select=document.querySelector<HTMLSelectElement>('select[aria-label="Review CRM task stage"]');
 expect(select).toBeTruthy();expect(Array.from(select!.options).some(option=>option.value==="in_progress")).toBe(false);
});

const linkedId = "30000000-0000-4000-8000-000000000011";
const linkedSearch = `?weeklySource=planning_item&item=${linkedId}`;
const linkedItem = () => ({ id: linkedId, tenant_id: harness.tenant, plan_id: null, item_type: "task", title: "Canonical linked Planning work",
  summary: "Source record", status: "open", priority: "normal", due_at: null, assigned_to_user_id: harness.user, created_by: harness.user,
  updated_at: "2026-10-10T12:00:00.123456Z" });
it("opens the point-read Planning record outside the loaded bundle and refreshes that exact record", async () => {
  weekly.read.mockResolvedValue({ kind: "verified", item: linkedItem() });
  await act(async () => root.render(<OperationsWorkspace view="work" weeklySourceSearch={linkedSearch} weeklySourceKey="link-one" />));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Canonical linked Planning work");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Completing a check does not complete this work");
  expect(weekly.read).toHaveBeenCalledWith({ actorId: harness.user, tenantId: harness.tenant, itemId: linkedId }, expect.any(Function));
  weekly.read.mockResolvedValue({ kind: "verified", item: { ...linkedItem(), status: "done", updated_at: "2026-10-10T12:01:00.123456Z" } });
  const refresh = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Refresh linked editor")!;
  await act(async () => refresh.click());
  expect(weekly.read).toHaveBeenCalledTimes(2); expect(weekly.refresh).toHaveBeenCalledWith({ silent: true });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Recorded as completed work");
});
it("never uses a loaded row or CRM UUID as authority for a weekly source link", async () => {
  harness.crmTasks=[{id:linkedId,tenant_id:harness.tenant,user_id:harness.user,title:"Same UUID in CRM",description:null,
    status:"pending",due_date:null,updated_at:"2026-10-10T12:00:00Z",created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null}];
  await act(async () => root.render(<OperationsWorkspace view="work" weeklySourceSearch={linkedSearch} weeklySourceKey="link-one" />));
  const dialog = document.querySelector('[role="dialog"]');
  expect(weekly.read).toHaveBeenCalledOnce(); expect(dialog?.textContent).toContain("This work is unavailable");
  expect(dialog?.textContent).not.toContain("Same UUID in CRM"); expect(dialog?.textContent).not.toContain("Work edit test seam");
});
it("rejects malformed or duplicate typed targets without reading or replacing work", async () => {
  await act(async () => root.render(<OperationsWorkspace view="work" weeklySourceSearch={`${linkedSearch}&item=${linkedId}`} />));
  expect(weekly.read).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain("weekly-check work link is unavailable");
});
it("drops a delayed point read when the actor/workspace changes", async () => {
  const oldItem = linkedItem(); let resolve: (value: unknown) => void = () => {};
  weekly.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => root.render(<OperationsWorkspace view="work" weeklySourceSearch={linkedSearch} />));
  harness.tenant = "test-tenant-b";
  await act(async () => root.render(<OperationsWorkspace view="work" weeklySourceSearch={linkedSearch} />));
  await act(async () => resolve({ kind: "verified", item: oldItem }));
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(oldItem.title);
});
it("preserves dirty work through a repeated link, URL Back removal, destination change and sheet close", async () => {
  weekly.read.mockResolvedValue({ kind: "verified", item: linkedItem() });
  await act(async () => root.render(<OperationsWorkspace view="work" weeklySourceSearch={linkedSearch} weeklySourceKey="first" />));
  harness.guard = "Save or discard your unsaved work changes before leaving.";
  await act(async () => root.render(<OperationsWorkspace view="work" weeklySourceSearch={linkedSearch} weeklySourceKey="second" />));
  expect(weekly.read).toHaveBeenCalledOnce();
  await act(async () => root.render(<OperationsWorkspace view="work" weeklySourceSearch="" weeklySourceKey="back" />));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Canonical linked Planning work");
  await act(async () => root.render(<OperationsWorkspace view="capacity" weeklySourceSearch="" weeklySourceKey="view-back" />));
  expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Work");
  const close = document.querySelector<HTMLButtonElement>('[role="dialog"] button:has(.sr-only)');
  expect(close).toBeTruthy(); await act(async () => close!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("unsaved work");
});

it("opens an exact Task independently of failed bounded lists",async()=>{
 const id="33333333-3333-4333-8333-333333333333";
 const task={id,tenant_id:harness.tenant,user_id:harness.user,title:"Exact beyond-window task",description:"Current native task",status:"pending",due_date:null,updated_at:"2026-10-18T00:00:00.123456Z",created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null};
 harness.crmError="List unavailable";harness.planningError="List unavailable";
 weekly.taskRead.mockResolvedValue({status:"available",found:true,task});
 await act(async()=>root.render(<OperationsWorkspace view="work" weeklySourceSearch={`?task=${id}`} weeklySourceKey="task-1"/>));
 expect(weekly.taskRead).toHaveBeenCalledWith(id,expect.any(AbortSignal));
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Exact beyond-window task");
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Native assignment/date edit test seam");
});

it.each([
  ["a standalone business, client work in a project", true, { contact_id: "test-contact", plan_id: "test-plan", updated_at: "2099-01-01T00:00:00Z" }, true],
  ["work with no client", true, { contact_id: null, plan_id: "test-plan", updated_at: "2099-01-01T00:00:00Z" }, false],
  ["client work outside a project", true, { contact_id: "test-contact", plan_id: null, updated_at: "2099-01-01T00:00:00Z" }, false],
  ["work with no row version", true, { contact_id: "test-contact", plan_id: "test-plan", updated_at: undefined }, false],
  ["a business that is not standalone", false, { contact_id: "test-contact", plan_id: "test-plan", updated_at: "2099-01-01T00:00:00Z" }, false],
])("mounts the client release flow in the work item only for %s", async (_label, standalone, overrides, mounted) => {
  release.standalone = standalone; harness.planningOverrides = overrides;
  const errors = vi.spyOn(console, "error");
  await act(async () => root.render(<OperationsWorkspace view="work" />));
  await act(async () => container.querySelector<HTMLButtonElement>(".ops-work-card")!.click());
  expect(Boolean(document.querySelector('[data-testid="release-flow"]'))).toBe(mounted);
  // The release flow sits beside the Activity read in the same sheet: it must not reuse its React key.
  expect(errors.mock.calls.some(call => String(call[0]).includes("same key"))).toBe(false);
  errors.mockRestore();
});
