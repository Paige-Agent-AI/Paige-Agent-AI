import { describe, expect, it, vi } from "vitest";
import { parseWeeklyDraftState, requestWeeklyDraft, type WeeklyDraftRequest } from "./weekly-draft-command";
import type { WeeklyBrowserScope } from "./weekly-owner-read";
const actor="11111111-1111-4111-8111-111111111111",tenant="22222222-2222-4222-8222-222222222222",id="33333333-3333-4333-8333-333333333333";
const draft={name:"Weekly commitment check",weekday:1,local_time:"09:00",timezone:"America/New_York"};
const raw=()=>({ok:true,tenant_id:tenant,actor_id:actor,phase:"awaiting_approval",confirmation_id:id,request_id:id,
  read_at:"2026-10-14T20:00:00Z",summary:"Save an unapproved draft, not recurring execution.",draft,expires_at:"2026-10-14T20:10:00Z",
  confirmation_token:"0123456789abcdef:"+id,automation_id:null,revision:null,process_state:null,receipt_id:null,recurrence_authorized:false});
const scope:WeeklyBrowserScope={actorId:actor,tenantId:tenant,epoch:1};
function fixture(data:unknown=raw()){
  let current:WeeklyBrowserScope|null=scope,sessionActor=actor;
  const caller={auth:{getSession:vi.fn(async()=>({data:{session:{user:{id:sessionActor}}},error:null}))},
    rpc:vi.fn(async(name:string)=>({data:name==="current_user_tenant_id"?tenant:true,error:null})),
    functions:{invoke:vi.fn(async()=>({data,error:null as unknown}))}};
  return {caller,current:()=>current,change:(v:WeeklyBrowserScope|null)=>{current=v;},session:(v:string)=>{sessionActor=v;}};
}
describe("weekly draft browser projection and request fence",()=>{
  it("projects exact scope and proposal, retaining approval only for the surface",()=>{expect(parseWeeklyDraftState(raw(),scope)).toMatchObject({phase:"awaiting_approval",confirmationId:id,draft,automationId:null,receiptId:null});});
  it.each([{actor_id:tenant},{tenant_id:actor},{confirmation_id:"prefix"},{draft:{...draft,confirm:true}},{revision:1},{confirmation_token:"fingerprint"},{recurrence_authorized:true}])("rejects malformed or mis-scoped readback %j",patch=>{expect(parseWeeklyDraftState({...raw(),...patch},scope)).toBeNull();});
  it("requires a native draft revision and receipt before saying saved",()=>{
    const saved={...raw(),phase:"saved",confirmation_token:null,automation_id:id,revision:1,process_state:"draft",receipt_id:id};
    expect(parseWeeklyDraftState(saved,scope)?.phase).toBe("saved");
    for(const patch of [{receipt_id:null},{process_state:"live"},{revision:2},{confirmation_token:raw().confirmation_token}])expect(parseWeeklyDraftState({...saved,...patch},scope)).toBeNull();
  });
  it("retains unknown and changed native states without inventing recurrence permission",()=>{
    expect(parseWeeklyDraftState({...raw(),phase:"unknown",confirmation_token:null},scope)?.phase).toBe("unknown");
    expect(parseWeeklyDraftState({...raw(),phase:"changed",confirmation_token:null,automation_id:id,revision:3,process_state:"live",recurrence_authorized:null},scope)?.phase).toBe("changed");
  });
  it("calls the one domain adapter with captured workspace and a bounded response wait",async()=>{const f=fixture();expect((await requestWeeklyDraft(scope,f.caller,f.current,{action:"prepare",draft})).kind).toBe("state");expect(f.caller.functions.invoke).toHaveBeenCalledExactlyOnceWith("weekly-commitment-command",{body:{action:"prepare",draft},headers:{"x-paige-expected-tenant":tenant},timeout:15000});expect(f.caller.auth.getSession).toHaveBeenCalledTimes(2);});
  it.each([["INVALID_SCHEDULE","invalid"],["DRAFT_AUTHORITY_HELD","held"]])("fixed %s feedback lets the owner correct the draft without exposing raw errors",async(code,kind)=>{const f=fixture();f.caller.functions.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({ok:false,code,private_detail:"must not render"}),{status:400})}});expect(await requestWeeklyDraft(scope,f.caller,f.current,{action:"prepare",draft})).toEqual({kind});});
  it("an effective client cannot even begin an owner proposal request",async()=>{const f=fixture();expect((await requestWeeklyDraft({...scope,actAsClientId:id},f.caller,f.current,{action:"pending"})).kind).toBe("refused");expect(f.caller.functions.invoke).not.toHaveBeenCalled();});
  it.each(["actor","tenant","epoch","signed_out"])("drops a delayed result after %s change",async kind=>{const f=fixture();f.caller.functions.invoke.mockImplementation(async()=>{f.change(kind==="signed_out"?null:{...scope,...(kind==="actor"?{actorId:tenant}:kind==="tenant"?{tenantId:actor}:{epoch:2})});return {data:raw(),error:null};});expect((await requestWeeklyDraft(scope,f.caller,f.current,{action:"status",confirmation_id:id})).kind).toBe("refused");});
  it("session revocation after invocation clears response authority",async()=>{const f=fixture();f.caller.functions.invoke.mockImplementation(async()=>{f.session(tenant);return {data:raw(),error:null};});expect((await requestWeeklyDraft(scope,f.caller,f.current,{action:"prepare",draft})).kind).toBe("refused");});
  it("lost effect response remains unconfirmed with exactly one invocation",async()=>{const f=fixture();f.caller.functions.invoke.mockResolvedValue({data:null,error:Error("lost")});const r=await requestWeeklyDraft(scope,f.caller,f.current,{action:"commit",confirmation_id:id,approvedConfirmations:[raw().confirmation_token]});expect(r.kind).toBe("unconfirmed");expect(f.caller.functions.invoke).toHaveBeenCalledTimes(1);});
  it("readback never substitutes another proposal or changed schedule",async()=>{for(const request of [{action:"status",confirmation_id:tenant},{action:"prepare",draft:{...draft,local_time:"10:00"}}] as WeeklyDraftRequest[]){const f=fixture();expect((await requestWeeklyDraft(scope,f.caller,f.current,request)).kind).toBe("unavailable");}});
  it("later-session recovery reads the same canonical saved process and receipt",async()=>{const state={...raw(),phase:"saved",confirmation_token:null,automation_id:id,revision:1,process_state:"draft",receipt_id:id};const f=fixture({ok:true,requests:[state],limit:10,has_more:false});expect(await requestWeeklyDraft(scope,f.caller,f.current,{action:"pending"})).toMatchObject({kind:"pending",requests:[{automationId:id,receiptId:id,phase:"saved"}]});});
  it("an invalid pending member fails the entire private projection rather than silently dropping it",async()=>{const f=fixture({ok:true,requests:[raw(),{...raw(),tenant_id:actor}],limit:10,has_more:false});expect((await requestWeeklyDraft(scope,f.caller,f.current,{action:"pending"})).kind).toBe("unavailable");});
});
