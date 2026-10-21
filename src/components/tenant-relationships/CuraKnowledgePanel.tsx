import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Plus,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Skeleton} from '@/components/ui/skeleton';
import {useTenantContext} from '@/hooks/useTenantContext';
import {useBeforeUnloadGuard} from '@/hooks/useBeforeUnloadGuard';
import {useClientAccountExit} from '@/components/client/useClientAccountExit';
import {useCuraKnowledge} from '@/hooks/useCuraKnowledge';
import {AddKnowledgeFlow} from '@/solo/knowledge/AddKnowledgeFlow';
import {CURA_KNOWLEDGE_KINDS,type CuraKnowledgeKind,type CuraKnowledgeSource,type CuraShareTerms} from '@/lib/cura-knowledge';
import type {CuraKnowledgeReference} from '@/lib/cura-knowledge-reference';

const quietButton='text-[var(--pg-ink)] hover:bg-[var(--pg-raised)] hover:text-[var(--pg-ink)]';
const kindLabels:Record<CuraKnowledgeKind,string>={information:'Program or service information',offer:'Offer or price',promotion:'Promotion',faq:'FAQ and approved answer',campaign_explainer:'Campaign information',policy:'Policy or terms'};
const stateLabels={not_shared:'Private Knowledge',withdrawn:'Withdrawn',not_entitled:'Not eligible',source_changed:'Source changed — review needed',scheduled:'Scheduled',expired:'Expired',shared:'Shared with customers'};
const sourceLabels={draft:'Review the source first',empty:'No published text',not_entitled:'Not eligible',needs_publication:'Publication needed',prepared:'Ready for sharing review'};
function displayDate(value:string|null){return value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':'No limit';}
// Keep an existing native timestamp byte-for-byte until its field is deliberately edited.
function fieldDate(value:string|null){return value?new Date(value).toISOString().slice(0,16):'';}
type Props={tenantId:string;onBack:()=>void;onPendingChange?:(blocked:boolean)=>void;reference?:CuraKnowledgeReference|null};

export function CuraKnowledgePanel(props:Props){
 const context=useTenantContext();
 if(context.accountContextLoading||context.accountContextStatus!=='ready'||context.activeTenantId!==props.tenantId||!context.activeUserId)
  return <section className="space-y-4"><p role="status">Reopen CURA Knowledge in your current business.</p><Button variant="outline" className={quietButton} onClick={props.onBack}>Back to experience</Button></section>;
 if(props.reference?.invalid)return <section className="space-y-4"><h2>Teach CURA</h2><p role="alert">The linked source address could not be read. Return to Experience and open Knowledge again.</p><Button variant="outline" className={quietButton} onClick={props.onBack}>Back to experience</Button></section>;
 return <CuraKnowledgeSession key={`${props.tenantId}:${context.activeUserId}`} {...props} actor={context.activeUserId}/>;
}

function CuraKnowledgeSession({tenantId,actor,onBack,onPendingChange,reference}:Props&{actor:string}){
 const model=useCuraKnowledge({tenant:tenantId,actor},reference?.documentId??null),id=useId();
 const [query,setQuery]=useState(''),[selected,setSelected]=useState<CuraKnowledgeSource|null>(null),[adding,setAdding]=useState(false);
 const [terms,setTerms]=useState<CuraShareTerms>({kind:'information',validFrom:null,validUntil:null});
 const [publicationNotice,setPublicationNotice]=useState('');
 const title=useRef<HTMLHeadingElement>(null),status=useRef<HTMLDivElement>(null),addTrigger=useRef<HTMLButtonElement>(null);
 const entries=useRef(new Map<string,HTMLButtonElement>()),restore=useRef<string|null>(null),focus=useRef<'review'|'status'|string|null>(null);
 const correctionEntries=useRef(new Map<string,HTMLButtonElement>()),publicationSource=useRef<string|null>(null);
 const publicationTarget=useCallback(()=>[publicationSource.current?correctionEntries.current.get(publicationSource.current):addTrigger.current,addTrigger.current,title.current]
  .find(node=>node?.isConnected&&!node.matches(':disabled')&&!node.closest('[hidden], [inert]'))??null,[]);
 const busy=model.outcome==='saving',unknown=model.outcome==='unknown',preparing=model.outcome==='preparing';
 const correction=model.outcome==='correction'?model.correction:undefined;
 const dialogOpen=adding||!!correction,exitBlocked=busy||unknown||dialogOpen;
 useBeforeUnloadGuard(exitBlocked);useClientAccountExit(exitBlocked,exitBlocked);
 useLayoutEffect(()=>{onPendingChange?.(exitBlocked);return()=>onPendingChange?.(false);},[exitBlocked,onPendingChange]);
 useEffect(()=>{
  if(!focus.current||model.phase==='loading'||preparing||busy||dialogOpen)return;
  const target=focus.current;focus.current=null;
  if(target==='status'||['unknown','saved','refused','conflict'].includes(model.outcome)||model.phase!=='ready')status.current?.focus();
  else if(target==='publication')publicationTarget()?.focus();else if(target==='review')title.current?.focus();else (entries.current.get(target)??title.current)?.focus();
 },[model.phase,model.outcome,preparing,busy,dialogOpen,selected?.document_id,publicationTarget]);
 const choose=(row:CuraKnowledgeSource)=>{setSelected(row);setTerms({kind:row.share?.customer_kind??'information',validFrom:row.share?.valid_from??null,validUntil:row.share?.valid_until??null});restore.current=row.document_id;focus.current='review';title.current?.focus();model.cancel();};
 const cancel=()=>{focus.current=restore.current;setSelected(null);model.cancel();};
 const review=()=>{if(!selected)return;focus.current='review';void model.review(selected.document_id,true,terms);};
 const withdraw=(row:CuraKnowledgeSource)=>{setSelected(null);restore.current=row.document_id;focus.current='review';void model.review(row.document_id,false,{kind:row.share!.customer_kind,validFrom:row.share!.valid_from,validUntil:row.share!.valid_until});};
 const closeDialog=()=>{setAdding(false);focus.current='publication';model.cancel();};
 const reviewing=model.outcome==='review'&&!!model.proposal,showForm=selected&&!reviewing&&!preparing&&!busy&&!unknown&&!['saved','conflict','refused'].includes(model.outcome);
 const p=model.proposal;
 return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-6 [&_button]:min-h-[44px]">
  <Button variant="ghost" className={quietButton} disabled={exitBlocked} onClick={onBack}><ArrowLeft aria-hidden className="mr-2 h-4 w-4"/>Back to experience</Button>
  <header><h2 id={`${id}-title`} ref={title} tabIndex={-1} className="break-words outline-none focus-visible:ring-2 focus-visible:ring-ring">{reviewing?(p!.available?'Review customer sharing':'Withdraw business-wide sharing'):showForm?'Choose how CURA uses this source':'Teach CURA'}</h2>
   <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">Approved answers for your customers. Your other business Knowledge stays private.</p></header>
  {model.phase==='loading'?<div role="status" aria-label="Loading CURA Knowledge"><Skeleton className="h-16 w-full"/><Skeleton className="mt-4 h-16 w-full"/></div>
   :model.phase!=='ready'?<div ref={status} tabIndex={-1} role="alert" className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="text-sm leading-6">{model.notice}</p>{model.phase!=='unavailable'&&<Button variant="outline" className={quietButton} onClick={()=>void model.load()}>Reload Knowledge</Button>}</div>
   :<>
    {(model.notice||publicationNotice)&&<div ref={status} tabIndex={-1} role={unknown||['refused','conflict'].includes(model.outcome)?'alert':'status'} className="space-y-3 border-y border-border py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <p className="max-w-prose text-sm leading-6">{model.notice||publicationNotice}</p>
      {unknown?<><div className="flex flex-wrap gap-3"><Button variant="outline" className={quietButton} onClick={()=>{focus.current='status';void model.recover();}}>Check saved status</Button><Button variant="ghost" className={quietButton} onClick={()=>{model.leave();onBack();}}>Leave this check</Button></div><p className="text-sm text-muted-foreground">Leaving sends no retry. Review recorded sharing when you return.</p></>
       :!busy&&model.notice&&<Button variant="outline" className={quietButton} onClick={()=>{setSelected(null);focus.current='status';void model.load();}}>Reload Knowledge</Button>}
    </div>}
    {preparing?<p role="status" className="text-sm">Checking the saved source and publishing permission…</p>
     :busy?<p role="status" className="text-sm">{model.notice||'Saving this sharing decision…'}</p>
     :reviewing&&p?<div className="space-y-5">
      <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Audience</dt><dd className="mt-1 font-medium">Authorized customers of this business</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Source</dt><dd className="mt-1 break-words font-medium">{p.title??model.rows.find(row=>row.document_id===p.document_id)?.title??'Saved source'} · Version {p.document_revision}</dd></div>
       <div><dt className="text-muted-foreground">Use</dt><dd className="mt-1">{kindLabels[p.customer_kind!]}</dd></div><div><dt className="text-muted-foreground">Available</dt><dd className="mt-1">{p.valid_from?displayDate(p.valid_from):'From confirmation'} → {p.valid_until?displayDate(p.valid_until):'Until withdrawn'}</dd></div></dl>
      {p.available?<><div className="space-y-3 border-y border-border py-5"><h3 className="text-sm font-semibold">Approved source preview</h3><p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{p.preview}</p>{p.preview_truncated&&<p className="text-sm text-muted-foreground">Preview only. CURA may use the complete approved source.</p>}</div>
       <p className="max-w-prose text-sm leading-6">This shares the saved version with authorized customers in their Resources and CURA answers. A source correction requires another sharing review. An expiry or withdrawal ends future use through this share.</p>
       {p.already_shared&&<p role="status" className="text-sm">This source and these terms are already shared.</p>}</>
       :<p className="max-w-prose text-sm leading-6">CURA and customer Resources lose future access through this business-wide share. The source and private history are retained. Existing customer-specific shares are managed under that customer’s Resources.</p>}
      <div className="flex flex-wrap gap-3"><Button disabled={p.already_shared} onClick={()=>{focus.current='status';void model.confirm();}}>{p.available?'Approve sharing':'Confirm withdrawal'}</Button><Button variant="outline" className={quietButton} onClick={cancel}>Cancel</Button></div>
     </div>:showForm?<form className="max-w-2xl space-y-5" onSubmit={event=>{event.preventDefault();review();}}>
      <p className="break-words text-sm font-medium">{selected!.title} · Version {selected!.document_revision}</p>
      <div className="space-y-2"><Label htmlFor={`${id}-kind`}>What is this source?</Label><select id={`${id}-kind`} className="min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring md:text-sm" value={terms.kind} onChange={event=>setTerms({...terms,kind:event.target.value as CuraKnowledgeKind})}>{CURA_KNOWLEDGE_KINDS.map(kind=><option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></div>
      <fieldset className="space-y-3"><legend className="text-sm font-medium">Availability window · UTC</legend><p className="text-sm leading-6 text-muted-foreground">Leave dates blank for immediate, ongoing use. Expired material is excluded from future CURA answers.</p>
       <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${id}-from`}>Start (optional)</Label><Input id={`${id}-from`} type="datetime-local" value={fieldDate(terms.validFrom)} onChange={event=>setTerms({...terms,validFrom:event.target.value?event.target.value+':00Z':null})} className="min-h-[44px] min-w-0 text-base md:text-sm"/></div>
       <div className="space-y-2"><Label htmlFor={`${id}-until`}>End (optional)</Label><Input id={`${id}-until`} type="datetime-local" value={fieldDate(terms.validUntil)} min={fieldDate(terms.validFrom)||undefined} onChange={event=>setTerms({...terms,validUntil:event.target.value?event.target.value+':00Z':null})} className="min-h-[44px] min-w-0 text-base md:text-sm"/></div></div></fieldset>
      <div className="flex flex-wrap gap-3"><Button type="submit">Review sharing <ArrowRight aria-hidden className="ml-2 h-4 w-4"/></Button><Button type="button" variant="outline" className={quietButton} onClick={cancel}>Cancel</Button></div>
     </form>:null}
    {!reviewing&&!showForm&&!preparing&&!busy&&<section className="space-y-4">
     <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-semibold">Business Knowledge</h3><Button ref={addTrigger} disabled={unknown} onClick={()=>{publicationSource.current=null;setPublicationNotice('');setAdding(true);}}><Plus aria-hidden className="mr-2 h-4 w-4"/>Add a source</Button></div>
     {model.focusedId&&<div className="flex flex-wrap items-center gap-3"><p role="status" className="text-sm">{model.rows.length?'Showing the linked source.':'The linked source is not available in this business.'}</p><Button variant="outline" className={quietButton} disabled={unknown} onClick={()=>{setQuery('');void model.search('');}}>Show all sources</Button></div>}
     <form className="space-y-2" onSubmit={event=>{event.preventDefault();setSelected(null);void model.search(query.trim());}}><Label htmlFor={`${id}-search`}>Find a source</Label><div className="flex min-w-0 flex-wrap gap-2"><div className="relative min-w-0 flex-1 basis-48"><Search aria-hidden className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-foreground"/><Input id={`${id}-search`} type="search" maxLength={200} value={query} disabled={unknown} onChange={event=>setQuery(event.target.value)} className="min-h-[44px] min-w-0 pl-10 text-base md:text-sm" placeholder="Title or topic"/></div><Button type="submit" variant="outline" className={quietButton} disabled={unknown}>Search</Button><Button type="button" variant="ghost" className={quietButton} disabled={unknown} onClick={()=>void model.load()}>Refresh</Button></div></form>
     {!model.rows.length?<div className="space-y-2 border-y border-border py-6"><p className="text-sm font-medium">{model.focusedId?'No source has been substituted.':model.query?'No sources match this search.':'Start with an answer your customers need.'}</p><p className="max-w-prose text-sm leading-6 text-muted-foreground">{model.focusedId?'Check the original source or return to all sources.':model.query?'Try another title or topic.':'Add an FAQ, service guide or current offer. Review and publish it privately first, then choose what CURA may share.'}</p></div>
      :<ul className="divide-y divide-border border-y border-border">{model.rows.map(row=><li key={row.document_id} className="flex min-w-0 flex-wrap items-start gap-4 py-5"><BookOpen aria-hidden className="mt-1 h-5 w-5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1 basis-44"><h4 className="break-words text-sm font-semibold">{row.title}</h4><p className="mt-1 text-sm text-muted-foreground">Version {row.document_revision} · {stateLabels[row.share_state]}</p><p className="mt-1 text-sm text-muted-foreground">{row.source_state!=='prepared'?sourceLabels[row.source_state]:row.share?kindLabels[row.share.customer_kind]:sourceLabels.prepared}</p>
       {row.share&&<details className="mt-1 text-xs"><summary className="min-h-[44px] cursor-pointer py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Sharing details</summary><dl className="space-y-1 break-words [overflow-wrap:anywhere]"><dt className="text-muted-foreground">Start</dt><dd>{row.share.valid_from?displayDate(row.share.valid_from):'From confirmation'}</dd><dt className="text-muted-foreground">End</dt><dd>{row.share.valid_until?displayDate(row.share.valid_until):'Until withdrawn'}</dd><dt className="text-muted-foreground">Last recorded decision</dt><dd>{displayDate(row.share.revoked_at??row.share.granted_at)}</dd><dt className="text-muted-foreground">Receipt</dt><dd>{row.share.receipt_id}</dd></dl></details>}</div>
       <div className="flex flex-wrap gap-2"><Button ref={node=>{if(node)entries.current.set(row.document_id,node);else entries.current.delete(row.document_id);}} variant="outline" className={quietButton} disabled={unknown||row.source_state!=='prepared'} aria-label={`Review sharing ${row.title}`} onClick={()=>choose(row)}>Review sharing</Button><Button ref={node=>{if(node)correctionEntries.current.set(row.document_id,node);else correctionEntries.current.delete(row.document_id);}} variant="ghost" className={quietButton} disabled={unknown||row.source_state==='not_entitled'} aria-label={`Review or correct ${row.title}`} onClick={()=>{publicationSource.current=row.document_id;restore.current=row.document_id;focus.current='review';void model.correct(row.document_id);}}>Review or correct</Button>{row.share&&!row.share.revoked_at&&<Button variant="ghost" className={quietButton} disabled={unknown} aria-label={`Withdraw ${row.title}`} onClick={()=>withdraw(row)}>Withdraw</Button>}</div>
      </li>)}</ul>}
     {model.hasMore&&<Button variant="outline" className={quietButton} disabled={unknown} onClick={()=>void model.loadMore()}>Load more sources</Button>}
     <p className="max-w-prose text-sm leading-6 text-muted-foreground">Sharing status describes permission and source currency. It does not mean a customer opened, read or acted on the material.</p>
    </section>}
   </>}
  <Dialog open={dialogOpen} onOpenChange={open=>{if(!open)closeDialog();}}>
   {dialogOpen&&<AddKnowledgeFlow tenantId={tenantId} replacementTarget={correction??undefined} onPublished={()=>{setSelected(null);setPublicationNotice('Published to your private Knowledge. Review sharing below before CURA uses it with customers.');void model.load();}} onClose={closeDialog} returnFocus={publicationTarget}/>}
  </Dialog>
 </section>;
}
