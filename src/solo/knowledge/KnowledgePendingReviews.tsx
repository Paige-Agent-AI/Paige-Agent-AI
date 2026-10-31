import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {Dialog} from '@/components/ui/dialog';
import {AddKnowledgeFlow} from './AddKnowledgeFlow';
import {listKnowledgePendingReviews, readKnowledgePendingReviewTarget, type ExtractionClient,
  type KnowledgePendingReviewSummary, type KnowledgeReviewTarget} from '@/lib/knowledge-extraction-service';

type Props = {tenantId: string; onPublished: () => void};
export function KnowledgePendingReviews(props: Props) {
  return <PendingSession key={props.tenantId} {...props} />;
}
const statuses = {claimed:'Reading',expired:'Reading needs recovery',succeeded:'Review available',failed:'Reading failed',cancelled:'Reading cancelled',blocked:'Access paused',outcome_unknown:'Reading outcome unconfirmed'};
/** Only original pending records. No browser persistence, automatic retry or new
 * extraction/publication is performed by discovery or opening a document.
 */
function PendingSession({tenantId, onPublished}: Props) {
  const [items,setItems] = useState<KnowledgePendingReviewSummary[]>([]);
  const [cursor,setCursor] = useState<string|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string|null>(null);
  const [target,setTarget] = useState<KnowledgeReviewTarget|null>(null);
  const [opening,setOpening] = useState(false);
  const live = useRef(true), sequence = useRef(0), opener = useRef<HTMLButtonElement|null>(null), heading = useRef<HTMLHeadingElement>(null);
  const client = supabase as unknown as ExtractionClient;
  useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const load = useCallback(async (after: string|null = null) => {
    const mine=++sequence.current;
    setLoading(true); setOpening(false); setError(null);
    if (after===null) {setItems([]);setCursor(null);}
    try {
      const result=await listKnowledgePendingReviews(client,{tenantId,isCurrent:()=>live.current&&sequence.current===mine},after);
      if (!live.current||sequence.current!==mine) return;
      setItems(previous=>after===null?result.items:[...previous,...result.items]); setCursor(result.nextCursor);
    } catch {if(live.current&&sequence.current===mine)setError('Unfinished documents could not be read. Reload before starting another upload.');}
    finally {if(live.current&&sequence.current===mine)setLoading(false);}
  },[client,tenantId]);
  useEffect(()=>{void load();},[load]); // Every tenant incarnation is a separate keyed session.
  const open = async (item: KnowledgePendingReviewSummary, button: HTMLButtonElement) => {
    if (opening||loading) return;
    const mine=++sequence.current;opener.current=button;setOpening(true);setError(null);
    try {
      const read=await readKnowledgePendingReviewTarget(client,{tenantId,isCurrent:()=>live.current&&sequence.current===mine},item);
      if(live.current&&sequence.current===mine)setTarget(read);
    } catch {if(live.current&&sequence.current===mine)setError('This unfinished document changed or could not be read. Reload its current state; no new reading was started.');}
    finally {if(live.current&&sequence.current===mine)setOpening(false);}
  };
  const close = () => {setTarget(null);void load();};
  return <section aria-labelledby="knowledge-pending-heading" aria-busy={loading||opening}>
    <div className="knowledge-library__header"><div><h3 id="knowledge-pending-heading" ref={heading} tabIndex={-1}>Unfinished documents</h3><p>Open the original reading or saved review. These documents are not necessarily published.</p></div>
      <button disabled={loading||opening} onClick={()=>void load()}>Reload unfinished documents</button></div>
    {error&&<p className="knowledge-library__notice" role="alert">{error}</p>}
    {loading&&<p role="status">Reading unfinished documents…</p>}
    {opening&&<p role="status">Opening the current document…</p>}
    {!loading&&!error&&items.length===0&&<p>No unfinished documents found.</p>}
    {items.length>0&&<ul className="knowledge-library__list">{items.map(item=><li key={item.documentId}>
      <span aria-hidden="true" /> <div><button disabled={loading||opening} aria-label={`Open ${item.title}`} onClick={event=>void open(item,event.currentTarget)}>{item.title}</button><p>{statuses[item.status]} · Revision {item.revision}</p></div>
    </li>)}</ul>}
    {cursor&&<button disabled={loading||opening} onClick={()=>void load(cursor)}>More unfinished documents</button>}
    <Dialog open={!!target} onOpenChange={isOpen=>{if(!isOpen)close();}}>{target&&<AddKnowledgeFlow tenantId={tenantId} replacementTarget={target} onClose={close}
      returnFocus={()=>opener.current?.isConnected?opener.current:heading.current} onPublished={()=>{onPublished();}} />}</Dialog>
  </section>;
}
