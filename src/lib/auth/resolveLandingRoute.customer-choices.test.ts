import {beforeEach, describe, expect, it, vi} from "vitest";
const f=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),getUser:vi.fn(),roles:[] as string[],profileCode:"42501",profileMessage:"select an authorized customer relationship",choices:null as unknown,choiceError:null as unknown}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args),from:(...args:unknown[])=>f.from(...args),auth:{getUser:(...args:unknown[])=>f.getUser(...args)}}}));
import {LANDING_ROUTE_RETRY,resolveLandingRoute} from "./resolveLandingRoute";
const actor="e0970100-0000-4000-8000-000000000001";
const other="e0970100-0000-4000-8000-000000000002";
const client=(n:number)=>"e0970300-0000-4000-8000-00000000000"+n;
const business=(n:number)=>"e0970200-0000-4000-8000-00000000000"+n;
const choice=(n:number)=>({client_id:client(n),tenant_id:business(n),business_name:"Test business "+n,logo_url:null,logo_dark_url:null});
const page=()=>({contract_version:1,actor_id:actor,relationships:[choice(1),choice(2)],has_more:false,next_after:null});
beforeEach(()=>{
 vi.clearAllMocks();f.roles=[];f.profileCode="42501";f.profileMessage="select an authorized customer relationship";f.choices=page();f.choiceError=null;
 f.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});
 f.from.mockImplementation((table:string)=>{const reply={data:table==="user_roles"?f.roles.map(role=>({role})):null,error:null};const q:Record<string,unknown>={};for(const method of ["select","eq","limit"])q[method]=()=>q;q.maybeSingle=()=>Promise.resolve(reply);q.then=(resolve:unknown,reject:unknown)=>Promise.resolve(reply).then(resolve as never,reject as never);return q;});
 f.rpc.mockImplementation((name:string)=>{
  const result=name==="client_portal_self_profile"?{data:null,error:{code:f.profileCode,message:f.profileMessage}}:name==="client_portal_relationship_choices"?{data:f.choices,error:f.choiceError}:{data:null,error:null};
  return Object.assign(Promise.resolve(result),{abortSignal:()=>Promise.resolve(result)});
 });
});
describe("ordinary sign-in to original verified customer chooser",()=>{
 it("opens the existing native gate only after two exact-actor business choices and current Auth",async()=>{expect(await resolveLandingRoute(actor)).toBe("/app");expect(f.rpc).toHaveBeenCalledWith("client_portal_relationship_choices",{p_limit:2,p_after:null});expect(f.getUser).toHaveBeenCalledTimes(1);expect(f.rpc.mock.calls.some(([name])=>name==="ensure_client_role_self_heal")).toBe(false);});
 it("uses the first bounded page when more legitimate choices exist",async()=>{f.choices={...page(),has_more:true,next_after:client(2)};expect(await resolveLandingRoute(actor)).toBe("/app");});
 it.each(["super_admin","platform_admin","admin","broker","broker_team_member"])("preserves original %s entry before customer ambiguity",async role=>{f.roles=[role];expect(await resolveLandingRoute(actor)).toBe(role.startsWith("broker")?"/broker/app":"/choose-account");expect(f.rpc.mock.calls.some(([name])=>name==="client_portal_relationship_choices")).toBe(false);});
 it.each(["wrong actor","private field","same business twice","zero choices","single choice","wrong cursor"])("refuses %s instead of inventing chooser access",async kind=>{const p=page();if(kind==="wrong actor")p.actor_id=other;if(kind==="private field")Object.assign(p,{private_notes:"untrusted"});if(kind==="same business twice")p.relationships[1].tenant_id=business(1);if(kind==="zero choices")p.relationships=[];if(kind==="single choice")p.relationships=[choice(1)];if(kind==="wrong cursor"){p.has_more=true;p.next_after=client(1);}f.choices=p;expect(await resolveLandingRoute(actor)).toBe(LANDING_ROUTE_RETRY);});
 it("never substitutes choices for a selected customer-business refusal",async()=>{expect(await resolveLandingRoute(actor,{customerPortal:true,customerBusinessId:business(2)})).toBe(LANDING_ROUTE_RETRY);expect(f.rpc.mock.calls.some(([name])=>name==="client_portal_relationship_choices")).toBe(false);});
 it("preserves unknown profile failure as retry instead of fallback",async()=>{f.profileCode="503";expect(await resolveLandingRoute(actor)).toBe(LANDING_ROUTE_RETRY);expect(f.rpc.mock.calls.some(([name])=>name==="client_portal_relationship_choices")).toBe(false);});
 it("never treats another native permission refusal as a multiple-relationship result",async()=>{f.profileMessage="customer authentication required";expect(await resolveLandingRoute(actor)).toBe(LANDING_ROUTE_RETRY);expect(f.rpc.mock.calls.some(([name])=>name==="client_portal_relationship_choices")).toBe(false);});
 it("refuses native choice failure",async()=>{f.choiceError={code:"42501"};expect(await resolveLandingRoute(actor)).toBe(LANDING_ROUTE_RETRY);});
 it("retires a valid choice list after the actual subject changes",async()=>{f.getUser.mockResolvedValue({data:{user:{id:other}},error:null});expect(await resolveLandingRoute(actor)).toBe(LANDING_ROUTE_RETRY);});
});
