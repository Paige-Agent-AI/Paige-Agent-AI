import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {CustomerIdentityProvider,type CustomerIdentityState} from "@/lib/portal/customerIdentity";
import {useClientPortalReleasedWork,type ClientPortalReleasedWorkState} from "./useClientPortalReleasedWork";

const f=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),getUser:vi.fn(),getSession:vi.fn(),reply:vi.fn(),
  native:[] as Array<{name?:string;args:Record<string,unknown>;headers:Record<string,string>;signal?:AbortSignal}>,
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
const contact=(business:string)=>business===a?'e0937600-0000-4000-8000-000000000001':'e0937600-0000-4000-8000-000000000002';
const profile=(business:string)=>({data:{id:contact(business),tenant_id:business,linked_user_id:actor,first_name:'Test',last_name:'Customer',entity_name:null,street_address:null,city:null,state:null,zip_code:null,onboarding_stage:'completed',is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,updated_at:'2026-01-01T00:00:00Z',email:'customer@tests.invalid',phone:null,contact_methods:[]},error:null});
const release=(business:string)=>({release_id:business===a?'e0957600-0000-4000-8000-000000000001':'e0957600-0000-4000-8000-000000000002',submission_id:business===a?'e0967600-0000-4000-8000-000000000001':'e0967600-0000-4000-8000-000000000002',state:'awaiting_client',revision_no:1,artifact_digest:'a'.repeat(64),title:'Approved work '+business,updated_at:'2026-10-20T10:00:00Z'});
const page=(business:string)=>({data:{actor_id:actor,tenant_id:business,releases:[release(business)],has_more:false,unavailable_count:0},error:null});
const pending=<T,>()=>{let resolve!:(value:T)=>void;return {promise:new Promise<T>(r=>{resolve=r;}),resolve:(v:T)=>resolve(v)};};
let root:Root,host:HTMLDivElement,state:ClientPortalReleasedWorkState;
const snapshots:Array<{business:string;ids:string[]}>=[];
function Probe({business,home=false}:{business:string;home?:boolean}){
  state=useClientPortalReleasedWork();
  snapshots.push({business,ids:state.work?.kind==='ready'?state.work.releases.map(i=>i.release_id):[]});return null;
}
const flush=async()=>{for(let i=0;i<160;i++)await Promise.resolve();};
const render=async(business=a,phase:CustomerIdentityState["phase"]="ready",home=false)=>act(async()=>{
  root.render(<CustomerIdentityProvider state={{frame:frame(business),phase}}><Probe business={business} home={home}/></CustomerIdentityProvider>);await flush();
});
beforeEach(()=>{
  vi.clearAllMocks();f.native=[];f.listeners.clear();snapshots.length=0;
  f.getUser.mockResolvedValue(actual());f.getSession.mockResolvedValue({data:{session:{user:{id:actor},access_token:"synthetic-progress-actor"}},error:null});
  f.invoke.mockResolvedValue({data:{ok:true},error:null});
  f.reply.mockImplementation((args:Record<string,unknown>,name:string)=>name==='client_portal_self_profile'?profile(String(args.p_tenant_id??a)):page(String(args.p_expected_tenant_id??a)));
  f.rpc.mockImplementation((_name:string,args:Record<string,unknown>={})=>{
    const headers:Record<string,string>={};let signal:AbortSignal|undefined;
    const q={setHeader:(key:string,value:string)=>{headers[key]=value;return q;},abortSignal:(value:AbortSignal)=>{signal=value;return q;},
      then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{
        f.native.push({name:_name,args,headers:{...headers},signal});return f.reply(args,_name);
      }).then(resolve,reject)};
    return q;
  });
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});



it('the original discovery uses selected B profile and original captured actor',async()=>{
 await render(b);expect(state.work).toMatchObject({kind:'ready',scope:{actorId:actor,tenantId:b,clientId:contact(b)}});
 expect(f.native.every(r=>r.headers.Authorization==='Bearer synthetic-progress-actor'&&r.headers['x-client-portal-business']===b)).toBe(true);
 expect(f.native.filter(r=>r.name==='client_portal_self_profile').every(r=>r.args.p_tenant_id===b)).toBe(true);
 expect(f.native.find(r=>r.name==='operations_delivery_client_reviews_scoped')?.args.p_expected_tenant_id).toBe(b);
});
it('a foreign profile cannot provide a selected review identity',async()=>{
 f.reply.mockImplementation((args,name)=>name==='client_portal_self_profile'?profile(a):page(String(args.p_expected_tenant_id)));await render(b);expect(state.work?.kind).toBe('unavailable');expect(f.native.some(r=>r.name==='operations_delivery_client_reviews_scoped')).toBe(false);
});
it('a different contact at the selected business is refused before discovery',async()=>{
 f.reply.mockImplementation((args,name)=>name==='client_portal_self_profile'?{...profile(b),data:{...profile(b).data,id:contact(a)}}:page(String(args.p_expected_tenant_id)));await render(b);expect(state.work?.kind).toBe('unavailable');
});
it('a late old-business discovery cannot appear on the next business',async()=>{
 const old=pending<ReturnType<typeof page>>();f.reply.mockImplementation((args,name)=>name==='client_portal_self_profile'?profile(String(args.p_tenant_id??a)):args.p_expected_tenant_id===a?old.promise:page(b));await render();await render(b);old.resolve(page(a));await act(flush);expect(state.work).toMatchObject({kind:'ready',scope:{tenantId:b}});expect(snapshots.filter(s=>s.business===b).every(s=>!s.ids.includes(release(a).release_id))).toBe(true);
});
it('retained A to B to A refresh and current guard remain retired',async()=>{
 await render();const refresh=state.refresh,check=state.isCurrent,epoch=state.epoch;await render(b);await render();const count=f.native.length;await act(async()=>{await refresh();await flush();});expect(f.native).toHaveLength(count);expect(check(epoch)).toBe(false);expect(state.isCurrent(state.epoch)).toBe(true);
});
it('a frame recheck hides released work and refuses current callbacks',async()=>{
 await render();const check=state.isCurrent,epoch=state.epoch,count=f.native.length;await render(a,'loading');expect(state.work).toBeNull();expect(check(epoch)).toBe(false);expect(f.native).toHaveLength(count);await render();expect(state.work?.kind).toBe('ready');
});
it('changed cached Auth cannot provide a borrowed native bearer',async()=>{
 f.getSession.mockResolvedValue({data:{session:{user:{id:'other-actor'},access_token:'synthetic-other'}},error:null});await render();expect(f.native).toHaveLength(0);expect(state.work?.kind).toBe('unavailable');
});
it('signed-out customers cannot revive reviews with stale Auth on focus',async()=>{
 await render();const count=f.native.length;await act(async()=>{for(const l of [...f.listeners])l('SIGNED_OUT',null);await flush();});await act(async()=>{await state.refresh();window.dispatchEvent(new Event('focus'));await flush();});expect(f.native).toHaveLength(count);expect(state.work).toBeNull();
});
it('initial Auth rejection finishes recoverably',async()=>{
 f.getUser.mockRejectedValueOnce(Error('Synthetic Auth interruption'));await render();expect(state.reading).toBe(false);expect(state.work?.kind).toBe('unavailable');await act(async()=>{await state.refresh();await flush();});expect(state.work?.kind).toBe('ready');
});
it('hung initial Auth has a bounded retry and no late effect',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const old=pending<ReturnType<typeof actual>>();f.getUser.mockReturnValueOnce(old.promise);await render();await act(async()=>{vi.advanceTimersByTime(20_001);await flush();});expect(state.reading).toBe(false);expect(state.work?.kind).toBe('unavailable');await act(async()=>{await state.refresh();await flush();});old.resolve(actual());await act(flush);expect(state.work?.kind).toBe('ready');
});
it('an actual Auth change during discovery withholds its original records',async()=>{
 f.reply.mockImplementation((args,name)=>{if(name==='client_portal_self_profile')return profile(String(args.p_tenant_id??a));f.getUser.mockResolvedValue({data:{user:{id:'other-actor'}},error:null});return page(String(args.p_expected_tenant_id));});await render();expect(state.work?.kind).not.toBe('ready');
});
it('generic permission denial is unavailable, not absent client work',async()=>{
 f.reply.mockResolvedValue({data:null,error:{code:'42501',message:'permission denied'}});await render();expect(state.work?.kind).toBe('unavailable');
});
