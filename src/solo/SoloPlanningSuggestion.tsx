import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, FileText, RefreshCw, X } from "lucide-react";
import type { ChatComposerContextApi } from "@/components/dashboard/PaigeAIChat";
import { ContextualSuggestion } from "@/components/chat/ContextualSuggestion";
import { PreparedWorkReview } from "./PreparedWorkReview";
import { useSoloPendingActions, type SoloPendingAction } from "./data/useSoloPendingActions";
import type { PaigeBusinessPlanScope } from "./paigeClientScope";
import "./solo-planning-suggestion.css";

// Only mounted presentation memory. It is neither an approval nor another work store.
const itemKey = (item: SoloPendingAction) => JSON.stringify([item.id, item.createdAt, item.title, item.summary, item.draftContent, item.rationale, item.sourceLink?.destination, item.sourceLink?.record_id]);

export function SoloPlanningSuggestion({ api, tenantId, actorId, relevant, active, plan, onClearContext, sidePanel }: {
  api: ChatComposerContextApi; tenantId: string | null; actorId: string | null;
  relevant: boolean; active: boolean; plan: PaigeBusinessPlanScope | null;
  onClearContext: () => void; sidePanel: boolean;
}) {
  const canRead = Boolean(active && relevant && tenantId && actorId && api.ready);
  const data = useSoloPendingActions(canRead ? tenantId : null, actorId);
  const refresh = data.refresh;
  const [open, setOpen] = useState(false), [reviewOpen, setReviewOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<{ keys: string[]; total: number | null } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const available = !data.loading && !data.error;
  const total = data.total ?? null;
  const workReturned = data.items.length > 0 || (total ?? 0) > 0;
  const unseen = !dismissed || data.items.some(item => !dismissed.keys.includes(itemKey(item)))
    || (total !== null && dismissed.total !== null && total > dismissed.total);
  const show = canRead && !api.busy && (open || reviewOpen || (available && workReturned && unseen));
  const scopeVisible = active && api.ready && Boolean(tenantId && actorId && plan);
  useEffect(() => {
    if (!canRead) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [canRead, refresh]);
  useEffect(() => { if (!canRead || api.busy) { setOpen(false); setReviewOpen(false); } }, [canRead, api.busy]);
  const returnToChat = (event: Event) => {
    event.preventDefault();
    if (trigger.current) trigger.current.focus({ preventScroll: true }); else api.focusComposer();
    api.restoreLayout();
  };
  const inspect = (id: string | null) => { setSelectedId(id); setReviewOpen(true); setOpen(false); };
  const clearContext = () => {
    setOpen(false); onClearContext();
    // The original scope change can retire this portal. Focus after its trap releases.
    requestAnimationFrame(() => api.focusComposer());
  };
  if (!show && !scopeVisible) return null;
  return <div className="e2ps">
    {scopeVisible && !show && <button type="button" className="e2ps-scope" title={plan!.label} aria-label={`Clear planning context: ${plan!.label}`} onClick={clearContext}><span>{plan!.label}</span><X size={13} aria-hidden /></button>}
    {show && <>
      <ContextualSuggestion open={open} onOpenChange={next => { setOpen(next); if (next) data.refresh(); }} sidePanel={sidePanel}
        title="Ready for your review" description="Original prepared work, with its source. Reviewing does not approve or execute it."
        trigger={<button ref={trigger} type="button" className="e2ps-chip"><FileText size={15} aria-hidden /><span>{available && total !== null ? `${total} item${total === 1 ? "" : "s"} to review` : "Prepared work"}</span><ChevronDown size={13} aria-hidden /></button>}
        onCloseAutoFocus={event => {
          if (reviewOpen) { event.preventDefault(); return; }
          api.restoreLayout();
          // Respect the control chosen by an outside click. Keyboard/modal
          // return uses preventScroll so it cannot move the original transcript.
          const focused = document.activeElement;
          if (!focused || focused === document.body || (event.target instanceof HTMLElement && event.target.contains(focused))) {
            event.preventDefault(); trigger.current?.focus({ preventScroll: true });
          }
          // Closing after a failed reread can retire the trigger in the same commit.
          requestAnimationFrame(() => {
            if (!trigger.current && document.activeElement === document.body) api.focusComposer();
          });
        }}>
        {scopeVisible && <div className="e2ps-context"><span>{plan!.label}</span><button type="button" aria-label={`Clear planning context: ${plan!.label}`} onClick={clearContext}>Clear context</button></div>}
        {data.loading ? <p className="e2ps-state" role="status">Checking the original work…</p>
          : data.error ? <div className="e2ps-state"><p role="alert">Prepared work could not be checked. Previous details and counts are withheld.</p><button type="button" onClick={data.refresh}><RefreshCw size={15} aria-hidden /> Retry the read</button></div>
            : !workReturned ? <p className="e2ps-state">No prepared work returned. Original approvals remain separate.</p>
              : <><p className="e2ps-count">{total === null ? "Total unavailable" : `${total} prepared item${total === 1 ? "" : "s"}`} · {data.items.length} loaded for preview</p>
                {data.items.slice(0, 3).map(item => <button className="e2ps-item" type="button" key={item.id} onClick={() => inspect(item.id)}><span>{item.department} · {item.draftContent ? "Draft available" : item.summary ? "Recorded summary" : "Details unavailable"}</span><strong>{item.title}</strong>{item.summary && <p>{item.summary}</p>}<small>Read in Decision Desk <ArrowUpRight size={13} aria-hidden /></small></button>)}
                <button type="button" className="e2ps-open" onClick={() => inspect(null)}>Open Decision Desk <ArrowUpRight size={15} aria-hidden /></button></>}
      </ContextualSuggestion>
      <button type="button" className="e2ps-dismiss" aria-label="Dismiss prepared-work suggestion" onClick={() => { setDismissed({ keys: data.items.map(itemKey), total }); setOpen(false); api.focusComposer(); }}><X size={14} aria-hidden /></button>
      <PreparedWorkReview data={data} open={reviewOpen} onOpenChange={setReviewOpen} selectedItemId={selectedId} onSelectedItemChange={setSelectedId} onCloseAutoFocus={returnToChat} />
    </>}
  </div>;
}
