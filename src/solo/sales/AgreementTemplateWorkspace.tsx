import React from 'react';
import ReactMarkdown from 'react-markdown';
import {ArrowLeft,ArrowRight,FileText,Loader2,Plus,RefreshCw,Search} from 'lucide-react';
import {useTenantContext} from '@/hooks/useTenantContext';
import {useSalesDraftExit} from '../sales-dialog';
import {AgreementBodyEditor} from './AgreementBodyEditor';
import {listAgreementTemplates,prepareTemplateVersion,readAgreementTemplate,recoverTemplateCreation,saveTemplateVersion,
  sameReviewedTemplateVersion,unspecifiedTemplateOptions,type AgreementTemplateCursor,type AgreementTemplateSummary,
  type AgreementTemplateVersion,type TemplatePreparationOptions,type TemplateVersionCommand} from './agreementTemplateApi';
import './agreement-preparation.css';
import './agreement-templates.css';

type Props={tenantId:string|null;canManage:boolean;authorityUnknown:boolean;authorizationReady:boolean;
  selection:string;requestId:string|null;requestTenantId:string|null;sourceId:string|null;freshlyOpened:boolean;
  onAttempted:(request:string)=>void;onClose:()=>void;onOpenVersion:(id:string)=>void;
  onNewVersion:(sourceId:string|null)=>void;onUseVersion:(id:string)=>void;onRefresh:()=>void};
type Phase='loading'|'list'|'editing'|'saving'|'unconfirmed'|'conflict'|'blocked'|'record'|'error';
type Form={title:string;body:string;options:TemplatePreparationOptions};
const emptyForm=():Form=>({title:'',body:'',options:{...unspecifiedTemplateOptions}});
const textSource=(row:AgreementTemplateVersion)=>!row.has_uploaded_source&&row.source_mode!=='tenant_upload'&&row.body_markdown!==null;
const reviewLabel=(route:string|undefined)=>route==='qualified_legal'?'Qualified legal review':route==='business'?'Business review':'Not specified';
const at=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

/** One original Sales workspace; private wording is never persisted in browser storage. */
export function AgreementTemplateWorkspace(props:Props){
  const scope=useTenantContext(),actor=scope.accountContextStatus==='signed_out'?null:scope.activeUserId;
  return <ScopedTemplates key={`${scope.activeTenantId}:${actor}:${props.selection}:${props.requestId}:${props.sourceId}`}
    {...props} activeTenantId={scope.activeTenantId} actor={actor} scopeReady={scope.accountContextStatus==='ready'}/>;
}
function ScopedTemplates(p:Props&{activeTenantId:string|null;actor:string|null;scopeReady:boolean}){
  const fresh=React.useRef(p.selection==='new'&&p.freshlyOpened),loaded=React.useRef(false);
  const [phase,setPhase]=React.useState<Phase>('loading'),[form,setForm]=React.useState<Form>(emptyForm);
  const [source,setSource]=React.useState<AgreementTemplateVersion|null>(null),[record,setRecord]=React.useState<AgreementTemplateVersion|null>(null);
  const [items,setItems]=React.useState<AgreementTemplateSummary[]>([]),[cursor,setCursor]=React.useState<AgreementTemplateCursor|null>(null);
  const [archived,setArchived]=React.useState(false),[filter,setFilter]=React.useState(''),[message,setMessage]=React.useState('');
  const [retired,setRetired]=React.useState(false),[reading,setReading]=React.useState(false),[preview,setPreview]=React.useState(false);
  const [foundOriginalId,setFoundOriginalId]=React.useState<string|null>(null);
  const [reload,retryRead]=React.useReducer((n:number)=>n+1,0);
  const command=React.useRef<TemplateVersionCommand|null>(null),busy=React.useRef(false),readingId=React.useRef(0);
  const heading=React.useRef<HTMLHeadingElement>(null),title=React.useRef<HTMLInputElement>(null),wording=React.useRef<HTMLDivElement>(null);
  const originMatches=p.selection!=='new'||p.requestTenantId===p.tenantId;
  const allowed=Boolean(!retired&&p.scopeReady&&p.actor&&p.tenantId&&p.activeTenantId===p.tenantId&&originMatches
    &&p.authorizationReady&&p.canManage&&!p.authorityUnknown);
  const authority=React.useRef({allowed,epoch:0});
  if(authority.current.allowed!==allowed)authority.current={allowed,epoch:authority.current.epoch+1};
  const uncertain=phase==='unconfirmed'||(p.selection==='new'&&!fresh.current&&!record);
  const exit=useSalesDraftExit(form,phase==='saving',p.onClose,{uncertain});
  const adopt=exit.adoptBaseline;
  const phaseRef=React.useRef(phase);phaseRef.current=phase;
  const callbacks=React.useRef(p);callbacks.current=p;
  const current=(epoch:number,id:number)=>exit.alive.current&&authority.current.allowed&&authority.current.epoch===epoch&&readingId.current===id;
  const retire=()=>{
    if(retired)return;
    readingId.current++;busy.current=false;fresh.current=false;loaded.current=false;command.current=null;
    setForm(emptyForm());setSource(null);setRecord(null);setItems([]);setCursor(null);setFoundOriginalId(null);setReading(false);setPhase('error');setRetired(true);
    adopt(emptyForm());if(p.requestId)p.onAttempted(p.requestId);p.onRefresh();
  };
  React.useEffect(()=>{
    if((p.authorizationReady&&!p.authorityUnknown&&!p.canManage)||(!p.actor&&p.scopeReady))retire();
    else if(!allowed&&phaseRef.current==='saving'){busy.current=false;setPhase('unconfirmed');}
    // Authority can hide RAM transiently; a conclusive loss retires it permanently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[p.authorizationReady,p.authorityUnknown,p.canManage,p.actor,p.scopeReady,allowed]);
  React.useEffect(()=>{heading.current?.focus();},[phase,p.selection]);
  React.useEffect(()=>{
    if(!allowed||!p.tenantId)return;
    if(p.selection==='new'&&loaded.current)return;
    const epoch=authority.current.epoch,id=++readingId.current,tenant=p.tenantId;
    setPhase('loading');setMessage('');
    void(async()=>{
      if(p.selection==='list'){
        const result=await listAgreementTemplates(tenant,null,!archived);
        if(!current(epoch,id))return;
        if(result.ok===true){setItems(result.value.items);setCursor(result.value.next_cursor);setPhase('list');}
        else if(result.refusal==='authority')retire();else{setPhase('error');setMessage(result.message);}
      }else if(p.selection==='new'&&fresh.current&&p.requestId){
        if(p.sourceId){
          const result=await readAgreementTemplate(tenant,p.sourceId);
          if(!current(epoch,id))return;
          if(result.ok===false){if(result.refusal==='authority')retire();else{setPhase('error');setMessage(result.message);}return;}
          if(!textSource(result.value)){setPhase('error');setMessage('This retained source needs its original document preparation path. It cannot be replaced with text here.');return;}
          const initial={title:result.value.title,body:result.value.body_markdown!,options:{...result.value.preparation_options??unspecifiedTemplateOptions}};
          setSource(result.value);setForm(initial);adopt(initial);
        }else{setForm(emptyForm());adopt(emptyForm());}
        loaded.current=true;setPhase('editing');
      }else if(p.selection==='new'&&p.requestId){
        const result=await recoverTemplateCreation(tenant,p.requestId);
        if(!current(epoch,id))return;
        if(result.ok===true&&result.value.state==='recovered'){setRecord(result.value.version_record);setPhase('record');}
        else if(result.ok===false&&result.refusal==='authority')retire();
        else{loaded.current=true;setPhase('unconfirmed');setMessage('The original template request is not confirmed. Check it again before starting another. Its wording is not stored in this browser.');}
      }else if(p.selection!=='new'){
        const result=await readAgreementTemplate(tenant,p.selection);
        if(!current(epoch,id))return;
        if(result.ok===true){setRecord(result.value);setPhase('record');}
        else if(result.refusal==='authority')retire();else{setPhase('error');setMessage(result.message);}
      }else{setPhase('error');setMessage('Open a new template from the original business library.');}
    })();
    const pendingReads=readingId; // Capture the stable request clock, not a DOM ref or its old numeric value.
    return()=>{pendingReads.current++;};
    // All async publication is fenced by the current actor/business/authority epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[allowed,p.tenantId,p.selection,p.requestId,p.sourceId,archived,reload,adopt]);

  const recover=async()=>{
    if(!allowed||!p.tenantId||!p.requestId||busy.current||reading)return;
    const epoch=authority.current.epoch,id=++readingId.current;setReading(true);setMessage('');
    const result=await recoverTemplateCreation(p.tenantId,p.requestId);
    if(!current(epoch,id))return;
    setReading(false);
    if(result.ok===false){if(result.refusal==='authority')retire();else setMessage(result.message);return;}
    if(result.value.state==='unconfirmed'){setMessage('The same original request is still unconfirmed. Its first save may still finish.');return;}
    if(command.current&&!sameReviewedTemplateVersion(result.value.version_record,command.current)){
      setFoundOriginalId(result.value.version_record.id);
      setMessage('An original retained version was found, but it does not confirm this proposal. Inspect that version before deciding what to do next.');return;
    }
    setRecord(result.value.version_record);adopt(emptyForm());setForm(emptyForm());setPhase('record');
    setMessage('The exact original template request was recovered. Review its retained wording below.');
  };
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();if(!allowed||!p.tenantId||!p.requestId||busy.current||reading)return;
    if(phase!=='editing'&&!(phase==='unconfirmed'&&command.current))return;
    if(!command.current){
      if(!form.title.trim()){setMessage('Name this template.');title.current?.focus();return;}
      if(!form.body.trim()){setMessage('Add the wording supplied by your business.');wording.current?.querySelector<HTMLElement>('textarea,[contenteditable="true"]')?.focus();return;}
      command.current=prepareTemplateVersion(p.tenantId,p.requestId,source,form.title,form.body,form.options);
      if(!command.current){setMessage('Review the original source, wording and preparation options.');return;}
    }
    const reviewed=command.current,epoch=authority.current.epoch,id=++readingId.current;
    fresh.current=false;p.onAttempted(p.requestId);busy.current=true;setPhase('saving');setMessage('');
    try{
      const result=await saveTemplateVersion(reviewed);
      if(!current(epoch,id))return;
      if(result.ok===true){adopt(emptyForm());exit.exitAfterSave(()=>callbacks.current.onOpenVersion(result.value.id));}
      else if(result.refusal==='authority')retire();
      else{setPhase(result.reason==='unconfirmed'?'unconfirmed':result.reason==='conflict'?'conflict':'blocked');setMessage(result.reason==='conflict'?'The original source changed. Your proposal has not been applied by this response. Inspect that source before preparing another version.':result.message);}
    }finally{if(authority.current.epoch===epoch)busy.current=false;}
  };
  const more=async()=>{
    if(!allowed||!p.tenantId||!cursor||reading)return;
    const epoch=authority.current.epoch,id=++readingId.current;setReading(true);setMessage('');
    const result=await listAgreementTemplates(p.tenantId,cursor,!archived);
    if(!current(epoch,id))return;
    setReading(false);
    if(result.ok===true){setItems(existing=>[...existing,...result.value.items.filter(item=>!existing.some(row=>row.id===item.id))]);setCursor(result.value.next_cursor);}
    else if(result.refusal==='authority')retire();else setMessage('Older versions could not be read. The returned versions remain available; retry the read.');
  };
  const top=(label:string)=><div className="e04-preparation-top"><div><button className="e04-preparation-back" onClick={exit.close}><ArrowLeft size={16}/>Agreements and terms</button><h2 ref={heading} tabIndex={-1}>{label}</h2></div>{phase==='list'&&<button className="e04-preparation-primary" onClick={()=>exit.request(()=>p.onNewVersion(null))}><Plus size={16}/>New template</button>}</div>;
  if(!allowed)return <section className="e04-preparation">{top(retired?'Template access changed':'Template access required')}<p role="status">{p.authorityUnknown||!p.authorizationReady||!p.scopeReady?'Checking the current business and author permissions…':'Return to the original business with an authorized agreement author role.'}</p>{exit.confirmation}</section>;
  const locked=phase!=='editing',visibleItems=items.filter(row=>row.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const recordCanUse=record&&record.preparation_purpose==='client_engagement'&&record.is_active&&textSource(record);
  return <section className={`e04-preparation e04-templates ${preview?'e04-template-preview-open':''}`} aria-label="Business template workspace">
    {top(phase==='list'?'Business templates':record?'Retained template version':phase==='loading'?'Reading business templates…':source?'Prepare a new template version':'Create a business template')}
    {message&&<p className="e04-preparation-message e04-template-feedback" role={phase==='editing'||phase==='error'||phase==='blocked'||phase==='conflict'?'alert':'status'}>{message}</p>}
    {phase==='loading'?<p role="status"><Loader2 size={16} className="e04-preparation-spinner"/>Reading the original business record…</p>:phase==='error'?<div className="e04-preparation-message"><p>The requested template could not be verified.</p><button onClick={()=>{loaded.current=false;retryRead();}}><RefreshCw size={16}/>Retry original read</button></div>:phase==='list'?<>
      <div className="e04-template-controls"><label><Search size={16}/><span className="sr-only">Filter loaded template titles</span><input type="search" value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Filter returned templates"/></label><label className="e04-template-checkbox"><input type="checkbox" checked={archived} onChange={event=>{setItems([]);setCursor(null);setArchived(event.target.checked);}}/>Include earlier retained versions</label></div>
      {!visibleItems.length?<div className="e04-preparation-message"><FileText size={28}/><h3>{filter?'No returned templates match':'Build your reusable wording library'}</h3><p>{filter?'Clear the filter or read more returned versions.':'Start with wording supplied by your business. Jurisdiction and requested review can be configured when relevant.'}</p>{filter?<button onClick={()=>setFilter('')}>Clear filter</button>:<button className="e04-preparation-primary" onClick={()=>p.onNewVersion(null)}>Create a template</button>}</div>:<div className="e04-template-rows">{visibleItems.map(row=><button key={row.id} className="e04-template-row" onClick={()=>p.onOpenVersion(row.id)}><FileText size={24}/><span><strong>{row.title}</strong><small>Version {row.version} · {row.is_active?'Active wording':'Earlier retained wording'}{row.preparation_purpose===null?' · legacy source':''}</small></span><ArrowRight size={16}/></button>)}</div>}
      <div className="e04-template-list-foot"><p>{items.length} returned version{items.length===1?'':'s'} · titles filter only these records.</p>{cursor&&<button onClick={()=>{void more();}} disabled={reading}>{reading?'Reading more…':'Read more versions'}</button>}</div>
    </>:phase==='record'&&record?<div className="e04-preparation-layout"><article className="e04-preparation-paper" aria-label="Retained template wording"><div className="e04-preparation-paper-mark"><FileText size={16}/><span>Version {record.version} · {record.is_active?'Active':'Earlier retained'}</span></div><h3>{record.title}</h3>{record.body_markdown===null?<p>This source has no retained text body. Use its original document preparation path.</p>:<ReactMarkdown components={{img:({alt})=><span>[Document image: {alt||'embedded image'}]</span>,a:({children})=><span>{children}</span>}}>{record.body_markdown}</ReactMarkdown>}</article><aside className="e04-preparation-context"><div className="e04-preparation-context-card"><h3>Original version</h3><dl><dt>Retained</dt><dd>{at(record.created_at)}</dd><dt>Jurisdiction</dt><dd>{record.preparation_options?.jurisdiction||'Not specified'}</dd><dt>Requested wording review</dt><dd>{reviewLabel(record.preparation_options?.review_route)}</dd>{record.preparation_options?.reviewer&&<><dt>Reviewer</dt><dd>{record.preparation_options.reviewer}</dd></>}</dl><p>No completed wording review is recorded by these options.</p>{recordCanUse&&<button className="e04-preparation-primary" onClick={()=>p.onUseVersion(record.id)}>Use this version<ArrowRight size={16}/></button>}{textSource(record)&&<button onClick={()=>p.onNewVersion(record.id)}>{record.preparation_purpose===null?'Prepare a client template version':'Prepare a new version'}</button>}{!recordCanUse&&<p>{record.has_uploaded_source?'Uploaded sources retain their original document workflow.':record.preparation_purpose===null?'Inspect this legacy source and prepare a client-engagement version before using it.':'Earlier retained wording remains readable. Prepare a new active version before using it.'}</p>}<button onClick={()=>p.onOpenVersion("list")}>Business templates</button>{record.source_template_version_id&&<button onClick={()=>p.onOpenVersion(record.source_template_version_id!)}>Inspect earlier source version</button>}<button onClick={p.onClose}>Return to agreements</button></div></aside></div>:<>
      {loaded.current&&command.current===null&&phase==='unconfirmed'?<div className="e04-preparation-message"><h3>Original request unconfirmed</h3><p>No private wording is restored from browser storage.</p><button onClick={()=>{void recover();}} disabled={reading}>{reading?'Checking original request…':'Check original template request'}</button></div>:<>
        <button className="e04-template-preview-toggle" aria-pressed={preview} onClick={()=>setPreview(!preview)}>{preview?'Return to template editing':'Preview template wording'}</button>
        <form className="e04-preparation-layout" onSubmit={event=>{void save(event);}} aria-label="Template version editor">
          <div className="e04-preparation-document"><label className="e04-template-label">Template title<input ref={title} value={form.title} readOnly={locked} maxLength={500} onChange={event=>setForm({...form,title:event.target.value})}/></label>{preview?<article className="e04-preparation-paper" aria-label="Proposed template wording"><h3>{form.title||'Untitled template'}</h3><ReactMarkdown components={{img:({alt})=><span>[Document image: {alt||'embedded image'}]</span>,a:({children})=><span>{children}</span>}}>{form.body||'Add your business wording to prepare this template.'}</ReactMarkdown></article>:<div ref={wording}><AgreementBodyEditor scopeKey={`${p.tenantId}:${p.actor}:${p.requestId}:template`} value={form.body} readOnly={locked} onChange={body=>setForm(value=>({...value,body}))}/></div>}</div>
          <aside className="e04-preparation-context"><div className="e04-preparation-context-card"><h3>{source?'Retain a new version':'Reusable supplied wording'}</h3><p>{source?`Original version ${source.version} stays available. This does not revise existing client agreements.`:'Supply your business wording. Saving this template does not send an agreement or request a signature.'}</p>
            <details className="e04-template-options"><summary>Jurisdiction &amp; wording review</summary><label className="e04-template-label">Jurisdiction<input value={form.options.jurisdiction??''} readOnly={locked} maxLength={200} onChange={event=>setForm({...form,options:{...form.options,jurisdiction:event.target.value.trim()?event.target.value:null}})}/></label><label className="e04-template-label">Requested wording review<select value={form.options.review_route} disabled={locked} onChange={event=>setForm({...form,options:{...form.options,review_route:event.target.value as TemplatePreparationOptions['review_route'],reviewer:event.target.value==='unspecified'?null:form.options.reviewer}})}><option value="unspecified">Not specified</option><option value="business">Business review</option><option value="qualified_legal">Qualified legal review</option></select></label>{form.options.review_route!=='unspecified'&&<label className="e04-template-label">Reviewer or review team<input value={form.options.reviewer??''} readOnly={locked} maxLength={200} onChange={event=>setForm({...form,options:{...form.options,reviewer:event.target.value.trim()?event.target.value:null}})}/></label>}<p>Optional routing for this wording. It does not record completed review.</p></details>
            {phase==='editing'?<button type="submit" className="e04-preparation-primary">Save template version</button>:phase==='saving'?<p role="status">Confirming the original template save…</p>:<><h3>{phase==='unconfirmed'?'Template result unconfirmed':phase==='conflict'?'Source version changed':'Template save unavailable'}</h3><p>Your reviewed proposal is locked here. Inspect original records before deciding what to do next.</p><button type="button" onClick={()=>{void recover();}} disabled={reading}>{reading?'Checking original request…':'Check original template request'}</button>{phase==='unconfirmed'&&command.current&&<button type="submit" className="e04-preparation-primary" disabled={reading}>Retry same reviewed request</button>}{source&&<button type="button" onClick={()=>exit.request(()=>p.onOpenVersion(source.id))}>Inspect original source version</button>}{foundOriginalId&&<button type="button" onClick={()=>exit.request(()=>p.onOpenVersion(foundOriginalId))}>Inspect recovered version</button>}</>}
            <button type="button" onClick={exit.close} disabled={phase==='saving'}>Return to agreements</button>
          </div></aside>
        </form>
      </>}
    </>}
    {exit.confirmation}
  </section>;
}
