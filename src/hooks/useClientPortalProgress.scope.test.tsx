import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {CustomerIdentityProvider,type CustomerIdentityState} from "@/lib/portal/customerIdentity";
import {useClientPortalProgress,usePortalProgressGlance,type ClientPortalProgressState,type PortalProgressGlance} from "./useClientPortalProgress";

const f=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),getSession:vi.fn(),reply:vi.fn(),
  native:[] as Array<{args:Record<string,unknown>;headers:Record<string,string>;signal?:AbortSignal}>,
  listeners:new Set<(event:string,session:{user:{id:string}}|null)=>void>()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args),auth:{
  getUser:(...args:unknown[])=>f.getUser(...args),getSession:()=>f.getSession(),
  onAuthStateChange:(cb:(event:string,session:{user:{id:string}}|null)=>void)=>{
    f.listeners.add(cb);return {data:{subscription:{unsubscribe:()=>f.listeners.delete(cb)}}};
  },
}}}));

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor="e0917600-0000-4000-8000-000000000001";
const a="e0927600-0000-4000-8000-000000000001",b="e0927600-0000-4000-8000-000000000002";
const actual=()=>({data:{user:{id:actor}},error:null});
const frame=(business=a)=>({actorId:actor,profile:{id:business===a?"e0937600-0000-4000-8000-000000000001":"e0937600-0000-4000-8000-000000000002",tenant_id:business,linked_user_id:actor},brand:{tenant_name:"Test practice"},config:{}} as never);
const page=(business:string)=>({data:{tenant_id:business,server_now:"2026-10-20T10:00:00Z",summary:{shared:1,done:0,open:1,overdue:0},has_more:false,
  items:[{id:`shared-${business}`,kind:"task",title:`Approved work ${business}`,state:"in_progress",due_at:"2026-10-25T10:00:00Z",completed_at:null,shared_at:"2026-10-19T10:00:00Z",parent_id:null}]},error:null});
const pending=<T,>()=>{let resolve!:(value:T)=>void;return {promise:new Promise<T>(r=>{resolve=r;}),resolve:(v:T)=>resolve(v)};};
let root:Root,host:HTMLDivElement,state:ClientPortalProgressState,glance:PortalProgressGlance;
const snapshots:Array<{business:string;ids:string[]}>=[];
function Probe({business,home=false}:{business:string;home?:boolean}){
  state=useClientPortalProgress();glance=usePortalProgressGlance(home);
  snapshots.push({business,ids:state.items.map(i=>i.id)});return null;
}
const flush=async()=>{for(let i=0;i<70;i++)await Promise.resolve();};
const render=async(business=a,phase:CustomerIdentityState["phase"]="ready",home=false)=>act(async()=>{
  root.render(<CustomerIdentityProvider state={{frame:frame(business),phase}}><Probe business={business} home={home}/></CustomerIdentityProvider>);await flush();
});
beforeEach(()=>{
  vi.clearAllMocks();f.native=[];f.listeners.clear();snapshots.length=0;
  f.getUser.mockResolvedValue(actual());f.getSession.mockResolvedValue({data:{session:{user:{id:actor},access_token:"synthetic-progress-actor"}},error:null});
  f.reply.mockImplementation((args:Record<string,unknown>)=>page(String(args.p_tenant_id)));
  f.rpc.mockImplementation((_name:string,args:Record<string,unknown>)=>{
    const headers:Record<string,string>={};let signal:AbortSignal|undefined;
    const q={setHeader:(key:string,value:string)=>{headers[key]=value;return q;},abortSignal:(value:AbortSignal)=>{signal=value;return q;},
      then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{
        f.native.push({args,headers:{...headers},signal});return f.reply(args);
      }).then(resolve,reject)};
    return q;
  });
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});

it("reads original shared progress in selected B with captured actor and business headers",async()=>{
  await render(b);expect(state.tenantId).toBe(b);expect(state.items[0].id).toBe(`shared-${b}`);
  expect(f.native).toHaveLength(1);expect(f.native[0]).toMatchObject({args:{p_tenant_id:b,p_limit:100},headers:{Authorization:"Bearer synthetic-progress-actor","x-client-portal-business":b}});
});
it("Home uses the same bound reader with one-item page and actual server summary",async()=>{
  await render(b,"ready",true);expect(glance).toMatchObject({state:"ready",summary:{shared:1},next:{id:`shared-${b}`}});
  expect(f.native.find(call=>call.args.p_limit===1)).toMatchObject({args:{p_tenant_id:b},headers:{"x-client-portal-business":b,Authorization:"Bearer synthetic-progress-actor"}});
});
it("a foreign native page is withheld rather than becoming selected progress",async()=>{
  f.reply.mockResolvedValue(page(a));await render(b);
  expect(state.items).toEqual([]);expect(state.summary).toBeNull();expect(state.tenantId).toBeNull();expect(state.error).toContain("couldn't load");
});
it("late A rows cannot appear on B, including the first B render before effects",async()=>{
  const old=pending<ReturnType<typeof page>>();f.reply.mockImplementation(args=>args.p_tenant_id===a?old.promise:page(b));
  await render(a);await render(b);old.resolve(page(a));await act(flush);
  expect(state.items[0].id).toBe(`shared-${b}`);expect(snapshots.filter(s=>s.business===b).every(s=>!s.ids.includes(`shared-${a}`))).toBe(true);
});
it("a retained A→B→A refresh cannot revive an old read intent",async()=>{
  await render();const old=state.refresh;await render(b);await render();const count=f.native.length;
  await act(async()=>{await old();await flush();});expect(f.native).toHaveLength(count);
});
it("Auth A→B→A retires old refreshes but permits a new verified returning read",async()=>{
  await render();const old=state.refresh;
  f.getUser.mockResolvedValue({data:{user:{id:"other-actor"}},error:null});
  await act(async()=>{for(const l of f.listeners)l("SIGNED_IN",{user:{id:"other-actor"}});await flush();});
  expect(state.items).toEqual([]);
  f.getUser.mockResolvedValue(actual());await act(async()=>{for(const l of f.listeners)l("SIGNED_IN",{user:{id:actor}});await flush();});
  const count=f.native.length;await act(async()=>{await old();await flush();});expect(f.native).toHaveLength(count);
  await act(async()=>{await state.refresh();await flush();});expect(f.native.length).toBe(count+1);expect(state.items[0].id).toBe(`shared-${a}`);
});
it("failed initial Auth finishes with recoverable error and Retry rechecks ordinary Auth",async()=>{
  f.getUser.mockRejectedValueOnce(Error("Synthetic Auth interruption"));await render();
  expect(state.loading).toBe(false);expect(state.items).toEqual([]);expect(state.error).toContain("couldn't load");
  await act(async()=>{await state.refresh();await flush();});expect(state.error).toBeNull();expect(state.items[0].id).toBe(`shared-${a}`);
});
it("signing out cannot revive work through a still-stale SDK Auth response",async()=>{
  await render();const count=f.native.length;
  await act(async()=>{for(const l of f.listeners)l("SIGNED_OUT",null);await flush();});
  expect(state.items).toEqual([]);expect(state.unavailable).toBe(true);expect(f.native).toHaveLength(count);
  await act(async()=>{await state.refresh();await flush();});expect(f.native).toHaveLength(count);
  await act(async()=>{for(const l of f.listeners)l("SIGNED_IN",{user:{id:actor}});await flush();});
  expect(state.items[0].id).toBe(`shared-${a}`);
});
it("hung initial Auth times out and its late result cannot replace a recovered read",async()=>{
  vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});const old=pending<ReturnType<typeof actual>>();f.getUser.mockReturnValueOnce(old.promise);
  await render();expect(state.loading).toBe(true);
  await act(async()=>{vi.advanceTimersByTime(20_001);await flush();});expect(state.loading).toBe(false);expect(state.error).toContain("couldn't load");
  await act(async()=>{await state.refresh();await flush();});old.resolve({data:{user:{id:"other-actor"}},error:null});await act(flush);
  expect(state.error).toBeNull();expect(state.items[0].id).toBe(`shared-${a}`);
});
it("hung native read times out, aborts and cannot overwrite the explicit retry",async()=>{
  vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});const old=pending<ReturnType<typeof page>>();f.reply.mockReturnValueOnce(old.promise);await render();
  const signal=f.native[0].signal;await act(async()=>{vi.advanceTimersByTime(20_001);await flush();});expect(signal?.aborted).toBe(true);expect(state.loading).toBe(false);
  await act(async()=>{await state.refresh();await flush();});old.resolve(page(b));await act(flush);expect(state.items[0].id).toBe(`shared-${a}`);
});
it("changed SDK session cannot borrow another actor's token for selected progress",async()=>{
  f.getSession.mockResolvedValue({data:{session:{user:{id:"other-actor"},access_token:"synthetic-other"}},error:null});await render();
  expect(f.native).toHaveLength(0);expect(state.items).toEqual([]);expect(state.error).toContain("couldn't load");
});
it("actual Auth changed after native read withholds previously visible progress",async()=>{
  await render();f.reply.mockImplementation(args=>{f.getUser.mockResolvedValue({data:{user:{id:"other-actor"}},error:null});return page(String(args.p_tenant_id));});
  await act(async()=>{await state.refresh();await flush();});expect(state.items).toEqual([]);expect(state.summary).toBeNull();expect(state.error).toContain("couldn't load");
});
it("failed actual Auth postcheck withholds old work rather than claiming a stale authorized view",async()=>{
  await render();f.reply.mockImplementation(args=>{f.getUser.mockRejectedValue(Error("Synthetic Auth postcheck interruption"));return page(String(args.p_tenant_id));});
  await act(async()=>{await state.refresh();await flush();});expect(state.items).toEqual([]);expect(state.error).toContain("couldn't load");
});
it("a scoped refresh failure clears protected rows without fabricating zero progress",async()=>{
  await render();f.reply.mockResolvedValue({data:null,error:{code:"PGRST000",message:"Synthetic lost read"}});
  await act(async()=>{await state.refresh();await flush();});expect(state.items).toEqual([]);expect(state.summary).toBeNull();expect(state.error).toContain("couldn't load");
});
it("rechecking phase hides progress and Home summary without reading another scope",async()=>{
  await render(b,"ready",true);const count=f.native.length;await render(b,"loading",true);
  expect(state.items).toEqual([]);expect(glance).not.toMatchObject({state:"ready"});expect(f.native).toHaveLength(count);
  await render(b,"ready",true);expect(state.items[0].id).toBe(`shared-${b}`);
});
it("permission refusals are not mislabeled as multiple-business choice; null clears revoked work",async()=>{
  f.reply.mockResolvedValue({data:null,error:{code:"42501",message:"permission denied"}});await render();
  expect(state.multipleBusinesses).toBe(false);expect(state.error).toContain("couldn't load");
  f.reply.mockResolvedValue(page(a));await act(async()=>{await state.refresh();await flush();});expect(state.items).toHaveLength(1);
  f.reply.mockResolvedValue({data:null,error:null});await act(async()=>{await state.refresh();await flush();});
  expect(state.items).toEqual([]);expect(state.summary).toBeNull();expect(state.tenantId).toBeNull();expect(state.unavailable).toBe(true);
});
