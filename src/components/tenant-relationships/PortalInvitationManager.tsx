import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useTenantContext} from '@/hooks/useTenantContext';
import {useTierFeatures} from '@/hooks/useTierFeatures';
import type {RelationshipPerson} from './useTenantRelationshipsData';
import type {PortalInvitation} from './portalDashboardModel';
import {PortalInvitationCommand} from './PortalInvitationCommand';
import {portalInvitationUiDeadline as bounded} from './portalInvitationUiDeadline';

export type PortalInvitationActionLock={pending:ReadonlySet<string>;acquire:(key:string)=>(()=>void)|null};

/** Shared command for sends; preserve exact pending-token cancellation, never Auth administration. */
export function PortalInvitationManager({tenantId,person,latest,onReadback,actionLock}:{tenantId:string;person:RelationshipPerson;latest:PortalInvitation|undefined;onReadback:()=>Promise<unknown>;actionLock?:PortalInvitationActionLock}){
 const {activeUserId,activeTenantId,accountContextStatus,accountContextLoading}=useTenantContext(),{has}=useTierFeatures();
 const key=JSON.stringify([activeUserId,activeTenantId,person.id,accountContextStatus,accountContextLoading]);
 const generation=useRef({key,revision:0});if(generation.current.key!==key)generation.current={key,revision:generation.current.revision+1};
 const scope=key+':'+generation.current.revision;
 const [saved,setSaved]=useState<{scope:string;busy:boolean;result?:{error:boolean;text:string}}>({scope,busy:false});
 const {busy,result}=saved.scope===scope?saved:{busy:false,result:undefined};
 const alive=useRef(true),inFlight=useRef<string|null>(null),currentScope=useRef(scope);
 currentScope.current=scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const ready=!accountContextLoading&&accountContextStatus==='ready'&&activeTenantId===tenantId&&!!activeUserId&&has('customer_portal_invite');
 const pending=latest&&!latest.revoked_at&&!latest.last_used_at&&Date.parse(latest.expires_at)>Date.now();
 const eligible=ready&&!!person.email&&!person.doNotContact&&!person.linkedUserId&&person.status==='active';
 const actionKey=JSON.stringify([activeUserId,tenantId,person.id]),actionBusy=busy||!!actionLock?.pending.has(actionKey);
 const cancel=async()=>{
  if(inFlight.current===scope||!ready||!pending||!latest)return;
  const release=actionLock?.acquire(actionKey);if(actionLock&&!release)return;
  inFlight.current=scope;const started=scope,current=()=>alive.current&&currentScope.current===started;
  const setResult=(result:{error:boolean;text:string})=>setSaved({scope,busy:true,result});
  setSaved({scope,busy:true});
  try{
   const auth=await bounded(supabase.auth.getUser());if(!current())return;
   if(auth.error||auth.data.user?.id!==activeUserId)throw Error('Sign in again before managing this invitation.');
   const r=await bounded(supabase.from('tenant_invite_tokens').update({revoked_at:new Date().toISOString()})
    .eq('id',latest.id).eq('tenant_id',tenantId).eq('contact_id',person.id).eq('kind','consumer').is('revoked_at',null).is('last_used_at',null).select('id'));
   if(!current())return;if(r.error||r.data?.length!==1)throw Error('The invitation changed. Refresh its status before trying again.');
   setResult({error:false,text:'Invitation canceled. The pending invitation link has been revoked.'});
  }catch{if(current())setResult({error:true,text:'Cancellation could not be confirmed. Refresh invitation history before another action.'})}
  finally{
   try{if(current())await bounded(onReadback())}catch{if(current())setSaved(previous=>previous.scope===started?{...previous,result:{error:true,text:(previous.result?.text??'Cancellation could not be confirmed.')+' Current invitation history could not reload.'}}:previous)}
   finally{release?.();if(inFlight.current===started)inFlight.current=null;if(current())setSaved(previous=>previous.scope===started?{...previous,busy:false}:previous)}
  }
 };
 return <section className="opd-invitation" aria-label={`Invitation for ${person.name}`}>
  {!person.email&&<p>Add an email address on the client record before inviting them.</p>}
  {person.doNotContact&&<p>This client’s contact preferences prevent an invitation email.</p>}
  {person.status!=='active'&&<p>Only active client records can receive invitations. Review this client’s status in People.</p>}
  {person.linkedUserId&&<p>An account is linked to this contact. That does not confirm a portal visit.</p>}
  {latest&&<p>Latest invitation: {latest.last_used_at?'accepted':latest.revoked_at?'canceled':pending?'pending':'expired'}. Expires {new Date(latest.expires_at).toLocaleDateString()}.</p>}
  <PortalInvitationCommand tenantId={tenantId} contactId={person.id} eligible={eligible} onReadback={onReadback} actionLock={actionLock}/>
  {pending&&<button className="opd-button" type="button" disabled={actionBusy||!ready} onClick={()=>void cancel()}>Cancel pending invitation</button>}
  {result&&<p role={result.error?'alert':'status'}>{result.text}</p>}
 </section>;
}
