import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import type { Plan } from "@/hooks/usePlanList";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("./operations-project-create", () => ({ createOperationsProjectRecord: mock.create }));
import { OperationsProjectCreator } from "./OperationsProjectCreator";
const members = [{ user_id: "test-actor-a", full_name: "Example owner", status: "active", avatar_url: null }] as TeamMemberRecord[];
let host: HTMLDivElement; let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.resetAllMocks(); mock.rpc.mockResolvedValue({ data: true, error: null }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(project?: Plan, recover = vi.fn(), created = vi.fn()) {
  await act(async () => root.render(<OperationsProjectCreator actorId="test-actor-a" tenantId="test-tenant-a" members={members}
    project={project} theme="dark" onClose={vi.fn()} onCreated={created} onRecover={recover} />));
}
async function input(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function click(text: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === text)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
async function fillProject() { await input('input:not([type="date"])', "Client launch"); await input('input[type="date"]', "2026-10-20"); await input('.ops-create-pair label:last-child input', "2026-11-20"); }
async function review() { await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
it("reviews project scope and dates before saving and retains canceled drafts", async () => {
  await render(); await fillProject(); await review(); expect(mock.create).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Draft");
  await click("Keep editing"); expect(document.querySelector<HTMLInputElement>("input")?.value).toBe("Client launch");
});
it("reports draft creation only after verified source result", async () => {
  mock.create.mockResolvedValue({ kind: "verified", id: "test-plan-a" }); const created = vi.fn();
  await render(undefined, vi.fn(), created); await fillProject(); await review(); await click("Create project");
  expect(created).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain("Project saved and verified as a draft");
});
it("keeps repeat submission locked and offers exact project inspection after uncertainty", async () => {
  mock.create.mockResolvedValue({ kind: "uncertain", id: "test-plan-a", message: "Readback unavailable" }); const recover = vi.fn();
  await render(undefined, recover); await fillProject(); await review(); await click("Create project");
  await click("Inspect saved project"); expect(recover).toHaveBeenCalledWith("test-plan-a");
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true); expect(mock.create).toHaveBeenCalledOnce();
});
it("keeps nonstaff milestone creation unavailable", async () => {
  mock.rpc.mockResolvedValue({ data: false, error: null }); await render({ id: "test-plan-a", title: "Example project" } as Plan);
  expect(document.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
  expect(document.body.textContent).toContain("requires an authorized workspace administrator"); expect(mock.create).not.toHaveBeenCalled();
});
