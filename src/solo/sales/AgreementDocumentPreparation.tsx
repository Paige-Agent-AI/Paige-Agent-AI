import React from 'react';
import {ArrowLeft,FileText,Loader2,RefreshCw} from 'lucide-react';
import {AgreementDocumentFields} from './AgreementDocumentFields';
import type {AssignedField} from './agreementDocumentModel';
import type {AgreementFieldPreparation} from '../../../supabase/functions/_shared/agreements/field-preparation';
import {listAgreementDocumentHistory,prepareAgreementDocumentCommand,readAgreementDocument,readAgreementDocumentPdf,saveAgreementDocument,
  type AgreementDocumentCommand,type AgreementDocumentContext,type AgreementDocumentHistory,type AgreementDocumentReceipt,type AgreementDocumentView} from './agreementDocumentApi';
import './agreement-document-fields.css';

export type DocumentGuard={draft:AssignedField[];busy:boolean;uncertain:boolean;preparationId?:string};
type Props={
  tenantId:string;actorId:string;agreementId:string;requestId:string|null;authorityKey:string;isCurrent:()=>boolean;
  resume:DocumentGuard;onGuard:(value:DocumentGuard,baseline?:AssignedField[])=>void;
  onRetainRequest:(id:string|null)=>boolean;onRequest:(action:()=>void)=>void;
  onReturn:()=>void;onAddSigners:()=>void;onAccessRefused:()=>void;
};
type Phase='loading'|'ready'|'saving'|'checking'|'unconfirmed'|'error';
type Session={phase:Phase;view:AgreementDocumentView|null;bytes:Uint8Array|null;fields:AssignedField[];command:AgreementDocumentCommand|null;receipt:AgreementDocumentReceipt|null;message:string;pdfError:boolean};
const initial:Session={phase:'loading',view:null,bytes:null,fields:[],command:null,receipt:null,message:'',pdfError:false};
const time=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

/** Mounted ONLY in the original scoped Sales preparation workspace. Its parent
 * owns the sole leave guard. Private proposals and PDF bytes remain in RAM;
 * the URL retains only the original request and business UUIDs for recovery. */
export function AgreementDocumentPreparation(props:Props){
  const [session,setSession]=React.useState<Session>(initial),[history,setHistory]=React.useState<AgreementDocumentHistory|null>(null);
  const [historyState,setHistoryState]=React.useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [cursor,setCursor]=React.useState<number|null>(null),[historyMessage,setHistoryMessage]=React.useState('');
  const state=React.useRef(session),callbacks=React.useRef(props);callbacks.current=props;
  const alive=React.useRef(false),epoch=React.useRef(0),work=React.useRef(false),historyEpoch=React.useRef(0);
  const reference=React.useRef(props.requestId),observedReference=React.useRef<string|null|undefined>(undefined);
  const resume=React.useRef(props.resume);
  const heading=React.useRef<HTMLHeadingElement>(null);
  const context=():AgreementDocumentContext=>{const opened=epoch.current;return {tenantId:props.tenantId,actorId:props.actorId,agreementId:props.agreementId,
    isCurrent:()=>alive.current&&epoch.current===opened&&callbacks.current.isCurrent()};};
  const publish=(next:Session,adoptBaseline=false,baseline=next.fields)=>{
    state.current=next;setSession(next);callbacks.current.onGuard({draft:next.fields,busy:next.phase==='saving'||next.phase==='checking',uncertain:next.phase==='unconfirmed',
      ...(next.view?.state==='retained'?{preparationId:next.view.preparation.id}:{})},adoptBaseline?baseline:undefined);
  };
  const refuse=()=>{epoch.current++;work.current=false;publish({...initial,phase:'error'},true);callbacks.current.onAccessRefused();};
  const retain=(id:string|null)=>{
    const prior=reference.current;reference.current=id;
    if(callbacks.current.onRetainRequest(id)){observedReference.current=id;return true;}
    reference.current=prior;return false;
  };
  const loadBytes=async(ctx:AgreementDocumentContext,view:AgreementDocumentView)=>{
    if(view.state!=='retained')return;
    const result=await readAgreementDocumentPdf(ctx,view);if(!ctx.isCurrent())return;
    if(result.ok===true)publish({...state.current,bytes:result.value,pdfError:false});
    else if(result.reason==='access_unverified')refuse();
    else publish({...state.current,bytes:null,pdfError:true,message:'The exact retained PDF could not be verified. Its preparation remains recorded; retry the file read.'});
  };
  const load=async(id:string|null,recovering=false,restore?:DocumentGuard)=>{
    if(work.current)return;work.current=true;
    epoch.current++;reference.current=id;
    const ctx=context(),previous=restore?{...state.current,fields:restore.draft}:state.current;
    publish({...previous,phase:recovering?'checking':'loading',view:null,bytes:null,pdfError:false,message:''});
    const result=await readAgreementDocument(ctx,id);if(!ctx.isCurrent())return;work.current=false;
    if(result.ok===false){if(result.reason==='access_unverified'){refuse();return;}
      publish({...previous,phase:id?'unconfirmed':'error',view:null,bytes:null,pdfError:false,message:result.message});return;}
    const view=result.value;
    // An explicit current-document entry also needs a stable reload location.
    // This checkpoints a VERIFIED native identity; it dispatches no mutation.
    const checkpointed=id!==null||view.state!=='retained'||retain(view.preparation.id);
    const baseline=view.state==='retained'?structuredClone(view.preparation.manifest.fields):[];
    const restoring=restore&&!restore.uncertain&&view.state==='retained'&&restore.preparationId===view.preparation.id;
    const fields=restoring?restore.draft:baseline;
    publish({phase:'ready',view,bytes:null,fields,command:null,receipt:null,message:!checkpointed?'The document was read, but its return reference could not be retained. Reopen this preparation from its agreement after reload.':restoring&&JSON.stringify(fields)!==JSON.stringify(baseline)?'Your unsaved field proposal is still here. The original document was rechecked; save only if its current source is editable.':id?'The retained preparation was read from its original agreement. Current signing and payment status are separate.':'',pdfError:false},true,baseline);
    await loadBytes(ctx,view);
  };
  const loadRef=React.useRef(load);loadRef.current=load;
  React.useEffect(()=>{
    const workEpoch=epoch,historyWorkEpoch=historyEpoch;alive.current=true;
    // The SAME native Sales tabs remain usable in a bounded narrow row. Reveal
    // the selected destination without changing route, focus or unsaved work.
    heading.current?.closest('.sales-department')?.querySelector<HTMLElement>('.sales-tabs [aria-selected=true]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    heading.current?.focus();return()=>{alive.current=false;workEpoch.current++;historyWorkEpoch.current++;};
  },[]);
  React.useEffect(()=>{
    if(observedReference.current===props.requestId)return;
    observedReference.current=props.requestId;reference.current=props.requestId;
    const prior=resume.current;resume.current={draft:[],busy:false,uncertain:false};
    void loadRef.current(props.requestId??prior.preparationId??null,Boolean(props.requestId),prior);
  },[props.requestId]);
  const save=async(preparation?:AgreementFieldPreparation,retry=false)=>{
    if(work.current||!callbacks.current.isCurrent())return;
    const previous=state.current,ctx=context();
    const command=retry?previous.command:previous.view?prepareAgreementDocumentCommand(ctx,crypto.randomUUID(),previous.view,preparation):null;
    if(!command){publish({...previous,message:'Inspect the current agreement and document before saving a new preparation.'});return;}
    // Checkpoint precedes EVERY first dispatch. A retry retains the SAME command.
    if(!retain(command.request_id)){publish({...previous,message:'The recovery reference could not be retained. No preparation request was sent.'});return;}
    work.current=true;publish({...previous,phase:'saving',command,message:'',receipt:null});
    const result=await saveAgreementDocument(ctx,command);if(!ctx.isCurrent())return;work.current=false;
    if(result.ok===false){if(result.reason==='access_unverified'){refuse();return;}
      publish({...previous,phase:'unconfirmed',command,receipt:null,message:result.message});return;}
    const {view,receipt}=result.value;
    publish({phase:'ready',view,bytes:null,fields:view.state==='retained'?structuredClone(view.preparation.manifest.fields):[],command:null,receipt,
      message:receipt.state==='recovered'?'The original preparation receipt was recovered. Its current selection is shown separately.':'Document preparation recorded. Nothing has been sent for signature.',pdfError:false},true);
    setHistory(null);setHistoryState('idle');setCursor(null);
    await loadBytes(ctx,view);
  };
  const readHistory=async(before:number|null=null)=>{
    if(work.current)return;
    const ctx=context(),opened=++historyEpoch.current;setHistoryState('loading');setHistory(null);setHistoryMessage('');
    const result=await listAgreementDocumentHistory(ctx,before);if(!ctx.isCurrent()||opened!==historyEpoch.current)return;
    if(result.ok===false){if(result.reason==='access_unverified'){refuse();return;}setHistoryState('error');setHistoryMessage(result.message);return;}
    setHistory(result.value);setHistoryState('ready');setCursor(before);
  };
  const choose=(id:string|null)=>callbacks.current.onRequest(()=>{if(retain(id))void loadRef.current(id,Boolean(id));});
  const retryPdf=()=>{const value=state.current.view;if(value?.state==='retained')void loadBytes(context(),value);};
  const view=session.view,retained=view?.state==='retained'?view:null;
  const busy=session.phase==='saving'||session.phase==='checking';
  const editable=Boolean(retained?.can_edit&&session.phase==='ready'&&session.bytes&&!session.pdfError);
  const locked=retained&&!retained.preparation.is_selected?'This earlier preparation is read-only. It has not replaced the selected document.':retained&&!retained.preparation.source_matches?'The agreement or its signers changed after this preparation. Inspect the current source before preparing another version.':view?.preparation_hold==='commercial_review_required'?'This agreement is linked to commercial terms. Its original economics must be verified before document preparation.':'This agreement is no longer an editable signing draft.';
  return <section className="e04-native-preparation" aria-label="Retained document preparation" aria-busy={busy||session.phase==='loading'}>
    <div className="e04-native-preparation-heading"><button className="e04-preparation-back" disabled={busy} onClick={()=>callbacks.current.onRequest(callbacks.current.onReturn)}><ArrowLeft size={16} aria-hidden="true"/>Return to agreement</button><div><h3 ref={heading} tabIndex={-1}>Signing document</h3><p>Unsigned preparation for review</p></div>{retained&&<span className="e04-preparation-status">Preparation {retained.preparation.revision_no} · {retained.preparation.is_selected?'Selected':'Earlier version'}</span>}</div>
    {session.message&&<p className={session.phase==='error'||session.phase==='unconfirmed'?'e04-preparation-notice':'e04-native-preparation-status'} role={session.phase==='error'||session.phase==='unconfirmed'?'alert':'status'}>{session.message}</p>}
    {(session.phase==='loading'||busy)&&<div className="e04-preparation-message" role="status"><Loader2 className="e04-preparation-spinner" size={24} aria-hidden="true"/><h4>{session.phase==='saving'?'Confirming this preparation':session.phase==='checking'?'Checking the original request':'Reading the original document'}</h4><p>Keep this page open while the original record is checked.</p></div>}
    {session.phase==='error'&&<div className="e04-preparation-message" role="alert"><h4>Document preparation could not be opened</h4><p>Check the connection and original agreement access, then retry the read.</p><button onClick={()=>{void load(reference.current);}}><RefreshCw size={16} aria-hidden="true"/>Retry preparation read</button></div>}
    {session.phase==='unconfirmed'&&<div className="e04-preparation-recovery"><h4>Check the same preparation</h4><p>The earlier request may have completed. Its original identity is kept on this page; a new request is unavailable while its result is unconfirmed.</p><div><button className="e04-preparation-primary" onClick={()=>{void load(reference.current,true);}}>Check original preparation</button>{session.command&&<button onClick={()=>{void save(undefined,true);}}>Retry same request</button>}</div></div>}
    {session.phase==='ready'&&view?.state==='none'&&<div className="e04-preparation-message"><FileText size={28} aria-hidden="true"/><h4>No signing document has been prepared</h4><p>{view.can_prepare?'Create a retained PDF from this exact agreement. Then place and save the required signing fields.':locked}</p>{view.can_prepare&&<button className="e04-preparation-primary" onClick={()=>{void save();}}>Prepare exact PDF</button>}</div>}
    {session.phase==='ready'&&retained&&<>
      <div className="e04-native-preparation-history"><button onClick={()=>{void readHistory(null);}}>Inspect preparation history</button>{!retained.preparation.is_selected&&<button onClick={()=>choose(null)}>Read selected preparation</button>}
        {historyState==='loading'&&<p role="status">Reading retained versions…</p>}{historyState==='error'&&<p role="alert">{historyMessage}<button onClick={()=>{void readHistory(cursor);}}>Retry history</button></p>}
        {historyState==='ready'&&history&&<><label>Retained document version<select aria-label="Retained document version" value={history.items.some(item=>item.id===retained.preparation.id)?retained.preparation.id:''} onChange={event=>{if(event.target.value)choose(event.target.value);}}><option value="" disabled>Choose a retained version</option>{history.items.map(item=><option key={item.id} value={item.id}>Preparation {item.revision_no} · {time(item.created_at)}{item.is_selected?' · Selected':''}</option>)}</select></label>{!history.items.length&&<p>No retained preparations were returned in this page.</p>}{history.has_more&&<button onClick={()=>{void readHistory(history.items.at(-1)?.revision_no??null);}}>Read earlier preparations</button>}{cursor!==null&&<button onClick={()=>{void readHistory(null);}}>Read latest history</button>}</>}
      </div>
      {!retained.can_edit&&!session.bytes&&<p className="e04-document-readonly" role="status">{locked}</p>}
      {session.pdfError?<div className="e04-preparation-message" role="alert"><h4>Retained PDF unavailable</h4><p>The file has not passed byte and checksum verification. Your stored preparation has not been changed.</p><button onClick={retryPdf}>Retry retained PDF</button></div>:!session.bytes?<p role="status">Verifying the retained PDF…</p>:<AgreementDocumentFields key={retained.preparation.id} authorityKey={`${props.authorityKey}:${retained.preparation.id}`} canView canEdit={editable} lockedReason={locked}
        title={retained.title} showTitle={false} bytes={session.bytes} document={retained.preparation.manifest.document} source={retained.source} signers={retained.document_signers} fields={session.fields} savedPreparationSha={retained.preparation.preparation_sha256}
        onChange={fields=>{if(!editable||work.current)return;publish({...state.current,fields,message:''});}}
        onSave={preparation=>{void save(preparation);}} onReload={()=>callbacks.current.onRequest(retryPdf)} onAddSigners={()=>callbacks.current.onRequest(callbacks.current.onAddSigners)}/>}
      {retained.can_prepare&&(!retained.preparation.source_matches||!retained.preparation.is_selected)&&retained.preparation.is_selected&&<button className="e04-preparation-primary" onClick={()=>{void save();}}>Prepare current agreement version</button>}
      <details className="e04-native-preparation-receipt"><summary>Document record and receipt</summary><dl><dt>Retained</dt><dd>{time(retained.preparation.created_at)}</dd><dt>Original agreement content version</dt><dd>{retained.preparation.source_version}</dd><dt>Preparation reference</dt><dd>{retained.preparation.id}</dd><dt>Original event receipt</dt><dd>{retained.preparation.event_id}</dd><dt>Document SHA-256</dt><dd>{retained.preparation.document_sha256}</dd></dl><p>Preparation records do not establish approval, sending, consent, signatures, payment or completed services.</p></details>
    </>}
  </section>;
}
