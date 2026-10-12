import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createSettingsRequestGate } from "@/solo/settings-contract";
import { normalizeCrmWorkRead, type CrmWorkRecord } from "./operations-native-work";

type State = { scope:string|null; tasks:CrmWorkRecord[]; loading:boolean; error:string|null; forbidden:boolean; hasMore:boolean };
const EMPTY:CrmWorkRecord[]=[];
/** Native CRM read only. CRM commands, Trust and Rail retain all write authority. */
export function useOperationsCrmWork(actorId:string|null,tenantId:string|null) {
  const scope=actorId&&tenantId?`${actorId}:${tenantId}`:null;
  const gate=useRef(createSettingsRequestGate());
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
    forbidden:visible&&state.forbidden,hasMore:visible&&state.hasMore,refresh};
}
