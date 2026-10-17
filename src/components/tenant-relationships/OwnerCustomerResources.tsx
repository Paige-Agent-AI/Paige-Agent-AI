import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft,BookOpen,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {useTenantContext} from '@/hooks/useTenantContext';
import {useKnowledgeDocuments} from '@/hooks/useKnowledgeDocuments';
import {useOwnerResourceShares} from '@/hooks/useOwnerResourceShares';
import {useBeforeUnloadGuard} from '@/hooks/useBeforeUnloadGuard';
import {useClientAccountExit} from '@/components/client/useClientAccountExit';
import type {RelationshipPerson} from './useTenantRelationshipsData';

export function OwnerCustomerResources({tenantId,person,onBack,onPendingChange}:{tenantId:string;person:RelationshipPerson;onBack:()=>void;onPendingChange?:(blocked:boolean)=>void}){
 const context=useTenantContext();
 const allowed=!context.accountContextLoading&&context.accountContextStatus==='ready'&&context.activeTenantId===tenantId&&!!context.activeUserId;
 const scope=allowed?{actor:context.activeUserId!,tenant:tenantId,contact:person.id}:null;
 const model=useOwnerResourceShares(scope),knowledge=useKnowledgeDocuments(allowed?tenantId:null);
 const [search,setSearch]=useState('');const heading=useRef<HTMLHeadingElement>(null),state=useRef<HTMLDivElement>(null);
 const entries=useRef(new Map<string,HTMLButtonElement>()),focus=useRef<string|null>(null),origin=useRef<string|null>(null);
 const busy=model.outcome==='saving',reviewing=['review','preparing','saving','unknown'].includes(model.outcome);
 const exitBlocked=busy||model.outcome==='unknown';
 useBeforeUnloadGuard(exitBlocked);
 useClientAccountExit(exitBlocked,exitBlocked);
 useLayoutEffect(()=>{onPendingChange?.(exitBlocked);return()=>onPendingChange?.(false);},[exitBlocked,onPendingChange]);
 useEffect(()=>{
  if(!focus.current||model.phase==='loading'||model.outcome==='preparing'||busy)return;
  const target=focus.current;focus.current=null;
  if(model.phase!=='ready'||['unknown','conflict','refused','saved'].includes(model.outcome))state.current?.focus();
  else if(target==='review')heading.current?.focus();else (entries.current.get(target)??heading.current)?.focus();
 },[model.phase,model.outcome,busy]);
 const review=(id:string,available:boolean,key:string)=>{origin.current=key;focus.current='review';void model.review(id,available);};
 const cancel=()=>{focus.current=origin.current??'list';model.cancel();};
 const proposal=model.proposal,docs=knowledge.docs.filter(doc=>doc.title.toLowerCase().includes(search.trim().toLowerCase()));
 return <section aria-labelledby="owner-customer-resources-title" className="min-w-0 space-y-6 [&_button]:min-h-[44px]">
  <Button variant="ghost" disabled={exitBlocked} onClick={onBack}><ArrowLeft aria-hidden className="mr-2 h-4 w-4"/>Back to client access</Button>
  <header><h2 id="owner-customer-resources-title" ref={heading} tabIndex={-1} className="break-words text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
   {model.outcome==='review'?(proposal?.available?'Review resource sharing':'Withdraw resource access'):'Customer resources'}</h2><p className="mt-2 break-words text-sm text-muted-foreground">{person.name}</p></header>
  {model.phase==='loading'?<div role="status" aria-label="Loading customer resources" className="space-y-4"><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></div>
   :model.phase!=='ready'?<div ref={state} tabIndex={-1} role="alert" className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="max-w-prose text-sm leading-6">{model.notice}</p>{model.phase!=='unavailable'&&<Button variant="outline" onClick={()=>void model.load()}>Check resource access</Button>}</div>
   :<>
    {model.notice&&<div ref={state} tabIndex={-1} role={['unknown','conflict','refused'].includes(model.outcome)?'alert':'status'} className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="max-w-prose text-sm leading-6">{model.notice}</p>
     {model.outcome==='unknown'?<Button variant="outline" onClick={()=>{focus.current='status';void model.recover();}}>Check saved status</Button>
      :!busy&&<Button variant="outline" onClick={()=>{focus.current=origin.current??'list';void model.load();}}>Reload resources</Button>}
    </div>}
    {model.outcome==='preparing'?<p role="status" className="text-sm">Checking the saved version and this customer’s access…</p>
     :busy?<p role="status" className="text-sm">{model.notice||'Saving the resource setting…'}</p>
     :model.outcome==='review'&&proposal?<div className="space-y-5">
      <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2"><div className="min-w-0"><dt className="text-muted-foreground">Customer</dt><dd className="mt-1 break-words font-medium">{person.name}</dd></div>
       <div className="min-w-0"><dt className="text-muted-foreground">Resource</dt><dd className="mt-1 break-words font-medium">{proposal.title??model.rows.find(row=>row.document_id===proposal.document_id)?.title??'Saved resource'}{proposal.document_revision!==null?` · Version ${proposal.document_revision}`:''}</dd></div></dl>
      {proposal.available?<>
       <div className="space-y-3 border-y border-border py-5"><h3 className="text-sm font-semibold">Saved text preview</h3><p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{proposal.preview}</p>
        {proposal.preview_truncated&&<p className="text-sm text-muted-foreground">Preview only. Sharing makes the complete saved text available.</p>}</div>
       <p className="max-w-prose text-sm leading-6">Only this saved version becomes available in this customer’s Resources and to their AI assistant. Internal Knowledge stays private. A later source change requires a new review.</p>
       {proposal.already_shared&&<p role="status" className="text-sm">This saved version is already shared with this customer.</p>}
      </>:<p className="max-w-prose text-sm leading-6">This customer and their assistant will lose future access to this resource. The original document and their private conversation are retained.</p>}
      <div className="flex flex-wrap gap-3"><Button disabled={proposal.already_shared} onClick={()=>{focus.current='status';void model.confirm();}}>{proposal.available?'Share with customer':'Confirm withdrawal'}</Button><Button variant="outline" onClick={cancel}>Cancel</Button></div>
     </div>:null}
    {(!reviewing||model.outcome==='unknown')&&<section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-semibold">Recorded sharing</h3><Button variant="ghost" disabled={model.outcome==='unknown'} onClick={()=>void model.load()}>Refresh sharing</Button></div>
      {!model.rows.length?<p className="py-3 text-sm text-muted-foreground">No resource sharing is recorded for this customer. Review a saved Knowledge document below.</p>
       :<ul className="divide-y divide-border border-y border-border">{model.rows.map(row=><li key={row.share_id} className="flex min-w-0 flex-wrap items-center gap-4 py-4">
        <BookOpen aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1 basis-44"><h4 className="break-words text-sm font-medium">{row.title}</h4><p className="mt-1 text-sm text-muted-foreground">Version {row.document_revision} · {row.currently_available?'Shared':row.revoked_at?'Withdrawn':'Review needed'}</p>
         <details className="mt-2 text-xs"><summary className="min-h-[44px] cursor-pointer py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Sharing details</summary><dl className="space-y-1 break-words [overflow-wrap:anywhere]"><dt className="text-muted-foreground">{row.revoked_at?'Withdrawn':'Shared'}</dt><dd>{new Date(row.revoked_at??row.granted_at).toLocaleString()}</dd><dt className="text-muted-foreground">Receipt</dt><dd>{row.receipt_id}</dd></dl></details></div>
        <Button ref={node=>{if(node)entries.current.set(row.share_id,node);else entries.current.delete(row.share_id);}} variant="outline" disabled={model.outcome==='unknown'} onClick={()=>review(row.document_id,true,row.share_id)}>Review sharing</Button>
        {!row.revoked_at&&<Button ref={node=>{if(node)entries.current.set(row.share_id+'-withdraw',node);else entries.current.delete(row.share_id+'-withdraw');}} variant="ghost" disabled={model.outcome==='unknown'} onClick={()=>review(row.document_id,false,row.share_id+'-withdraw')}>Withdraw access</Button>}
       </li>)}</ul>}
      {model.hasMore&&<Button variant="outline" disabled={model.outcome==='unknown'} onClick={()=>void model.loadMore()}>Load more sharing records</Button>}
      {!!model.rows.length&&<p className="text-sm text-muted-foreground">Opened/read activity is not recorded here yet.</p>}
     </section>}
     {!reviewing&&<section className="space-y-4"><h3 className="text-base font-semibold">Saved Knowledge</h3><p className="max-w-prose text-sm leading-6 text-muted-foreground">Choose material for this customer. Documents remain in your existing Knowledge; this creates no copy.</p>
      <label className="block text-sm font-medium" htmlFor="owner-resource-search">Search loaded resources</label><div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-foreground"/><Input id="owner-resource-search" type="search" value={search} onChange={event=>setSearch(event.target.value)} className="min-h-[44px] min-w-0 pl-10 text-base md:text-sm" placeholder="Saved document title"/></div>
      {knowledge.loading?<div role="status" aria-label="Loading saved Knowledge"><Skeleton className="h-16 w-full"/></div>
       :knowledge.error?<div role="alert" className="space-y-3"><p className="text-sm">Saved Knowledge could not be loaded. Check your workspace and connection.</p><Button variant="outline" onClick={()=>void knowledge.reload()}>Retry Knowledge</Button></div>
       :!docs.length?<p role="status" className="py-3 text-sm text-muted-foreground">{search?'No loaded resource titles match. Try another search or load more documents.':'Add and publish a document in Knowledge, then return to share its saved version.'}</p>
       :<ul className="divide-y divide-border border-y border-border">{docs.map(doc=><li key={doc.id} className="flex min-w-0 flex-wrap items-center gap-4 py-4"><div className="min-w-0 flex-1 basis-44"><h4 className="break-words text-sm font-medium">{doc.title}</h4><p className="mt-1 text-sm text-muted-foreground">Saved version {doc.revision}</p></div>
        <Button ref={node=>{if(node)entries.current.set(doc.id,node);else entries.current.delete(doc.id);}} variant="outline" aria-label={`Review sharing ${doc.title}`} onClick={()=>review(doc.id,true,doc.id)}>Review sharing</Button></li>)}</ul>}
      {knowledge.hasMore&&<Button variant="outline" disabled={knowledge.loading} onClick={()=>void knowledge.loadMore()}>Load more Knowledge</Button>}
     </section>}
   </>}
 </section>;
}
