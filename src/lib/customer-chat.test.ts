import {beforeEach,expect,it,vi} from "vitest";
import {readCustomerChat} from "./customer-chat";
import {readClientPortalFrame} from "./client-portal-frame";
const f=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),from:vi.fn(),thread:null as unknown,turns:[] as unknown[],
 error:null as unknown,reads:[] as string[]}));
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
beforeEach(()=>{
 vi.clearAllMocks();f.reads=[];f.error=null;
 f.thread={id:thread,caller_user_id:actor,contact_id:client,tenant_id:tenant,lens:"client"};
 f.turns=[{id:"e0957000-0000-4000-8000-000000000002",role:"assistant",content:"Saved answer"},
  {id:"e0957000-0000-4000-8000-000000000001",role:"user",content:"Saved question"}];
 f.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});
 f.rpc.mockImplementation(async(name:string)=>({data:name==="client_portal_frame"?value():thread,error:null}));
 f.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,
   maybeSingle:async()=>({data:f.thread,error:null}),limit:async()=>({data:f.turns,error:f.error})};return q;});
});
it("reuses native creation and reloads only the canonical customer transcript",async()=>{
 const result=await readCustomerChat(frame());
 expect(result.threadId).toBe(thread);expect(result.messages.map(m=>m.content)).toEqual(["Saved question","Saved answer"]);
 expect(f.rpc).toHaveBeenCalledWith("paige_chat_thread_create",{p_contact_id:null,p_lens:"customer",
   p_title:"Customer conversation",p_consent_snapshot:{audience:"customer_private"}});
 expect(f.reads).toEqual(["paige_chat_threads","paige_chat_turns"]);
});
for(const field of ["caller_user_id","contact_id","tenant_id","lens"])it("refuses a mismatched "+field+" before reading turns",async()=>{
 f.thread={...(f.thread as object),[field]:"foreign"};
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer conversation changed");
 expect(f.reads).toEqual(["paige_chat_threads"]);
});
it("refuses lost or ambiguous native relationship without creating a thread",async()=>{
 f.rpc.mockResolvedValue({data:null,error:null});
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer access changed");
 expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["client_portal_frame"]);
});
it("does not return old history after an Auth actor change",async()=>{
 f.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null})
  .mockResolvedValueOnce({data:{user:{id:"other"}}});
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer session changed");
});
it("does not return old history after native relationship revocation",async()=>{
 let frames=0;f.rpc.mockImplementation(async(name:string)=>({data:name==="client_portal_frame"
   ? (++frames===1?value():null):thread,error:null}));
 await expect(readCustomerChat(frame())).rejects.toThrow("Customer access changed");
});
it("reports unavailable history instead of fabricating an empty conversation",async()=>{
 f.error={code:"08006"};await expect(readCustomerChat(frame())).rejects.toThrow("Conversation history could not be loaded");
});

