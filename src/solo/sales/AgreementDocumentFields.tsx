import React from 'react';
import {ArrowLeft,ArrowRight,Check,FileText,Plus,Trash2,Undo2} from 'lucide-react';
import {prepareAgreementFields,type AgreementFieldPreparation} from '../../../supabase/functions/_shared/agreements/field-preparation';
import {AgreementPdfPage} from './AgreementPdfPage';
import {assignedFieldSchema,FIELD_KINDS,newAssignedField,pointOnDocument,positionField,type AssignedField,type DocumentDescriptor,type DocumentSigner,type FieldKind} from './agreementDocumentModel';
import './agreement-preparation.css';
import './agreement-document-fields.css';

type Props={
  authorityKey:string;canView:boolean;canEdit:boolean;lockedReason?:string;
  title:string;showTitle?:boolean;bytes:Uint8Array;document:DocumentDescriptor;source:unknown;signers:DocumentSigner[];
  fields:AssignedField[];savedPreparationSha?:string;onChange:(fields:AssignedField[])=>void;
  onSave:(preparation:AgreementFieldPreparation)=>void;onReload:()=>void;onAddSigners:()=>void;
};
export function AgreementDocumentFields(props:Props){
  if(!props.canView)return <div className="e04-pdf-notice" role="status">Document preparation is hidden while business access is checked.</div>;
  return <ScopedDocumentFields key={props.authorityKey} {...props}/>;
}
function ScopedDocumentFields({authorityKey,canEdit,lockedReason,title,showTitle=true,bytes,document,source,signers,fields,savedPreparationSha,onChange,onSave,onReload,onAddSigners}:Props){
  const [page,setPage]=React.useState(1),[kind,setKind]=React.useState<FieldKind>('signature');
  const [signer,setSigner]=React.useState(signers[0]?.id??''),[selectedId,setSelectedId]=React.useState<string|null>(null);
  const [zoom,setZoom]=React.useState<'fit'|number>('fit');
  const [ready,setReady]=React.useState<{page:number;sha256:string;zoom:'fit'|number}|null>(null);
  const [placing,setPlacing]=React.useState(false),[notice,setNotice]=React.useState('');
  const [validation,setValidation]=React.useState<{fields:AssignedField[];source:unknown;document:DocumentDescriptor;result:AgreementFieldPreparation}|null>(null);
  const [validationError,setValidationError]=React.useState('');
  const history=React.useRef<AssignedField[][]>([]);
  const [undoCount,setUndoCount]=React.useState(0);
  const selected=fields.find(field=>field.id===selectedId&&field.page===page)??null;
  const currentPage=document.pages[page-1];
  const pageReady=ready?.page===page&&ready.sha256===document.sha256&&ready.zoom===zoom;
  const editable=canEdit&&pageReady;
  const currentValidation=validation?.fields===fields&&validation.source===source&&validation.document===document?validation.result:null;
  const recipient=signers.find(person=>person.id===signer);
  React.useEffect(()=>{
    let current=true;setValidationError('');
    if(!canEdit){setValidation(null);return;}
    if(!assignedFieldSchema.array().max(500).safeParse(fields).success){setValidation(null);setValidationError('Give every field a label and a valid position before saving.');return;}
    void prepareAgreementFields(source,document,fields).then(result=>{if(current)setValidation({fields,source,document,result});}).catch(()=>{if(current){setValidation(null);setValidationError('The document, signers or field positions could not be verified. Reload the original preparation.');}});
    return()=>{current=false;};
  },[source,document,fields,canEdit]);
  const change=(next:AssignedField[])=>{
    if(!editable)return;
    history.current.push(fields.map(field=>({...field})));if(history.current.length>50)history.current.shift();
    setUndoCount(history.current.length);setNotice('Draft fields changed. Save the preparation to retain this version.');onChange(next);
  };
  const add=(point:{x:number;y:number})=>{
    if(!editable||!recipient||fields.length>=500)return;
    const field=newAssignedField(kind,recipient.id,currentPage,point);change([...fields,field]);setSelectedId(field.id);setPlacing(false);
  };
  const remove=()=>{if(!selected||!editable)return;change(fields.filter(field=>field.id!==selected.id));setSelectedId(null);};
  const update=(patch:Partial<AssignedField>)=>{
    if(!selected||!editable)return;
    const next={...selected,...patch};
    if(![next.width,next.height,next.x,next.y].every(Number.isFinite)||next.width<1||next.height<1||next.width>currentPage.width||next.height>currentPage.height){setNotice('Use a position and size within this document page.');return;}
    change(fields.map(field=>field.id===selected.id?positionField(next,currentPage,next.x,next.y):field));
  };
  const issues=currentValidation?.issues??[];
  const issueText=(issue:AgreementFieldPreparation['issues'][number])=>issue.code==='missing_signer'?'Add the intended signers before saving a review-ready preparation.':issue.code==='missing_signature'?`Place a required signature for ${signers.find(person=>person.id===issue.signer_id)?.full_name??'each signer'}.`:'Some fields overlap. Move them apart before saving.';
  return <section className="e04-document-fields" aria-label="Document field preparation" onKeyDown={event=>{if(event.key==='Escape'&&placing){event.preventDefault();event.stopPropagation();setPlacing(false);setNotice('Field placement canceled.');}}}>
    <header className="e04-document-fields-head"><div>{showTitle&&<h3>{title}</h3>}<p>{canEdit?'Place fields for the intended recipients. Nothing is sent from this workspace.':'Inspect the retained PDF and field positions. This view cannot change the document.'}</p></div><span className="e04-document-field-count">{fields.length} {fields.length===1?'field':'fields'}</span></header>
    {!canEdit&&<p className="e04-document-readonly" role="status">{lockedReason||'This retained preparation is read-only. Start a new preparation to change its fields.'}</p>}
    <div className="e04-document-tools"><label>Assign fields to<select aria-label="Field recipient" value={recipient?.id??''} disabled={!canEdit||!signers.length} onChange={event=>{setSigner(event.target.value);setPlacing(false);}}>{!signers.length&&<option value="">No signers on this agreement</option>}{signers.map(person=><option key={person.id} value={person.id}>{person.full_name} · {person.signer_role.replace(/_/g,' ')}</option>)}</select></label><div className="e04-document-kind" role="group" aria-label="Field type">{Object.entries(FIELD_KINDS).map(([value,label])=><button key={value} disabled={!canEdit} aria-pressed={kind===value} onClick={()=>{setKind(value as FieldKind);setPlacing(false);}}>{label}</button>)}</div></div>
    {!signers.length&&<div className="e04-document-empty"><FileText size={22} aria-hidden="true"/><div><strong>{canEdit?'Add the people who will sign':'Recipient labels are unavailable for this version'}</strong><p>{canEdit?'Fields must belong to the actual signers on this agreement.':'Current signer names are not substituted for earlier, unverified identities.'}</p></div>{canEdit&&<button onClick={onAddSigners}>Prepare signers</button>}</div>}
    <div className="e04-document-layout"><div className="e04-document-stage" data-placing={placing&&editable}><div className="e04-document-page-controls"><button aria-label="Previous document page" disabled={page===1} onClick={()=>{setPage(value=>value-1);setPlacing(false);}}><ArrowLeft size={16} aria-hidden="true"/></button><span>Page {page} of {document.pages.length}</span><button aria-label="Next document page" disabled={page===document.pages.length} onClick={()=>{setPage(value=>value+1);setPlacing(false);}}><ArrowRight size={16} aria-hidden="true"/></button><label className="e04-document-zoom">Zoom<select aria-label="Document zoom" value={String(zoom)} onChange={event=>{setZoom(event.target.value==='fit'?'fit':Number(event.target.value));setPlacing(false);}}><option value="fit">Fit to width</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div>
      <AgreementPdfPage bytes={bytes} document={document} pageNumber={page} zoom={zoom} authorityKey={authorityKey} canView onReady={setReady} onRetry={onReload} onDocumentClick={(event,descriptor)=>{if(!placing||!editable)return;const point=pointOnDocument(descriptor,event.currentTarget.getBoundingClientRect(),event.clientX,event.clientY);if(point)add(point);}}>
        {fields.filter(field=>field.page===page).map(field=>{
          const label=field.label+', '+(signers.find(person=>person.id===field.signer_id)?.full_name??'unverified recipient')+', page '+page+'.'+(canEdit?' Use arrow keys to move.':'');
          return <button type="button" key={field.id} className="e04-pdf-field" data-selected={selectedId===field.id} style={{left:`${field.x/currentPage.width*100}%`,top:`${field.y/currentPage.height*100}%`,width:`${field.width/currentPage.width*100}%`,height:`${field.height/currentPage.height*100}%`}} aria-label={label} onClick={event=>{event.stopPropagation();setSelectedId(field.id);setPlacing(false);}} onKeyDown={event=>{if(!editable||event.altKey||event.ctrlKey||event.metaKey)return;const step=event.shiftKey?10:1,delta:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};if(delta[event.key]){event.preventDefault();setSelectedId(field.id);const [x,y]=delta[event.key];change(fields.map(item=>item.id===field.id?positionField(item,currentPage,item.x+x,item.y+y):item));}else if(event.key==='Delete'){event.preventDefault();change(fields.filter(item=>item.id!==field.id));setSelectedId(null);}}}><span>{field.label}{field.required?' *':''}</span></button>;
        })}
      </AgreementPdfPage>
    </div><aside className="e04-document-inspector" aria-label="Assigned fields"><div className="e04-document-place"><h4>Place a {FIELD_KINDS[kind].toLowerCase()}</h4><p>{recipient?`Assigned to ${recipient.full_name}.`:'Choose an agreement signer first.'}</p><button disabled={!editable||!recipient||fields.length>=500} aria-pressed={placing} onClick={()=>setPlacing(value=>!value)}><Plus size={16} aria-hidden="true"/>{placing?'Choose a point on the page':'Place on document'}</button><button disabled={!editable||!recipient||fields.length>=500} onClick={()=>add({x:currentPage.width/2,y:currentPage.height/2})}>Add at page centre</button><p className="e04-document-help">Use the position controls or arrow keys for precise adjustments. Shift moves ten points.</p></div>
      <div className="e04-document-assigned"><h4>Assigned fields</h4>{!fields.length?<p>No fields placed yet.</p>:<ol>{fields.map(field=><li key={field.id}><button aria-pressed={selectedId===field.id} onClick={()=>{setPage(field.page);setSelectedId(field.id);setPlacing(false);}}><span>{field.label||'Field label required'}</span><small>{signers.find(person=>person.id===field.signer_id)?.full_name??'Recipient unavailable'} · Page {field.page}</small></button></li>)}</ol>}</div>
      {selected&&<fieldset className="e04-document-field-properties" disabled={!editable}><legend>Selected field</legend><label>Field label<input value={selected.label} maxLength={160} onChange={event=>update({label:event.target.value})}/></label><label>Assigned signer<select value={selected.signer_id} onChange={event=>update({signer_id:event.target.value})}>{signers.map(person=><option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><div className="e04-document-position">{(['x','y','width','height']as const).map(key=><label key={key}>{key==='x'?'Left':key==='y'?'Top':key==='width'?'Width':'Height'} (pt)<input type="number" step="1" min={key==='width'||key==='height'?1:0} aria-label={`${key==='x'?'Left':key==='y'?'Top':key==='width'?'Width':'Height'} position in points`} value={Math.round(selected[key]*100)/100} onChange={event=>update({[key]:event.currentTarget.valueAsNumber})}/></label>)}</div><label className="e04-document-required"><input type="checkbox" checked={selected.required} disabled={selected.kind==='signature'||!editable} onChange={event=>update({required:event.target.checked})}/>Required{selected.kind==='signature'?' signature':''}</label><button onClick={remove}><Trash2 size={15} aria-hidden="true"/>Remove draft field</button></fieldset>}
    </aside></div>
    <div className="e04-document-review"><button disabled={!editable||!undoCount} onClick={()=>{const previous=history.current.pop();if(previous){setUndoCount(history.current.length);setSelectedId(null);onChange(previous);setNotice('Previous draft field arrangement restored.');}}}><Undo2 size={16} aria-hidden="true"/>Undo field change</button><div aria-live="polite">{!canEdit?<p>Read-only field inspection.</p>:validationError?<p role="alert">{validationError}</p>:issues.length?<ul>{issues.map((issue,index)=><li key={index}>{issueText(issue)}</li>)}</ul>:<p>{currentValidation?'Field placement is prepared for review.':'Checking field placement…'}</p>}<p className="e04-document-help">Save unfinished fields to return later. Required fields and overlaps must be resolved before requesting signatures.</p></div><button className="e04-preparation-primary" disabled={!editable||!currentValidation||currentValidation.preparation_sha256===savedPreparationSha} onClick={()=>{if(editable&&currentValidation&&currentValidation.preparation_sha256!==savedPreparationSha)onSave(currentValidation);}}><Check size={16} aria-hidden="true"/>{savedPreparationSha!==undefined&&currentValidation?.preparation_sha256===savedPreparationSha?'Fields saved':currentValidation?.ready_for_review?'Save document preparation':'Save draft fields'}</button></div>
    <p className="e04-document-feedback" role="status">{notice}</p>
  </section>;
}
