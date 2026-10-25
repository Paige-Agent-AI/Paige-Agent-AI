import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ task: {} as Record<string, unknown>, pipeline: {} as Record<string, unknown>, control: vi.fn(), save: vi.fn() }));
vi.mock("./data/useOwnerTaskAutomations", () => ({ useOwnerTaskAutomations: () => ports.task }));
vi.mock("./data/useSoloAutomations", () => ({ useSoloAutomations: () => ports.pipeline, outcomeLabel: () => "" }));
import { SoloAutomationsView } from "./settings-automations";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => void) | null = null;
const button = (text: string) => {
  const found = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
  if (!found) throw Error("Missing button " + text);
  return found;
};
beforeEach(() => {
  ports.control.mockReset(); ports.save.mockReset(); ports.save.mockResolvedValue(true);
  const process = { id: "process", updatedAt: "2026-10-18T12:00:00Z", process: {
    id: "process", tenant_id: "tenant", name: "Review new contacts", state: "paused", trigger_key: "contact.created",
    trigger_config: {}, conditions: [], created_by: "owner", granted_lane: "confirm", owner_task_armed_at: null,
  }, acts: [{ id: "act", position: 1, action_kind: "owner.task", tool_key: null, config: { title: "Review contact" } }] };
  const locator = { approvalId: "approval", occurrenceId: "occurrence", approvalStatus: "approved", updatedAt: "2026-10-18T12:30:00Z" };
  ports.task = { read: { status: "ready", items: [process], hasMore: false }, scopeKey: "tenant:owner:0",
    busy: false, needsRefresh: false, feedback: null, refresh: vi.fn(), control: ports.control, openHistory: vi.fn(),
    closeHistory: vi.fn(), inspectOutcome: vi.fn(), history: { status: "ready", processId: process.id,
      list: { items: [locator], hasMore: false }, selected: locator, outcome: {
        status: "ready", processId: process.id, approvalId: locator.approvalId, occurrenceId: locator.occurrenceId,
        approvalStatus: "approved", recordedOutcome: "executed", decidedAt: "2026-10-18T12:31:00Z", title: "Review contact",
        originalTask: { state: "verified", taskId: "00000000-0000-4000-8000-000000000111",
          receiptId: "receipt", runId: "run" }, currentTask: { state: "not_read" },
      } } };
  ports.pipeline = { loading: false, error: null, hasPipeline: true, canWrite: true, saving: false, writeError: null,
    rules: [], pipelines: [{ id: "pipeline", name: "Pipeline" }],
    stagesByPipeline: new Map([["pipeline", [{ id: "stage", label: "New" }]]]),
    outcomes: [], outcomesUnavailable: false, refresh: vi.fn(), createRule: ports.save, updateRule: ports.save };
});
afterEach(() => { cleanup?.(); cleanup = null; });
function mount() {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  act(() => root.render(<MemoryRouter initialEntries={["/solo/123/settings/integrations/automations"]}><SoloAutomationsView /></MemoryRouter>));
  cleanup = () => act(() => { root.unmount(); host.remove(); });
}

it("withholds the verified Task link while an actual sibling editor is open and preserves its corrected draft", () => {
  mount();
  const decisionTime = document.querySelector(".sa-owner-task-result time");
  expect(decisionTime?.getAttribute("datetime")).toBe("2026-10-18T12:31:00Z");
  expect(decisionTime?.closest("p")?.textContent).toContain("Decision recorded:");
  expect(document.querySelector('a[href*="?task="]')).not.toBeNull();
  act(() => button("New automation").click());
  expect(document.querySelector('form[aria-label="New automation"]')).not.toBeNull();
  act(() => button("professional").click());
  expect(button("professional").getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('a[href*="?task="]')).toBeNull();
  expect(document.body.textContent).toContain("Finish or cancel your pipeline rule edit");
  expect(button("professional").getAttribute("aria-pressed")).toBe("true");
  expect(ports.save).not.toHaveBeenCalled(); expect(ports.control).not.toHaveBeenCalled();
  act(() => button("Cancel").click());
  expect(document.querySelector('form[aria-label="New automation"]')).toBeNull();
  expect(document.querySelector('a[href*="?task="]')?.getAttribute("href")).toBe("/solo/123/operations/work?task=00000000-0000-4000-8000-000000000111");
  expect(ports.save).not.toHaveBeenCalled(); expect(ports.control).not.toHaveBeenCalled();
});

it("retains the navigation hold after a failed save and releases only after the existing writer succeeds", async () => {
  ports.save.mockResolvedValueOnce(false).mockResolvedValueOnce(true); mount();
  act(() => button("New automation").click()); act(() => button("professional").click());
  await act(async () => button("Save automation").click());
  expect(document.querySelector('a[href*="?task="]')).toBeNull();
  expect(button("professional").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Save automation").click());
  expect(document.querySelector('a[href*="?task="]')).not.toBeNull();
  expect(ports.save).toHaveBeenCalledTimes(2);
  expect(ports.save).toHaveBeenNthCalledWith(1, { pipeline_id: "pipeline", from_stage_id: null, to_stage_id: "stage",
    compose_intent: "nurture", tone: "professional", send_mode: "draft_for_review" });
  expect(ports.save.mock.calls[1]).toEqual(ports.save.mock.calls[0]);
  expect(ports.control).not.toHaveBeenCalled();
});
