import {useLayoutEffect, useRef, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useTenantContext} from '@/hooks/useTenantContext';
import {readKnowledge, type KnowledgeDocument} from '@/lib/knowledge-service';
import {readReviewedSetup, inspectReviewedSetup, prepareReviewedSetup,
  type ReviewedSetupInspection, type ReviewedSetupPort, type ReviewedSetupScope} from './data/reviewed-setup-client';
import {REVIEWED_SETUP_FACT_FIELDS, type ReviewedSetupFact, type ReviewedSetupSelection,
  type SoloSetupBrief} from './settings-setup-contract';
import './reviewed-setup-facts.css';

type Snapshot={tenantId:string|null; brief:SoloSetupBrief; contextRevision:number|null; canEdit:boolean; disabled:boolean; refreshing?:boolean; onSaved:()=>void};
/** The original Settings host owns its workspace and ordinary editor. This
 * boundary disposes private review state on every actor/workspace departure. */
export function ReviewedSetupFacts(props:Snapshot){
 const identity=useTenantContext();
 const current=useRef(identity);current.current=identity;
 if(identity.loading||identity.accountContextStatus!=='ready'||!identity.activeUserId
  ||identity.activeTenantId!==props.tenantId||(!props.canEdit&&!props.refreshing))return null;
 const actorId=identity.activeUserId,tenantId=identity.activeTenantId;
 const port:ReviewedSetupPort={rpc:(name,args)=>supabase.rpc(name as never,args as never),getScope:async()=>{
  const {data,error}=await supabase.auth.getUser();
  if(error||!data.user||current.current.accountContextStatus!=='ready')throw Error('Scope unavailable');
  return {actorId:data.user.id,tenantId:current.current.activeTenantId??''};
 }};
 return <ReviewedSetupPanel key={`${actorId}:${tenantId}`} {...props} port={port} actorId={actorId} tenantId={tenantId}/>;
}
type PanelProps=Snapshot&{port:ReviewedSetupPort;actorId:string;tenantId:string};
type Row={fact:ReviewedSetupFact;selected:boolean};
export function ReviewedSetupPanel({port,actorId,tenantId,brief,contextRevision,onSaved,disabled}:PanelProps){
 const lifetime=useRef({live:false,generation:0}),busyRef=useRef(false);
 useLayoutEffect(()=>{const captured=lifetime.current;captured.live=true;return()=>{captured.live=false;captured.generation++;};},[]);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [documents,setDocuments]=useState<KnowledgeDocument[]>([]),[offset,setOffset]=useState(0);
 const [source,setSource]=useState<(KnowledgeDocument&{content:string;hash:string})|null>(null);
 const [rows,setRows]=useState<Row[]>([]),[field,setField]=useState<ReviewedSetupFact['field']>('offers');
 const [value,setValue]=useState(''),[decision,setDecision]=useState<''|'adopt'|'override'>('');
 const [selection,setSelection]=useState<ReviewedSetupSelection|null>(null);
 const [receipt,setReceipt]=useState<ReviewedSetupInspection|null>(null),[unknown,setUnknown]=useState(false);
 const receiptSnapshot=useRef({updatedAt:brief.updatedAt,contextRevision});
 const rememberReceipt=(result:ReviewedSetupInspection|null)=>{
  receiptSnapshot.current={updatedAt:brief.updatedAt,contextRevision};setReceipt(result);
 };
 const snapshotChanged=receiptSnapshot.current.updatedAt!==brief.updatedAt||receiptSnapshot.current.contextRevision!==contextRevision;
 const displayedReceipt:ReviewedSetupInspection|null=receipt?.status==='recorded'&&receipt.current===true&&snapshotChanged
  &&(receipt.receipt.updatedAt!==brief.updatedAt||receipt.receipt.contextRevision!==contextRevision)
  ?{status:'recorded',receiptId:receipt.receiptId,current:false,reason:'setup_changed'}:receipt;
 const sourceText=useRef<HTMLTextAreaElement>(null);
 const handle=useRef<ReturnType<typeof prepareReviewedSetup>|null>(null);
 const scope=(run:number):ReviewedSetupScope=>({actorId,tenantId,isCurrent:()=>lifetime.current.live&&lifetime.current.generation===run});
 const check=async(s:ReviewedSetupScope)=>{
  if(!s.isCurrent())throw Error('Scope changed');const current=await port.getScope();
  if(!s.isCurrent()||current.actorId!==actorId||current.tenantId!==tenantId)throw Error('Scope changed');
 };
 const perform=async(action:(s:ReviewedSetupScope)=>Promise<void>)=>{
  if(busyRef.current)return;busyRef.current=true;setBusy(true);
  const s=scope(lifetime.current.generation);
  try{await check(s);await action(s);}catch{if(s.isCurrent())setNotice('This review could not be verified. Check the stored result before saving again.');}
  finally{busyRef.current=false;if(s.isCurrent())setBusy(false);}
 };
 const discover=()=>perform(async s=>{
  setNotice('Checking the stored review and receipt…');
  const stored=await readReviewedSetup(port,s);if(!s.isCurrent())return;
  rememberReceipt(stored.approval);setSelection(stored.proposal);handle.current=null;
  // The host uses the server-staged review UUID as its stable request UUID.
  // Reload must inspect that SAME identity before any explicit retry.
  setUnknown(Boolean(stored.proposal));
  setNotice(stored.proposal?'A saved review is available. Inspect its original save before continuing.':
   stored.approval?'Stored approval checked.':'No reviewed-fact approval is recorded for you.');
 });
 const loadDocuments=(next=0)=>perform(async s=>{
  const docs=await readKnowledge(port as Parameters<typeof readKnowledge>[0],tenantId,{limit:50,offset:next});
  await check(s);setDocuments(docs);setOffset(next);setNotice(docs.length?'Choose a source to review.':'No documents on this page.');
 });
 const choose=(id:string)=>perform(async s=>{
  setSource(null);setRows([]);setSelection(null);handle.current=null;
  const docs=await readKnowledge(port as Parameters<typeof readKnowledge>[0],tenantId,{documentId:id});
  await check(s);const doc=docs.find(d=>d.id===id);
  if(!doc||typeof doc.content!=='string'||!doc.content)throw Error('Source unavailable');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(doc.content));
  await check(s);const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  setSource({...doc,content:doc.content,hash});setValue('');setDecision('');
  setNotice('Select the exact supporting text, choose the Setup field, and enter the value to review.');
 });
 const add=()=>{
  const control=sourceText.current;if(!source||!control||!value.trim()||!decision)return;
  // HTML textareas normalize CR/CRLF, but Knowledge hashes and quotation offsets
  // refer to the unchanged canonical UTF16 text. Map only that browser newline
  // normalization; never rewrite the source or infer a different selected quote.
  if(control.value!==source.content.replace(/\r\n?/g,'\n')){setNotice('The displayed source changed. Choose the document again.');return;}
  const originalOffset=(boundary:number)=>{
   let original=0,displayed=0;
   while(displayed<boundary&&original<source.content.length){
    original+=source.content[original]==='\r'&&source.content[original+1]==='\n'?2:1;displayed++;
   }
   return original;
  };
  const start=originalOffset(control.selectionStart),end=originalOffset(control.selectionEnd);
  if(end<=start||end-start>12000){setNotice('Select up to 12,000 characters of supporting source text.');return;}
  const fact:ReviewedSetupFact={field,value:value.trim(),sourceDecision:decision,reference:{contractVersion:1,tenantId,
   documentId:source.id,revision:source.revision,contentSha256:source.hash},excerpts:[{start,end,text:source.content.slice(start,end)}]};
  setRows(previous=>[...previous.filter(r=>r.fact.field!==field),{fact,selected:false}]);
  setValue('');setDecision('');setNotice('Fact added for review. Select it below only if you want it saved.');
 };
 const stage=()=>perform(async s=>{
  if(contextRevision===null)throw Error('Setup unresolved');
  const input:ReviewedSetupSelection={schemaVersion:1,actorId,tenantId,reviewId:crypto.randomUUID(),
   expectedUpdatedAt:brief.updatedAt??null,expectedContextRevision:contextRevision,facts:rows.filter(r=>r.selected).map(r=>r.fact)};
  const prepared=prepareReviewedSetup(port,s,input);await prepared.stage();if(!s.isCurrent())return;
  handle.current=prepared;setSelection(input);setUnknown(false);setNotice('Review staged. Saving requires your explicit approval below.');
 });
 const inspect=()=>perform(async s=>{
  if(!selection)return;const result=await inspectReviewedSetup(port,s,selection.reviewId);if(!s.isCurrent())return;
  rememberReceipt(result);setUnknown(false);
  if(result.status==='recorded'){setSelection(null);handle.current=null;onSaved();setNotice('Original save inspected. Do not repeat it.');}
  else{
   const prepared=prepareReviewedSetup(port,s,selection);await prepared.stage();if(!s.isCurrent())return;
   handle.current=prepared;setNotice('No approval was found at read. You may explicitly approve this same staged review.');
  }
 });
 const approve=()=>perform(async s=>{
  if(!selection||unknown||!handle.current)return;
  setUnknown(true);setNotice('Saving selected facts…');
  const result=await handle.current.approve(selection.reviewId,selection.facts.map(f=>f.field));if(!s.isCurrent())return;
  rememberReceipt(result);setSelection(null);setUnknown(false);handle.current=null;onSaved();setNotice('Original approval receipt verified.');
 });
 const close=()=>{lifetime.current.generation++;handle.current=null;setOpen(false);setSource(null);setRows([]);setSelection(null);setReceipt(null);setUnknown(false);setNotice('');};
 return <section className="setup-section reviewed-setup-facts" aria-label="Review document facts"><fieldset disabled={disabled}>
  <h2>Review document facts</h2>
  {!open?<button type="button" className="btn btn-s" onClick={()=>{setOpen(true);void discover();}}>Review facts or reopen receipt</button>:<>
   <p>Save only the facts you choose into your business profile.</p>
   <p role="status">{notice}</p>
   <div className="setup-source-actions">
    <button type="button" disabled={busy} onClick={()=>void discover()}>Check stored review and receipt</button>
    <button type="button" disabled={busy||unknown||Boolean(selection)} onClick={()=>void loadDocuments()}>Choose a Knowledge document</button>
    <button type="button" disabled={busy} onClick={close}>Close review</button>
   </div>
   {documents.length>0&&!selection&&<div className="setup-field">
    <label htmlFor={`reviewed-source-${actorId}`}>Source document</label>
    <select id={`reviewed-source-${actorId}`} disabled={busy||unknown} value={source?.id??''} onChange={e=>{if(e.target.value)void choose(e.target.value);}}>
     <option value="">Choose a document</option>{documents.map(d=><option key={d.id} value={d.id}>{d.title} · revision {d.revision}</option>)}
    </select>
    <div className="setup-source-actions"><button type="button" disabled={busy||offset===0} onClick={()=>void loadDocuments(Math.max(0,offset-50))}>Previous documents</button>
     <button type="button" disabled={busy||documents.length<50} onClick={()=>void loadDocuments(offset+50)}>Next documents</button></div>
   </div>}
   {source&&!selection&&<fieldset disabled={busy||unknown}>
    <legend>{source.title} · revision {source.revision}</legend>
    <div className="setup-fields">
     <div className="setup-field setup-field--wide"><label htmlFor="reviewed-source-text">Supporting source text — select an exact passage</label>
      <textarea id="reviewed-source-text" ref={sourceText} readOnly value={source.content} rows={8}/></div>
     <div className="setup-field"><label htmlFor="reviewed-field">Setup field</label><select id="reviewed-field" value={field} onChange={e=>setField(e.target.value as ReviewedSetupFact['field'])}>
      {REVIEWED_SETUP_FACT_FIELDS.map(f=><option key={f} value={f}>{f.replace(/([A-Z])/g,' $1')}</option>)}</select></div>
     <div className="setup-field"><label htmlFor="reviewed-value">Value to save</label><textarea id="reviewed-value" value={value} maxLength={4000} onChange={e=>setValue(e.target.value)}/></div>
     <div className="setup-field"><label htmlFor="reviewed-decision">Your choice</label><select id="reviewed-decision" value={decision} onChange={e=>setDecision(e.target.value as typeof decision)}>
      <option value="">Choose how to use this fact</option><option value="adopt">Adopt this value</option><option value="override">Correct or override the stored value</option></select></div>
    </div><button type="button" disabled={!value.trim()||!decision} onClick={add}>Add selected passage for review</button>
   </fieldset>}
   {rows.length>0&&!selection&&<fieldset disabled={busy||unknown}><legend>Select facts to save</legend>
    {rows.map(row=><div key={row.fact.field} className="setup-field"><label><input type="checkbox" checked={row.selected}
     onChange={e=>{const checked=e.target.checked;setRows(items=>items.map(r=>r===row?{...r,selected:checked}:r));}} />{row.fact.field.replace(/([A-Z])/g,' $1')}</label>
     <label htmlFor={`review-value-${row.fact.field}`}>Value to save</label>
     <textarea id={`review-value-${row.fact.field}`} value={row.fact.value} maxLength={4000}
      onChange={e=>{const value=e.target.value;setRows(items=>items.map(r=>r===row?{selected:false,fact:{...r.fact,value}}:r));}}/>
     <label htmlFor={`review-choice-${row.fact.field}`}>Adopt or correct</label>
     <select id={`review-choice-${row.fact.field}`} value={row.fact.sourceDecision}
      onChange={e=>{const sourceDecision=e.target.value as 'adopt'|'override';setRows(items=>items.map(r=>r===row?{selected:false,fact:{...r.fact,sourceDecision}}:r));}}>
      <option value="adopt">Adopt this value</option><option value="override">Correct or override the stored value</option></select>
     <blockquote>{row.fact.excerpts[0].text}</blockquote><small>Source revision {row.fact.reference.revision} · {row.fact.sourceDecision}</small></div>)}
    <button type="button" disabled={!rows.some(r=>r.selected)} onClick={()=>void stage()}>Review selected facts</button></fieldset>}
   {selection&&<div><h3>Approve selected facts</h3><ul>{selection.facts.map(f=><li key={f.field}>{f.field}: {f.value}<blockquote>{f.excerpts[0].text}</blockquote></li>)}</ul>
    <p>This saves these values into Setup. It does not approve Memory, an agreement, a plan or Work.</p>
    {unknown?<button type="button" disabled={busy} onClick={()=>void inspect()}>Inspect original save</button>:<>
     <button type="button" className="btn btn-p" disabled={busy||!handle.current} onClick={()=>void approve()}>Approve and save selected facts</button>
     <button type="button" disabled={busy} onClick={()=>{setRows(selection.facts.map(fact=>({fact,selected:false})));setSelection(null);handle.current=null;}}>Edit reviewed facts</button></>}</div>}
   {displayedReceipt?.status==='recorded'&&<div><h3>Approval receipt</h3><p>Receipt {displayedReceipt.receiptId}</p>
    {displayedReceipt.current===true?<><p>Saved Setup revision {displayedReceipt.receipt.contextRevision}</p><ul>{displayedReceipt.receipt.selectedFacts.map(f=><li key={f.field}>{f.field}: {f.value} · source revision {f.reference.revision}</li>)}</ul></>:
     <p>This receipt is historical. Setup, its source or your access has changed; these facts are not renewed approval.</p>}</div>}
  </>}
 </fieldset></section>;
}
