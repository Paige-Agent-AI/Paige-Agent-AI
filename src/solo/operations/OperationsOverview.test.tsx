import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { CrmWorkRecord } from "./operations-native-work";
import { OperationsOverview } from "./OperationsOverview";

let container: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const task = { id:"native-task", tenant_id:"test-tenant", user_id:"test-user", title:"Confirm the client brief",
  description:null, status:"in_progress", due_date:null, updated_at:"2026-10-19T12:00:00Z", created_at:"2026-10-18T12:00:00Z",
  deal_id:null, biz_id:null, recorded_priority:null, estimated_minutes:null } as CrmWorkRecord;

it("surfaces undated active native work without a project and opens the original inspector",async()=>{
 const inspect=vi.fn();
 await act(async()=>root.render(<OperationsOverview tenantId="test-tenant" plans={[]} items={[]} members={[]} crmTasks={[task]} onInspectCrmTask={inspect} onInspectItem={vi.fn()} onInspectPlan={vi.fn()}/>));
 const row=Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes(task.title));
 expect(row).toBeTruthy();expect(container.textContent).toContain("In progress");
 expect(container.textContent).toContain("No due date");expect(container.textContent).not.toContain("Give the work a shared direction");
 await act(async()=>row!.click());expect(inspect).toHaveBeenCalledWith(task);
});

it("keeps recorded reminders inspectable without presenting their scheduled time as delivery proof",async()=>{
 const inspect=vi.fn();const reminder={id:"native-reminder",tenant_id:"test-tenant",title:"Review unfinished work",item_type:"reminder",status:"open",priority:"normal",remind_at:"2026-10-20T13:00:00Z",due_at:null,assigned_to_user_id:null} as PlanItem;
 await act(async()=>root.render(<OperationsOverview tenantId="test-tenant" plans={[]} items={[reminder]} members={[]} onInspectItem={inspect} onInspectPlan={vi.fn()}/>));
 const row=Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes(reminder.title));
 expect(row).toBeTruthy();expect(container.textContent).not.toContain("Reminder delivered");
 await act(async()=>row!.click());expect(inspect).toHaveBeenCalledWith(reminder);
});

it("offers an honest first-use state without fabricated commitments, automation or specialist activity",async()=>{
 await act(async()=>root.render(<OperationsOverview tenantId="test-tenant" plans={[]} items={[]} members={[]} onInspectItem={vi.fn()} onInspectPlan={vi.fn()}/>));
 expect(container.textContent).toContain("Start with one real commitment");
 expect(container.textContent).not.toMatch(/ZION is working|automations running|hours saved/i);
});
