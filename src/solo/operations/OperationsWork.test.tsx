import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import { OperationsWork } from "./OperationsWork";
import type { CrmWorkRecord } from "./operations-native-work";
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

it("keeps equal native IDs distinct and routes inspection to the original CRM record", async () => {
  const crm = { id:item.id, tenant_id:"workspace", user_id:"person", title:"Prepare the engagement",
    description:null,status:"pending",due_date:null,updated_at:item.updated_at,created_at:null,
    deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null } as CrmWorkRecord;
  const inspectPlanning=vi.fn(), inspectCrm=vi.fn();
  await act(async () => root.render(<OperationsWork plans={[]} items={[item]} crmTasks={[crm]} members={[]}
    onInspectItem={inspectPlanning} onInspectCrmTask={inspectCrm} />));
  const cards=Array.from(container.querySelectorAll<HTMLButtonElement>(".ops-work-card"));
  expect(cards).toHaveLength(2);
  await act(async () => cards[1].click());
  expect(inspectCrm).toHaveBeenCalledExactlyOnceWith(crm);
  expect(inspectPlanning).not.toHaveBeenCalled();
  expect(cards[1].textContent).toContain("Priority unknown");
  expect(cards[1].draggable).toBe(false);
});

it("refuses an unsupported CRM blocked move and proposes completion without browser mutation", async () => {
  const crm={id:"crm",tenant_id:"workspace",user_id:"person",title:"CRM native task",description:null,
    status:"pending",due_date:null,updated_at:item.updated_at,created_at:null,deal_id:null,biz_id:null,
    recorded_priority:"high",estimated_minutes:30} as CrmWorkRecord;
  const propose=vi.fn();
  await act(async () => root.render(<OperationsWork plans={[]} items={[]} crmTasks={[crm]} members={[]}
    onInspectItem={vi.fn()} onInspectCrmTask={vi.fn()} onProposeCrmStage={propose} />));
  const card=container.querySelector<HTMLButtonElement>(".ops-work-card")!;
  await drag(card,"dragstart"); await drag(container.querySelector('[aria-label="Blocked"]')!,"drop");
  expect(propose).not.toHaveBeenCalled();
  await drag(card,"dragstart"); await drag(container.querySelector('[aria-label="Completed"]')!,"drop");
  expect(propose).toHaveBeenCalledExactlyOnceWith(crm,"done",card);
  expect(crm.status).toBe("pending");
  expect(card.closest(".ops-work-lane")?.getAttribute("aria-label")).toBe("Ready");
});

it("orders the shared deadline timeline chronologically across ISO offsets", async () => {
  const crm={id:"crm",tenant_id:"workspace",user_id:"person",title:"Earlier CRM deadline",description:null,
    status:"pending",due_date:"2026-10-11T09:00:00+10:00",updated_at:item.updated_at,created_at:null,
    deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null} as CrmWorkRecord;
  await act(async () => root.render(<OperationsWork plans={[]} items={[{...item,title:"Later Planning deadline",due_at:"2026-10-11T01:00:00Z"}]} crmTasks={[crm]}
    members={[]} onInspectItem={vi.fn()} onInspectCrmTask={vi.fn()} />));
  const timeline=Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent==="Timeline")!;
  await act(async () => timeline.click());
  const rows=container.querySelectorAll(".ops-timeline-row");
  expect(rows[0].textContent).toContain("Earlier CRM deadline");
  expect(rows[1].textContent).toContain("Later Planning deadline");
});
