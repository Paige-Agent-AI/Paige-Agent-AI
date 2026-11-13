import { useId, useState } from "react";
import { readSocialSchedule, socialScheduleChoices, socialScheduleLabel, type SocialSchedule } from "../../supabase/functions/_shared/social-publish-command/schedule";
import "./social-schedule-fields.css";
export { readSocialSchedule, socialScheduleLabel, type SocialSchedule };

export function SocialScheduleFields({ value, onChange, disabled = false }: { value: SocialSchedule | null; onChange: (value: SocialSchedule | null) => void; disabled?: boolean }) {
  const id = useId(), [civil, setCivil] = useState(value?.civil_time ?? ""), [zone, setZone] = useState(value?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  let choices: SocialSchedule[] = [], error = "";
  try { if (civil) { choices = socialScheduleChoices(civil, zone); if (!choices.length) error = "This local time is skipped by a clock change. Choose another time."; } }
  catch (reason) { error = reason instanceof Error ? reason.message : "Choose a valid time and zone."; }
  const change = (nextCivil: string, nextZone: string) => {
    try { const next = socialScheduleChoices(nextCivil, nextZone); onChange(next.length === 1 ? next[0] : null); }
    catch { onChange(null); }
  };
  return <fieldset className="mct-schedule-fields" disabled={disabled}>
    <legend>Publication time</legend>
    <label htmlFor={`${id}-time`}>Date and time</label>
    <input id={`${id}-time`} type="datetime-local" value={civil} onChange={e => { setCivil(e.target.value); change(e.target.value, zone); }} />
    <label htmlFor={`${id}-zone`}>Time zone</label>
    <input id={`${id}-zone`} value={zone} placeholder="America/New_York" spellCheck={false} onChange={e => { setZone(e.target.value); change(civil, e.target.value); }} />
    {error && <p role="status">{error}</p>}
    {choices.length > 1 && <div role="group" aria-label="Choose the clock-change occurrence"><p>This time occurs twice. Choose which occurrence to approve.</p>{choices.map(choice => <label key={choice.scheduled_for}>
      <input type="radio" name={`${id}-occurrence`} checked={value?.scheduled_for === choice.scheduled_for} onChange={() => onChange(choice)} />{socialScheduleLabel(choice)}
    </label>)}</div>}
    {value && <p>{socialScheduleLabel(value)}{!readSocialSchedule(value, Date.now()) && " — choose a time more than two minutes ahead."}</p>}
  </fieldset>;
}
