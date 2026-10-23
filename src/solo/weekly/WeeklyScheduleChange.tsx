import { useEffect, useRef, useState } from "react";
import type { WeeklyCheck } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";
import type { WeeklyFutureControl, WeeklyOwnerControl } from "./weekly-owner-read";
import { reviewWeeklyProposal, WEEKDAYS } from "./weekly-responsibility";
export type WeeklyScheduleDraft = { weekday: number; local_time: string; timezone: string; reviewing: boolean };

/** An inline human review of the original saved definition, never schedule authority. */
export function WeeklyScheduleChange({ check, draft, onDraftChange, control, busy, onDismiss, onFinished }: {
  check: WeeklyCheck; control: WeeklyFutureControl; busy: boolean; onDismiss: () => void;
  draft: WeeklyScheduleDraft; onDraftChange: (draft: WeeklyScheduleDraft) => void;
  onFinished: (result: WeeklyOwnerControl) => void;
}) {
  const { weekday, local_time: time, timezone: zone, reviewing } = draft;
  const [invalid, setInvalid] = useState(false);
  const first = useRef<HTMLSelectElement>(null), back = useRef<HTMLButtonElement>(null), submitting = useRef(false);
  const proposed = reviewWeeklyProposal(weekday, time, zone);
  const changed = proposed && (weekday !== check.schedule.weekday || time !== check.schedule.local_time || zone !== check.schedule.timezone);
  useEffect(() => { if (reviewing) back.current?.focus(); else first.current?.focus(); }, [reviewing]);
  const confirm = async () => {
    if (!proposed || !changed || busy || submitting.current) return;
    submitting.current = true;
    try { onFinished(await control(check, "configure", proposed)); }
    catch { onFinished({ status: "unknown" }); }
    finally { submitting.current = false; }
  };
  return <form className="e5-weekly-planning" aria-label="Review future checks" onSubmit={event => {
    event.preventDefault(); if (!proposed || !changed) setInvalid(true); else { setInvalid(false); onDraftChange({ ...draft, reviewing: true }); }
  }} onKeyDown={event => { if (event.key === "Escape" && !busy && !submitting.current) {
    event.preventDefault(); event.stopPropagation(); onDismiss();
  } }}>
    <h4>{reviewing ? "Review schedule change" : "Change future checks"}</h4>
    <p>{check.name} · saved revision {check.revision}</p>
    {!reviewing ? <div className="e5-weekly-fields">
      <label>Day<select ref={first} value={weekday} onChange={event => onDraftChange({ ...draft, weekday: Number(event.target.value) })} disabled={busy}>
        {WEEKDAYS.map((day, index) => <option value={index + 1} key={day}>{day}</option>)}
      </select></label>
      <label>Time<input type="time" required value={time} onChange={event => onDraftChange({ ...draft, local_time: event.target.value })} disabled={busy} /></label>
      <label>Time zone<input required value={zone} onChange={event => onDraftChange({ ...draft, timezone: event.target.value })} disabled={busy} /></label>
    </div> : <dl className="e5-weekly-facts">
      <div><dt>Current schedule</dt><dd>{WEEKDAYS[check.schedule.weekday - 1]} · {check.schedule.local_time} · {check.schedule.timezone}</dd></div>
      <div><dt>New schedule</dt><dd>{WEEKDAYS[weekday - 1]} · {time} · {zone}</dd></div>
    </dl>}
    {invalid && <p role="alert">Choose a different valid day, time or IANA time zone before reviewing.</p>}
    <p>Saving stops future checks and requires fresh authorization. An attempt already running may finish. Original work, history and receipts remain.</p>
    <div className="e5-weekly-actions"><button ref={back} type="button" onClick={onDismiss} disabled={busy}>Keep current schedule</button>
      {reviewing ? <><button type="button" onClick={() => onDraftChange({ ...draft, reviewing: false })} disabled={busy}>Edit change</button>
        <button type="button" className="e5-weekly-primary" disabled={busy} onClick={() => void confirm()}>Save unapproved schedule</button></>
        : <button type="submit" className="e5-weekly-primary" disabled={busy}>Review change</button>}
    </div>
  </form>;
}
