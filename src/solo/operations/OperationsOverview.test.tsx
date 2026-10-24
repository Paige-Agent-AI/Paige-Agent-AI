import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { CrmWorkRecord } from "./operations-native-work";
import { OperationsOverview } from "./OperationsOverview";
// This pure work-ordering suite isolates the separately tested weekly entry.
vi.mock("../weekly/WeeklyResponsibilityEntry", () => ({ WeeklyResponsibilityEntry: () => null }));
// The original calendar reader has its own authority suite; this mount owns work routing.
vi.mock("../data/useBusinessTimeZone", async original => ({ ...await original<typeof import("../data/useBusinessTimeZone")>(),
  useBusinessCalendarDay: () => ({ day: { kind: "configured", zone: "America/New_York", date: "2026-10-21" }, refresh: vi.fn() }) }));

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

it.each(['loading','unavailable'] as const)('keeps recorded findings independent of %s Work without inventing zero or an empty first use',async nativeWorkState=>{
 await act(async()=>root.render(<OperationsOverview tenantId="test-tenant" plans={[]} items={[]} members={[]}
  crmTasks={[task]} nativeWorkState={nativeWorkState} recordedFindings={<p>Independent recorded source</p>}
  onInspectItem={vi.fn()} onInspectPlan={vi.fn()}/>));
 expect(container.textContent).toContain('Independent recorded source');
 expect(container.textContent).not.toContain(task.title);
 expect(container.textContent).not.toContain('Start with one real commitment');
 expect(container.textContent).not.toContain('0 active commitments');
});

it('keeps recorded findings beside genuine empty Work and preserves its native first-use actions',async()=>{
 await act(async()=>root.render(<OperationsOverview tenantId="test-tenant" plans={[]} items={[]} members={[]}
  recordedFindings={<p>Independent recorded source</p>} onInspectItem={vi.fn()} onInspectPlan={vi.fn()}/>));
 expect(container.textContent).toContain('Independent recorded source');expect(container.textContent).toContain('Start with one real commitment');
});

it("routes each attention group to Work while preserving the original record inspector",async()=>{
 const now=vi.spyOn(Date,"now").mockReturnValue(Date.parse("2026-11-01T06:00:00Z"));
 try {
  const inspect=vi.fn(),openSet=vi.fn();
  const blocked={id:"blocked",tenant_id:"test-tenant",title:"Confirm the handoff",item_type:"task",status:"blocked",priority:"normal",due_at:null} as PlanItem;
  const reminder={...blocked,id:"reminder",title:"Review commitments",item_type:"reminder",status:"open",remind_at:"2099-01-01T12:00:00Z"} as PlanItem;
  const future={...task,id:"future",title:"Prepare next milestone",due_date:"2099-01-01T12:00:00Z"};
  await act(async()=>root.render(<OperationsOverview tenantId="test-tenant" plans={[]} items={[blocked,reminder]} members={[]}
   crmTasks={[task,future]} onInspectItem={inspect} onInspectPlan={vi.fn()} onInspectWorkSet={openSet}/>));
  const button=(label:string)=>Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent===label);
  for(const [label,group] of [["View attention in Work","attention"],["View deadlines in Work","deadlines"],
   ["Review all missing dates","timing"],["View reminders in Work","reminders"]]){
   expect(button(label),label).toBeTruthy();
   await act(async()=>button(label)!.click());expect(openSet).toHaveBeenLastCalledWith(group);
  }
  await act(async()=>button("Inspect the original work")!.click());expect(inspect).toHaveBeenCalledExactlyOnceWith(blocked);
  expect(container.textContent).toContain("Your operating week");expect(container.textContent).toContain("Work in motion");
 } finally {now.mockRestore();}
});
