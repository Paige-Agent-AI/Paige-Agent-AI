import {useCallback, useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {Check, Lock, RefreshCw, X} from 'lucide-react';
import {useBeforeUnloadGuard} from '@/hooks/useBeforeUnloadGuard';
import {useClientPrivateRequest} from '@/hooks/useClientPrivateRequest';
import type {OwnerActionScope} from '@/hooks/useClientActionsOwner';
import './client-private-requests.css';

export type PrivateRequestModel=ReturnType<typeof useClientPrivateRequest>;
type OwnerPhase='loading'|'ready'|'refused'|'error';
type Props={model:PrivateRequestModel;clientName:string;expanded:boolean;ownerPhase:OwnerPhase;onCollapse:()=>void;panelId?:string;onReviewSharing?:(workId:string)=>void};
const stateLabel=(state:string)=>state==='prepared'?'Private request':state==='shared'?'Customer action linked':'Changed in work';
const date=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

export function PrivateRequestEditor({model,clientName,expanded,ownerPhase,onCollapse,panelId,onReviewSharing}:Props){
 const generatedId=useId(),id=panelId??generatedId,panel=useRef<HTMLDivElement>(null),titleInput=useRef<HTMLInputElement>(null),bodyInput=useRef<HTMLTextAreaElement>(null),savedHeading=useRef<HTMLHeadingElement>(null);
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[validation,setValidation]=useState(false);
 const previous=useRef({expanded:false,phase:model.phase}),historySync=useRef<string|null>(null),pendingFocus=useRef<'title'|'saved'|null>(null);
 const busy=model.phase==='preparing'||model.phase==='checking',unknown=model.phase==='unknown';
 const writable=['idle','validation','error'].includes(model.phase),typed=!!(title||body);
 const denied=ownerPhase==='refused'||model.phase==='refused'||model.historyPhase==='refused';
 const request=model.result?.request,known=model.phase==='saved'&&model.result?.found===true&&request;
 const readHistory=model.readHistory;
 const activeAttempt=busy||unknown||!!known;
 const ready=ownerPhase==='ready'&&!denied&&(model.historyPhase==='ready'||activeAttempt);
 const titleInvalid=!title.trim()||[...title].length>160,bodyInvalid=!body.trim()||[...body].length>4000;
 useBeforeUnloadGuard(!denied&&model.phase!=='saved'&&(typed||busy||unknown));
 useEffect(()=>{if(denied){setTitle('');setBody('');setValidation(false);}},[denied]);
 useEffect(()=>{if(known){setTitle('');setBody('');setValidation(false);}},[known]);
 useEffect(()=>{
  if(!expanded)pendingFocus.current=null;
  else if(!previous.current.expanded)pendingFocus.current=known?'saved':'title';
  else if(model.phase==='idle'&&previous.current.phase==='saved')pendingFocus.current='title';
  else if(model.phase==='saved'&&['preparing','checking'].includes(previous.current.phase))pendingFocus.current='saved';
  if(expanded&&ready&&pendingFocus.current&&(document.activeElement===document.body||panel.current?.contains(document.activeElement))){
   const target=pendingFocus.current==='saved'?savedHeading.current:writable?titleInput.current:null;
   if(target){target.focus({preventScroll:true});pendingFocus.current=null;}
  }
  previous.current={expanded,phase:model.phase};
 },[expanded,ready,writable,model.phase,known]);
 useEffect(()=>{
  const key=known?`${request.work_id}:${request.version}`:null;
  if(key&&historySync.current!==key){historySync.current=key;void readHistory();}
 },[known,request,readHistory]);
 const submit=(event:FormEvent)=>{
  event.preventDefault();if(!ready||!writable)return;
  setValidation(true);if(titleInvalid||bodyInvalid){(titleInvalid?titleInput.current:bodyInput.current)?.focus();return;}
  void model.prepare({title,body});
 };
 const another=()=>{if(!known||busy)return;model.startAnother();setTitle('');setBody('');setValidation(false);};
 const select=(intent:string)=>{
  if(!ready||busy||unknown||(writable&&typed))return;
  if(known)model.startAnother();
  void model.checkSaved(intent);
 };
 const history=model.history;
 return <div className="trc-private-request" id={`${id}-panel`} ref={panel} hidden={!expanded||ownerPhase!=='ready'}
  onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onCollapse();}}}>
  <div className="trc-private-title"><h4 id={`${id}-heading`}>Prepare a request</h4>
   <button type="button" className="trc-shared-refresh" aria-label="Collapse private preparation" onClick={onCollapse}><X aria-hidden="true"/></button></div>
  {denied?<p role="alert">Your access to private requests could not be verified. Reopen this client after your access is restored.</p>
   :!activeAttempt&&model.historyPhase==='loading'?<p role="status">Checking saved private requests…</p>
   :!activeAttempt&&model.historyPhase==='error'?<div className="trc-private-feedback" role="alert"><p>Saved private requests could not be loaded.</p>
    <button type="button" className="trc-shared-quiet" onClick={()=>void model.readHistory()}>Try the read again</button></div>
   :<>
    {known?<div className="trc-private-saved">
     <h5 ref={savedHeading} tabIndex={-1}><Check aria-hidden="true"/>{stateLabel(request.content_state)}</h5>
     {request.content_state==='prepared'?<><strong>{request.title}</strong><p className="trc-action-words">{request.body}</p>
      <p className="trc-private-note"><Lock aria-hidden="true"/>Saved privately. Sharing requires a separate approval.</p></>
      :<p>{request.content_state==='shared'?'The saved work links to a customer action. Its current response remains in the original action history.':'This work changed after preparation. Its earlier wording is withheld.'}</p>}
     {request.content_state==='prepared'&&!model.result?.recipient_available&&<p className="trc-private-note">Sharing is not available for this customer yet. Check their portal access and consent.</p>}
     <p className="trc-private-note">Created <time dateTime={request.created_at}>{date(request.created_at)}</time></p>
     <div className="trc-private-buttons">
      {request.content_state==='prepared'&&model.result?.recipient_available&&onReviewSharing&&<button type="button" className="trc-shared-quiet" disabled={!ready||busy}
       onClick={()=>{if(ready&&!busy)onReviewSharing(request.work_id);}}>Review sharing with PAIGE</button>}
      <button type="button" className="trc-shared-quiet" onClick={()=>void model.checkSaved()}>Check saved request</button>
      <button type="button" className="trc-shared-quiet" onClick={another}>Prepare another request</button></div>
    </div>:model.phase==='checking'?<p role="status">Checking the original saved request…</p>:<form aria-labelledby={`${id}-heading`} onSubmit={submit} noValidate aria-busy={busy||undefined}>
     <p className="trc-private-note">Prepare a next step for {clientName}. Save privately before reviewing sharing.</p>
     <label htmlFor={`${id}-title`}>Request title <span id={`${id}-title-count`}>{[...title].length} / 160</span></label>
     <input id={`${id}-title`} ref={titleInput} value={title} maxLength={320} readOnly={!writable||busy||!ready}
      required aria-invalid={validation&&titleInvalid||undefined} aria-describedby={`${id}-title-count${validation&&titleInvalid?` ${id}-validation`:''}`}
      onChange={event=>setTitle([...event.target.value].slice(0,160).join(''))} autoComplete="off"/>
     <label htmlFor={`${id}-body`}>What should the customer do? <span id={`${id}-body-count`}>{[...body].length} / 4000</span></label>
     <textarea id={`${id}-body`} ref={bodyInput} value={body} maxLength={8000} rows={5} readOnly={!writable||busy||!ready}
      required aria-invalid={validation&&bodyInvalid||undefined} aria-describedby={`${id}-body-count${validation&&bodyInvalid?` ${id}-validation`:''}`}
      onChange={event=>setBody([...event.target.value].slice(0,4000).join(''))}/>
     {validation&&(titleInvalid||bodyInvalid)&&<p id={`${id}-validation`} role="alert">Add a title and the next step before saving.</p>}
     {model.phase==='error'&&<p role="alert">Preparation could not start. Check the fields and try again.</p>}
     {(busy||unknown)&&<p role={unknown?'alert':'status'} className="trc-private-feedback">
      {model.phase==='preparing'?'Saving privately…':'Save not confirmed. Check the saved request before starting another.'}</p>}
     {unknown&&model.result?.found===false&&<p className="trc-private-note">It has not been found yet. This does not confirm that the save failed.</p>}
     <div className="trc-private-buttons">
      {writable&&<button type="submit" className="trc-shared-quiet" disabled={!ready||busy}><Lock aria-hidden="true"/>Save private request</button>}
      {unknown&&<button type="button" className="trc-shared-quiet" onClick={()=>void model.checkSaved()}>Check saved request</button>}
      {writable&&typed&&<button type="button" className="trc-shared-refresh" onClick={()=>{setTitle('');setBody('');setValidation(false);titleInput.current?.focus();}}>Clear draft</button>}
     </div>
    </form>}
    <div className="trc-private-history"><div className="trc-private-history-head"><h5>Saved requests</h5>
     <button type="button" className="trc-shared-refresh" aria-label="Refresh saved private requests" disabled={busy}
      onClick={()=>void model.readHistory()}><RefreshCw aria-hidden="true"/>Refresh</button></div>
     {model.historyPhase==='loading'&&<p role="status">Refreshing saved private requests…</p>}
     {model.historyPhase==='error'&&<p role="alert">Saved history could not be refreshed. Try Refresh to read it again.</p>}
     {model.historyPhase==='ready'&&history&&!history.requests.length&&<p>No private requests have been prepared for this customer.</p>}
     {!!history?.requests.length&&<ul>{history.requests.map(item=><li key={item.request.work_id}>
      <button type="button" disabled={busy||unknown||(writable&&typed)} onClick={()=>select(item.intent_id)}>
       <span>{item.request.content_state==='prepared'?item.request.title:'Saved request'}<small>{stateLabel(item.request.content_state)}</small></span>
       <time dateTime={item.request.created_at}>{date(item.request.created_at)}</time></button>
     </li>)}</ul>}
     {writable&&typed&&!!history?.requests.length&&<p className="trc-private-note">Save or clear this draft to open another request.</p>}
     <div className="trc-private-buttons">
      {history?.more&&history.next_cursor&&<button type="button" className="trc-shared-quiet" disabled={busy||unknown}
       onClick={()=>void model.readHistory(history.next_cursor)}>Older saved requests</button>}
      <button type="button" className="trc-shared-refresh" disabled={busy||unknown} onClick={()=>void model.readHistory()}>Newest requests</button>
     </div>
    </div>
   </>}
 </div>;
}

/** The original keyed CRM record owns this lifecycle. Opening is explicit;
 * collapse keeps the same draft/attempt alive, never a second write or store. */
export function ClientPrivateRequests({scope,clientName,ownerPhase}:{scope:OwnerActionScope;clientName:string;ownerPhase:OwnerPhase}){
 const id=useId(),button=useRef<HTMLButtonElement>(null);
 const [opened,setOpened]=useState(false),[expanded,setExpanded]=useState(false);
 const collapse=()=>{setExpanded(false);button.current?.focus({preventScroll:true});};
 return <>
  <div className="trc-private-disclosure" hidden={ownerPhase!=='ready'}><button ref={button} type="button" className="trc-shared-quiet"
   aria-expanded={expanded} aria-controls={opened?`${id}-panel`:undefined}
   onClick={()=>{if(expanded)collapse();else{setOpened(true);setExpanded(true);}}}>
   {expanded?'Collapse preparation':'Prepare request'}</button></div>
  {opened&&<PrivateRequestScope key={`${scope.actor}:${scope.tenant}:${scope.contact}`} scope={scope} clientName={clientName}
   ownerPhase={ownerPhase} expanded={expanded} onCollapse={collapse} panelId={id}/>}
 </>;
}
function PrivateRequestScope({scope,...props}:Omit<Props,'model'>&{scope:OwnerActionScope}){
 const model=useClientPrivateRequest(scope);
 const {readHistory,checkSaved}=model;
 const revalidate=useCallback(()=>{void readHistory();void checkSaved();},[readHistory,checkSaved]);
 useEffect(()=>{
  const visible=()=>{if(document.visibilityState==='visible')revalidate();};
  window.addEventListener('focus',revalidate);document.addEventListener('visibilitychange',visible);
  return()=>{window.removeEventListener('focus',revalidate);document.removeEventListener('visibilitychange',visible);};
 },[revalidate]);
 const reviewSharing=(workId:string)=>{
  const saved=model.result,request=saved?.request;
  if(props.ownerPhase!=='ready'||model.phase!=='saved'||!saved?.found||!saved.recipient_available
   ||saved.actor_id!==scope.actor||saved.tenant_id!==scope.tenant||saved.contact_id!==scope.contact
   ||!request||request.content_state!=='prepared'||request.work_id!==workId)return;
  // Original shell/prefill only: the person sends this request and approves the
  // eventual exact card separately. No private words, email, versions or tokens
  // enter the handoff. References are identifiers, never execution authority.
  window.dispatchEvent(new CustomEvent('paige:open',{detail:{clientId:scope.contact,clientLabel:props.clientName,
   prompt:`Help me review sharing this saved customer request. Read the original saved request and show me the exact review before sharing anything.\n\nCustomer record: ${scope.contact}\nSaved request reference: ${workId}`}}));
 };
 return <PrivateRequestEditor {...props} model={model} onReviewSharing={reviewSharing}/>;
}
