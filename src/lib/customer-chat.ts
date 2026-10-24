import {supabase} from "@/integrations/supabase/client";
import {readClientPortalFrame,sameClientPortalFrame,type ClientPortalFrame} from "./client-portal-frame";
import {captureClientPortalAuthorization,withClientPortalBusiness} from "./client-portal-scope";
type CustomerThreadProjection={id:unknown;caller_user_id:unknown;contact_id:unknown;tenant_id:unknown;lens:unknown;interactive_latest_intent:unknown};
export type CustomerChatMessage={id:string;role:"user"|"assistant";content:string};
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Canonical Chat read/create only; turns are written by the existing protected runtime. */
async function customerChatScope(frame:ClientPortalFrame,signal?:AbortSignal){
 const captured={...frame,profile:{...frame.profile}};
 const business=captured.profile.tenant_id;
 const current=()=>{if(signal?.aborted)throw new DOMException("Conversation read canceled","AbortError");};
 const authorization=await captureClientPortalAuthorization(supabase.auth,captured.actorId,()=>{current();return true;});
 const request=<T extends {abortSignal(signal:AbortSignal):T;setHeader(name:string,value:string):T}>(query:T)=>{
  current();
  return withClientPortalBusiness(signal?query.abortSignal(signal):query,business).setHeader("Authorization",authorization);
 };
 const check=async()=>{
  current();
  const identity=await supabase.auth.getUser();
  current();
  if(identity.error||identity.data.user?.id!==captured.actorId)throw Error("Customer session changed");
  const result=await request(supabase.rpc("client_portal_frame" as never));
  current();
  const checked=!result.error&&readClientPortalFrame(result.data,captured.actorId);
  if(!checked||!sameClientPortalFrame(captured,checked))throw Error("Customer access changed");
  const final=await supabase.auth.getUser();
  current();
  if(final.error||final.data.user?.id!==captured.actorId)throw Error("Customer session changed");
 };
 return {captured,business,current,authorization,request,check};
}

/** Original native customer thread and its private RLS projection, never browser role authority. */
async function readCustomerThread(scope:Awaited<ReturnType<typeof customerChatScope>>,threadId:string){
 const {captured,business,current,request}=scope;
 current();
 const thread=await request(supabase.from("paige_chat_threads").select("id,caller_user_id,contact_id,tenant_id,lens,interactive_latest_intent")
  // audience is supplied by the reviewed forward migration; retain the same
  // server predicate through the SDK's explicit-column overload until generated types catch up.
  .eq("id",threadId).eq("caller_user_id",captured.actorId).eq("contact_id",captured.profile.id).eq("tenant_id",business)
  .filter("audience","eq","customer_private").is("studio_session_id",null).returns<CustomerThreadProjection[]>()).maybeSingle();
 current();
 if(thread.error||!thread.data||thread.data.id!==threadId||thread.data.caller_user_id!==captured.actorId||thread.data.contact_id!==captured.profile.id||
  thread.data.tenant_id!==business||thread.data.lens!=="client")throw Error("Customer conversation changed");
 if(!Object.prototype.hasOwnProperty.call(thread.data,"interactive_latest_intent")||
  (thread.data.interactive_latest_intent!==null&&!uuid(thread.data.interactive_latest_intent)))throw Error("Customer conversation changed");
 return thread.data;
}

export async function readCustomerChat(frame:ClientPortalFrame,signal?:AbortSignal):Promise<{threadId:string;messages:CustomerChatMessage[];latestRequestIntentId?:string}>{
 const scope=await customerChatScope(frame,signal);
 const {current,request,check}=scope;
 await check();
 const made=await request(supabase.rpc("paige_chat_thread_create",{p_contact_id:null,p_lens:"customer",
  p_title:"Customer conversation",p_consent_snapshot:{audience:"customer_private"}}));
 current();
 if(made.error||!uuid(made.data))throw Error("Conversation could not be opened");
 const threadId=made.data;
 await readCustomerThread(scope,threadId);
 const turns=await request(supabase.from("paige_chat_turns").select("id,role,content")
  .eq("thread_id",threadId).order("seq",{ascending:false})).limit(100);
 current();
 if(turns.error)throw Error("Conversation history could not be loaded");
 const messages:CustomerChatMessage[]=[];
 for(const row of [...(turns.data??[])].reverse()){
  if((row.role==="user"||row.role==="assistant")&&uuid(row.id)&&typeof row.content==="string")
   messages.push({id:row.id,role:row.role,content:row.content});
 }
 const latestThread=await readCustomerThread(scope,threadId);
 await check();
 const latest=latestThread.interactive_latest_intent;
 if(latest!=null&&!uuid(latest))throw Error("Customer conversation changed");
 return {threadId,messages,...(uuid(latest)?{latestRequestIntentId:latest}:{})};
}


/** Read the original interactive status; this never submits a message or acquires an executor. */
export async function readCustomerChatOutcome(frame:ClientPortalFrame,threadId:string,intentId:string,signal?:AbortSignal):Promise<{executor_active:boolean;settled:boolean}>{
 if(!uuid(threadId)||!uuid(intentId))throw Error("Customer conversation changed");
 const scope=await customerChatScope(frame,signal);
 const {authorization,business,current,check}=scope;
 await check();await readCustomerThread(scope,threadId);current();
 const response=await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-ai-chat`,{
   method:"POST",headers:{"Content-Type":"application/json",Authorization:authorization,
    "x-client-portal-business":business,"x-paige-chat-control":"status"},
   body:JSON.stringify({threadId,requestIntentId:intentId,messages:[{role:"user",content:"Status"}],
    surfaceContext:{kind:"customer_portal"},interactive:{kind:"status"}}),signal,
  });
 current();if(!response.ok)throw Error("Conversation status could not be checked");
 const status:unknown=await response.json();current();
 await readCustomerThread(scope,threadId);await check();current();
 if(!status||typeof status!=="object"||Array.isArray(status))throw Error("Conversation status could not be checked");
 const value=status as Record<string,unknown>;
 if(typeof value.executor_active!=="boolean"||typeof value.settled!=="boolean"||
  (value.executor_active&&value.settled))throw Error("Conversation status could not be checked");
 return {executor_active:value.executor_active,settled:value.settled};
}
