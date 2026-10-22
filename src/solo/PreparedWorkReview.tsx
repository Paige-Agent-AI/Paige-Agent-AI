import React, { useState } from "react";
import { useTheme } from "next-themes";
import { FileText, RefreshCw, Scale } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { SoloPendingActionsData } from "./data/useSoloPendingActions";
import "./prepared-work-review.css";

/** Count is native exact count, never the capped preview length. */
function preparedWorkCountLabel(data: SoloPendingActionsData): string {
  return typeof data.total === "number" && Number.isSafeInteger(data.total) && data.total >= 0
    ? `${data.total} prepared item${data.total === 1 ? "" : "s"}`
    : "Prepared work";
}

/** Source-fed presentation only. Original domains retain all editing/approval authority. */
export function PreparedWorkReview({ data, children }: { data: SoloPendingActionsData; children: React.ReactElement }) {
  const { resolvedTheme } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.items.find((item) => item.id === selectedId) ?? data.items[0];
  const available = !data.loading && !data.error;
  return <Dialog>
    <DialogTrigger asChild>{children}</DialogTrigger>
    <DialogContent data-pg={resolvedTheme === "dark" ? "dark" : "light"} className="pwr" overlayClassName="pwr-scrim">
      <header className="pwr-heading">
        <span className="pwr-eyebrow"><Scale size={16} aria-hidden /> Decision &amp; opportunity desk</span>
        <DialogTitle>Work prepared for your review</DialogTitle>
        <DialogDescription>Read the original draft and its source. Prepared work has not been approved or completed.</DialogDescription>
      </header>
      {data.loading ? <p className="pwr-state" role="status">Checking this workspace’s prepared work…</p>
        : data.error ? <div className="pwr-state"><p role="alert">Prepared work could not be read. Previous details and counts are withheld.</p><button type="button" onClick={data.refresh}><RefreshCw size={16} aria-hidden /> Retry the read</button></div>
          : !selected ? <div className="pwr-state"><FileText size={24} aria-hidden /><h3>{data.total ? "Prepared work needs another read" : "No prepared items returned"}</h3><p>{data.total ? "The recorded count is positive, but no readable items were returned. Nothing is being assumed clear." : "This read returned no prepared items. Approvals and Strategic Plays remain separate records."}</p><button type="button" onClick={data.refresh}><RefreshCw size={16} aria-hidden /> Refresh prepared work</button></div>
            : <>
              <div className="pwr-summary"><strong>{preparedWorkCountLabel(data)}</strong><span>{data.items.length} shown · {data.total == null ? "total unavailable" : "latest first"}</span><button type="button" onClick={data.refresh}><RefreshCw size={16} aria-hidden /> Refresh</button></div>
              <div className="pwr-workspace">
                <nav className="pwr-list" aria-label="Prepared items">
                  {data.items.map((item) => <button type="button" key={item.id} aria-pressed={selected.id === item.id} onClick={() => setSelectedId(item.id)}><span>{item.department}</span><strong>{item.title}</strong><small>{item.draftContent ? "Draft text available" : "Recorded summary"}</small></button>)}
                </nav>
                <article className="pwr-document" aria-label="Selected prepared work">
                  <div className="pwr-source"><FileText size={16} aria-hidden /> Prepared work · {selected.department}</div>
                  <h2>{selected.title}</h2>
                  {selected.rationale && <aside className="pwr-reason"><strong>Why PAIGE held this</strong><p>{selected.rationale}</p></aside>}
                  {selected.summary && <p className="pwr-lead">{selected.summary}</p>}
                  <section aria-label="Original draft"><h3>Original draft</h3>{selected.draftContent ? <div className="pwr-prose">{selected.draftContent}</div> : <p className="pwr-muted">No readable draft text was returned for this item.</p>}</section>
                  <footer className="pwr-boundary"><strong>Available next step</strong><p>Inspect the source and check the original approval or department before acting. This prepared item cannot be edited, approved or executed here.</p></footer>
                </article>
              </div>
            </>}
      {available && <p className="pwr-footnote">Refresh rereads the original work. It does not submit, approve or send it.</p>}
    </DialogContent>
  </Dialog>;
}
