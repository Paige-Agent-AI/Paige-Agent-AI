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
