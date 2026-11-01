import {useLayoutEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useTenantContext} from '@/hooks/useTenantContext';
import {DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {AddKnowledgeFlow} from './AddKnowledgeFlow';
import {prepareKnowledgeUploadSelection,uploadKnowledgeFileOnce,inspectKnowledgeUploadedFile,submitKnowledgeExtraction,
  readKnowledgeExtractionReview,readKnowledgePendingReviewTarget,type ExtractionClient,type ExtractionInput,
  type ExtractionSubmission,type KnowledgeUploadSelectionRow,type KnowledgeReviewTarget} from '@/lib/knowledge-extraction-service';
import {knowledgeExtractionAcknowledgment,notifyKnowledgeObserver,type KnowledgeFlowObservers} from './knowledge-flow-observers';

type Phase=KnowledgeUploadSelectionRow['phase']|'uploading'|'upload_unknown'|'read_unavailable'|'source_changed'|'stored'|'submission_unknown'|'submitted'|'published'|'not_started';
type Row=Omit<KnowledgeUploadSelectionRow,'phase'>&{phase:Phase;input?:ExtractionInput;submission?:ExtractionSubmission};
/** A local File selection captured by the existing Chat/composer incarnation.
 * This is input, never write authority or a durable source/approval receipt.
 * isCurrent must remain false after that incarnation departs, including A→B→A.
 */
export type KnowledgeAttachedSelection=Readonly<{actorId:string;tenantId:string;files:readonly File[];isCurrent:()=>boolean}>;
type Props=KnowledgeFlowObservers&{tenantId:string;onClose:()=>void;onBack:()=>void;onPublished?:()=>void;returnFocus?:()=>HTMLElement|null;attachedSelection?:KnowledgeAttachedSelection;sourceLifetime?:()=>boolean};
const labels:Record<Phase,string>={prepared:'Ready to upload',duplicate:'Duplicate in this selection · skipped',refused:'Unsupported or invalid file · not uploaded',uploading:'Uploading and verifying source',upload_unknown:'Upload unconfirmed · inspect original',read_unavailable:'Source readback unavailable',source_changed:'Stored bytes differ · reading refused',stored:'Stored source · not yet read',submission_unknown:'Reading submission unconfirmed',submitted:'Reading status unavailable · inspect original',published:'Reviewed text published',not_started:'Not started'};
const readingLabels:Record<ExtractionSubmission['status'],string>={claimed:'requested · open to check progress',succeeded:'finished · review required',failed:'failed · inspect original',blocked:'paused · inspect original',cancelled:'cancelled · inspect original',expired:'needs recovery · inspect original',outcome_unknown:'unconfirmed · inspect original'};
/** A finite attended transfer loop. Original Storage, extraction work, reviews
 * and publication own all durable effects; this component stores no batch ledger.
 */
export function BulkKnowledgeUploadFlow({tenantId,onClose,onBack,onPublished,returnFocus,attachedSelection,sourceLifetime,onExtractionAcknowledged,onPublicationVerified}:Props){
  const identity=useTenantContext();
  const observers=useRef({onExtractionAcknowledged,onPublicationVerified});
  const notifiedExtractions=useRef(new Set<string>()),notifiedPublications=useRef(new Set<string>());
  const [rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null),[target,setTarget]=useState<KnowledgeReviewTarget|null>(null);
  const currentRows=useRef<Row[]>([]),live=useRef(true),stopping=useRef(false),running=useRef(false),selectedIndex=useRef<number|null>(null);
  const actor=useRef(identity.activeUserId),scopeToken=useRef({tenantId,actor:identity.activeUserId});
  const initialSelection=useRef(attachedSelection),selectionPrepared=useRef(false),selectionRetired=useRef(false);
  const parentLifetime=useRef(sourceLifetime);
  if(initialSelection.current!==attachedSelection||(initialSelection.current&&(identity.activeTenantId!==tenantId||identity.activeUserId!==actor.current)))selectionRetired.current=true;
  const sourceCurrent=()=>{
    try{if(parentLifetime.current&&parentLifetime.current()!==true)selectionRetired.current=true;}
    catch{selectionRetired.current=true;}
    const source=initialSelection.current;
    if(!source)return !selectionRetired.current;
    try{if(source.actorId!==actor.current||source.tenantId!==tenantId||source.isCurrent()!==true)selectionRetired.current=true;}
    catch{selectionRetired.current=true;}
    return !selectionRetired.current;
  };
  if(scopeToken.current.tenantId!==tenantId||scopeToken.current.actor!==identity.activeUserId)scopeToken.current={tenantId,actor:identity.activeUserId};
  const incarnation=scopeToken.current;
  const current=()=>live.current&&scopeToken.current===incarnation&&identity.accountContextStatus==='ready'&&!identity.loading&&identity.activeTenantId===tenantId&&identity.activeUserId===actor.current&&sourceCurrent();
  const scope=()=>({tenantId,isCurrent:current});
  const client=supabase as unknown as ExtractionClient;
  useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;stopping.current=true;};},[]);
  const replace=(next:Row[])=>{currentRows.current=next;if(current())setRows(next);};
  const patch=(index:number,next:Partial<Row>)=>replace(currentRows.current.map((row,i)=>i===index?{...row,...next}:row));
  const close=()=>{stopping.current=true;live.current=false;onClose();};
  const choose=async(files:FileList|readonly File[]|null)=>{
    if(running.current||!current()||!files?.length)return;
    const chosen=Array.from(files);
    if(chosen.length>20||chosen.reduce((n,f)=>n+f.size,0)>20*1024*1024){setNotice('Choose up to 20 files, at most 20 MB total. Each file can be up to 2 MB.');return;}
    running.current=true;stopping.current=false;setBusy(true);setNotice('Checking selected files…');
    try{
      const inputs=[], failedReads=new Set<number>();
      for(const file of chosen){
        if(!current())return;
        if(stopping.current){setNotice('Selection preparation stopped. No files were uploaded.');return;}
        try{
          const buffer=typeof file.arrayBuffer==='function'?await file.arrayBuffer():await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(new Error('file_read_failed'));reader.onabort=()=>reject(new Error('file_read_failed'));reader.readAsArrayBuffer(file);});
          inputs.push({name:file.name,mime:file.type,bytes:new Uint8Array(buffer)});
        }catch{failedReads.add(inputs.length);inputs.push({name:file.name,mime:file.type,bytes:new Uint8Array()});}
      }
      if(!current())return;
      if(stopping.current){setNotice('Selection preparation stopped. No files were uploaded.');return;}
      const prepared=await prepareKnowledgeUploadSelection(scope(),identity.activeUserId!,inputs);
      if(current()){replace(prepared.map((row,i)=>failedReads.has(i)?{...row,phase:'refused',source:null,intentId:null,errorCode:'FILE_READ_FAILED'}:row));setNotice('Review each document after Paige reads it. Uploading does not approve business facts, Memory or agreement terms.');}
    }catch{if(current())setNotice('The selection could not be prepared. No files were uploaded. Choose readable files and try again.');}
    finally{running.current=false;if(current())setBusy(false);}
  };
  const initialPreparation=useRef<(()=>void)|null>(null);
  initialPreparation.current=()=>{
    if(!initialSelection.current||selectionPrepared.current||!current())return;
    selectionPrepared.current=true;void choose(initialSelection.current.files);
  };
  useLayoutEffect(()=>{
    // Same preparation as the chooser: local bytes/validation only, no upload.
    // Deferring until after mount also keeps StrictMode's rehearsal effect inert.
    queueMicrotask(()=>initialPreparation.current?.());
  },[]);
  const submit=async(index:number)=>{
    const row=currentRows.current[index];if(!row.source||!row.intentId||!current())return;
    const input=row.input??{kind:'file' as const,intent_id:row.intentId,title:row.name.trim(),path:row.source.path};
    patch(index,{input});
    try{const submission=await submitKnowledgeExtraction(client,scope(),input);if(current()){
      patch(index,{phase:'submitted',submission});
      const key=`${submission.reference.intentId}:${submission.reference.workId}`;
      if(!notifiedExtractions.current.has(key)){
        notifiedExtractions.current.add(key);
        notifyKnowledgeObserver(observers.current.onExtractionAcknowledged,knowledgeExtractionAcknowledgment(submission),{isCurrent:current,selectionIndex:index});
      }
    }}
    catch{if(current())patch(index,{phase:'submission_unknown'});}
  };
  const transfer=async(index:number,inspect=false)=>{
    const row=currentRows.current[index];if(!row.source||!current())return;
    patch(index,{phase:'uploading'});
    try{
      const storage=supabase.storage.from('tenant-knowledge');
      const result=await (inspect?inspectKnowledgeUploadedFile:uploadKnowledgeFileOnce)(storage,scope(),row.source);
      if(!current())return;
      patch(index,{phase:result.phase});
      if(result.phase==='stored'&&!inspect&&!stopping.current)await submit(index);
    }catch{if(current())patch(index,{phase:inspect?'read_unavailable':'upload_unknown'});}
  };
  const run=async(index?:number,action:'upload'|'inspect'|'submit'='upload')=>{
    if(running.current||!current())return;
    running.current=true;stopping.current=false;setBusy(true);setNotice(null);
    try{
      if(index!==undefined){if(action==='submit')await submit(index);else await transfer(index,action==='inspect');}
      else for(let i=0;i<currentRows.current.length;i++){
        if(!current()||stopping.current)break;
        if(currentRows.current[i].phase==='prepared')await transfer(i);
      }
      if(current()&&stopping.current){replace(currentRows.current.map(row=>row.phase==='prepared'?{...row,phase:'not_started'}:row));setNotice('No further uploads will start. Existing stored files and submitted readings are retained.');}
    }catch{if(current())setNotice('Progress could not be confirmed. Inspect the original source or unfinished document before repeating any action.');}
    finally{running.current=false;if(current())setBusy(false);}
  };
  const open=async(index:number)=>{
    if(running.current||!current())return;
    const row=currentRows.current[index],ref=row.submission?.reference;if(!ref)return;
    running.current=true;setBusy(true);setNotice('Opening the original reading…');
    try{
      const review=await readKnowledgeExtractionReview(client,scope(),ref);
      const restored=await readKnowledgePendingReviewTarget(client,scope(),{documentId:ref.documentId,workId:ref.workId,revision:review.revision,title:row.name,recordState:review.record_state,reviewAvailable:review.pending_review!==null,status:row.submission!.status});
      if(current()){selectedIndex.current=index;setTarget(restored);setNotice(null);}
    }catch{if(current())setNotice('This reading changed or could not be read. Open its current record under Unfinished documents. No new reading was started.');}
    finally{running.current=false;if(current())setBusy(false);}
  };
  if(!current())return <DialogContent><DialogHeader><DialogTitle>Workspace changed</DialogTitle><DialogDescription>Reopen Knowledge in your current workspace to inspect the original files.</DialogDescription></DialogHeader><Button onClick={close}>Close</Button></DialogContent>;
  const reviewIndex=selectedIndex.current;
  if(target)return <AddKnowledgeFlow tenantId={tenantId} replacementTarget={target} sourceLifetime={current} onClose={()=>setTarget(null)} onPublicationVerified={(value,context)=>{
    if(!context.isCurrent()||!current()||value.tenantId!==tenantId||value.documentId!==target.id||notifiedPublications.current.has(value.workId))return;
    notifiedPublications.current.add(value.workId);
    notifyKnowledgeObserver(observers.current.onPublicationVerified,value,{isCurrent:()=>context.isCurrent()&&current(),...(reviewIndex===null?{}:{selectionIndex:reviewIndex})});
  }} onPublished={()=>{
    if(!current())return;
    if(selectedIndex.current!==null)patch(selectedIndex.current,{phase:'published'});
    // Preserve the original completion callback once all admitted files finish.
    // A partial batch remains open; Close already refreshes its owning library.
    if(currentRows.current.every(row=>['published','refused','duplicate'].includes(row.phase)))onPublished?.();
  }}/>;
  const started=rows.some(r=>!['prepared','duplicate','refused'].includes(r.phase));
  return <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event=>{if(returnFocus){event.preventDefault();returnFocus()?.focus();}}}>
    <DialogHeader><DialogTitle>Add files to Knowledge</DialogTitle><DialogDescription>PDF, DOCX and text. Each file keeps its own source and review. Scanned or encrypted files may not provide readable text; OCR is not available here.</DialogDescription></DialogHeader>
    <div className="space-y-1.5"><Label htmlFor="knowledge-bulk-files">Files · 2 MB each, 20 files and 20 MB per selection</Label><Input id="knowledge-bulk-files" type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json" disabled={busy||started||!!attachedSelection} onChange={event=>void choose(event.target.files)}/></div>
    {notice&&<p role="status" className="text-sm">{notice}</p>}
    <ul className="divide-y" aria-label="Selected files">{rows.map((row,index)=><li key={index} className="py-3 space-y-2"><p className="font-medium break-words">{row.name}</p><p className="text-sm" role="status">{row.phase==='submitted'&&row.submission?`Last confirmed reading: ${readingLabels[row.submission.status]}`:labels[row.phase]}</p><div className="flex flex-wrap gap-2">
      {['upload_unknown','read_unavailable'].includes(row.phase)&&<Button variant="outline" disabled={busy} onClick={()=>void run(index,'inspect')}>Inspect original</Button>}
      {row.phase==='stored'&&<Button disabled={busy} onClick={()=>void run(index,'submit')}>Read stored source</Button>}
      {row.phase==='submission_unknown'&&<Button disabled={busy} onClick={()=>void run(index,'submit')}>Reconcile same reading</Button>}
      {row.phase==='submitted'&&<Button variant="outline" disabled={busy} onClick={()=>void open(index)}>Open reading</Button>}
    </div></li>)}</ul>
    <p className="text-sm">Closing stops the next upload. A transfer already started may still finish. Reopen unfinished documents, or reselect the same files with the same names and types to inspect their original paths.</p>
    <div className="flex flex-wrap justify-end gap-2">{!started&&!attachedSelection&&<Button variant="outline" disabled={busy} onClick={onBack}>Pasted text</Button>}<Button variant="outline" onClick={close}>Close</Button>{busy?<Button variant="outline" onClick={()=>{stopping.current=true;}}>Stop remaining uploads</Button>:rows.some(r=>r.phase==='prepared')&&<Button onClick={()=>void run()}>Upload and read files</Button>}</div>
  </DialogContent>;
}
