import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PlanItem } from "@/hooks/usePlanList";
import { businessCalendarHeldNote, useBusinessCalendarDay } from "../data/useBusinessTimeZone";
import type { CrmWorkRecord } from "./operations-native-work";
import { operationsWeek } from "./operations-week";
import "./operations-week.css";

type Props = { tenantId: string; items: PlanItem[]; tasks: CrmWorkRecord[];
  onInspectItem: (item: PlanItem) => void; onInspectTask?: (task: CrmWorkRecord) => void;
  onOpenBusinessTimeZone?: () => void };
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/** Mounted inside the existing actor/tenant-keyed Operations scope, never an authority source. */
export function OperationsWeek(props: Props) {
  return <ScopedWeek key={props.tenantId} {...props} />;
}
function ScopedWeek({ tenantId, items, tasks, onInspectItem, onInspectTask, onOpenBusinessTimeZone }: Props) {
  const { day, refresh } = useBusinessCalendarDay(tenantId);
  const [offset, setOffset] = useState(0);
  const week = operationsWeek(tenantId, items, tasks, day, offset);
  if (week.kind === "withheld") return <section className="ops-week ops-week-held" aria-label="Work week">
    <h2>Work week</h2><p role="status">{week.reason === "loading" ? "Reading your business calendar…"
      : businessCalendarHeldNote(week.reason, "record")}</p>
    {week.reason === "missing" && <p>Review the business time zone in Settings to place work on the right day.</p>}
    {week.reason !== "loading" && <div className="ops-week-recovery">
      {(week.reason === "missing" || week.reason === "invalid") && onOpenBusinessTimeZone &&
        <button type="button" onClick={onOpenBusinessTimeZone}>Review business time zone</button>}
      <button type="button" onClick={() => void refresh()}>Refresh business calendar</button>
    </div>}
  </section>;
  const shown = week.days.flatMap(date => [...date.deadlines, ...date.reminders]);
  const row = (work: typeof shown[number], reminder: boolean) => {
    const enabled = work.native.source === "planning" || Boolean(onInspectTask);
    return <button key={work.id} type="button" className="ops-week-work" disabled={!enabled}
      onClick={() => work.native.source === "planning" ? onInspectItem(work.native.record) : onInspectTask?.(work.native.record)}>
      <span>{work.title}</span><small>{reminder ? "Reminder" : "Deadline"} · {work.native.source === "planning" ? "Planning" : "CRM"}</small>
    </button>;
  };
  const days = (values: typeof week.days) => values.map(date => <section key={date.date} className="ops-week-day" data-today={date.date === week.today}>
    <h3><time dateTime={date.date}>{dateLabel(date.date, { weekday: "short", month: "short", day: "numeric" })}</time>
      {date.date === week.today && <span>Today</span>}</h3>
    {date.deadlines.map(work => row(work, false))}{date.reminders.map(work => row(work, true))}
    {!date.deadlines.length && !date.reminders.length && <p className="ops-week-no-date">No recorded deadline or reminder</p>}
  </section>);
  const weekend = week.days.slice(5);
  return <section className="ops-week" aria-label="Work week">
    <header><h2>{dateLabel(week.days[0].date, { month: "short", day: "numeric" })}–{dateLabel(week.days[6].date, { month: "short", day: "numeric", year: "numeric" })}</h2>
      <nav aria-label="Displayed work week"><button type="button" aria-label="Previous work week" onClick={() => setOffset(value => value - 1)}><ChevronLeft size={16} aria-hidden /></button>
        <button type="button" onClick={() => setOffset(0)} disabled={offset === 0}>This week</button>
        <button type="button" aria-label="Next work week" onClick={() => setOffset(value => value + 1)}><ChevronRight size={16} aria-hidden /></button></nav></header>
    <p className="ops-week-zone">Business calendar · {week.zone}. Recorded dates do not reserve Calendar time.</p>
    <div className="ops-week-grid">{days(week.days.slice(0, 5))}</div>
    {weekend.some(date => date.deadlines.length || date.reminders.length) && <div className="ops-week-weekend">{days(weekend)}</div>}
    <footer>{shown.length} dated {shown.length === 1 ? "commitment" : "commitments"} in this week from the sources shown.
      {week.undated.length > 0 && <span>{week.undated.length} active {week.undated.length === 1 ? "item needs" : "items need"} a saved date.</span>}
      {week.unavailable.length > 0 && <span>{week.unavailable.length} saved {week.unavailable.length === 1 ? "date is" : "dates are"} unavailable.</span>}
      <span>Open the original record to inspect, change or verify its current result.</span></footer>
  </section>;
}
