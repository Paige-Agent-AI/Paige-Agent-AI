import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), submit: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("./operations-work-update", () => ({ submitOperationsWorkUpdate: mock.submit }));
import { OperationsWorkEditor } from "./OperationsWorkEditor";
let container: HTMLDivElement;
let root: Root;
const item = { id: "item-a", tenant_id: "tenant-a", status: "open", created_by: "creator", assigned_to_user_id: "assignee", due_at: null, updated_at: "2026-10-10T12:00:00Z" } as PlanItem;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.resetAllMocks(); mock.rpc.mockResolvedValue({ data: false, error: null });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(value = item, actorId = "assignee", refresh = vi.fn().mockResolvedValue(undefined)) {
  await act(async () => root.render(<OperationsWorkEditor item={value} actorId={actorId} tenantId="tenant-a" members={[]} refresh={refresh} sourceError={false} />));
}
async function status(value: string) {
  const select = container.querySelector("select")!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function requestSave() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
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
it("preserves canonical coach staff controls for work assigned to another person", async () => {
  mock.rpc.mockImplementation(async (_name, args) => ({ data: args._user_id === "coach" && args._roles.includes("coach"), error: null }));
  await render(item, "coach");
  expect(container.querySelector("form")).not.toBeNull();
  expect(container.querySelector('input[type="datetime-local"]')).not.toBeNull();
  expect(Array.from(container.querySelectorAll("label")).some(label => label.textContent?.startsWith("Responsible person"))).toBe(true);
});
it("requires matching canonical readback after an acknowledgement", async () => {
  mock.submit.mockResolvedValue({ kind: "acknowledged" }); const refresh = vi.fn().mockResolvedValue(undefined);
  await render(item, "assignee", refresh); await status("done"); await save();
  expect(refresh).toHaveBeenCalledOnce(); expect(container.textContent).toContain("Checking current work");
  expect(container.textContent).not.toContain("Saved and confirmed");
  await render({ ...item, status: "done" }, "assignee", refresh);
  expect(container.textContent).toContain("Saved and confirmed in current work");
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
