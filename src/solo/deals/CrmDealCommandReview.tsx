import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useTenantContext} from '@/hooks/useTenantContext';

type Props={tenantId:string;command:Record<string,unknown>;onComplete(result:Record<string,unknown>):void;onClose():void};
type Operation={tenantId:string;actorId:string;command:Record<string,unknown>;key:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** A caller of crm-command's existing Trust/confirmation/Rail path, never an approval store. */
export function CrmDealCommandReview(props:Props){
 const [actor,setActor]=React.useState<string|null>(null),[loaded,setLoaded]=React.useState(false);
 React.useEffect(()=>{let alive=true;void supabase.auth.getSession().then(({data})=>{if(alive){setActor(data.session?.user.id??null);setLoaded(true)}}).catch(()=>{if(alive)setLoaded(true)});return()=>{alive=false}},[]);
 if(!loaded)return <p role="status">Checking your account…</p>;
 if(!actor)return <p role="alert">Sign in again before changing an opportunity.</p>;
 return <DealReview key={`${actor}:${props.tenantId}`} {...props} actorId={actor}/>;
}
function DealReview({tenantId,command,onComplete,onClose,actorId}:Props&{actorId:string}){
 const {activeTenantId,accountContextLoading}=useTenantContext();
 const storageKey=`paige:deal-operation:${actorId}:${tenantId}`;
 const operation=React.useRef<Operation>({tenantId,actorId,command,key:crypto.randomUUID()}),initialized=React.useRef(false),restored=React.useRef(false);
 if(!initialized.current){initialized.current=true;try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.tenantId===tenantId&&saved.actorId===actorId&&typeof saved.key==='string'&&saved.key.length>0&&saved.key.length<=192&&object(saved.command)&&['deal.create','deal.assign_contact'].includes(String(saved.command.action))){operation.current=saved;restored.current=true;}}catch{/* Browser state grants no authority. */}}
 const [busy,setBusy]=React.useState(false),[unknown,setUnknown]=React.useState(restored.current),[proposal,setProposal]=React.useState<Record<string,unknown>|null>(null),[notice,setNotice]=React.useState('');
 const alive=React.useRef(true),latest=React.useRef({tenantId:activeTenantId,loading:accountContextLoading});latest.current={tenantId:activeTenantId,loading:accountContextLoading};
 React.useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const forget=()=>{try{sessionStorage.removeItem(storageKey)}catch{/* Retained memory still owns the operation. */}};
 const execute=async()=>{
  if(busy||latest.current.loading||latest.current.tenantId!==tenantId)return;
  const original=operation.current;setBusy(true);setNotice('');
  try{
   const session=await supabase.auth.getSession();if(session.data.session?.user.id!==actorId){setNotice('Account changed. Reopen the opportunity in the current account.');return;}
   if(latest.current.loading||latest.current.tenantId!==tenantId)return;
   try{sessionStorage.setItem(storageKey,JSON.stringify(original))}catch{/* In-memory retry retains exact inputs. */}
   let {data,error}=await supabase.functions.invoke('crm-command',{body:{expected_tenant_id:tenantId,command:original.command,idempotency_key:original.key,...(proposal&&!unknown?{approved_fingerprint:proposal.fingerprint}:{})}});
   if(error&&'context' in error&&error.context instanceof Response){try{data=await error.context.json();error=null}catch{/* Response body unavailable. */}}
   const readbackSession=await supabase.auth.getSession();
   if(!alive.current)return;
   if(latest.current.loading||latest.current.tenantId!==tenantId||readbackSession.data.session?.user.id!==actorId){setUnknown(true);setProposal(null);setNotice("Account or workspace changed while the action ran. Its result requires recovery in the original account.");return;}
   if(!error&&data?.outcome==='approval_required'&&typeof data.fingerprint==='string'){setProposal(data);setUnknown(false);return;}
   if(!error&&data?.ok===true&&object(data.readback)&&typeof data.readback.id==='string'&&(!original.command.contact_id||data.readback.contact_id===original.command.contact_id)&&(!original.command.unlinked_reason||data.readback.contact_id==null)&&(!original.command.deal_id||data.readback.id===original.command.deal_id)){forget();onComplete(data);return;}
   const uncertain=!!error||!data||data.outcome_unknown===true||data.ok===true;
   setUnknown(uncertain);setProposal(null);if(!uncertain)forget();setNotice(uncertain?'The result is unknown. Recover the original action before starting another.':typeof data.message==='string'?data.message:'The action was refused. Refresh the record and try again.');
  }catch{if(alive.current){setUnknown(true);setProposal(null);setNotice('The result is unknown. Recover the original action.');}}
  finally{if(alive.current)setBusy(false)}
 };
 const actionButton=React.useRef<HTMLButtonElement>(null);
 const changed=activeTenantId!==tenantId||accountContextLoading;
 React.useEffect(()=>{if(!busy&&!changed)actionButton.current?.focus()},[busy,changed]);
 return <section className="pipeline-relationship-review" aria-busy={busy}>
  {restored.current&&<p role="status">An earlier opportunity action needs recovery. The newly requested action has not started.</p>}
  <p>{typeof proposal?.summary==='string'?proposal.summary:'Continue through the current approval policy for this exact opportunity action.'}</p>
  {notice&&<p role="alert">{notice}</p>}{changed&&<p role="alert">Workspace changed. Reopen the opportunity in the intended workspace.</p>}
  <div className="pipeline-relationship-actions"><button ref={actionButton} className="btn btn-p" disabled={busy||changed} onClick={execute}>{busy?'Checking…':unknown?'Recover original action':proposal?'Approve action':'Continue'}</button><button className="btn btn-s" disabled={busy} onClick={()=>{if(!unknown)forget();onClose()}}>{unknown?'Close · recovery retained':'Back to details'}</button></div>
 </section>;
}
