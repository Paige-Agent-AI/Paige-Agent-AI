import { describe, expect, it } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import { crmActionForStage, normalizeCrmWorkRead, nativeWorkStage, projectNativeOperationsWork, summarizeNativeWorkload, type CrmWorkRecord } from "./operations-native-work";
const planning = { id: "shared-native-id", tenant_id: "tenant-a", status: "blocked" } as PlanItem;
const crm: CrmWorkRecord = { id: "shared-native-id", tenant_id: "tenant-a", user_id: "person-a", title: "Existing CRM work", description: null, status: "pending", due_date: null, updated_at: "2026-10-10T10:00:00Z", created_at: null, deal_id: "native-deal", biz_id: null, recorded_priority: null, estimated_minutes: null };
describe("native Operations source boundary", () => {
  it("keeps colliding source IDs separate and retains the original records", () => {
    const work=projectNativeOperationsWork("tenant-a",[planning],[crm]);
    expect(work.map(row=>row.key)).toEqual(["planning:shared-native-id","crm:shared-native-id"]);
    expect(work[0].record).toBe(planning);expect(work[1].record).toBe(crm);
    expect(nativeWorkStage(work[0])).toBe("blocked");expect(nativeWorkStage(work[1])).toBe("open");
  });
  it("refuses a mixed tenant projection instead of leaking or silently dropping work", () => {
    expect(()=>projectNativeOperationsWork("tenant-a",[planning],[{...crm,tenant_id:"tenant-b"}])).toThrow("OPERATIONS_WORK_SCOPE_CHANGED");
    expect(()=>projectNativeOperationsWork("tenant-a",[{...planning,tenant_id:"tenant-b"}],[crm])).toThrow("OPERATIONS_WORK_SCOPE_CHANGED");
  });
  it("never maps unsupported CRM stages or missing versions to an execution", () => {
    expect(crmActionForStage(crm,"blocked")).toBeNull();expect(crmActionForStage(crm,"cancelled")).toBeNull();
    expect(crmActionForStage({...crm,updated_at:null},"done")).toBeNull();
    expect(crmActionForStage(crm,"open")).toBeNull();expect(crmActionForStage(crm,"done")).toBe("task.complete");
    expect(crmActionForStage(crm,"in_progress")).toBeNull();
    expect(crmActionForStage({...crm,status:"completed"},"open")).toBe("task.reopen");
  });
});

describe("native CRM readback",()=>{
  const read=(tasks:unknown[]= [crm])=>({ok:true,actor_id:"person-a",tenant_id:"tenant-a",has_more:false,tasks});
  it("accepts native records without exposing raw metadata",()=>{
    const result=normalizeCrmWorkRead(read([{...crm,metadata:{private_payload:"not projected"}}]),"person-a","tenant-a");
    expect(result?.tasks).toEqual([crm]);expect(result?.hasMore).toBe(false);
  });
  it("refuses foreign identity, tenant, duplicate identities and unsupported states",()=>{
    expect(normalizeCrmWorkRead(read(),"other-person","tenant-a")).toBeNull();
    expect(normalizeCrmWorkRead(read([{...crm,tenant_id:"tenant-b"}]),"person-a","tenant-a")).toBeNull();
    expect(normalizeCrmWorkRead(read([crm,crm]),"person-a","tenant-a")).toBeNull();
    expect(normalizeCrmWorkRead(read([{...crm,status:"review"}]),"person-a","tenant-a")).toBeNull();
  });
  it("keeps missing effort unknown and rejects unsupported estimates",()=>{
    expect(normalizeCrmWorkRead(read(),"person-a","tenant-a")?.tasks[0].estimated_minutes).toBeNull();
    expect(normalizeCrmWorkRead(read([{...crm,estimated_minutes:-2}]),"person-a","tenant-a")).toBeNull();
    expect(normalizeCrmWorkRead(read([{...crm,estimated_minutes:0}]),"person-a","tenant-a")?.tasks[0].estimated_minutes).toBe(0);
  });
});

describe("recorded workload without invented capacity",()=>{
  it("adds recorded active estimates and keeps missing effort unknown across both sources",()=>{
    const work=projectNativeOperationsWork("tenant-a",[{...planning,assigned_to_user_id:"person-a"}],
      [{...crm,estimated_minutes:90},{...crm,id:"missing",estimated_minutes:null},
       {...crm,id:"completed",status:"completed",estimated_minutes:1000}]);
    const result=summarizeNativeWorkload(work,"person-a");
    expect(result.assignments).toHaveLength(3);
    expect(result.recordedMinutes).toBe(90);
    expect(result.unknownEffortCount).toBe(2);
    expect(result.blockedCount).toBe(1);
  });
  it("distinguishes a recorded zero from missing effort and never includes another owner's work",()=>{
    const work=projectNativeOperationsWork("tenant-a",[],[{...crm,estimated_minutes:0},
      {...crm,id:"foreign-owner",user_id:"person-b",estimated_minutes:400}]);
    expect(summarizeNativeWorkload(work,"person-a")).toMatchObject({recordedMinutes:0,unknownEffortCount:0});
    expect(summarizeNativeWorkload(work,"absent")).toMatchObject({assignments:[],recordedMinutes:null,unknownEffortCount:0});
  });
});
