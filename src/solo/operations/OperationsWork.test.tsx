import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import { OperationsWork } from "./OperationsWork";
let container: HTMLDivElement;
let root: Root;
const item = { id: "local-work", title: "Review the draft", status: "open", priority: "normal", item_type: "task",
  updated_at: "2026-10-10T12:00:00.123456Z", assigned_to_user_id: null, plan_id: null, due_at: null } as PlanItem;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function drag(target: Element, type: string) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { setData: vi.fn(), getData: () => "foreign-item", effectAllowed: "", dropEffect: "" } });
  await act(async () => target.dispatchEvent(event));
}
it("proposes a move from current work without changing the saved card or accepting external payloads", async () => {
  const propose = vi.fn();
  await act(async () => root.render(<OperationsWork plans={[]} items={[item]} members={[]} onInspectItem={vi.fn()} onProposeStage={propose} />));
  const completed = container.querySelector('[aria-label="Completed"]')!;
  await drag(completed, "drop");
  expect(propose).not.toHaveBeenCalled();
  const card = container.querySelector(".ops-work-card")!;
  await drag(card, "dragstart"); await drag(completed, "dragover"); await drag(completed, "drop");
  expect(propose).toHaveBeenCalledExactlyOnceWith(item, "done", card);
  expect(card.closest(".ops-work-lane")?.getAttribute("aria-label")).toBe("Ready");
  expect(item.status).toBe("open");
});
it("does not offer dragging without a source version, retaining keyboard inspection", async () => {
  const inspect = vi.fn();
  await act(async () => root.render(<OperationsWork plans={[]} items={[{ ...item, updated_at: undefined }]} members={[]} onInspectItem={inspect} onProposeStage={vi.fn()} />));
  const card = container.querySelector<HTMLButtonElement>(".ops-work-card")!;
  expect(card.draggable).toBe(false);
  await act(async () => card.click());
  expect(inspect).toHaveBeenCalledOnce();
});
