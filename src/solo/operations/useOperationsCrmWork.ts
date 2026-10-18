import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createSettingsRequestGate } from "@/solo/settings-contract";
import { normalizeCrmWorkRead, type CrmWorkRecord } from "./operations-native-work";
import { getScopedUserId } from "@/lib/scopedUser";
import { readOperationsTask, type OperationsTaskReadCaller } from "../../../supabase/functions/_shared/operations-task-read";
import type { ContextIdentity } from "../../../supabase/functions/_shared/paige-context/mod";

type State = { scope:string|null; tasks:CrmWorkRecord[]; loading:boolean; error:string|null; forbidden:boolean; hasMore:boolean };
const EMPTY:CrmWorkRecord[]=[];
/** Native CRM read only. CRM commands, Trust and Rail retain all write authority. */
export function useOperationsCrmWork(actorId:string|null,tenantId:string|null) {
  const scope=actorId&&tenantId?`${actorId}:${tenantId}`:null;
  const gate=useRef(createSettingsRequestGate());
  const exactGate=useRef(createSettingsRequestGate());
  const exactAbort=useRef<AbortController|null>(null);
  const latestScope=useRef({scope,epoch:0});
  // Retire on render, before any layout/passive observer can resolve an old read.
  // Returning A→B→A cannot revive the first A request or its retained callback.
  if(latestScope.current.scope!==scope)latestScope.current={scope,epoch:latestScope.current.epoch+1};
  const scopeEpoch=latestScope.current.epoch;
  const alive=useRef(true);
  const abortExact=useCallback(()=>{exactGate.current.clear();exactAbort.current?.abort();},[]);
  useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;abortExact();};},[abortExact]);
  useLayoutEffect(()=>abortExact,[scope,abortExact]);

  const readTask=useCallback(async(taskId:string,signal?:AbortSignal)=>{
    exactAbort.current?.abort();
    const abort=new AbortController();exactAbort.current=abort;
    const token=exactGate.current.begin();
    const current=()=>alive.current&&exactGate.current.isCurrent(token)&&latestScope.current.scope===scope&&latestScope.current.epoch===scopeEpoch&&
      Boolean(scope)&&!abort.signal.aborted&&getScopedUserId()===null;
    const origin:ContextIdentity={actorId:actorId??"",tenantId,workspaceId:tenantId,role:null,
      accountShape:null,actAsClientId:null,scopeEpoch:`${scopeEpoch}:${token}`};
    const retire=()=>abort.abort();
    signal?.addEventListener("abort",retire,{once:true});if(signal?.aborted)retire();
    try{
      return await readOperationsTask(origin,{
        caller:supabase as unknown as OperationsTaskReadCaller,
        currentIdentity:()=>current()?origin:null,signal:abort.signal,
        revalidateScope:async nativeSignal=>{
          if(!current())return false;
          const tenant=await supabase.rpc("current_user_tenant_id").abortSignal(nativeSignal);
          if(!current()||tenant.error||tenant.data!==tenantId)return false;
          const member=await supabase.rpc("is_tenant_member",{_tenant:tenantId!}).abortSignal(nativeSignal);
          return current()&&!member.error&&member.data===true;
        },
      },{task_id:taskId});
    }finally{signal?.removeEventListener("abort",retire);}
  },[actorId,tenantId,scope,scopeEpoch]);
  const [state,setState]=useState<State>({scope:null,tasks:EMPTY,loading:true,error:null,forbidden:false,hasMore:false});
  const refresh=useCallback(async()=>{
    const token=gate.current.begin();
    setState({scope,tasks:EMPTY,loading:Boolean(scope),error:null,forbidden:false,hasMore:false});
    if(!scope||!actorId||!tenantId)return null;
    try{
      const before=await supabase.auth.getUser();
      if(!gate.current.isCurrent(token))return null;
      if(before.error||before.data.user?.id!==actorId)throw new Error("OPERATIONS_WORK_SCOPE_CHANGED");
      const reader=supabase as unknown as {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string;message:string}|null}>};
      const {data,error}=await reader.rpc("operations_crm_work_read",{p_expected_actor_id:actorId,p_expected_tenant_id:tenantId});
      const after=await supabase.auth.getUser();
      if(!gate.current.isCurrent(token))return null;
      if(after.error||after.data.user?.id!==actorId)throw new Error("OPERATIONS_WORK_SCOPE_CHANGED");
      if(error)throw new Error(error.code==="42501"?"OPERATIONS_WORK_FORBIDDEN":error.message);
      const read=normalizeCrmWorkRead(data,actorId,tenantId);
      if(!read)throw new Error("OPERATIONS_WORK_READ_UNAVAILABLE");
      setState({scope,tasks:read.tasks,hasMore:read.hasMore,loading:false,error:null,forbidden:false});
      return read.tasks;
    }catch(error){
      if(!gate.current.isCurrent(token))return null;
      const forbidden=error instanceof Error&&/OPERATIONS_WORK_(FORBIDDEN|SCOPE_CHANGED)/.test(error.message);
      setState({scope,tasks:EMPTY,loading:false,hasMore:false,forbidden,error:forbidden?"CRM work isn’t available in this account or workspace.":"CRM work couldn’t be loaded. Try again."});
      return null;
    }
  },[scope,actorId,tenantId]);
  useEffect(()=>{void refresh();const current=gate.current;return()=>current.clear()},[refresh]);
  const visible=scope!==null&&state.scope===scope;
  return {tasks:visible?state.tasks:EMPTY,loading:scope!==null&&(!visible||state.loading),error:visible?state.error:null,
    forbidden:visible&&state.forbidden,hasMore:visible&&state.hasMore,refresh,readTask};
}
