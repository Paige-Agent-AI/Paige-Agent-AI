import { useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { handOffPaigePrompt } from "@/lib/paigePromptHandoff";
import { clearPaigeClientScope } from "@/solo/paigeClientScope";
import { clearPaigePublicPresenceScope } from "@/solo/paigePublicPresenceScope";
import { useTenantContext } from "@/hooks/useTenantContext";
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
import { buildCrmWorkStageOperation, restoreCrmWorkStageOperation, type CrmWorkStageOperation } from "./operations-crm-work-command";
import { OperationsCrmStageReview } from "./OperationsCrmStageReview";
import { workStatusLabel } from "./operations-presentation";
import { OperationsProjects } from "./OperationsProjects";
import { OperationsOverview } from "./OperationsOverview";
import { OperationsCapacity } from "./OperationsCapacity";
import OperationsDelivery from "./OperationsDelivery";
import { OperationsPlaybooks } from "./OperationsPlaybooks";
import { operationsBundleMatchesTenant } from "./operations-source-contract";
import "./operations-workspace.css";

const DESTINATIONS = ["Overview", "Work", "Projects", "Delivery", "Playbooks", "Capacity"] as const;
type Destination = typeof DESTINATIONS[number];
type Inspection = { kind: "item"; id: string; view: Destination; proposedStage?: PlanItemStatus } | { kind: "plan"; id: string; view: Destination } | {kind:"crm";id:string;view:Destination;record:CrmWorkRecord} | {kind:"crm_recovery";id:string;view:Destination} | null;

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
  const [creatingWork, setCreatingWork] = useState(false);
  const creationInvoker = useRef<HTMLButtonElement | null>(null);
  const [creatingProject, setCreatingProject] = useState<{ project?: Plan } | null>(null);
  const projectCreationInvoker = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { setInspection(null); }, [destination]);
  const inspectionInvoker = useRef<HTMLElement | null>(null);
  const source = usePlanList({ scope: "team", tenantScopeKey: `${userId}:${tenantId}`, operationsActorId: userId, operationsTenantId: tenantId });
  const crm = useOperationsCrmWork(destination === "Work" ? userId : null, destination === "Work" ? tenantId : null);
  const [crmReview,setCrmReview] = useState<CrmWorkStageOperation|null>(null);
  const [pendingCrmRecovery,setPendingCrmRecovery] = useState<CrmWorkStageOperation|null>(null);
  const [crmFeedback,setCrmFeedback] = useState("");
  const readRetainedCrm = () => {
    try {return restoreCrmWorkStageOperation(JSON.parse(sessionStorage.getItem(`paige:operations-crm-stage:${userId}:${tenantId}`)??"null"),userId,tenantId);}
    catch {return null;}
  };
  useEffect(()=>{
    setCrmReview(null);setCrmFeedback("");
    if(destination!=="Work"){setPendingCrmRecovery(null);return;}
    try {setPendingCrmRecovery(restoreCrmWorkStageOperation(JSON.parse(sessionStorage.getItem(`paige:operations-crm-stage:${userId}:${tenantId}`)??"null"),userId,tenantId));}
    catch {setPendingCrmRecovery(null);}
  },[destination,userId,tenantId]);
  const closeCrmReview = () => {setCrmReview(null);setPendingCrmRecovery(readRetainedCrm());};
  const people = useOperationsPeople();
  const matches = operationsBundleMatchesTenant(source.plans, source.allItems, tenantId);
  const planningAvailable = matches && !source.error && !source.forbidden;
  const plans = planningAvailable ? source.plans : [];
  const items = planningAvailable ? source.allItems : [];
  const rememberInvoker = () => {
    if (inspection?.view !== destination && document.activeElement instanceof HTMLElement) inspectionInvoker.current = document.activeElement;
  };
  const inspectItem = (item: PlanItem) => { rememberInvoker(); setInspection({ kind: "item", id: item.id, view: destination }); };
  const inspectPlan = (plan: Plan) => { rememberInvoker(); setInspection({ kind: "plan", id: plan.id, view: destination }); };
  const inspectCrm = (task:CrmWorkRecord) => {rememberInvoker();setCrmReview(null);setCrmFeedback("");setInspection({kind:"crm",id:task.id,record:task,view:destination});};
  const proposeCrm = (task:CrmWorkRecord,stage:PlanItemStatus,invoker:HTMLButtonElement|null) => {
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
  const selectedItem = inspection?.view === destination && inspection.kind === "item" ? items.find((item) => item.id === inspection.id) : null;
  const selectedPlan = inspection?.view === destination && inspection.kind === "plan" ? plans.find((plan) => plan.id === inspection.id) : null;
  const selectedCrm = inspection?.view === destination && (inspection.kind === "crm" || inspection.kind === "crm_recovery") && !crm.error && !crm.forbidden
    ? crm.tasks.find(task=>task.id===inspection.id) ?? (crm.loading&&inspection.kind==="crm"?inspection.record:null) : null;
  const workReadable = (!source.loading && planningAvailable) || (!crm.loading && !crm.error && !crm.forbidden);
  const workView = <>
    {people.error && <div className="ops-inline-notice" role="status">Work is available, but team names and photos couldn’t be loaded. <button type="button" onClick={()=>void people.refresh()}>Retry profiles</button></div>}
    {(source.error || source.forbidden || !matches) && <div className="ops-inline-notice" role="status">Planning work is unavailable in this workspace. <button type="button" onClick={()=>void source.refresh()}>Retry planning work</button></div>}
    {source.loading && <p role="status">Reading Planning work…</p>}
    {crm.loading && <p role="status">Reading CRM tasks…</p>}
    {crm.error && <div className="ops-inline-notice" role="status">{crm.error} <button type="button" onClick={()=>void crm.refresh()}>Retry CRM tasks</button></div>}
    {workReadable ? <OperationsWork {...props} crmTasks={crm.tasks} onInspectCrmTask={inspectCrm} onProposeCrmStage={proposeCrm}
      onProposeStage={(item,proposedStage,invoker)=>{
        if(invoker?.isConnected)inspectionInvoker.current=invoker;else rememberInvoker();
        setInspection({kind:"item",id:item.id,view:destination,proposedStage});
      }} /> : source.loading || crm.loading ? <OperationsLoading /> : <div className="ops-state" role="alert"><h1>Current work isn’t available</h1><p>Retry a source above or ask your workspace owner to review access.</p></div>}
    <p className="ops-source-limit">This view combines the Planning work and CRM tasks loaded here. Planning uses a 200-plan read with its visible work; CRM returns up to 200 tasks. Unavailable sources are excluded.{crm.hasMore&&" More CRM tasks exist beyond this read."}</p>
  </>;
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
        {destination === "Work" && pendingCrmRecovery && !crmReview && <button type="button" onClick={event=>{
          inspectionInvoker.current=event.currentTarget;setCrmFeedback("");
          setInspection({kind:"crm_recovery",id:pendingCrmRecovery.taskId,view:destination});setCrmReview(pendingCrmRecovery);
        }}>Recover pending task change</button>}
        {destination === "Work" && <button type="button" disabled={source.loading || source.forbidden || Boolean(source.error) || !matches || people.loading || Boolean(people.error)} onClick={event => { creationInvoker.current = event.currentTarget; setCreatingWork(true); }}>New task</button>}
        {destination === "Projects" && <button type="button" disabled={source.loading || source.forbidden || Boolean(source.error) || !matches || people.loading || Boolean(people.error)} onClick={event => { projectCreationInvoker.current = event.currentTarget; setCreatingProject({}); }}>New project</button>}
        {isPlanning && <button type="button" aria-label="Refresh work and team profiles"
          disabled={source.loading || people.loading || (destination === "Work" && crm.loading)} onClick={() => { void source.refresh(); void people.refresh(); if(destination === "Work")void crm.refresh(); }}><RefreshCw size={16} /></button>}
        {openPaige && <button type="button" onClick={reviewWithPaige}><Sparkles size={16} aria-hidden="true" />Review with PAIGE</button>}
      </div>
    </header>
    <div className="ops-department-body">
      {destination === "Delivery" ? <OperationsDelivery openPaige={openPaige} />
        : destination === "Playbooks" ? <OperationsPlaybooks tenantId={tenantId} />
        : destination === "Work" ? workView
        : source.loading ? <OperationsLoading />
        : source.forbidden ? <div className="ops-state" role="status"><h1>This work isn’t available to your role</h1><p>Ask your workspace owner to review your access.</p></div>
        : source.error || !matches ? <div className="ops-state" role="alert"><h1>Your work couldn’t be loaded</h1><p>Refresh to read the current workspace again.</p><button type="button" onClick={() => void source.refresh()}>Try again</button></div>
        : <>
          {people.error && <div className="ops-inline-notice" role="status">Work is available, but team names and photos couldn’t be loaded. <button type="button" onClick={() => void people.refresh()}>Retry profiles</button></div>}
          {destination === "Overview" && <OperationsOverview {...props} />}
          {destination === "Projects" && <OperationsProjects {...props} />}
          {destination === "Capacity" && <OperationsCapacity {...props} />}
          <p className="ops-source-limit">Figures reflect the work loaded here: up to 200 plans and standalone items, with their visible work. {people.partial && "Some team profiles are outside the current read."}</p>
        </>}
    </div>
    <Sheet open={inspection?.view === destination} onOpenChange={(open) => { if (!open) {setInspection(null);closeCrmReview();} }}>
      <SheetContent className="ops-detail-sheet paige-solo" data-pg={portalTheme} data-theme={portalTheme} onCloseAutoFocus={(event) => {
        if (inspectionInvoker.current?.isConnected) { event.preventDefault(); inspectionInvoker.current.focus(); }
        else {
          const workKey = inspectionInvoker.current?.dataset.workKey;
          const replacement = workKey ? Array.from(contentRef.current?.querySelectorAll<HTMLElement>("[data-work-key]") ?? []).find(element=>element.dataset.workKey===workKey) : null;
          if(replacement){event.preventDefault();replacement.focus();}
        }
      }}>
        <SheetHeader><SheetTitle>{selectedItem?.title ?? selectedPlan?.title ?? selectedCrm?.title ?? (inspection?.kind === "crm_recovery" ? "Recover the task change" : source.error || !matches ? "Work couldn’t be loaded" : "Work is not available in this view")}</SheetTitle>
          <SheetDescription>{selectedItem?.summary ?? selectedPlan?.summary ?? selectedCrm?.description ?? "Details from your current workspace."}</SheetDescription></SheetHeader>
        {!selectedItem && !selectedPlan && !selectedCrm && inspection && <p>{inspection.kind === "crm_recovery" ? "The earlier task’s current details are unavailable. This recovery applies only to its original proposed change." : "This task has not been verified here. Refresh current work before creating it again."}</p>}
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
        </div>}
        {crmReview && <OperationsCrmStageReview key={`${tenantId}:${crmReview.key}`} operation={crmReview} refresh={crm.refresh}
          onClose={closeCrmReview} onVerified={taskId=>{setCrmReview(null);setPendingCrmRecovery(null);
            setInspection({kind:"crm_recovery",id:taskId,view:destination});setCrmFeedback("This task’s stage is saved and confirmed in current CRM work.");}} />}
        {selectedItem && <div className="ops-detail-content">
          <dl><div><dt>Responsible person</dt><dd>{selectedItem.assigned_to_user_id && !member ? "Member unavailable" : <OperationsAssignee member={member} />}</dd></div>
            <div><dt>Status</dt><dd>{selectedItem.status.replace(/_/g, " ")}</dd></div>
            <div><dt>Priority</dt><dd>{selectedItem.priority}</dd></div>
            <div><dt>Due date</dt><dd>{selectedItem.due_at ? new Date(selectedItem.due_at).toLocaleString() : "Not scheduled"}</dd></div>
            <div><dt>Project</dt><dd>{plans.find((plan) => plan.id === selectedItem.plan_id)?.title ?? "Standalone work"}</dd></div>
            <div><dt>Work type</dt><dd>{selectedItem.item_type}</dd></div></dl>
          {selectedItem.status === "done" && <p>Recorded as completed work. Client delivery acceptance is a separate outcome.</p>}
          {selectedItem.linked_action_id && <p>A linked action exists. Its execution result has not been verified here.</p>}
          <OperationsWorkEditor key={`${selectedItem.id}:${inspection?.kind === "item" ? inspection.proposedStage ?? "inspect" : "inspect"}`} item={selectedItem} actorId={userId} tenantId={tenantId}
            proposedStage={inspection?.kind === "item" ? inspection.proposedStage : undefined}
            members={people.members} sourceError={Boolean(source.error) || !matches}
            refresh={() => source.refresh({ silent: true })} />
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


