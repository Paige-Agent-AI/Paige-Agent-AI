// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createWeeklyDraftCommand } from "../../supabase/functions/_shared/paige-orchestration/weekly-draft-command";

const actor="11111111-1111-4111-8111-111111111111",tenant="22222222-2222-4222-8222-222222222222";
const id="33333333-3333-4333-8333-333333333333",nonce="44444444-4444-4444-8444-444444444444";
const token="0123456789abcdef:55555555-5555-4555-8555-555555555555";
const draft={name:"Weekly commitment check",weekday:1,local_time:"09:00",timezone:"America/New_York"};
const args={_request_id:nonce,_name:draft.name,_weekday:1,_local_time:"09:00",_timezone:draft.timezone};
function fixture(){
  let active=tenant,owner=true,lane="confirm",row:Record<string,unknown>|null=null;
  let state:Record<string,unknown>={ok:true,phase:"awaiting_approval",confirmation_id:id,tenant_id:tenant,actor_id:actor,draft};
  const writes:unknown[]=[];const queries:unknown[][]=[];
  const caller={auth:{getUser:vi.fn(async()=>({data:{user:{id:actor}},error:null}))},rpc:vi.fn(async(name:string,values?:Record<string,unknown>):Promise<{data:unknown;error:unknown}>=>{
    if(name==="current_user_tenant_id")return {data:active,error:null};
    if(name==="weekly_commitment_owner")return {data:owner,error:null};
    if(name==="resolve_tool_autonomy")return {data:lane,error:null};
    if(name==="list_weekly_commitment_drafts")return {data:{ok:true,limit:values?._fingerprint?1:10,has_more:false,requests:row?[{...state,
      ...(row.args?{draft:{name:(row.args as typeof args)._name,weekday:(row.args as typeof args)._weekday,local_time:(row.args as typeof args)._local_time,timezone:(row.args as typeof args)._timezone}}:{})}]:[]},error:null};
    if(name==="read_weekly_commitment_draft")return {data:state,error:null};
    if(name==="claim_weekly_commitment_draft")return {data:{claimed:true,confirmation_id:id,tenant_id:tenant,actor_id:actor,args},error:null};
    if(name==="commit_weekly_commitment_draft")return {data:{...state,phase:"saved"},error:null};
    if(name==="decline_weekly_commitment_draft")return {data:{...state,phase:"declined"},error:null};
    throw Error(`Unexpected RPC ${name} ${JSON.stringify(values)}`);
  })};
  const admin={rpc:vi.fn(async()=>({data:{},error:null})),from:vi.fn((table:string)=>{
    let inserted=false,selection="";const log:unknown[]=[table];queries.push(log);
    const builder={select(value:string){selection=value;log.push(["select",value]);return builder;},
      eq(...v:unknown[]){log.push(["eq",...v]);return builder;},is(...v:unknown[]){log.push(["is",...v]);return builder;},
      not(...v:unknown[]){log.push(["not",...v]);return builder;},order(){return builder;},limit(){return builder;},gt(){return builder;},lte(){return builder;},
      update(value:unknown){writes.push(value);return builder;},insert(value:unknown){inserted=true;writes.push(value);return builder;},
      maybeSingle:async()=>({data:inserted?{id}:row,error:null}),
      then(resolve:(value:unknown)=>void){resolve({data:selection==="id"?row?[{id:row.id}]:[]:null,error:null});}};
    return builder;
  })};
  const handler=createWeeklyDraftCommand({caller:()=>caller,admin:admin as unknown as Parameters<typeof createWeeklyDraftCommand>[0]["admin"],uuid:()=>nonce,now:()=>Date.parse("2026-10-14T20:00:00Z")});
  const send=async(body:unknown,headers:Record<string,string>={})=>{const r=await handler(new Request("https://unit.invalid",{method:"POST",headers:{authorization:"Bearer unit", "x-paige-expected-tenant":tenant,...headers},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
  return {send,handler,caller,admin,writes,queries,setOwner:(v:boolean)=>{owner=v;},setTenant:(v:string)=>{active=v;},setLane:(v:string)=>{lane=v;},setRow:(v:Record<string,unknown>)=>{row=v;},setState:(v:Record<string,unknown>)=>{state={...state,...v};}};
}
describe("weekly draft canonical domain adapter",()=>{
  it("refuses absent credentials before any tenant query",async()=>{const f=fixture();expect((await f.send({action:"pending"},{authorization:""})).status).toBe(401);expect(f.caller.rpc).not.toHaveBeenCalled();});
  it("refuses an old surface address before querying or issuing proposals",async()=>{const f=fixture();f.setTenant(actor);expect((await f.send({action:"prepare",draft})).status).toBe(409);expect(f.admin.from).not.toHaveBeenCalled();});
  it("proves current owner authority rather than trusting headers or route",async()=>{const f=fixture();f.setOwner(false);expect((await f.send({action:"prepare",draft})).status).toBe(403);expect(f.writes).toEqual([]);});
  it.each([{action:"run"},{action:"prepare",draft,tenant_id:tenant},{action:"commit",confirmation_id:id,confirm:true},{action:"status",confirmation_id:"prefix"}])("rejects model/authority/invalid command fields %j",async body=>{const f=fixture();expect((await f.send(body)).status).toBe(400);expect(f.writes).toEqual([]);});
  it("issues exactly one trusted canonical proposal with exact server arguments, not a native definition",async()=>{
    const f=fixture(),r=await f.send({action:"prepare",draft});expect(r.status).toBe(202);
    expect(f.writes).toHaveLength(1);expect(f.writes[0]).toMatchObject({user_id:actor,tenant_id:tenant,tool_name:"weekly_commitment_draft",issued_in_request:nonce,args,thread_id:null,scoped_client_id:null});
    expect((f.writes[0] as {summary:string}).summary).toContain("No recurrence, task changes or provider sends are authorized");
    expect(f.caller.rpc.mock.calls.map(v=>v[0])).not.toContain("commit_weekly_commitment_draft");
    expect(f.admin.rpc).toHaveBeenCalledWith("weekly_commitment_schedule",{_weekday:1,_local_time:"09:00",_timezone:draft.timezone});
  });
  it("keeps required confirmation when Trust allows auto",async()=>{const f=fixture();f.setLane("auto");expect((await f.send({action:"prepare",draft})).status).toBe(202);expect(f.writes).toHaveLength(1);});
  it("off/unknown Trust refuses before issuance or claim",async()=>{for(const lane of ["off","unexpected"]){const f=fixture();f.setLane(lane);expect((await f.send({action:"prepare",draft})).status).toBe(403);expect((await f.send({action:"commit",confirmation_id:id,approvedConfirmations:[token]})).status).toBe(403);expect(f.writes).toEqual([]);expect(f.caller.rpc.mock.calls.map(v=>v[0])).not.toContain("claim_weekly_commitment_draft");}});
  it("adopts a previously saved/unknown proposal without creating a new request",async()=>{for(const phase of ["saved","unknown"]){const f=fixture();f.setRow({id,args,consumed_at:"2026-10-14T20:00:00Z"});f.setState({ok:true,phase,draft,confirmation_id:id});expect((await f.send({action:"prepare",draft})).body.phase).toBe(phase);expect(f.writes).toEqual([]);}});
  it("rejects a mismatched stored call before reusing a fingerprint",async()=>{const f=fixture();f.setRow({id,args:{...args,_local_time:"10:00"}});expect((await f.send({action:"prepare",draft})).status).toBe(409);expect(f.writes).toEqual([]);});
  it("does not turn a failed schedule validator into an approval",async()=>{const f=fixture();f.admin.rpc.mockResolvedValue({data:null,error:{message:"private database error"}});expect((await f.send({action:"prepare",draft})).body.code).toBe("INVALID_SCHEDULE");expect(f.writes).toEqual([]);});
  it("executes only args from the actual atomic claim, through the same Kit",async()=>{
    const f=fixture(),r=await f.send({action:"commit",confirmation_id:id,approvedConfirmations:[token]});expect(r.body.phase).toBe("saved");
    expect(f.caller.rpc).toHaveBeenCalledWith("claim_weekly_commitment_draft",{_confirmation_id:id,_approved_token:token,_request_nonce:nonce});
    expect(f.caller.rpc).toHaveBeenCalledWith("commit_weekly_commitment_draft",{_confirmation_id:id,_request_nonce:nonce,_expected_args:args});
    expect(f.writes).toEqual([]);
  });
  it("never executes after a failed or wrong-scope claim",async()=>{for(const data of [null,{claimed:true,args,actor_id:tenant,tenant_id:tenant,confirmation_id:id}]){const f=fixture(),rpc=f.caller.rpc.getMockImplementation()!;f.caller.rpc.mockImplementation(async(n,a)=>n==="claim_weekly_commitment_draft"?{data,error:null}:rpc(n,a));expect((await f.send({action:"commit",confirmation_id:id,approvedConfirmations:[token]})).status).toBe(503);expect(f.caller.rpc.mock.calls.map(v=>v[0])).not.toContain("commit_weekly_commitment_draft");}});
  it("returns the durable recorded state when an approval was already consumed",async()=>{const f=fixture(),rpc=f.caller.rpc.getMockImplementation()!;f.caller.rpc.mockImplementation(async(n,a)=>n==="claim_weekly_commitment_draft"?{data:{claimed:false,state:{ok:true,phase:"unknown"}},error:null}:rpc(n,a));expect((await f.send({action:"commit",confirmation_id:id,approvedConfirmations:[token]})).body.phase).toBe("unknown");expect(f.caller.rpc.mock.calls.map(v=>v[0])).not.toContain("commit_weekly_commitment_draft");});
  it("after a lost write response performs readback once, never another claim or effect",async()=>{const f=fixture(),rpc=f.caller.rpc.getMockImplementation()!;f.caller.rpc.mockImplementation(async(n,a)=>n==="commit_weekly_commitment_draft"?{data:null,error:{message:"lost response"}}:rpc(n,a));f.setState({ok:true,phase:"saved",confirmation_id:id});expect((await f.send({action:"commit",confirmation_id:id,approvedConfirmations:[token]})).body.phase).toBe("saved");expect(f.caller.rpc.mock.calls.filter(v=>v[0]==="commit_weekly_commitment_draft")).toHaveLength(1);expect(f.caller.rpc.mock.calls.filter(v=>v[0]==="read_weekly_commitment_draft")).toHaveLength(1);});
  it("retains unknown when both write and readback responses are lost",async()=>{const f=fixture(),rpc=f.caller.rpc.getMockImplementation()!;f.caller.rpc.mockImplementation(async(n,a)=>["commit_weekly_commitment_draft","read_weekly_commitment_draft"].includes(n)?{data:null,error:{message:"private network info"}}:rpc(n,a));const r=await f.send({action:"commit",confirmation_id:id,approvedConfirmations:[token]});expect(r.body).toEqual({ok:false,phase:"unknown",confirmation_id:id,code:"SAVE_UNCONFIRMED"});expect(JSON.stringify(r)).not.toContain("private network");});
  it("a mid-flight workspace change prevents effect execution and drops private state",async()=>{const f=fixture(),rpc=f.caller.rpc.getMockImplementation()!;f.caller.rpc.mockImplementation(async(n,a)=>{const r=await rpc(n,a);if(n==="claim_weekly_commitment_draft")f.setTenant(actor);return r;});expect((await f.send({action:"commit",confirmation_id:id,approvedConfirmations:[token]})).body.code).toBe("SCOPE_CHANGED");expect(f.caller.rpc.mock.calls.map(v=>v[0])).not.toContain("commit_weekly_commitment_draft");});
  it("read-only recovery uses the indexed current-owner canonical RPC without any service-role history query",async()=>{const f=fixture();f.setRow({id});expect((await f.send({action:"pending"})).body.requests).toHaveLength(1);expect(f.caller.rpc).toHaveBeenCalledWith("list_weekly_commitment_drafts",{_fingerprint:null});expect(f.admin.from).not.toHaveBeenCalled();expect(f.writes).toEqual([]);});
});
