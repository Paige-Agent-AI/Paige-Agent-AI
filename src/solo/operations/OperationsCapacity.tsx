import { Users } from "lucide-react";
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "../team-workspace-contract";
import { OperationsAssignee } from "./OperationsAssignee";
import { workStatusLabel } from "./operations-presentation";
import "./operations-views.css";

export interface OperationsCapacityProps {
  plans?: Plan[]; items: PlanItem[]; members: TeamMemberRecord[];
  onInspectItem: (item: PlanItem) => void; onInspectPlan?: (plan: Plan) => void;
}
export function OperationsCapacity({ items, members, onInspectItem }: OperationsCapacityProps) {
  const active = items.filter(item => !["done", "cancelled"].includes(item.status));
  const memberIds = new Set(members.map(member => member.user_id));
  const unresolved = active.filter(item => !item.assigned_to_user_id || !memberIds.has(item.assigned_to_user_id));
  return <section className="ops-views" aria-label="Capacity"><header className="ops-view-heading"><div><h1>The people behind the progress</h1><p>See who owns the work before deciding where the next assignment belongs.</p></div></header>
    <div className="ops-capacity-key"><span><i data-status="in_progress" />In progress</span><span><i data-status="open" />Ready</span><span><i data-status="blocked" />Blocked</span><span className="ops-view-muted">Each block is one shown assignment; size does not represent effort.</span></div>
    {members.length ? <div className="ops-capacity-landscape">{members.map(member => {
      const assignments = active.filter(item => item.assigned_to_user_id === member.user_id);
      const blocked = assignments.filter(item => item.status === "blocked").length;
      return <article className="ops-capacity-person" key={member.membership_id}><div className="ops-capacity-identity"><OperationsAssignee member={member} /><p>{member.job_title ?? "Role not provided"}</p><span className="ops-view-muted">{assignments.length} shown assignments{blocked ? ` · ${blocked} blocked` : ""}</span></div><div className="ops-capacity-work"><div className="ops-capacity-blocks">{assignments.length ? assignments.map(item => <button type="button" key={item.id} data-status={item.status} onClick={() => onInspectItem(item)}><span>{item.title}</span><small>{workStatusLabel(item.status)}</small></button>) : <p className="ops-view-muted">No active assignments in the work shown.</p>}</div><p className="ops-capacity-availability">Availability unknown · working hours and effort are not recorded.</p></div></article>;
    })}</div> : <div className="ops-view-empty"><Users size={32} aria-hidden="true" /><h2>Make the people visible</h2><p>Current-workspace Team members will appear here with their profile photos and assigned work.</p></div>}
    {unresolved.length > 0 && <section className="ops-capacity-unresolved"><h2 className="ops-view-section-title">Ownership to resolve</h2><p className="ops-view-muted">Some work is unassigned or its member is unavailable in this roster.</p><div>{unresolved.map(item => <button key={item.id} className="ops-view-text-action" type="button" onClick={() => onInspectItem(item)}>{item.title}<small>{item.assigned_to_user_id ? "Member unavailable" : "Unassigned"}</small></button>)}</div></section>}
  </section>;
}
