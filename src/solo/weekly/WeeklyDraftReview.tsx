import { useState } from "react";
import { PaigeConfirmCard } from "@/components/chat/PaigeConfirmCard";
import { WEEKDAYS, weeklyInstantLabel } from "./weekly-responsibility";
import type { WeeklyDraftIntent, WeeklyDraftState } from "./weekly-draft-command";

/** Customer presentation over the canonical proposal, never a confirmation engine.
 * Mounted in the dev render first; production wiring follows rendered review.
 */
export function WeeklyDraftReview({ state, busy, unconfirmed, unavailable, onApprove, onDecline, onReadback }: {
  state: WeeklyDraftState; busy: boolean; unconfirmed?: boolean; unavailable?: boolean;
  onApprove: (tokens: string[]) => void; onDecline: (tokens: string[]) => void; onReadback: () => void;
}) {
  const pending = state.phase === "awaiting_approval" && !unconfirmed;
  const saved = state.phase === "saved" && !unconfirmed;
  return <section className="e5-weekly-draft" aria-label="Weekly responsibility draft">
    <h3>{state.draft.name}</h3>
    <p className="e5-weekly-schedule">Every {WEEKDAYS[state.draft.weekday - 1]} at {state.draft.local_time}<br /><span>{state.draft.timezone}</span></p>
    <p>Your outstanding personal Planning work. The original commitments stay in Operations → Work.</p>
    {pending && !busy ? <><p>Save this proposal for later review. Saving a draft does not authorize recurring execution.</p>
      <PaigeConfirmCard actions={[{ summary: state.summary, fingerprint: state.token ?? undefined }]} onApprove={onApprove} onDeny={onDecline} disabled={unavailable} />
      <p className="e5-weekly-freshness">Confirmation expires {weeklyInstantLabel(state.expiresAt, state.draft.timezone)}.</p></>
      : <PaigeConfirmCard mode="report" actions={[{ summary: busy ? "Saving the reviewed weekly draft…" : saved ? "Weekly responsibility saved as an unapproved draft." :
        state.phase === "declined" ? "Draft proposal declined. No recurring schedule was authorized." : state.phase === "expired" ? "This confirmation expired. No save is verified." :
        state.phase === "changed" ? "This responsibility has changed. Read its current schedule and permissions in Calendar." : "The draft save could not be verified.",
        state: busy ? "working" : saved ? "done" : ["declined", "expired"].includes(state.phase) ? "failed" : "unconfirmed" }]} />}
    {unavailable && <p role="alert">Current draft status is unavailable. Read it again before approving.</p>}
    {(unconfirmed || state.phase === "unknown" || state.phase === "saved_unreceipted") && <p role="status">Read the original request’s status before any retry. An uncertain response is not permission to save another copy.</p>}
    {saved && <><p>No executable next run. Recurring authorization and activation are still required. No business task was completed or changed.</p>
      <details><summary>Draft save receipt</summary><dl className="e5-weekly-facts e5-weekly-receipt"><div><dt>Responsibility</dt><dd>{state.automationId}</dd></div><div><dt>Revision</dt><dd>{state.revision}</dd></div><div><dt>Rail receipt</dt><dd>{state.receiptId}</dd></div></dl></details></>}
    <button type="button" onClick={onReadback} disabled={busy}>Read saved status</button>
    <p className="e5-weekly-freshness">Last read {weeklyInstantLabel(state.readAt, state.draft.timezone)}</p>
  </section>;
}

export function WeeklyDraftForm({ businessZone, busy, onPrepare, onCancel }: {
  businessZone: string | null; busy: boolean; onPrepare: (draft: WeeklyDraftIntent) => void; onCancel: () => void;
}) {
  const [name, setName] = useState("Weekly commitment check"), [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("09:00"), [zone, setZone] = useState<string | null>(null);
  return <form className="e5-weekly-planning" onSubmit={e => { e.preventDefault(); onPrepare({ name: name.trim(), weekday, local_time: time, timezone: zone ?? businessZone ?? "" }); }}>
    <h3>Organize the week with PAIGE</h3><p>Review your schedule and save an unapproved responsibility. Recurring execution remains unavailable.</p>
    <div className="e5-weekly-fields"><label>Responsibility<input required maxLength={120} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
      <label>Day<select value={weekday} disabled={busy} onChange={e => setWeekday(Number(e.target.value))}>{WEEKDAYS.map((day, i) => <option key={day} value={i + 1}>{day}</option>)}</select></label>
      <label>Time<input type="time" required value={time} disabled={busy} onChange={e => setTime(e.target.value)} /></label>
      <label>Business time zone<input required value={zone ?? businessZone ?? ""} disabled={busy} onChange={e => setZone(e.target.value)} placeholder="America/New_York" /></label></div>
    <div className="e5-weekly-actions"><button className="e5-weekly-primary" type="submit" disabled={busy || !name.trim()}>Review draft</button><button type="button" onClick={onCancel} disabled={busy}>Close proposal</button></div>
  </form>;
}
