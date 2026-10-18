import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("./operations-work-create", () => ({ createOperationsWork: mock.create }));
import { OperationsWorkCreator } from "./OperationsWorkCreator";
import { hasUnsavedWork } from "@/hooks/useBeforeUnloadGuard";
let host: HTMLDivElement; let root: Root;
const members = [
  { user_id: "test-actor-a", full_name: "Example owner", status: "active", avatar_url: null },
  { user_id: "test-actor-b", full_name: "Example teammate", status: "active", avatar_url: null },
] as TeamMemberRecord[];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.resetAllMocks(); mock.rpc.mockResolvedValue({ data: true, error: null }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(onClose = vi.fn(), onCreated = vi.fn().mockResolvedValue(undefined), onRecover = vi.fn().mockResolvedValue(undefined)) {
  await act(async () => root.render(<OperationsWorkCreator actorId="test-actor-a" tenantId="test-tenant-a" members={members} plans={[]}
    theme="dark" onClose={onClose} onCreated={onCreated} onRecover={onRecover} />));
}
async function enterTitle(value = "Review scope") {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="What needs to happen?"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function click(text: string) {
  // An open review dialog owns the click: its "Create task" is the act, the sheet's opens the review.
  const scope = document.querySelector('[role="alertdialog"]') ?? document;
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === text)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
async function review() { await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
it("requires review before creation and retains the draft when review is cancelled", async () => {
  await render(); await enterTitle(); await review(); expect(mock.create).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Example owner");
  await click("Keep editing"); expect(document.querySelector<HTMLInputElement>("input")?.value).toBe("Review scope");
  expect(hasUnsavedWork()).toBe(true);
});
it("refreshes canonical work only after verified creation and clears its unsaved guard", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined); mock.create.mockResolvedValue({ kind: "verified", itemId: "test-item-a" });
  await render(vi.fn(), refresh); await enterTitle(); await review(); await click("Create task");
  expect(mock.create).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain("Task saved and verified"); expect(hasUnsavedWork()).toBe(false);
});
it("disables repeat creation after unknown outcomes and warns before closing", async () => {
  const close = vi.fn(); mock.create.mockResolvedValue({ kind: "uncertain", message: "Saved state unknown" });
  await render(close); await enterTitle(); await review(); await click("Create task"); await review();
  expect(mock.create).toHaveBeenCalledOnce(); expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  await click("Close"); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("may have been saved");
  await click("Keep open"); expect(close).not.toHaveBeenCalled();
});
it("limits nonstaff assignment choices to the authenticated active person", async () => {
  mock.rpc.mockResolvedValue({ data: false, error: null }); await render();
  const assignment = document.querySelector("select")!;
  expect(Array.from(assignment.options).map(option => option.value)).toEqual(["test-actor-a"]);
  expect(document.body.textContent).toContain("Example owner");
});
it("ignores a late permission hint from the previous tenant", async () => {
  let resolvePrevious!: (value:{data:boolean;error:null})=>void;
  mock.rpc.mockImplementationOnce(()=>new Promise(resolve=>{resolvePrevious=resolve;})).mockResolvedValue({data:false,error:null});
  await render();
  await act(async()=>root.render(<OperationsWorkCreator actorId="test-actor-a" tenantId="test-tenant-b" members={members} plans={[]}
    theme="dark" onClose={vi.fn()} onCreated={vi.fn()} onRecover={vi.fn()} />));
  await act(async()=>resolvePrevious({data:true,error:null}));
  expect(mock.rpc).toHaveBeenLastCalledWith("is_tenant_admin",{_tenant:"test-tenant-b"});
  expect(Array.from(document.querySelector("select")!.options).map(option=>option.value)).toEqual(["test-actor-a"]);
});
it("inspects an uncertain acknowledged identity without replaying creation", async () => {
  const recover = vi.fn().mockResolvedValue(undefined);
  mock.create.mockResolvedValue({ kind: "uncertain", message: "Readback unavailable", itemId: "test-item-a" });
  await render(vi.fn(), vi.fn(), recover); await enterTitle(); await review(); await click("Create task");
  await click("Inspect saved task"); expect(recover).toHaveBeenCalledWith("test-item-a");
  expect(mock.create).toHaveBeenCalledOnce();
});
it("offers current-work recovery when identity is unknown and retains the lock on refresh failure", async () => {
  const recover = vi.fn().mockRejectedValue(new Error("Unavailable"));
  mock.create.mockResolvedValue({ kind: "uncertain", message: "Save unknown" });
  await render(vi.fn(), vi.fn(), recover); await enterTitle(); await review(); await click("Create task");
  await click("Refresh current work"); expect(recover).toHaveBeenCalledWith(undefined);
  expect(document.body.textContent).toContain("do not recreate the task yet");
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(mock.create).toHaveBeenCalledOnce();
});
// E09 Slice 3: opened from a client's record, the task is created for that client, shown as a fixed chip.
it("with a client, the task carries contactId and the client is fixed, not choosable", async () => {
  mock.create.mockResolvedValue({ kind: "verified", itemId: "test-item-a" });
  await act(async () => root.render(<OperationsWorkCreator actorId="test-actor-a" tenantId="test-tenant-a" members={members} plans={[]}
    theme="dark" onClose={vi.fn()} onCreated={vi.fn().mockResolvedValue(undefined)} onRecover={vi.fn()} contact={{ id: "test-contact-a", name: "Jordan Rivera" }} />));
  const chip = document.querySelector(".ops-create-client");
  expect(chip?.textContent).toBe("For clientJordan Rivera");
  expect(chip?.querySelector("input, select, button")).toBeNull();
  await enterTitle(); await review();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("For Jordan Rivera");
  await click("Create task");
  expect(mock.create).toHaveBeenCalledWith({ actorId: "test-actor-a", tenantId: "test-tenant-a" }, expect.objectContaining({ contactId: "test-contact-a", title: "Review scope" }));
  expect(document.body.textContent).toContain("It stays private to your team until you share it with Jordan Rivera.");
});
it("with a client, says before anything is typed that the task stays private until shared", async () => {
  await act(async () => root.render(<OperationsWorkCreator actorId="test-actor-a" tenantId="test-tenant-a" members={members} plans={[]}
    theme="dark" onClose={vi.fn()} onCreated={vi.fn()} onRecover={vi.fn()} contact={{ id: "test-contact-a", name: "Jordan Rivera", firstName: "Jordan" }} />));
  const description = document.querySelector('[role="dialog"] p')?.textContent ?? "";
  expect(description).toBe("Create a task with a clear responsibility and deadline. It stays private until you share it with Jordan.");
});
it("names the submit for what it does — Create task — and its disabled state is a neutral surface, not a gold slab", async () => {
  await render();
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(submit.textContent).toBe("Create task"); expect(submit.disabled).toBe(true);
  const css = (await import("node:fs")).readFileSync("src/solo/operations/operations-workspace.css", "utf8");
  const rule = css.match(/\.ops-work-editor :is\(button\[type=submit\],button\.ops-action-primary\):disabled\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toContain("background:var(--pg-surface)"); expect(rule).toContain("opacity:1");
  expect(rule).not.toMatch(/gold/);
});
it("without a client, nothing changes: no chip and no contactId on the call (§58)", async () => {
  mock.create.mockResolvedValue({ kind: "verified", itemId: "test-item-a" });
  await render(); await enterTitle(); await review(); await click("Create task");
  expect(document.querySelector(".ops-create-client")).toBeNull();
  expect(Object.keys(mock.create.mock.calls[0][1])).not.toContain("contactId");
  expect(document.body.textContent).not.toContain("share it with");
  expect(document.body.textContent).not.toContain("stays private");
});
