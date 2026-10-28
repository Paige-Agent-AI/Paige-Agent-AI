import { describe, expect, it, vi } from "vitest";
import { prepareWeeklyControlReview } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-review";
import { readWeeklyCommitmentProjection } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-read";
import * as weeklyRead from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-read";
import * as controlReview from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-review";
import type { ContextIdentity } from "../../supabase/functions/_shared/paige-context/mod";
import type { WeeklyControlOperation } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-input";

const actor="11111111-1111-4111-8111-111111111111", tenant="22222222-2222-4222-8222-222222222222";
const process="33333333-3333-4333-8333-333333333333", request="44444444-4444-4444-8444-444444444444";
const identity: ContextIdentity={actorId:actor,tenantId:tenant,workspaceId:tenant,role:"owner",actAsClientId:null,accountShape:"solo",scopeEpoch:1};
const schedule={weekday:1,local_time:"09:00",timezone:"America/New_York"};
function canonical() { return {ok:true,tenant_id:tenant,actor_id:actor,scope:"personal_planning_commitments",read_at:"2026-10-14T20:00:00Z",limit:50,has_more:false,
  business_time_zone:{state:"configured",zone:"America/New_York"},checks:[{automation_id:process,name:"Weekly commitment check",revision:7,
    schedule_status:"paused",schedule:{...schedule,future_control_at:null},execution_availability:"held",execution_hold_reason:"paused",next_run_at:null,intended_next_run_at:"2026-10-19T13:00:00Z",
    last_run:{event_id:request,act_id:null,scheduled_for:"2026-10-12T13:00:00Z",status:"unknown"},last_verified_run:null}]}; }
function fixture(data:unknown=canonical()) {
  let current=identity; const calls:string[]=[];
  const caller={rpc:async(name:string)=>{calls.push(name);return {data:name==="current_user_tenant_id"?current.tenantId:name==="weekly_commitment_owner"?true:data,error:null};}};
  return {caller,calls,currentIdentity:()=>current,switchIdentity:(next:ContextIdentity)=>{current=next;}};
}
const target={automation_id:process};

describe("original schedule review safe Chat projection", () => {
  const run = (...args: unknown[]) => {
    const fn = (controlReview as Record<string, unknown>).prepareWeeklyScheduleReviewChatResponse;
    expect(typeof fn, "the original review must own the model-safe projection").toBe("function");
    return (fn as (...args: unknown[]) => Promise<Record<string, unknown>>)(...args);
  };
  it("compares original schedule/revision while withholding the exact server RPC binding", async () => {
    const f = fixture();
    const result = await run(identity, f, { ...target, ...schedule, weekday: 3 }, request, 8000);
    expect(result).toMatchObject({ status: "available", review: { operation: "configure", revision: 7,
      current_schedule: schedule, proposed_schedule: { ...schedule, weekday: 3 },
      authorization: "not_granted_by_review", proposed_next_run_at: null, execution_availability: "held" } });
    expect(result).not.toHaveProperty("binding");
    expect(JSON.stringify(result)).not.toMatch(/_expected_revision|_expected_control|configure_weekly_commitment_check/);
    expect(f.calls).toEqual(["current_user_tenant_id", "weekly_commitment_owner", "get_weekly_commitment_checks",
      "current_user_tenant_id", "weekly_commitment_owner"]);
  });
  it("never reads after the existing server turn budget is exhausted", async () => {
    for (const budget of [0, -1, NaN]) {
      const f = fixture();
      expect(await run(identity, f, { ...target, ...schedule }, request, budget)).toMatchObject({ status: "unavailable" });
      expect(f.calls).toHaveLength(0);
    }
  });
  it("retires late preflight at the original elapsed deadline without a later read or write", async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: { data: unknown; error: null }) => void;
      const f = fixture(), caller = { rpc: vi.fn(() => new Promise<{ data: unknown; error: null }>(resolve => { finish = resolve; })) };
      const pending = run(identity, { ...f, caller }, { ...target, ...schedule }, request, 25);
      await vi.advanceTimersByTimeAsync(26);
      expect(await pending).toMatchObject({ status: "unavailable" });
      finish({ data: tenant, error: null }); await vi.advanceTimersByTimeAsync(1);
      expect(caller.rpc).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("rejects foreign, malformed and client-scoped proposals without binding leakage", async () => {
    const f = fixture();
    expect(await run(identity, f, { ...target, ...schedule, _expected_revision: 7 }, request, 8000))
      .toMatchObject({ status: "needs_input" });
    expect(f.calls).toHaveLength(0);
    expect(await run(identity, f, { ...target, automation_id: request, ...schedule }, request, 8000))
      .toMatchObject({ status: "unavailable", reason: "target_unavailable" });
    const client = fixture();
    expect(await run({ ...identity, actAsClientId: process }, client, { ...target, ...schedule }, request, 8000))
      .toMatchObject({ status: "refused" });
    expect(client.calls).toHaveLength(0);
  });
});

describe("canonical weekly conversation review without approval or execution",()=>{
  it("retires a review when cancellation arrives at the completed canonical-read handoff",async()=>{
    const controller=new AbortController(),f={...fixture(),signal:controller.signal};
    const original=weeklyRead.readWeeklyCommitmentProjection;
    const read=vi.spyOn(weeklyRead,"readWeeklyCommitmentProjection").mockImplementation(async(...args)=>{
      const result=await original(...args);
      expect(result.status).toBe("available");
      controller.abort();
      return result;
    });
    try{
      const result=await prepareWeeklyControlReview(identity,f,"pause",target,request);
      expect(result).toEqual({status:"unavailable",reason:"scope_changed"});
      expect(result).not.toHaveProperty("binding");
      expect(f.calls.filter(name=>name==="get_weekly_commitment_checks")).toHaveLength(1);
    }finally{read.mockRestore();}
  });
  it("returns unavailable rather than throwing when current identity fails after the canonical read",async()=>{
    const f=fixture(),original=weeklyRead.readWeeklyCommitmentProjection;
    const read=vi.spyOn(weeklyRead,"readWeeklyCommitmentProjection").mockImplementation(async(...args)=>{
      const result=await original(...args);
      expect(result.status).toBe("available");
      f.currentIdentity=()=>{throw new Error("identity retired");};
      return result;
    });
    try{
      await expect(prepareWeeklyControlReview(identity,f,"pause",target,request))
        .resolves.toEqual({status:"unavailable",reason:"scope_changed"});
      expect(f.calls.every(name=>["current_user_tenant_id","weekly_commitment_owner","get_weekly_commitment_checks"].includes(name))).toBe(true);
    }finally{read.mockRestore();}
  });
  it("does not let a mutated initiating identity adopt another business after the canonical read",async()=>{
    const initiating={...identity},f=fixture(),original=weeklyRead.readWeeklyCommitmentProjection;
    f.currentIdentity=()=>initiating;
    const read=vi.spyOn(weeklyRead,"readWeeklyCommitmentProjection").mockImplementation(async(...args)=>{
      const result=await original(...args);
      expect(result.status).toBe("available");
      Object.assign(initiating,{tenantId:request,workspaceId:request,scopeEpoch:2});
      return result;
    });
    try{
      const result=await prepareWeeklyControlReview(initiating,f,"pause",target,request);
      expect(result).toEqual({status:"unavailable",reason:"scope_changed"});
      expect(result).not.toHaveProperty("binding");
      expect(f.calls.filter(name=>name==="get_weekly_commitment_checks")).toHaveLength(1);
    }finally{read.mockRestore();}
  });
  it("prepares resume with the exact native paused cutoff and no write",async()=>{
    const data=canonical(),cutoff="2026-10-23T15:20:10.123456+00:00";
    Object.assign(data.checks[0],{schedule:{...schedule,future_control_at:cutoff}});
    const f=fixture(data),result=await prepareWeeklyControlReview(identity,f,"resume",target,request);
    expect(result).toMatchObject({status:"review_ready",binding:{rpc:"control_weekly_commitment_check",args:{
      _automation_id:process,_action:"authorize",_expected_revision:7,
      _expected_control:{state:"paused",future_control_at:cutoff}}},
      review:{operation:"resume",authorization:"not_granted_by_review",future_only:true}});
    expect(f.calls.every(name=>["current_user_tenant_id","weekly_commitment_owner","get_weekly_commitment_checks"].includes(name))).toBe(true);
  });
  it("cannot prepare resume from a legacy read without its saved cutoff",async()=>{
    const data=canonical();Object.assign(data.checks[0],{schedule});
    const result=await prepareWeeklyControlReview(identity,fixture(data),"resume",target,request);
    expect(result).toMatchObject({status:"unavailable",reason:"canonical_binding_failed"});
    expect(result).not.toHaveProperty("binding");
  });
  it("cannot prepare resume for a requested or already scheduled responsibility",async()=>{
    for(const state of ["requested","scheduled"]){
      const data=canonical();data.checks[0].schedule_status=state;
      const result=await prepareWeeklyControlReview(identity,fixture(data),"resume",target,request);
      expect(result.status).toBe("unavailable");
      expect(result).not.toHaveProperty("binding");
    }
  });
  it("keeps a legacy status readable without inventing a saved null control cutoff",async()=>{
    const data=canonical();Object.assign(data.checks[0],{schedule});
    const read=await readWeeklyCommitmentProjection(identity,fixture(data));
    expect(read.status).toBe("available");
    expect(read.data?.checks[0].future_control_at).toBeUndefined();
  });
  it("cannot prepare authorization when the original status omitted its control cutoff",async()=>{
    const data=canonical();Object.assign(data.checks[0],{schedule});
    const f=fixture(data),result=await prepareWeeklyControlReview(identity,f,"authorize",target,request);
    expect(result).toMatchObject({status:"unavailable",reason:"canonical_binding_failed"});
    expect(result).not.toHaveProperty("binding");
    expect(f.calls.every(name=>["current_user_tenant_id","weekly_commitment_owner","get_weekly_commitment_checks"].includes(name))).toBe(true);
  });
  it("preserves a genuine explicit null cutoff for exact authorization preparation",async()=>{
    const result=await prepareWeeklyControlReview(identity,fixture(),"authorize",target,request);
    expect(result).toMatchObject({status:"review_ready",binding:{args:{
      _expected_control:{state:"paused",future_control_at:null}}}});
  });
  it("uses the actual saved control cutoff in authorization preparation and never calls a writer",async()=>{
    const data=canonical(),cutoff="2026-10-23T15:20:10.123456+00:00";
    Object.assign(data.checks[0],{schedule:{...schedule,future_control_at:cutoff}});
    const f=fixture(data),result=await prepareWeeklyControlReview(identity,f,"authorize",target,request);
    expect(result).toMatchObject({status:"review_ready",binding:{rpc:"control_weekly_commitment_check",args:{
      _automation_id:process,_action:"authorize",_expected_revision:7,
      _expected_control:{state:"paused",future_control_at:cutoff}}},review:{authorization:"not_granted_by_review"}});
    expect(f.calls.every(name=>["current_user_tenant_id","weekly_commitment_owner","get_weekly_commitment_checks"].includes(name))).toBe(true);
  });
  it("distinguishes two paused control snapshots even when the definition revision is unchanged",async()=>{
    const first=canonical(),second=canonical();
    Object.assign(first.checks[0],{schedule:{...schedule,future_control_at:"2026-10-23T15:20:10.123456+00:00"}});
    Object.assign(second.checks[0],{schedule:{...schedule,future_control_at:"2026-10-23T15:20:10.123457+00:00"}});
    const a=await prepareWeeklyControlReview(identity,fixture(first),"authorize",target,request);
    const b=await prepareWeeklyControlReview(identity,fixture(second),"authorize",target,request);
    expect(a).toMatchObject({binding:{args:{_expected_revision:7,_expected_control:{future_control_at:"2026-10-23T15:20:10.123456+00:00"}}}});
    expect(b).toMatchObject({binding:{args:{_expected_revision:7,_expected_control:{future_control_at:"2026-10-23T15:20:10.123457+00:00"}}}});
  });
  it("does not prepare authorization for an already scheduled definition",async()=>{
    const data=canonical();data.checks[0].schedule_status="scheduled";
    const result=await prepareWeeklyControlReview(identity,fixture(data),"authorize",target,request);
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("binding");
  });
  it.each([1,2] as const)("carries v%s deadline semantics without private source content",async version=>{
    const data=canonical(),stamp="2026-10-12T13:00:00Z";
    Object.assign(data.checks[0],{last_verified_run:{event_id:request,act_id:actor,correlation_ref:"weekly-source-fixture",scheduled_for:stamp,status:"completed",
      observation:{version,tenant_id:tenant,authorized_by:actor,automation_id:process,event_id:request,act_id:actor,
        correlation_ref:"weekly-source-fixture",receipt_id:request,source:"public.plan_items",observed_at:stamp,schedule_revision:1,
        open_count:2,blocked_count:0,overdue_count:version===2?1:2,due_next_week_count:0,undated_count:0,truncated:false,
        items:[{id:request,kind:"reminder",title:"PRIVATE reminder source",status:"open",priority:"normal",due_at:null,
          ...(version===2?{remind_at:"2099-11-03T15:00:00Z"}:{})}]}}});
    const result=await prepareWeeklyControlReview(identity,fixture(data),"pause",target,request);
    expect(result).toMatchObject({status:"review_ready",review:{last_verified_run:{observation_version:version,
      deadline_scope:version===2?"work_only":"legacy_mixed"},latest_attempt:{status:"unknown"},authorization:"not_granted_by_review"}});
    for(const value of ["PRIVATE reminder source","source_items","remind_at","2099-11-03"])expect(JSON.stringify(result)).not.toContain(value);
  });
  it("prepares exact draft intent against the current business zone without inventing a next run",async()=>{
    const f=fixture(); const r=await prepareWeeklyControlReview(identity,f,"draft",{name:"Weekly commitment check",...schedule},request);
    expect(r).toMatchObject({status:"review_ready",review:{operation:"draft",automation_id:null,revision:null,proposed_schedule:schedule,
      current_schedule:null,current_next_run_at:null,proposed_next_run_at:null,authorization:"not_granted_by_review",execution_availability:"held",scope:"personal_planning_commitments"},
      binding:{rpc:"draft_weekly_commitment_check",args:{_request_id:request,_weekday:1,_local_time:"09:00",_timezone:"America/New_York"}}});
    expect(f.calls.every(x=>["current_user_tenant_id","weekly_commitment_owner","get_weekly_commitment_checks"].includes(x))).toBe(true);
  });
  it("prepares a changed time using the saved raw revision and preserves unknown execution state",async()=>{
    const f=fixture(); const r=await prepareWeeklyControlReview(identity,f,"configure",{...target,...schedule,local_time:"10:30"},request);
    expect(r).toMatchObject({status:"review_ready",review:{automation_id:process,revision:7,current_schedule:schedule,
      proposed_schedule:{...schedule,local_time:"10:30"},current_next_run_at:null,proposed_next_run_at:null,latest_attempt:{status:"unknown"},future_only:true},
      binding:{rpc:"configure_weekly_commitment_check",args:{_automation_id:process,_expected_revision:7,_local_time:"10:30"}}});
  });
  it.each(["authorize","pause","resume","cancel"] as const)("%s reviews the exact saved schedule without approval authority",async operation=>{
    const f=fixture();const r=await prepareWeeklyControlReview(identity,f,operation,target,request);
    expect(r).toMatchObject({status:"review_ready",review:{operation,proposed_schedule:schedule,revision:7,authorization:"not_granted_by_review",execution_availability:"held"},
      binding:{rpc:"control_weekly_commitment_check",args:{_automation_id:process,_action:operation==="resume"?"authorize":operation,_expected_revision:7}}});
    expect(f.calls).not.toEqual(expect.arrayContaining(["control_weekly_commitment_check","record_capability_run"]));
  });
  it("returns fresh changed revision on a subsequent conversation without a memory store",async()=>{
    const a=await prepareWeeklyControlReview(identity,fixture(),"pause",target,request);const changed=canonical();changed.checks[0].revision=8;
    const b=await prepareWeeklyControlReview(identity,fixture(changed),"pause",target,request);
    expect(a).toMatchObject({binding:{args:{_expected_revision:7}}});expect(b).toMatchObject({binding:{args:{_expected_revision:8}}});
  });
  it("keeps the saved actual next instant separate from a changed proposal across the business zone",async()=>{
    const base=canonical();const data={...base,checks:[{...base.checks[0],schedule_status:"scheduled",execution_availability:"ready",
      execution_hold_reason:null,next_run_at:"2026-11-02T14:00:00Z"}]};
    expect(await prepareWeeklyControlReview(identity,fixture(data),"configure",{...target,...schedule,local_time:"10:30"},request)).toMatchObject({
      status:"review_ready",review:{current_next_run_at:"2026-11-02T14:00:00Z",proposed_next_run_at:null,proposed_schedule:{local_time:"10:30"},
        business_time_zone:{state:"configured",zone:"America/New_York"}}});
  });
  it("does not bind altered model input while canonical readback is pending",async()=>{
    const raw={...target,...schedule,local_time:"10:30"};const f=fixture();const rpc=f.caller.rpc;
    f.caller.rpc=async name=>{const result=await rpc(name);if(name==="get_weekly_commitment_checks")raw.local_time="11:30";return result;};
    expect(await prepareWeeklyControlReview(identity,f,"configure",raw,request)).toMatchObject({status:"review_ready",
      review:{proposed_schedule:{local_time:"10:30"},proposed_schedule_validation:"canonical_save_required"},binding:{args:{_local_time:"10:30"}}});
  });
  it.each(["member","admin","platform_operator",null])("refuses %s before reading private process data",async role=>{
    const f=fixture();expect(await prepareWeeklyControlReview({...identity,role},f,"pause",target,request)).toMatchObject({status:"unavailable"});expect(f.calls).toEqual([]);
  });
  it("refuses client persona and unresolved tenant before private reads",async()=>{
    for(const next of [{...identity,actAsClientId:actor},{...identity,tenantId:null}]){const f=fixture();expect(await prepareWeeklyControlReview(next,f,"pause",target,request)).toMatchObject({status:"unavailable"});expect(f.calls).toEqual([]);}
  });
  it.each(["tenant_id","actor_id"])("rejects wrong canonical %s without returning a review",async key=>{
    const data={...canonical(),[key]:process};expect(await prepareWeeklyControlReview(identity,fixture(data),"pause",target,request)).toMatchObject({status:"unavailable"});
  });
  it("revalidates canonical ownership and scope rather than trusting an owner label",async()=>{
    const f=fixture();let owners=0;f.caller.rpc=async name=>({data:name==="current_user_tenant_id"?tenant:name==="weekly_commitment_owner"?++owners===1:canonical(),error:null});
    expect(await prepareWeeklyControlReview(identity,f,"pause",target,request)).toMatchObject({status:"unavailable"});expect(owners).toBe(2);
  });
  it("voids a process read when actor/tenant/epoch changes",async()=>{
    for(const change of [{actorId:tenant},{tenantId:actor},{scopeEpoch:2}]){const f=fixture();const rpc=f.caller.rpc;f.caller.rpc=async name=>{const r=await rpc(name);if(name==="get_weekly_commitment_checks")f.switchIdentity({...identity,...change});return r;};
      expect(await prepareWeeklyControlReview(identity,f,"pause",target,request)).toMatchObject({status:"unavailable"});}
  });
  it("never resolves a target beyond bounded coverage or substitutes another process",async()=>{
    const data=canonical();data.has_more=true;
    expect(await prepareWeeklyControlReview(identity,fixture(data),"pause",{automation_id:request},request)).toMatchObject({status:"unavailable",reason:"target_not_in_bounded_read"});
  });
  it.each(["expected_revision","tenant_id","actor_id","permission","confirm","fingerprint","action"])("rejects model-supplied %s before any read",async field=>{
    const f=fixture();expect(await prepareWeeklyControlReview(identity,f,"pause",{...target,[field]:"forged"},request)).toMatchObject({status:"needs_input"});expect(f.calls).toEqual([]);
  });
  it("refuses malformed data and invalid server request identity without inferring an empty schedule",async()=>{
    expect(await prepareWeeklyControlReview(identity,fixture(null),"pause",target,request)).toMatchObject({status:"unavailable"});
    const f=fixture();expect(await prepareWeeklyControlReview(identity,f,"draft",{name:"Weekly commitment check",...schedule},"invalid")).toMatchObject({status:"unavailable"});expect(f.calls).toEqual([]);
  });
  it("refuses to propose a resumed or changed cancelled definition",async()=>{
    const data=canonical();data.checks[0].schedule_status="cancelled";
    for(const operation of ["resume","authorize","configure"] as WeeklyControlOperation[]){expect(await prepareWeeklyControlReview(identity,fixture(data),operation,
      operation==="configure"?{...target,...schedule}:target,request)).toMatchObject({status:"needs_input",reason:"cancelled_definition"});}
  });
});
