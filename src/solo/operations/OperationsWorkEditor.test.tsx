import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), submit: vi.fn(), roles: { loading: false, userId: "assignee" as string | null, roles: [] as string[] } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("@/hooks/useUserRoles", () => ({ useUserRoles: () => mock.roles }));
vi.mock("./operations-work-update", () => ({ submitOperationsWorkUpdate: mock.submit }));
import { OperationsWorkEditor } from "./OperationsWorkEditor";
let container: HTMLDivElement;
let root: Root;
const item = { id: "item-a", tenant_id: "tenant-a", status: "open", created_by: "creator", assigned_to_user_id: "assignee", due_at: null, updated_at: "2026-10-10T12:00:00Z" } as PlanItem;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.resetAllMocks(); mock.rpc.mockResolvedValue({ data: false, error: null });
  mock.roles = { loading: false, userId: "assignee", roles: [] };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(value = item, actorId = "assignee", refresh = vi.fn().mockResolvedValue(undefined), tenantId = "tenant-a") {
  await act(async () => root.render(<OperationsWorkEditor item={value} actorId={actorId} tenantId={tenantId} members={[]} refresh={refresh} sourceError={false} />));
}
async function status(value: string) {
  const select = container.querySelector("select")!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function requestSave() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function date(value:string) {
  const input=container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});
}
async function save() {
  await requestSave();
  const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(button => button.textContent === "Confirm change");
  if (confirm) await act(async () => confirm.click());
}
it("does not persist a stage change before confirmation and preserves the draft on cancellation", async () => {
  await render(); await status("done"); await requestSave();
  expect(mock.submit).not.toHaveBeenCalled();
  const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(button => button.textContent === "Keep editing")!;
  await act(async () => cancel.click());
  expect(mock.submit).not.toHaveBeenCalled();
  expect(container.querySelector("select")?.value).toBe("done");
});
it("allows assignee status control but no due-date or reassignment control", async () => {
  await render(); expect(container.querySelectorAll("select")).toHaveLength(1);
  expect(Array.from(container.querySelectorAll("option")).map(option => option.value)).not.toContain("cancelled");
  expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
  await render(item, "observer"); expect(container.querySelector("form")).toBeNull();
});
it("preserves supported admin controls for work assigned to another person", async () => {
  mock.rpc.mockImplementation(async (name, args) => ({ data: name === "is_tenant_admin" && args._tenant === "tenant-a", error: null }));
  await render(item, "admin");
  expect(container.querySelector("form")).not.toBeNull();
  expect(container.querySelector('input[type="datetime-local"]')).not.toBeNull();
  expect(Array.from(container.querySelectorAll("label")).some(label => label.textContent?.startsWith("Responsible person"))).toBe(true);
});
it.each(["creator", "admin", "super_admin"])("preserves the qualified %s reminder-time path and exact submitted field", async role => {
  const reminder = { ...item, item_type: "reminder" as const, priority: "normal" as const };
  const actor = role === "creator" ? "creator" : "manager";
  mock.roles = { loading: false, userId: actor, roles: role === "creator" ? [] : [role] };
  mock.rpc.mockResolvedValue({ data: role !== "creator", error: null });
  mock.submit.mockResolvedValue({ kind: "acknowledged" });
  await render(reminder, actor);
  expect(container.querySelector('input[type="datetime-local"]')).not.toBeNull();
  await date("2099-02-01T09:30"); await save();
  expect(mock.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorId: actor, tenantId: "tenant-a", expectedUpdatedAt: item.updated_at }),
    { remindAt: new Date("2099-02-01T09:30").toISOString() });
});
it.each([
  ["missing app role", { loading: false, userId: "manager", roles: [] }],
  ["unavailable role-read output", { loading: false, userId: "manager", roles: [] }],
  ["retired title role", { loading: false, userId: "manager", roles: ["coach"] }],
  ["platform role alone", { loading: false, userId: "manager", roles: ["platform_admin"] }],
  ["loading role proof", { loading: true, userId: "manager", roles: ["admin"] }],
  ["another actor's roles", { loading: false, userId: "someone-else", roles: ["admin"] }],
  ["absent actor", { loading: false, userId: null, roles: ["super_admin"] }],
] as const)("keeps a noncreator tenant admin's reminder time read-only with %s", async (_label, roles) => {
  mock.roles = { ...roles, roles: [...roles.roles] };
  mock.rpc.mockResolvedValue({ data: true, error: null });
  await render({ ...item, item_type: "reminder" }, "manager");
  expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Reminder time is read-only");
  expect(mock.submit).not.toHaveBeenCalled();
});
it.each([{ data: false, error: null }, { data: true, error: { message: "permission lookup unavailable" } }])("does not replace tenant authority with app admin (%j)", async reply => {
  mock.roles = { loading: false, userId: "assignee", roles: ["admin"] };
  mock.rpc.mockResolvedValue(reply);
  await render({ ...item, item_type: "reminder" }, "assignee");
  expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
  expect(container.querySelector("select")).not.toBeNull();
  expect(mock.submit).not.toHaveBeenCalled();
});
it("does not reuse a tenant-admin proof while the target workspace check is pending or denied", async () => {
  mock.roles = { loading: false, userId: "manager", roles: ["admin"] };
  mock.rpc.mockResolvedValue({ data: true, error: null });
  const reminder = { ...item, item_type: "reminder" as const };
  await render(reminder, "manager");
  expect(container.querySelector('input[type="datetime-local"]')).not.toBeNull();
  let finish!: (reply: { data: boolean; error: null }) => void;
  mock.rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render({ ...reminder, tenant_id: "tenant-b" }, "manager", vi.fn(), "tenant-b");
  expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
  await act(async () => finish({ data: false, error: null }));
  expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
  expect(mock.submit).not.toHaveBeenCalled();
});
it("refuses a retained reminder-time draft after the actor changes and retains manual discard", async () => {
  mock.roles = { loading: false, userId: "manager", roles: ["admin"] };
  mock.rpc.mockResolvedValue({ data: true, error: null });
  const reminder = { ...item, item_type: "reminder" as const };
  await render(reminder, "manager"); await date("2099-02-01T09:30");
  await render(reminder, "new-manager");
  expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
  await save();
  expect(mock.submit).not.toHaveBeenCalled();
  const discard = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Discard unsaved changes")!;
  await act(async () => discard.click());
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(container.textContent).toContain("Unsaved changes discarded");
});
it("requires matching canonical readback after an acknowledgement", async () => {
  mock.submit.mockResolvedValue({ kind: "acknowledged" }); const refresh = vi.fn().mockResolvedValue(undefined);
  await render(item, "assignee", refresh); await status("done"); await save();
  expect(refresh).toHaveBeenCalledOnce(); expect(container.textContent).toContain("Checking current work");
  expect(container.textContent).not.toContain("Saved and confirmed");
  await render({ ...item, status: "done" }, "assignee", refresh);
  expect(container.textContent).toContain("Saved and confirmed in current work");
});
it("reschedules an active reminder through remindAt and confirms only its canonical reminder time",async()=>{
  const reminder={...item,item_type:"reminder" as const,priority:"normal" as const,remind_at:"2099-01-01T13:00:00Z"};
  const refresh=vi.fn().mockResolvedValue(undefined);mock.submit.mockResolvedValue({kind:"acknowledged"});
  await render(reminder,"creator",refresh);
  expect(container.textContent).toContain("New reminder time");expect(container.textContent).not.toContain("New due date and time");
  await date("2099-02-01T09:30");await save();
  const requested=new Date("2099-02-01T09:30").toISOString();
  expect(mock.submit).toHaveBeenCalledWith(expect.objectContaining({expectedUpdatedAt:item.updated_at}),{remindAt:requested});
  expect(container.textContent).not.toContain("Saved and confirmed");
  await render({...reminder,remind_at:requested,updated_at:"2026-10-10T12:01:00Z"},"creator",refresh);
  expect(container.textContent).toContain("Saved and confirmed in current work");
});
it("never confirms an active reminder when only due_at changed",async()=>{
  const reminder={...item,item_type:"reminder" as const,priority:"normal" as const,remind_at:"2099-01-01T13:00:00Z"};
  mock.submit.mockResolvedValue({kind:"acknowledged"});await render(reminder,"creator");await date("2099-02-01T09:30");await save();
  await render({...reminder,due_at:new Date("2099-02-01T09:30").toISOString(),updated_at:"2026-10-10T12:01:00Z"},"creator");
  expect(container.textContent).toContain("Current work differs");expect(container.textContent).not.toContain("Saved and confirmed");
});
it("holds an uncertain active reschedule and requires read-only review without retry",async()=>{
  mock.submit.mockResolvedValue({kind:"uncertain",message:"Reminder result unconfirmed"});
  const reminder={...item,item_type:"reminder" as const,priority:"normal" as const,remind_at:"2099-01-01T13:00:00Z"};
  const refresh=vi.fn().mockResolvedValue(undefined);await render(reminder,"creator",refresh);await date("2099-02-01T09:30");await save();await save();
  expect(mock.submit).toHaveBeenCalledOnce();expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  const review=Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent==="Refresh and review")!;
  await act(async()=>review.click());await render({...reminder,remind_at:new Date("2099-02-01T09:30").toISOString(),updated_at:"2026-10-10T12:01:00Z"},"creator",refresh);
  expect(mock.submit).toHaveBeenCalledOnce();expect(container.textContent).toContain("Current work refreshed. Review");expect(container.textContent).not.toContain("Saved and confirmed");
});
it.each([{tenant_id:"foreign-tenant"},{id:"foreign-item"},{remind_at:"invalid"}])("refuses a foreign or unavailable reminder readback (%o)",async override=>{
  mock.submit.mockResolvedValue({kind:"acknowledged"});const reminder={...item,item_type:"reminder" as const,priority:"normal" as const,remind_at:"2099-01-01T13:00:00Z"};
  await render(reminder,"creator");await date("2099-02-01T09:30");await save();
  await render({...reminder,remind_at:new Date("2099-02-01T09:30").toISOString(),...override},"creator");
  expect(container.textContent).toContain("Current work differs");expect(container.textContent).not.toContain("Saved and confirmed");
});
it("refuses a reminder time combined with another edit and never offers terminal rescheduling",async()=>{
  mock.submit.mockResolvedValue({kind:"uncertain",message:"Unexpected old route"});
  const reminder={...item,item_type:"reminder" as const,priority:"normal" as const};
  await render(reminder,"creator");await date("2099-02-01T09:30");
  const priority=container.querySelector<HTMLSelectElement>('select[aria-label="Priority"]')!;
  await act(async()=>{priority.value="high";priority.dispatchEvent(new Event("change",{bubbles:true}));});
  await requestSave();expect(mock.submit).not.toHaveBeenCalled();expect(container.textContent).toContain("Review reminder rescheduling separately");
  await render({...reminder,status:"done"},"creator");expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
});
it.each(["task","milestone"] as const)("retains %s dueAt editing",async itemType=>{
  mock.submit.mockResolvedValue({kind:"acknowledged"});await render({...item,item_type:itemType},"creator");
  await date("2099-02-01T09:30");await save();expect(mock.submit).toHaveBeenCalledWith(expect.anything(),{dueAt:new Date("2099-02-01T09:30").toISOString()});
});
it("keeps uncertain results from becoming successful saves or automatic retries", async () => {
  mock.submit.mockResolvedValue({ kind: "uncertain", message: "Result uncertain" });
  await render(); await status("done"); await save(); await save();
  expect(mock.submit).toHaveBeenCalledOnce();
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(container.textContent).not.toContain("Saved and confirmed");
});
it("offers readback recovery after a refusal and prevents another write until refreshed", async () => {
  mock.submit.mockResolvedValue({ kind: "refused", message: "Permission refused" });
  await render(); await status("done"); await save(); await save();
  expect(mock.submit).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Refresh and review");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(container.querySelector("select")?.value).toBe("done");
});
it("does not grant a newer source version to an older draft after background refresh", async () => {
  mock.submit.mockResolvedValue({ kind: "refused", message: "Someone changed this work" });
  await render(); await status("done");
  await render({ ...item, status: "in_progress", updated_at: "2026-10-10T12:01:00Z" });
  await save();
  expect(mock.submit).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: item.updated_at }), { status: "done" });
  expect(container.textContent).toContain("Someone changed this work");
});
it("confirms priority only when canonical readback matches the requested priority", async () => {
  mock.submit.mockResolvedValue({ kind: "acknowledged" });
  const original = { ...item, priority: "normal" as const };
  await render(original, "creator");
  const priority = container.querySelector<HTMLSelectElement>('select[aria-label="Priority"]')!;
  await act(async () => { priority.value = "high"; priority.dispatchEvent(new Event("change", { bubbles: true })); });
  await save();
  expect(mock.submit).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: original.updated_at }), { priority: "high" });
  expect(container.textContent).not.toContain("Saved and confirmed");
  await render({ ...original, priority: "high", updated_at: "2026-10-10T12:01:00Z" }, "creator");
  expect(container.textContent).toContain("Saved and confirmed in current work");
});
it("refuses to call a mismatched priority readback a successful save", async () => {
  mock.submit.mockResolvedValue({ kind: "acknowledged" });
  const original = { ...item, priority: "normal" as const };
  await render(original, "creator");
  const priority = container.querySelector<HTMLSelectElement>('select[aria-label="Priority"]')!;
  await act(async () => { priority.value = "urgent"; priority.dispatchEvent(new Event("change", { bubbles: true })); });
  await save();
  await render({ ...original, priority: "low", updated_at: "2026-10-10T12:01:00Z" }, "creator");
  expect(container.textContent).toContain("Current work differs from the requested change");
  expect(container.textContent).not.toContain("Saved and confirmed");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
});

it("registers a synchronous guard for dirty, saving and uncertain work and clears it on unmount", async () => {
  let guard: (() => string | null) | null = null;
  const register = vi.fn((next: (() => string | null) | null) => { guard = next; });
  await act(async () => root.render(<OperationsWorkEditor item={item} actorId="assignee" tenantId="tenant-a" members={[]}
    refresh={vi.fn()} sourceError={false} onNavigationGuardChange={register} />));
  expect(guard?.()).toBeNull(); await status("done");
  expect(guard?.()).toContain("unsaved");
  let resolve: (value: { kind: "uncertain"; message: string }) => void = () => {};
  mock.submit.mockImplementation(() => new Promise(done => { resolve = done; }));
  await save(); expect(guard?.()).toContain("checking");
  await act(async () => resolve({ kind: "uncertain", message: "Result uncertain" }));
  expect(guard?.()).toContain("unconfirmed");
  await act(async () => root.render(<div />)); expect(guard).toBeNull();
});
it("allows an explicit draft discard without a write and keeps cancelled records inspect-only", async () => {
  await render(); await status("done");
  const discard = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Discard unsaved changes");
  expect(discard).toBeTruthy(); await act(async () => discard?.click());
  expect(container.querySelector("select")?.value).toBe("open"); expect(mock.submit).not.toHaveBeenCalled();
  await render({ ...item, status: "cancelled" });
  expect(container.querySelector("form")).toBeNull(); expect(container.textContent).toContain("inspect");
});

it("retains a linked dirty draft across route unmount without borrowing a newer source version", async () => {
  const original = { ...item, id: "linked-dirty-retention", updated_at: "2026-10-10T12:00:00.123456Z" };
  const mount = async (value = original) => act(async () => root.render(<OperationsWorkEditor item={value} actorId="assignee"
    tenantId="tenant-a" members={[]} refresh={vi.fn()} sourceError={false} retainDraftOnLeave />));
  await mount(); await status("done"); await act(async () => root.render(<div />));
  await mount({ ...original, status: "in_progress", updated_at: "2026-10-10T12:01:00.123456Z" });
  expect(container.querySelector("select")?.value).toBe("done");
  mock.submit.mockResolvedValue({ kind: "refused", message: "Stale edit refused" }); await save();
  expect(mock.submit).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: original.updated_at }), { status: "done" });
});
it("retains interrupted submission as unknown and does not replay it when the linked editor returns", async () => {
  const original = { ...item, id: "linked-uncertain-retention" };
  const refresh = vi.fn(); let resolve: (value: { kind: "acknowledged" }) => void = () => {};
  const mount = async (retainDraftOnLeave = true) => act(async () => root.render(<OperationsWorkEditor item={original} actorId="assignee"
    tenantId="tenant-a" members={[]} refresh={refresh} sourceError={false} retainDraftOnLeave={retainDraftOnLeave} />));
  mock.submit.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await status("done"); await save(); await act(async () => root.render(<div />));
  await mount(false); await act(async () => resolve({ kind: "acknowledged" }));
  expect(mock.submit).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled();
  expect(container.textContent).toContain("earlier change is unconfirmed");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(container.textContent).toContain("Refresh and review"); expect(container.textContent).not.toContain("Saved and confirmed");
});
