import {useLayoutEffect, useRef, useState} from 'react';
import {BookOpen} from 'lucide-react';
import {Link} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {KnowledgeDialogFrame} from '@/components/knowledge/KnowledgeDialogFrame';
import {AddKnowledgeFlow} from '@/solo/knowledge/AddKnowledgeFlow';
import {useTenantContext} from '@/hooks/useTenantContext';
import {useBeforeUnloadGuard} from '@/hooks/useBeforeUnloadGuard';
import {supabase} from '@/integrations/supabase/client';
import {createChatKnowledgeHandoff, type ChatKnowledgeHandoffRow} from '@/lib/paige-chat-knowledge-handoff';
import {inspectChatKnowledgeIntake, inspectChatKnowledgeLink, listChatKnowledgeLinks, prepareChatKnowledgeIntake, prepareChatKnowledgeLink,
  type ChatKnowledgeInspection, type ChatKnowledgeIntakeInspection,
  type ChatKnowledgeIntakeReference, type ChatKnowledgeIntakeSelection, type ChatKnowledgePort, type ChatKnowledgeScope} from '@/lib/paige-chat-knowledge-service';
import {readKnowledge, type KnowledgeRpcClient} from '@/lib/knowledge-service';
import {readKnowledgeDraftForDocument, readKnowledgeExtractionForDocument,
  type ExtractionClient, type KnowledgeReviewTarget} from '@/lib/knowledge-extraction-service';
import {routeLinkTarget} from '@/lib/links/workspaceLinks';
import type {KnowledgeAttachedSelection} from '@/solo/knowledge/BulkKnowledgeUploadFlow';
import type {KnowledgeFlowContext, KnowledgePublicationVerified} from '@/solo/knowledge/knowledge-flow-observers';

type Item = ChatKnowledgeInspection | ChatKnowledgeIntakeInspection;
type Props = {
  actorId: string; tenantId: string; threadId: string | null; originEpoch: string;
  account: number | string | null | undefined; disabled: boolean; attachedFile?: File;
  onAdoptThread: (id: string, originEpoch: string) => void;
  recoveryIntake?: Readonly<ChatKnowledgeIntakeSelection> | null;
  onBeforeFirstValue?: (input:ChatKnowledgeIntakeSelection,originEpoch:string)=>boolean;
};
const rowLabel: Record<ChatKnowledgeHandoffRow['phase'], string> = {
  linking: 'Linking the original reading to this chat…', reading_linked: 'Reading saved with this chat',
  published_linked: 'Reviewed text saved in Knowledge and linked to this chat',
  link_unconfirmed: 'Conversation link unconfirmed. Inspect it; do not upload again.',
  link_absent: 'No conversation link found at the last check.',
  publication_unlinked: 'Text is saved in Knowledge; its conversation link still needs confirmation.',
};

/** Original Knowledge UI and native Chat links. There is no second upload,
 * conversation, Knowledge store, approval channel or effect ledger here. */
export function ChatKnowledgeDocuments(props: Props) {
  const identity = useTenantContext(), latest = useRef(identity); latest.current = identity;
  const mounted = useRef(false), ticket = useRef<object | null>(null), nativeThread = useRef(props.threadId);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [items, setItems] = useState<Item[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string,string>>({});
  const [selection, setSelection] = useState<KnowledgeAttachedSelection | null>(null);
  const [target, setTarget] = useState<KnowledgeReviewTarget | null>(null);
  const [intake, setIntake] = useState<ChatKnowledgeIntakeReference | null>(null);
  const [savedPublication, setSavedPublication] = useState<KnowledgePublicationVerified | null>(null);
  const [savedLinkState, setSavedLinkState] = useState<'ready'|'unknown'|'absent'>('ready');
  const [recoveryAbsent,setRecoveryAbsent]=useState(false);
  const [handoffRows, setHandoffRows] = useState<readonly ChatKnowledgeHandoffRow[]>([]);
  useBeforeUnloadGuard(open && (!!selection || !!target || busy));
  const handoff = useRef<ReturnType<typeof createChatKnowledgeHandoff> | null>(null);
  const busyOwner = useRef<object | null>(null);
  const picker = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), run = useRef(0);
  const ready = !identity.loading && identity.accountContextStatus === 'ready'
    && identity.activeUserId === props.actorId && identity.activeTenantId === props.tenantId;
  if (!ready && ticket.current) ticket.current = null;
  const current = (captured = ticket.current) => mounted.current && captured !== null && ticket.current === captured
    && !latest.current.loading && latest.current.accountContextStatus === 'ready'
    && latest.current.activeUserId === props.actorId && latest.current.activeTenantId === props.tenantId;
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; ticket.current = null; }; }, []);
  const port: ChatKnowledgePort = {
    rpc: (name,args) => supabase.rpc(name as never,args as never),
    getScope: async () => {
      const {data,error} = await supabase.auth.getUser();
      if (error || !data.user || latest.current.accountContextStatus !== 'ready') throw Error('Scope unavailable');
      return {actorId:data.user.id,tenantId:latest.current.activeTenantId ?? ''};
    },
  };
  const scope = (captured = ticket.current): ChatKnowledgeScope => ({
    actorId:props.actorId,tenantId:props.tenantId,threadId:nativeThread.current,isCurrent:()=>current(captured),
  });
  const beginBusy = () => { const owner={};busyOwner.current=owner;setBusy(true);return owner; };
  const endBusy = (owner:object) => { if(busyOwner.current===owner){busyOwner.current=null;if(current())setBusy(false);} };
  const syncHandoff = () => {
    if (!current()) return;
    const original = handoff.current;
    setHandoffRows(original?.getRows() ?? []);
    const id = original?.getThreadId(); if (id) nativeThread.current = id;
  };
  const load = async (after: string | null = null) => {
    const captured = ticket.current, mine = ++run.current;
    if (!current(captured)) return;
    if (!nativeThread.current&&!props.recoveryIntake) { setItems([]); setCursor(null); return; }
    const owner=beginBusy();setNotice('Checking documents saved with this chat…');
    try {
      if(!nativeThread.current&&props.recoveryIntake){
        setRecoveryAbsent(false);
        const original=props.recoveryIntake;
        const recovered=await inspectChatKnowledgeIntake(port,scope(captured),original.extractionWorkId);
        if(!current(captured)||run.current!==mine)return;
        if(recovered.status==='recorded'&&recovered.current&&recovered.reference.documentId===original.documentId
          &&recovered.reference.sourceSha256===original.sourceSha256&&recovered.reference.extractionIntentId===original.extractionIntentId)
          nativeThread.current=recovered.reference.threadId;
        else if(recovered.status==='absent_at_read'){
          setRecoveryAbsent(true);
          setNotice('No conversation link was found at this check. Link the same stored reading to finish; the file will not upload again.');return;
        }else{setNotice('The earlier document link is unavailable or changed. No new conversation or upload was started.');return;}
      }
      const result = await listChatKnowledgeLinks(port,scope(captured),after);
      if (!current(captured) || run.current !== mine) return;
      setItems(previous => after === null ? result.items : [...previous,...result.items]); setCursor(result.nextCursor);
      setNotice(result.items.length ? 'Each source keeps its own review and saved text.' : 'No documents are linked to this chat yet.');
      // The original permitted readers supply labels. No source text enters a
      // Chat turn, model prompt, browser persistence or log from this listing.
      for (const item of result.items) {
        if (!current(captured) || run.current !== mine) return;
        if (item.status !== 'recorded' || !item.current) continue;
        const ref = item.reference;
        try {
          const docs = await readKnowledge(port as KnowledgeRpcClient,props.tenantId,{documentId:ref.documentId});
          if (!current(captured) || run.current !== mine) return;
          let title = docs.find(d=>d.id===ref.documentId)?.title;
          if (!title && 'phase' in ref) {
            const pending = await readKnowledgeDraftForDocument(supabase as unknown as ExtractionClient,
              {tenantId:props.tenantId,isCurrent:()=>current(captured) && run.current===mine},ref.documentId,
              (item as Extract<ChatKnowledgeIntakeInspection,{current:true}>).currentDocumentRevision);
            if (!current(captured) || run.current !== mine) return;
            title = pending.title;
          }
          if (title) setTitles(previous=>({...previous,[ref.documentId]:title!}));
        } catch { /* A label failure cannot manufacture or replay a source. */ }
      }
    } catch { if (current(captured) && run.current===mine) setNotice('The conversation document list could not be checked. Retry this read before uploading again.'); }
    finally { endBusy(owner); }
  };
  const show = () => {
    if (props.disabled || !ready) return;
    ticket.current = {}; nativeThread.current = props.threadId;
    setOpen(true); setSelection(null); setTarget(null); setIntake(null); setSavedPublication(null);setSavedLinkState('ready');
    busyOwner.current=null;setBusy(false);setItems([]); setTitles({}); setHandoffRows([]); handoff.current = null; setNotice('');
    void load();
  };
  const close = () => {
    const captured = ticket.current, id = nativeThread.current, canAdopt = current(captured);
    ticket.current = null; run.current++; busyOwner.current=null;setBusy(false);setOpen(false); setSelection(null); setTarget(null);
    if (canAdopt && props.threadId === null && id) props.onAdoptThread(id,props.originEpoch);
  };
  const choose = (files: readonly File[]) => {
    if (!current() || busyOwner.current || !files.length || (props.recoveryIntake&&!nativeThread.current)
      || handoffRows.some(row=>row.phase==='link_unconfirmed'||row.phase==='linking') || savedLinkState==='unknown') return;
    if (files.length > 20 || files.reduce((n,f)=>n+f.size,0)>20*1024*1024) {
      setNotice('Choose up to 20 files and 20 MB total. Each file can be up to 2 MB.'); return;
    }
    const captured = ticket.current;
    const selected = Object.freeze({actorId:props.actorId,tenantId:props.tenantId,
      files:Object.freeze([...files]),isCurrent:()=>current(captured)});
    const original = createChatKnowledgeHandoff(port,scope(captured),selected.files,syncHandoff,
      input=>current(captured)&&props.onBeforeFirstValue?.(input,props.originEpoch)===true);
    handoff.current = original; setHandoffRows([]); setSelection(selected); setTarget(null); setIntake(null); setSavedPublication(null);setSavedLinkState('ready');
  };
  const back = () => {
    setSelection(null);setTarget(null);
    if(savedLinkState!=='unknown'){setIntake(null);setSavedPublication(null);}
    syncHandoff();void load();
  };
  const linkSaved = async (source: ChatKnowledgeIntakeReference, value: KnowledgePublicationVerified, context?: KnowledgeFlowContext) => {
    const captured = ticket.current;
    if (!current(captured) || busyOwner.current || savedLinkState==='unknown' || (context && !context.isCurrent()) || source.linkRevision !== 1
      || source.documentId!==value.documentId || value.tenantId!==props.tenantId) return;
    const owner=beginBusy();setSavedPublication(value);setSavedLinkState('unknown');
    try {
      await prepareChatKnowledgeLink(port,{...scope(captured),isCurrent:()=>current(captured)&&(!context||context.isCurrent())},{
        publicationWorkId:value.workId,documentId:value.documentId,documentRevision:value.revision,
        extractionIntentId:source.extractionIntentId,sourceSha256:source.sourceSha256,turnId:source.turnId,expectedLinkRevision:1,
      }).save();
      if (current(captured)) { setNotice('The original saved text is linked to this chat.'); setSavedPublication(null);setSavedLinkState('ready'); void load(); }
    } catch { if (current(captured)) setNotice('The text remains in Knowledge. Its chat link is unconfirmed; reload the document list before repeating any link action.'); }
    finally { endBusy(owner); }
  };
  const inspectSavedLink = async () => {
    const captured=ticket.current,value=savedPublication;
    if(!current(captured)||busyOwner.current||!value)return;
    const owner=beginBusy();
    try {
      const result=await inspectChatKnowledgeLink(port,scope(captured),value.workId);
      if(!current(captured))return;
      if(result.status==='recorded'&&result.current){
        setSavedPublication(null);setSavedLinkState('ready');setNotice('The original saved text is linked to this chat.');void load();
      }else if(result.status==='absent_at_read'){
        setSavedLinkState('absent');setNotice('No chat link was found. You can link the same saved text; no upload or publication will repeat.');
      }else setNotice('The source changed or is unavailable. Its earlier link cannot be used as current Knowledge.');
    }catch{if(current(captured))setNotice('The saved link could not be checked. Inspect again before repeating a link action.');}
    finally{endBusy(owner);}
  };
  const finishOriginalReading = async () => {
    const captured=ticket.current,input=props.recoveryIntake;
    if(!current(captured)||busyOwner.current||!recoveryAbsent||!input||nativeThread.current)return;
    const owner=beginBusy();setRecoveryAbsent(false);
    try{
      if(props.onBeforeFirstValue?.(input,props.originEpoch)!==true)throw Error('Recovery unavailable');
      const result=await prepareChatKnowledgeIntake(port,scope(captured),input).stage();
      if(!current(captured))return;
      if(result.status!=='recorded'||!result.current)throw Error('Link unconfirmed');
      nativeThread.current=result.reference.threadId;void load();
    }catch{if(current(captured))setNotice('The original conversation link is still unconfirmed. Reload to inspect it before another link action.');}
    finally{endBusy(owner);}
  };
  const inspectItem = async (item: Extract<ChatKnowledgeIntakeInspection,{current:true}>) => {
    if (busyOwner.current || !current()) return;
    const captured = ticket.current, ref = item.reference;
    const owner=beginBusy();setNotice('Opening the original document…');
    try {
      const extractionScope = {tenantId:props.tenantId,isCurrent:()=>current(captured)};
      const read = await readKnowledgeExtractionForDocument(supabase as unknown as ExtractionClient,extractionScope,ref.documentId,item.currentDocumentRevision);
      if (!current(captured)) return;
      if (read.record_state==='draft' && read.extraction_work_id===ref.extractionWorkId) {
        const pending = await readKnowledgeDraftForDocument(supabase as unknown as ExtractionClient,extractionScope,ref.documentId,read.revision);
        if (current(captured)) { setIntake(ref); setTarget(pending); }
      } else if (read.record_state==='canonical' && read.pending_review===null
        && read.publication?.association==='matched' && read.publication.work_status==='succeeded'
        && read.publication.work_id && read.publication.generation_id===read.publication.work_id && read.publication.outcome) {
        setIntake(ref);setSavedLinkState('ready'); setSavedPublication({tenantId:props.tenantId,documentId:ref.documentId,revision:read.revision,
          workId:read.publication.work_id,generationId:read.publication.generation_id,outcome:read.publication.outcome});
        setNotice('The reviewed text is already saved in Knowledge. Link that original publication to this chat; do not publish again.');
      } else setNotice('The original reading is not ready for review. Reload its current state; no reading was restarted.');
    } catch { if (current(captured)) setNotice('This source changed or could not be read. Reload its current state; no upload or reading was repeated.'); }
    finally { endBusy(owner); }
  };
  const flow = selection || target;
  const unresolved=handoffRows.some(row=>row.phase==='link_unconfirmed'||row.phase==='linking')||savedLinkState==='unknown'
    ||!!(props.recoveryIntake&&!nativeThread.current);
  return <>
    <Button ref={trigger} type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label="Knowledge documents"
      title="Upload and review documents in Knowledge" disabled={props.disabled||!ready} onClick={show}><BookOpen className="h-4 w-4" aria-hidden="true"/></Button>
    <Dialog open={open} onOpenChange={next=>{if(!next)close();}}>
      {open&&!current()&&<KnowledgeDialogFrame title="Workspace changed" description="Close this review and reopen documents in your current chat."><Button onClick={close}>Close</Button></KnowledgeDialogFrame>}
      {open&&current()&&<KnowledgeDialogFrame title="Knowledge in this chat" description="Review and save text before Paige uses it as Knowledge." className="max-w-2xl max-h-[90dvh] overflow-y-auto"
        onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus();}}>
        <input ref={picker} type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json" className="hidden" aria-label="Choose Knowledge documents"
          onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';choose(files);}}/>
        {notice&&<p role="status" className="text-sm">{notice}</p>}
        {flow ? <AddKnowledgeFlow embedded tenantId={props.tenantId} attachedSelection={selection??undefined} replacementTarget={target??undefined}
          sourceLifetime={()=>current()} onClose={back} onPublished={syncHandoff}
          onExtractionAcknowledged={(value,context)=>handoff.current?.acknowledgeExtraction(value,context)}
          onPublicationVerified={(value,context)=>selection ? handoff.current?.verifyPublication(value,context) : intake ? linkSaved(intake,value,context) : undefined}/>
          : <>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy||unresolved} onClick={()=>picker.current?.click()}>Upload files</Button>
              {props.attachedFile&&<Button variant="outline" disabled={busy||unresolved} onClick={()=>choose([props.attachedFile!])}>Review attached document</Button>}
              <Button variant="outline" disabled={busy} onClick={()=>void load()}>Reload documents</Button>
            </div>
            {recoveryAbsent&&props.recoveryIntake&&!nativeThread.current&&<Button disabled={busy} onClick={()=>void finishOriginalReading()}>Link stored reading</Button>}
            {savedPublication&&intake&&(savedLinkState==='unknown'
              ?<Button disabled={busy} variant="outline" onClick={()=>void inspectSavedLink()}>Inspect saved text link</Button>
              :<Button disabled={busy} onClick={()=>void linkSaved(intake,savedPublication)}>Link saved text to this chat</Button>)}
            {handoffRows.length>0&&<ul aria-label="Current document handoffs" className="divide-y">{handoffRows.map(row=><li key={row.index} className="py-2 space-y-1">
              <p className="font-medium break-words">{row.name}</p><p className="text-sm">{rowLabel[row.phase]}</p>
              {row.phase==='link_absent'&&row.canRetryIntake&&<Button variant="outline" disabled={busy} onClick={()=>void handoff.current?.retryIntake(row.index)}>Link stored reading</Button>}
              {row.phase==='link_absent'&&!row.canRetryIntake&&<p className="text-sm">The local file could not be linked. Reopen its original reading in the Knowledge Bucket.</p>}
              {row.phase==='publication_unlinked'&&<Button variant="outline" disabled={busy} onClick={()=>void handoff.current?.retryPublication(row.index)}>Link stored publication</Button>}
            </li>)}</ul>}
            {handoffRows.some(row=>row.phase==='link_unconfirmed')&&<Button variant="outline" disabled={busy} onClick={()=>void handoff.current?.inspect().then(()=>{syncHandoff();void load();})}>Inspect conversation links</Button>}
            <ul aria-label="Documents saved with this chat" className="divide-y">{items.map((item,index)=>{
              if(item.status!=='recorded'||!item.current)return <li key={`unavailable-${index}`} className="py-3 text-sm">A previous source is unavailable or changed.</li>;
              const ref=item.reference, pending='phase' in ref;
              const link=routeLinkTarget({destination:'business_knowledge',record_id:ref.documentId},'solo',props.account);
              return <li key={ref.documentId} className="py-3 space-y-1"><p className="font-medium break-words">{titles[ref.documentId]??(pending?'Unfinished document':'Saved Knowledge document')}</p>
                <p className="text-sm">{pending?'Reading or review saved; publication is separate.':'Reviewed text saved in Knowledge.'}</p>
                {pending?<Button variant="outline" disabled={busy} onClick={()=>void inspectItem(item as Extract<ChatKnowledgeIntakeInspection,{current:true}>)}>Open original reading</Button>
                  :link&&<Link to={link.to} onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)close();}}
                    className="inline-flex min-h-11 items-center underline underline-offset-4">Open editable saved text</Link>}
              </li>;
            })}</ul>
            {cursor&&<Button variant="outline" disabled={busy} onClick={()=>void load(cursor)}>More documents</Button>}
          </>}
        {!flow&&<div className="flex justify-end"><Button variant="outline" onClick={close}>Close</Button></div>}
      </KnowledgeDialogFrame>}
    </Dialog>
  </>;
}
