import {useEffect,useRef} from 'react';
import {Link,useOutletContext} from 'react-router-dom';
import {ArrowLeft,BookOpen} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {LearningVault} from '@/components/dashboard/LearningVault';
import {useClientPortalFrame} from '@/hooks/useClientPortalFrame';
import {useCustomerResources} from '@/hooks/useCustomerResources';
import {readableTextOn} from '@/lib/brand/contrast';
import type {ClientPortalFrame} from '@/lib/client-portal-frame';

export function CustomerResourcesView({frame}:{frame:ClientPortalFrame}){
 const model=useCustomerResources(frame),heading=useRef<HTMLHeadingElement>(null),notice=useRef<HTMLDivElement>(null);
 const entries=useRef(new Map<string,HTMLButtonElement>()),focus=useRef<{kind:'reader'|'list';id:string}|null>(null);
 useEffect(()=>{
  if(!focus.current||model.phase==='loading')return;
  const target=focus.current;focus.current=null;
  if(model.phase!=='ready'){notice.current?.focus();return;}
  if(target.kind==='list') (entries.current.get(target.id)??heading.current)?.focus();else heading.current?.focus();
 },[model.phase,model.reader]);
 const reader=model.phase==='ready'?model.reader:null,accent=frame.brand.primary_color;
 const style=accent&&/^#[a-f\d]{6}$/i.test(accent)?{backgroundColor:accent,color:readableTextOn(accent)}:undefined;
 return <section aria-labelledby="customer-resources-heading" aria-busy={model.phase==='loading'} className="mx-auto w-full min-w-0 max-w-4xl space-y-7 [&_button]:min-h-[44px]">
  {reader&&<Button variant="ghost" onClick={()=>{focus.current={kind:'list',id:reader.resource.share_id};void model.reload();}}><ArrowLeft aria-hidden className="mr-2 h-4 w-4"/>Back to resources</Button>}
  <header className="min-w-0"><h1 ref={heading} id="customer-resources-heading" tabIndex={-1} className="break-words text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
   {reader?reader.page.document.title:'Resources'}</h1>
   <p className="mt-2 break-words text-sm text-muted-foreground">{reader?`Saved version ${reader.page.document.revision}`:`Program material shared by ${frame.brand.tenant_name}`}</p></header>
  {model.phase==='loading'?<div role="status" aria-label="Loading resources" className="space-y-4"><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></div>
   :model.phase!=='ready'?<div ref={notice} tabIndex={-1} role="alert" className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="max-w-prose text-sm leading-6">{model.notice}</p>
    {model.phase==='signed_out'?<Button asChild variant="outline"><Link to="/auth">Sign in</Link></Button>:<Button variant="outline" onClick={()=>void model.reload()}>Refresh resources</Button>}</div>
   :reader?<article aria-label={reader.page.document.title} className="space-y-6">
    <div className="max-w-prose whitespace-pre-wrap break-words text-base leading-8 [overflow-wrap:anywhere]">{reader.page.content}</div>
    <nav aria-label="Resource sections" className="flex flex-wrap items-center gap-3">
     {reader.page.offset>0&&<Button variant="outline" onClick={()=>{focus.current={kind:'reader',id:reader.resource.share_id};void model.open(reader.resource,Math.max(0,reader.page.offset-12000));}}>Previous section</Button>}
     {reader.page.has_more?<Button style={style} onClick={()=>{focus.current={kind:'reader',id:reader.resource.share_id};void model.open(reader.resource,reader.page.next_offset);}}>Read next section</Button>
      :<p role="status" className="text-sm text-muted-foreground">End of resource</p>}
    </nav>
    <p className="max-w-prose text-sm leading-6 text-muted-foreground">This is the saved text shared with you. If the business changes or withdraws it, return to Resources for the current material.</p>
   </article>:<>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Your resources</h2><Button variant="ghost" onClick={()=>void model.reload()}>Refresh resources</Button></div>
    {!model.resources.length?<div className="space-y-3 py-5"><p role="status" className="text-sm text-muted-foreground">No program resources are currently available. Your team can share material here.</p><Button asChild variant="outline"><Link to="/app/support">Contact your team</Link></Button></div>
     :<ul className="divide-y divide-border border-y border-border">{model.resources.map(resource=><li key={resource.share_id} className="flex min-w-0 flex-wrap items-center gap-4 py-5">
      <BookOpen aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1 basis-40"><h3 className="break-words text-sm font-medium">{resource.title}</h3><p className="mt-1 text-sm text-muted-foreground">Saved version {resource.document_revision}</p></div>
      <Button ref={node=>{if(node)entries.current.set(resource.share_id,node);else entries.current.delete(resource.share_id);}} variant="outline" aria-label={`Open ${resource.title}`} onClick={()=>{focus.current={kind:'reader',id:resource.share_id};void model.open(resource);}}>Open resource</Button>
     </li>)}</ul>}
    {model.hasMore&&<Button variant="outline" onClick={()=>void model.loadMore()}>Load more resources</Button>}
    <p className="text-sm text-muted-foreground">For files and uploads, open <Link className="inline-flex min-h-[44px] items-center underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" to="/app/documents">Documents</Link>.</p>
   </>}
 </section>;
}

/** Keep the established /app/learn route and non-customer course behavior.
 * A server-verified customer frame selects the customer source, never a role label.
 */
export default function Resources(){
 const {user}=useOutletContext<{user?:{id:string}|null}>();
 const customer=useClientPortalFrame(user?.id??null);
 if(!user?.id)return <p role="status">Checking your customer session…</p>;
 if(customer.checking||customer.phase==='loading')return <div role="status" aria-label="Checking resource access" className="space-y-4"><Skeleton className="h-12 w-full"/><Skeleton className="h-16 w-full"/></div>;
 if(customer.phase==='not-client')return <LearningVault/>;
 if(customer.phase!=='ready'||!customer.frame)return <section className="space-y-4"><h1 className="text-2xl font-semibold">Resources</h1><p role="alert" className="text-sm">Your resource access could not be verified. Try again or contact your business.</p><Button variant="outline" onClick={()=>void customer.reload()}>Check access again</Button></section>;
 const frame=customer.frame;
 return <CustomerResourcesView key={`${frame.actorId}:${frame.profile.tenant_id}:${frame.profile.id}`} frame={frame}/>;
}
