import { useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { handOffPaigePrompt } from "@/lib/paigePromptHandoff";
import { clearPaigeClientScope } from "@/solo/paigeClientScope";
import { clearPaigePublicPresenceScope } from "@/solo/paigePublicPresenceScope";
import { useTenantContext } from "@/hooks/useTenantContext";
import { usePlanList, type Plan, type PlanItem } from "@/hooks/usePlanList";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OperationsAssignee } from "./OperationsAssignee";
import { OperationsWorkEditor } from "./OperationsWorkEditor";
import { useOperationsPeople } from "./useOperationsPeople";
import { OperationsWork } from "./OperationsWork";
import { OperationsProjects } from "./OperationsProjects";
import { OperationsOverview } from "./OperationsOverview";
import { OperationsCapacity } from "./OperationsCapacity";
import OperationsDelivery from "./OperationsDelivery";
import { OperationsPlaybooks } from "./OperationsPlaybooks";
import { operationsBundleMatchesTenant } from "./operations-source-contract";
import "./operations-workspace.css";

const DESTINATIONS = ["Overview", "Work", "Projects", "Delivery", "Playbooks", "Capacity"] as const;
type Destination = typeof DESTINATIONS[number];
type Inspection = { kind: "item"; id: string; view: Destination } | { kind: "plan"; id: string; view: Destination } | null;

type WorkspaceProps = { openPaige?: () => void; view?: string; onViewChange?: (view: string) => void };
export function OperationsWorkspace({ openPaige, view, onViewChange }: WorkspaceProps) {
  const { activeTenantId, activeUserId, loading, accountContextStatus } = useTenantContext();
  if (loading || accountContextStatus === "resolving") return <OperationsLoading />;
  if (!activeTenantId || !activeUserId || accountContextStatus !== "ready") return <div className="ops-state" role="status">
    <h1>Choose your workspace</h1><p>Open an authorized company workspace to see its work.</p>
  </div>;
  // Remount before paint on actor/workspace change: details, source reads and pending state cannot survive.
  return <ScopedOperations key={`${activeUserId}:${activeTenantId}`} tenantId={activeTenantId}
    userId={activeUserId} openPaige={openPaige} view={view} onViewChange={onViewChange} />;
}

function OperationsLoading() {
  return <div className="ops-state" aria-busy="true" role="status"><h1>Loading your work</h1>
    <div className="ops-loading-lines" aria-hidden="true"><i /><i /><i /></div></div>;
}

function ScopedOperations({ tenantId, userId, openPaige, view, onViewChange }: WorkspaceProps & {
  tenantId: string; userId: string;
}) {
  const [localDestination, setLocalDestination] = useState<Destination>("Overview");
  const destination = view === undefined ? localDestination
    : DESTINATIONS.find(name => name.toLowerCase() === view) ?? "Overview";
  const setDestination = (name: Destination) => {
    if (onViewChange) onViewChange(name.toLowerCase()); else setLocalDestination(name);
  };
  const [inspection, setInspection] = useState<Inspection>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { setInspection(null); }, [destination]);
  const inspectionInvoker = useRef<HTMLElement | null>(null);
  const source = usePlanList({ scope: "team", tenantScopeKey: `${userId}:${tenantId}` });
  const people = useOperationsPeople();
  const matches = operationsBundleMatchesTenant(source.plans, source.allItems, tenantId);
  const plans = matches ? source.plans : [];
  const items = matches ? source.allItems : [];
  const rememberInvoker = () => {
    if (inspection?.view !== destination && document.activeElement instanceof HTMLElement) inspectionInvoker.current = document.activeElement;
  };
  const inspectItem = (item: PlanItem) => { rememberInvoker(); setInspection({ kind: "item", id: item.id, view: destination }); };
  const inspectPlan = (plan: Plan) => { rememberInvoker(); setInspection({ kind: "plan", id: plan.id, view: destination }); };
  const props = { plans, items, members: people.members, onInspectItem: inspectItem, onInspectPlan: inspectPlan };
  const selectedItem = inspection?.view === destination && inspection.kind === "item" ? items.find((item) => item.id === inspection.id) : null;
  const selectedPlan = inspection?.view === destination && inspection.kind === "plan" ? plans.find((plan) => plan.id === inspection.id) : null;
  const isPlanning = !["Delivery", "Playbooks"].includes(destination);
  const member = people.members.find((person) => person.user_id === selectedItem?.assigned_to_user_id);
  const portalTheme = contentRef.current?.closest<HTMLElement>("[data-pg]")?.getAttribute("data-pg") ?? "dark";
  const reviewWithPaige = () => {
    if (!openPaige) return;
    clearPaigeClientScope(); clearPaigePublicPresenceScope();
    // Draft only into the existing composer. PAIGE must read canonical work and
    // re-resolve permissions; this opens no dispatch or approval path.
    handOffPaigePrompt(destination === "Capacity"
      ? "Review our current work assignments. Who owns the most active work, what is blocked, and what reassignment should we consider? Keep missing hours and effort unknown. Propose next steps for my review."
      : "Review our active projects and work this week. What is behind schedule, who is responsible, and which blockers need attention today? Use current work records and propose bounded next steps for my review.");
    openPaige();
  };

  return <section ref={contentRef} className="ops-workspace" aria-label="Operations department">
    <header className="ops-department-controls">
      <nav aria-label="Department views">{DESTINATIONS.map((name) => <button type="button" key={name}
        aria-current={destination === name ? "page" : undefined}
        onClick={() => { setDestination(name); setInspection(null); }}>{name}</button>)}</nav>
      <div className="ops-department-actions">
        {isPlanning && <button type="button" aria-label="Refresh work and team profiles"
          disabled={source.loading || people.loading} onClick={() => { void source.refresh(); void people.refresh(); }}><RefreshCw size={16} /></button>}
        {openPaige && <button type="button" onClick={reviewWithPaige}><Sparkles size={16} aria-hidden="true" />Review with PAIGE</button>}
      </div>
    </header>
    <div className="ops-department-body">
      {destination === "Delivery" ? <OperationsDelivery openPaige={openPaige} />
        : destination === "Playbooks" ? <OperationsPlaybooks tenantId={tenantId} />
        : source.loading ? <OperationsLoading />
        : source.forbidden ? <div className="ops-state" role="status"><h1>This work isn’t available to your role</h1><p>Ask your workspace owner to review your access.</p></div>
        : source.error || !matches ? <div className="ops-state" role="alert"><h1>Your work couldn’t be loaded</h1><p>Refresh to read the current workspace again.</p><button type="button" onClick={() => void source.refresh()}>Try again</button></div>
        : <>
          {people.error && <div className="ops-inline-notice" role="status">Work is available, but team names and photos couldn’t be loaded. <button type="button" onClick={() => void people.refresh()}>Retry profiles</button></div>}
          {destination === "Overview" && <OperationsOverview {...props} />}
          {destination === "Work" && <OperationsWork {...props} />}
          {destination === "Projects" && <OperationsProjects {...props} />}
          {destination === "Capacity" && <OperationsCapacity {...props} />}
          <p className="ops-source-limit">This view shows up to 200 plans and standalone items, with their visible work. {people.partial && "Some team profiles are outside the current read."}</p>
        </>}
    </div>
    <Sheet open={inspection?.view === destination} onOpenChange={(open) => { if (!open) setInspection(null); }}>
      <SheetContent className="ops-detail-sheet paige-solo" data-pg={portalTheme} data-theme={portalTheme} onCloseAutoFocus={(event) => {
        if (inspectionInvoker.current?.isConnected) { event.preventDefault(); inspectionInvoker.current.focus(); }
      }}>
        <SheetHeader><SheetTitle>{selectedItem?.title ?? selectedPlan?.title ?? "Work is no longer available"}</SheetTitle>
          <SheetDescription>{selectedItem?.summary ?? selectedPlan?.summary ?? "Details from your current workspace."}</SheetDescription></SheetHeader>
        {selectedItem && <div className="ops-detail-content">
          <dl><div><dt>Responsible person</dt><dd>{selectedItem.assigned_to_user_id && !member ? "Member unavailable" : <OperationsAssignee member={member} />}</dd></div>
            <div><dt>Status</dt><dd>{selectedItem.status.replace(/_/g, " ")}</dd></div>
            <div><dt>Priority</dt><dd>{selectedItem.priority}</dd></div>
            <div><dt>Due date</dt><dd>{selectedItem.due_at ? new Date(selectedItem.due_at).toLocaleString() : "Not scheduled"}</dd></div>
            <div><dt>Project</dt><dd>{plans.find((plan) => plan.id === selectedItem.plan_id)?.title ?? "Standalone work"}</dd></div>
            <div><dt>Work type</dt><dd>{selectedItem.item_type}</dd></div></dl>
          {selectedItem.status === "done" && <p>Recorded as completed work. Client delivery acceptance is a separate outcome.</p>}
          {selectedItem.linked_action_id && <p>A linked action exists. Its execution result has not been verified here.</p>}
          <OperationsWorkEditor key={selectedItem.id} item={selectedItem} actorId={userId} tenantId={tenantId}
            members={people.members} sourceError={Boolean(source.error) || !matches}
            refresh={() => source.refresh({ silent: true })} />
        </div>}
        {selectedPlan && <div className="ops-detail-content"><p>Status: {selectedPlan.status}</p>
          <ol className="ops-detail-work">{selectedPlan.items.map((item) => <li key={item.id}><button type="button" onClick={() => inspectItem(item)}>{item.title}</button><span>{item.status.replace(/_/g, " ")}</span></li>)}</ol></div>}
      </SheetContent>
    </Sheet>
  </section>;
}
