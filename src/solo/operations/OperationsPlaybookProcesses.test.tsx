import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OwnerTaskReview } from "@/solo/data/ownerTaskAutomation";
import { OperationsPlaybooks } from "./OperationsPlaybooks";
const m = vi.hoisted(() => ({ state: {} as Record<string, unknown>, control: vi.fn(), refresh: vi.fn(), openHistory: vi.fn() }));
vi.mock("@/solo/data/useOwnerTaskAutomations", () => ({ useOwnerTaskAutomations: () => m.state }));
vi.mock("@/hooks/useKnowledgeDocuments", () => ({ useKnowledgeDocuments: () => ({ docs: [], loading: false, error: null, hasMore: false, isCurrent: () => true }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row: OwnerTaskReview = { id: "test-process", updatedAt: "2026-10-22T12:00:00.000001Z", process: {
  id: "test-process", tenant_id: "test-tenant-a", created_by: "test-owner", name: "Review new contacts", category: "general",
  trigger_key: "contact.created", trigger_config: {}, conditions: [], state: "draft", granted_lane: "confirm", owner_task_armed_at: null,
}, acts: [{ id: "test-act", position: 1, action_kind: "owner.task", tool_key: null, config: { title: "Review original contact" } }] };
let root: Root, shell: HTMLDivElement;
beforeEach(() => {
  m.control.mockReset(); m.refresh.mockReset(); m.openHistory.mockReset();
  m.state = { scopeKey: "test-scope", read: { status: "ready", items: [row], hasMore: false }, busy: false, needsRefresh: false,
    feedback: null, control: m.control, refresh: m.refresh, history: { status: "closed" }, openHistory: m.openHistory, closeHistory: vi.fn() };
  shell = document.createElement("div"); shell.dataset.tenantShell = ""; document.body.append(shell); root = createRoot(shell);
});
afterEach(() => { act(() => root.unmount()); shell.remove(); });
const button = (name: string) => [...shell.querySelectorAll("button")].find(node => node.textContent?.trim() === name)!;
async function render(onPrepare = vi.fn()) { await act(async () => root.render(<MemoryRouter><OperationsPlaybooks tenantId="test-tenant-a" onPrepare={onPrepare} /></MemoryRouter>)); return onPrepare; }
it("opens the original saved-process controls/history and protects an exact review across view changes", async () => {
  await render(); await act(async () => button("Automations").click());
  expect(shell.textContent).toContain("Review new contacts"); expect(m.control).not.toHaveBeenCalled();
  await act(async () => button("Review to enable").click());
  await act(async () => button("Procedures").click());
  expect(button("Enable future contacts")).toBeTruthy(); expect(shell.textContent).toContain("Finish or cancel");
  await act(async () => button("Cancel").click());
  expect(document.activeElement).toBe(button("Review to enable"));
  await act(async () => button("View history").click()); expect(m.openHistory).toHaveBeenCalledExactlyOnceWith(row);
  await act(async () => button("Procedures").click()); expect(shell.textContent).toContain("Make good work repeatable");
  expect(m.control).not.toHaveBeenCalled();
});
it.each(["loading", "refused", "unknown"])("shows original %s state and never submits a process by entering Operations", async state => {
  if (state === "unknown") { m.state.needsRefresh = true; m.state.feedback = { action: "arm", result: { status: "unknown" } }; }
  else m.state.read = { status: state };
  await render(); await act(async () => button("Automations").click());
  expect(shell.textContent).toContain(state === "loading" ? "Checking internal task processes" : state === "refused" ? "An active owner or admin" : "The outcome could not be confirmed");
  expect(m.control).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled();
});
it("hands an editable question to the original composer and focuses it without sending or running", async () => {
  const prepare = await render();
  const panel = document.createElement("aside"); panel.id = "tenant-paige-workspace";
  const composer = document.createElement("textarea"); composer.setAttribute("aria-label", "Message PAIGE"); composer.value = "Existing work";
  vi.spyOn(composer, "getClientRects").mockReturnValue([new DOMRect(0, 0, 200, 80)] as unknown as DOMRectList);
  panel.append(composer); shell.append(panel);
  await act(async () => button("Automations").click()); await act(async () => button("Design with ZION").click());
  expect(prepare).toHaveBeenCalledExactlyOnceWith(null, "contact-created internal task process");
  await vi.waitFor(() => expect(document.activeElement).toBe(composer));
  expect(composer.value).toBe("Existing work"); expect(m.control).not.toHaveBeenCalled();
});
