import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {ResourceError} from '@/lib/customer-resources';
import {readKnowledge,type KnowledgeRpcClient} from '@/lib/knowledge-service';
import {commitCuraKnowledgeShare,curaShareMatches,prepareCuraKnowledgeShare,readCuraKnowledge,readCuraKnowledgeDraft,
 type CuraCorrectionTarget,type CuraKnowledgeScope,type CuraKnowledgeSource,type CuraShareProposal,type CuraShareTerms} from '@/lib/cura-knowledge';

type Outcome='list'|'preparing'|'review'|'saving'|'saved'|'unknown'|'conflict'|'refused'|'correction';
type Model={phase:'loading'|'ready'|'error'|'unavailable';rows:CuraKnowledgeSource[];hasMore:boolean;
 outcome:Outcome;proposal:Readonly<CuraShareProposal>|null;correction:CuraCorrectionTarget|null;notice:string;query:string;focusedId:string|null};
const initial=():Model=>({phase:'loading',rows:[],hasMore:false,outcome:'list',proposal:null,correction:null,notice:'',query:'',focusedId:null});
const same=(a:CuraKnowledgeScope|null,b:CuraKnowledgeScope|null)=>a===b||!!a&&!!b&&a.actor===b.actor&&a.tenant===b.tenant;
const sdk:KnowledgeRpcClient={rpc:(name,args)=>supabase.rpc(name as never,args as never) as unknown as ReturnType<KnowledgeRpcClient['rpc']>};
const extractionSdk={...sdk,functions:{invoke:(name:string,options:{body:Record<string,unknown>})=>supabase.functions.invoke(name,options)}};
async function wait<T>(promise:PromiseLike<T>,deadline:number):Promise<T>{
 const remaining=deadline-Date.now();if(remaining<=0)throw Error('Request timed out');let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([Promise.resolve(promise),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Request timed out')),remaining);})]);}
 finally{clearTimeout(timer!);}
}
type Actions={load:(query?:string,append?:boolean,documentId?:string|null)=>Promise<void>;review:(id:string,available:boolean,terms:CuraShareTerms)=>Promise<void>;
 correct:(id:string)=>Promise<void>;confirm:()=>Promise<void>;recover:()=>Promise<void>;cancel:()=>void;leave:()=>void};

/** Ephemeral review state only. Existing Knowledge publication, K1 grants and atomic
 * audit receipts are authoritative. A lost write response is followed by reads only. */
export function useCuraKnowledge(scope:CuraKnowledgeScope|null,initialDocumentId:string|null=null){
 const boundary=useRef(scope);if(!same(boundary.current,scope))boundary.current=scope;
 const reference=useRef(initialDocumentId);
 if(reference.current!==initialDocumentId){reference.current=initialDocumentId;boundary.current=scope?{...scope}:null;}
 const incarnation=boundary.current;
 const [state,setState]=useState({boundary:incarnation,value:initial()});
 const actions=useRef<Actions|null>(null);
 useEffect(()=>{
  let alive=true,retired=false,request=0,working=false,offset=0;
  let model=initial(),pending:{proposal:Readonly<CuraShareProposal>;operation:string}|null=null;
  const current=(mine:number)=>alive&&!retired&&boundary.current===incarnation&&mine===request;
  const publish=(value:Model)=>{model=value;if(alive&&boundary.current===incarnation)setState({boundary:incarnation,value});};
  if(!incarnation){publish({...initial(),phase:'unavailable',notice:'Select your current authorized business to teach CURA.'});return()=>{alive=false;};}
  const verify=async(deadline:number)=>{
   const value=await wait(supabase.auth.getUser(),deadline);
   if(value.error)throw Error('Session could not be checked');
   if(value.data.user?.id!==incarnation.actor)throw new ResourceError('42501');
  };
  const lostAccess=()=>{retired=true;++request;pending=null;publish({...initial(),phase:'unavailable',notice:'Your account or permission changed. An interrupted change may already be saved. Reopen this business and inspect its recorded sharing.'});};
  const load=async(query=model.query,append=false,documentId=model.focusedId)=>{
   if(!alive||retired||working||pending||boundary.current!==incarnation)return;
   const mine=++request,deadline=Date.now()+20_000,from=append?offset:0,previous=append?model.rows:[];
   publish({...model,phase:'loading',outcome:'list',proposal:null,correction:null,notice:'',query,focusedId:documentId});
   try{
    await verify(deadline);if(!current(mine))return;
    const value=await wait(readCuraKnowledge(sdk,incarnation,{query,offset:from,documentId:documentId??undefined}),deadline);if(!current(mine))return;
    await verify(deadline);if(!current(mine))return;
    offset=value.nextOffset;
    publish({...initial(),phase:'ready',query,focusedId:documentId,rows:Array.from(new Map([...previous,...value.documents].map(row=>[row.document_id,row])).values()),hasMore:value.hasMore});
   }catch(error){if(current(mine))publish({...initial(),query,focusedId:documentId,phase:error instanceof ResourceError&&error.code==='42501'?'unavailable':'error',notice:'Knowledge sharing could not be checked. Check your account and connection, then reload.'});}
  };
  const review=async(id:string,available:boolean,terms:CuraShareTerms)=>{
   if(!alive||retired||working||pending||model.phase!=='ready'||boundary.current!==incarnation)return;
   const mine=++request,deadline=Date.now()+20_000;publish({...model,outcome:'preparing',proposal:null,correction:null,notice:''});
   try{
    await verify(deadline);if(!current(mine))return;
    const proposal=await wait(prepareCuraKnowledgeShare(sdk,incarnation,id,available,terms),deadline);if(!current(mine))return;
    await verify(deadline);if(current(mine))publish({...model,outcome:'review',proposal});
   }catch(error){if(current(mine))publish({...model,outcome:'refused',proposal:null,notice:error instanceof ResourceError&&error.code==='42501'
    ?'This account cannot publish customer Knowledge in this business.'
    :'This source or its sharing terms changed. Reload and review the latest saved version.'});}
  };
  const correct=async(id:string)=>{
   if(!alive||retired||working||pending||model.phase!=='ready'||boundary.current!==incarnation)return;
   const row=model.rows.find(item=>item.document_id===id);if(!row)return;
   const mine=++request,deadline=Date.now()+20_000;publish({...model,outcome:'preparing',proposal:null,correction:null,notice:''});
   try{
    await verify(deadline);if(!current(mine))return;
    const docs=row.source_state==='draft'
     ?[await wait(readCuraKnowledgeDraft(extractionSdk,incarnation,row,()=>current(mine)),deadline)]
     :await wait(readKnowledge(sdk,incarnation.tenant,{documentId:id}),deadline);
    if(!current(mine))return;
    await verify(deadline);if(!current(mine))return;
    const doc=docs.length===1?docs[0]:null;
    if(!doc||doc.id!==id||doc.revision!==row.document_revision||typeof doc.content!=='string')throw new ResourceError('40001');
    publish({...model,outcome:'correction',correction:doc});
   }catch{if(current(mine))publish({...model,outcome:'conflict',correction:null,notice:'The saved source could not be verified. Reload before correcting or publishing it.'});}
  };
  const reconcile=async(attempt:NonNullable<typeof pending>,mine:number,deadline:number)=>{
   const value=await wait(readCuraKnowledge(sdk,incarnation,{documentId:attempt.proposal.document_id}),deadline);if(!current(mine))return;
   await verify(deadline);if(!current(mine))return;
   const row=value.documents[0],rows=row?model.rows.map(old=>old.document_id===row.document_id?row:old):model.rows;
   if(!row||!curaShareMatches(row,attempt.proposal,attempt.operation)){
    publish({...model,rows,outcome:'unknown',notice:'The original receipt could not be confirmed. This change may already be saved. Check again before making another change.'});return;
   }
   pending=null;
   const detail=attempt.proposal.available
    ?row.share_state==='shared'?'CURA can use this approved source for authorized customers.'
     :row.share_state==='scheduled'?'Sharing is recorded for the scheduled start. CURA cannot use it before then.'
     :row.share_state==='expired'?'Sharing was recorded, but its end date has passed. CURA cannot use it now.'
     :'Sharing was recorded, but the source or eligibility has since changed. Review its current status.'
    :'Future CURA access through this business-wide share is withdrawn. Customer-specific shares are managed separately.';
   publish({...model,rows,outcome:'saved',proposal:null,notice:detail});
  };
  const confirm=async()=>{
   if(!alive||retired||working||pending||model.outcome!=='review'||!model.proposal||model.proposal.already_shared||boundary.current!==incarnation)return;
   const attempt={proposal:model.proposal,operation:crypto.randomUUID()},mine=++request,deadline=Date.now()+20_000;
   pending=attempt;working=true;let dispatched=false,received=false;publish({...model,outcome:'saving',notice:''});
   try{
    await verify(deadline);if(!current(mine))return;
    dispatched=true;await wait(commitCuraKnowledgeShare(sdk,incarnation,attempt.proposal,attempt.operation),deadline);received=true;if(!current(mine))return;
    await reconcile(attempt,mine,deadline);
   }catch(error){if(current(mine)){
    const refused=!received&&error instanceof ResourceError&&['42501','40001','22023'].includes(error.code);
    if(received&&error instanceof ResourceError&&error.code==='42501')lostAccess();
    else if(!dispatched||refused){pending=null;publish({...model,outcome:refused&&error.code==='40001'?'conflict':'refused',proposal:null,notice:'The change was not accepted. Reload and review current Knowledge before trying again.'});}
    else publish({...model,outcome:'unknown',notice:'The response was interrupted. This change may already be saved. Check its original receipt; no retry has been sent.'});
   }}finally{working=false;}
  };
  const recover=async()=>{
   if(!alive||retired||working||!pending||boundary.current!==incarnation)return;
   const attempt=pending,mine=++request,deadline=Date.now()+20_000;working=true;publish({...model,outcome:'saving',notice:'Checking the original saved receipt…'});
   try{await verify(deadline);if(current(mine))await reconcile(attempt,mine,deadline);}
   catch(error){if(current(mine)){if(error instanceof ResourceError&&error.code==='42501')lostAccess();else publish({...model,outcome:'unknown',notice:'Saved status is still unconfirmed. Check your connection and try the status check again.'});}}
   finally{working=false;}
  };
  const cancel=()=>{
   if(!alive||retired||working||pending||boundary.current!==incarnation)return;
   // Closing the original publication dialog must not invalidate an inventory
   // read and strand its loading phase. Other review work is cancellable.
   if(model.phase!=='loading')++request;
   publish({...model,outcome:'list',proposal:null,correction:null,notice:''});
  };
  // Explicit exit never retries a mutation or pretends the uncertain change failed.
  const leave=()=>{if(!alive||working||boundary.current!==incarnation)return;retired=true;++request;pending=null;publish({...initial(),phase:'unavailable',notice:'Status check closed. Review recorded sharing when you return; the earlier change may have been saved.'});};
  actions.current={load,review,correct,confirm,recover,cancel,leave};
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   if(!alive||boundary.current!==incarnation)return;
   if(event==='SIGNED_OUT'||!session||session.user.id!==incarnation.actor)lostAccess();
  });
  const focus=()=>{if(alive&&!retired&&!working&&!pending&&!['review','preparing','correction'].includes(model.outcome))void load();};
  window.addEventListener('focus',focus);void load('',false,initialDocumentId);
  return()=>{alive=false;++request;pending=null;subscription.unsubscribe();window.removeEventListener('focus',focus);};
 },[incarnation,initialDocumentId]);
 const load=useCallback(()=>actions.current?.load()??Promise.resolve(),[]),search=useCallback((query:string)=>actions.current?.load(query,false,null)??Promise.resolve(),[]);
 const loadMore=useCallback(()=>actions.current?.load(undefined,true)??Promise.resolve(),[]);
 const review=useCallback((id:string,available:boolean,terms:CuraShareTerms)=>actions.current?.review(id,available,terms)??Promise.resolve(),[]);
 const correct=useCallback((id:string)=>actions.current?.correct(id)??Promise.resolve(),[]);
 const confirm=useCallback(()=>actions.current?.confirm()??Promise.resolve(),[]),recover=useCallback(()=>actions.current?.recover()??Promise.resolve(),[]);
 const cancel=useCallback(()=>actions.current?.cancel(),[]),leave=useCallback(()=>actions.current?.leave(),[]);
 return {...(state.boundary===incarnation?state.value:initial()),load,search,loadMore,review,correct,confirm,recover,cancel,leave};
}
