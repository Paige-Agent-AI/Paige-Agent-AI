import { useRef, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { useKnowledgeDocuments } from "@/hooks/useKnowledgeDocuments";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { KnowledgeDocument } from "@/lib/knowledge-service";

const procedureLabels = new Set(["sop", "procedure", "procedures", "playbook", "playbooks", "operating procedure"]);
function isProcedure(document: KnowledgeDocument) {
  return [document.category, ...(document.tags ?? [])].some((label) =>
    label && procedureLabels.has(label.trim().toLowerCase()));
}

export function OperationsPlaybooks({ tenantId }: { tenantId: string }) {
  const source = useKnowledgeDocuments(tenantId);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const invoker = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const portalTheme = contentRef.current?.closest<HTMLElement>("[data-pg]")?.getAttribute("data-pg") ?? "dark";
  const procedures = source.docs.filter(isProcedure);
  const shown = procedures.filter((doc) => `${doc.title} ${doc.summary ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <section ref={contentRef} className="ops-views ops-procedures" aria-label="Playbooks">
    <header className="ops-view-heading"><div><h1>Make good work repeatable</h1><p>The procedures your team can turn to when the next step matters.</p></div></header>
    <label className="ops-view-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Find a procedure</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a procedure" /></label>
    {source.loading && !source.docs.length ? <p role="status">Loading procedure sources…</p>
      : source.error ? <div className="ops-state" role="alert"><h2>Procedures couldn’t be loaded</h2><p>{source.error}</p><button type="button" onClick={() => void source.reload()}>Try again</button></div>
      : !shown.length ? <div className="ops-procedure-first-use"><BookOpen size={36} aria-hidden="true" /><h2>{procedures.length ? "No matching procedure" : "Start with the way your team works"}</h2>
        <p>{procedures.length ? "Try a different search." : "Tag an existing Knowledge source “SOP”, “procedure” or “playbook” to make it available here."}</p>
        <p>Procedure sources can be read here. Checklist runs and approved workflow handoffs are not connected yet.</p>
        {query && <button type="button" onClick={() => setQuery("")}>Clear search</button>}</div>
        : <div className="ops-procedure-index">{shown.map((doc) => <button type="button" key={doc.id} onClick={(event) => { invoker.current = event.currentTarget; setSelected(doc.id); }}>
          <BookOpen size={21} aria-hidden="true" /><span><strong>{doc.title}</strong>{doc.summary && <span>{doc.summary}</span>}</span>
          <small>Revision {doc.revision}<br />Source material</small></button>)}</div>}
    {source.hasMore && <button className="ops-procedure-more" type="button" disabled={source.loading} onClick={() => void source.loadMore()}>Load more sources</button>}
    {shown.length > 0 && <p className="ops-source-limit">These are documented procedures, not execution records. Checklist runs and approval steps are not connected yet.</p>}
    <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      <SheetContent className="ops-detail-sheet paige-solo" data-pg={portalTheme} data-theme={portalTheme} onCloseAutoFocus={(event) => {
        if (invoker.current?.isConnected) { event.preventDefault(); invoker.current.focus(); }
      }}>{selected && <ProcedureDetail tenantId={tenantId} id={selected} />}</SheetContent>
    </Sheet>
  </section>;
}

function ProcedureDetail({ tenantId, id }: { tenantId: string; id: string }) {
  const source = useKnowledgeDocuments(tenantId, id);
  const document = source.docs[0];
  return <><SheetHeader><SheetTitle>{document?.title ?? "Procedure source"}</SheetTitle>
    <SheetDescription>{document ? `Revision ${document.revision} · ${document.source}` : "Reading the current procedure source."}</SheetDescription></SheetHeader>
    <div className="ops-detail-content">{source.loading ? <p role="status">Loading source…</p>
      : source.error ? <div role="alert"><p>{source.error}</p><button type="button" onClick={() => void source.reload()}>Try again</button></div>
      : !document ? <p>This source is no longer available.</p>
      : <>{document.summary && <p>{document.summary}</p>}<div className="ops-procedure-content">{document.content ?? "The source has no readable body in this view."}</div>
        <p>Reading this source does not start work or record an approval.</p></>}</div></>;
}
