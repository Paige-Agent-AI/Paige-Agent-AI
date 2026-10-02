import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, BrainCircuit, FileText, Link2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { KnowledgeMetadataEditor } from "@/components/knowledge/KnowledgeMetadataEditor";
import { AddDocDialog } from "@/pages/admin/TenantKnowledgeAdmin";
import { AddKnowledgeFlow } from "@/solo/knowledge/AddKnowledgeFlow";
import { useKnowledgeDocuments } from "@/hooks/useKnowledgeDocuments";
import { useConfirm } from "@/hooks/useConfirm";
import { supabase } from "@/integrations/supabase/client";
import { deleteKnowledge, readKnowledge, type KnowledgeDocument } from "@/lib/knowledge-service";
import "./knowledge-library.css";

type Props = { tenantId: string | null | undefined; account: string; requestedDocumentId?: string | null; onDocumentChange?: (id: string | null) => void };
/** A workspace change disposes drafts and in-flight views before the next one mounts. */
export function KnowledgeLibrary(props: Props) {
  return <WorkspaceLibrary key={props.tenantId ?? "unresolved"} {...props} />;
}
function publicLink(value: string | null): string | null {
  try { const url = new URL(value ?? ""); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function WorkspaceLibrary({ tenantId, account, requestedDocumentId, onDocumentChange }: Props) {
  const library = useKnowledgeDocuments(tenantId);
  const { confirm, dialog } = useConfirm();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uncertainDelete, setUncertainDelete] = useState(false);
  const removeTrigger = useRef<HTMLButtonElement>(null);
  const [sourceRetry, setSourceRetry] = useState(0);
  const [sourceFailed, setSourceFailed] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const deletePending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selectedId = selected?.id;
  useEffect(() => { if (selectedId) heading.current?.focus(); }, [selectedId]);
  useEffect(() => {
    const mine = ++generation.current;
    setSelected(null); setDetailError(null); setSourceFailed(false); setUncertainDelete(false);
    if (!tenantId || !requestedDocumentId) { setDetailLoading(false); return; }
    setDetailLoading(true); setNotice(null);
    void readKnowledge(supabase, tenantId, { documentId: requestedDocumentId }).then(rows => {
      if (!mounted.current || generation.current !== mine) return;
      const found = rows.find(row => row.id === requestedDocumentId && row.tenant_id === tenantId);
      if (found) setSelected(found);
      else setNotice("This Knowledge source was not found in the active workspace.");
    }).catch(() => {
      if (!mounted.current || generation.current !== mine) return;
      setSourceFailed(true); setNotice("This Knowledge source could not be read. Retry to check its current state.");
    }).finally(() => { if (mounted.current && generation.current === mine) setDetailLoading(false); });
  }, [tenantId, requestedDocumentId, sourceRetry]);
  const categories = useMemo(() => [...new Set(library.docs.map(d => d.category).filter((v): v is string => !!v))].sort(), [library.docs]);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return library.docs.filter(d => (!category || d.category === category) && (!term || [d.title, d.summary, d.category, ...(d.tags ?? [])].join(" ").toLocaleLowerCase().includes(term)));
  }, [library.docs, query, category]);
  const back = () => {
    generation.current++; onDocumentChange?.(null); setSelected(null); setDetailError(null); setDetailLoading(false); setUncertainDelete(false);
    requestAnimationFrame(() => lastTrigger.current?.isConnected ? lastTrigger.current.focus() : heading.current?.focus());
  };
  const inspect = async (document: KnowledgeDocument, checkingDelete = false) => {
    if (!tenantId) return;
    const mine = ++generation.current;
    setSelected(document); setDetailLoading(true); setDetailError(null);
    try {
      const rows = await readKnowledge(supabase, tenantId, { documentId: document.id });
      if (!mounted.current || generation.current !== mine) return;
      const found = rows.find(d => d.id === document.id && d.tenant_id === tenantId);
      if (!found) {
        setSelected(null); setUncertainDelete(false);
        requestAnimationFrame(() => heading.current?.focus());
        setNotice(checkingDelete ? "This document is no longer in Knowledge. The earlier operation and its receipt could not be confirmed." : "This document is no longer available. Refresh the library.");
        void library.reload();
      } else { setSelected(found); setUncertainDelete(false); }
    } catch { if (mounted.current && generation.current === mine) setDetailError("The document could not be read. Check your workspace and try again."); }
    finally { if (mounted.current && generation.current === mine) setDetailLoading(false); }
  };
  const remove = async () => {
    if (!selected || !tenantId || deletePending.current || uncertainDelete) return;
    deletePending.current = true;
    const target = selected;
    const approved = await confirm({ title: `Remove “${target.title}”?`, description: "This removes the document and its indexed sections from future Knowledge reads. Original uploaded files are retained. This cannot be undone here.", actionLabel: "Remove document", destructive: true, returnFocus: () => removeTrigger.current?.disabled ? heading.current : removeTrigger.current ?? heading.current });
    if (!mounted.current) return;
    if (!approved) { deletePending.current = false; return; }
    setDeleting(true); setNotice(null);
    try {
      const result = await deleteKnowledge(supabase, tenantId, target.id, target.revision);
      if (!mounted.current) return;
      setNotice(`Document removed. Original uploaded files were retained.${result.outcome === "capability_completed_unrecorded" ? " The outcome receipt could not be recorded; do not repeat the deletion." : ""}`);
      back(); void library.reload();
    } catch {
      if (mounted.current) { setUncertainDelete(true); setDetailError("The removal could not be confirmed. Check document status before taking another action."); }
    } finally { if (mounted.current) { deletePending.current = false; setDeleting(false); } }
  };
  if (!tenantId) return <section className="knowledge-library"><p role="status">Select a workspace to open Knowledge.</p></section>;
  return <section className="knowledge-library" aria-label="Business knowledge library">
    {notice && <p className="knowledge-library__notice" role="status">{notice}</p>}
    {sourceFailed && <button onClick={() => setSourceRetry(value => value + 1)} disabled={detailLoading}>Retry source</button>}
    {requestedDocumentId && detailLoading && !selected && <p role="status">Reading requested source…</p>}
    {selected ? <>
      <button className="knowledge-library__back" onClick={back} disabled={deleting}><ArrowLeft aria-hidden /> Back to knowledge</button>
      <header className="knowledge-library__header"><div><h2 ref={heading} tabIndex={-1}>{selected.title}</h2><p>{selected.source} · Revision {selected.revision}</p></div></header>
      {detailError && <div className="knowledge-library__notice" role="alert"><p>{detailError}</p><button onClick={() => void inspect(selected, uncertainDelete)} disabled={detailLoading}>{uncertainDelete ? "Check document status" : "Retry document"}</button></div>}
      <div className="knowledge-library__detail">
        <article className="knowledge-library__content" aria-busy={detailLoading}>
          <h3>Source content</h3>
          {detailLoading ? <p role="status">Reading document…</p> : selected.content !== undefined ? <div className="knowledge-library__text">{selected.content}</div> : <p>Content has not been loaded.</p>}
        </article>
        <aside className="knowledge-library__metadata" aria-label="Document details">
          <dl><dt>Summary</dt><dd>{selected.summary || "No summary added"}</dd><dt>Category</dt><dd>{selected.category || "Uncategorized"}</dd><dt>Tags</dt><dd>{selected.tags?.length ? selected.tags.join(", ") : "No tags added"}</dd><dt>Indexed sections</dt><dd>{selected.chunk_count}. Complete source coverage has not been verified.</dd></dl>
          {publicLink(selected.source_url) && <a href={publicLink(selected.source_url)!} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open original source</a>}
          <Dialog open={editing} onOpenChange={setEditing}>
            <DialogTrigger asChild><button disabled={detailLoading || deleting || uncertainDelete || !!detailError}>Edit details</button></DialogTrigger>
            {editing && <KnowledgeMetadataEditor key={`${tenantId}:${selected.id}`} tenantId={tenantId} document={selected} onClose={() => setEditing(false)} onSaved={doc => { setSelected(current => current?.id === doc.id ? { ...current, ...doc } : current); void library.reload(); }} />}
          </Dialog>
          <a href={`/solo/${encodeURIComponent(account)}/command-center/mind?knowledge=${encodeURIComponent(selected.id)}`}><BrainCircuit aria-hidden /> View in Mind</a>
          <button ref={removeTrigger} className="knowledge-library__remove" onClick={() => void remove()} disabled={detailLoading || deleting || uncertainDelete || !!detailError}><Trash2 aria-hidden />{deleting ? "Removing…" : "Remove document"}</button>
        </aside>
      </div>
    </> : <>
      <header className="knowledge-library__header"><div><h2 ref={heading} tabIndex={-1}>Knowledge</h2><p>Knowledge Paige can use for this business.</p></div><div className="knowledge-library__actions">{/* Link ingestion stays on the legacy direct path until governed URL extraction ships with format parity. */}<Dialog open={linking} onOpenChange={setLinking}><DialogTrigger asChild><button className="knowledge-library__secondary" aria-label="Add a web link"><Link2 aria-hidden /> Link</button></DialogTrigger>{linking && <AddDocDialog key={`${tenantId}:link`} tenantId={tenantId} initialMode="url" onClose={() => { setLinking(false); void library.reload(); }} onReview={() => void library.reload()} />}</Dialog><Dialog open={adding} onOpenChange={setAdding}><DialogTrigger asChild><button className="knowledge-library__primary"><Plus aria-hidden /> Add Knowledge</button></DialogTrigger>{adding && <AddKnowledgeFlow key={tenantId} tenantId={tenantId} onClose={() => { setAdding(false); void library.reload(); }} onPublished={() => { setAdding(false); void library.reload(); }} />}</Dialog></div></header>
      <div className="knowledge-library__tools"><label><span>Search documents</span><div className="knowledge-library__search"><Search aria-hidden /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Title, summary or tag" /></div></label><label><span>Category</span><select value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label><button onClick={() => void library.reload()} disabled={library.loading} aria-label="Refresh knowledge"><RefreshCw aria-hidden /></button></div>
      {library.error && <div className="knowledge-library__notice" role="alert"><p>Knowledge could not be loaded. Check your workspace and try again.</p><button onClick={() => void library.reload()} disabled={library.loading}>Retry library</button></div>}
      {library.loading && !library.docs.length ? <p role="status">Loading knowledge…</p> : !library.error && !library.docs.length ? <div className="knowledge-library__empty"><BookOpen aria-hidden /><h3>Your business knowledge starts here</h3><p>Add a document, a link or a short note.</p></div> : <>
        <p className="knowledge-library__count" role="status">{visible.length} shown · {library.docs.length} loaded{library.hasMore ? " · Search and categories apply to loaded documents" : ""}</p>
        <ul className="knowledge-library__list">{visible.map(doc => <li key={doc.id}><FileText aria-hidden /><div><button onClick={e => { lastTrigger.current = e.currentTarget; if (onDocumentChange) onDocumentChange(doc.id); else void inspect(doc); }}>{doc.title}</button><p>{doc.summary || `${doc.source} · ${doc.category || "Uncategorized"}`}</p>{!!doc.tags?.length && <div className="knowledge-library__tags">{doc.tags.map((tag, i) => <span key={`${tag}:${i}`}>{tag}</span>)}</div>}</div><span className="knowledge-library__index">{doc.chunk_count > 0 ? `${doc.chunk_count} indexed sections` : "Index not confirmed"}</span></li>)}</ul>
        {!visible.length && <p>No loaded documents match these filters.</p>}
        {library.hasMore && <button onClick={() => void library.loadMore()} disabled={library.loading}>{library.loading ? "Loading…" : "Load more documents"}</button>}
      </>}
    </>}
    {dialog}
  </section>;
}
