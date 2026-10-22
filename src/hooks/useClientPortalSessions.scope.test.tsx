import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {CustomerIdentityProvider,type CustomerIdentityState} from "@/lib/portal/customerIdentity";
import {useClientPortalSessions,useNextPortalSession,type ClientPortalSessionsState,type NextPortalSession} from "./useClientPortalSessions";

const f=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),getUser:vi.fn(),getSession:vi.fn(),reply:vi.fn(),
  native:[] as Array<{args:Record<string,unknown>;headers:Record<string,string>;signal?:AbortSignal}>,
  listeners:new Set<(event:string,session:{user:{id:string}}|null)=>void>()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args),functions:{invoke:(...args:unknown[])=>f.invoke(...args)},auth:{
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
const page=(business:string)=>({data:{tenant_id:business,server_now:'2026-10-20T10:00:00Z',next_before:null,sessions:[{id:'session-'+business,title:'Coaching session',start_at:'2026-10-25T10:00:00Z',end_at:'2026-10-25T11:00:00Z',timezone:'UTC',status:'scheduled',kind:'single',location:{type:'phone',label:'Phone call',join_url:null},calendar:{slug:'test-practice',duration_min:60,appointment_type_id:null,accent:null},change:{can_cancel:true,can_reschedule:true,deadline:'2026-10-24T10:00:00Z',reason:null}}]},error:null});
const pending=<T,>()=>{let resolve!:(value:T)=>void;return {promise:new Promise<T>(r=>{resolve=r;}),resolve:(v:T)=>resolve(v)};};
let root:Root,host:HTMLDivElement,state:ClientPortalSessionsState,glance:NextPortalSession;
const snapshots:Array<{business:string;ids:string[]}>=[];
function Probe({business,home=false}:{business:string;home?:boolean}){
  state=useClientPortalSessions();glance=useNextPortalSession(home);
  snapshots.push({business,ids:state.upcoming.map(i=>i.id)});return null;
}
const flush=async()=>{for(let i=0;i<70;i++)await Promise.resolve();};
const render=async(business=a,phase:CustomerIdentityState["phase"]="ready",home=false)=>act(async()=>{
  root.render(<CustomerIdentityProvider state={{frame:frame(business),phase}}><Probe business={business} home={home}/></CustomerIdentityProvider>);await flush();
});
beforeEach(()=>{
  vi.clearAllMocks();f.native=[];f.listeners.clear();snapshots.length=0;
  f.getUser.mockResolvedValue(actual());f.getSession.mockResolvedValue({data:{session:{user:{id:actor},access_token:"synthetic-progress-actor"}},error:null});
  f.invoke.mockResolvedValue({data:{ok:true},error:null});
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


it('reads selected B sessions with captured actor and business headers',async()=>{
 await render(b);expect(state.tenantId).toBe(b);expect(state.upcoming[0].id).toBe('session-'+b);
 expect(f.native[0]).toMatchObject({args:{p_tenant_id:b},headers:{Authorization:'Bearer synthetic-progress-actor','x-client-portal-business':b}});
});
it('Home uses a selected-business one-item native read',async()=>{
 await render(b,'ready',true);expect(glance).toMatchObject({state:'session',session:{id:'session-'+b}});
 expect(f.native.find(r=>r.args.p_limit===1)).toMatchObject({args:{p_tenant_id:b},headers:{'x-client-portal-business':b}});
});
it('a foreign page is withheld rather than changing the selected booking business',async()=>{
 f.reply.mockResolvedValue(page(a));await render(b);expect(state.upcoming).toEqual([]);expect(state.tenantId).toBeNull();expect(state.error).toContain("couldn't load");
});
it('late A sessions cannot appear in any B render',async()=>{
 const old=pending<ReturnType<typeof page>>();f.reply.mockImplementation(args=>args.p_tenant_id===a?old.promise:page(b));
 await render(a);await render(b);old.resolve(page(a));await act(flush);
 expect(state.upcoming[0].id).toBe('session-'+b);expect(snapshots.filter(s=>s.business===b).every(s=>!s.ids.includes('session-'+a))).toBe(true);
});
it('a retained old refresh or change cannot dispatch after A to B to A',async()=>{
 await render();const oldRefresh=state.refresh,oldCancel=state.cancel;await render(b);await render();const count=f.native.length;
 await act(async()=>{await oldRefresh();await oldCancel('session-'+a);await flush();});expect(f.native).toHaveLength(count);expect(f.invoke).not.toHaveBeenCalled();
});
it('failed initial Auth is recoverable and Retry rechecks it',async()=>{
 f.getUser.mockRejectedValueOnce(Error('Synthetic Auth interruption'));await render();expect(state.loading).toBe(false);expect(state.error).toContain("couldn't load");
 await act(async()=>{await state.refresh();await flush();});expect(state.error).toBeNull();expect(state.upcoming[0].id).toBe('session-'+a);
});
it('signout cannot be revived by a stale SDK response or focus',async()=>{
 await render();const count=f.native.length;await act(async()=>{for(const l of f.listeners)l('SIGNED_OUT',null);await flush();});
 await act(async()=>{await state.refresh();window.dispatchEvent(new Event('focus'));await flush();});expect(state.upcoming).toEqual([]);expect(f.native).toHaveLength(count);
});
it('hung initial Auth reaches a bounded recoverable read error',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const old=pending<ReturnType<typeof actual>>();f.getUser.mockReturnValueOnce(old.promise);await render();
 await act(async()=>{vi.advanceTimersByTime(20_001);await flush();});expect(state.loading).toBe(false);expect(state.error).toContain("couldn't load");
 await act(async()=>{await state.refresh();await flush();});old.resolve(actual());await act(flush);expect(state.upcoming[0].id).toBe('session-'+a);
});
it('changed cached session cannot borrow another actual customer token',async()=>{
 f.getSession.mockResolvedValue({data:{session:{user:{id:'other-actor'},access_token:'synthetic-other'}},error:null});await render();
 expect(f.native).toHaveLength(0);expect(state.upcoming).toEqual([]);expect(state.error).toContain("couldn't load");
});
it('actual Auth changing after the read removes protected sessions',async()=>{
 await render();f.reply.mockImplementation(args=>{f.getUser.mockResolvedValue({data:{user:{id:'other-actor'}},error:null});return page(String(args.p_tenant_id));});
 await act(async()=>{await state.refresh();await flush();});expect(state.upcoming).toEqual([]);expect(state.tenantId).toBeNull();
});
it('an exact permission refusal is not reported as business ambiguity',async()=>{
 f.reply.mockResolvedValue({data:null,error:{code:'42501',message:'permission denied'}});await render();expect(state.multipleBusinesses).toBe(false);expect(state.error).toContain("couldn't load");
});
it('a frame recheck hides sessions and blocks a retained change until ready',async()=>{
 await render(b,'ready',true);const cancel=state.cancel,count=f.native.length;await render(b,'loading',true);
 expect(state.upcoming).toEqual([]);expect(glance.state).not.toBe('session');await act(async()=>{await cancel('session-'+b);});expect(f.invoke).not.toHaveBeenCalled();expect(f.native).toHaveLength(count);
 await render(b,'ready',true);expect(state.upcoming[0].id).toBe('session-'+b);
});
it('change preflight failure never reaches the booking writer and is not outcome unknown',async()=>{
 await render(b);f.getSession.mockRejectedValueOnce(Error('Synthetic missing session'));await act(async()=>{expect(await state.cancel('session-'+b)).toBe(false);await flush();});
 expect(f.invoke).not.toHaveBeenCalled();expect(state.error).toContain("couldn't check");expect(state.changes['session-'+b]).toMatchObject({status:'failed',error:'CUSTOMER_SESSION_UNVERIFIED'});
});
it('an uncertain booking change retries only the original request and captured actor',async()=>{
 await render(b);f.invoke.mockRejectedValueOnce(Error('Synthetic lost acknowledgment'));
 await act(async()=>{await state.cancel('session-'+b);await flush();});expect(state.changes['session-'+b].status).toBe('unconfirmed');
 const first=f.invoke.mock.calls[0];expect(first[1]).toMatchObject({body:{tenant_id:b,booking_id:'session-'+b},headers:{Authorization:'Bearer synthetic-progress-actor'}});
 await act(async()=>{await state.retryChange('session-'+b);await flush();});expect(f.invoke.mock.calls[1][1].body.request_id).toBe(first[1].body.request_id);
});
it('an in-flight A change cannot report success or refresh B',async()=>{
 await render();const old=pending<{data:{ok:boolean};error:null}>();f.invoke.mockReturnValueOnce(old.promise);let outcome:Promise<boolean>;
 await act(async()=>{outcome=state.cancel('session-'+a);await flush();});await render(b);const count=f.native.length;old.resolve({data:{ok:true},error:null});
 await act(async()=>{expect(await outcome!).toBe(false);await flush();});expect(state.upcoming[0].id).toBe('session-'+b);expect(f.native).toHaveLength(count);expect(state.changes).toEqual({});
});

it('a hung native read aborts without overwriting its explicit retry',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const old=pending<ReturnType<typeof page>>();f.reply.mockReturnValueOnce(old.promise);await render();const signal=f.native[0].signal;
 await act(async()=>{vi.advanceTimersByTime(20_001);await flush();});expect(signal?.aborted).toBe(true);expect(state.loading).toBe(false);
 await act(async()=>{await state.refresh();await flush();});old.resolve(page(b));await act(flush);expect(state.tenantId).toBe(a);
});
it('all past and cursor reads keep the selected business and captured actor',async()=>{
 f.reply.mockImplementation(args=>({...page(String(args.p_tenant_id)),data:{...page(String(args.p_tenant_id)).data,next_before:args.p_before?null:'2026-10-26T10:00:00Z'}}));await render(b);
 await act(async()=>{await state.loadPast();await flush();});await act(async()=>{await state.loadMore('upcoming');await flush();});
 expect(f.native).toHaveLength(3);expect(f.native.every(r=>r.args.p_tenant_id===b&&r.headers.Authorization==='Bearer synthetic-progress-actor')).toBe(true);
 expect(f.native[1].args.p_window).toBe('past');expect(f.native[2].args.p_before).toBeTruthy();
});
it('sign-in A to another actor and back retires the old change callback',async()=>{
 await render();const oldCancel=state.cancel;f.getUser.mockResolvedValue({data:{user:{id:'other-actor'}},error:null});
 await act(async()=>{for(const l of [...f.listeners])l('SIGNED_IN',{user:{id:'other-actor'}});await flush();});expect(state.upcoming).toEqual([]);
 f.getUser.mockResolvedValue(actual());await act(async()=>{for(const l of [...f.listeners])l('SIGNED_IN',{user:{id:actor}});await flush();});
 await act(async()=>{await oldCancel('session-'+a);await flush();});expect(f.invoke).not.toHaveBeenCalled();expect(state.upcoming[0].id).toBe('session-'+a);
});
it('a hung change preflight finishes unsent and late Auth cannot dispatch it',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});await render();const old=pending<Awaited<ReturnType<typeof f.getSession>>>();f.getSession.mockReturnValueOnce(old.promise);let outcome:Promise<boolean>;
 await act(async()=>{outcome=state.cancel('session-'+a);await flush();});await act(async()=>{vi.advanceTimersByTime(20_001);await flush();expect(await outcome!).toBe(false);});
 expect(f.invoke).not.toHaveBeenCalled();expect(state.changes['session-'+a].status).toBe('failed');old.resolve({data:{session:{user:{id:actor},access_token:'synthetic-late'}},error:null});await act(flush);expect(f.invoke).not.toHaveBeenCalled();
});
it('a hung dispatched change becomes recoverable with the original request identity',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});await render();const old=pending<{data:{ok:boolean};error:null}>();f.invoke.mockReturnValueOnce(old.promise);let outcome:Promise<boolean>;
 await act(async()=>{outcome=state.cancel('session-'+a);await flush();});const first=f.invoke.mock.calls[0][1].body.request_id;
 await act(async()=>{vi.advanceTimersByTime(20_001);await flush();expect(await outcome!).toBe(false);});expect(state.changes['session-'+a]).toMatchObject({status:'unconfirmed',requestId:first});
 await act(async()=>{await state.retryChange('session-'+a);await flush();});expect(f.invoke.mock.calls[1][1].body.request_id).toBe(first);old.resolve({data:{ok:true},error:null});await act(flush);expect(f.invoke).toHaveBeenCalledTimes(2);
});
it('a frame recheck releases a stranded send only as unconfirmed, retaining its request',async()=>{
 await render();const old=pending<{data:{ok:boolean};error:null}>();f.invoke.mockReturnValueOnce(old.promise);let outcome:Promise<boolean>;
 await act(async()=>{outcome=state.cancel('session-'+a);await flush();});const first=f.invoke.mock.calls[0][1].body.request_id;await render(a,'loading');old.resolve({data:{ok:true},error:null});await act(async()=>{await outcome!;await flush();});await render();
 expect(state.changes['session-'+a]).toMatchObject({status:'unconfirmed',requestId:first});
});
it('changed actual Auth after a dispatched change never claims success or leaves sending forever',async()=>{
 await render();f.invoke.mockImplementation(()=>{f.getUser.mockResolvedValue({data:{user:{id:'other-actor'}},error:null});return {data:{ok:true},error:null};});
 await act(async()=>{expect(await state.cancel('session-'+a)).toBe(false);await flush();});expect(state.upcoming).toEqual([]);expect(state.error).toContain("couldn't check");expect(state.changes['session-'+a].status).toBe('unconfirmed');
});
it('the real Supabase Functions SDK keeps per-invoke captured Authorization out of other requests',async()=>{
 const {createClient}=await import('@supabase/supabase-js');let token='synthetic-current-a';const seen:Array<{auth:string|null;business:string}>=[];
 const client=createClient('https://tests.invalid','synthetic-public',{accessToken:async()=>token,global:{fetch:async(_url,init)=>{
   seen.push({auth:new Headers(init?.headers).get('Authorization'),business:JSON.parse(String(init?.body)).tenant_id});
   return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
 }}});
 const first=client.functions.invoke('booking-manage',{body:{tenant_id:a},headers:{Authorization:'Bearer synthetic-captured-a'}});token='synthetic-current-b';await first;
 await client.functions.invoke('booking-manage',{body:{tenant_id:b}});
 expect(seen).toEqual([{auth:'Bearer synthetic-captured-a',business:a},{auth:'Bearer synthetic-current-b',business:b}]);
});

it('a newly verified frame actor rechecks actual Auth instead of remaining pinned to the prior actor',async()=>{
 await render();const nextActor='e0917600-0000-4000-8000-000000000002',priorFrame=frame(b) as NonNullable<CustomerIdentityState['frame']>,nextFrame={...priorFrame,actorId:nextActor,profile:{...priorFrame.profile,linked_user_id:nextActor}};
 f.getUser.mockResolvedValue({data:{user:{id:nextActor}},error:null});f.getSession.mockResolvedValue({data:{session:{user:{id:nextActor},access_token:'synthetic-next-actor'}},error:null});
 const consoleError=vi.spyOn(console,'error');
 await act(async()=>{root.render(<CustomerIdentityProvider state={{frame:nextFrame,phase:'ready'}}><Probe business={b}/></CustomerIdentityProvider>);await flush();});
 expect(state.tenantId).toBe(b);expect(state.upcoming[0].id).toBe('session-'+b);expect(f.native.at(-1)?.headers.Authorization).toBe('Bearer synthetic-next-actor');expect(consoleError).not.toHaveBeenCalled();consoleError.mockRestore();
});

it('failed retry preflight preserves a previous uncertain request instead of calling it unsent',async()=>{
 await render();f.invoke.mockRejectedValueOnce(Error('Synthetic lost acknowledgment'));await act(async()=>{await state.cancel('session-'+a);await flush();});const id=state.changes['session-'+a].requestId;
 f.getSession.mockRejectedValueOnce(Error('Synthetic retry Auth interruption'));await act(async()=>{await state.retryChange('session-'+a);await flush();});
 expect(f.invoke).toHaveBeenCalledTimes(1);expect(state.changes['session-'+a]).toMatchObject({status:'unconfirmed',requestId:id,error:null});
 await act(async()=>{await state.retryChange('session-'+a);await flush();});expect(f.invoke.mock.calls[1][1].body.request_id).toBe(id);
});
