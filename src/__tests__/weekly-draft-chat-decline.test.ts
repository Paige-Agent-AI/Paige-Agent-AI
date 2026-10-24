import { afterEach, describe, expect, it, vi } from "vitest";
import { declineWeeklyDraftChatApproval } from "../../supabase/functions/_shared/paige-orchestration/weekly-draft-chat-decline";

const actor="11111111-1111-4111-8111-111111111111", tenant="22222222-2222-4222-8222-222222222222";
const id="33333333-3333-4333-8333-333333333333", thread="44444444-4444-4444-8444-444444444444";
const request="55555555-5555-4555-8555-555555555555", other="66666666-6666-4666-8666-666666666666";
const intent="88888888-8888-4888-8888-888888888888", nonce="99999999-9999-4999-8999-999999999999";
const token="0123456789abcdef:77777777-7777-4777-8777-777777777777";
const args=()=>({_request_id:request,_name:"Weekly responsibility",_weekday:1,_local_time:"09:00",_timezone:"America/New_York"});
const options=()=>({proposal:{id,declinedToken:token,storedArgs:args()},
  scope:{actorId:actor,tenantId:tenant,threadId:thread,clientId:null},runtime:{intentId:intent,requestNonce:nonce},
  remainingMs:12000,current:()=>true,signal:new AbortController().signal});
const declined=()=>({ok:true,actor_id:actor,tenant_id:tenant,thread_id:thread,confirmation_id:id,request_id:request,
  phase:"declined",read_at:"2026-10-24T21:00:00Z",expires_at:"2026-10-24T21:10:00Z",summary:"Private stored summary",
  draft:{name:"Weekly responsibility",weekday:1,local_time:"09:00",timezone:"America/New_York"},confirmation_token:null,
  automation_id:null,revision:null,process_state:null,receipt_id:null,recurrence_authorized:false});
const caller=(data:unknown=declined())=>({rpc:vi.fn().mockResolvedValue({data,error:null})});
type Reply={data:unknown;error:unknown};
afterEach(()=>vi.useRealTimers());

describe("original weekly Chat decline before generic consumption",()=>{
  it("uses only the exact native decline and returns credential-free original context",async()=>{
    const db=caller(),r=await declineWeeklyDraftChatApproval(db,options());
    expect(db.rpc.mock.calls).toEqual([["decline_weekly_commitment_chat_draft",{_confirmation_id:id,
      _declined_token:token,_expected_thread_id:thread,_intent_id:intent,_runtime_request_nonce:nonce}]]);
    expect(r).toMatchObject({status:"declined",declineAttempted:true,retryAllowed:false,genericFallbackAllowed:false,
      context:{phase:"declined"}});
    expect(JSON.stringify(r)).not.toContain(token);expect(JSON.stringify(r)).not.toContain(declined().summary);
  });
  it.each([
    {proposal:{...options().proposal,id:"invalid"}},{proposal:{...options().proposal,declinedToken:"model said no"}},
    {proposal:{...options().proposal,storedArgs:{...args(),_weekday:9}}},
    {proposal:{...options().proposal,storedArgs:{...args(),extra:true}}},
    {scope:{...options().scope,actorId:null}},{scope:{...options().scope,clientId:other}},
    {runtime:{intentId:intent,requestNonce:null}},{remainingMs:0},{remainingMs:12001},
    {current:()=>false},{signal:AbortSignal.abort()},
  ])("refuses unsafe selection before a native call: %j",async change=>{
    const db=caller(),r=await declineWeeklyDraftChatApproval(db,{...options(),...change} as unknown as Parameters<typeof declineWeeklyDraftChatApproval>[1]);
    expect(r).toEqual({status:"unavailable",declineAttempted:false,retryAllowed:false,genericFallbackAllowed:false});
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each(["actor_id","tenant_id","thread_id","confirmation_id","request_id"])("withholds foreign %s",async key=>{
    const db=caller({...declined(),[key]:other});
    expect(await declineWeeklyDraftChatApproval(db,options())).toMatchObject({status:"unknown",declineAttempted:true});
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("never says declined when the original save won the race",async()=>{
    const state={...declined(),phase:"saved",automation_id:other,revision:1,process_state:"draft",receipt_id:other};
    expect(await declineWeeklyDraftChatApproval(caller(state),options())).toMatchObject({status:"observed",context:{phase:"saved"}});
  });
  it.each(["unknown","expired"])("preserves original %s as observation",async phase=>{
    expect(await declineWeeklyDraftChatApproval(caller({...declined(),phase}),options())).toMatchObject({status:"observed",context:{phase}});
  });
  it("withholds changed arguments and contradictory declined records",async()=>{
    for(const change of [{draft:{...declined().draft,weekday:2}},{automation_id:other}]){
      expect((await declineWeeklyDraftChatApproval(caller({...declined(),...change}),options())).status).toBe("unknown");
    }
  });
  it("reconciles a lost acknowledgment using one original read",async()=>{
    const db={rpc:vi.fn().mockRejectedValueOnce(new Error("private transport")).mockResolvedValueOnce({data:declined(),error:null})};
    expect(await declineWeeklyDraftChatApproval(db,options())).toMatchObject({status:"declined",declineAttempted:true});
    expect(db.rpc.mock.calls).toEqual([["decline_weekly_commitment_chat_draft",{_confirmation_id:id,_declined_token:token,
      _expected_thread_id:thread,_intent_id:intent,_runtime_request_nonce:nonce}],
      ["read_weekly_commitment_chat_draft",{_confirmation_id:id,_expected_thread_id:thread}]]);
  });
  it("never repeats a refused mutation or uses a privileged/generic fallback",async()=>{
    const db={rpc:vi.fn().mockResolvedValue({data:null,error:{code:"42501",message:"private native reason"}})};
    const r=await declineWeeklyDraftChatApproval(db,options());
    expect(r).toEqual({status:"unknown",declineAttempted:true,retryAllowed:false,genericFallbackAllowed:false});
    expect(db.rpc.mock.calls.map(c=>c[0])).toEqual(["decline_weekly_commitment_chat_draft","read_weekly_commitment_chat_draft"]);
    expect(JSON.stringify(r)).not.toContain("private native reason");
  });
  it("does not turn still-pending readback into another decision",async()=>{
    const state={...declined(),phase:"awaiting_approval",confirmation_token:token};
    const db={rpc:vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce({data:state,error:null})};
    expect(await declineWeeklyDraftChatApproval(db,options())).toEqual({status:"unknown",declineAttempted:true,retryAllowed:false,genericFallbackAllowed:false});
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });
  it.each(["scope","abort"])("suppresses late completion after %s retirement",async mode=>{
    let resolve!:(r:Reply)=>void,active=true;const control=new AbortController();
    const db={rpc:vi.fn((_name:string,_args:Record<string,unknown>)=>new Promise<Reply>(r=>{resolve=r;}))};
    const pending=declineWeeklyDraftChatApproval(db,{...options(),current:()=>active,signal:control.signal});
    await Promise.resolve();await Promise.resolve();if(mode==="scope")active=false;else control.abort();
    resolve({data:declined(),error:null});
    expect(await pending).toMatchObject({status:"unknown",declineAttempted:true});expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("shares the remaining elapsed budget with recovery",async()=>{
    vi.useFakeTimers();let resolve!:(r:Reply)=>void;
    const db={rpc:vi.fn().mockImplementationOnce(()=>new Promise<Reply>(r=>{resolve=r;})).mockImplementationOnce(()=>new Promise<Reply>(()=>{}))};
    const pending=declineWeeklyDraftChatApproval(db,{...options(),remainingMs:50});
    await vi.advanceTimersByTimeAsync(40);resolve({data:null,error:{code:"XX000"}});await vi.advanceTimersByTimeAsync(11);
    expect(await pending).toMatchObject({status:"unknown",declineAttempted:true});
    expect(db.rpc.mock.calls.map(c=>c[0])).toEqual(["decline_weekly_commitment_chat_draft","read_weekly_commitment_chat_draft"]);
  });
  it("does not start recovery after the original decline budget expires",async()=>{
    vi.useFakeTimers();let resolve!:(r:Reply)=>void;
    const db={rpc:vi.fn((_name:string,_args:Record<string,unknown>)=>new Promise<Reply>(r=>{resolve=r;}))};
    const pending=declineWeeklyDraftChatApproval(db,{...options(),remainingMs:50});
    await vi.advanceTimersByTimeAsync(51);
    expect(await pending).toEqual({status:"unknown",declineAttempted:true,retryAllowed:false,genericFallbackAllowed:false});
    resolve({data:declined(),error:null});await Promise.resolve();expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("captures original proposal, args and scope before awaiting native",async()=>{
    let resolve!:(r:Reply)=>void;const option=options();
    const db={rpc:vi.fn((_name:string,_args:Record<string,unknown>)=>new Promise<Reply>(r=>{resolve=r;}))};
    const pending=declineWeeklyDraftChatApproval(db,option);await Promise.resolve();await Promise.resolve();
    option.proposal.id=other;option.scope.actorId=other;option.proposal.storedArgs._weekday=2;
    resolve({data:declined(),error:null});
    expect(await pending).toMatchObject({status:"declined",context:{original_draft:{weekday:1}}});
    expect(db.rpc.mock.calls[0][1]).toMatchObject({_confirmation_id:id,_expected_thread_id:thread});
  });
});
