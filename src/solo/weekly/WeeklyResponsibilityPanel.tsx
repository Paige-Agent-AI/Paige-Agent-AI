import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, RefreshCw, ArrowUpRight } from "lucide-react";
import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";
import { handOffPaigePrompt } from "@/lib/paigePromptHandoff";
import { planningItemHref, reviewWeeklyProposal, WEEKDAYS, weeklyInstantLabel, weeklyStateLabel } from "./weekly-responsibility";
import type { WeeklyOwnerRead } from "./weekly-owner-read";
import "./weekly-responsibility.css";

export function WeeklyResponsibilityPanel({ read, refresh, pathname, onRequestPrepared }: {
  read: WeeklyOwnerRead; refresh: () => void; pathname: string; onRequestPrepared?: () => void;
}) {
  const snapshot = read.status === "ready" ? read.snapshot : null;
  const businessZone = snapshot?.business_time_zone.state === "configured" ? snapshot.business_time_zone.zone : null;
  const root = tenantRoutePrefixForPath(pathname);
  const [planning, setPlanning] = useState(false);
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("09:00");
  const [zone, setZone] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const proposal = reviewWeeklyProposal(weekday, time, zone ?? businessZone ?? "");
  const prepare = () => {
    if (!proposal) { setFeedback("Choose a valid day, time and IANA time zone before reviewing."); return; }
    handOffPaigePrompt(`Help me review a weekly responsibility: every ${WEEKDAYS[proposal.weekday - 1]} at ${proposal.local_time} in ${proposal.timezone}, review my outstanding personal Planning commitments and help organize my week. Show the exact scope and current execution limitations. This is a proposal only; do not claim authorization or scheduling.`);
    setFeedback("Your request is prepared in Chat. Nothing has been registered or authorized.");
    onRequestPrepared?.();
  };
  return <div className="e5-weekly-panel">
    <header className="e5-weekly-heading"><div><h2>Weekly commitment check</h2><p>Review the week. Keep the original work in Operations.</p></div>
      <button type="button" aria-label="Refresh weekly responsibility" onClick={refresh} disabled={read.status === "loading"}><RefreshCw size={16} aria-hidden /></button></header>
    {read.status === "loading" && <p role="status" aria-busy="true">Reading this owner’s current schedule and receipts…</p>}
    {read.status === "refused" && <p role="status">Weekly responsibility inspection is available to the current workspace owner. No other account’s records are shown.</p>}
    {read.status === "unavailable" && <div role="alert"><h3>Current status couldn’t be verified</h3><p>Refresh to read the schedule again. This does not mean no check exists or that a run failed.</p><button type="button" onClick={refresh}>Try again</button></div>}
    {snapshot && <>
      <p className="e5-weekly-freshness">Read {weeklyInstantLabel(snapshot.read_at, businessZone)}{!businessZone && " · Set a business time zone in Setup for local display."}</p>
      {snapshot.checks.length === 0 && <div className="e5-weekly-empty"><CalendarDays size={24} aria-hidden /><h3>No weekly responsibility is registered</h3><p>Prepare the schedule and scope for review. Recurring execution is currently unavailable.</p></div>}
      {snapshot.checks.map(check => {
        const last = check.last_verified_run;
        const state = check.schedule_status === "scheduled" && check.execution_availability === "held" ? "held" : check.schedule_status;
        return <article className="e5-weekly-check" key={check.automation_id}>
          <div className="e5-weekly-row"><h3>{check.name}</h3><span className="e5-weekly-state">{weeklyStateLabel(state)}</span></div>
          <p className="e5-weekly-schedule">Every {WEEKDAYS[check.schedule.weekday - 1]} at {check.schedule.local_time}<br /><span>{check.schedule.timezone}</span></p>
          <dl className="e5-weekly-facts">
            <div><dt>Next execution</dt><dd>{check.next_run_at ? weeklyInstantLabel(check.next_run_at, businessZone) : "No executable next run is available"}</dd></div>
            <div><dt>Scope</dt><dd>Your open, in-progress and blocked Planning work assigned to you or created by you.</dd></div>
            <div><dt>Permission</dt><dd>{check.schedule_status === "requested" ? "Exact recurring configuration awaits authorization." : "Recorded configuration; execution also requires current permission and availability."}</dd></div>
          </dl>
          {check.execution_availability === "held" && <p className="e5-weekly-notice">Execution is held. The requested time is not a promise of a run. No booking reserves this slot.</p>}
          {check.last_run && <div className="e5-weekly-attempt"><h4>Latest attempt</h4><p><strong>{weeklyStateLabel(check.last_run.status)}</strong> · {weeklyInstantLabel(check.last_run.scheduled_for, businessZone)}</p>
            {check.last_run.status === "unknown" && <p>The result is unknown. It must be reconciled before any replay; an older verified check does not resolve this attempt.</p>}
            {check.last_run.status === "failed" && <p>This attempt did not produce a verified completed check. Review the failure before another execution.</p>}</div>}
          {last ? <div className="e5-weekly-result"><h4>Last verified check</h4><p>Completed check · {weeklyInstantLabel(last.observed_at, businessZone)}</p>
            <p><strong>{last.counts.open} outstanding</strong> · {last.counts.blocked} blocked · {last.counts.overdue} overdue · {last.counts.due_next_week} due in the following week · {last.counts.undated} undated.</p>
            <p>The check reviewed this work. It did not complete or change the underlying tasks.</p>
            {last.truncated && <p>Results show up to 50 source items. Counts cover the full eligible observation.</p>}
            {last.source_items ? <ul className="e5-weekly-sources">{last.source_items.map(item => {
              const href = planningItemHref(pathname, { kind: "planning_item", id: item.id });
              return <li key={item.id}>{href ? <Link to={href}>{item.title}<ArrowUpRight size={14} aria-hidden /></Link> : <span>{item.title}</span>}<small>{item.status.replace(/_/g, " ")} at the check</small></li>;
            })}</ul> : <p>Source links are unavailable for this receipt. Open Operations to inspect current work.</p>}
            <details><summary>Verified receipt</summary><dl className="e5-weekly-facts e5-weekly-receipt">
              <div><dt>Receipt</dt><dd>{last.receipt_id}</dd></div><div><dt>Occurrence</dt><dd>{last.event_id}</dd></div><div><dt>Act</dt><dd>{last.act_id}</dd></div>
              <div><dt>Schedule revision</dt><dd>{last.schedule_revision}</dd></div><div><dt>Source</dt><dd>Planning work · observation preserved at the check</dd></div>
            </dl></details>
          </div> : <p>No receipt-backed completed check has been verified.</p>}
          <details className="e5-weekly-controls"><summary>Future executions</summary><p>Pause, change, resume and cancel affect future runs. They do not terminate an act already processing.</p>
            <div className="e5-weekly-actions">{["Pause", "Change", "Resume", "Cancel"].map(label => <button type="button" key={label} disabled>{label} unavailable</button>)}</div>
            <p>These controls require the existing authorized action path. They are not activated in this interface.</p></details>
        </article>;
      })}
      {snapshot.has_more && <p>This bounded read shows up to 50 responsibilities; more records may exist.</p>}
      {!planning ? <button type="button" className="e5-weekly-primary" onClick={() => setPlanning(true)}>Prepare a weekly responsibility</button> : <form className="e5-weekly-planning" onSubmit={event => { event.preventDefault(); if (!proposal) setFeedback("Choose a valid schedule and time zone."); else { setReviewing(true); setFeedback(""); } }}>
        <h3>{reviewing ? "Review your proposal" : "Prepare the schedule"}</h3>
        <p>Local proposal only. Nothing is scheduled or approved.</p>
        {!reviewing ? <div className="e5-weekly-fields"><label>Day<select value={weekday} onChange={event => setWeekday(Number(event.target.value))}>{WEEKDAYS.map((day, i) => <option value={i + 1} key={day}>{day}</option>)}</select></label>
          <label>Time<input type="time" required value={time} onChange={event => setTime(event.target.value)} /></label>
          <label>Time zone<input required value={zone ?? businessZone ?? ""} onChange={event => setZone(event.target.value)} placeholder="America/New_York" /></label></div>
          : <><p className="e5-weekly-schedule">Every {WEEKDAYS[weekday - 1]} at {time}<br />{proposal?.timezone}</p><p>Read your personal outstanding Planning work, report attention and preserve an internal result. No task changes, customer contact or provider sends.</p><p>Recurring scheduling and authorization are unavailable here. Preparing this request gives PAIGE no execution permission.</p></>}
        <div className="e5-weekly-actions">{!reviewing ? <button className="e5-weekly-primary" type="submit">Review proposal</button> : <><button type="button" disabled>Authorize schedule unavailable</button><button type="button" className="e5-weekly-primary" onClick={prepare}>Put request in Chat</button><button type="button" onClick={() => setReviewing(false)}>Change proposal</button></>}
          <button type="button" onClick={() => { setPlanning(false); setReviewing(false); setFeedback(""); }}>Discard proposal</button></div>
      </form>}
      {feedback && <p role="status">{feedback}</p>}
    </>}
    {root && <nav className="e5-weekly-navigation" aria-label="Weekly responsibility records"><Link to={`${root}/clients/calendar`}>Clients → Calendar</Link><Link to={`${root}/operations/work`}>Operations → Work</Link></nav>}
  </div>;
}
