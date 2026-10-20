import { ArrowRight, ArrowUpRight, CalendarClock, CirclePause, Sparkles } from "lucide-react";
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "../team-workspace-contract";
import { OperationsAssignee } from "./OperationsAssignee";
import { workDateLabel, workStatusLabel } from "./operations-presentation";
import { overviewNativeWork } from "./operations-overview-work";
import type { CrmWorkRecord, NativeOperationsWork } from "./operations-native-work";
import "./operations-views.css";
import "./operations-overview.css";

type Destination = "Work" | "Projects" | "Delivery" | "Playbooks" | "Capacity";
export interface OperationsOverviewProps {
  tenantId: string; plans: Plan[]; items: PlanItem[]; members: TeamMemberRecord[];
  crmTasks?: CrmWorkRecord[]; onInspectCrmTask?: (task: CrmWorkRecord) => void;
  onInspectItem: (item: PlanItem) => void; onInspectPlan: (plan: Plan) => void;
  onNavigate?: (destination: Destination) => void;
  onReviewWithPaige?: () => void;
  onReviewWorkWithPaige?: (work: NativeOperationsWork) => void;
}

export function OperationsOverview({ tenantId, plans, items, members, crmTasks = [], onInspectCrmTask,
  onInspectItem, onInspectPlan, onNavigate, onReviewWithPaige, onReviewWorkWithPaige }: OperationsOverviewProps) {
  const people = new Map(members.map(member => [member.user_id, member]));
  const projects = new Map(plans.map(plan => [plan.id, plan]));
  const work = overviewNativeWork(tenantId, items, crmTasks);
  const spotlight = work.attention[0];
  const operating = work.active.filter(item => item.item_type !== "reminder" && item.id !== spotlight?.id);
  const timing = work.timingToConfirm[0];
  const inspect = (item: typeof work.active[number]) => item.native.source === "planning"
    ? onInspectItem(item.native.record) : onInspectCrmTask?.(item.native.record);
  const canInspect = (item: typeof work.active[number]) => item.native.source === "planning" || Boolean(onInspectCrmTask);
  const owner = (item: typeof work.active[number]) => item.assigned_to_user_id && !people.has(item.assigned_to_user_id)
    ? <span className="ops-view-muted">Member unavailable</span>
    : <OperationsAssignee member={people.get(item.assigned_to_user_id ?? "")} />;
  const context = (item: typeof work.active[number]) => item.native.source === "crm"
    ? item.native.record.deal_id ? "Opportunity-linked CRM task" : "CRM task"
    : item.plan_id && projects.has(item.plan_id) ? projects.get(item.plan_id)!.title : item.item_type === "reminder" ? "Planning reminder" : "Planning work";
  const rows = (values: typeof work.active) => <ul className="ops-desk-work-list">{values.map(item => <li key={item.id}>
    <div className="ops-desk-work-main"><button type="button" className="ops-view-text-action" disabled={!canInspect(item)} onClick={() => inspect(item)}>{item.title}</button>
      <div className="ops-desk-work-context"><span>{context(item)}</span><span>{workDateLabel(item)}</span></div>
      <div className="ops-desk-work-owner">{owner(item)}</div></div>
    <span className="ops-view-status" data-status={item.status}>{workStatusLabel(item.status)}</span>
  </li>)}</ul>;
  const navigate = (label: string, destination: Destination) => onNavigate && <button type="button" className="ops-view-text-action" onClick={() => onNavigate(destination)}>{label}<ArrowRight size={15} aria-hidden="true" /></button>;

  return <section className="ops-views ops-operating-desk" aria-label="Overview">
    <header className="ops-desk-heading"><div><h1>Your operating week</h1><p>Current commitments, responsible people and the next decisions.</p></div>
      {onReviewWithPaige && <button type="button" className="ops-desk-primary" onClick={onReviewWithPaige}><Sparkles size={16} aria-hidden="true" />Plan with PAIGE</button>}
    </header>
    {work.active.length > 0 && <p className="ops-desk-read-scope">{work.active.length} active {work.active.length === 1 ? "commitment" : "commitments"} · {work.inProgress.length} in progress · {work.reminders.length} {work.reminders.length === 1 ? "reminder" : "reminders"} in the sources shown</p>}
    {!work.active.length && !plans.length ? <section className="ops-desk-first-use"><h2>Start with one real commitment</h2>
      <p>What needs to happen next, who should own it, and when does it matter? Prepare it with PAIGE or open Work to record the next step.</p>
      <div>{navigate("Open Work", "Work")}{navigate("Plan a project", "Projects")}</div>
      <p className="ops-view-muted">Only work available in the current sources appears here.</p>
    </section> : <div className="ops-desk-columns"><div className="ops-desk-primary-column">
      {spotlight ? <section className="ops-desk-attention" aria-label="Priority work to inspect"><header>
        <h2>{spotlight.status === "blocked" ? <CirclePause size={17} aria-hidden="true" /> : <CalendarClock size={17} aria-hidden="true" />}Needs your attention</h2>
        <span className="ops-view-status" data-status="blocked">{spotlight.status === "blocked" ? "Blocked" : "Overdue"}</span></header>
        <h3>{spotlight.title}</h3>{spotlight.summary && <p>{spotlight.summary}</p>}
        <div className="ops-desk-work-context"><span>{context(spotlight)}</span><span>{workDateLabel(spotlight)}</span></div>
        <div className="ops-desk-work-owner">{owner(spotlight)}</div>
        <button type="button" className="ops-desk-inspect" disabled={!canInspect(spotlight)} onClick={() => inspect(spotlight)}>Inspect the original work<ArrowUpRight size={16} aria-hidden="true" /></button>
        {work.attention.length > 1 && <p className="ops-view-muted">{work.attention.length - 1} other blocked or overdue {work.attention.length === 2 ? "commitment" : "commitments"} in the work shown.</p>}
      </section> : <p className="ops-desk-attention-clear">No blocked or overdue work in the sources shown. Undated work and recorded reminders are included below.</p>}
      <section><div className="ops-desk-section-heading"><h2>Work in motion</h2>{navigate("All work", "Work")}</div>
        {operating.length ? rows(operating.slice(0, 6)) : <p className="ops-view-muted">{spotlight ? "The priority commitment is shown above." : "No other active tasks or milestones in the sources shown."}</p>}
        {operating.length > 6 && <p className="ops-view-muted">Showing 6 of {operating.length} other active items. Open Work to inspect the rest.</p>}
      </section>
      {plans.length > 0 && <section className="ops-desk-projects"><div className="ops-desk-section-heading"><h2>Projects and milestones</h2>{navigate("All projects", "Projects")}</div>
        <ul className="ops-desk-project-list">{plans.slice(0, 3).map(plan => <li key={plan.id}><button type="button" className="ops-view-text-action" onClick={() => onInspectPlan(plan)}>{plan.title}<ArrowUpRight size={15} aria-hidden="true" /></button>
          <span className="ops-view-muted">{plan.items.filter(item => item.status === "done").length} of {plan.items.filter(item => item.status !== "cancelled").length} recorded items completed</span></li>)}</ul>
      </section>}
      {onNavigate && <nav className="ops-desk-connections" aria-label="Connected Operations work">{navigate("Client promises", "Delivery")}{navigate("People and workload", "Capacity")}{navigate("Procedures", "Playbooks")}</nav>}
    </div><aside className="ops-desk-next-column">
      <section className="ops-desk-commitments"><h2>Next deadlines</h2>{work.upcoming.length ? rows(work.upcoming) : <p className="ops-view-muted">No upcoming task deadlines in the work shown.</p>}</section>
      {work.reminders.length > 0 && <section className="ops-desk-reminders"><div className="ops-desk-section-heading"><h2>Recorded reminders</h2>{navigate("Inspect in Work", "Work")}</div>{rows(work.reminders.slice(0, 4))}
        <p className="ops-desk-note">These are saved reminder times. Open the original record to review its current state; a scheduled time does not prove delivery.</p>
        {work.reminders.length > 4 && <p className="ops-view-muted">Showing 4 of {work.reminders.length} recorded reminders.</p>}
      </section>}
      <section className="ops-desk-next-action"><h2>What to do next</h2>{timing ? <>
        <p>{work.timingToConfirm.length} active {work.timingToConfirm.length === 1 ? "commitment needs" : "commitments need"} a confirmed due date. Start with the original work before choosing when it belongs.</p>
        <button type="button" className="ops-desk-inspect" disabled={!canInspect(timing)} onClick={() => inspect(timing)}>Review timing: {timing.title}<ArrowUpRight size={15} aria-hidden="true" /></button>
        {onReviewWorkWithPaige && <button type="button" className="ops-view-text-action" onClick={() => onReviewWorkWithPaige(timing.native)}>Prepare a review with PAIGE</button>}
      </> : <p className="ops-view-muted">Review the current commitments with PAIGE before preparing changes. Missing business context and unavailable sources still need checking.</p>}</section>
    </aside></div>}
  </section>;
}
