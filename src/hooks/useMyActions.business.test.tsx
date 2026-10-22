import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {CustomerIdentityProvider,type CustomerIdentityState} from "@/lib/portal/customerIdentity";
import {useMyActions} from "./useMyActions";

const f=vi.hoisted(()=>({getUser:vi.fn(),getSession:vi.fn(),reply:vi.fn(),
  rows:new Map<string,Record<string,unknown>[]>(),native:[] as Array<{name:string;args:Record<string,unknown>|undefined;headers:Record<string,string>;filters:Record<string,unknown>}>,
  listeners:new Set<(event:string,session:{user:{id:string}}|null)=>void>()}));
vi.mock("@/integrations/supabase/client",()=>{
  const query=(name:string,args?:Record<string,unknown>)=>{
    const headers:Record<string,string>={},filters:Record<string,unknown>={};
    const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q;},order:()=>q,limit:()=>q,
      setHeader:(key:string,value:string)=>{headers[key]=value;return q;},
      then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{
        const call={name,args,headers:{...headers},filters:{...filters}};f.native.push(call);return f.reply(call);
      }).then(resolve,reject)};
    return q;
  };
  return {supabase:{rpc:(name:string,args?:Record<string,unknown>)=>query(name,args),from:(name:string)=>query(name),
    auth:{getUser:(...args:unknown[])=>f.getUser(...args),getSession:()=>f.getSession(),
      onAuthStateChange:(cb:(event:string,session:{user:{id:string}}|null)=>void)=>{f.listeners.add(cb);return {data:{subscription:{unsubscribe:()=>f.listeners.delete(cb)}}};}},
    channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:()=>{},
  }};
});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor="e0917700-0000-4000-8000-000000000001",a="e0927700-0000-4000-8000-000000000001",b="e0927700-0000-4000-8000-000000000002";
const contact=(business:string)=>business===a?"e0937700-0000-4000-8000-000000000001":"e0937700-0000-4000-8000-000000000002";
const action=(business:string)=>business===a?"e0947700-0000-4000-8000-000000000001":"e0947700-0000-4000-8000-000000000002";
const profile=(business:string)=>({id:contact(business),tenant_id:business,linked_user_id:actor,first_name:"Test",last_name:"Customer",entity_name:null,street_address:null,city:null,state:null,zip_code:null,onboarding_stage:"completed",is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,updated_at:"2026-01-01T00:00:00Z",email:"customer@tests.invalid",phone:null,contact_methods:[]});
const frame=(business:string)=>({actorId:actor,profile:profile(business),brand:{tenant_name:"Test practice"},config:{}} as never);
const item=(business:string)=>({id:action(business),tenant_id:business,contact_id:contact(business),action_type:"task",title:`Assigned ${business}`,body:"Review your questions",status:"proposed",expires_at:"2099-01-01T00:00:00Z",created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",paige_customer_responses:[]});
const actual=()=>({data:{user:{id:actor}},error:null});
const deferred=<T,>()=>{let resolve!:(v:T)=>void;return {promise:new Promise<T>(r=>{resolve=r;}),resolve:(v:T)=>resolve(v)};};
let root:Root,host:HTMLDivElement,state:ReturnType<typeof useMyActions>;
const snapshots:Array<{business:string;ids:string[]}>=[];
function Probe({business}:{business:string}){state=useMyActions();snapshots.push({business,ids:state.actions.map(row=>row.id)});return null;}
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const render=async(business=a,phase:CustomerIdentityState["phase"]="ready")=>act(async()=>{
  root.render(<CustomerIdentityProvider state={{frame:frame(business),phase}}><Probe business={business}/></CustomerIdentityProvider>);await flush();
});
beforeEach(()=>{
  vi.clearAllMocks();f.native=[];f.rows.clear();f.rows.set(a,[item(a)]);f.rows.set(b,[item(b)]);f.listeners.clear();snapshots.length=0;
  f.getUser.mockResolvedValue(actual());f.getSession.mockResolvedValue({data:{session:{user:{id:actor},access_token:"synthetic-actions-actor"}},error:null});
  f.reply.mockImplementation((call:typeof f.native[number])=>{
    const business=call.headers["x-client-portal-business"]??a;
    if(call.name==="client_portal_self_profile")return {data:profile(business),error:null};
    if(call.name==="paige_customer_actions")return {data:f.rows.get(business),error:null};
    if(call.name==="customer_respond_to_action"){
      const receipt={id:"e0957700-0000-4000-8000-000000000001",responded_by_user_id:actor,response_type:call.args?.p_response_type,response_text:call.args?.p_response_text,created_at:"2026-01-02T00:00:00Z"};
      f.rows.set(business,[{...item(business),updated_at:"2026-01-02T00:00:00Z",status:"customer_acted",paige_customer_responses:[receipt]}]);
      return {data:{ok:true,status:"customer_acted"},error:null};
    }
    throw Error("Unexpected original request");
  });
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});

it("safe profile and original RLS action reads carry selected B and the verified captured actor",async()=>{
  await render(b);expect(state.contactId).toBe(contact(b));expect(state.actions[0].id).toBe(action(b));
  for(const call of f.native)expect(call.headers).toMatchObject({"x-client-portal-business":b,Authorization:"Bearer synthetic-actions-actor"});
  expect(f.native.find(c=>c.name==="paige_customer_actions")?.filters).toEqual({tenant_id:b,contact_id:contact(b)});
});
it("responses keep original version/native writer, business, actual actor and canonical receipt",async()=>{
  await render(b);await act(async()=>{await state.respond(action(b),"completed");await flush();});
  expect(f.native.find(c=>c.name==="customer_respond_to_action")).toMatchObject({args:{p_action_id:action(b),p_expected_updated_at:item(b).updated_at,p_response_type:"completed"},headers:{"x-client-portal-business":b,Authorization:"Bearer synthetic-actions-actor"}});
  expect(state.confirmation).toMatchObject({actionId:action(b),responseId:"e0957700-0000-4000-8000-000000000001"});
});
it("a foreign safe profile is refused before any action-table read",async()=>{
  f.reply.mockResolvedValue({data:profile(a),error:null});await render(b);expect(state.actions).toEqual([]);expect(state.error).toBeTruthy();
  expect(f.native.filter(c=>c.name==="paige_customer_actions")).toHaveLength(0);
});
it("late A reads cannot populate the first B render or replace B's work",async()=>{
  const old=deferred<{data:Record<string,unknown>[];error:null}>(),reply=f.reply.getMockImplementation()!;
  f.reply.mockImplementation(c=>c.name==="paige_customer_actions"&&c.headers["x-client-portal-business"]===a?old.promise:reply(c));
  await render();await render(b);old.resolve({data:[item(a)],error:null});await act(flush);
  expect(state.actions[0].id).toBe(action(b));expect(snapshots.filter(s=>s.business===b).every(s=>!s.ids.includes(action(a)))).toBe(true);
});
it("A→B→A never revives an old response callback",async()=>{
  await render();const old=state.respond;await render(b);await render();const count=f.native.length;
  await act(async()=>{await expect(old(action(a),"completed")).rejects.toThrow();});expect(f.native).toHaveLength(count);
});
it("changed captured SDK session cannot dispatch another actor's response",async()=>{
  await render();f.getSession.mockResolvedValue({data:{session:{user:{id:"other-actor"},access_token:"synthetic-other"}},error:null});
  await act(async()=>{await expect(state.respond(action(a),"completed")).rejects.toThrow();});
  expect(f.native.filter(c=>c.name==="customer_respond_to_action")).toHaveLength(0);expect(state.uncertainActionIds).toEqual([]);
  expect(state.actions).toEqual([]);
});
it("Auth A→B→A retires an old response and permits a freshly verified response",async()=>{
  await render();const old=state.respond;
  f.getUser.mockResolvedValue({data:{user:{id:"other-actor"}},error:null});
  await act(async()=>{for(const l of f.listeners)l("SIGNED_IN",{user:{id:"other-actor"}});await flush();});
  f.getUser.mockResolvedValue(actual());
  await act(async()=>{for(const l of f.listeners)l("SIGNED_IN",{user:{id:actor}});await flush();});
  const count=f.native.length;await act(async()=>{await expect(old(action(a),"completed")).rejects.toThrow();});expect(f.native).toHaveLength(count);
  await act(async()=>{await state.respond(action(a),"completed");await flush();});expect(state.confirmation?.actionId).toBe(action(a));
});
it("selected B never displays a foreign original action row",async()=>{
  f.rows.set(b,[item(a)]);await render(b);expect(state.actions).toEqual([]);expect(state.error).toBeTruthy();
});
it("changed actual Auth after the original table read withholds its result",async()=>{
  const reply=f.reply.getMockImplementation()!;f.reply.mockImplementation(c=>{const result=reply(c);if(c.name==="paige_customer_actions")f.getUser.mockResolvedValue({data:{user:{id:"other-actor"}},error:null});return result;});
  await render();expect(state.actions).toEqual([]);expect(state.actorId).toBeNull();expect(state.error).toBeTruthy();
});
it.each([false,true])("a response interrupted by same-business rechecking reconciles saved=%s without another write",async(saved)=>{
  await render(b);const old=deferred<{data:{ok:boolean};error:null}>(),reply=f.reply.getMockImplementation()!;
  f.reply.mockImplementation(c=>c.name==="customer_respond_to_action"?old.promise:reply(c));
  let result:Promise<unknown>;await act(async()=>{result=state.respond(action(b),"completed").catch(e=>e);await flush();});
  expect(f.native.filter(c=>c.name==="customer_respond_to_action")).toHaveLength(1);
  await render(b,"loading");
  if(saved)reply({name:"customer_respond_to_action",args:{p_response_type:"completed",p_response_text:null},headers:{"x-client-portal-business":b},filters:{}});
  old.resolve({data:{ok:true},error:null});await act(async()=>{await result!;await flush();});
  await render(b);expect(f.native.filter(c=>c.name==="customer_respond_to_action")).toHaveLength(1);
  expect(state.uncertainActionIds).toEqual(saved?[]:[action(b)]);
  expect(!!state.confirmation).toBe(saved);
});
it("rechecking hides old work and prevents new response dispatch",async()=>{
  await render(b);const old=state.respond;await render(b,"loading");const count=f.native.length;
  expect(state.actions).toEqual([]);await act(async()=>{await expect(old(action(b),"completed")).rejects.toThrow();});expect(f.native).toHaveLength(count);
  await render(b);expect(state.actions[0].id).toBe(action(b));
});
it("an uncertain response keeps its original hold and never automatically dispatches again",async()=>{
  await render(b);const reply=f.reply.getMockImplementation()!;
  f.reply.mockImplementation(c=>c.name==="customer_respond_to_action"?Promise.reject(Error("Synthetic lost acknowledgment")):reply(c));
  await act(async()=>{await expect(state.respond(action(b),"completed")).rejects.toThrow(/confirm/);await flush();});
  expect(state.uncertainActionIds).toEqual([action(b)]);const count=f.native.filter(c=>c.name==="customer_respond_to_action").length;
  await act(async()=>{await state.refresh();await expect(state.respond(action(b),"completed")).rejects.toThrow();await flush();});
  expect(f.native.filter(c=>c.name==="customer_respond_to_action")).toHaveLength(count);
});
it("revoked native profile clears actions and refuses a retained response",async()=>{
  await render();const old=state.respond;f.reply.mockResolvedValue({data:null,error:null});
  await act(async()=>{await state.refresh();await flush();});expect(state.actions).toEqual([]);const count=f.native.length;
  await act(async()=>{await expect(old(action(a),"completed")).rejects.toThrow();});expect(f.native).toHaveLength(count);
});
it("sign-out cannot be undone by focus while SDK Auth is still stale",async()=>{
  await render();await act(async()=>{for(const l of f.listeners)l("SIGNED_OUT",null);await flush();});const count=f.native.length;
  expect(state.loading).toBe(false);expect(state.error).toContain("Sign in");
  await act(async()=>{window.dispatchEvent(new Event("focus"));await flush();});expect(state.actions).toEqual([]);expect(f.native).toHaveLength(count);
  await act(async()=>{for(const l of f.listeners)l("SIGNED_IN",{user:{id:actor}});await flush();});expect(state.actions[0].id).toBe(action(a));
});
