import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "../team-workspace-contract";
import type { CrmWorkRecord } from "./operations-native-work";
import { OperationsCapacity } from "./OperationsCapacity";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement, root:Root;
const now=Date.parse("2026-10-20T12:00:00Z");
const member:TeamMemberRecord={membership_id:"test-membership",user_id:"test-user",full_name:"Casey Example",email:null,avatar_url:null,status:"active",permission:"owner",is_owner:true,job_title:null,responsibilities:null,last_sign_in_at:null};
const task:CrmWorkRecord={id:"late",tenant_id:"test-tenant",user_id:member.user_id,title:"Confirm the delivery brief",description:null,status:"pending",due_date:"2026-10-19T12:00:00Z",updated_at:"2026-10-19T12:00:00Z",created_at:"2026-10-18T12:00:00Z",deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null};
beforeEach(()=>{vi.spyOn(Date,"now").mockReturnValue(now);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});

it("connects late work to its owner and opens the same original CRM record",async()=>{
 const inspect=vi.fn();
 await act(async()=>root.render(<OperationsCapacity tenantId="test-tenant" items={[]} members={[member]} crmTasks={[task,{...task,id:"undated",title:"Check next steps",due_date:null}]} onInspectItem={vi.fn()} onInspectCrmTask={inspect}/>));
 expect(host.textContent).toContain("1 overdue");expect(host.textContent).toContain("1 needs a due date");
 const button=Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes(task.title));
 expect(button?.textContent).toContain("Overdue");
 await act(async()=>button!.click());expect(inspect).toHaveBeenCalledWith(task);
 expect(host.textContent).toContain("Availability unknown");expect(host.textContent).not.toMatch(/hours available|ZION is working|automation completed/i);
});

it("keeps reminder schedules distinct from deadlines and leaves unavailable inspectors disabled",async()=>{
 const reminder={id:"reminder",tenant_id:"test-tenant",title:"Review open commitments",item_type:"reminder",status:"open",assigned_to_user_id:member.user_id,due_at:"2026-01-01T00:00:00Z",remind_at:"2026-10-21T13:00:00Z"} as PlanItem;
 await act(async()=>root.render(<OperationsCapacity tenantId="test-tenant" items={[reminder]} members={[member]} crmTasks={[{...task,due_date:"invalid"}]} onInspectItem={vi.fn()}/>));
 const reminderButton=Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes(reminder.title));
 expect(reminderButton?.textContent).toContain("Reminder");expect(reminderButton?.textContent).not.toContain("Overdue");
 const taskButton=Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes(task.title));
 expect(taskButton?.disabled).toBe(true);expect(taskButton?.textContent).toContain("Date unavailable");
 expect(host.textContent).not.toContain("1 overdue");
});

it("shows deadline context on unresolved ownership without assigning that work to a roster member",async()=>{
 const missing={...task,id:"missing-owner",user_id:"unavailable-member",title:"Confirm the milestone"};
 await act(async()=>root.render(<OperationsCapacity tenantId="test-tenant" items={[]} members={[member]} crmTasks={[missing,{...task,id:"done",status:"completed"}]} onInspectItem={vi.fn()} onInspectCrmTask={vi.fn()}/>));
 const unresolved=Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes(missing.title));
 expect(unresolved?.textContent).toContain("Member unavailable");expect(unresolved?.textContent).toContain("Overdue");
 expect(host.querySelector(".ops-capacity-person")?.textContent).toContain("0 shown assignments");
});
