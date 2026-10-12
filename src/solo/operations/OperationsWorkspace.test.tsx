import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CrmWorkRecord } from "./operations-native-work";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";

const harness = vi.hoisted(() => ({ tenant: "test-tenant-a", user: "test-user", status: "ready", foreign: false,
  crmTasks:[] as CrmWorkRecord[], crmError:null as string|null, planningError:null as string|null, members:[] as TeamMemberRecord[] }));
const paige = vi.hoisted(() => ({ handoff: vi.fn(), clearClient: vi.fn(), clearPublic: vi.fn() }));
vi.mock("@/lib/paigePromptHandoff", () => ({ handOffPaigePrompt: paige.handoff }));
vi.mock("@/solo/paigeClientScope", () => ({ clearPaigeClientScope: paige.clearClient }));
vi.mock("@/solo/paigePublicPresenceScope", () => ({ clearPaigePublicPresenceScope: paige.clearPublic }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: harness.tenant,
  activeUserId: harness.user, loading: false, accountContextStatus: harness.status }) }));
vi.mock("./useOperationsPeople", () => ({ useOperationsPeople: () => ({ members: harness.members, loading: false,
  error: null, partial: false, refresh: vi.fn() }) }));
vi.mock("@/hooks/usePlanList", () => ({ usePlanList: () => ({ plans: [], loading: false, error: harness.planningError,
  forbidden: false, refresh: vi.fn(), allItems: [{ id: "test-item", tenant_id: harness.foreign ? "test-foreign" : harness.tenant,
    plan_id: null, title: `${harness.tenant} assigned work`, summary: "Test source", status: "open", priority: "normal",
    item_type: "task", assigned_to_user_id: null, due_at: null }] }) }));
vi.mock("./OperationsDelivery", () => ({ default: () => <div>Delivery test seam</div> }));
vi.mock("./OperationsPlaybooks", () => ({ OperationsPlaybooks: () => <div>Playbook test seam</div> }));
vi.mock("./OperationsWorkEditor", () => ({ OperationsWorkEditor: () => <div>Work edit test seam</div> }));
vi.mock("./OperationsCrmWorkEditor",()=>({OperationsCrmWorkEditor:()=> <div>Native assignment/date edit test seam</div>}));
vi.mock("./OperationsProjectCreator", () => ({ OperationsProjectCreator: ({ onRecover }: { onRecover: (id?: string) => Promise<void> }) => <div data-testid="project-creator"><button onClick={() => void onRecover()}>Refresh unknown project</button><button onClick={() => void onRecover("test-project")}>Inspect acknowledged project</button></div> }));
vi.mock("./useOperationsCrmWork",()=>({useOperationsCrmWork:()=>({tasks:harness.crmTasks,loading:false,error:harness.crmError,forbidden:false,hasMore:false,refresh:vi.fn()})}));
vi.mock("./OperationsCrmStageReview",()=>({OperationsCrmStageReview:({operation}:{operation:{taskId:string}})=><div>Recovery test seam: {operation.taskId}</div>}));
import { OperationsWorkspace } from "./OperationsWorkspace";
let container: HTMLDivElement;
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { harness.tenant = "test-tenant-a"; harness.user = "test-user"; harness.status = "ready";
  vi.clearAllMocks();
  sessionStorage.clear();harness.crmTasks=[];harness.crmError=null;harness.planningError=null;harness.members=[];
  harness.foreign = false; container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
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
 expect(dialog?.querySelector("h2")?.textContent).toBe("Original pending task A");
 expect(dialog?.textContent).toContain("Recovery test seam: task-a");
 expect(dialog?.textContent).not.toContain(task.title);
});
