import {beforeEach,expect,it,vi} from "vitest";
import {readCustomerChat} from "./customer-chat";
import {readClientPortalFrame} from "./client-portal-frame";
const f=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),from:vi.fn(),thread:null as unknown,turns:[] as unknown[],
 error:null as unknown,reads:[] as string[],filters:[] as unknown[][],headers:[] as unknown[][],signals:[] as AbortSignal[]}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{
 auth:{getUser:(...a:unknown[])=>f.getUser(...a)},rpc:(...a:unknown[])=>f.rpc(...a),
 from:(name:string)=>{f.reads.push(name);return f.from(name);},
}}));
const actor="e0917000-0000-4000-8000-000000000001",client="e0937000-0000-4000-8000-000000000001",
 tenant="e0927000-0000-4000-8000-000000000001",thread="e0947000-0000-4000-8000-000000000001";
const value=()=>({actor_id:actor,profile:{id:client,tenant_id:tenant,linked_user_id:actor,
 first_name:"Jordan",last_name:"Test",entity_name:null,street_address:null,city:null,state:null,zip_code:null,
 onboarding_stage:"completed",is_signup_contact:false,paige_shared_context_consent:false,
 paige_shared_context_consent_updated_at:null,updated_at:null,email:null,phone:null,contact_methods:[]},
 brand:{tenant_id:tenant,tenant_name:"Test practice",tenant_slug:"test-practice",logo_url:null,primary_color:null,support_email:null},config:{}});
const frame=()=>readClientPortalFrame(value(),actor)!;
const request=(data:unknown,error:unknown=null,name="rpc")=>Object.assign(Promise.resolve({data,error}),{
 setHeader:(key:string,business:string)=>{f.headers.push([name,key,business]);return Promise.resolve({data,error});},
 abortSignal:(signal:AbortSignal)=>{f.signals.push(signal);return request(data,error,name);},
});
beforeEach(()=>{
 vi.clearAllMocks();f.reads=[];f.filters=[];f.headers=[];f.signals=[];f.error=null;
 f.thread={id:thread,caller_user_id:actor,contact_id:client,tenant_id:tenant,lens:"client"};
 f.turns=[{id:"e0957000-0000-4000-8000-000000000002",role:"assistant",content:"Saved answer"},
  {id:"e0957000-0000-4000-8000-000000000001",role:"user",content:"Saved question"}];
 f.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});
 f.rpc.mockImplementation((name:string)=>request(name==="client_portal_frame"?value():thread,null,name));
 f.from.mockImplementation((name:string)=>{const q={select:()=>q,eq:(...args:unknown[])=>{f.filters.push([name,...args]);return q;},is:()=>q,order:()=>q,
   setHeader:(key:string,business:string)=>{f.headers.push([name,key,business]);return q;},
   abortSignal:(signal:AbortSignal)=>{f.signals.push(signal);return q;},
   filter:(...args:unknown[])=>{f.filters.push(args);return q;},
   maybeSingle:async()=>({data:f.thread,error:null}),limit:async()=>({data:f.turns,error:f.error})};return q;});
});
it("reuses native creation and reloads only the canonical customer transcript",async()=>{
 const result=await readCustomerChat(frame());
 expect(result.threadId).toBe(thread);expect(result.messages.map(m=>m.content)).toEqual(["Saved question","Saved answer"]);
 expect(f.rpc).toHaveBeenCalledWith("paige_chat_thread_create",{p_contact_id:null,p_lens:"customer",
   p_title:"Customer conversation",p_consent_snapshot:{audience:"customer_private"}});
 expect(f.reads).toEqual(["paige_chat_threads","paige_chat_turns"]);
 expect(f.filters).toContainEqual(["audience","eq","customer_private"]);
});
for(const field of ["caller_user_id","contact_id","tenant_id","lens"])it("refuses a mismatched "+field+" before reading turns",async()=>{
 f.thread={...(f.thread as object),[field]:"foreign"};
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer conversation changed");
 expect(f.reads).toEqual(["paige_chat_threads"]);
});
it("refuses lost or ambiguous native relationship without creating a thread",async()=>{
 f.rpc.mockReturnValue(request(null));
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer access changed");
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["client_portal_frame"]);
});
it("does not return old history after an Auth actor change",async()=>{
 f.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null})
  .mockResolvedValueOnce({data:{user:{id:"other"}}});
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer session changed");
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["client_portal_frame"]);
});
it("does not return old history after native relationship revocation",async()=>{
 let frames=0;f.rpc.mockImplementation((name:string)=>request(name==="client_portal_frame"
   ? (++frames===1?value():null):thread,null,name));
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer access changed");
});
it("reports unavailable history instead of fabricating an empty conversation",async()=>{
 f.error={code:"08006"};await expect(readCustomerChat(frame())).rejects.toThrow("Conversation history could not be loaded");
});
it("binds every native/private-history request to the same captured business",async()=>{
 await readCustomerChat(frame());
 expect(f.headers).toEqual([
  ["client_portal_frame","x-client-portal-business",tenant],
  ["paige_chat_thread_create","x-client-portal-business",tenant],
  ["paige_chat_threads","x-client-portal-business",tenant],
  ["paige_chat_turns","x-client-portal-business",tenant],
  ["client_portal_frame","x-client-portal-business",tenant],
 ]);
 for(const pair of [["caller_user_id",actor],["contact_id",client],["tenant_id",tenant]])expect(f.filters).toContainEqual(["paige_chat_threads",...pair]);
});
it("retains the original captured binding if a caller mutates the frame while awaiting Auth",async()=>{
 const captured=frame(),pending=readCustomerChat(captured);
 captured.actorId="e0917000-0000-4000-8000-000000000002";captured.profile.tenant_id="e0927000-0000-4000-8000-000000000002";
 const result=await pending;expect(result.threadId).toBe(thread);expect(f.headers.every(h=>h[2]===tenant)).toBe(true);
});
it("a selected second business cannot fall back to an ignored-hint first business frame",async()=>{
 const selected=frame();selected.profile.tenant_id="e0927000-0000-4000-8000-000000000002";
 await expect(readCustomerChat(selected)).rejects.toThrow("Customer access changed");
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["client_portal_frame"]);expect(f.reads).toEqual([]);
});
it("passes the same cancellation signal to all five original SDK requests",async()=>{
 const controller=new AbortController();
 await readCustomerChat(frame(),controller.signal);
 expect(f.signals).toHaveLength(5);expect(f.signals.every(s=>s===controller.signal)).toBe(true);
});
it("canceled-before-start history performs no Auth or native request",async()=>{
 const controller=new AbortController();controller.abort();
 await expect(readCustomerChat(frame(),controller.signal)).rejects.toMatchObject({name:"AbortError"});
 expect(f.getUser).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
});
it("late Auth completion after cancellation cannot open a conversation",async()=>{
 const controller=new AbortController();let resolve!:(v:unknown)=>void;
 f.getUser.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
 const task=readCustomerChat(frame(),controller.signal);
 const rejected=expect(task).rejects.toMatchObject({name:"AbortError"});
 controller.abort();resolve({data:{user:{id:actor}},error:null});await rejected;
 expect(f.rpc).not.toHaveBeenCalled();
});
it("cancellation during a saved-turn read withholds history and prevents further native calls",async()=>{
 const controller=new AbortController();
 f.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,is:()=>q,filter:()=>q,order:()=>q,
  setHeader:()=>q,abortSignal:()=>q,maybeSingle:async()=>({data:f.thread,error:null}),
  limit:async()=>{controller.abort();return {data:f.turns,error:null};}};return q;});
 await expect(readCustomerChat(frame(),controller.signal)).rejects.toMatchObject({name:"AbortError"});
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["client_portal_frame","paige_chat_thread_create"]);
});
it("final Auth change after loading turns still withholds saved history",async()=>{
 f.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null})
  .mockResolvedValueOnce({data:{user:{id:actor}},error:null})
  .mockResolvedValueOnce({data:{user:{id:actor}},error:null})
  .mockResolvedValueOnce({data:{user:{id:"changed-actor"}},error:null});
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer session changed");
 expect(f.reads).toEqual(["paige_chat_threads","paige_chat_turns"]);
});
it("concurrent authorized A/B history reads keep every request and saved result separate",async()=>{
 const bTenant="e0927000-0000-4000-8000-000000000002",bClient="e0937000-0000-4000-8000-000000000002",bThread="e0947000-0000-4000-8000-000000000002";
 const aValue=value(),bValue=value();bValue.profile.id=bClient;bValue.profile.tenant_id=bTenant;bValue.brand.tenant_id=bTenant;
 const bFrame=readClientPortalFrame(bValue,actor)!;
 f.rpc.mockImplementation((name:string)=>{
  let scope:string|null=null;
  const q={setHeader:(_key:string,business:string)=>{scope=business;return q;},
   then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve({data:name==="client_portal_frame"
    ?scope===bTenant?bValue:aValue:scope===bTenant?bThread:thread,error:null}).then(resolve,reject)};
  return q;
 });
 f.from.mockImplementation(()=>{
  let scope:string|null=null;
  const q={select:()=>q,eq:()=>q,is:()=>q,filter:()=>q,order:()=>q,setHeader:(_key:string,business:string)=>{scope=business;return q;},
   maybeSingle:async()=>({data:{id:scope===bTenant?bThread:thread,caller_user_id:actor,contact_id:scope===bTenant?bClient:client,
    tenant_id:scope===bTenant?bTenant:tenant,lens:"client"},error:null}),
   limit:async()=>({data:[{id:scope===bTenant?"e0957000-0000-4000-8000-000000000003":"e0957000-0000-4000-8000-000000000001",role:"assistant",content:scope===bTenant?"History B":"History A"}],error:null})};
  return q;
 });
 const [a,b]=await Promise.all([readCustomerChat(frame()),readCustomerChat(bFrame)]);
 expect(a).toEqual({threadId:thread,messages:[{id:"e0957000-0000-4000-8000-000000000001",role:"assistant",content:"History A"}]});
 expect(b).toEqual({threadId:bThread,messages:[{id:"e0957000-0000-4000-8000-000000000003",role:"assistant",content:"History B"}]});
});

