import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {commitResourceShare,listOwnerResourceShares,prepareResourceShare,ResourceError,
 type OwnerResourceShare,type ResourceRpc,type ResourceScope,type ShareProposal} from '@/lib/customer-resources';

type Outcome='list'|'preparing'|'review'|'saving'|'saved'|'unknown'|'conflict'|'refused';
type Model={phase:'loading'|'ready'|'error'|'unavailable';rows:OwnerResourceShare[];hasMore:boolean;outcome:Outcome;proposal:ShareProposal|null;notice:string};
const initial=():Model=>({phase:'loading',rows:[],hasMore:false,outcome:'list',proposal:null,notice:''});
const same=(a:ResourceScope|null,b:ResourceScope|null)=>a===b||!!a&&!!b&&a.actor===b.actor&&a.tenant===b.tenant&&a.contact===b.contact;
const sdk:ResourceRpc={rpc:(name,args)=>supabase.rpc(name as never,args as never) as unknown as ReturnType<ResourceRpc['rpc']>};
async function wait<T>(promise:PromiseLike<T>,deadline:number):Promise<T>{
 const remaining=deadline-Date.now();if(remaining<=0)throw Error('Read timed out');let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([Promise.resolve(promise),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Read timed out')),remaining);})]);}
 finally{clearTimeout(timer!);}
}

/** Local review lifetime. The canonical native writer owns grants and atomic audit receipts. */
export function useOwnerResourceShares(scope:ResourceScope|null){
 const boundary=useRef(scope);if(!same(boundary.current,scope))boundary.current=scope;
 const incarnation=boundary.current;
 const [state,setState]=useState({boundary:incarnation,value:initial()});
 const actions=useRef<{load:(append?:boolean)=>Promise<void>;review:(id:string,available:boolean)=>Promise<void>;confirm:()=>Promise<void>;recover:()=>Promise<void>;cancel:()=>void}|null>(null);
 useEffect(()=>{
  let alive=true,retired=false,request=0,writing=false,offset=0;
  let model=initial(),pending:{proposal:ShareProposal;operation:string}|null=null;
  const current=(mine:number)=>alive&&!retired&&boundary.current===incarnation&&mine===request;
  const publish=(value:Model)=>{model=value;if(alive&&boundary.current===incarnation)setState({boundary:incarnation,value});};
  if(!incarnation){publish({...initial(),phase:'unavailable',notice:'Select the current authorized business to manage resources.'});return()=>{alive=false;};}
  const verify=async(deadline:number)=>{
   const value=await wait(supabase.auth.getUser(),deadline);
   if(value.error||value.data.user?.id!==incarnation.actor)throw new ResourceError('42501');
  };
  const load=async(append=false)=>{
   if(!alive||retired||writing||pending||boundary.current!==incarnation)return;
   const mine=++request,deadline=Date.now()+20_000,from=append?offset:0,previous=append?model.rows:[];
   publish({...model,phase:'loading',proposal:null,outcome:'list',notice:''});
   try{
    await verify(deadline);if(!current(mine))return;
    const value=await wait(listOwnerResourceShares(sdk,incarnation,from),deadline);if(!current(mine))return;
    await verify(deadline);if(!current(mine))return;
    offset=value.nextOffset;const rows=Array.from(new Map([...previous,...value.shares].map(row=>[row.share_id,row])).values());
    publish({phase:'ready',rows,hasMore:value.hasMore,proposal:null,outcome:'list',notice:''});
   }catch(error){if(current(mine))publish({...initial(),phase:error instanceof ResourceError&&error.code==='42501'?'unavailable':'error',notice:'Resource access could not be checked. Reload before making a change.'});}
  };
  const review=async(id:string,available:boolean)=>{
   if(!alive||retired||writing||pending||model.phase!=='ready'||boundary.current!==incarnation)return;
   const mine=++request,deadline=Date.now()+20_000;publish({...model,outcome:'preparing',proposal:null,notice:''});
   try{
    await verify(deadline);if(!current(mine))return;
    const proposal=await wait(prepareResourceShare(sdk,incarnation,id,available),deadline);if(!current(mine))return;
    await verify(deadline);if(!current(mine))return;
    if(!available&&proposal.expected_share_revision<1)throw new ResourceError('40001');
    publish({...model,outcome:'review',proposal,notice:''});
   }catch{if(current(mine))publish({...model,outcome:'refused',proposal:null,notice:'This saved resource or your access changed. Reload the resources before reviewing again.'});}
  };
  const reconcile=async(attempt:NonNullable<typeof pending>,mine:number,deadline:number)=>{
   let from=0;const rows:OwnerResourceShare[]=[];
   // Bounded scoped readback, never a second mutation or an absence-as-failure claim.
   for(let page=0;page<10;page++){
    const value=await wait(listOwnerResourceShares(sdk,incarnation,from),deadline);if(!current(mine))return false;
    rows.push(...value.shares);const row=value.shares.find(r=>r.document_id===attempt.proposal.document_id);
    if(row||!value.hasMore||page===9){
     await verify(deadline);if(!current(mine))return false;
     offset=value.nextOffset;const exact=row?.receipt_id===attempt.operation&&row.share_revision===attempt.proposal.expected_share_revision+1
      &&row.document_revision===attempt.proposal.document_revision&&row.generation_id===attempt.proposal.generation_id
      &&row.source_fingerprint===attempt.proposal.source_fingerprint&&(attempt.proposal.available?row.revoked_at===null:row.revoked_at!==null);
     if(!exact){publish({...model,rows,hasMore:value.hasMore,outcome:'unknown',notice:'This change could not be confirmed from its saved receipt. Current resource settings are shown. Check again before making another change.'});return false;}
     pending=null;publish({...model,rows,hasMore:value.hasMore,outcome:'saved',proposal:null,notice:attempt.proposal.available
      ?row.currently_available?'Resource shared with this customer.':'Sharing was recorded, but the saved source has since changed. Review the latest version.'
      :'Resource access withdrawn. The original document and private conversation are retained.'});return true;
    }
    from=value.nextOffset;
   }
   return false;
  };
  const confirm=async()=>{
   if(!alive||retired||writing||pending||model.outcome!=='review'||!model.proposal||model.proposal.already_shared||boundary.current!==incarnation)return;
   const attempt={proposal:model.proposal,operation:crypto.randomUUID()},mine=++request,deadline=Date.now()+20_000;
   writing=true;pending=attempt;let dispatched=false,received=false;publish({...model,outcome:'saving',notice:''});
   try{
    await verify(deadline);if(!current(mine))return;
    dispatched=true;await wait(commitResourceShare(sdk,incarnation,attempt.proposal,attempt.operation),deadline);received=true;if(!current(mine))return;
    await reconcile(attempt,mine,deadline);
   }catch(error){if(current(mine)){
    const rejected=!received&&error instanceof ResourceError&&['42501','40001','22023'].includes(error.code);
    if(!dispatched||rejected){pending=null;publish({...model,outcome:rejected&&error.code==='40001'?'conflict':'refused',proposal:null,notice:'The change was not accepted. Reload and review the current saved resource before trying again.'});}
    else publish({...model,outcome:'unknown',notice:'The response was interrupted. This change may already be saved. Check its saved status before making another change.'});
   }}finally{writing=false;}
  };
  const recover=async()=>{
   if(!alive||retired||writing||!pending||boundary.current!==incarnation)return;
   const attempt=pending,mine=++request,deadline=Date.now()+20_000;writing=true;publish({...model,outcome:'saving',notice:'Checking the saved operation…'});
   try{await verify(deadline);if(current(mine))await reconcile(attempt,mine,deadline);}
   catch{if(current(mine))publish({...model,outcome:'unknown',notice:'Saved status is still unconfirmed. Check your connection and try the status check again.'});}
   finally{writing=false;}
  };
  const cancel=()=>{if(!alive||retired||writing||pending||boundary.current!==incarnation)return;++request;publish({...model,outcome:'list',proposal:null,notice:''});};
  actions.current={load,review,confirm,recover,cancel};
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   if(!alive||boundary.current!==incarnation)return;
   if(event==='SIGNED_OUT'||!session||session.user.id!==incarnation.actor){retired=true;++request;pending=null;publish({...initial(),phase:'unavailable',notice:'Your account changed. Reopen resources in the current business.'});return;}
   // Same-actor token rotation does not discard the exact pending operation.
  });
  const focus=()=>{if(alive&&!retired&&!writing&&!pending&&model.outcome!=='review')void load();};window.addEventListener('focus',focus);void load();
  return()=>{alive=false;++request;pending=null;subscription.unsubscribe();window.removeEventListener('focus',focus);};
 },[incarnation]);
 const load=useCallback(()=>actions.current?.load()??Promise.resolve(),[]),loadMore=useCallback(()=>actions.current?.load(true)??Promise.resolve(),[]);
 const review=useCallback((id:string,available=true)=>actions.current?.review(id,available)??Promise.resolve(),[]);
 const confirm=useCallback(()=>actions.current?.confirm()??Promise.resolve(),[]),recover=useCallback(()=>actions.current?.recover()??Promise.resolve(),[]),cancel=useCallback(()=>actions.current?.cancel(),[]);
 return {...(state.boundary===incarnation?state.value:initial()),load,loadMore,review,confirm,recover,cancel};
}
