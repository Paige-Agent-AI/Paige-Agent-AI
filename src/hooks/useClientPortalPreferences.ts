import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {useShellCustomerIdentity} from "@/lib/portal/customerIdentity";
import {captureClientPortalAuthorization,withClientPortalBusiness} from "@/lib/client-portal-scope";
import {preferenceRefusal,readClientPortalPreferences,type ClientPortalPreferences,type PreferenceRefusal} from "@/lib/client-portal-preferences";

/** Original customer preferences, suppression and sharing sources. The selected tuple only clamps
 * intent; native Auth/CRM still grants authority. Acknowledgement alone never proves saved state. */
export type PreferencesPhase = "loading" | "ready" | "unavailable" | "multipleBusinesses" | "signed_out" | "error";
export type PreferenceKey = "email" | "sms" | "updates" | "sharing";
export type PreferenceOutcome =
  | { key: PreferenceKey; kind: "saved"; enabled: boolean }
  | { key: PreferenceKey; kind: "refused"; code: PreferenceRefusal | "OTHER" }
  | { key: PreferenceKey; kind: "unconfirmed" }
  | { key: PreferenceKey; kind: "multipleBusinesses" };

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type Rpc = "client_portal_communication_preferences_scoped" | "client_portal_set_communication_preference_scoped" | "client_portal_set_shared_context_consent_scoped";
function portalRpc(name:Rpc,args:Record<string,unknown>,authorization:string,tenantId:string):PromiseLike<RpcResult> {
  return withClientPortalBusiness(supabase.rpc(name as never,args as never),tenantId).setHeader("Authorization",authorization) as unknown as PromiseLike<RpcResult>;
}

/**
 * 42501 means several things here; only the message tells them apart. "customer authentication required"
 * is signed out; "select an authorized customer relationship" is more than one business; "customer
 * relationship unavailable" is no (longer a) relationship. An unrecognized authorization refusal
 * also closes this scope; transport or acknowledgment uncertainty uses the original fresh read.
 */
function classify42501(error: RpcResult["error"]): "signed_out" | "multipleBusinesses" | "unavailable" | null {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/authentication required/i.test(message)) return "signed_out";
  if (/select an authorized customer relationship/i.test(message)) return "multipleBusinesses";
  if (/relationship unavailable/i.test(message)) return "unavailable";
  return null;
}

class ReadFailure extends Error {
  constructor(readonly phase: Exclude<PreferencesPhase, "loading" | "ready">) { super(phase); }
}

export const PORTAL_PREFERENCE_CHANNEL: Record<Exclude<PreferenceKey, "sharing">, { channel: "email" | "sms"; topic: "newsletter" | null }> = {
  email: { channel: "email", topic: null },
  sms: { channel: "sms", topic: null },
  updates: { channel: "email", topic: "newsletter" },
};

/** Whether a fresh read shows the asked-for choice. */
export function preferenceReached(p: ClientPortalPreferences, key: PreferenceKey, enabled: boolean): boolean {
  if (key === "sharing") return p.data_sharing.allowed === enabled;
  if (key === "updates") return enabled ? p.updates.state === "subscribed" : p.updates.state !== "subscribed";
  const state = key === "email" ? p.email.state : p.sms.state;
  return state === (enabled ? "on" : "off");
}

type Model={phase:PreferencesPhase;preferences:ClientPortalPreferences|null;stale:boolean;pending:{key:PreferenceKey;enabled:boolean}|null;outcome:PreferenceOutcome|null};
const initial=():Model=>({phase:"loading",preferences:null,stale:false,pending:null,outcome:null});

/** Local request lifetime only, never another consent store or execution engine. The Account page
 * supplies its native-verified tuple; the canonical shell, when present, must match it exactly. */
export function useClientPortalPreferences(options:{actorId:string;tenantId?:string;clientId?:string;onCommitted?:(key:PreferenceKey)=>void}) {
  const identity=useShellCustomerIdentity();
  const frame=identity?.viewer==="customer"?identity.frame:null;
  const actorId=frame?.actorId??options.actorId,tenantId=frame?.profile.tenant_id??options.tenantId,clientId=frame?.profile.id??options.clientId;
  const matches=(!options.tenantId||options.tenantId===tenantId)&&(!options.clientId||options.clientId===clientId)&&options.actorId===actorId;
  const rootComplete=!identity||identity.viewer==="customer"&&!!frame?.actorId&&!!frame?.profile.tenant_id&&!!frame?.profile.id;
  const complete=!!actorId&&!!tenantId&&!!clientId&&matches&&rootComplete;
  const enabled=complete&&(!identity||identity.viewer==="customer"&&identity.phase==="ready"&&!identity.checking);
  const key=JSON.stringify([actorId,tenantId,clientId,matches]);
  const origin=useRef({key,enabled,generation:0});
  if(origin.current.key!==key||origin.current.enabled!==enabled)origin.current={key,enabled,generation:origin.current.generation+1};
  const scopeGeneration=origin.current.generation;
  const applied=useRef(key),shown=useRef(-1),observedSignedOut=useRef(false);
  const inScope=useCallback(()=>origin.current.generation===scopeGeneration&&origin.current.enabled&&applied.current===key&&!observedSignedOut.current,[scopeGeneration,key]);
  const [model,setModel]=useState<Model>(initial),latest=useRef(model);
  const committed=useRef(options.onCommitted);committed.current=options.onCommitted;
  const actions=useRef<{load:()=>Promise<void>;write:(key:PreferenceKey,enabled:boolean)=>Promise<void>}|null>(null);
  const publish=useCallback((next:Model)=>{latest.current=next;setModel(next);},[]);

  useEffect(()=>{
    const prior=applied.current===key?latest.current:null;
    applied.current=key;
    latest.current=prior?{...prior,pending:null,outcome:prior.pending?{key:prior.pending.key,kind:"unconfirmed"}:prior.outcome}:initial();
    let disposed=false,signedOut=observedSignedOut.current,generation=0,writing=false;
    const retire=new AbortController();
    const current=(request:number)=>!disposed&&!signedOut&&inScope()&&request===generation;
    const commit=(next:Model)=>{if(disposed||origin.current.generation!==scopeGeneration||applied.current!==key)return;shown.current=scopeGeneration;publish(next);};
    const clear=(phase:PreferencesPhase)=>commit({...initial(),phase});
    const wait=<T,>(value:PromiseLike<T>):Promise<T>=>new Promise((resolve,reject)=>{
      const finish=(fn:()=>void)=>{clearTimeout(timer);retire.signal.removeEventListener("abort",abort);fn();};
      const abort=()=>finish(()=>reject(new Error("retired")));
      const timer=setTimeout(()=>finish(()=>reject(new Error("timeout"))),20_000);
      retire.signal.addEventListener("abort",abort,{once:true});
      Promise.resolve(value).then(v=>finish(()=>resolve(v)),e=>finish(()=>reject(e)));
    });
    const ensureActor=async(request:number,authorization?:string)=>{
      const result=await wait(authorization?supabase.auth.getUser(authorization.replace(/^Bearer /,"")):supabase.auth.getUser());
      if(!current(request))throw new Error("retired");
      if(result.error?.name==="AuthSessionMissingError"||result.error?.status===401||!result.error&&!result.data.user||result.data.user&&result.data.user.id!==actorId)throw new ReadFailure("signed_out");
      if(result.error||!result.data.user)throw new ReadFailure("error");
    };
    const authorizationFor=async(request:number)=>{
      await ensureActor(request);
      try{return await wait(captureClientPortalAuthorization(supabase.auth,actorId,()=>current(request)));}
      catch(error){if(!current(request))throw error;throw new ReadFailure("error");}
    };
    const fetchOnce=async(request:number):Promise<ClientPortalPreferences>=>{
      const authorization=await authorizationFor(request);
      if(!current(request)||!tenantId||!clientId)throw new Error("retired");
      const result=await wait(portalRpc("client_portal_communication_preferences_scoped",{p_tenant_id:tenantId,p_expected_client_id:clientId},authorization,tenantId));
      if(!current(request))throw new Error("retired");
      if(result.error){const definite=result.error.code==="42501"?(classify42501(result.error)??"unavailable"):null;if(definite)throw new ReadFailure(definite);throw new Error("read failed");}
      if(result.data===null||result.data===undefined)throw new ReadFailure("unavailable");
      const parsed=readClientPortalPreferences(result.data,tenantId);
      if(!parsed)throw new Error("unexpected preferences");
      await ensureActor(request,authorization);
      if(!current(request))throw new Error("retired");
      return parsed;
    };
    const load=async()=>{
      if(!inScope()||disposed||signedOut||writing)return;
      const request=++generation,before=latest.current;
      if(!before.preferences)commit({...before,phase:"loading"});
      try{const next=await fetchOnce(request);if(current(request))commit({...latest.current,phase:"ready",preferences:next,stale:false,pending:null});}
      catch(error){if(!current(request))return;if(error instanceof ReadFailure){if(error.phase==="signed_out")signedOut=observedSignedOut.current=true;clear(error.phase);return;}
        if(before.preferences)commit({...before,phase:"ready",stale:true,pending:null});else clear("error");}
    };
    const write=async(preference:PreferenceKey,enabled:boolean)=>{
      const before=latest.current;
      if(!inScope()||disposed||signedOut||writing||before.phase!=="ready"||!before.preferences||!tenantId||!clientId)return;
      writing=true;const request=++generation;
      commit({...before,pending:{key:preference,enabled},outcome:null});
      let refusal:PreferenceRefusal|"OTHER"|null=null,dispatched=false;
      try{
        const authorization=await authorizationFor(request);
        if(!current(request))return;
        dispatched=true;
        const result=preference==="sharing"
          ?await wait(portalRpc("client_portal_set_shared_context_consent_scoped",{p_allow:enabled,p_tenant_id:tenantId,p_expected_client_id:clientId},authorization,tenantId))
          :await wait(portalRpc("client_portal_set_communication_preference_scoped",{p_channel:PORTAL_PREFERENCE_CHANNEL[preference].channel,p_topic:PORTAL_PREFERENCE_CHANNEL[preference].topic,p_enabled:enabled,p_tenant_id:tenantId,p_expected_client_id:clientId},authorization,tenantId));
        if(!current(request))return;
        const definite=result.error?.code==="42501"?(classify42501(result.error)??"unavailable"):null;
        if(definite)throw new ReadFailure(definite);
        refusal=preferenceRefusal(result.data,result.error);
      }catch(error){
        if(!current(request))return;
        if(error instanceof ReadFailure){writing=false;if(error.phase==="signed_out")signedOut=observedSignedOut.current=true;
          clear(error.phase);if(error.phase==="multipleBusinesses")commit({...initial(),phase:error.phase,outcome:{key:preference,kind:"multipleBusinesses"}});return;}
        // An uncertain external outcome never replays a choice. Only the original fresh read can prove it.
      }
      let fresh:ClientPortalPreferences|null=null;
      try{fresh=await fetchOnce(request);}catch(error){if(!current(request))return;if(error instanceof ReadFailure){writing=false;if(error.phase==="signed_out")signedOut=observedSignedOut.current=true;clear(error.phase);return;}}
      if(!current(request))return;
      writing=false;
      const outcome:PreferenceOutcome=refusal?{key:preference,kind:"refused",code:refusal}
        :dispatched&&fresh&&preferenceReached(fresh,preference,enabled)?{key:preference,kind:"saved",enabled}:{key:preference,kind:"unconfirmed"};
      commit({...before,phase:"ready",preferences:fresh??before.preferences,stale:!fresh,pending:null,outcome});
      if(outcome.kind==="saved"&&current(request))committed.current?.(preference);
    };
    actions.current={load,write};
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      if(disposed)return;const next=session?.user.id??null;
      if(observedSignedOut.current&&event!=="SIGNED_IN")return;
      if(event==="INITIAL_SESSION"&&next===actorId)return;
      if(event==="SIGNED_OUT"||!next||next!==actorId||observedSignedOut.current){
        signedOut=event!=="SIGNED_IN"||next!==actorId;observedSignedOut.current=signedOut;
        generation++;++origin.current.generation;shown.current=origin.current.generation;
        publish({...initial(),phase:signedOut?"signed_out":"loading"});return;
      }
      queueMicrotask(()=>{if(!disposed&&!signedOut)void load();});
    });
    const refresh=()=>{if(document.visibilityState!=="hidden")void load();};
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    if(enabled&&!signedOut)void load();
    return()=>{disposed=true;generation++;retire.abort();actions.current=null;subscription.unsubscribe();window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[actorId,tenantId,clientId,key,scopeGeneration,enabled,inScope,publish]);
  const inView=()=>inScope()&&shown.current===scopeGeneration;
  const visible=inView()?model:{...initial(),phase:observedSignedOut.current?"signed_out" as const:!complete?"unavailable" as const:"loading" as const};
  return {...visible,preferences:visible.phase==="ready"?visible.preferences:null,
    reload:()=>inScope()?actions.current?.load():undefined,
    setChannel:(preference:Exclude<PreferenceKey,"sharing">,enabled:boolean)=>inView()?actions.current?.write(preference,enabled):undefined,
    setSharing:(allow:boolean)=>inView()?actions.current?.write("sharing",allow):undefined,
    dismissOutcome:()=>{if(inView())publish({...latest.current,outcome:null});}};
}
