import { Check, Flag, CirclePause } from "lucide-react";
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "../team-workspace-contract";
import { OperationsAssignee } from "./OperationsAssignee";
import { workStatusLabel, byDueDate } from "./operations-presentation";
import "./operations-views.css";

export interface OperationsProjectsProps {
  plans: Plan[];
  items?: PlanItem[];
  members: TeamMemberRecord[];
  onInspectItem: (item: PlanItem) => void;
  onInspectPlan: (plan: Plan) => void;
}
const projectDate = (value: string | null) => value && !Number.isNaN(new Date(value).getTime()) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "Not scheduled";

export function OperationsProjects({ plans, members, onInspectItem, onInspectPlan }: OperationsProjectsProps) {
  const people = new Map(members.map(member => [member.user_id, member]));
  return <section className="ops-views" aria-label="Projects"><header className="ops-view-heading"><div><h1>Every project, a clear next step</h1><p>Follow the milestones, the owners and the work still ahead.</p></div><span className="ops-view-muted">{plans.length} plans shown</span></header>
    {!plans.length ? <div className="ops-view-empty"><Flag size={32} aria-hidden="true" /><h2>A shared path from start to finish</h2><p>Your plans will appear here with their milestones and assigned work.</p></div> : <div className="ops-project-landscape">{plans.map(plan => {
      const eligible = plan.items.filter(item => item.status !== "cancelled");
      const completed = eligible.filter(item => item.status === "done").length;
      const blocked = eligible.filter(item => item.status === "blocked");
      const overdue = eligible.filter(item => item.due_at && item.status !== "done" && new Date(item.due_at).getTime() < Date.now());
      const milestones = plan.items.filter(item => item.item_type === "milestone").sort(byDueDate);
      return <article className="ops-project-track" key={plan.id}><header><div className="ops-project-title"><button type="button" className="ops-view-text-action" onClick={() => onInspectPlan(plan)}>{plan.title}</button>{plan.summary && <p>{plan.summary}</p>}</div><span className="ops-view-status" data-status={blocked.length ? "blocked" : overdue.length ? "overdue" : plan.status}>{blocked.length ? "Blocked work" : overdue.length ? "Overdue work" : workStatusLabel(plan.status)}</span></header>
        <div className="ops-project-readback">{plan.owner_user_id && !people.has(plan.owner_user_id) ? <span>Member unavailable</span> : <OperationsAssignee member={people.get(plan.owner_user_id ?? "")} />}<span>{projectDate(plan.starts_on)} — {projectDate(plan.ends_on)}</span><span>{completed} of {eligible.length} items completed</span></div>
        <div className="ops-project-progress" role="progressbar" aria-label={`${plan.title}: recorded work completion`} aria-valuemin={0} aria-valuemax={eligible.length || 1} aria-valuenow={completed} aria-valuetext={`${completed} of ${eligible.length} recorded items completed`}><span style={{ width: `${eligible.length ? completed / eligible.length * 100 : 0}%` }} /></div>
        {milestones.length ? <ol className="ops-project-milestones">{milestones.map(item => <li key={item.id} data-status={item.status}><button type="button" onClick={() => onInspectItem(item)}><span className="ops-milestone-node">{item.status === "done" ? <Check size={15} aria-hidden="true" /> : item.status === "blocked" ? <CirclePause size={15} aria-hidden="true" /> : <Flag size={14} aria-hidden="true" />}</span><strong>{item.title}</strong><small>{projectDate(item.due_at)} · {workStatusLabel(item.status)}</small></button></li>)}</ol> : <p className="ops-view-muted ops-project-no-milestones">No milestones recorded yet.</p>}
        {(blocked.length > 0 || overdue.length > 0) && <footer className="ops-project-attention">{blocked.length > 0 && <span>{blocked.length} blocked {blocked.length === 1 ? "item" : "items"}</span>}{overdue.length > 0 && <span>{overdue.length} overdue {overdue.length === 1 ? "item" : "items"}</span>}<button type="button" className="ops-view-text-action" onClick={() => onInspectPlan(plan)}>Inspect project</button></footer>}
      </article>;
    })}</div>}
    <p className="ops-view-footnote">Progress reflects recorded tasks and milestones. Delivery review and client acceptance are separate.</p>
  </section>;
}
