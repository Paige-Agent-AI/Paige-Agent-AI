import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useTenantContext} from '@/hooks/useTenantContext';
import {useTierFeatures} from '@/hooks/useTierFeatures';
import {PaigeConfirmCard} from '@/components/chat/PaigeConfirmCard';
import type {PortalInvitationActionLock} from './PortalInvitationManager';
import {portalInvitationUiDeadline as bounded} from './portalInvitationUiDeadline';

type Phase='idle'|'preparing'|'review'|'working'|'accepted'|'uncertain'|'refused'|'session';
type Proposal={fingerprint:string;summary:string;operation:string;expires:string};
type State={scope:string;phase:Phase;proposal?:Proposal;operation?:string;note?:string};
type Data=Record<string,unknown>;
const object=(v:unknown):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const exact=(v:Data,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
class SessionRequired extends Error{}
const sessionNote='Sign in again with this business account, then reopen this invitation for a fresh review. Check the original invitation status before continuing.';

/** UI projection only: recipient, approval, preparation and sending belong to the common door. */
export function PortalInvitationCommand({tenantId,contactId,eligible,onReadback,actionLock}:{tenantId:string;contactId:string;eligible:boolean;onReadback:()=>Promise<unknown>;actionLock?:PortalInvitationActionLock}){
 const context=useTenantContext(),{has}=useTierFeatures();
 const key=JSON.stringify([context.activeUserId,context.activeTenantId,tenantId,contactId,context.accountContextStatus,context.accountContextLoading]);
 const generation=useRef({key,revision:0});
 if(generation.current.key!==key)generation.current={key,revision:generation.current.revision+1};
 const scope=key+':'+generation.current.revision;
 const currentScope=useRef(scope),alive=useRef(true),inFlight=useRef<string|null>(null),reviewButton=useRef<HTMLButtonElement>(null),surface=useRef<HTMLDivElement>(null);
 currentScope.current=scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const [saved,setSaved]=useState<State>({scope,phase:'idle'}),state=saved.scope===scope?saved:{scope,phase:'idle' as const};
 useEffect(()=>{
  if(state.phase!=='review')return;
  const active=document.activeElement,dialog=surface.current?.closest('[role="dialog"]');
  // The native dialog may recover focus when the preparing button retires.
  // Move that fallback to the review card, without stealing another input.
  if(active===document.body||(dialog&&active===dialog))surface.current?.querySelector<HTMLElement>('[role="group"][data-card-mode="decide"]')?.focus({preventScroll:true});
 },[state.phase,state.proposal?.fingerprint,scope]);
 const ready=!context.accountContextLoading&&context.accountContextStatus==='ready'&&context.activeTenantId===tenantId&&!!context.activeUserId&&has('customer_portal_invite');
 const actionKey=JSON.stringify([context.activeUserId,tenantId,contactId]);
 const [reading,setReading]=useState<string|null>(null);
 const busy=state.phase==='preparing'||state.phase==='working'||reading===scope||!!actionLock?.pending.has(actionKey);
 const set=(value:Omit<State,'scope'>)=>setSaved({scope,...value});
 const authCurrent=async()=>{const r=await bounded(supabase.auth.getUser());return !r.error&&r.data.user?.id===context.activeUserId};

 const act=async(proposal?:Proposal,fresh=false)=>{
  if(inFlight.current===scope||!ready||!eligible)return;
  if(proposal&&Date.parse(proposal.expires)<=Date.now()){set({phase:'idle',note:'This review expired. Review the current invitation again.'});return}
  const release=actionLock?.acquire(actionKey);if(actionLock&&!release)return;
  inFlight.current=scope;
  const started=scope,current=()=>alive.current&&currentScope.current===started;
  let operation=proposal?.operation??(fresh?undefined:state.operation);
  let requested=false,historyRequested=false;
  try{
   operation??=crypto.randomUUID();
   set({phase:proposal?'working':'preparing',operation,proposal});
   if(!await authCurrent())throw new SessionRequired();if(!current())return;
   requested=true;
   const result=await bounded(supabase.functions.invoke('send-portal-invite',{body:{expected_tenant_id:tenantId,contact_id:contactId,operation_id:operation,...(proposal?{approved_fingerprint:proposal.fingerprint}:{})}}));
   let value:unknown=result.data;
   if(result.error){const error=result.error as {context?:{status?:number;json?:()=>Promise<unknown>}};if(error.context?.status===401)throw new SessionRequired();if(!error.context?.json)throw Error('unanswered');value=await bounded(error.context.json())}
   if(!current())return;if(!object(value))throw Error('invalid');
   if(value.code==='UNAUTHENTICATED')throw new SessionRequired();
   const actual=uuid(value.operation_id)?value.operation_id:uuid(value.delivery_operation_id)?value.delivery_operation_id:operation;
   if(proposal&&actual!==proposal.operation)throw Error('changed_operation');
   if(value.outcome==='approval_required'){
    if(value.capability!=='client_portal_invitation_send'||typeof value.fingerprint!=='string'||!/^[0-9a-f]{16}$/.test(value.fingerprint)
      ||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>1200||!uuid(value.operation_id)||typeof value.expires_at!=='string'||Date.parse(value.expires_at)<=Date.now()||!Number.isFinite(Date.parse(value.expires_at)))throw Error('invalid_review');
    set({phase:'review',operation:actual,proposal:{fingerprint:value.fingerprint,summary:value.summary,operation:actual,expires:value.expires_at}});
    return; // Preparing the approval did not change invitation/email history.
   }else if(value.ok===true&&value.outcome==='provider_accepted'&&uuid(value.invitation_id)&&uuid(value.receipt_id)){
    set({phase:'accepted',operation:actual,proposal:proposal??state.proposal,note:'The email provider accepted the invitation. Delivery and customer acceptance are separate.'});
   }else if(['refused','failed','held'].includes(String(value.outcome))){
    set({phase:'refused',operation:actual,proposal:proposal??state.proposal,note:'This action was held or not accepted for sending. Check the invitation history before another action.'});
   }else set({phase:'uncertain',operation:actual,proposal:proposal??state.proposal,note:'The original invitation result could not be confirmed. Check status before reviewing recovery.'});
   try{historyRequested=true;await bounded(onReadback())}catch{if(current())setSaved(previous=>previous.scope===started?{...previous,note:`${previous.note??'The invitation review is available.'} Invitation history could not reload. Refresh history before another action.`}:previous)}
  }catch(error){
   if(current())set(error instanceof SessionRequired?{phase:'session',operation,note:sessionNote}:{phase:proposal?'uncertain':'idle',operation,proposal,note:proposal?'The original request may have completed. Check status before reviewing recovery.':'The invitation review could not be loaded. Refresh history and review again; no new email was requested by this review.'});
  }finally{
   // Closing a control cannot retire an already submitted effect. Keep the
   // shared lock through its scoped history refresh, including a lost response.
   try{if(proposal&&requested&&!historyRequested&&!alive.current&&currentScope.current===started)await bounded(onReadback())}catch{/* The result remains unconfirmed; never retry the send here. */}
   finally{release?.();if(inFlight.current===started)inFlight.current=null}
  }
 };
 const check=async()=>{
  if(inFlight.current===scope||!ready)return;inFlight.current=scope;setReading(scope);
  const started=scope,current=()=>alive.current&&currentScope.current===started;
  try{
   if(!await authCurrent())throw new SessionRequired();if(!current())return;
   if(state.operation&&state.phase!=='idle'){
    const r=await bounded(supabase.rpc('read_client_portal_invitation_delivery' as never,{p_tenant_id:tenantId,p_operation_id:state.operation} as never));
    const v:unknown=r.data;
    if(r.error||!object(v)||v.actor_id!==context.activeUserId||v.tenant_id!==tenantId||v.operation_id!==state.operation)throw Error('read');
    if(!current())return;
    if(v.found===false&&exact(v,['actor_id','tenant_id','operation_id','found']))set({phase:'uncertain',operation:state.operation,proposal:state.proposal,note:'No delivery result is recorded for this attempt yet. Review recovery to continue the original invitation.'});
    else{
     if(v.found!==true||!exact(v,['actor_id','tenant_id','operation_id','found','invitation_id','receipt_id','requested_by','reconciled_by','outcome','provider_message_id','observed_at'])
       ||!uuid(v.invitation_id)||!uuid(v.receipt_id)||!uuid(v.requested_by)||!uuid(v.reconciled_by)||typeof v.observed_at!=='string'||!Number.isFinite(Date.parse(v.observed_at)))throw Error('receipt');
     if(v.outcome==='provider_accepted'&&typeof v.provider_message_id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v.provider_message_id))set({phase:'accepted',operation:state.operation,proposal:state.proposal,note:'The original email provider acceptance is recorded. Delivery and customer acceptance are separate.'});
     else if(['failed','refused'].includes(String(v.outcome))&&v.provider_message_id===null)set({phase:'refused',operation:state.operation,proposal:state.proposal,note:'The original attempt was held or not accepted for sending. Review the invitation history before another action.'});
     else if(['pending','outcome_unknown'].includes(String(v.outcome))&&v.provider_message_id===null)set({phase:'uncertain',operation:state.operation,proposal:state.proposal,note:'Status checked. The original send remains unconfirmed; no new email was requested.'});
     else throw Error('receipt');
    }
   }
   await bounded(onReadback());
  }catch(error){if(current())setSaved(previous=>previous.scope===started?(error instanceof SessionRequired?{scope:started,phase:'session',operation:previous.operation,note:sessionNote}:{...previous,note:'Current invitation status could not be checked. Do not resend automatically; try this read-only status check again.'}):previous)}
  finally{if(inFlight.current===started)inFlight.current=null;setReading(previous=>previous===started?null:previous)}
 };
 const summary=state.proposal?.summary??'Invitation to this customer’s portal.';
 return <div ref={surface} aria-busy={busy}>
  {(state.phase==='idle'||state.phase==='preparing')&&<button ref={reviewButton} type="button" className="opd-button opd-primary" disabled={busy||!ready||!eligible} onClick={()=>void act()}>{state.phase==='preparing'?'Preparing review…':'Review invitation'}</button>}
  {state.phase==='review'&&state.proposal&&<PaigeConfirmCard key={`review:${state.proposal.fingerprint}`} focusOnMount disabled={busy||!ready||!eligible}
   actions={[{summary,fingerprint:state.proposal.fingerprint}]} onApprove={values=>{if(values.length===1&&values[0]===state.proposal?.fingerprint)void act(state.proposal)}}
   onDeny={()=>{set({phase:'idle',operation:state.operation});requestAnimationFrame(()=>reviewButton.current?.focus())}}/>}
  {['working','accepted','uncertain','refused'].includes(state.phase)&&<PaigeConfirmCard key={`${state.operation}:${state.phase}`} mode="report" focusOnMount
   actions={[{summary,state:state.phase==='working'?'working':state.phase==='accepted'?'done':state.phase==='uncertain'?'unconfirmed':'failed',note:state.phase==='working'?'Checking the original invitation…':state.note}]}
   check={<button type="button" className="opd-button" disabled={busy||!ready} onClick={()=>void check()}>{reading===scope?'Checking status…':'Check status'}</button>}/>}
  {state.phase==='uncertain'&&<button type="button" className="opd-button" disabled={busy||!ready||!eligible} onClick={()=>void act()}>Review recovery</button>}
  {state.phase==='refused'&&<button type="button" className="opd-button" disabled={busy||!ready||!eligible} onClick={()=>void act(undefined,true)}>Review invitation again</button>}
  {state.phase==='accepted'&&<button type="button" className="opd-button" disabled={busy||!ready||!eligible} onClick={()=>void act(undefined,true)}>Review resend</button>}
  {(state.phase==='accepted'||state.phase==='idle')&&<button type="button" className="opd-button" disabled={busy||!ready} onClick={()=>void check()}>{reading===scope?'Refreshing…':'Refresh history'}</button>}
  {state.phase==='session'&&<div role="alert"><p>{state.note}</p><a className="opd-button" href={`/auth?mode=login&next=${encodeURIComponent(window.location.pathname+window.location.search)}`}>Sign in again</a></div>}
  {state.note&&(state.phase==='idle'||state.phase==='review')&&<p role="status">{state.note}</p>}
 </div>;
}
