import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, RefreshCw, ArrowUpRight } from "lucide-react";
import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";
import { handOffPaigePrompt } from "@/lib/paigePromptHandoff";
import { planningItemHref, reviewWeeklyProposal, WEEKDAYS, weeklyInstantLabel, weeklyStateLabel } from "./weekly-responsibility";
import type { WeeklyFutureControl, WeeklyOwnerRead } from "./weekly-owner-read";
import type { WeeklyCheck } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";
import { WeeklyScheduleChange, type WeeklyScheduleDraft } from "./WeeklyScheduleChange";
import "./weekly-responsibility.css";

export function WeeklyResponsibilityPanel({ read, refresh, pathname, onRequestPrepared, draftComposer, control, controlBusy = false }: {
  read: WeeklyOwnerRead; refresh: () => void; pathname: string; onRequestPrepared?: () => void; draftComposer?: ReactNode;
  control?: WeeklyFutureControl; controlBusy?: boolean;
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
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [stopReview, setStopReview] = useState<{ check: WeeklyCheck; action: "pause" | "cancel" | "authorize" } | null>(null);
  const [controlPending, setControlPending] = useState(false);
  const progress = useRef<HTMLParagraphElement>(null);
  const futureBusy = controlBusy || controlPending;
  const [changing, setChanging] = useState<{ check: WeeklyCheck; draft: WeeklyScheduleDraft } | null>(null);
  const expandedControls = useRef(new Set<string>());
  const originalChange = changing?.check;
  const change = snapshot?.checks.find(check => originalChange && check.automation_id === originalChange.automation_id
    && check.revision === originalChange.revision && check.name === originalChange.name && check.schedule_status === originalChange.schedule_status
    && check.schedule.weekday === originalChange.schedule.weekday && check.schedule.local_time === originalChange.schedule.local_time
    && check.schedule.timezone === originalChange.schedule.timezone) ?? null;
  const stop = useMemo(() => {
    if (!stopReview || !snapshot) return null;
    const original = stopReview.check;
    const current = snapshot.checks.find(check => check.automation_id === original.automation_id && check.revision === original.revision
      && check.name === original.name && check.schedule_status === original.schedule_status
      && check.schedule.weekday === original.schedule.weekday && check.schedule.local_time === original.schedule.local_time
      && check.schedule.timezone === original.schedule.timezone);
    // Preserve an unchanged review across inspection, but pass ONLY the latest
    // original native object to the hook's stricter current-snapshot gate.
    return current ? { check: current, action: stopReview.action } : null;
  }, [snapshot, stopReview]);
  const back = useRef<HTMLButtonElement>(null), opener = useRef<HTMLButtonElement | null>(null), submitting = useRef(false);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const [stopFinished, setStopFinished] = useState(0);
  useEffect(() => {
    if (stopReview && (read.status === "refused" || read.status === "unavailable" || read.status === "ready" && !stop)) {
      setStopReview(null); refreshButton.current?.focus();
    }
  }, [read.status, stop, stopReview]);
  useEffect(() => {
    if (changing && (read.status === "refused" || read.status === "unavailable" || read.status === "ready" && !change)) setChanging(null);
  }, [read.status, change, changing]);
  useEffect(() => { if (stopFinished) refreshButton.current?.focus(); }, [stopFinished]);
  useEffect(() => { if (controlPending) progress.current?.focus(); }, [controlPending]);
  useEffect(() => { if (stop) back.current?.focus(); }, [stop]);
  const dismissStop = () => { setStopReview(null); opener.current?.focus(); };
  const confirmStop = async () => {
    if (!stop || !control || controlBusy || submitting.current) return;
    submitting.current = true; setStopReview(null); setControlPending(true); setFeedbackFor(stop.check.automation_id);
    setFeedback("Checking the exact responsibility and requesting your reviewed change…");
    try {
      const result = await control(stop.check, stop.action);
      const authorized = result.status === "saved" && stop.action === "authorize"
        ? result.snapshot.checks.find(check => check.automation_id === stop.check.automation_id && check.revision === stop.check.revision && check.schedule_status === "scheduled") : null;
      setFeedback(result.status === "saved" ? stop.action === "authorize" ? !authorized
        ? "Authorization could not be confirmed. Refresh to inspect the original responsibility; nothing will be repeated."
        : authorized.execution_availability === "held"
          ? "Authorization saved. Future execution is on hold; no executable next run is available. Original work and history are preserved."
          : "Authorization saved. Inspect the next execution in the original responsibility; no completed check is claimed."
        : stop.action === "pause"
        ? "Future checks are paused. An existing run may still finish; its history is preserved."
        : "This responsibility is cancelled for future checks. Its history is preserved."
        : result.status === "stale" ? "Your reviewed version could not be confirmed. Refresh and review the current responsibility."
          : result.status === "refused" ? "Current workspace or authorization could not be verified. Inspect the original responsibility in its owning workspace before repeating the change."
            : result.status === "unsupported" ? "This control is not available for the current responsibility. Refresh to inspect it."
              : result.status === "unavailable" ? "The request could not start. Refresh before reviewing it again."
                : "The result is unknown; the responsibility may have changed. Refresh to inspect it. Nothing will be repeated automatically.");
    } catch { setFeedback("The result is unknown. Refresh to inspect the original responsibility; do not repeat the change yet."); }
    finally { submitting.current = false; setControlPending(false); setStopFinished(value => value + 1); }
  };
  const proposal = reviewWeeklyProposal(weekday, time, zone ?? businessZone ?? "");
  const prepare = () => {
    setFeedbackFor(null);
    if (!proposal) { setFeedback("Choose a valid day, time and IANA time zone before reviewing."); return; }
    handOffPaigePrompt(`Help me review a weekly responsibility: every ${WEEKDAYS[proposal.weekday - 1]} at ${proposal.local_time} in ${proposal.timezone}, review my outstanding personal Planning commitments and help organize my week. Show the exact scope and current execution limitations. This is a proposal only; do not claim authorization or scheduling.`);
    setFeedback("Your request is prepared in Chat. Nothing has been registered or authorized.");
    onRequestPrepared?.();
  };
  return <div className="e5-weekly-panel" aria-busy={futureBusy || read.status === "loading"}>
    <header className="e5-weekly-heading"><div><h2>Weekly commitment check</h2><p>Review the week. Keep the original work in Operations.</p></div>
      <button ref={refreshButton} type="button" aria-label="Refresh weekly responsibility" onClick={refresh} disabled={read.status === "loading" || futureBusy}><RefreshCw size={16} aria-hidden /></button></header>
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
            {last.observation_version === 2 ? <p><strong>{last.counts.open} outstanding</strong> · {last.counts.blocked} blocked. Work deadlines: {last.counts.overdue} overdue · {last.counts.due_next_week} due in the following week · {last.counts.undated} without a deadline.</p>
              : <><p><strong>{last.counts.open} outstanding</strong> · {last.counts.blocked} blocked · Historical totals: {last.counts.overdue} overdue · {last.counts.due_next_week} due in the following week · {last.counts.undated} undated.</p><p>These historical date totals may include reminder dates. Inspect the original work to verify its current deadline.</p></>}
            <p>The check reviewed this work. It did not complete or change the underlying tasks.</p>
            {last.truncated && <p>Results show up to 50 source items. Counts cover the full eligible observation.</p>}
            {last.source_items ? <ul className="e5-weekly-sources">{last.source_items.map(item => {
              const href = planningItemHref(pathname, { kind: "planning_item", id: item.id });
              return <li key={item.id}>{href ? <Link to={href}>{item.title}<ArrowUpRight size={14} aria-hidden /></Link> : <span>{item.title}</span>}<small>{item.status.replace(/_/g, " ")} at the check</small>
                {item.kind === "reminder" && <small>{item.remind_at ? `Reminder at the check: ${weeklyInstantLabel(item.remind_at, businessZone)}` : "Reminder time was not recorded in this historical check."}</small>}</li>;
            })}</ul> : <p>Source links are unavailable for this receipt. Open Operations to inspect current work.</p>}
            <details><summary>Verified receipt</summary><dl className="e5-weekly-facts e5-weekly-receipt">
              <div><dt>Receipt</dt><dd>{last.receipt_id}</dd></div><div><dt>Occurrence</dt><dd>{last.event_id}</dd></div><div><dt>Act</dt><dd>{last.act_id}</dd></div>
              <div><dt>Schedule revision</dt><dd>{last.schedule_revision}</dd></div><div><dt>Source</dt><dd>Planning work · observation preserved at the check</dd></div>
            </dl></details>
          </div> : <p>No receipt-backed completed check has been verified.</p>}
          <details className="e5-weekly-controls" open={expandedControls.current.has(check.automation_id) || change === check || stop?.check === check || undefined}
            onToggle={event => { if (event.currentTarget.open) expandedControls.current.add(check.automation_id); else expandedControls.current.delete(check.automation_id); }}><summary>Future executions</summary><p>Pause, change, resume and cancel affect future runs. They do not terminate an act already processing.</p>
            <div className="e5-weekly-actions">{(["pause", "cancel"] as const).map(action => <button type="button" key={action}
              disabled={!control || futureBusy || check.schedule_status === "cancelled" || action === "pause" && check.schedule_status === "paused"}
              onClick={event => { opener.current = event.currentTarget; setChanging(null); setFeedback(""); setStopReview({ check, action }); }}>
              {action === "pause" ? "Pause future checks" : "Cancel responsibility"}</button>)}
              <button type="button" disabled={!control || futureBusy || check.schedule_status === "cancelled"} onClick={event => {
                opener.current = event.currentTarget; setStopReview(null); setFeedback(""); setChanging({ check, draft: { ...check.schedule, reviewing: false } });
              }}>Change schedule</button><button type="button" disabled={!control || futureBusy || !["requested", "paused"].includes(check.schedule_status)} onClick={event => {
                opener.current = event.currentTarget; setChanging(null); setFeedback(""); setStopReview({ check, action: "authorize" });
              }}>Review authorization</button></div>
            {change === check && changing && control && <WeeklyScheduleChange key={`${check.automation_id}:${check.revision}`} check={check} control={control} busy={controlBusy}
              draft={changing.draft} onDraftChange={draft => setChanging(value => value ? { ...value, draft } : null)}
              onDismiss={() => { setChanging(null); opener.current?.focus(); }} onFinished={result => {
                setChanging(null); setStopFinished(value => value + 1); setFeedbackFor(check.automation_id);
                setFeedback(result.status === "saved" ? "Schedule saved as an unapproved definition. Future checks require fresh authorization; history is preserved."
                  : result.status === "stale" ? "Your reviewed version changed. Refresh and review the current responsibility."
                    : result.status === "refused" ? "Current workspace or authorization could not be verified. Inspect the original responsibility before repeating the change."
                      : result.status === "unsupported" ? "This schedule change is not available. Refresh and inspect the current responsibility."
                        : result.status === "unavailable" ? "The request could not start. Refresh before reviewing it again."
                          : "The result is unknown; the schedule may have changed. Refresh to inspect it. Nothing will be repeated automatically.");
              }} />}
            {stop?.check === check && <div className="e5-weekly-planning" role="group" aria-label="Review future checks"
              onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismissStop(); } }}>
              <h4>{stop.action === "authorize" ? "Authorize future weekly checks?" : stop.action === "pause" ? "Pause future checks?" : "Cancel this responsibility?"}</h4>
              <p>{check.name} · saved revision {check.revision} · {WEEKDAYS[check.schedule.weekday - 1]} at {check.schedule.local_time} · {check.schedule.timezone}</p>
              {stop.action === "authorize" && <><p>Review your personal Planning commitments and save the original observation and receipt.</p>
                <p>This check does not complete tasks, contact anyone or change other business records. Execution still depends on current permissions and platform readiness. Authorizing does not mean a check has run.</p></>}
              <p>An attempt already running can finish. Original work, history and receipts remain.</p>
              {stop.action === "cancel" && <p>Cancelled responsibilities cannot resume. This does not delete their history.</p>}
              <div className="e5-weekly-actions"><button ref={back} type="button" onClick={dismissStop}>{stop.action === "authorize" ? "Not now" : "Keep current schedule"}</button>
                <button type="button" disabled={futureBusy} onClick={() => void confirmStop()}>{stop.action === "authorize" ? "Authorize this weekly responsibility" : stop.action === "pause" ? "Confirm pause" : "Confirm cancellation"}</button></div>
            </div>}
            <p>Authorization applies to this saved definition. A paused responsibility needs a fresh review before future checks can continue; nothing runs retroactively here.</p></details>
          {feedback && feedbackFor === check.automation_id && <p ref={progress} tabIndex={-1} role="status">{feedback}</p>}
        </article>;
      })}
      {snapshot.has_more && <p>This bounded read shows up to 50 responsibilities; more records may exist.</p>}
      {!draftComposer && (!planning ? <button type="button" className="e5-weekly-primary" onClick={() => { setPlanning(true); setFeedback(""); setFeedbackFor(null); }}>Prepare a weekly responsibility</button> : <form className="e5-weekly-planning" onSubmit={event => { event.preventDefault(); setFeedbackFor(null); if (!proposal) setFeedback("Choose a valid schedule and time zone."); else { setReviewing(true); setFeedback(""); } }}>
        <h3>{reviewing ? "Review your proposal" : "Prepare the schedule"}</h3>
        <p>Local proposal only. Nothing is scheduled or approved.</p>
        {!reviewing ? <div className="e5-weekly-fields"><label>Day<select value={weekday} onChange={event => setWeekday(Number(event.target.value))}>{WEEKDAYS.map((day, i) => <option value={i + 1} key={day}>{day}</option>)}</select></label>
          <label>Time<input type="time" required value={time} onChange={event => setTime(event.target.value)} /></label>
          <label>Time zone<input required value={zone ?? businessZone ?? ""} onChange={event => setZone(event.target.value)} placeholder="America/New_York" /></label></div>
          : <><p className="e5-weekly-schedule">Every {WEEKDAYS[weekday - 1]} at {time}<br />{proposal?.timezone}</p><p>Read your personal outstanding Planning work, report attention and preserve an internal result. No task changes, customer contact or provider sends.</p><p>Recurring scheduling and authorization are unavailable here. Preparing this request gives PAIGE no execution permission.</p></>}
        <div className="e5-weekly-actions">{!reviewing ? <button className="e5-weekly-primary" type="submit">Review proposal</button> : <><button type="button" disabled>Authorize schedule unavailable</button><button type="button" className="e5-weekly-primary" onClick={prepare}>Put request in Chat</button><button type="button" onClick={() => setReviewing(false)}>Change proposal</button></>}
          <button type="button" onClick={() => { setPlanning(false); setReviewing(false); setFeedback(""); }}>Discard proposal</button></div>
      </form>)}
    </>}
    {feedback && !snapshot?.checks.some(check => check.automation_id === feedbackFor) && <p ref={progress} tabIndex={-1} role="status">{feedback}</p>}
    {draftComposer}
    {root && <nav className="e5-weekly-navigation" aria-label="Weekly responsibility records"><Link to={`${root}/clients/calendar`}>Clients → Calendar</Link><Link to={`${root}/operations/work`}>Operations → Work</Link></nav>}
  </div>;
}
