import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import type { CrmWorkRecord } from "./operations-native-work";
import { OperationsCapacity } from "./OperationsCapacity";

let container: HTMLDivElement;
let root: Root;
const member = {user_id:"person-a",membership_id:"member-a",full_name:"Sample Person",avatar_url:null} as TeamMemberRecord;
const planning = {id:"shared",tenant_id:"tenant-a",assigned_to_user_id:"person-a",status:"blocked",title:"Planning assignment"} as PlanItem;
const crm: CrmWorkRecord = {id:"shared",tenant_id:"tenant-a",user_id:"person-a",title:"Native CRM assignment",description:null,status:"pending",due_date:null,updated_at:null,created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:90};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(()=>{container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();});

it("inspects colliding task identities through their original sources and displays partial recorded effort",async()=>{
  const inspectPlanning=vi.fn(),inspectCrm=vi.fn();
  await act(async()=>root.render(<OperationsCapacity tenantId="tenant-a" items={[planning]} crmTasks={[crm]} members={[member]} onInspectItem={inspectPlanning} onInspectCrmTask={inspectCrm}/>));
  const buttons=container.querySelectorAll<HTMLButtonElement>(".ops-capacity-blocks button");
  expect(buttons).toHaveLength(2);
  await act(async()=>{buttons[0].click();buttons[1].click();});
  expect(inspectPlanning).toHaveBeenCalledWith(planning);expect(inspectCrm).toHaveBeenCalledWith(crm);
  expect(container.textContent).toContain("90 minutes of recorded estimated effort.");
  expect(container.textContent).toContain("1 assignment has unknown effort.");
  expect(container.textContent).toContain("Availability unknown");
  expect(container.textContent).not.toContain("40 hours");
});

it("keeps completed native work out of active workload and flags an unavailable person",async()=>{
  await act(async()=>root.render(<OperationsCapacity tenantId="tenant-a" items={[]} crmTasks={[{...crm,status:"completed"},{...crm,id:"unresolved",user_id:"absent",title:"Unresolved assignment"}]} members={[member]} onInspectItem={vi.fn()} onInspectCrmTask={vi.fn()}/>));
  expect(container.textContent).not.toContain("Native CRM assignment");
  expect(container.textContent).toContain("No active assignments in the work shown.");
  expect(container.querySelector(".ops-capacity-unresolved")?.textContent).toContain("Unresolved assignment");
  expect(container.querySelector(".ops-capacity-unresolved")?.textContent).toContain("Member unavailable");
});
