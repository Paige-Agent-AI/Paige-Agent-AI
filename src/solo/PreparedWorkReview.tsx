import React, { useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useParams } from "react-router-dom";
import { ArrowUpRight, FileText, RefreshCw, Scale } from "lucide-react";
import { routeLinkTarget } from "@/lib/links/workspaceLinks";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { SoloPendingActionsData } from "./data/useSoloPendingActions";
import "./prepared-work-review.css";

/** Count is native exact count, never the capped preview length. */
function preparedWorkCountLabel(data: SoloPendingActionsData): string {
  return typeof data.total === "number" && Number.isSafeInteger(data.total) && data.total >= 0
    ? `${data.total} prepared item${data.total === 1 ? "" : "s"}`
    : "Prepared work";
}

/** Native timestamps carry a zone. Do not guess one or substitute the read time. */
function preparationDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
const preparedAtFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
});

/** Source-fed presentation only. Original domains retain all editing/approval authority. */
export function PreparedWorkReview({ data, children, open, onOpenChange, selectedItemId, onSelectedItemChange, onCloseAutoFocus }: {
  data: SoloPendingActionsData;
  children?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  selectedItemId?: string | null;
  onSelectedItemChange?: (id: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { resolvedTheme } = useTheme();
  const { account } = useParams<{ account: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.items.find((item) => item.id === (selectedItemId ?? selectedId)) ?? data.items[0];
  const available = !data.loading && !data.error;
  // Current mounted account only; a route never grants record access. The original
  // destination reauthorizes the read, and a surface-only fallback is not a source.
  const target = selected?.sourceLink ? routeLinkTarget(selected.sourceLink, "solo", account) : null;
  const source = target?.status === "exact" ? target : null;
  const preparedAt = preparationDate(selected?.createdAt);
  const review = useRef<HTMLDivElement>(null), workspace = useRef<HTMLDivElement>(null);
  const documentPanel = useRef<HTMLElement>(null), list = useRef<HTMLElement>(null), sourceAnchor = useRef<HTMLAnchorElement>(null);
  // Mounted presentation only. The existing return reread still removes stale
  // details; preserve just position/focus, and restore only the same scoped source.
  const inspection = useRef<{ account: string; id: string; to: string; documentTop: number; workspaceTop: number; listTop: number; listLeft: number; refocus: boolean; awaitingRead: boolean } | null>(null);
  const rememberInspection = () => {
    if (!selected || !source || !account) return;
    inspection.current = { account, id: selected.id, to: source.to, documentTop: documentPanel.current?.scrollTop ?? 0,
      workspaceTop: workspace.current?.scrollTop ?? 0, listTop: list.current?.scrollTop ?? 0, listLeft: list.current?.scrollLeft ?? 0,
      refocus: document.activeElement === sourceAnchor.current, awaitingRead: false };
  };
  const refresh = () => { inspection.current = null; data.refresh(); };
  useLayoutEffect(() => {
    const saved = inspection.current;
    if (!saved) return;
    if (open === false || account !== saved.account) { inspection.current = null; return; }
    if (!available) { saved.awaitingRead = true; return; }
    if (selected?.id !== saved.id || source?.to !== saved.to) { inspection.current = null; return; }
    if (!saved.awaitingRead) return;
    saved.awaitingRead = false;
    if (documentPanel.current) documentPanel.current.scrollTop = saved.documentTop;
    if (workspace.current) workspace.current.scrollTop = saved.workspaceTop;
    if (list.current) { list.current.scrollTop = saved.listTop; list.current.scrollLeft = saved.listLeft; }
    if (saved.refocus && (document.activeElement === document.body || document.activeElement === review.current)) {
      sourceAnchor.current?.focus({ preventScroll: true });
    }
  }, [account, available, open, selected?.id, source?.to]);
  return <Dialog open={open} onOpenChange={next => { if (!next) inspection.current = null; onOpenChange?.(next); }}>
    {children && <DialogTrigger asChild>{children}</DialogTrigger>}
    <DialogContent ref={review} data-pg={resolvedTheme === "dark" ? "dark" : "light"} className="pwr" overlayClassName="pwr-scrim" onCloseAutoFocus={onCloseAutoFocus}>
      <header className="pwr-heading">
        <span className="pwr-eyebrow"><Scale size={16} aria-hidden /> Decision &amp; opportunity desk</span>
        <DialogTitle>Work prepared for your review</DialogTitle>
        <DialogDescription>Read the original work and its source. Prepared work has not been approved or completed.</DialogDescription>
      </header>
      {data.loading ? <p className="pwr-state" role="status">Checking this workspace’s prepared work…</p>
        : data.error ? <div className="pwr-state"><p role="alert">Prepared work could not be read. Previous details and counts are withheld.</p><button type="button" onClick={refresh}><RefreshCw size={16} aria-hidden /> Retry the read</button></div>
          : !selected ? <div className="pwr-state"><FileText size={24} aria-hidden /><h3>{data.total ? "Prepared work needs another read" : "No prepared items returned"}</h3><p>{data.total ? "The recorded count is positive, but no readable items were returned. Nothing is being assumed clear." : "This read returned no prepared items. Approvals and Strategic Plays remain separate records."}</p><button type="button" onClick={refresh}><RefreshCw size={16} aria-hidden /> Refresh prepared work</button></div>
            : <>
              <div className="pwr-summary"><strong>{preparedWorkCountLabel(data)}</strong><span>{data.items.length} shown · {data.total == null ? "total unavailable" : "latest first"}</span><button type="button" onClick={refresh}><RefreshCw size={16} aria-hidden /> Refresh</button></div>
              <div ref={workspace} className="pwr-workspace">
                <nav ref={list} className="pwr-list" aria-label="Prepared items">
                  {data.items.map((item) => <button type="button" key={item.id} aria-pressed={selected.id === item.id} onClick={() => { inspection.current = null; setSelectedId(item.id); onSelectedItemChange?.(item.id); }}><span>{item.department}</span><strong>{item.title}</strong><small>{item.draftContent ? "Draft text available" : item.summary ? "Recorded summary" : "Details unavailable"}</small></button>)}
                </nav>
                <article ref={documentPanel} className="pwr-document" aria-label="Selected prepared work">
                  <div className="pwr-source"><FileText size={16} aria-hidden /> Prepared work · {selected.department}</div>
                  <p className="pwr-time">{preparedAt ? <>Prepared <time dateTime={selected.createdAt}>{preparedAtFormat.format(preparedAt)}</time></> : "Preparation date unavailable"}</p>
                  <h2>{selected.title}</h2>
                  {selected.rationale && <aside className="pwr-reason"><strong>Why PAIGE held this</strong><p>{selected.rationale}</p></aside>}
                  {selected.draftContent && selected.summary && <p className="pwr-lead">{selected.summary}</p>}
                  {selected.draftContent || selected.summary
                    ? <section aria-label={selected.draftContent ? "Original draft" : "Recorded summary"}><h3>{selected.draftContent ? "Original draft" : "Recorded summary"}</h3><div className="pwr-prose">{selected.draftContent || selected.summary}</div></section>
                    : <p className="pwr-muted">No readable draft or summary was returned for this item.</p>}
                  <footer className="pwr-boundary"><strong>Available next step</strong>
                    <p>{source ? "Open the recorded source in a new tab to keep this review and conversation in place." : "Check the original approval or department before acting. No direct source link was returned."}</p>
                    {source && <a ref={sourceAnchor} className="pwr-next" href={source.to} target="_blank" rel="noopener noreferrer" onClick={rememberInspection} onAuxClick={event => { if (event.button === 1) rememberInspection(); }}>{source.label}<ArrowUpRight size={16} aria-hidden /><span>new tab</span></a>}
                    <p>This prepared item cannot be edited, approved or executed here.</p>
                  </footer>
                </article>
              </div>
            </>}
      {available && <p className="pwr-footnote">Refresh rereads the original work. It does not submit, approve or send it.</p>}
    </DialogContent>
  </Dialog>;
}
