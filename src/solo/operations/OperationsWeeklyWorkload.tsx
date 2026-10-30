import { useId, useState } from "react";
import { memberVisibleIdentity, type TeamMemberRecord } from "../team-workspace-contract";
import type { CrmWorkRecord } from "./operations-native-work";
import type { PlanItem } from "@/hooks/usePlanList";
import { weeklyWorkload, type ReadyWorkWeek } from "./operations-weekly-workload";
import { OperationsWeeklyCalendar } from "./OperationsWeeklyCalendar";

type Props = { tenantId: string; week: ReadyWorkWeek; members: TeamMemberRecord[];
  onInspectItem: (item: PlanItem) => void; onInspectTask?: (task: CrmWorkRecord) => void };
const duration = (minutes: number) => {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return [hours ? `${new Intl.NumberFormat("en-US").format(hours)} h` : "", rest || !hours ? `${rest} min` : ""].filter(Boolean).join(" ");
};

/** Ephemeral what-if inputs are discarded whenever their original source changes. */
export function OperationsWeeklyWorkload(props: Props) {
  const { tenantId, week, members } = props;
  const source = [...week.days.flatMap(day => day.deadlines), ...week.undated, ...week.unavailable, ...week.outside];
  const revision = JSON.stringify([tenantId, week.zone, week.today, week.days[0].date,
    members.map(member => [member.membership_id, member.user_id, member.status]),
    source.map(work => [work.id, work.title, work.assigned_to_user_id, work.status, work.due_at, work.updated_at,
      work.native.source === "crm" ? work.native.record.estimated_minutes : null])]);
  return <WorkloadReview key={revision} {...props} />;
}
function WorkloadReview({ tenantId, week, members, onInspectItem, onInspectTask }: Props) {
  const id = useId();
  const [ownerId, setOwnerId] = useState("");
  const [hours, setHours] = useState("");
  const [estimates, setEstimates] = useState<Record<string, string>>({});
  const [calendarOwner, setCalendarOwner] = useState("");
  const owner = members.find(member => member.user_id === ownerId);
  const review = weeklyWorkload(week, owner?.user_id ?? "", hours, estimates);
  return <details className="ops-week-review">
    <summary>Review weekly workload <span>Compare commitments with capacity</span></summary>
    <div className="ops-week-review-body">
      <p id={`${id}-scope`}>Review work due in this week. Enter hours available for this work after appointments and other responsibilities. Calendar availability and dependencies still need checking.</p>
      {members.length === 0 ? <p role="status">The current team roster is unavailable. Open Capacity to review the assignments that could be read.</p> : <>
        <div className="ops-week-review-inputs">
          <label>Person<select value={ownerId} onChange={event => { setOwnerId(event.target.value); setHours(""); setEstimates({}); setCalendarOwner(""); }}>
            <option value="">Choose a person</option>
            {members.map(member => <option key={member.membership_id} value={member.user_id}>{memberVisibleIdentity(member).primary}</option>)}
          </select></label>
          <label>Hours available for this work<input type="number" min="0" max="168" step="0.25" value={hours} disabled={!owner}
            aria-describedby={`${id}-scope ${id}-hours`} aria-invalid={review.invalidCapacity}
            onChange={event => setHours(event.target.value)} /></label>
        </div>
        <p id={`${id}-hours`} className="ops-week-review-note">{review.invalidCapacity ? "Enter 0–168 hours in quarter-hour steps." : "Capacity and revised estimates stay in this review only. Changing week, person or source records clears them; reloading clears them too."}</p>
        {owner && <>
          <div className="ops-week-review-result" role="status" aria-atomic="true" data-over={Boolean(review.overBy)}>
            <strong>{duration(review.knownMinutes)} estimated{review.capacityMinutes !== null && ` / ${duration(review.capacityMinutes)} entered capacity`}</strong>
            <span>{review.rows.length === 0 ? "No dated work for this person in this week from the sources shown."
              : review.capacityMinutes === null ? "Confirm available hours to compare workload."
              : review.overBy ? `Known effort exceeds your budget by ${duration(review.overBy)}. Review scope, ownership or dates in the original work.`
              : review.missing ? "Known effort is within the budget, but missing estimates prevent a complete comparison."
              : "Estimated effort is within the entered budget. Timing, other work and dependencies still need review."}</span>
          </div>
          {review.missing > 0 && <p>{review.missing} {review.missing === 1 ? "estimate needs" : "estimates need"} confirmation.</p>}
          {review.blocked > 0 && <p>{review.blocked} blocked {review.blocked === 1 ? "commitment needs" : "commitments need"} attention before planning execution.</p>}
          {(review.undated > 0 || review.unreadable > 0 || review.earlier > 0) && <p>{review.earlier} with earlier deadlines · {review.undated} undated · {review.unreadable} with unavailable dates. These are outside this comparison; review them in Work.</p>}
          {review.rows.length > 0 && <p className="ops-week-review-note">Saved estimates may cover a whole task. Revise minutes here for the work still needed this week.</p>}
          <ul className="ops-week-review-work">{review.rows.map(({ work, text, revised, invalid }) => <li key={work.id}>
            <div><button type="button" disabled={work.native.source === "crm" && !onInspectTask}
              onClick={() => work.native.source === "planning" ? onInspectItem(work.native.record) : onInspectTask?.(work.native.record)}>{work.title}</button>
              <small>{work.native.source === "crm" ? "CRM" : "Planning"} · {work.status === "blocked" ? "Blocked" : "Due this week"} · {revised ? "Review estimate" : text === "" ? "Effort not recorded" : "Saved estimate"}</small></div>
            <label>Estimated minutes<input type="number" min="0" max="2147483647" step="1" value={text} aria-label={`Estimated minutes: ${work.title}`} aria-invalid={invalid}
              aria-describedby={invalid ? `${id}-${work.id}-error` : undefined}
              onChange={event => setEstimates(values => ({ ...values, [work.id]: event.target.value }))} />
              {invalid && <small id={`${id}-${work.id}-error`}>{Number(text) > 2147483647
                ? "This estimate is too large. Check the original work." : "Enter zero or a positive whole number of minutes."}</small>}</label>
          </li>)}</ul>
          <button type="button" aria-expanded={calendarOwner === ownerId} onClick={() => setCalendarOwner(value => value === ownerId ? "" : ownerId)}>
            {calendarOwner === ownerId ? "Hide Calendar commitments" : "Check Calendar commitments"}</button>
          {calendarOwner === ownerId && <OperationsWeeklyCalendar key={`${tenantId}:${ownerId}`} tenantId={tenantId} ownerId={ownerId} week={week} />}
          <button type="button" onClick={() => { setHours(""); setEstimates({}); setCalendarOwner(""); }}>Reset review inputs</button>
        </>}
      </>}
      <p className="ops-week-review-note">Saved deadlines and effort are unchanged. Open original work to review permitted changes. No time has been reserved or action authorized.</p>
    </div>
  </details>;
}
