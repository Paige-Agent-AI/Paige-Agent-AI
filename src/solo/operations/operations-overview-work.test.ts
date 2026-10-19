import { expect, it } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { CrmWorkRecord } from "./operations-native-work";
import { overviewNativeWork } from "./operations-overview-work";
const planning = {id:"same",tenant_id:"tenant",title:"Planning blocker",status:"blocked",priority:"high",due_at:null} as PlanItem;
const crm = {id:"same",tenant_id:"tenant",title:"CRM deadline",status:"pending",recorded_priority:null,due_date:"2026-10-10T12:00:00Z"} as CrmWorkRecord;
it("includes native overdue work without copying identity or accepting completed work",()=>{
 const result=overviewNativeWork("tenant",[planning],[crm,{...crm,id:"completed",status:"completed"}],Date.parse("2026-10-11T00:00:00Z"));
 expect(result.attention.map(row=>row.id)).toEqual(["planning:same","crm:same"]);
 expect(result.attention[1].native.record).toBe(crm);expect(result.upcoming).toEqual([]);
});
it("orders actual instants across offsets and keeps missing deadlines unknown",()=>{
 const result=overviewNativeWork("tenant",[],[{...crm,id:"later",due_date:"2026-10-12T01:00:00Z"},{...crm,id:"earlier",due_date:"2026-10-11T23:00:00+02:00"},{...crm,id:"unknown",due_date:null}],Date.parse("2026-10-11T00:00:00Z"));
 expect(result.upcoming.map(row=>row.native.record.id)).toEqual(["earlier","later"]);
});
it("refuses a mixed-tenant executive read rather than showing foreign work",()=>{
 expect(()=>overviewNativeWork("tenant",[planning],[{...crm,tenant_id:"foreign"}])).toThrow("OPERATIONS_WORK_SCOPE_CHANGED");
});

it("keeps real undated assignments visible when there is no project, blocker or deadline",()=>{
 const pending={...crm,id:"pending",title:"Confirm the client brief",due_date:null};
 const working={...crm,id:"working",title:"Prepare kickoff",status:"in_progress",due_date:null} as CrmWorkRecord;
 const result=overviewNativeWork("tenant",[],[pending,working,{...crm,id:"done",status:"completed"},{...crm,id:"cancelled",status:"cancelled"}],Date.parse("2026-10-19T12:00:00Z"));
 expect(result.attention).toEqual([]);expect(result.upcoming).toEqual([]);
 expect(result.active.map(row=>row.native.record)).toEqual([working,pending]);
 expect(result.timingToConfirm.map(row=>row.native.record.id)).toEqual(["working","pending"]);
 expect(result.inProgress.map(row=>row.native.record)).toEqual([working]);
});

it("keeps reminders separate from task deadlines and preserves their original inspection identity",()=>{
 const reminder={...planning,id:"reminder",title:"Review the week",item_type:"reminder",status:"open",due_at:"2026-01-01T00:00:00Z",remind_at:"2026-10-20T09:00:00-04:00"} as PlanItem;
 const result=overviewNativeWork("tenant",[reminder],[],Date.parse("2026-10-19T12:00:00Z"));
 expect(result.attention).toEqual([]);expect(result.upcoming).toEqual([]);expect(result.timingToConfirm).toEqual([]);
 expect(result.reminders[0].native.record).toBe(reminder);
});

it("does not treat invalid dates or unknown priority as verified urgency",()=>{
 const invalid={...crm,id:"invalid",title:"Check the deadline",recorded_priority:null,due_date:"invalid-date"};
 const result=overviewNativeWork("tenant",[],[invalid],Date.parse("2026-10-19T12:00:00Z"));
 expect(result.attention).toEqual([]);expect(result.upcoming).toEqual([]);
 expect(result.timingToConfirm[0].native.record).toBe(invalid);expect(result.timingToConfirm[0].priority).toBeNull();
});
