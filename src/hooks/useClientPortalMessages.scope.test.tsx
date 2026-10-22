import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {CustomerIdentityProvider,type CustomerIdentityState} from "@/lib/portal/customerIdentity";
import {useClientPortalMessages,type ClientPortalMessagesState} from "./useClientPortalMessages";
const f=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),getSession:vi.fn(),reply:vi.fn(),
 native:[] as Array<{name:string;args:Record<string,unknown>;headers:Record<string,string>}>,listeners:new Set<(event:string,session:{user:{id:string}}|null)=>void>()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args),auth:{
 getUser:(...args:unknown[])=>f.getUser(...args),getSession:()=>f.getSession(),onAuthStateChange:(cb:(event:string,session:{user:{id:string}}|null)=>void)=>{
  f.listeners.add(cb);return {data:{subscription:{unsubscribe:()=>f.listeners.delete(cb)}}};
 }}}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor="e0917500-0000-4000-8000-000000000001",businessA="e0927500-0000-4000-8000-000000000001",businessB="e0927500-0000-4000-8000-000000000002";
const frame=(business=businessA)=>({actorId:actor,profile:{id:business===businessA?"e0937500-0000-4000-8000-000000000001":"e0937500-0000-4000-8000-000000000002",tenant_id:business,linked_user_id:actor},brand:{tenant_name:"Test practice"},config:{}} as never);
const message=(business:string,request_id?:string)=>({id:`message-${business}`,author:"business",kind:"message",body:`Saved ${business}`,created_at:"2026-10-01T10:00:00Z",...(request_id?{request_id,author:"customer"}:{})});
const page=(business:string,request_id?:string)=>({data:{tenant_id:business,messages:[message(business,request_id)],has_more:false},error:null});
const actual=()=>({data:{user:{id:actor}},error:null});
const pending=<T,>()=>{let resolve!:(v:T)=>void;return {promise:new Promise<T>(r=>{resolve=r;}),resolve:(v:T)=>resolve(v)};};
let root:Root,host:HTMLDivElement,state:ClientPortalMessagesState;
const snapshots:Array<{label:string;messages:string[];outbox:string[];epoch:number}>=[];
function Probe({label="one"}:{label?:string}){state=useClientPortalMessages();snapshots.push({label,messages:state.messages.map(m=>m.body),outbox:state.outbox.map(m=>m.body),epoch:state.scopeEpoch});return null;}
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const render=async(business=businessA,phase:CustomerIdentityState["phase"]="ready")=>act(async()=>{
 root.render(<CustomerIdentityProvider state={{frame:frame(business),phase}}><Probe label={business}/></CustomerIdentityProvider>);await flush();
});
beforeEach(()=>{
 vi.clearAllMocks();f.native=[];f.listeners.clear();snapshots.length=0;
 f.getUser.mockResolvedValue(actual());f.getSession.mockResolvedValue({data:{session:{user:{id:actor},access_token:"synthetic-actor-a"}},error:null});
 f.reply.mockImplementation((name:string,args:Record<string,unknown>)=>name==="client_portal_conversation"?page(String(args.p_tenant_id)):{data:{ok:true,message_id:"new-canonical-message",created_at:"2026-10-02T10:00:00Z"},error:null});
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{const headers:Record<string,string>={};const q={
  setHeader:(key:string,value:string)=>{headers[key]=value;return q;},
  then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{f.native.push({name,args,headers:{...headers}});return f.reply(name,args,headers);}).then(resolve,reject),
 };return q;});
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});
it("starts the original conversation in selected B with native business and captured actor headers",async()=>{
 await render(businessB);expect(state.tenantId).toBe(businessB);expect(state.messages[0].body).toBe(`Saved ${businessB}`);
 expect(f.native[0]).toMatchObject({name:"client_portal_conversation",args:{p_tenant_id:businessB},headers:{"x-client-portal-business":businessB,Authorization:"Bearer synthetic-actor-a"}});
});
it("help sends and uncertain retries retain original request identity, business and actor",async()=>{
 await render(businessB);let sends=0;const reply=f.reply.getMockImplementation()!;
 f.reply.mockImplementation((name:string,args:Record<string,unknown>)=>name==="client_portal_send_message"&&++sends===1?Promise.reject(Error("Synthetic lost acknowledgment")):reply(name,args));
 await act(async()=>{await state.send("Question for B","help");await flush();});
 const entry=state.outbox[0];expect(entry.status).toBe("unconfirmed");
 await act(async()=>{await state.retry(entry.localId);await flush();});
 const native=f.native.filter(c=>c.name==="client_portal_send_message");expect(native).toHaveLength(2);
 for(const call of native)expect(call).toMatchObject({args:{p_tenant_id:businessB,p_request_id:entry.requestId,p_kind:"help"},headers:{"x-client-portal-business":businessB,Authorization:"Bearer synthetic-actor-a"}});
 expect(state.outbox).toEqual([]);
});
it("an ignored business hint withholds the foreign page and cannot enable sending",async()=>{
 f.reply.mockResolvedValue(page(businessA));await render(businessB);
 expect(state.messages).toEqual([]);expect(state.tenantId).toBeNull();expect(state.error).toContain("couldn't load");
 await act(async()=>{expect(await state.send("Do not send","message")).toBe(false);});expect(f.native).toHaveLength(1);
});
it("a late A read cannot appear in B, including the first B render before effect cleanup",async()=>{
 const old=pending<ReturnType<typeof page>>();f.reply.mockImplementation((name:string,args:Record<string,unknown>)=>args.p_tenant_id===businessA?old.promise:page(businessB));
 await render(businessA);await render(businessB);old.resolve(page(businessA));await act(flush);
 expect(state.messages.map(m=>m.body)).toEqual([`Saved ${businessB}`]);
 expect(snapshots.filter(s=>s.label===businessB).every(s=>!s.messages.includes(`Saved ${businessA}`))).toBe(true);
});
it("A→B→A never revives a retained old send callback",async()=>{
 await render();const old=state.send;await render(businessB);await render();const count=f.native.length;
 await act(async()=>{expect(await old("Retired intent","message")).toBe(false);});expect(f.native).toHaveLength(count);expect(state.outbox).toEqual([]);
});
it("a changed actual Auth actor cannot borrow its new token for an old customer's send",async()=>{
 await render();f.getUser.mockResolvedValue({data:{user:{id:"changed-actor"}},error:null});const count=f.native.length;
 await act(async()=>{expect(await state.send("Old actor intent","message")).toBe(false);await flush();});
 expect(f.native).toHaveLength(count);expect(state.outbox[0]).toMatchObject({status:"failed",error:"UNVERIFIED_CUSTOMER_SESSION"});
});
it("a changed SDK session after Auth verification cannot dispatch",async()=>{
 await render();f.getSession.mockResolvedValue({data:{session:{user:{id:"changed-actor"},access_token:"synthetic-other"}},error:null});const count=f.native.length;
 await act(async()=>{expect(await state.send("Old actor intent","message")).toBe(false);await flush();});expect(f.native).toHaveLength(count);
});
it("changed Auth after a native read withholds the payload",async()=>{
 f.getUser.mockResolvedValueOnce(actual()).mockResolvedValueOnce(actual()).mockResolvedValueOnce(actual()).mockResolvedValueOnce({data:{user:{id:"changed-actor"}},error:null});
 await render();expect(f.native).toHaveLength(1);expect(state.messages).toEqual([]);expect(state.tenantId).toBeNull();expect(state.error).toContain("couldn't load");
});
it("a cached matching user label cannot authorize another actor's captured bearer",async()=>{
 await render();const count=f.native.length;
 f.getUser.mockImplementation((token?:string)=>Promise.resolve(token?{data:{user:{id:"different-token-subject"}},error:null}:actual()));
 await act(async()=>{expect(await state.send("Must not dispatch","help")).toBe(false);await flush();});
 expect(f.native).toHaveLength(count);
});
it("same-business interruption preserves an uncertain request for canonical reconciliation without resending",async()=>{
 await render();const send=pending<{data:{ok:boolean;message_id:string};error:null}>();const reply=f.reply.getMockImplementation()!;
 f.reply.mockImplementation((name:string,args:Record<string,unknown>)=>name==="client_portal_send_message"?send.promise:reply(name,args));
 let task!:Promise<boolean>;await act(async()=>{task=state.send("Keep original request","help");await flush();});
 const entry=state.outbox[0];await render(businessA,"error");expect(state.outbox[0]).toMatchObject({requestId:entry.requestId,status:"unconfirmed"});
 send.resolve({data:{ok:true,message_id:"saved-original"},error:null});await act(async()=>{await task;await flush();});
 f.reply.mockResolvedValue(page(businessA,entry.requestId));await render();expect(state.outbox).toEqual([]);
 expect(f.native.filter(c=>c.name==="client_portal_send_message")).toHaveLength(1);
});
it("a different business retires an uncertain outbox and its old retry callback",async()=>{
 await render();const reply=f.reply.getMockImplementation()!;f.reply.mockImplementation((name:string,args:Record<string,unknown>)=>name==="client_portal_send_message"?Promise.reject(Error("Synthetic lost acknowledgment")):reply(name,args));
 await act(async()=>{await state.send("Private A draft","message");await flush();});const entry=state.outbox[0],retry=state.retry;
 await render(businessB);const count=f.native.length;await act(async()=>{expect(await retry(entry.localId)).toBe(false);});
 expect(state.outbox).toEqual([]);expect(f.native).toHaveLength(count);expect(snapshots.filter(s=>s.label===businessB).every(s=>s.outbox.length===0)).toBe(true);
});
it("wrong-business pagination never appends rows or authorizes a later send",async()=>{
 f.reply.mockResolvedValue({...page(businessB),data:{...page(businessB).data,has_more:true}});await render(businessB);
 f.reply.mockResolvedValue(page(businessA));await act(async()=>{await state.loadMore();await flush();});
 expect(state.messages.map(m=>m.body)).toEqual([`Saved ${businessB}`]);expect(state.error).toContain("earlier messages");
 const count=f.native.length;await act(async()=>{expect(await state.send("Do not send","message")).toBe(false);});expect(f.native).toHaveLength(count);
});
it("sign-out invalidates retained customer sends before the frame rerenders",async()=>{
 await render();const old=state.send,count=f.native.length;await act(async()=>{for(const listener of f.listeners)listener("SIGNED_OUT",null);await flush();});
 await act(async()=>{expect(await old("Signed-out intent","message")).toBe(false);});expect(f.native).toHaveLength(count);
});
it("an unresolved customer shell never falls back to an unscoped legacy read",async()=>{
 await act(async()=>{root.render(<CustomerIdentityProvider state={{frame:null,phase:"loading"}}><Probe/></CustomerIdentityProvider>);await flush();});
 expect(f.native).toEqual([]);expect(f.getUser).not.toHaveBeenCalled();
});
