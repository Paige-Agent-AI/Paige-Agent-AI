import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {readClientPortalFrame,type ClientPortalFrame} from '@/lib/client-portal-frame';
import {listCustomerResources,readCustomerResource,ResourceError,type CustomerResource,type ResourcePage,type ResourceRpc,type ResourceScope} from '@/lib/customer-resources';

type Phase='loading'|'ready'|'error'|'unavailable'|'signed_out';
type Reader={resource:CustomerResource;page:ResourcePage};
type State={phase:Phase;resources:CustomerResource[];reader:Reader|null;hasMore:boolean;notice:string};
const initial=():State=>({phase:'loading',resources:[],reader:null,hasMore:false,notice:''});
const sdk:ResourceRpc={rpc:(name,args)=>supabase.rpc(name as never,args as never) as unknown as ReturnType<ResourceRpc['rpc']>};
const same=(a:ResourceScope,b:ResourceScope)=>a.actor===b.actor&&a.tenant===b.tenant&&a.contact===b.contact;
class AccessFailure extends Error {}
async function wait<T>(promise:PromiseLike<T>,deadline:number):Promise<T>{
 const remaining=deadline-Date.now();if(remaining<=0)throw Error('Read timed out');let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([Promise.resolve(promise),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Read timed out')),remaining);})]);}
 finally{clearTimeout(timer!);}
}

/** Ephemeral view state only. Actual Auth/frame and native current grants own every read. */
export function useCustomerResources(frame:ClientPortalFrame){
 const scope={actor:frame.actorId,tenant:frame.profile.tenant_id,contact:frame.profile.id};
 const boundary=useRef(scope);if(!same(boundary.current,scope))boundary.current=scope;
 const incarnation=boundary.current;
 const [state,setState]=useState({boundary:incarnation,value:initial()});
 const actions=useRef<{load:(append?:boolean)=>Promise<void>;open:(resource:CustomerResource,offset?:number)=>Promise<void>}|null>(null);
 useEffect(()=>{
  let alive=true,signedOut=false,request=0,offset=0;
  let resources:CustomerResource[]=[],reading:{resource:CustomerResource;offset:number}|null=null;
  const current=(mine:number)=>alive&&!signedOut&&boundary.current===incarnation&&mine===request;
  const publish=(value:State)=>{if(alive&&boundary.current===incarnation)setState({boundary:incarnation,value});};
  const retire=(phase:Phase,notice:string)=>{++request;offset=0;resources=[];if(phase!=='loading')reading=null;publish({...initial(),phase,notice});};
  const verify=async(deadline:number)=>{
   const auth=await wait(supabase.auth.getUser(),deadline);
   if(auth.error||auth.data.user?.id!==incarnation.actor)throw new AccessFailure('Sign in with your invited customer account to continue.');
   const result=await wait(supabase.rpc('client_portal_frame' as never) as unknown as PromiseLike<{data:unknown;error:{code?:string}|null}>,deadline);
   if(result.error?.code==='42501'||(!result.error&&!result.data))throw new AccessFailure('Your customer access could not be verified. Contact the business for help.');
   const next=readClientPortalFrame(result.data,incarnation.actor);
   if(result.error||!next)throw Error('Customer information unavailable');
   if(!same(incarnation,{actor:next.actorId,tenant:next.profile.tenant_id,contact:next.profile.id}))throw new AccessFailure('Your customer context changed. Reopen Resources in the current business.');
   const final=await wait(supabase.auth.getUser(),deadline);
   if(final.error||final.data.user?.id!==incarnation.actor)throw new AccessFailure('Your customer session changed. Sign in again.');
  };
  const load=async(append=false)=>{
   if(!alive||signedOut||boundary.current!==incarnation)return;
   reading=null;
   const mine=++request,deadline=Date.now()+20_000,from=append?offset:0,previous=append?resources:[];
   publish(initial());
   try{
    await verify(deadline);if(!current(mine))return;
    const result=await wait(listCustomerResources(sdk,incarnation,from),deadline);if(!current(mine))return;
    await verify(deadline);if(!current(mine))return;
    resources=Array.from(new Map([...previous,...result.resources].map(row=>[row.share_id,row])).values());offset=result.nextOffset;
    publish({phase:'ready',resources,reader:null,hasMore:result.hasMore,notice:''});
   }catch(error){if(current(mine))retire(error instanceof AccessFailure||(error instanceof ResourceError&&error.code==='42501')?'unavailable':'error',
    error instanceof AccessFailure?error.message:'Resources could not be loaded. Check your connection and try again.');}
  };
  const open=async(resource:CustomerResource,from=0)=>{
   if(!alive||signedOut||boundary.current!==incarnation)return;
   reading={resource,offset:from};
   const mine=++request,deadline=Date.now()+20_000;publish(initial());
   try{
    await verify(deadline);if(!current(mine))return;
    const page=await wait(readCustomerResource(sdk,incarnation,resource,from),deadline);if(!current(mine))return;
    await verify(deadline);if(!current(mine))return;
    publish({phase:'ready',resources,reader:{resource,page},hasMore:false,notice:''});
   }catch(error){if(current(mine))retire(error instanceof AccessFailure||(error instanceof ResourceError&&error.code==='42501')?'unavailable':'error',
    error instanceof AccessFailure?error.message:error instanceof ResourceError&&error.code==='42501'
     ?'This resource is no longer available. Refresh Resources to see the current material.':'This resource could not be opened. Refresh Resources and try again.');}
  };
  actions.current={load,open};
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   if(!alive||boundary.current!==incarnation)return;
   if(event==='SIGNED_OUT'||!session){signedOut=true;retire('signed_out','Sign in with your invited customer account to continue.');return;}
   if(session.user.id!==incarnation.actor){signedOut=true;retire('unavailable','Your customer session changed. Reopen the portal with your invited account.');return;}
   signedOut=false;retire('loading','');const scheduled=request;
   queueMicrotask(()=>{if(current(scheduled)){if(reading)void open(reading.resource,reading.offset);else void load();}});
  });
  const focus=()=>{if(alive&&!signedOut){if(reading)void open(reading.resource,reading.offset);else void load();}};window.addEventListener('focus',focus);void load();
  return()=>{alive=false;++request;resources=[];reading=null;subscription.unsubscribe();window.removeEventListener('focus',focus);};
 },[incarnation]);
 const reload=useCallback(()=>actions.current?.load()??Promise.resolve(),[]);
 const loadMore=useCallback(()=>actions.current?.load(true)??Promise.resolve(),[]);
 const open=useCallback((resource:CustomerResource,offset=0)=>actions.current?.open(resource,offset)??Promise.resolve(),[]);
 return {...(state.boundary===incarnation?state.value:initial()),reload,loadMore,open};
}
