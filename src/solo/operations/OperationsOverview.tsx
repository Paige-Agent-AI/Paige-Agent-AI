import { ArrowUpRight, CirclePause, CalendarClock, Check, Circle, ArrowRight } from "lucide-react";
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "../team-workspace-contract";
import { OperationsAssignee } from "./OperationsAssignee";
import { byDueDate, workStatusLabel } from "./operations-presentation";
import "./operations-views.css";

export interface OperationsOverviewProps {
  plans: Plan[]; items: PlanItem[]; members: TeamMemberRecord[];
  onInspectItem: (item: PlanItem) => void; onInspectPlan: (plan: Plan) => void;
}
const active = (item: PlanItem) => item.status !== "done" && item.status !== "cancelled";
const overdue = (item: PlanItem) => active(item) && Boolean(item.due_at && new Date(item.due_at).getTime() < Date.now());
const dateLabel = (date: string | null) => date && !Number.isNaN(new Date(date).getTime()) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(date)) : "No due date";

export function OperationsOverview({ plans, items, members, onInspectItem, onInspectPlan }: OperationsOverviewProps) {
  const people = new Map(members.map(member => [member.user_id, member]));
  const priority = { urgent: 4, high: 3, normal: 2, low: 1 };
  const attention = items.filter(item => item.status === "blocked" || overdue(item)).sort((a, b) => priority[b.priority] - priority[a.priority] || Number(b.status === "blocked") - Number(a.status === "blocked") || byDueDate(a, b));
  const spotlight = attention[0];
  const next = items.filter(item => active(item) && item.due_at && !overdue(item)).sort((a, b) => a.due_at!.localeCompare(b.due_at!)).slice(0, 5);
  const person = (item: PlanItem) => item.assigned_to_user_id && !people.has(item.assigned_to_user_id) ? <span className="ops-view-muted">Member unavailable</span> : <OperationsAssignee member={people.get(item.assigned_to_user_id ?? "")} />;
  return <section className="ops-views" aria-label="Overview"><header className="ops-view-heading"><div><h1>Keep the promises moving</h1><p>Progress, people and the next decisions in one place.</p></div></header>
    {spotlight && <article className="ops-decision-spotlight"><div><div className="ops-overview-alert-label">{spotlight.status === "blocked" ? <CirclePause size={20} aria-hidden="true" /> : <CalendarClock size={20} aria-hidden="true" />}{spotlight.status === "blocked" ? "Blocked" : "Overdue"} · {dateLabel(spotlight.due_at)}</div><h2>{spotlight.title}</h2>{spotlight.summary && <p>{spotlight.summary}</p>}<div className="ops-decision-owner">{person(spotlight)}</div></div><button type="button" className="ops-decision-action" onClick={() => onInspectItem(spotlight)}>Inspect work<ArrowUpRight size={18} aria-hidden="true" /></button></article>}
    <div className="ops-overview-desk"><div><h2 className="ops-view-section-title">Projects in motion</h2>{plans.length ? <div className="ops-overview-projects">{plans.map(plan => {
      const milestone = plan.items.filter(item => item.item_type === "milestone" && item.status !== "cancelled").sort(byDueDate);
      const current = milestone.find(item => item.status === "blocked") ?? [...milestone].filter(active).sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"))[0];
      const done = plan.items.filter(item => item.status === "done").length;
      const total = plan.items.filter(item => item.status !== "cancelled").length;
      return <article className="ops-overview-project" key={plan.id}><header><button className="ops-view-text-action" type="button" onClick={() => onInspectPlan(plan)}>{plan.title}<ArrowUpRight size={16} aria-hidden="true" /></button><span className="ops-view-muted">{done}/{total} items complete</span></header><div className="ops-overview-path" aria-label={`${milestone.filter(item => item.status === "done").length} of ${milestone.length} milestones complete`}>{milestone.length ? milestone.map(item => <button key={item.id} type="button" onClick={() => onInspectItem(item)} data-status={item.status} aria-label={`${item.title}, ${workStatusLabel(item.status)}, ${dateLabel(item.due_at)}`}><span>{item.status === "done" ? <Check size={13} aria-hidden="true" /> : item.status === "blocked" ? <CirclePause size={13} aria-hidden="true" /> : item.id === current?.id ? <ArrowRight size={13} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}</span><strong>{item.title}</strong><small>{dateLabel(item.due_at)} · {workStatusLabel(item.status)}</small></button>) : <p className="ops-view-muted">No milestones recorded</p>}</div>{current && <footer><span className="ops-view-muted">Next milestone</span><button type="button" className="ops-view-text-action" onClick={() => onInspectItem(current)}>{current.title}</button>{person(current)}</footer>}</article>;
    })}</div> : <div className="ops-view-empty"><h2>Give the work a shared direction</h2><p>Your current plans and milestones will appear here as the team begins recording work.</p></div>}</div>
    <aside className="ops-overview-attention"><h2 className="ops-view-section-title">Needs attention</h2>{attention.length > 1 ? attention.slice(1, 7).map(item => <article key={item.id}><div className="ops-overview-alert-label">{item.status === "blocked" ? <CirclePause size={16} aria-hidden="true" /> : <CalendarClock size={16} aria-hidden="true" />}{item.status === "blocked" ? "Blocked" : "Overdue"} · {dateLabel(item.due_at)}</div><button type="button" className="ops-view-text-action" onClick={() => onInspectItem(item)}>{item.title}</button>{person(item)}</article>) : <p className="ops-view-muted">{spotlight ? "No other blocked or overdue work in the items shown." : "No blocked or overdue work in the items shown."}</p>}</aside></div>
    <section className="ops-overview-next"><h2 className="ops-view-section-title">Coming up</h2>{next.length ? <div className="ops-overview-next-strip">{next.map(item => <article key={item.id}><small>{dateLabel(item.due_at)}</small><button type="button" className="ops-view-text-action" onClick={() => onInspectItem(item)}>{item.title}</button>{person(item)}</article>)}</div> : <p className="ops-view-muted">No upcoming due dates in the work shown.</p>}</section>
  </section>;
}
