import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {readCustomerChat,readCustomerChatOutcome} from "./customer-chat";
import {readClientPortalFrame} from "./client-portal-frame";
const f=vi.hoisted(()=>({getUser:vi.fn(),getSession:vi.fn(),rpc:vi.fn(),from:vi.fn(),thread:null as unknown,turns:[] as unknown[],
 files:[] as unknown[],columns:[] as string[],error:null as unknown,reads:[] as string[],filters:[] as unknown[][],headers:[] as unknown[][],signals:[] as AbortSignal[]}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{
 auth:{getUser:(...a:unknown[])=>f.getUser(...a),getSession:(...a:unknown[])=>f.getSession(...a)},rpc:(...a:unknown[])=>f.rpc(...a),
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
const request=(data:unknown,error:unknown=null,name="rpc")=>{
 const q=Object.assign(Promise.resolve({data,error}),{
  returns:()=>q,
  setHeader:(key:string,v:string)=>{f.headers.push([name,key,v]);return q;},
  abortSignal:(signal:AbortSignal)=>{f.signals.push(signal);return q;},
 });return q;
};
beforeEach(()=>{
 vi.clearAllMocks();f.files=[];f.columns=[];f.reads=[];f.filters=[];f.headers=[];f.signals=[];f.error=null;
 f.thread={id:thread,caller_user_id:actor,contact_id:client,tenant_id:tenant,lens:"client",interactive_latest_intent:null};
 f.turns=[{id:"e0957000-0000-4000-8000-000000000002",role:"assistant",content:"Saved answer"},
  {id:"e0957000-0000-4000-8000-000000000001",role:"user",content:"Saved question"}];
 f.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});
 f.getSession.mockResolvedValue({data:{session:{user:{id:actor},access_token:"synthetic-captured-history"}},error:null});
 f.rpc.mockImplementation((name:string)=>request(name==="client_portal_frame"?value():thread,null,name));
 f.from.mockImplementation((name:string)=>{const q={select:(columns:string)=>{f.columns.push(columns);return q;},returns:()=>q,in:(...args:unknown[])=>{f.filters.push([name,...args]);return q;},then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:f.files,error:null}).then(resolve),eq:(...args:unknown[])=>{f.filters.push([name,...args]);return q;},is:()=>q,order:()=>q,
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
 expect(f.reads).toEqual(["paige_chat_threads","paige_chat_turns","paige_chat_threads"]);
 expect(f.filters).toContainEqual(["audience","eq","customer_private"]);
});
it("reloads only the selected link from the original user receipt without inventing a read result",async()=>{
 f.turns=[{id:"e0957000-0000-4000-8000-000000000001",role:"user",content:"Read this guide",customer_link_url:"https://example.org/guide"},
  {id:"e0957000-0000-4000-8000-000000000002",role:"assistant",content:"Saved answer",customer_link_url:"https://example.org/guide"}];
 const result=await readCustomerChat(frame());
 expect(result.messages[1]).toMatchObject({role:"user",publicLink:"https://example.org/guide"});
 expect(result.messages[0]).not.toHaveProperty("publicLink");
 expect(result.messages[1]).not.toHaveProperty("readStatus");
 expect(f.columns.some(c=>c.includes("customer_link_url:bundle_ref->customer_public_link->>url"))).toBe(true);
 expect(f.reads).toEqual(["paige_chat_threads","paige_chat_turns","paige_chat_threads"]);
});
for(const selected of [{url:"https://example.org/"},"http://example.org/","https://example.org/?private=1","https://EXAMPLE.org/guide"])
 it("refuses malformed or noncanonical saved selection instead of presenting a read: "+JSON.stringify(selected),async()=>{
  f.turns=[{id:"e0957000-0000-4000-8000-000000000001",role:"user",content:"Read this",customer_link_url:selected}];
  await expect(readCustomerChat(frame())).rejects.toThrow("Saved link could not be verified");
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
 expect(f.rpc).not.toHaveBeenCalled();
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
 expect(f.headers.filter(h=>h[1]==="x-client-portal-business")).toEqual([
  ["client_portal_frame","x-client-portal-business",tenant],
  ["paige_chat_thread_create","x-client-portal-business",tenant],
  ["paige_chat_threads","x-client-portal-business",tenant],
  ["paige_chat_turns","x-client-portal-business",tenant],
  ["paige_chat_threads","x-client-portal-business",tenant],
  ["client_portal_frame","x-client-portal-business",tenant],
 ]);
 for(const pair of [["caller_user_id",actor],["contact_id",client],["tenant_id",tenant]])expect(f.filters).toContainEqual(["paige_chat_threads",...pair]);
});
it("retains the original captured binding if a caller mutates the frame while awaiting Auth",async()=>{
 const captured=frame(),pending=readCustomerChat(captured);
 captured.actorId="e0917000-0000-4000-8000-000000000002";captured.profile.tenant_id="e0927000-0000-4000-8000-000000000002";
 const result=await pending;expect(result.threadId).toBe(thread);expect(f.headers.filter(h=>h[1]==="x-client-portal-business").every(h=>h[2]===tenant)).toBe(true);
});
it("a selected second business cannot fall back to an ignored-hint first business frame",async()=>{
 const selected=frame();selected.profile.tenant_id="e0927000-0000-4000-8000-000000000002";
 await expect(readCustomerChat(selected)).rejects.toThrow("Customer access changed");
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["client_portal_frame"]);expect(f.reads).toEqual([]);
});
it("passes the same cancellation signal to all six SDK requests including fresh thread readback",async()=>{
 const controller=new AbortController();
 await readCustomerChat(frame(),controller.signal);
 expect(f.signals).toHaveLength(6);expect(f.signals.every(s=>s===controller.signal)).toBe(true);
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
 f.from.mockImplementation(()=>{const q={select:()=>q,returns:()=>q,eq:()=>q,is:()=>q,filter:()=>q,order:()=>q,
  setHeader:()=>q,abortSignal:()=>q,maybeSingle:async()=>({data:f.thread,error:null}),
  limit:async()=>{controller.abort();return {data:f.turns,error:null};}};return q;});
 await expect(readCustomerChat(frame(),controller.signal)).rejects.toMatchObject({name:"AbortError"});
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["client_portal_frame","paige_chat_thread_create"]);
});
it("final Auth change after loading turns still withholds saved history",async()=>{
 f.getUser.mockImplementation(async(jwt?:string)=>({data:{user:{id:!jwt&&f.reads.includes("paige_chat_turns")?"changed-actor":actor}},error:null}));
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer session changed");
 expect(f.reads).toEqual(["paige_chat_threads","paige_chat_turns","paige_chat_threads"]);
});
it("concurrent authorized A/B history reads keep every request and saved result separate",async()=>{
 const bTenant="e0927000-0000-4000-8000-000000000002",bClient="e0937000-0000-4000-8000-000000000002",bThread="e0947000-0000-4000-8000-000000000002";
 const aValue=value(),bValue=value();bValue.profile.id=bClient;bValue.profile.tenant_id=bTenant;bValue.brand.tenant_id=bTenant;
 const bFrame=readClientPortalFrame(bValue,actor)!;
 f.rpc.mockImplementation((name:string)=>{
  let scope:string|null=null;
  const q={setHeader:(key:string,business:string)=>{if(key==="x-client-portal-business")scope=business;return q;},
   then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve({data:name==="client_portal_frame"
    ?scope===bTenant?bValue:aValue:scope===bTenant?bThread:thread,error:null}).then(resolve,reject)};
  return q;
 });
 f.from.mockImplementation(()=>{
  let scope:string|null=null;
  const q={select:()=>q,returns:()=>q,eq:()=>q,is:()=>q,filter:()=>q,order:()=>q,setHeader:(key:string,business:string)=>{if(key==="x-client-portal-business")scope=business;return q;},
   maybeSingle:async()=>({data:{id:scope===bTenant?bThread:thread,caller_user_id:actor,contact_id:scope===bTenant?bClient:client,
    tenant_id:scope===bTenant?bTenant:tenant,lens:"client",interactive_latest_intent:null},error:null}),
   limit:async()=>({data:[{id:scope===bTenant?"e0957000-0000-4000-8000-000000000003":"e0957000-0000-4000-8000-000000000001",role:"assistant",content:scope===bTenant?"History B":"History A"}],error:null})};
  return q;
 });
 const [a,b]=await Promise.all([readCustomerChat(frame()),readCustomerChat(bFrame)]);
 expect(a).toEqual({threadId:thread,messages:[{id:"e0957000-0000-4000-8000-000000000001",role:"assistant",content:"History A"}]});
 expect(b).toEqual({threadId:bThread,messages:[{id:"e0957000-0000-4000-8000-000000000003",role:"assistant",content:"History B"}]});
});


it("pins the independently verified captured bearer on every original history request",async()=>{
 await readCustomerChat(frame());
 expect(f.getUser).toHaveBeenCalledWith("synthetic-captured-history");
 const auth=f.headers.filter(h=>h[1]==="Authorization");
 expect(auth).toHaveLength(6);expect(auth.every(h=>h[2]==="Bearer synthetic-captured-history")).toBe(true);
});
it("refuses a cached different actor before any native history or thread creation",async()=>{
 f.getSession.mockResolvedValue({data:{session:{user:{id:"other-actor"},access_token:"synthetic-other"}},error:null});
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer session changed");
 expect(f.rpc).not.toHaveBeenCalled();expect(f.reads).toEqual([]);
});
it("refuses a captured bearer rejected by original Auth before opening any private thread",async()=>{
 f.getUser.mockImplementation(async(jwt?:string)=>jwt?{data:{user:null},error:{code:"invalid_token"}}:{data:{user:{id:actor}},error:null});
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer session changed");
 expect(f.rpc).not.toHaveBeenCalled();expect(f.reads).toEqual([]);
});

afterEach(()=>vi.unstubAllGlobals());

const originalStatus=()=>new Response(JSON.stringify({executor_active:false,settled:true}),{headers:{"Content-Type":"application/json"}});
const originalIntent="e0967000-0000-4000-8000-000000000001";
it("reads only original private intent status through the existing control transport",async()=>{
 const sent=vi.fn(async(..._args:unknown[])=>originalStatus());vi.stubGlobal("fetch",sent);const controller=new AbortController();
 expect(await readCustomerChatOutcome(frame(),thread,originalIntent,controller.signal)).toEqual({executor_active:false,settled:true});
 expect(sent).toHaveBeenCalledTimes(1);const init=sent.mock.calls[0][1] as RequestInit,headers=new Headers(init.headers);
 expect(headers.get("Authorization")).toBe("Bearer synthetic-captured-history");expect(headers.get("x-client-portal-business")).toBe(tenant);expect(headers.get("x-paige-chat-control")).toBe("status");
 expect(JSON.parse(String(init.body))).toEqual({threadId:thread,requestIntentId:originalIntent,messages:[{role:"user",content:"Status"}],surfaceContext:{kind:"customer_portal"},interactive:{kind:"status"}});
 expect(init.signal).toBe(controller.signal);expect(f.rpc.mock.calls.every(c=>c[0]==="client_portal_frame")).toBe(true);
 expect(f.reads.every(name=>name==="paige_chat_threads")).toBe(true);expect(f.filters).toContainEqual(["audience","eq","customer_private"]);
});
for(const value of [{}, {executor_active:false,settled:"yes"},{executor_active:true,settled:true}, {executor_active:null,settled:false}])it("refuses malformed or contradictory original status "+JSON.stringify(value),async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(value))));await expect(readCustomerChatOutcome(frame(),thread,originalIntent)).rejects.toThrow("Conversation status could not be checked");
});
it("refuses a foreign private thread before asking its status",async()=>{
 const sent=vi.fn();vi.stubGlobal("fetch",sent);f.thread={...(f.thread as object),contact_id:"foreign"};
 await expect(readCustomerChatOutcome(frame(),thread,originalIntent)).rejects.toThrow("Customer conversation changed");expect(sent).not.toHaveBeenCalled();
});
it("withholds status after the current relationship is revoked",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>{f.rpc.mockReturnValue(request(null));return originalStatus();}));
 await expect(readCustomerChatOutcome(frame(),thread,originalIntent)).rejects.toThrow("Customer access changed");
});
it("withholds status after an Auth change during the original transport",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>{f.getUser.mockResolvedValue({data:{user:{id:"other-actor"}},error:null});return originalStatus();}));
 await expect(readCustomerChatOutcome(frame(),thread,originalIntent)).rejects.toThrow("Customer session changed");
});
it("does not publish a late original status after cancellation",async()=>{
 const controller=new AbortController();vi.stubGlobal("fetch",vi.fn(async()=>{controller.abort();return originalStatus();}));
 await expect(readCustomerChatOutcome(frame(),thread,originalIntent,controller.signal)).rejects.toMatchObject({name:"AbortError"});
});
it("returns the original native latest intent as a recovery reference, never as proof of completion",async()=>{
 f.thread={...(f.thread as object),interactive_latest_intent:originalIntent};const result=await readCustomerChat(frame());
 expect(result.latestRequestIntentId).toBe(originalIntent);expect(result).not.toHaveProperty("settled");
});

it("returns the latest intent observed after the private history read rather than its older snapshot",async()=>{
 const newer="e0967000-0000-4000-8000-000000000002";
 f.thread={...(f.thread as object),interactive_latest_intent:originalIntent};
 const from=f.from.getMockImplementation()!;
 f.from.mockImplementation((name:string)=>{const q=from(name);if(name==="paige_chat_turns"){const limit=q.limit;q.limit=async(...args:unknown[])=>{const result=await limit(...args);f.thread={...(f.thread as object),interactive_latest_intent:newer};return result;};}return q;});
 expect((await readCustomerChat(frame())).latestRequestIntentId).toBe(newer);
});
it("refuses missing native latest-intent evidence instead of treating it as no original request",async()=>{
 const projection={...(f.thread as Record<string,unknown>)};delete projection.interactive_latest_intent;f.thread=projection;
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer conversation changed");
});

const fileId=(n:number)=>"e0997000-0000-4000-8000-"+String(n).padStart(12,"0");
const storedFile=(n:number)=>({id:fileId(n),tenant_id:tenant,contact_id:client,uploaded_by_user_id:actor,
 storage_path:tenant+"/"+client+"/client_upload/"+actor+"/"+fileId(n),original_filename:"Private "+n+".pdf",
 mime_type:"application/pdf",size_bytes:4,visibility:"client_upload",upload_state:"ready",
 created_at:"2026-10-24T10:00:00Z",updated_at:"2026-10-24T10:00:00Z",customer_chat_thread_id:fileId(99)});
function fileHistory(ids:unknown=[fileId(1),fileId(2)]){
 f.turns=[{id:fileId(80),role:"user",content:"Read these",customer_file_ids:ids,request_intent_id:fileId(81)}];
 f.files=[storedFile(2),storedFile(1)];
 f.rpc.mockImplementation((name:string)=>request(name==="client_portal_frame"?value():name==="client_portal_chat_files"
  ?{tenant_id:tenant,client_id:client,files:[],has_more:false}:thread,null,name));
}
it("restores the original ordered private attachments, including an older own origin, without fetching the internal bundle",async()=>{
 fileHistory();const result=await readCustomerChat(frame());
 expect(result.messages[0].files?.map(file=>file.filename)).toEqual(["Private 1.pdf","Private 2.pdf"]);
 expect(result.messages[0].requestIntentId).toBe(fileId(81));
 expect(f.columns.find(c=>c.includes("customer_file_ids"))).toBe("id,role,content,customer_file_ids:bundle_ref->customer_files->file_ids,customer_link_url:bundle_ref->customer_public_link->>url,request_intent_id:bundle_ref->interactive->>request_intent_id");
 expect(f.columns).not.toContain("bundle_ref");expect(f.filters).toContainEqual(["client_files","uploaded_by_user_id",actor]);
});
for(const key of ["tenant_id","contact_id","uploaded_by_user_id","storage_path"])it("withholds saved attachments with foreign "+key,async()=>{
 fileHistory();f.files=[{...storedFile(1),[key]:fileId(101)}];
 await expect(readCustomerChat(frame())).rejects.toThrow();
});
for(const ids of [[fileId(1),fileId(1)],[],["foreign"],Array.from({length:6},(_,n)=>fileId(n+1))])it("rejects an invalid original file manifest before metadata reads "+JSON.stringify(ids),async()=>{
 fileHistory(ids);await expect(readCustomerChat(frame())).rejects.toThrow("Saved attachments could not be verified");expect(f.reads).not.toContain("client_files");
});
it("keeps missing private objects visibly unavailable rather than replacing them with other files",async()=>{
 fileHistory();f.files=[storedFile(2)];const result=await readCustomerChat(frame());expect(result.messages[0].unavailableFiles).toBe(1);expect(result.messages[0].files?.map(file=>file.id)).toEqual([fileId(2)]);
});
it("refuses a lost native private-file gate instead of returning cached names",async()=>{
 fileHistory();f.rpc.mockImplementation((name:string)=>request(name==="client_portal_frame"?value():name==="client_portal_chat_files"?null:thread,null,name));
 await expect(readCustomerChat(frame())).rejects.toThrow("Saved attachments could not be verified");expect(f.reads).not.toContain("client_files");
});
