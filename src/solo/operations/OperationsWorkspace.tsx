import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { handOffPaigePrompt } from "@/lib/paigePromptHandoff";
import { clearPaigeClientScope } from "@/solo/paigeClientScope";
import { clearPaigePublicPresenceScope } from "@/solo/paigePublicPresenceScope";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { getScopedUserId, subscribeScopedUser } from "@/lib/scopedUser";
import { usePlanList, type Plan, type PlanItem, type PlanItemStatus } from "@/hooks/usePlanList";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OperationsAssignee } from "./OperationsAssignee";
import { OperationsWorkEditor } from "./OperationsWorkEditor";
import { OperationsWorkCreator } from "./OperationsWorkCreator";
import { OperationsWorkActivity } from "./OperationsWorkActivity";
import { OperationsProjectCreator } from "./OperationsProjectCreator";
import { OperationsProjectEditor } from "./OperationsProjectEditor";
import { useOperationsPeople } from "./useOperationsPeople";
import { OperationsWork } from "./OperationsWork";
import { useOperationsCrmWork } from "./useOperationsCrmWork";
import { nativeWorkStage, crmActionForStage, type CrmWorkRecord } from "./operations-native-work";
import { buildCrmWorkStageOperation, restoreCrmWorkOperation, type CrmWorkOperation } from "./operations-crm-work-command";
import { OperationsCrmStageReview } from "./OperationsCrmStageReview";
import { OperationsCrmWorkEditor } from "./OperationsCrmWorkEditor";
import { workStatusLabel } from "./operations-presentation";
import { OperationsProjects } from "./OperationsProjects";
import { OperationsOverview } from "./OperationsOverview";
import { OperationsCapacity } from "./OperationsCapacity";
import OperationsDelivery from "./OperationsDelivery";
import { OperationsPlaybooks } from "./OperationsPlaybooks";
import { operationsBundleMatchesTenant } from "./operations-source-contract";
import { parseWeeklyPlanningSource, readWeeklyPlanningSource } from "./operations-weekly-source";
import "./operations-workspace.css";

const DESTINATIONS = ["Overview", "Work", "Projects", "Delivery", "Playbooks", "Capacity"] as const;
type Destination = typeof DESTINATIONS[number];
type Inspection = { kind: "item"; id: string; view: Destination; proposedStage?: PlanItemStatus; weeklySource?: boolean } | { kind: "plan"; id: string; view: Destination } | {kind:"crm";id:string;view:Destination;record:CrmWorkRecord} | {kind:"crm_recovery";id:string;view:Destination} | null;

type WorkspaceProps = { openPaige?: () => void; view?: string; onViewChange?: (view: string) => void;
  weeklySourceSearch?: string; weeklySourceKey?: string; onWeeklySourceDismiss?: () => void;
  onNavigationGuardChange?: (guard: (() => string | null) | null) => void };
const subscribePersona = (changed: () => void) => subscribeScopedUser(() => changed());
const serverPersona = () => null;
export function OperationsWorkspace(props: WorkspaceProps) {
  const { activeTenantId, activeUserId, loading, accountContextStatus } = useTenantContext();
  const { isImpersonating } = useImpersonation();
  const scopedUser = useSyncExternalStore(subscribePersona, getScopedUserId, serverPersona);
  if (isImpersonating || scopedUser !== null) return <div className="ops-state" role="status">
    <h1>Business work is unavailable in this view</h1><p>Leave View as Client to inspect your business commitments.</p>
  </div>;
  if (loading || accountContextStatus === "resolving") return <OperationsLoading />;
  if (!activeTenantId || !activeUserId || accountContextStatus !== "ready") return <div className="ops-state" role="status">
    <h1>Choose your workspace</h1><p>Open an authorized company workspace to see its work.</p>
  </div>;
  // Remount before paint on actor/workspace change: details, source reads and pending state cannot survive.
  return <ScopedOperations key={`${activeUserId}:${activeTenantId}`} tenantId={activeTenantId}
    userId={activeUserId} {...props} />;
}

function OperationsLoading() {
  return <div className="ops-state" aria-busy="true" role="status"><h1>Loading your work</h1>
    <div className="ops-loading-lines" aria-hidden="true"><i /><i /><i /></div></div>;
}

function ScopedOperations({ tenantId, userId, openPaige, view, onViewChange, weeklySourceSearch = "", weeklySourceKey,
  onWeeklySourceDismiss, onNavigationGuardChange }: WorkspaceProps & {
  tenantId: string; userId: string;
}) {
  const [localDestination, setLocalDestination] = useState<Destination>(() => DESTINATIONS.find(name => name.toLowerCase() === view) ?? "Overview");
  const destination = localDestination;
  const desiredDestination = view === undefined ? destination : DESTINATIONS.find(name => name.toLowerCase() === view) ?? "Overview";
  const editorGuard = useRef<(() => string | null) | null>(null);
  const [navigationNotice, setNavigationNotice] = useState("");
  const checkNavigation = useCallback(() => {
    const reason = editorGuard.current?.() ?? null;
    if (reason) setNavigationNotice(reason);
    return reason;
  }, []);
  const registerEditorGuard = useCallback((guard: (() => string | null) | null) => { editorGuard.current = guard; }, []);
  useLayoutEffect(() => { onNavigationGuardChange?.(checkNavigation); return () => onNavigationGuardChange?.(null); }, [checkNavigation, onNavigationGuardChange]);
  const setDestination = (name: Destination) => {
    if (name !== destination && checkNavigation()) return;
    if (onViewChange) onViewChange(name.toLowerCase()); else setLocalDestination(name);
  };
  const [inspection, setInspection] = useState<Inspection>(null);
  const [creatingWork, setCreatingWork] = useState(false);
  const creationInvoker = useRef<HTMLButtonElement | null>(null);
  const [creatingProject, setCreatingProject] = useState<{ project?: Plan } | null>(null);
  const projectCreationInvoker = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (desiredDestination !== destination && !checkNavigation()) setLocalDestination(desiredDestination);
  }, [desiredDestination, destination, checkNavigation]);
  useEffect(() => { selectionEpoch.current += 1; setInspection(null); setNavigationNotice(""); }, [destination]);
  const selectionEpoch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; selectionEpoch.current += 1; }; }, []);
  const [weeklySource, setWeeklySource] = useState<{ id: string | null; phase: "idle" | "reading" | "verified" | "unavailable"; item: PlanItem | null }>({ id: null, phase: "idle", item: null });
  const inspectionInvoker = useRef<HTMLElement | null>(null);
  const source = usePlanList({ scope: "team", tenantScopeKey: `${userId}:${tenantId}`, operationsActorId: userId, operationsTenantId: tenantId });
  const readsCrm = destination === "Work" || destination === "Capacity" || destination === "Overview";
  const crm = useOperationsCrmWork(readsCrm ? userId : null, readsCrm ? tenantId : null);
  const [crmReview,setCrmReview] = useState<CrmWorkOperation|null>(null);
  const [pendingCrmRecovery,setPendingCrmRecovery] = useState<CrmWorkOperation|null>(null);
  const [crmFeedback,setCrmFeedback] = useState("");
  const readRetainedCrm = () => {
    try {return restoreCrmWorkOperation(JSON.parse(sessionStorage.getItem(`paige:operations-crm-stage:${userId}:${tenantId}`)??"null"),userId,tenantId);}
    catch {return null;}
  };
  useEffect(()=>{
    setCrmReview(null);setCrmFeedback("");
    if(destination!=="Work"){setPendingCrmRecovery(null);return;}
    try {setPendingCrmRecovery(restoreCrmWorkOperation(JSON.parse(sessionStorage.getItem(`paige:operations-crm-stage:${userId}:${tenantId}`)??"null"),userId,tenantId));}
    catch {setPendingCrmRecovery(null);}
  },[destination,userId,tenantId]);
  const closeCrmReview = () => {setCrmReview(null);setPendingCrmRecovery(readRetainedCrm());};
  const people = useOperationsPeople();
  const matches = operationsBundleMatchesTenant(source.plans, source.allItems, tenantId);
  const planningAvailable = matches && !source.error && !source.forbidden;
  const crmMatches = crm.tasks.every(task => task.tenant_id === tenantId);
  const crmAvailable = crmMatches && !crm.error && !crm.forbidden;
  const crmTasks = crmAvailable ? crm.tasks : [];
  const plans = planningAvailable ? source.plans : [];
  const items = planningAvailable ? source.allItems : [];
  const rememberInvoker = () => {
    if (inspection?.view !== destination && document.activeElement instanceof HTMLElement) inspectionInvoker.current = document.activeElement;
  };
  const inspectItem = (item: PlanItem) => { if (checkNavigation()) return; selectionEpoch.current += 1; rememberInvoker(); setInspection({ kind: "item", id: item.id, view: destination }); };
  const inspectPlan = (plan: Plan) => { if (checkNavigation()) return; selectionEpoch.current += 1; rememberInvoker(); setInspection({ kind: "plan", id: plan.id, view: destination }); };
  const inspectCrm = (task:CrmWorkRecord) => {if(checkNavigation())return;selectionEpoch.current+=1;rememberInvoker();setCrmReview(null);setCrmFeedback("");setInspection({kind:"crm",id:task.id,record:task,view:destination});};
  const proposeCrm = (task:CrmWorkRecord,stage:PlanItemStatus,invoker:HTMLButtonElement|null) => {
    if (checkNavigation()) return;
    selectionEpoch.current += 1;
    const retained = readRetainedCrm();
    if (retained) {
      if(invoker?.isConnected)inspectionInvoker.current=invoker;else rememberInvoker();
      setInspection({kind:"crm_recovery",id:retained.taskId,view:destination});
      setPendingCrmRecovery(retained);setCrmFeedback("");setCrmReview(retained);return;
    }
    const operation=buildCrmWorkStageOperation(task,stage,userId,tenantId,crypto.randomUUID());
    if(!operation)return;
    if(invoker?.isConnected)inspectionInvoker.current=invoker;else rememberInvoker();
    setInspection({kind:"crm",id:task.id,record:task,view:destination});setCrmFeedback("");setCrmReview(operation);
  };
  const props = { plans, items, members: people.members, onInspectItem: inspectItem, onInspectPlan: inspectPlan };
  const linkedInspection = inspection?.kind === "item" && inspection.weeklySource === true;
  const selectedItem = inspection?.view === destination && inspection.kind === "item"
    ? linkedInspection ? weeklySource.id === inspection.id ? weeklySource.item : null : items.find((item) => item.id === inspection.id) : null;
  const readLinkedItem = useCallback(async (id: string, keepDetails = false) => {
    const epoch = ++selectionEpoch.current;
    const current = () => mounted.current && epoch === selectionEpoch.current;
    setWeeklySource(previous => ({ id, phase: "reading", item: keepDetails && previous.id === id ? previous.item : null }));
    const result = await readWeeklyPlanningSource({ actorId: userId, tenantId, itemId: id }, current);
    if (!current()) return;
    setWeeklySource({ id, phase: result.kind === "verified" ? "verified" : "unavailable", item: result.kind === "verified" ? result.item : null });
  }, [userId, tenantId]);
  useEffect(() => {
    if (destination !== "Work") return;
    const target = parseWeeklyPlanningSource(weeklySourceSearch);
    if (!target) {
      if (inspection?.kind === "item" && inspection.weeklySource && !checkNavigation()) {
        selectionEpoch.current += 1; setInspection(null); setWeeklySource({ id: null, phase: "idle", item: null });
      }
      return;
    }
    if (checkNavigation()) return;
    if (creatingWork || creatingProject || inspection?.kind === "crm" || inspection?.kind === "crm_recovery") {
      setNavigationNotice("Finish or close the current work inspection before opening a weekly-check source."); return;
    }
    if (target.kind === "invalid") {
      selectionEpoch.current += 1; setInspection(null); setWeeklySource({ id: null, phase: "unavailable", item: null });
      setNavigationNotice("This weekly-check work link is unavailable. Return to the weekly result and open a verified Planning record."); return;
    }
    rememberInvoker(); setNavigationNotice(""); setInspection({ kind: "item", id: target.id, view: "Work", weeklySource: true });
    void readLinkedItem(target.id);
    // Changes to selection/editor state must not re-apply a consumed URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, weeklySourceSearch, weeklySourceKey, readLinkedItem, checkNavigation]);
  const refreshSelectedWork = async () => {
    if (inspection?.kind === "item" && inspection.weeklySource) {
      await Promise.all([source.refresh({ silent: true }), readLinkedItem(inspection.id, true)]);
    } else await source.refresh({ silent: true });
  };
  const selectedPlan = inspection?.view === destination && inspection.kind === "plan" ? plans.find((plan) => plan.id === inspection.id) : null;
  const selectedCrm = inspection?.view === destination && (inspection.kind === "crm" || inspection.kind === "crm_recovery") && !crm.error && !crm.forbidden
    ? crmTasks.find(task=>task.id===inspection.id) ?? (crm.loading&&inspection.kind==="crm"&&inspection.record.tenant_id===tenantId?inspection.record:null) : null;
  const workReadable = (!source.loading && planningAvailable) || (!crm.loading && crmAvailable);
  const workView = <>
    {people.error && <div className="ops-inline-notice" role="status">Work is available, but team names and photos couldn’t be loaded. <button type="button" onClick={()=>void people.refresh()}>Retry profiles</button></div>}
    {(source.error || source.forbidden || !matches) && <div className="ops-inline-notice" role="status">Planning work is unavailable in this workspace. <button type="button" onClick={()=>void source.refresh()}>Retry planning work</button></div>}
    {source.loading && <p role="status">Reading Planning work…</p>}
    {crm.loading && <p role="status">Reading CRM tasks…</p>}
    {(crm.error || !crmMatches) && <div className="ops-inline-notice" role="status">{crm.error ?? "CRM work couldn’t be verified for this workspace."} <button type="button" onClick={()=>void crm.refresh()}>Retry CRM tasks</button></div>}
    {workReadable ? <OperationsWork {...props} crmTasks={crmTasks} onInspectCrmTask={inspectCrm} onProposeCrmStage={proposeCrm}
      onProposeStage={(item,proposedStage,invoker)=>{
        if (checkNavigation()) return;
        selectionEpoch.current += 1;
        if(invoker?.isConnected)inspectionInvoker.current=invoker;else rememberInvoker();
        setInspection({kind:"item",id:item.id,view:destination,proposedStage});
      }} /> : source.loading || crm.loading ? <OperationsLoading /> : <div className="ops-state" role="alert"><h1>Current work isn’t available</h1><p>Retry a source above or ask your workspace owner to review access.</p></div>}
    <p className="ops-source-limit">This view combines the Planning work and CRM tasks loaded here. Planning uses a 200-plan read with its visible work; CRM returns up to 200 tasks. Unavailable sources are excluded.{crm.hasMore&&" More CRM tasks exist beyond this read."}</p>
  </>;
  const isPlanning = !["Delivery", "Playbooks"].includes(destination);
  const overviewView = <>
    {people.error && <div className="ops-inline-notice" role="status">Team names and photos couldn’t be loaded. <button type="button" onClick={()=>void people.refresh()}>Retry profiles</button></div>}
    {!planningAvailable && !source.loading && <div className="ops-inline-notice" role="status">Project work is unavailable. <button type="button" onClick={()=>void source.refresh()}>Retry planning work</button></div>}
    {source.loading && <p role="status">Reading project work…</p>}
    {crm.loading && <p role="status">Reading CRM tasks…</p>}
    {!crmAvailable && !crm.loading && <div className="ops-inline-notice" role="status">CRM tasks couldn’t be verified for this workspace. <button type="button" onClick={()=>void crm.refresh()}>Retry CRM tasks</button></div>}
    {workReadable ? <OperationsOverview {...props} tenantId={tenantId} crmTasks={crmTasks} onInspectCrmTask={inspectCrm} />
      : source.loading || crm.loading ? <OperationsLoading /> : <div className="ops-state" role="alert"><h1>Current work isn’t available</h1><p>Retry a source above or ask your workspace owner to review access.</p></div>}
    <p className="ops-source-limit">Attention and deadlines reflect loaded Planning work and up to 200 CRM tasks. Unavailable sources are excluded.{crm.hasMore && " More CRM tasks exist beyond this read."}</p>
  </>;
  const capacityView = <>
    {people.error && <div className="ops-inline-notice" role="status">Team names and photos couldn’t be loaded. <button type="button" onClick={()=>void people.refresh()}>Retry profiles</button></div>}
    {!planningAvailable && <div className="ops-inline-notice" role="status">Planning assignments are unavailable. <button type="button" onClick={()=>void source.refresh()}>Retry planning work</button></div>}
    {source.loading && <p role="status">Reading project assignments…</p>}
    {crm.loading && <p role="status">Reading task assignments…</p>}
    {(crm.error || !crmMatches) && <div className="ops-inline-notice" role="status">CRM assignments couldn’t be verified for this workspace. <button type="button" onClick={()=>void crm.refresh()}>Retry tasks</button></div>}
    {workReadable ? <OperationsCapacity {...props} tenantId={tenantId} crmTasks={crmTasks} onInspectCrmTask={inspectCrm} />
      : source.loading || crm.loading ? <OperationsLoading /> : <div className="ops-state" role="alert"><h1>Assignments aren’t available</h1><p>Retry a source above or ask your workspace owner to review access.</p></div>}
    <p className="ops-source-limit">Workload reflects loaded project work and up to 200 CRM tasks. Unavailable sources are excluded.{crm.hasMore && " More CRM tasks exist beyond this read."} Recorded effort is an estimate, not confirmed availability.</p>
  </>;
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
        onClick={() => setDestination(name)}>{name}</button>)}</nav>
      <div className="ops-department-actions">
        {destination === "Work" && pendingCrmRecovery && !crmReview && <button type="button" onClick={event=>{
          inspectionInvoker.current=event.currentTarget;setCrmFeedback("");
          setInspection({kind:"crm_recovery",id:pendingCrmRecovery.taskId,view:destination});setCrmReview(pendingCrmRecovery);
        }}>Recover pending task change</button>}
        {destination === "Work" && <button type="button" disabled={source.loading || source.forbidden || Boolean(source.error) || !matches || people.loading || Boolean(people.error)} onClick={event => { creationInvoker.current = event.currentTarget; setCreatingWork(true); }}>New task</button>}
        {destination === "Projects" && <button type="button" disabled={source.loading || source.forbidden || Boolean(source.error) || !matches || people.loading || Boolean(people.error)} onClick={event => { projectCreationInvoker.current = event.currentTarget; setCreatingProject({}); }}>New project</button>}
        {isPlanning && <button type="button" aria-label="Refresh work and team profiles"
          disabled={source.loading || people.loading || (readsCrm && crm.loading) || weeklySource.phase === "reading"} onClick={() => { void refreshSelectedWork(); void people.refresh(); if(readsCrm)void crm.refresh(); }}><RefreshCw size={16} /></button>}
        {openPaige && <button type="button" onClick={reviewWithPaige}><Sparkles size={16} aria-hidden="true" />Review with PAIGE</button>}
      </div>
    </header>
    {navigationNotice && <p className="ops-inline-notice" role="status">{navigationNotice}</p>}
    <div className="ops-department-body">
      {destination === "Delivery" ? <OperationsDelivery openPaige={openPaige} plans={source.plans} items={source.allItems}
        planningReady={planningAvailable && !source.loading} members={people.members}
        peopleReady={!people.loading && !people.error && !people.partial}
        onVerified={async planId => { await source.refresh({ silent: true }); setInspection({ kind: "plan", id: planId, view: destination }); }} />
        : destination === "Playbooks" ? <OperationsPlaybooks tenantId={tenantId} />
        : destination === "Work" ? workView
        : destination === "Capacity" ? capacityView
        : destination === "Overview" ? overviewView
        : source.loading ? <OperationsLoading />
        : source.forbidden ? <div className="ops-state" role="status"><h1>This work isn’t available to your role</h1><p>Ask your workspace owner to review your access.</p></div>
        : source.error || !matches ? <div className="ops-state" role="alert"><h1>Your work couldn’t be loaded</h1><p>Refresh to read the current workspace again.</p><button type="button" onClick={() => void source.refresh()}>Try again</button></div>
        : <>
          {people.error && <div className="ops-inline-notice" role="status">Work is available, but team names and photos couldn’t be loaded. <button type="button" onClick={() => void people.refresh()}>Retry profiles</button></div>}
          {destination === "Projects" && <OperationsProjects {...props} />}
          <p className="ops-source-limit">Figures reflect the projects and work loaded here. {people.partial && "Some team profiles are outside the current read."}</p>
        </>}
    </div>
    <Sheet open={inspection?.view === destination} onOpenChange={(open) => { if (!open && !checkNavigation()) {
      selectionEpoch.current += 1; setInspection(null); closeCrmReview(); setNavigationNotice("");
      if (linkedInspection) onWeeklySourceDismiss?.();
    } }}>
      <SheetContent className="ops-detail-sheet paige-solo" data-pg={portalTheme} data-theme={portalTheme} onCloseAutoFocus={(event) => {
        if (inspectionInvoker.current?.isConnected) { event.preventDefault(); inspectionInvoker.current.focus(); }
        else {
          const workKey = inspectionInvoker.current?.dataset.workKey;
          const replacement = workKey ? Array.from(contentRef.current?.querySelectorAll<HTMLElement>("[data-work-key]") ?? []).find(element=>element.dataset.workKey===workKey) : null;
          if(replacement){event.preventDefault();replacement.focus();}
        }
      }}>
        <SheetHeader><SheetTitle className={linkedInspection ? "pr-8 break-words" : undefined}>{selectedItem?.title ?? selectedPlan?.title ?? selectedCrm?.title ?? (linkedInspection
          ? weeklySource.phase === "reading" ? "Reading current work" : "This work is unavailable"
          : inspection?.kind === "crm_recovery" ? "Recover the task change" : source.error || !matches ? "Work couldn’t be loaded" : "Work is not available in this view")}</SheetTitle>
          <SheetDescription>{selectedItem?.summary ?? selectedPlan?.summary ?? selectedCrm?.description ?? "Details from your current workspace."}</SheetDescription></SheetHeader>
        {linkedInspection && <p>Planning work referenced by the weekly check. Completing a check does not complete this work.</p>}
        {linkedInspection && weeklySource.phase === "reading" && <p role="status">Reading this record with your current work permissions…</p>}
        {linkedInspection && weeklySource.phase === "unavailable" && <p role="status">This record could not be verified for your current account and workspace. It may have changed or become unavailable.</p>}
        {linkedInspection && <button type="button" disabled={weeklySource.phase === "reading"} onClick={() => {
          if (inspection?.kind === "item") void refreshSelectedWork();
        }}>Refresh source work</button>}
        {navigationNotice && inspection && <p role="status">{navigationNotice}</p>}
        {!linkedInspection && !selectedItem && !selectedPlan && !selectedCrm && inspection && <p>{inspection.kind === "crm_recovery" ? "The earlier task’s current details are unavailable. This recovery applies only to its original proposed change." : "This task has not been verified here. Refresh current work before creating it again."}</p>}
        {(inspection?.kind === "crm" || inspection?.kind === "crm_recovery") && <button type="button" disabled={crm.loading || Boolean(crmReview)} onClick={()=>void crm.refresh()}>Refresh task details</button>}
        {selectedCrm && <div className="ops-detail-content">
          <dl><div><dt>Responsible person</dt><dd>{people.members.some(person=>person.user_id===selectedCrm.user_id)
            ? <OperationsAssignee member={people.members.find(person=>person.user_id===selectedCrm.user_id)} /> : "Member unavailable"}</dd></div>
            <div><dt>Status</dt><dd>{workStatusLabel(nativeWorkStage({source:"crm",key:`crm:${selectedCrm.id}`,record:selectedCrm}))}</dd></div>
            <div><dt>Priority</dt><dd>{selectedCrm.recorded_priority??"Not recorded"}</dd></div>
            <div><dt>Due date</dt><dd>{!selectedCrm.due_date?"Not scheduled":Number.isFinite(Date.parse(selectedCrm.due_date))?new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(selectedCrm.due_date)):"Date unavailable"}</dd></div>
            <div><dt>Estimated effort</dt><dd>{selectedCrm.estimated_minutes===null?"Not recorded":`${selectedCrm.estimated_minutes} minutes`}</dd></div>
            <div><dt>Source</dt><dd>CRM task{selectedCrm.deal_id?" · linked opportunity":""}{selectedCrm.biz_id?" · linked business":""}</dd></div></dl>
          {selectedCrm.status==="completed"&&<p>Recorded as completed internal work. Client acceptance is a separate outcome.</p>}
          {crmFeedback&&<p role="status">{crmFeedback}</p>}
          {!crmReview&&<label>Review a stage change<select aria-label="Review CRM task stage" value={nativeWorkStage({source:"crm",key:`crm:${selectedCrm.id}`,record:selectedCrm})}
            disabled={crm.loading||Boolean(crm.error)} onChange={event=>proposeCrm(selectedCrm,event.target.value as PlanItemStatus,null)}>
            <option value={nativeWorkStage({source:"crm",key:`crm:${selectedCrm.id}`,record:selectedCrm})}>{selectedCrm.status.replace(/_/g," ")}</option>
            {(["open","in_progress","done"] as PlanItemStatus[]).filter(stage=>crmActionForStage(selectedCrm,stage)).map(stage=><option key={stage} value={stage}>{stage==="open"?"Ready":stage==="done"?"Completed":"In progress"}</option>)}
          </select></label>}
          {!crmReview&&<OperationsCrmWorkEditor key={`${tenantId}:${selectedCrm.id}`} task={selectedCrm} actorId={userId} tenantId={tenantId}
            members={people.error?[]:people.members} unavailable={crm.loading||!crmAvailable}
            onPropose={operation=>{const retained=readRetainedCrm();setCrmFeedback("");setCrmReview(retained??operation);
              if(retained)setInspection({kind:"crm_recovery",id:retained.taskId,view:destination});}} />}
        </div>}
        {crmReview && <OperationsCrmStageReview key={`${tenantId}:${crmReview.key}`} operation={crmReview} refresh={crm.refresh} members={people.members}
          onClose={closeCrmReview} onVerified={taskId=>{setCrmReview(null);setPendingCrmRecovery(null);
            setInspection({kind:"crm_recovery",id:taskId,view:destination});setCrmFeedback("This task’s change is saved and confirmed in current CRM work.");}} />}
        {selectedItem && <div className="ops-detail-content">
          <dl><div><dt>Responsible person</dt><dd>{selectedItem.assigned_to_user_id && !member ? "Member unavailable" : <OperationsAssignee member={member} />}</dd></div>
            <div><dt>Status</dt><dd>{selectedItem.status.replace(/_/g, " ")}</dd></div>
            <div><dt>Priority</dt><dd>{selectedItem.priority}</dd></div>
            <div><dt>Due date</dt><dd>{selectedItem.due_at ? new Date(selectedItem.due_at).toLocaleString() : "Not scheduled"}</dd></div>
            <div><dt>Project</dt><dd>{plans.find((plan) => plan.id === selectedItem.plan_id)?.title ?? (selectedItem.plan_id ? "Project not loaded here" : "Standalone work")}</dd></div>
            <div><dt>Work type</dt><dd>{selectedItem.item_type}</dd></div></dl>
          {selectedItem.status === "done" && <p>Recorded as completed work. Client delivery acceptance is a separate outcome.</p>}
          {selectedItem.linked_action_id && <p>A linked action exists. Its execution result has not been verified here.</p>}
          <OperationsWorkEditor key={`${selectedItem.id}:${inspection?.kind === "item" ? inspection.proposedStage ?? "inspect" : "inspect"}`} item={selectedItem} actorId={userId} tenantId={tenantId}
            proposedStage={inspection?.kind === "item" ? inspection.proposedStage : undefined}
            members={people.members} sourceError={linkedInspection ? weeklySource.phase === "unavailable" : Boolean(source.error) || !matches}
            onNavigationGuardChange={registerEditorGuard} retainDraftOnLeave={linkedInspection}
            refresh={refreshSelectedWork} />
          <OperationsWorkActivity key={`${tenantId}:${selectedItem.id}`} actorId={userId} tenantId={tenantId}
            itemId={selectedItem.id} members={people.members} version={selectedItem.updated_at} />
        </div>}
        {selectedPlan && <div className="ops-detail-content"><p>Status: {selectedPlan.status}</p>
          <OperationsAssignee member={people.members.find(person => person.user_id === selectedPlan.owner_user_id)} />
          <OperationsProjectEditor key={`${tenantId}:${selectedPlan.id}`} plan={selectedPlan} actorId={userId} tenantId={tenantId}
            members={people.members} refresh={() => source.refresh({ silent: true })} sourceError={Boolean(source.error) || !matches} />
          <button type="button" disabled={people.loading || Boolean(people.error) || Boolean(source.error) || !matches} onClick={() => {
            projectCreationInvoker.current = inspectionInvoker.current;
            setCreatingProject({ project: selectedPlan }); setInspection(null);
          }}>Add milestone</button>
          <ol className="ops-detail-work">{selectedPlan.items.map((item) => <li key={item.id}><button type="button" onClick={() => inspectItem(item)}>{item.title}</button><span>{item.status.replace(/_/g, " ")}</span></li>)}</ol></div>}
      </SheetContent>
    </Sheet>
    {creatingWork && <OperationsWorkCreator actorId={userId} tenantId={tenantId} members={people.members} plans={plans}
      theme={portalTheme} invoker={creationInvoker.current} onClose={()=>setCreatingWork(false)}
      onCreated={async()=>{await source.refresh({silent:true});}}
      onRecover={async itemId=>{await source.refresh({silent:true});if(itemId){setCreatingWork(false);inspectionInvoker.current=creationInvoker.current;setInspection({kind:"item",id:itemId,view:destination});}}} />}
    {creatingProject && <OperationsProjectCreator actorId={userId} tenantId={tenantId} members={people.members}
      project={creatingProject.project} theme={portalTheme} invoker={projectCreationInvoker.current}
      onClose={() => setCreatingProject(null)} onCreated={() => source.refresh({ silent: true })}
      onRecover={async id => {
        await source.refresh({ silent: true });
        if (id) {
          setCreatingProject(null);
          inspectionInvoker.current = projectCreationInvoker.current;
          setInspection({ kind: creatingProject.project ? "item" : "plan", id, view: destination });
        }
      }} />}
  </section>;
}


