import { Users } from "lucide-react";
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "../team-workspace-contract";
import { OperationsAssignee } from "./OperationsAssignee";
import { workDateLabel, workStatusLabel } from "./operations-presentation";
import { nativeWorkStage, presentNativeWork, summarizeNativeWorkload, type CrmWorkRecord, type NativeOperationsWork } from "./operations-native-work";
import { overviewNativeWork } from "./operations-overview-work";
import "./operations-views.css";

export interface OperationsCapacityProps {
  plans?: Plan[]; items: PlanItem[]; members: TeamMemberRecord[];
  onInspectItem: (item: PlanItem) => void; onInspectPlan?: (plan: Plan) => void;
  tenantId: string; crmTasks?: CrmWorkRecord[]; onInspectCrmTask?: (task: CrmWorkRecord) => void;
}
export function OperationsCapacity({ items, members, onInspectItem, tenantId, crmTasks = [], onInspectCrmTask }: OperationsCapacityProps) {
  const review = overviewNativeWork(tenantId,items,crmTasks);
  const work = review.active.map(item => item.native);
  const overdue = new Set(review.overdue.map(item => item.id));
  const undated = new Set(review.timingToConfirm.map(item => item.id));
  const memberIds = new Set(members.map(member => member.user_id));
  const unresolved = work.filter(item => {const owner=presentNativeWork(item).assigned_to_user_id;return !owner || !memberIds.has(owner);});
  const inspect = (item:NativeOperationsWork) => item.source === "planning" ? onInspectItem(item.record) : onInspectCrmTask?.(item.record);
  const deadline = (item: NativeOperationsWork) => {
    const row = presentNativeWork(item);
    const date = workDateLabel(row);
    if (row.item_type === "reminder") return `Reminder · ${date}`;
    if (overdue.has(item.key)) return `Overdue · ${date}`;
    return undated.has(item.key) ? date : `Due ${date}`;
  };
  return <section className="ops-views" aria-label="Capacity"><header className="ops-view-heading"><div><h1>The people behind the progress</h1><p>See overdue commitments, missing deadlines and the people responsible before assigning more work.</p></div></header>
    <div className="ops-capacity-key"><span><i data-status="in_progress" />In progress</span><span><i data-status="open" />Ready</span><span><i data-status="blocked" />Blocked</span><span className="ops-view-muted">Each block is one shown assignment; size does not represent effort.</span></div>
    {members.length ? <div className="ops-capacity-landscape">{members.map(member => {
      const {assignments,blockedCount,recordedMinutes,unknownEffortCount} = summarizeNativeWorkload(work,member.user_id);
      const overdueCount = assignments.filter(item => overdue.has(item.key)).length;
      const undatedCount = assignments.filter(item => undated.has(item.key)).length;
      return <article className="ops-capacity-person" key={member.membership_id}>
        <div className="ops-capacity-identity"><OperationsAssignee member={member} /><p>{member.job_title ?? "Role not provided"}</p>
          <span className="ops-view-muted">{assignments.length} shown assignment{assignments.length === 1 ? "" : "s"}{blockedCount ? ` · ${blockedCount} blocked` : ""}{overdueCount ? ` · ${overdueCount} overdue` : ""}{undatedCount ? ` · ${undatedCount} ${undatedCount === 1 ? "needs" : "need"} a due date` : ""}</span>
        </div>
        <div className="ops-capacity-work"><div className="ops-capacity-blocks">{assignments.length ? assignments.map(item =>
          <button type="button" key={item.key} data-status={nativeWorkStage(item)} disabled={item.source === "crm" && !onInspectCrmTask} onClick={() => inspect(item)}>
            <span>{item.record.title}</span><small>{deadline(item)}</small>
            <small>{workStatusLabel(nativeWorkStage(item))}{item.source === "crm" && item.record.estimated_minutes !== null ? ` · ${item.record.estimated_minutes} min estimated` : ""}</small>
          </button>) : <p className="ops-view-muted">No active assignments in the work shown.</p>}</div>
          <p className="ops-capacity-availability">{recordedMinutes === null ? "Effort not recorded." : `${recordedMinutes} minutes of recorded estimated effort.`}{unknownEffortCount > 0 && ` ${unknownEffortCount} assignment${unknownEffortCount === 1 ? "" : "s"} ${unknownEffortCount === 1 ? "has" : "have"} unknown effort.`} Availability unknown · confirmed working hours are not recorded.</p>
        </div>
      </article>;
    })}</div> : <div className="ops-view-empty"><Users size={32} aria-hidden="true" /><h2>Make the people visible</h2><p>Current-workspace Team members will appear here with their profile photos and assigned work.</p></div>}
    {unresolved.length > 0 && <section className="ops-capacity-unresolved"><h2 className="ops-view-section-title">Ownership to resolve</h2><p className="ops-view-muted">Some work is unassigned or its member is unavailable in this roster.</p><div>{unresolved.map(item => <button key={item.key} className="ops-view-text-action" type="button" disabled={item.source === "crm" && !onInspectCrmTask} onClick={() => inspect(item)}>{item.record.title}<small>{presentNativeWork(item).assigned_to_user_id ? "Member unavailable" : "Unassigned"} · {deadline(item)}</small></button>)}</div></section>}
  </section>;
}
