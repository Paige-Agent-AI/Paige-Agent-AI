import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useTenantContext} from '@/hooks/useTenantContext';
import {captureClientPortalAuthorization,isClientPortalBusinessId} from '@/lib/client-portal-scope';
import {readPortalSupportAttention,type PortalSupportAttention} from './portalSupportAttentionModel';

type State={phase:'loading'|'ready'|'error'|'unavailable';value:PortalSupportAttention|null};
const initial=():State=>({phase:'loading',value:null});
export function usePortalSupportAttention(tenantId:string,contactIds:readonly string[]){
 const context=useTenantContext(),actor=context.activeUserId;
 const ids=[...new Set(contactIds)].sort();
 const ready=!context.accountContextLoading&&context.accountContextStatus==='ready'&&context.activeTenantId===tenantId
  &&isClientPortalBusinessId(actor)&&isClientPortalBusinessId(tenantId)&&ids.length>0&&ids.length<=250&&ids.every(isClientPortalBusinessId);
 const key=JSON.stringify([actor,tenantId,ids,ready]);
 const boundary=useRef({key});if(boundary.current.key!==key)boundary.current={key};
 const incarnation=boundary.current;
 const [state,setState]=useState({boundary:incarnation,value:initial()});
 const actions=useRef<{load:()=>Promise<void>}|null>(null);
 useEffect(()=>{
  let alive=true,retired=false,sequence=0,controller:AbortController|null=null,deferred:ReturnType<typeof setTimeout>|undefined;
  const current=(mine:number)=>alive&&!retired&&boundary.current===incarnation&&mine===sequence;
  const publish=(value:State)=>{if(alive&&boundary.current===incarnation)setState({boundary:incarnation,value});};
  const load=async()=>{
   const mine=++sequence;controller?.abort();controller=new AbortController();const request=controller;
   if(!ready||retired){publish({phase:'unavailable',value:null});return;}
   publish(initial());const deadline=Date.now()+20_000;
   let timer:ReturnType<typeof setTimeout>|undefined;
   const bounded=<T,>(value:PromiseLike<T>):Promise<T>=>Promise.race([Promise.resolve(value),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{request.abort();reject(Error('Support read timed out'));},Math.max(0,deadline-Date.now()));
   })]).finally(()=>clearTimeout(timer));
   try{
    const authorization=await bounded(captureClientPortalAuthorization(supabase.auth,actor!,()=>current(mine)&&!request.signal.aborted));
    if(!current(mine))return;
    const result=await bounded(supabase.rpc('read_client_portal_support_attention' as never,{
     p_expected_actor_id:actor,p_expected_tenant_id:tenantId,p_contact_ids:ids,
    } as never).setHeader('Authorization',authorization).abortSignal(request.signal));
    if(!current(mine))return;
    if(result.error){publish({phase:result.error.code==='42501'?'unavailable':'error',value:null});return;}
    const value=readPortalSupportAttention(result.data,actor!,tenantId,ids);
    if(!value)throw Error('Support source could not be verified');
    const after=await bounded(supabase.auth.getUser());
    if(!current(mine))return;
    if(after.error||after.data.user?.id!==actor){retired=true;publish({phase:'unavailable',value:null});return;}
    publish({phase:'ready',value});
   }catch{if(current(mine))publish({phase:'error',value:null});}
  };
  actions.current={load};
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   if(!alive||boundary.current!==incarnation)return;
   if(event==='SIGNED_OUT'||!session||session.user.id!==actor){retired=true;++sequence;controller?.abort();publish({phase:'unavailable',value:null});return;}
   if(retired){retired=false;clearTimeout(deferred);deferred=setTimeout(()=>void load(),0);}
  });
  const refresh=()=>{if(document.visibilityState==='hidden')hide();else void load();};
  const hide=()=>{++sequence;controller?.abort();publish(initial());};
  window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);window.addEventListener('pagehide',hide);
  document.addEventListener('visibilitychange',refresh);void load();
  return()=>{alive=false;++sequence;clearTimeout(deferred);controller?.abort();subscription.unsubscribe();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);window.removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',refresh);};
 // The key includes the complete immutable sorted contact list and context readiness.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[incarnation]);
 const refresh=useCallback(()=>actions.current?.load()??Promise.resolve(),[]);
 return {...(state.boundary===incarnation?state.value:initial()),refresh};
}
