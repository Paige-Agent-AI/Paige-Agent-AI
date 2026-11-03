import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlanItem } from "@/hooks/usePlanList";
import { memberVisibleIdentity, type TeamMemberRecord } from "../team-workspace-contract";
import { projectNativeOperationsWork, presentNativeWork, type CrmWorkRecord } from "./operations-native-work";
import { capacityMinutesFromHours, reviewWeeklyPlan, type WeeklyPlanReviewInput, type WeeklyPlanWork } from "../../../supabase/functions/_shared/planning/weekly-plan-review";
import { retainedWeeklyPlanAttempt, releaseWeeklyPlanAttempt, saveWeeklyPlanReview, weeklyPlanSaveRequest, type WeeklyPlanSaveResult } from "./operations-weekly-plan-save";
import type { ReadyWorkWeek } from "./operations-weekly-workload";
import "./operations-weekly-plan-review.css";
import { OperationsWeeklyCalendar } from "./OperationsWeeklyCalendar";

type Props = { actorId: string; tenantId: string; week: ReadyWorkWeek; items: PlanItem[]; tasks: CrmWorkRecord[]; members: TeamMemberRecord[];
  openByLink?: boolean; onSaved: (id: string) => void; onGuardChange: (guard: (() => string | null) | null) => void };
export type WeeklyPlanReviewEntry = Pick<Props, "actorId" | "openByLink" | "onSaved" | "onGuardChange">;
const reason = { dependency_cycle: "Resolve the dependency cycle", dependency_unavailable: "Confirm its original prerequisite", dependency_held: "Its prerequisite is not in this week's accepted work", source_blocked: "Resolve the original block first", effort_unknown: "Confirm the remaining effort", capacity_unknown: "Confirm this person's net available hours" };
const canonicalPriority = (value: string | null): WeeklyPlanWork["priority"] => ({ P0: "urgent", P1: "high", P2: "normal", P3: "low", urgent: "urgent", high: "high", normal: "normal", low: "low" } as const)[value ?? ""] ?? null;

/** Original Work review, never a second task store or Calendar scheduler. */
export function OperationsWeeklyPlanReview(props: Props) {
  const work = useMemo(() => projectNativeOperationsWork(props.tenantId, props.items, props.tasks).map(native => {
    const row = presentNativeWork(native);
    return { key: native.key, tenantId: props.tenantId, ownerId: row.assigned_to_user_id, title: row.title, status: row.status,
      priority: canonicalPriority(row.priority), dueAt: row.due_at, updatedAt: row.updated_at ?? "", minutes: native.source === "crm" ? native.record.estimated_minutes : null,
      reminder: row.item_type === "reminder" };
  }).filter(row => !row.reminder), [props.tenantId, props.items, props.tasks]);
  const revision = JSON.stringify([props.actorId, props.tenantId, props.week.days[0].date, props.week.zone]);
  return <WeeklyPlanReview key={revision} {...props} work={work} />;
}
function WeeklyPlanReview({ actorId, tenantId, week, members, work, openByLink, onSaved, onGuardChange }: Props & { work: WeeklyPlanWork[] }) {
  const id = useId(), scope = useMemo(() => ({ actorId, tenantId }), [actorId, tenantId]);
  const [open, setOpen] = useState(Boolean(openByLink)), [goal, setGoal] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [priority, setPriority] = useState<string[]>([]);
  const [hours, setHours] = useState<Record<string, string>>({}), [estimates, setEstimates] = useState<Record<string, string>>({});
  const [dependencies, setDependencies] = useState<Record<string, string[]>>({});
  const sourceRevision = JSON.stringify(work);
  const [confirmedSource, confirmSource] = useState(sourceRevision);
  const sourceChanged = confirmedSource !== sourceRevision;
  const [calendarOwner, setCalendarOwner] = useState("");
  const [busy, setBusy] = useState(false), [result, setResult] = useState<WeeklyPlanSaveResult | null>(null), [pending, setPending] = useState(false);
  const alive = useRef(true), disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (openByLink) { setOpen(true); disclosure.current?.scrollIntoView?.({ block: "nearest" }); } }, [openByLink]);
  useEffect(() => { try { setPending(Boolean(retainedWeeklyPlanAttempt(scope))); } catch { setPending(true); setResult({ kind: "uncertain", message: "A previous save cannot be read. Inspect Projects before starting another plan." }); } }, [scope]);
  const edited = Boolean(goal || selected.length || Object.keys(hours).length);
  const held = busy || pending || edited && result?.kind !== "verified";
  useEffect(() => { onGuardChange(() => held ? "Finish or decline the weekly plan review before leaving Operations. Check an unconfirmed save before starting another plan." : null); return () => onGuardChange(null); }, [held, onGuardChange]);
  const people = new Map(members.map(m => [m.user_id, m]));
  const viewer = people.get(actorId), canSave = viewer?.status === "active" && (viewer.is_owner || viewer.permission === "owner" || viewer.permission === "admin");
  const needed = new Set([...selected, ...Object.values(dependencies).flat()]);
  let invalidEstimate = false;
  const confirmedEstimates: Record<string, number | null> = {};
  const reviewedWork = work.filter(row => needed.has(row.key)).map(row => {
    const value = estimates[row.key];
    if (value === undefined) return row;
    if (value.trim() === "") { confirmedEstimates[row.key] = null; return row; }
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) invalidEstimate = true;
    confirmedEstimates[row.key] = Number(value); return row;
  });
  const capacities: Record<string, number> = {};
  const selectedOwners = [...new Set(work.filter(row => selected.includes(row.key)).map(row => row.ownerId).filter((v): v is string => Boolean(v)))];
  for (const [owner, value] of Object.entries(hours)) { const minutes = capacityMinutesFromHours(value); if (minutes !== null && selectedOwners.includes(owner) && people.get(owner)?.status === "active") capacities[owner] = minutes; }
  const input: WeeklyPlanReviewInput = { tenantId, startsOn: week.days[0].date, zone: week.zone, goal, work: reviewedWork, selected,
    priorityOrder: priority.filter(key => selected.includes(key)), capacities, estimates: confirmedEstimates, dependencies };
  const review = invalidEstimate ? { kind: "invalid" as const } : reviewWeeklyPlan(input);
  const actionable = work.filter(row => row.status !== "done" && row.status !== "cancelled");
  const locked = busy || pending || result?.kind === "verified";
  const inspectSave = async (save: boolean) => {
    if (busy || save && (sourceChanged || !canSave || review.kind !== "review" || !review.included.length)) return;
    setBusy(true);
    const command = save && review.kind === "review" ? weeklyPlanSaveRequest(input, review.included.map(row => row.work.key)) : null;
    const answer = await saveWeeklyPlanReview(scope, command, () => alive.current);
    if (!alive.current) return;
    setResult(answer); setBusy(false);
    try { setPending(Boolean(retainedWeeklyPlanAttempt(scope)) && answer.kind !== "absent" && answer.kind !== "verified"); } catch { setPending(true); }
  };
  const clear = () => {
    if (busy || pending) return;
    if (result?.kind === "verified") {
      try { releaseWeeklyPlanAttempt(scope, result.requestId); }
      catch { setResult({ kind: "uncertain", message: "The saved Plan is recorded, but this browser could not clear its recovery identity. Check the same save before another plan." }); setPending(true); return; }
    }
    setGoal(""); setSelected([]); setPriority([]); setHours({}); setEstimates({}); setDependencies({}); setCalendarOwner(""); setResult(null); setOpen(false);
  };
  return <details ref={disclosure} className="ops-week-review ops-week-plan" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Plan this week <span>Review and save an original plan</span></summary>
    <div className="ops-week-review-body">
      <p>Choose the work and goal for {week.days[0].date}–{week.days[6].date} · {week.zone}. Saving records this plan; it does not change tasks, book time or approve execution.</p>
      {result?.kind === "verified" && result.recovered && <p role="status">The original save was recovered. These local inputs are separate; open the saved Plan to inspect its original goal and commitments.</p>}
      {sourceChanged && !locked && <div role="status"><p>The original work changed during this review. Your inputs are retained; inspect the current records before saving.</p>
        <button type="button" disabled={selected.some(key => !work.some(row => row.key === key))} onClick={() => confirmSource(sourceRevision)}>Review updated work</button>
        {selected.some(key => !work.some(row => row.key === key)) && <button type="button" onClick={() => {
          const available = new Set(work.map(row => row.key)); setSelected(current => current.filter(key => available.has(key)));
          setDependencies(current => Object.fromEntries(Object.entries(current).filter(([key]) => available.has(key)).map(([key, values]) => [key, values.filter(value => available.has(value))])));
        }}>Remove unavailable selections</button>}
      </div>}
      <fieldset disabled={locked}>
        <label htmlFor={`${id}-goal`}>What matters most this week?</label>
        <textarea id={`${id}-goal`} rows={2} maxLength={2000} value={goal} onChange={event => setGoal(event.target.value)} />
        <div className="ops-week-plan-capacity">{selectedOwners.map(owner => <label key={owner}>Net available hours · {people.has(owner) ? memberVisibleIdentity(people.get(owner)!).primary : "Owner not in current roster"}
          <input type="number" min="0" max="168" step="0.25" disabled={!people.has(owner)} value={hours[owner] ?? ""}
            aria-invalid={Boolean(hours[owner]) && capacityMinutesFromHours(hours[owner]) === null}
            onChange={event => setHours(current => ({ ...current, [owner]: event.target.value }))} />
        </label>)}</div>
        {selectedOwners.length > 0 && <p className="ops-week-review-note">Enter time left after Calendar commitments and other responsibilities. Blank hours stay unknown. Each person's budget is separate.</p>}
        {selectedOwners.length > 0 && <div className="ops-week-plan-calendar"><label>Saved Calendar commitments<select value={calendarOwner} onChange={event => setCalendarOwner(event.target.value)}>
          <option value="">Choose whose Calendar to inspect</option>{selectedOwners.filter(owner => people.has(owner)).map(owner => <option key={owner} value={owner}>{memberVisibleIdentity(people.get(owner)!).primary}</option>)}
        </select></label>{calendarOwner && <OperationsWeeklyCalendar key={calendarOwner} tenantId={tenantId} ownerId={calendarOwner} week={week} />}</div>}
        {actionable.length === 0 ? <p>No active work is available in these sources. Open Work to inspect the original records.</p> : <>
          <p>{selected.length} selected · up to 40 original records including prerequisites per saved plan.</p>
          <ul className="ops-week-plan-work">{actionable.map(row => <li key={row.key}>
            <label className="ops-week-plan-select"><input type="checkbox" checked={selected.includes(row.key)} disabled={!selected.includes(row.key) && selected.length >= 40}
              onChange={event => { setSelected(current => event.target.checked ? [...current, row.key] : current.filter(key => key !== row.key)); setDependencies(current => { const next = { ...current }; delete next[row.key]; return next; }); }} />
              <span>{row.title}<small>{row.key.startsWith("crm:") ? "CRM Task" : "Planning work"} · {row.ownerId && people.has(row.ownerId) ? memberVisibleIdentity(people.get(row.ownerId)!).primary : "Owner not confirmed"} · {row.dueAt ? `Original deadline ${new Date(row.dueAt).toLocaleString("en-US", { timeZone: week.zone })}` : "No saved deadline"}</small></span></label>
            {selected.includes(row.key) && <div className="ops-week-plan-constraints"><label>Remaining effort in minutes<input type="number" min="0" max="2147483647" step="1" value={estimates[row.key] ?? (row.minutes === null ? "" : String(row.minutes))}
              aria-label={`Remaining minutes: ${row.title}`} onChange={event => setEstimates(values => ({ ...values, [row.key]: event.target.value }))} /></label>
              <label>Must follow<select multiple size={2} aria-label={`Prerequisites: ${row.title}`} value={dependencies[row.key] ?? []}
                disabled={!work.some(candidate => candidate.key !== row.key && (selected.includes(candidate.key) || candidate.status === "done"))}
                onChange={event => setDependencies(values => ({ ...values, [row.key]: Array.from(event.target.selectedOptions, option => option.value) }))}>
                {!work.some(candidate => candidate.key !== row.key && (selected.includes(candidate.key) || candidate.status === "done")) && <option disabled value="">No other selected or completed work</option>}
                {work.filter(candidate => candidate.key !== row.key && (selected.includes(candidate.key) || candidate.status === "done")).map(candidate => <option key={candidate.key} value={candidate.key}>{candidate.title}{candidate.status === "done" ? " · completed" : ""}</option>)}
              </select></label>
              <button type="button" onClick={() => setPriority(current => [row.key, ...current.filter(key => key !== row.key)])}>Prioritize first<span className="sr-only">: {row.title}</span></button>
            </div>}
          </li>)}</ul>
        </>}
      </fieldset>
      {goal.trim() && selected.length > 0 && (review.kind === "invalid" ? <p role="alert">Check the estimates, original versions and review inputs. A complete valid review is required before saving.</p> : <div className="ops-week-plan-proposal" aria-label="Weekly plan proposal">
        <h3>Proposed focus</h3><p>{review.included.length} fit within confirmed budgets · {review.overflow.length} exceed the available budget · {review.held.length} need clarification.</p>
        <ol>{review.included.map(row => <li key={row.work.key}><strong>{row.work.title}</strong><span>{row.minutes} min · {row.reasons.join(" · ")}</span></li>)}</ol>
        {(review.overflow.length > 0 || review.held.length > 0) && <details><summary>Work outside the accepted plan</summary><ul>
          {review.overflow.map(row => <li key={row.work.key}>{row.work.title} — exceeds this person's entered budget. Increase capacity only if available, revise scope or leave it for later.</li>)}
          {review.held.map(row => <li key={row.work.key}>{row.work.title} — {reason[row.reason]}.</li>)}
        </ul></details>}
      </div>)}
      <div role="status" aria-live="polite">{busy ? "Checking the original plan and receipt…" : result?.kind === "verified" ? <>
        <p>{result.recovered ? "Original saved plan and receipt recovered. This check did not save the local review inputs." : "Weekly plan saved and verified. Its original Planning receipt is recorded."} The underlying work has not been executed.</p>
        <button type="button" onClick={() => onSaved(result.planId)}>Open saved plan and receipt</button>
      </> : result?.kind === "absent" ? <p>No committed Plan was found for this attempt. Review again; the same save identity will be used.</p> : result && <p>{result.message}</p>}</div>
      {needed.size > 40 && <p role="alert">Reduce this review to 40 original records, including its prerequisites, before saving.</p>}
      {!canSave && <p role="status">Saving a business-wide weekly review requires a current workspace owner or administrator. You can still inspect the visible work.</p>}
      {pending ? <button type="button" disabled={busy} onClick={() => void inspectSave(false)}>Check the same save</button>
        : result?.kind !== "verified" && <button type="button" disabled={sourceChanged || !canSave || busy || review.kind !== "review" || review.included.length === 0 || needed.size > 40} onClick={() => void inspectSave(true)}>Save this reviewed plan</button>}
      <button type="button" disabled={busy || pending} onClick={clear}>{result?.kind === "verified" ? "Done" : result?.kind === "absent" ? "Close local review" : "Decline review"}</button>
      <p className="ops-week-review-note">Before Save, edits are local. Saved plans and their receipts can be reopened through PAIGE or ZION. Unknown results must be checked before another plan is started.</p>
    </div>
  </details>;
}
