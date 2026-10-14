import { describe, expect, it } from "vitest";
import { prepareWeeklyControlReview } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-review";
import type { ContextIdentity } from "../../supabase/functions/_shared/paige-context/mod";
import type { WeeklyControlOperation } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-input";

const actor="11111111-1111-4111-8111-111111111111", tenant="22222222-2222-4222-8222-222222222222";
const process="33333333-3333-4333-8333-333333333333", request="44444444-4444-4444-8444-444444444444";
const identity: ContextIdentity={actorId:actor,tenantId:tenant,workspaceId:tenant,role:"owner",actAsClientId:null,accountShape:"solo",scopeEpoch:1};
const schedule={weekday:1,local_time:"09:00",timezone:"America/New_York"};
function canonical() { return {ok:true,tenant_id:tenant,actor_id:actor,scope:"personal_planning_commitments",read_at:"2026-10-14T20:00:00Z",limit:50,has_more:false,
  business_time_zone:{state:"configured",zone:"America/New_York"},checks:[{automation_id:process,name:"Weekly commitment check",revision:7,
    schedule_status:"paused",schedule,execution_availability:"held",execution_hold_reason:"paused",next_run_at:null,intended_next_run_at:"2026-10-19T13:00:00Z",
    last_run:{event_id:request,act_id:null,scheduled_for:"2026-10-12T13:00:00Z",status:"unknown"},last_verified_run:null}]}; }
function fixture(data:unknown=canonical()) {
  let current=identity; const calls:string[]=[];
  const caller={rpc:async(name:string)=>{calls.push(name);return {data:name==="current_user_tenant_id"?current.tenantId:name==="weekly_commitment_owner"?true:data,error:null};}};
  return {caller,calls,currentIdentity:()=>current,switchIdentity:(next:ContextIdentity)=>{current=next;}};
}
const target={automation_id:process};

describe("canonical weekly conversation review without approval or execution",()=>{
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
      binding:{rpc:"control_weekly_commitment_check",args:{_automation_id:process,_action:operation,_expected_revision:7}}});
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
