import React from 'react';
import ReactMarkdown from 'react-markdown';
import {ArrowLeft,FileText,Loader2,RefreshCw} from 'lucide-react';
import {AgreementDocumentFields} from './AgreementDocumentFields';
import {AgreementSigningReview,type AgreementSigningReviewState} from './AgreementSigningReview';
import type {SigningMessageDraft} from './AgreementSignatureRequest';
import {AgreementSignatureHistory,type SignatureProgress} from './AgreementSignatureExecution';
import type {AgreementSignatureReference,AgreementSignatureCommand} from './agreementDocumentApi';
import {canonicalPresentationJson} from '../../../supabase/functions/_shared/agreements/preparation-json';
import type {AssignedField} from './agreementDocumentModel';
import type {AgreementFieldPreparation} from '../../../supabase/functions/_shared/agreements/field-preparation';
import {listAgreementDocumentHistory,prepareAgreementDocumentCommand,prepareAgreementCommercialCommand,readAgreementCommercialSources,readAgreementCommercialReview,readAgreementDocument,readAgreementDocumentPdf,readAgreementSigningReview,saveAgreementDocument,
  type AgreementCommercialReview,type AgreementCommercialSources,type AgreementDocumentCommand,type AgreementDocumentContext,type AgreementDocumentHistory,type AgreementDocumentReceipt,type AgreementDocumentView} from './agreementDocumentApi';
import './agreement-document-fields.css';

export type DocumentGuard={draft:AssignedField[];signatureDraft?:SigningMessageDraft|null;busy:boolean;uncertain:boolean;preparationId?:string;signatureUncertain?:boolean};
type Props={
  tenantId:string;actorId:string;agreementId:string;requestId:string|null;authorityKey:string;isCurrent:()=>boolean;
  resume:DocumentGuard;onGuard:(value:DocumentGuard,baseline?:AssignedField[])=>void;
  onRetainRequest:(id:string|null)=>boolean;onRequest:(action:()=>void)=>void;
  onReturn:()=>void;onAddSigners:()=>void;onAccessRefused:()=>void;
  signatureReference?:AgreementSignatureReference|null;onRetainSignatureRequest?:(value:AgreementSignatureReference)=>boolean;
};
type Phase='loading'|'ready'|'saving'|'checking'|'unconfirmed'|'refused'|'error';
type Session={phase:Phase;view:AgreementDocumentView|null;bytes:Uint8Array|null;fields:AssignedField[];command:AgreementDocumentCommand|null;receipt:AgreementDocumentReceipt|null;message:string;pdfError:boolean};
const initial:Session={phase:'loading',view:null,bytes:null,fields:[],command:null,receipt:null,message:'',pdfError:false};
const time=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const missingCommercialLabels:Record<string,string>={canonical_invoice_draft:'Recorded invoice draft',agreement_source_version:'Current agreement version',commercial_terms_reference:'Agreement-linked commercial terms',commercial_service_start:'Service start date',agreed_price_basis:'Agreed pricing basis',recorded_collection_terms:'Deposit, installments and due dates',tax_and_fee_treatment:'Recorded tax and fee treatment',recorded_invoice_lines:'Invoice items',complete_supported_commercial_presentation:'Complete supported commercial terms',complete_supported_commercial_terms:'Complete supported commercial terms'};

/** Read-only selection/review inside the original preparation. It owns no exit
 * guard, financial calculation, persisted draft, approval or execution path. */
function CommercialDocumentReview({context,onPrepare,onAccessRefused}:{context:()=>AgreementDocumentContext;onPrepare:(review:AgreementCommercialReview)=>void;onAccessRefused:()=>void}){
  const [page,setPage]=React.useState<AgreementCommercialSources|null>(null),[invoice,setInvoice]=React.useState('');
  const [listing,setListing]=React.useState<'loading'|'ready'|'error'>('loading'),[listMessage,setListMessage]=React.useState('');
  const [review,setReview]=React.useState<AgreementCommercialReview|null>(null),[reading,setReading]=React.useState(false),[reviewMessage,setReviewMessage]=React.useState('');
  const alive=React.useRef(false),generation=React.useRef(0),callbacks=React.useRef({context,onPrepare,onAccessRefused});callbacks.current={context,onPrepare,onAccessRefused};
  const heading=React.useRef<HTMLHeadingElement>(null),selection=React.useRef<HTMLSelectElement>(null),returnToSelection=React.useRef(false);
  const readChoices=async(cursor:string|null=null)=>{
    const ctx=callbacks.current.context(),opened=++generation.current;
    setListing('loading');setListMessage('');setPage(null);setInvoice('');setReview(null);setReading(false);setReviewMessage('');
    const result=await readAgreementCommercialSources(ctx,cursor);
    if(!alive.current||!ctx.isCurrent()||opened!==generation.current)return;
    if(result.ok===false){if(result.reason==='access_unverified'){callbacks.current.onAccessRefused();return;}setListing('error');setListMessage(result.message);return;}
    setPage(result.value);setListing('ready');
  };
  const initialRead=React.useRef(readChoices);initialRead.current=readChoices;
  React.useEffect(()=>{const readGeneration=generation;alive.current=true;void initialRead.current();return()=>{alive.current=false;readGeneration.current++;};},[]);
  React.useLayoutEffect(()=>{if(review)heading.current?.focus();else if(returnToSelection.current){returnToSelection.current=false;selection.current?.focus();}},[review]);
  const readTerms=async()=>{
    if(!invoice||reading)return;
    const ctx=callbacks.current.context(),opened=++generation.current,selected=invoice;
    setReading(true);setReview(null);setReviewMessage('');
    const result=await readAgreementCommercialReview(ctx,selected);
    if(!alive.current||!ctx.isCurrent()||opened!==generation.current)return;
    setReading(false);
    if(result.ok===false){if(result.reason==='access_unverified'){callbacks.current.onAccessRefused();return;}setReviewMessage(result.message);return;}
    setReview(result.value);
  };
  return <section className="e04-commercial-document-review" data-commercial-review aria-label="Recorded commercial terms" aria-busy={listing==='loading'||reading}>
    {review?.state!=='ready'&&<>
    <h4>Review the recorded terms</h4><p className="e04-native-preparation-status">Choose the invoice linked to this agreement. Review its original terms before preparing the signing document.</p>
    {listing==='loading'&&<p role="status">Reading this agreement’s invoice choices…</p>}
    {listing==='error'&&<div role="alert"><p>{listMessage}</p><button onClick={()=>{void readChoices();}}>Retry invoice choices</button></div>}
    {listing==='ready'&&page&&<>
      {page.items.length?<div className="e04-commercial-document-choice"><label>Agreement invoice<select ref={selection} aria-label="Agreement invoice" value={invoice} onChange={event=>{generation.current++;setInvoice(event.target.value);setReview(null);setReading(false);setReviewMessage('');}}><option value="">Choose an invoice</option>{page.items.map(item=><option key={item.invoice_id} value={item.invoice_id}>{item.invoice_number}</option>)}</select></label><button disabled={!invoice||reading} onClick={()=>{void readTerms();}}>{reading?'Reading original terms…':'Review recorded terms'}</button></div>:<div className="e04-commercial-document-empty"><h4>No linked invoice was returned</h4><p>Connect the correct client invoice in the original Sales billing records, then read the choices again.</p><button onClick={()=>{void readChoices();}}>Read invoice choices again</button></div>}
      <div className="e04-commercial-document-pages">{page.has_more&&<button onClick={()=>{void readChoices(page.next_cursor);}}>Read more invoice choices</button>}<button onClick={()=>{void readChoices();}}>Refresh invoice choices</button></div>
    </>}
    </>}
    {reading&&<p role="status">Checking the original invoice, agreement and commercial terms. No preparation request has been sent.</p>}
    {reviewMessage&&<p role="alert">{reviewMessage} Review the recorded terms again after checking the original source.</p>}
    {review?.state==='needs_input'&&<div role="status"><h4 ref={heading} tabIndex={-1} data-commercial-review-heading>Complete the original terms</h4><p>Correct these details in the original agreement, invoice or commercial terms, then review again.</p><ul>{review.fields.map(field=><li key={field}>{missingCommercialLabels[field]??field}</li>)}</ul></div>}
    {review?.state==='ready'&&<>
      <h4 ref={heading} tabIndex={-1} data-commercial-review-heading>Recorded commercial terms</h4><p className="e04-native-preparation-status">{page?.items.find(item=>item.invoice_id===review.invoice_id)?.invoice_number} · Review before document preparation</p>
      <article className="e04-preparation-paper e04-commercial-document-words" aria-label="Exact reviewed agreement wording"><ReactMarkdown components={{img:({alt})=><span>[Embedded image: {alt||'document image'}]</span>}}>{review.presented_body_markdown}</ReactMarkdown></article>
      <div className="e04-commercial-document-actions"><button className="e04-preparation-primary" onClick={()=>callbacks.current.onPrepare(review)}>Prepare exact PDF</button><button onClick={()=>{generation.current++;returnToSelection.current=true;setInvoice('');setReview(null);}}>Choose another invoice</button></div><p className="e04-native-preparation-status">Preparation does not send, sign or collect payment.</p>
    </>}
  </section>;
}

/** Mounted ONLY in the original scoped Sales preparation workspace. Its parent
 * owns the sole leave guard. Private proposals and PDF bytes remain in RAM;
 * the URL retains only the original request and business UUIDs for recovery. */
export function AgreementDocumentPreparation(props:Props){
  const [session,setSession]=React.useState<Session>(initial),[history,setHistory]=React.useState<AgreementDocumentHistory|null>(null);
  const [signingReview,setSigningReview]=React.useState<AgreementSigningReviewState|null>(null);
  const signatureDraft=React.useRef<SigningMessageDraft|null>(null);
  const signatureProgress=React.useRef<SignatureProgress>({busy:false,uncertain:Boolean(props.signatureReference)});
  const signingEpoch=React.useRef(0),reviewEntry=React.useRef<HTMLButtonElement>(null),returnToReviewEntry=React.useRef(false);
  const signatureHistoryHeading=React.useRef<HTMLHeadingElement>(null);
  const [historyState,setHistoryState]=React.useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [cursor,setCursor]=React.useState<number|null>(null),[historyMessage,setHistoryMessage]=React.useState('');
  const state=React.useRef(session),callbacks=React.useRef(props);callbacks.current=props;
  const alive=React.useRef(false),epoch=React.useRef(0),work=React.useRef(false),historyEpoch=React.useRef(0),fileEpoch=React.useRef(0);
  const reference=React.useRef(props.requestId),observedReference=React.useRef<string|null|undefined>(undefined);
  const resume=React.useRef(props.resume);
  const heading=React.useRef<HTMLHeadingElement>(null);
  const context=():AgreementDocumentContext=>{const opened=epoch.current;return {tenantId:props.tenantId,actorId:props.actorId,agreementId:props.agreementId,
    isCurrent:()=>alive.current&&epoch.current===opened&&callbacks.current.isCurrent()};};
  const publish=(next:Session,adoptBaseline=false,baseline=next.fields)=>{
    state.current=next;setSession(next);callbacks.current.onGuard({draft:next.fields,signatureDraft:signatureDraft.current,busy:next.phase==='saving'||next.phase==='checking'||signatureProgress.current.busy,uncertain:next.phase==='unconfirmed'||signatureProgress.current.uncertain,signatureUncertain:signatureProgress.current.uncertain,
      ...(next.view?.state==='retained'?{preparationId:next.view.preparation.id}:{})},adoptBaseline?baseline:undefined);
  };
  const progress=(value:SignatureProgress)=>{signatureProgress.current=value;publish({...state.current},value.retained===true);};
  const retireReview=()=>{signingEpoch.current++;signatureDraft.current=null;setSigningReview(null);};
  const refuse=()=>{retireReview();signatureProgress.current={busy:false,uncertain:false};epoch.current++;work.current=false;publish({...initial,phase:'error'},true);callbacks.current.onAccessRefused();};
  const retain=(id:string|null)=>{
    const prior=reference.current;reference.current=id;
    if(callbacks.current.onRetainRequest(id)){observedReference.current=id;return true;}
    reference.current=prior;return false;
  };
  const loadBytes=async(ctx:AgreementDocumentContext,view:AgreementDocumentView)=>{
    if(view.state!=='retained')return;
    const request=++fileEpoch.current,preparationId=view.preparation.id;
    const result=await readAgreementDocumentPdf(ctx,view);
    if(!ctx.isCurrent()||request!==fileEpoch.current||state.current.view?.state!=='retained'||state.current.view.preparation.id!==preparationId)return;
    if(result.ok===true)publish({...state.current,bytes:result.value,pdfError:false});
    else if(result.reason==='access_unverified')refuse();
    else publish({...state.current,bytes:null,pdfError:true,message:'The exact retained PDF could not be verified. Its preparation remains recorded; retry the file read.'});
  };
  const load=async(id:string|null,recovering=false,restore?:DocumentGuard)=>{
    if(work.current)return;work.current=true;
    retireReview();
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
    heading.current?.focus();return()=>{alive.current=false;workEpoch.current++;historyWorkEpoch.current++;};
  },[]);
  React.useLayoutEffect(()=>{
    // Saving replaces the old field controls with the verified native version.
    // Return keyboard focus to that result rather than leaving it on <body>.
    if(session.phase==='error'||session.phase==='ready'&&session.receipt)heading.current?.focus();
  },[session.phase,session.receipt]);
  React.useLayoutEffect(()=>{if(!signingReview&&returnToReviewEntry.current){returnToReviewEntry.current=false;if(reviewEntry.current&&!reviewEntry.current.disabled)reviewEntry.current.focus();else signatureHistoryHeading.current?.focus();}},[signingReview]);
  React.useEffect(()=>{
    if(observedReference.current===props.requestId)return;
    observedReference.current=props.requestId;reference.current=props.requestId;
    const prior=resume.current;resume.current={draft:[],busy:false,uncertain:false};
    void loadRef.current(props.requestId??prior.preparationId??null,Boolean(props.requestId),prior);
  },[props.requestId]);
  const save=async(preparation?:AgreementFieldPreparation,retry=false,commercialReview?:AgreementCommercialReview)=>{
    if(work.current||!callbacks.current.isCurrent())return;
    const previous=state.current,ctx=context();
    const command=retry?previous.command:previous.view?commercialReview?prepareAgreementCommercialCommand(ctx,crypto.randomUUID(),previous.view,commercialReview):prepareAgreementDocumentCommand(ctx,crypto.randomUUID(),previous.view,preparation):null;
    if(!command){publish({...previous,message:'Inspect the current agreement and document before saving a new preparation.'});return;}
    // Checkpoint precedes EVERY first dispatch. A retry retains the SAME command.
    if(!retain(command.request_id)){publish({...previous,message:'The recovery reference could not be retained. No preparation request was sent.'});return;}
    retireReview();
    work.current=true;historyEpoch.current++;publish({...previous,phase:'saving',command,message:'',receipt:null});
    const result=await saveAgreementDocument(ctx,command);if(!ctx.isCurrent())return;work.current=false;
    if(result.ok===false){if(result.reason==='access_unverified'){refuse();return;}
      const refused=result.reason==='source_changed'||result.reason==='commercial_review_required';
      publish({...previous,phase:refused?'refused':'unconfirmed',command,receipt:null,message:result.message});return;}
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
  const inspectSigning=async(restored?:AgreementSignatureCommand)=>{
    const current=state.current,value=current.view;
    if(work.current||current.phase!=='ready'||!current.bytes||current.pdfError||value?.state!=='retained'||!value.can_edit||!value.preparation.is_selected||!value.preparation.source_matches
      ||JSON.stringify(current.fields)!==JSON.stringify(value.preparation.manifest.fields))return;
    const opened=++signingEpoch.current,ctx=context();setSigningReview({phase:'loading'});
    const result=await readAgreementSigningReview(ctx,value);
    if(!ctx.isCurrent()||opened!==signingEpoch.current)return;
    if(result.ok===false){if(result.reason==='access_unverified'||result.reason==='retired'){refuse();return;}setSigningReview({phase:'error',reason:result.reason,message:result.message});return;}
    if(restored){
      const original=restored.review,r=result.value;
      if(original.preparation_id!==r.request.preparation_id||original.preparation_sha256!==r.request.preparation_sha256||restored.expected_review_sha256!==r.review_sha256
        ||canonicalPresentationJson(original)!==canonicalPresentationJson(r.request)){
        setSigningReview({phase:'error',reason:'source_changed',message:'The original review no longer matches this saved document. Inspect the current source before another request.'});return;}
      signatureDraft.current={review_sha256:r.review_sha256,operation_id:restored.operation_id,connector_id:restored.connector_id,messages:structuredClone(restored.messages),expected_request_sha256:restored.expected_request_sha256};
    }
    setSigningReview({phase:'ready',review:result.value});publish({...state.current});
  };
  const view=session.view,retained=view?.state==='retained'?view:null;
  const busy=session.phase==='saving'||session.phase==='checking';
  const documentEditable=Boolean(retained?.can_edit&&session.phase==='ready'&&session.bytes&&!session.pdfError&&!signatureProgress.current.busy&&!signatureProgress.current.uncertain&&!signatureProgress.current.readOnly);
  const editable=documentEditable&&!signingReview;
  const unsavedFields=Boolean(retained&&JSON.stringify(session.fields)!==JSON.stringify(retained.preparation.manifest.fields));
  const canReview=documentEditable&&retained?.preparation.is_selected&&retained?.preparation.source_matches&&!unsavedFields;
  const commercialRetained=retained?.preparation.manifest.schema_version===2;
  const reviewCommercial=Boolean(view?.source.status==='draft'&&(!retained||retained.preparation.is_selected)&&(view.preparation_hold==='commercial_review_required'||commercialRetained&&!retained?.can_edit&&retained?.can_prepare));
  const locked=signatureProgress.current.uncertain?'The original request needs verification before this document can be changed here.':signatureProgress.current.readOnly?'This document is tied to the retained signing request. Inspect its receipt before another request.':retained&&!retained.preparation.is_selected?'This earlier preparation is read-only. It has not replaced the selected document.':commercialRetained&&retained?.commercial_readback?.state!=='current'?retained?.commercial_readback?.state==='changed'?'The original commercial terms changed after this preparation. This retained version is read-only; review the current terms before preparing another.':'The current commercial terms could not be verified. This retained version remains read-only; retry the original source read.':retained&&!retained.preparation.source_matches?'The agreement or its signers changed after this preparation. Inspect the current source before preparing another version.':view?.preparation_hold==='commercial_review_required'?'This agreement is linked to commercial terms. Its original economics must be verified before document preparation.':'This agreement is no longer an editable signing draft.';
  return <section className="e04-native-preparation" aria-label="Retained document preparation" aria-busy={busy||session.phase==='loading'}>
    <div className="e04-native-preparation-heading"><button className="e04-preparation-back" disabled={busy} onClick={()=>callbacks.current.onRequest(callbacks.current.onReturn)}><ArrowLeft size={16} aria-hidden="true"/>Return to agreement</button><div><h3 ref={heading} tabIndex={-1}>Signing document</h3><p>{session.phase==='error'?'Original document unavailable':'Unsigned preparation for review'}</p></div>{retained&&<span className="e04-preparation-status">Preparation {retained.preparation.revision_no} · {retained.preparation.is_selected?'Selected':'Earlier version'}</span>}</div>
    {session.message&&<p className={session.phase==='error'||session.phase==='unconfirmed'||session.phase==='refused'?'e04-preparation-notice':'e04-native-preparation-status'} role={session.phase==='error'||session.phase==='unconfirmed'||session.phase==='refused'?'alert':'status'}>{session.message}</p>}
    {(session.phase==='loading'||busy)&&<div className="e04-preparation-message" role="status"><Loader2 className="e04-preparation-spinner" size={24} aria-hidden="true"/><h4>{session.phase==='saving'?'Confirming this preparation':session.phase==='checking'?'Checking the original request':'Reading the original document'}</h4><p>Keep this page open while the original record is checked.</p></div>}
    {session.phase==='error'&&<div className="e04-preparation-message" role="alert"><h4>Document preparation could not be opened</h4><p>Check the connection and original agreement access, then retry the read.</p><button onClick={()=>{void load(reference.current);}}><RefreshCw size={16} aria-hidden="true"/>Retry preparation read</button></div>}
    {session.phase==='unconfirmed'&&<div className="e04-preparation-recovery"><h4>Check the same preparation</h4><p>The earlier request may have completed. Its original identity is kept on this page; a new request is unavailable while its result is unconfirmed.</p><div><button className="e04-preparation-primary" onClick={()=>{void load(reference.current,true);}}>Check original preparation</button>{session.command&&<button onClick={()=>{void save(undefined,true);}}>Retry same request</button>}</div></div>}
    {session.phase==='refused'&&<div className="e04-preparation-recovery"><h4>Preparation was refused</h4><p>The source or reviewed terms do not match this request. Read the current original records before preparing another version. Unsaved field proposals still use the agreement’s leave confirmation.</p><button onClick={()=>choose(null)}>Read current agreement source</button></div>}
    {session.phase==='ready'&&reviewCommercial&&<CommercialDocumentReview key={`${view!.source.version}:${view!.source.updated_at}:${retained?.preparation.id??'none'}`} context={context} onPrepare={review=>{void save(undefined,false,review);}} onAccessRefused={refuse}/>}
    {session.phase==='ready'&&view?.state==='none'&&!reviewCommercial&&<div className="e04-preparation-message"><FileText size={28} aria-hidden="true"/><h4>No signing document has been prepared</h4><p>{view.can_prepare?'Create a retained PDF from this exact agreement. Then place and save the required signing fields.':locked}</p>{view.can_prepare&&<button className="e04-preparation-primary" onClick={()=>{void save();}}>Prepare exact PDF</button>}</div>}
    {session.phase==='ready'&&retained&&<>
      <div className="e04-native-preparation-history"><button onClick={()=>{void readHistory(null);}}>Inspect preparation history</button>{!retained.preparation.is_selected&&<button onClick={()=>choose(null)}>Read selected preparation</button>}
        {historyState==='loading'&&<p role="status">Reading retained versions…</p>}{historyState==='error'&&<p role="alert">{historyMessage}<button onClick={()=>{void readHistory(cursor);}}>Retry history</button></p>}
        {historyState==='ready'&&history&&<><label>Retained document version<select aria-label="Retained document version" value={history.items.some(item=>item.id===retained.preparation.id)?retained.preparation.id:''} onChange={event=>{if(event.target.value)choose(event.target.value);}}><option value="" disabled>Choose a retained version</option>{history.items.map(item=><option key={item.id} value={item.id}>Preparation {item.revision_no} · {time(item.created_at)}{item.is_selected?' · Selected':''}</option>)}</select></label>{!history.items.length&&<p>No retained preparations were returned in this page.</p>}{history.has_more&&<button onClick={()=>{void readHistory(history.items.at(-1)?.revision_no??null);}}>Read earlier preparations</button>}{cursor!==null&&<button onClick={()=>{void readHistory(null);}}>Read latest history</button>}</>}
      </div>
      {commercialRetained&&<p className="e04-document-readonly" role="status">{retained.commercial_readback?.state==='current'?'The retained commercial terms match the current original records. Payment and signing status remain separate.':locked}</p>}
      {!retained.can_edit&&!session.bytes&&<p className="e04-document-readonly" role="status">{locked}</p>}
      {retained.can_edit&&session.bytes&&!session.pdfError&&!signingReview&&<div className="e04-prepared-review-entry"><div><h4>Check the saved signing request</h4><p>Review recipients, signing order and assigned fields against this saved document.</p>{unsavedFields&&<p role="status">Save your field changes before reviewing the saved request.</p>}</div><button ref={reviewEntry} className="e04-preparation-primary" disabled={!canReview} onClick={()=>{void inspectSigning();}}>Review saved signing request</button></div>}
      {props.signatureReference&&!signingReview&&<AgreementSignatureHistory key={props.signatureReference.operation_id+props.signatureReference.request_sha256} reference={props.signatureReference} context={context} onProgress={progress} onAccessRefused={refuse} headingRef={signatureHistoryHeading} onResume={command=>{void inspectSigning(command);}} onFreshReview={canReview?()=>{void inspectSigning();}:undefined}/>}
      {signingReview&&<AgreementSigningReview state={signingReview} revisionNo={retained.preparation.revision_no} onReturn={()=>callbacks.current.onRequest(()=>{returnToReviewEntry.current=true;retireReview();publish({...state.current},true);})} onRetry={()=>{void inspectSigning();}} onReloadSource={()=>choose(null)} context={context} draft={signatureDraft.current} onDraft={value=>{if(!callbacks.current.isCurrent()||signingReview.phase!=='ready'||value.review_sha256!==signingReview.review.review_sha256)return;signatureDraft.current=value;publish({...state.current});}} onAccessRefused={refuse} onRetainSignatureRequest={reference=>callbacks.current.onRetainSignatureRequest?.(reference)===true} onSignatureProgress={progress}/>}
      {session.pdfError?<div className="e04-preparation-message" role="alert"><h4>Retained PDF unavailable</h4><p>The file has not passed byte and checksum verification. Your stored preparation has not been changed.</p><button onClick={retryPdf}>Retry retained PDF</button></div>:!session.bytes?<p role="status">Verifying the retained PDF…</p>:<AgreementDocumentFields key={retained.preparation.id} authorityKey={`${props.authorityKey}:${retained.preparation.id}`} canView canEdit={editable} lockedReason={signingReview?'Return to the document to change and save field assignments.':locked}
        title={retained.title} showTitle={false} bytes={session.bytes} document={retained.preparation.manifest.document} source={retained.source} signers={retained.document_signers} fields={session.fields} savedPreparationSha={retained.preparation.derived_fields_sha256??retained.preparation.preparation_sha256}
        onChange={fields=>{if(!editable||work.current)return;publish({...state.current,fields,message:''});}}
        onSave={preparation=>{void save(preparation);}} onReload={()=>callbacks.current.onRequest(retryPdf)} onAddSigners={()=>callbacks.current.onRequest(callbacks.current.onAddSigners)}/>}
      {!reviewCommercial&&retained.can_prepare&&(!retained.preparation.source_matches||!retained.preparation.is_selected)&&retained.preparation.is_selected&&<button className="e04-preparation-primary" onClick={()=>{void save();}}>Prepare current agreement version</button>}
      <details className="e04-native-preparation-receipt"><summary>Document record and receipt</summary><dl><dt>Retained</dt><dd>{time(retained.preparation.created_at)}</dd><dt>Original agreement content version</dt><dd>{retained.preparation.source_version}</dd><dt>Preparation reference</dt><dd>{retained.preparation.id}</dd><dt>Original event receipt</dt><dd>{retained.preparation.event_id}</dd><dt>Document SHA-256</dt><dd>{retained.preparation.document_sha256}</dd></dl><p>Preparation records do not establish approval, sending, consent, signatures, payment or completed services.</p></details>
    </>}
  </section>;
}
