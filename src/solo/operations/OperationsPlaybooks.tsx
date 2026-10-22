import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import { useKnowledgeDocuments } from "@/hooks/useKnowledgeDocuments";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { readKnowledge, type KnowledgeDocument } from "@/lib/knowledge-service";
import { supabase } from "@/integrations/supabase/client";

import { OwnerTaskAutomations } from "@/solo/owner-task-automations";
import "@/solo/settings-integrations.css";
const procedureLabels = new Set(["sop", "procedure", "procedures", "playbook", "playbooks", "operating procedure"]);
function isProcedure(document: KnowledgeDocument) {
  return [document.category, ...(document.tags ?? [])].some(label => label && procedureLabels.has(label.trim().toLowerCase()));
}
export type ProcedureReference = Pick<KnowledgeDocument, "id" | "tenant_id" | "title" | "revision">;
type Props = {
  tenantId: string;
  view?: "procedures" | "automations";
  onViewChange?: (view: "procedures" | "automations") => void;
  onNavigationGuardChange?: (guard: (() => string | null) | null) => void;
  canLeave?: () => boolean;
  onPrepare?: (source: ProcedureReference | null, routine?: string) => void;
};
const routines = [
  ["Client handoff", "Clarify the owner, required inputs and the next team handoff."],
  ["Weekly review", "Define what to inspect, when to review it and what needs your attention."],
  ["Quality check", "Outline the checks and evidence needed before work is accepted."],
] as const;

function ProcedureLibrary({ tenantId, onPrepare }: Props) {
  const source = useKnowledgeDocuments(tenantId);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const invoker = useRef<HTMLButtonElement | null>(null);
  const handoffClosing = useRef(false);
  const contentRef = useRef<HTMLElement | null>(null);
  const portalTheme = contentRef.current?.closest<HTMLElement>("[data-pg]")?.getAttribute("data-pg") ?? "dark";
  const procedures = source.docs.filter(doc => doc.tenant_id === tenantId && isProcedure(doc));
  const shown = procedures.filter(doc => `${doc.title} ${doc.summary ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <section ref={contentRef} className="ops-views ops-procedures" aria-label="Playbooks">
    <header className="ops-view-heading"><h1>Make good work repeatable</h1></header>
    <div className="ops-procedure-tools"><label className="ops-view-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Find a procedure</span>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a procedure" /></label>
      {!source.loading && !source.error && <span>{procedures.length}{source.hasMore ? "+" : ""} procedure sources</span>}</div>
    {source.loading && !source.docs.length ? <p role="status">Loading procedure sources…</p>
      : source.error ? <div className="ops-state" role="alert"><h2>Procedures couldn’t be loaded</h2><p>{source.error}</p><button type="button" onClick={() => void source.reload()}>Try again</button></div>
      : !shown.length ? procedures.length || query ? <div className="ops-procedure-first-use"><h2>No matching procedure</h2><p>Try a different search.</p><button type="button" onClick={() => setQuery("")}>Clear search</button></div>
        : <div className="ops-procedure-start"><div><span className="ops-project-start-kicker">YOUR PROCESS LIBRARY</span><h2>Give your best work a repeatable path.</h2><p>Read documented procedures here, then work with ZION to shape the next workflow. Add a source tagged SOP, procedure or playbook in Knowledge.</p><small>Starting points prepare a question. Nothing is saved, enabled or run.</small></div>
          <div className="ops-procedure-routines" aria-label="Workflow starting points">{routines.map(([name, note]) => <button type="button" key={name} disabled={!onPrepare || !source.isCurrent()} onClick={() => { if (source.isCurrent()) onPrepare?.(null, name); }}><span><strong>{name}</strong><small>{note}</small></span><ArrowRight size={17} aria-hidden="true" /></button>)}</div></div>
        : <div className="ops-procedure-index">{shown.map(doc => <button type="button" key={doc.id} onClick={event => { invoker.current = event.currentTarget; setSelected(doc.id); }}>
          <BookOpen size={21} aria-hidden="true" /><span><strong>{doc.title}</strong>{doc.summary && <span>{doc.summary}</span>}</span>
          <small>Revision {doc.revision}<br />Read source <ArrowRight size={12} aria-hidden="true" /></small></button>)}</div>}
    {source.hasMore && <button className="ops-procedure-more" type="button" disabled={source.loading} onClick={() => void source.loadMore()}>Load more sources</button>}
    {shown.length > 0 && <p className="ops-source-limit">These are documented procedures. Prepare a workflow for review from its source; saving, authorizing and executing work are separate steps.</p>}
    <Sheet open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}>
      <SheetContent className="ops-detail-sheet paige-solo" data-pg={portalTheme} data-theme={portalTheme} onCloseAutoFocus={event => {
        if (handoffClosing.current) {
          event.preventDefault(); handoffClosing.current = false;
          const origin = invoker.current;
          const shell = origin?.closest("[data-tenant-shell]");
          requestAnimationFrame(() => {
            if (!origin?.isConnected) return;
            const composer = shell?.querySelector<HTMLTextAreaElement>('#tenant-paige-workspace textarea[aria-label="Message PAIGE"]');
            if (composer && !composer.disabled && composer.getClientRects().length && !composer.closest('[hidden],[aria-hidden="true"],[inert]')) composer.focus({ preventScroll: true });
            else origin.focus({ preventScroll: true });
          });
        }
        else if (invoker.current?.isConnected) { event.preventDefault(); invoker.current.focus(); }
      }}>{selected && <ProcedureDetail key={selected} tenantId={tenantId} id={selected} onPrepare={onPrepare ? doc => {
        handoffClosing.current = true; setSelected(null); onPrepare(doc);
      } : undefined} />}</SheetContent>
    </Sheet>
  </section>;
}

function ProcedureDetail({ tenantId, id, onPrepare }: { tenantId: string; id: string; onPrepare?: (source: ProcedureReference) => void }) {
  const source = useKnowledgeDocuments(tenantId, id);
  const checking = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);
  const recovery = useRef<HTMLButtonElement | null>(null);
  const { isCurrent } = source;
  useEffect(() => { if (recheckError && isCurrent()) recovery.current?.focus(); }, [recheckError, isCurrent]);
  const document = source.docs.find(doc => doc.id === id && doc.tenant_id === tenantId && isProcedure(doc));
  const ready = !source.loading && !source.error && !preparing && !recheckError && document && source.isCurrent();
  async function prepare() {
    if (!ready || !onPrepare || checking.current || !source.isCurrent()) return;
    checking.current = true; setPreparing(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // isCurrent fences the hook's scope, not another author's later revision.
      const rows = await Promise.race([
        readKnowledge(supabase, tenantId, { documentId: id, limit: 1 }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Source check timed out")), 8_000); }),
      ]);
      if (!source.isCurrent()) return;
      const fresh = rows.length === 1 ? rows[0] : null;
      if (!fresh || fresh.id !== id || fresh.tenant_id !== tenantId || fresh.revision !== document.revision || !isProcedure(fresh)) {
        setRecheckError("This procedure changed or is no longer available. Reload source before preparing a workflow."); return;
      }
      onPrepare({ id: fresh.id, tenant_id: fresh.tenant_id, title: fresh.title, revision: fresh.revision });
    } catch {
      if (source.isCurrent()) setRecheckError("The current procedure could not be verified. Reload source before preparing a workflow.");
    } finally {
      clearTimeout(timer); checking.current = false;
      if (source.isCurrent()) setPreparing(false);
    }
  }
  return <><SheetHeader><SheetTitle>{document?.title ?? "Procedure source"}</SheetTitle>
    <SheetDescription>{document ? `Revision ${document.revision} · ${document.source}` : "Reading the current procedure source."}</SheetDescription></SheetHeader>
    <div className="ops-detail-content">{source.loading ? <p role="status">Loading source…</p>
      : source.error ? <div role="alert"><p>{source.error}</p><button type="button" onClick={() => void source.reload()}>Try again</button></div>
      : !document ? <p>This procedure is no longer available.</p>
      : <><div className="ops-procedure-next"><div><strong>Turn the procedure into a workflow</strong><p>Review its trigger, steps, people and approval needs with ZION before anything is saved or enabled.</p></div><button type="button" disabled={!ready || !onPrepare} onClick={() => void prepare()}>
        {preparing ? "Checking source…" : "Prepare workflow draft"} <ArrowRight size={16} aria-hidden="true" /></button></div>
        {recheckError && <div className="ops-procedure-recovery" role="alert"><p>{recheckError}</p><button ref={recovery} type="button" onClick={() => { setRecheckError(null); void source.reload(); }}>Reload source</button></div>}
        {document.summary && <p>{document.summary}</p>}<div className="ops-procedure-content">{document.content ?? "The source has no readable body in this view."}</div>
        <p className="ops-source-limit">Reading this source does not start work or record an approval.</p></>}</div></>;
}

export function OperationsPlaybooks(props: Props) {
  const { onNavigationGuardChange } = props;
  const [localMode, setLocalMode] = useState<"procedures" | "automations">("procedures");
  const [notice, setNotice] = useState("");
  const mode = props.view ?? localMode;
  const held = useRef<(() => string | null) | null>(null);
  const register = useCallback((guard: (() => string | null) | null) => {
    held.current = guard; onNavigationGuardChange?.(guard);
    if (!guard?.()) setNotice("");
  }, [onNavigationGuardChange]);
  const leave = () => {
    const reason = held.current?.();
    if (reason) { setNotice(reason); return false; }
    return props.canLeave?.() ?? true;
  };
  const select = (next: "procedures" | "automations") => {
    if (next === mode || !leave()) return;
    if (props.onViewChange) props.onViewChange(next); else setLocalMode(next);
  };
  const design = (origin: HTMLButtonElement) => {
    if (!leave() || !props.onPrepare) return;
    props.onPrepare(null, "contact-created internal task process");
    requestAnimationFrame(() => {
      if (!origin.isConnected) return;
      const composer = origin.closest('[data-tenant-shell]')?.querySelector<HTMLTextAreaElement>('#tenant-paige-workspace textarea[aria-label="Message PAIGE"]');
      if (composer && !composer.disabled && composer.getClientRects().length && !composer.closest('[hidden],[aria-hidden="true"],[inert]')) composer.focus({ preventScroll: true });
    });
  };
  return <div className="ops-playbook-area">
    <div className="ops-process-views" role="group" aria-label="Playbook content">
      {(["procedures", "automations"] as const).map(name => <button type="button" key={name} aria-pressed={mode === name} onClick={() => select(name)}>
        {name === "procedures" ? "Procedures" : "Automations"}</button>)}
    </div>
    {notice && <p role="status" className="ops-inline-notice">{notice}</p>}
    {mode === "procedures" ? <ProcedureLibrary {...props} /> : <section className="ops-views ops-saved-processes" aria-label="Saved automations">
      <header className="ops-view-heading"><h1>Automations</h1><button className="ops-process-design" type="button" disabled={!props.onPrepare}
        onClick={event => design(event.currentTarget)}>Design with ZION</button></header>
      <p className="ops-process-path">Contact created <span aria-hidden="true">→</span> Task approval <span aria-hidden="true">→</span> Original work and receipt</p>
      <OwnerTaskAutomations onNavigationGuardChange={register} canLeave={leave} />
    </section>}
  </div>;
}
