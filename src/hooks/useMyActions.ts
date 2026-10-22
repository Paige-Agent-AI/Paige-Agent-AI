import {useCallback, useEffect, useRef, useState} from "react";
import {supabase} from "@/integrations/supabase/client";
import {readClientPortalSelfProfile} from "@/lib/client-portal-self-profile";
import {useShellCustomerIdentity} from "@/lib/portal/customerIdentity";
import {captureClientPortalAuthorization,withClientPortalBusiness} from "@/lib/client-portal-scope";

export type ActionResponseType = "accepted" | "declined" | "question" | "completed";
export interface ActionResponse {
  id:string; responded_by_user_id:string; response_type:ActionResponseType;
  response_text:string|null; created_at:string;
}
export interface CustomerAction {
  id:string; tenant_id:string; contact_id:string; updated_at:string;
  action_type:"task"|"message"|"recommendation"|"nudge";
  title:string; body:string|null;
  status:"proposed"|"customer_notified"|"customer_acted"|"customer_declined"|"expired";
  expires_at:string; created_at:string; paige_customer_responses:ActionResponse[];
}
type Scope={actor:string;tenant:string;contact:string};
type PendingResponse={scope:Scope;type:ActionResponseType;text:string|null;prior:Set<string>;status:string};
const SELECT="id,tenant_id,contact_id,updated_at,action_type,title,body,status,expires_at,created_at,"+
  "paige_customer_responses(id,responded_by_user_id,response_type,response_text,created_at)";
const actionFields=new Set(["id","tenant_id","contact_id","updated_at","action_type","title","body","status","expires_at","created_at","paige_customer_responses"]);
const responseFields=new Set(["id","responded_by_user_id","response_type","response_text","created_at"]);
const responseTypes=["accepted","declined","question","completed"];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId=(v:unknown):v is string=>typeof v==="string"&&uuid.test(v);
const isDate=(v:unknown):v is string=>typeof v==="string"&&Number.isFinite(Date.parse(v));
function readActions(value:unknown,scope:Scope):CustomerAction[] {
  if(!Array.isArray(value)||value.length>100)throw new Error("invalid actions");
  const ids=new Set<string>();
  return value.map((item:unknown)=>{
    if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("invalid action");
    const row=item as Record<string,unknown>;
    if(Object.keys(row).length!==actionFields.size||Object.keys(row).some(key=>!actionFields.has(key))
      ||!isId(row.id)||ids.has(row.id)||row.tenant_id!==scope.tenant||row.contact_id!==scope.contact
      ||typeof row.title!=="string"||(row.body!==null&&typeof row.body!=="string")
      ||!["task","message","recommendation","nudge"].includes(String(row.action_type))
      ||!["proposed","customer_notified","customer_acted","customer_declined","expired"].includes(String(row.status))
      ||!isDate(row.updated_at)||!isDate(row.created_at)||!isDate(row.expires_at)||!Array.isArray(row.paige_customer_responses))throw new Error("invalid action scope");
    ids.add(row.id);
    const responseIds=new Set<string>();
    for(const entry of row.paige_customer_responses){
      if(!entry||typeof entry!=="object"||Array.isArray(entry))throw new Error("invalid response");
      const r=entry as Record<string,unknown>;
      if(Object.keys(r).length!==responseFields.size||Object.keys(r).some(key=>!responseFields.has(key))
        ||!isId(r.id)||responseIds.has(r.id)||!isId(r.responded_by_user_id)
        ||!responseTypes.includes(String(r.response_type))||!isDate(r.created_at)
        ||(r.response_text!==null&&typeof r.response_text!=="string"))throw new Error("invalid response scope");
      responseIds.add(r.id);
    }
    return row as unknown as CustomerAction;
  });
}
export function isActionOpen(a:CustomerAction):boolean {
  return ["customer_notified","proposed"].includes(a.status)&&new Date(a.expires_at).getTime()>Date.now();
}
async function bounded<T>(request:PromiseLike<T>,milliseconds=20_000):Promise<T>{
  if(milliseconds<=0)throw new Error("timeout");
  let timer:ReturnType<typeof setTimeout>;
  try{return await Promise.race([Promise.resolve(request),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("timeout")),milliseconds);})]);}
  finally{clearTimeout(timer!);}
}
const sameScope=(a:Scope|null,b:Scope)=>a?.actor===b.actor&&a.tenant===b.tenant&&a.contact===b.contact;
function confirmed(rows:CustomerAction[],id:string,pending:PendingResponse):ActionResponse|null {
  const row=rows.find(a=>a.id===id);
  return row&&row.status===pending.status ? row.paige_customer_responses.find(r=>!pending.prior.has(r.id)
    &&r.responded_by_user_id===pending.scope.actor&&r.response_type===pending.type&&r.response_text===pending.text)??null:null;
}

/** Existing customer action records and response writer; no raw CRM or private approvals. */
export function useMyActions(){
  const identity=useShellCustomerIdentity(),frame=identity?.viewer==="customer"?identity.frame:null;
  const requestedActor=frame?.actorId??null,requestedBusiness=frame?.profile.tenant_id??null,requestedClient=frame?.profile.id??null;
  const requestedScope=identity?JSON.stringify([identity.viewer,requestedActor,requestedBusiness,requestedClient]):"legacy";
  const enabled=!identity||identity.viewer==="staff"||!!frame&&identity.phase==="ready";
  const [actions,setActions]=useState<CustomerAction[]>([]),[loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null),[contactId,setContactId]=useState<string|null>(null);
  const [actorId,setActorId]=useState<string|null>(null);
  const [pendingActionId,setPendingActionId]=useState<string|null>(null),[uncertainActionIds,setUncertainActionIds]=useState<string[]>([]);
  const [scopeEpoch,setScopeEpoch]=useState(0);
  const [confirmation,setConfirmation]=useState<{epoch:number;actionId:string;responseId:string;type:ActionResponseType}|null>(null);
  const life=useRef({alive:true,epoch:0,read:0,scope:null as Scope|null,lastScope:null as Scope|null,actions:[] as CustomerAction[],working:false,unknown:new Map<string,PendingResponse>()});
  const origin=useRef({key:requestedScope,generation:0,enabled}),appliedScope=useRef(requestedScope),signedOut=useRef(false);
  if(origin.current.key!==requestedScope){
    origin.current={key:requestedScope,generation:origin.current.generation+1,enabled};
    ++life.current.epoch;++life.current.read;life.current.scope=null;
  }
  origin.current.enabled=enabled;
  const generation=origin.current.generation;
  const scopeCurrent=useCallback(()=>origin.current.generation===generation&&origin.current.enabled
    &&appliedScope.current===requestedScope&&!signedOut.current,[generation,requestedScope]);
  const retire=useCallback((notice:string|null,waiting:boolean)=>{
    const l=life.current;++l.epoch;++l.read;l.scope=null;l.lastScope=null;l.actions=[];l.unknown.clear();l.working=false;
    setScopeEpoch(l.epoch);
    setConfirmation(null);
    setActions([]);setContactId(null);setActorId(null);setPendingActionId(null);setUncertainActionIds([]);setError(notice);setLoading(waiting);
  },[]);
  const refresh=useCallback(async(deadline=Date.now()+20_000)=>{
    const l=life.current;
    if(!l.alive||!scopeCurrent())return null;
    const n=++l.read,epoch=l.epoch,current=()=>l.alive&&scopeCurrent()&&l.read===n&&l.epoch===epoch;
    setLoading(true);setError(null);
    try{
      const identity=await bounded(supabase.auth.getUser(),deadline-Date.now());if(!current())return null;
      if(identity.error)throw new Error("authentication unavailable");
      if(!identity.data.user){retire("Sign in with your invited account to continue.",false);return null;}
      const actor=identity.data.user.id;
      if(requestedActor&&actor!==requestedActor){retire("Your session changed. Reload your action items to continue.",false);return null;}
      const authorization=requestedActor&&requestedBusiness
        ?await bounded(captureClientPortalAuthorization(supabase.auth,requestedActor,current),deadline-Date.now()):null;
      if(!current())return null;
      let profileRequest=supabase.rpc("client_portal_self_profile");
      if(requestedBusiness&&authorization)profileRequest=withClientPortalBusiness(profileRequest,requestedBusiness).setHeader("Authorization",authorization);
      const native=await bounded(profileRequest,deadline-Date.now());if(!current())return null;
      const profile=readClientPortalSelfProfile(native.data,actor);
      if((!native.error&&!native.data)||native.error?.code==="42501"){
        retire("Your customer access could not be verified. Contact the business for help.",false);return null;
      }
      if(native.error||!profile)throw new Error("relationship unavailable");
      if(requestedBusiness&&(profile.tenant_id!==requestedBusiness||profile.id!==requestedClient))throw new Error("customer business changed");
      const scope={actor,tenant:profile.tenant_id,contact:profile.id};
      if(l.lastScope&&!sameScope(l.lastScope,scope)){
        retire("Your customer context changed. Reload your action items to continue.",false);return null;
      }
      let actionRequest=supabase.from("paige_customer_actions").select(SELECT)
        .eq("tenant_id",scope.tenant).eq("contact_id",scope.contact).order("created_at",{ascending:false}).limit(100);
      if(requestedBusiness&&authorization)actionRequest=withClientPortalBusiness(actionRequest,requestedBusiness).setHeader("Authorization",authorization);
      const read=await bounded(actionRequest,deadline-Date.now());
      if(!current())return null;
      if(read.error?.code==="42501"){retire("Your customer access could not be verified. Contact the business for help.",false);return null;}
      if(read.error)throw read.error;
      const rows=readActions(read.data,scope);
      const final=await bounded(supabase.auth.getUser(),deadline-Date.now());if(!current())return null;
      if(final.error||final.data.user?.id!==actor){retire("Your session changed. Reload your action items to continue.",false);return null;}
      l.scope=scope;l.lastScope=scope;l.actions=rows;setActions(rows);setContactId(scope.contact);setActorId(scope.actor);
      for(const [id,p] of l.unknown){
        const saved=sameScope(scope,p.scope)?confirmed(rows,id,p):null;
        if(saved){l.unknown.delete(id);setConfirmation({epoch,actionId:id,responseId:saved.id,type:p.type});}
      }
      setUncertainActionIds([...l.unknown.keys()]);
      return rows;
    }catch{
      if(current()){l.scope=null;l.actions=[];setActions([]);setContactId(null);setActorId(null);setError("Your action items could not be verified. Check your connection or contact the business, then try again.");}
      return null;
    }finally{if(current())setLoading(false);}
  },[retire,scopeCurrent,requestedActor,requestedBusiness,requestedClient]);
  const refreshRef=useRef(refresh);refreshRef.current=refresh;
  useEffect(()=>{
    const l=life.current;l.alive=true;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      if(!l.alive)return;
      if(event==="SIGNED_OUT"||!session){signedOut.current=true;++origin.current.generation;retire("Sign in with your invited account to continue.",false);return;}
      signedOut.current=false;
      if(session.user.id===l.lastScope?.actor){
        // Ordinary same-subject refreshes revalidate authority without retiring
        // the customer's draft or pretending a pending write was cancelled.
        const epoch=l.epoch;queueMicrotask(()=>{if(l.alive&&l.epoch===epoch)void refreshRef.current();});return;
      }
      ++origin.current.generation;retire(null,true);
    });
    const focus=()=>{if(l.alive)void refreshRef.current();};window.addEventListener("focus",focus);
    return()=>{l.alive=false;++l.epoch;++l.read;subscription.unsubscribe();window.removeEventListener("focus",focus);};
  },[retire]);
  useEffect(()=>{
    if(appliedScope.current!==requestedScope){appliedScope.current=requestedScope;retire(null,enabled);}
  },[requestedScope,enabled,retire]);
  useEffect(()=>{if(enabled)void refresh();},[refresh,enabled]);
  useEffect(()=>{
    if(!contactId)return;
    const channel=supabase.channel(`my_actions_${contactId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"paige_customer_actions",filter:`contact_id=eq.${contactId}`},()=>void refresh())
      .on("postgres_changes",{event:"*",schema:"public",table:"paige_customer_responses",filter:`contact_id=eq.${contactId}`},()=>void refresh()).subscribe();
    return()=>{void supabase.removeChannel(channel);};
  },[contactId,refresh]);
  const respond=useCallback(async(actionId:string,type:ActionResponseType,text?:string)=>{
    const l=life.current,scope=l.scope,action=l.actions.find(a=>a.id===actionId);
    if(!l.alive||!scopeCurrent()||!scope||!action||!isActionOpen(action)||l.working||l.unknown.has(actionId))throw new Error("Check the saved action before trying to respond.");
    const message=text?.trim()||null;
    if(!responseTypes.includes(type)||(type==="question"&&!message)||(message?.length??0)>4000)throw new Error("Enter a question of up to 4,000 characters.");
    const epoch=l.epoch,current=()=>l.alive&&scopeCurrent()&&l.epoch===epoch&&sameScope(l.scope,scope);
    const deadline=Date.now()+20_000;
    const pending:PendingResponse={scope,type,text:message,prior:new Set(action.paige_customer_responses.map(r=>r.id)),status:type==="declined"?"customer_declined":type==="question"?action.status:"customer_acted"};
    l.working=true;setPendingActionId(actionId);let dispatched=false;
    try{
      const user=await bounded(supabase.auth.getUser(),deadline-Date.now());
      if(!current())throw new Error("Your session changed. Reload your action items.");
      if(user.error||user.data.user?.id!==scope.actor){
        retire("Your session could not be verified. Reload your action items to continue.",false);
        throw new Error("Your session changed. Reload your action items.");
      }
      let authorization:string|null=null;
      if(requestedActor&&requestedBusiness){
        try{authorization=await bounded(captureClientPortalAuthorization(supabase.auth,scope.actor,current),deadline-Date.now());}
        catch(failure){if(current())retire("Your session could not be verified. Reload your action items to continue.",false);throw failure;}
      }
      if(!current())throw new Error("Your customer context changed. Reload your action items.");
      let responseRequest=supabase.rpc("customer_respond_to_action",{
        p_action_id:actionId,p_response_type:type,p_response_text:message,p_expected_updated_at:action.updated_at,
      } as never);
      if(requestedBusiness&&authorization)responseRequest=withClientPortalBusiness(responseRequest,requestedBusiness).setHeader("Authorization",authorization);
      if(Date.now()>=deadline)throw new Error("Your connection is taking too long. Reload the item before responding.");
      dispatched=true;
      const result=await bounded(responseRequest,deadline-Date.now());
      if(!current())throw new Error("Your session changed. Check your saved action after signing in.");
      if(result.error)throw result.error;
      const receipt=result.data as {ok?:boolean;error?:string}|null;
      if(receipt?.ok!==true){
        dispatched=false;
        if(receipt?.error==="FORBIDDEN"||receipt?.error==="UNAUTHENTICATED"){
          retire("Your customer access could not be verified. Contact the business for help.",false);
        }else{
          l.scope=null;setError("This item could not accept your response. Reload your action items before responding.");
        }
        throw new Error("This response was not accepted. Reload the item or contact the business.");
      }
      const rows=await refresh(deadline);
      const saved=rows?confirmed(rows,actionId,pending):null;
      if(!current()||!saved)throw new Error("unconfirmed response");
      l.unknown.delete(actionId);setUncertainActionIds([...l.unknown.keys()]);
      setConfirmation({epoch,actionId,responseId:saved.id,type});
      return {ok:true};
    }catch(e){
      if(dispatched&&l.alive&&l.epoch===epoch){
        l.unknown.set(actionId,pending);setUncertainActionIds([...l.unknown.keys()]);
        const issue=new Error("We couldn’t confirm your response. Check the saved result before trying again.");
        issue.name="CustomerActionUnconfirmed";throw issue;
      }
      throw e;
    }finally{if(l.alive&&l.epoch===epoch){l.working=false;setPendingActionId(null);}}
  },[refresh,retire,scopeCurrent,requestedActor,requestedBusiness]);
  const hidden=!scopeCurrent();
  const visible=hidden?[]:actions;
  return {actions:visible,open:visible.filter(isActionOpen),past:visible.filter(a=>!isActionOpen(a)),loading:hidden?enabled&&!signedOut.current:loading,
    error:hidden?signedOut.current?error:null:error,contactId:hidden?null:contactId,actorId:hidden?null:actorId,refresh,respond,
    pendingActionId:hidden?null:pendingActionId,uncertainActionIds:hidden?[]:uncertainActionIds,
    scopeEpoch:hidden?life.current.epoch:scopeEpoch,confirmation:hidden?null:confirmation};
}
