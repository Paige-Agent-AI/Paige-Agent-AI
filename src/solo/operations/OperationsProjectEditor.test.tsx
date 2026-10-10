import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Plan } from "@/hooks/usePlanList";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), submit: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("./operations-project-update", () => ({ submitOperationsProjectUpdate: mock.submit }));
import { OperationsProjectEditor } from "./OperationsProjectEditor";
const plan = { id: "project", tenant_id: "tenant", created_by: "creator", owner_user_id: "owner", status: "draft", starts_on: "2026-10-10", ends_on: "2026-11-10", updated_at: "2026-10-10T12:00:00.123456Z", items: [] } as unknown as Plan;
let container: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.resetAllMocks(); mock.rpc.mockResolvedValue({ data: false, error: null }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(value = plan, actor = "owner", refresh = vi.fn().mockResolvedValue(undefined)) { await act(async () => root.render(<OperationsProjectEditor plan={value} actorId={actor} tenantId="tenant" members={[]} refresh={refresh} sourceError={false} />)); }
async function changeStatus(status = "active") { const select = container.querySelector<HTMLSelectElement>('select[aria-label="Project status"]')!; await act(async () => { select.value = status; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function review() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function confirm() { const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(button => button.textContent === "Confirm project change")!; await act(async () => button.click()); }
it("requires confirmation and retains the draft when the owner keeps editing", async () => {
  await render(); await changeStatus(); await review(); expect(mock.submit).not.toHaveBeenCalled();
  const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(button => button.textContent === "Keep editing")!;
  await act(async () => cancel.click()); expect(container.querySelector("select")?.value).toBe("active"); expect(mock.submit).not.toHaveBeenCalled();
});
it("withholds controls from unrelated people and ownership delegation from nonstaff owners", async () => { await render(plan, "observer"); expect(container.querySelector("form")).toBeNull(); await render(); expect(container.querySelector('select[aria-label="Accountable owner"]')).toBeNull(); });
it("requires matching refreshed project fields before saved success", async () => { mock.submit.mockResolvedValue({ kind: "acknowledged" }); await render(); await changeStatus(); await review(); await confirm(); expect(container.textContent).not.toContain("Saved and confirmed"); await render({ ...plan, status: "active" }); expect(container.textContent).toContain("Saved and confirmed in current projects"); });
it("rejects a mismatched source readback", async () => { mock.submit.mockResolvedValue({ kind: "acknowledged" }); await render(); await changeStatus(); await review(); await confirm(); await render({ ...plan, status: "archived" }); expect(container.textContent).toContain("differs from the requested change"); expect(container.textContent).not.toContain("Saved and confirmed"); });
it("pins an old draft version despite background refresh", async () => { mock.submit.mockResolvedValue({ kind: "refused", message: "Concurrent edit" }); await render(); await changeStatus(); await render({ ...plan, updated_at: "2026-10-10T12:01:00Z" }); await review(); await confirm(); expect(mock.submit).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: plan.updated_at }), expect.objectContaining({ status: "active" })); });
it("keeps unknown saves locked until source review", async () => { mock.submit.mockResolvedValue({ kind: "uncertain", message: "Unknown" }); await render(); await changeStatus(); await review(); await confirm(); await review(); expect(mock.submit).toHaveBeenCalledOnce(); expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true); expect(container.textContent).toContain("Refresh and review project"); });
