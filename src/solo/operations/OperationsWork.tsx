import { useMemo, useRef, useState } from "react";
import { ArrowRight, Circle, CircleCheck, CirclePause, Search } from "lucide-react";
import type { Plan, PlanItem, PlanItemStatus } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "../team-workspace-contract";
import { OperationsAssignee } from "./OperationsAssignee";
import { workStatusLabel, workStages as stages, byDueDate } from "./operations-presentation";
import "./operations-views.css";

export interface OperationsWorkProps {
  plans: Plan[];
  items: PlanItem[];
  members: TeamMemberRecord[];
  onInspectItem: (item: PlanItem) => void;
  onInspectPlan?: (plan: Plan) => void;
  onProposeStage?: (item: PlanItem, status: PlanItemStatus, invoker: HTMLButtonElement | null) => void;
}

const unfinished = (item: PlanItem) => !["done", "cancelled"].includes(item.status);
const isOverdue = (item: PlanItem) => Boolean(item.due_at && unfinished(item) && new Date(item.due_at).getTime() < Date.now());
const dueLabel = (value: string | null) => value && !Number.isNaN(new Date(value).getTime())
  ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value)) : "No due date";

export function OperationsWork({ plans, items, members, onInspectItem, onProposeStage }: OperationsWorkProps) {
  const draggedId = useRef<string | null>(null);
  const draggedInvoker = useRef<HTMLButtonElement | null>(null);
  const [dropStage, setDropStage] = useState<PlanItemStatus | null>(null);
  const proposeDrop = (status: PlanItemStatus) => {
    const item = items.find(value => value.id === draggedId.current);
    const invoker = draggedInvoker.current;
    draggedInvoker.current = null;
    draggedId.current = null; setDropStage(null);
    // Resolve from the current scoped read, never from a browser/external payload.
    if (item && item.status !== status && status !== "cancelled") onProposeStage?.(item, status, invoker);
  };
  const [view, setView] = useState("Board");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const people = useMemo(() => new Map(members.map(member => [member.user_id, member])), [members]);
  const projects = useMemo(() => new Map(plans.map(plan => [plan.id, plan.title])), [plans]);
  const visible = items.filter(item => {
    const owner = people.get(item.assigned_to_user_id ?? "");
    const text = [item.title, item.summary, projects.get(item.plan_id ?? ""), owner?.full_name].filter(Boolean).join(" ").toLocaleLowerCase();
    return text.includes(query.toLocaleLowerCase()) && (filter === "all" || (filter === "active" ? unfinished(item) : filter === "overdue" ? isOverdue(item) : item.status === filter));
  });
  const owner = (item: PlanItem) => item.assigned_to_user_id
    ? people.has(item.assigned_to_user_id) ? <OperationsAssignee member={people.get(item.assigned_to_user_id)} /> : <span className="ops-view-muted">Member unavailable</span>
    : <span className="ops-view-muted">Unassigned</span>;
  const date = (item: PlanItem) => <span className={isOverdue(item) ? "ops-view-overdue" : "ops-view-muted"}>{isOverdue(item) ? "Overdue · " : ""}{dueLabel(item.due_at)}</span>;
  const dated = visible.filter(item => item.due_at && Number.isFinite(new Date(item.due_at).getTime())).sort(byDueDate);
  const undated = visible.filter(item => !dated.includes(item));
  const day = 86400000;
  const earliest = dated.length ? new Date(dated[0].due_at!).getTime() : Date.now();
  const latest = dated.length ? new Date(dated[dated.length - 1].due_at!).getTime() : earliest;
  const rangeStart = earliest - day;
  const rangeEnd = Math.max(latest + day, rangeStart + 4 * day);
  const timeline = <div className="ops-work-timeline">
    {dated.length > 0 && <><p className="ops-timeline-guide">Due dates across time. Each marker is a deadline.</p><div className="ops-timeline-scroll" tabIndex={0} role="region" aria-label="Deadline timeline. Scroll horizontally to view dates."><div className="ops-timeline-canvas"><div className="ops-timeline-axis"><span>Work / owner</span><div>{Array.from({ length: 5 }, (_, index) => <span key={index} style={{ left: `${index * 25}%` }}>{dueLabel(new Date(rangeStart + (rangeEnd - rangeStart) * index / 4).toISOString())}</span>)}</div></div>{dated.map(item => <div className="ops-timeline-row" key={item.id}><div><button type="button" className="ops-view-text-action" onClick={() => onInspectItem(item)}>{item.title}</button>{owner(item)}</div><div className="ops-timeline-track"><button className="ops-timeline-marker" data-status={item.status} type="button" style={{ left: `${(new Date(item.due_at!).getTime() - rangeStart) / (rangeEnd - rangeStart) * 100}%` }} aria-label={`${item.title}, ${dueLabel(item.due_at)}, ${workStatusLabel(item.status)}. Inspect work.`} onClick={() => onInspectItem(item)}><span />{date(item)}</button></div></div>)}</div></div></>}
    {undated.length > 0 && <section className="ops-timeline-undated"><h2 className="ops-view-section-title">Without a due date</h2>{undated.map(item => <div key={item.id}><button type="button" className="ops-view-text-action" onClick={() => onInspectItem(item)}>{item.title}</button>{owner(item)}<span className="ops-view-status" data-status={item.status}>{workStatusLabel(item.status)}</span></div>)}</section>}
  </div>;

  return <section className="ops-views" aria-label="Work">
    <header className="ops-view-heading"><div><h1>Move the work forward</h1><p>See the next step and the person responsible.</p></div></header>
    <div className="ops-view-toolbar">
      <div className="ops-view-segments" aria-label="Work view">{["Board", "List", "Timeline"].map(name => <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>{name}</button>)}</div>
      <label className="ops-view-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search work, people and projects</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find work, people, projects" /></label>
      <label><span className="sr-only">Filter work</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Active work</option><option value="all">All work</option><option value="blocked">Blocked</option><option value="overdue">Overdue</option><option value="done">Completed</option><option value="cancelled">Cancelled</option></select></label>
      <span className="ops-view-muted">{visible.length} items shown</span>
    </div>
    {visible.length === 0 ? <div className="ops-view-empty"><CircleCheck size={32} aria-hidden="true" /><h2>{items.length ? "No work matches this view" : "Your next steps belong here"}</h2><p>{items.length ? "Try another status or a different search." : "Tasks and milestones from your plans will appear together, with their owners and due dates."}</p>{items.length > 0 && <button type="button" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>}</div>
      : view === "Board" ? <><p className="ops-board-scroll-cue"><ArrowRight size={15} aria-hidden="true" />Drag to review a stage change · Open a task to change it with the keyboard</p><div className="ops-work-board" tabIndex={0} role="region" aria-label="Work board. Scroll horizontally to view later stages.">{stages.filter(stage => filter === "all" || (filter === "active" ? ["open", "in_progress", "blocked", "done"].includes(stage.status) : visible.some(item => item.status === stage.status))).map(stage => <section className="ops-work-lane" key={stage.status} aria-label={stage.label} data-drop-target={dropStage === stage.status || undefined} onDragOver={event => { if (onProposeStage && draggedId.current && stage.status !== "cancelled") { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropStage(stage.status); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStage(null); }} onDrop={event => { event.preventDefault(); proposeDrop(stage.status); }}><header><h2>{stage.status === "blocked" ? <CirclePause size={16} aria-hidden="true" /> : stage.status === "done" ? <CircleCheck size={16} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}{stage.label}</h2><span>{visible.filter(item => item.status === stage.status).length}</span></header><div className="ops-work-stack">{visible.filter(item => item.status === stage.status).map(item => <button className="ops-work-card" type="button" key={item.id} draggable={Boolean(onProposeStage) && Boolean(item.updated_at)} onDragStart={event => { event.currentTarget.focus(); draggedInvoker.current = event.currentTarget; draggedId.current = item.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", "Operations work"); }} onDragEnd={() => { draggedInvoker.current = null; draggedId.current = null; setDropStage(null); }} onClick={() => onInspectItem(item)}><span className="ops-work-context">{item.priority} priority · {item.item_type}</span><strong>{item.title}</strong><span className="ops-view-muted">{projects.get(item.plan_id ?? "") ?? "Standalone work"}</span><div className="ops-work-owner">{owner(item)}</div><footer>{date(item)}{item.linked_action_id && <span className="ops-work-link">Linked action</span>}</footer></button>)}</div></section>)}</div></>
      : view === "List" ? <><div className="ops-view-table-scroll" tabIndex={0} role="region" aria-label="Work list"><table className="ops-work-table" role="table"><thead><tr><th>Work / project</th><th>Owner</th><th>Status</th><th>Due</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td data-label="Work"><button type="button" className="ops-view-text-action" onClick={() => onInspectItem(item)}>{item.title}</button><small>{projects.get(item.plan_id ?? "") ?? "Standalone work"}</small></td><td data-label="Owner">{owner(item)}</td><td data-label="Status"><span className="ops-view-status" data-status={item.status}>{stages.find(stage => stage.status === item.status)?.label}</span></td><td data-label="Due">{date(item)}</td></tr>)}</tbody></table></div></>
      : timeline}
  </section>;
}
