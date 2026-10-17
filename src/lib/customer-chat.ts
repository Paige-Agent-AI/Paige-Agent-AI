import {supabase} from "@/integrations/supabase/client";
import {readClientPortalFrame,sameClientPortalFrame,type ClientPortalFrame} from "./client-portal-frame";
export type CustomerChatMessage={id:string;role:"user"|"assistant";content:string};
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Canonical Chat read/create only; turns are written by the existing protected runtime. */
export async function readCustomerChat(frame:ClientPortalFrame):Promise<{threadId:string;messages:CustomerChatMessage[]}>{
 const check=async()=>{
  const identity=await supabase.auth.getUser();
  if(identity.error||identity.data.user?.id!==frame.actorId)throw Error("Customer session changed");
  const result=await supabase.rpc("client_portal_frame" as never);
  const current=!result.error&&readClientPortalFrame(result.data,frame.actorId);
  if(!current||!sameClientPortalFrame(frame,current))throw Error("Customer access changed");
 };
 await check();
 const made=await supabase.rpc("paige_chat_thread_create",{p_contact_id:null,p_lens:"customer",
  p_title:"Customer conversation",p_consent_snapshot:{audience:"customer_private"}});
 if(made.error||!uuid(made.data))throw Error("Conversation could not be opened");
 const threadId=made.data;
 const thread=await supabase.from("paige_chat_threads").select("id,caller_user_id,contact_id,tenant_id,lens")
  // audience is supplied by the reviewed forward migration; retain the same
  // server predicate through the SDK's explicit-column overload until generated types catch up.
  .eq("id",threadId).filter("audience","eq","customer_private").is("studio_session_id",null).maybeSingle();
 if(thread.error||!thread.data||thread.data.caller_user_id!==frame.actorId||thread.data.contact_id!==frame.profile.id||
  thread.data.tenant_id!==frame.profile.tenant_id||thread.data.lens!=="client")throw Error("Customer conversation changed");
 const turns=await supabase.from("paige_chat_turns").select("id,role,content")
  .eq("thread_id",threadId).order("seq",{ascending:false}).limit(100);
 if(turns.error)throw Error("Conversation history could not be loaded");
 const messages:CustomerChatMessage[]=[];
 for(const row of [...(turns.data??[])].reverse()){
  if((row.role==="user"||row.role==="assistant")&&uuid(row.id)&&typeof row.content==="string")
   messages.push({id:row.id,role:row.role,content:row.content});
 }
 await check();
 return {threadId,messages};
}

