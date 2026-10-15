// Email series (E3): the pure parts of the series view — types for its two reads, how a wait reads in
// words, where each email lands in someone's first weeks, and what each state and refusal means to the
// owner. Nothing here reads or writes; marketing-email-series.tsx does that through the series RPCs.
import type { Rule } from "./marketing-email-editor";

export type SeriesStatus = "draft" | "pending_approval" | "active" | "paused" | "blocked" | "stopped";
export type SeriesKind = "welcome" | "nurture" | "reengagement" | "custom";

/** One row of read_email_sequences. */
export type SeriesRow = {
  id: string; name: string; kind: SeriesKind; status: SeriesStatus; blocked_reason: string | null;
  emails: number; entry_mode: "new_contacts" | "matching" | null; change_state: string | null;
  in_now: number; entered: number; sent_30d: number; next_send_at: string | null;
  activated_at: string | null; updated_at: string;
};

export type SeriesStep = { position: number; delay_minutes: number; subject: string; preheader: string; body_html: string };
export type SeriesSender = { mode: "managed" | "connector"; connector_id?: string; provider?: string; from_address?: string | null; from_name?: string | null; healthy?: boolean; ok?: boolean; reason?: string };

/** read_email_sequence. */
export type SeriesRead = {
  sequence: { id: string; name: string; kind: SeriesKind; status: SeriesStatus; blocked_reason: string | null; activated_at: string | null;
    stopped_at: string | null; created_at: string; updated_at: string; live_version_id: string | null };
  version: { id: string; version_no: number; state: "draft" | "locked" | "approved" | "superseded"; entry_mode: "new_contacts" | "matching";
    audience: Rule; segment_id: string | null; segment_name: string | null; exit_on_goal: string; exit_when_unmatched: boolean;
    sender: SeriesSender; sender_snapshot: SeriesSender | null; expected_entrants: number | null; approval_id: string | null;
    approved_at: string | null; steps: SeriesStep[] };
  live: { id: string; version_no: number; entry_mode: string; steps: { position: number; delay_minutes: number; subject: string }[] } | null;
  approval: { status: string; source: string } | null;
  last_declined: { reason: string | null; at: string; version_no: number } | null;
  entry_preview: { matched: number; eligible: number; eligible_new: number; no_address: number; opted_out: number; suppressed: number };
  emails: { position: number; sent: number; tracked: number; opened: number; clicked: number; waiting: number; next_at: string | null; not_delivered: number; skipped: number }[];
  people: { in_now: number; completed: number; left: number; by_email: Record<string, number>; left_because: Record<string, number>;
    recent: { client_id: string | null; name: string | null; email: string; status: string; exit_reason: string | null; position: number; entered_at: string; last_sent_at: string | null; finished_at: string | null }[] };
  senders: SeriesSender[]; managed_sender: SeriesSender; resolves: SeriesSender;
  postal_address: string | null; business_name: string | null;
  segments: { id: string; name: string; rule: Rule }[];
  choices: { stages: { key: string; count: number }[]; sources: { key: string; count: number }[]; tags: { key: string; count: number }[] };
  sending: { daily_cap: number; used_last_24h: number; remaining_today: number };
  /** People who qualify for a started series but have not entered yet (they enter on the next check, or on resume). */
  waiting_to_enter?: number | null;
};

export const SERIES_KIND_LABEL: Record<SeriesKind, string> = { welcome: "Welcome series", nurture: "Nurture series", reengagement: "Win-back series", custom: "Series" };

export const MAX_STEPS = 10;
export const MAX_DELAY_MINUTES = 90 * 24 * 60;

/** Split a wait into whole days and hours (minutes below an hour are not offered). */
export function splitWait(minutes: number): { days: number; hours: number } {
  const m = Math.max(0, Math.round(minutes));
  return { days: Math.floor(m / 1440), hours: Math.floor((m % 1440) / 60) };
}

export const joinWait = (days: number, hours: number) =>
  Math.min(MAX_DELAY_MINUTES, Math.max(0, Math.floor(days)) * 1440 + Math.max(0, Math.min(23, Math.floor(hours))) * 60);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How long email N waits, in words: from joining for the first, from the email before for the rest. */
export function waitWords(minutes: number, index: number): string {
  const { days, hours } = splitWait(minutes);
  if (!days && !hours) return index === 0 ? "Right away" : "Right after the email before";
  const span = !hours && days % 7 === 0 ? plural(days / 7, "week") : [days && plural(days, "day"), hours && plural(hours, "hour")].filter(Boolean).join(" ");
  return `${span} ${index === 0 ? "after they join" : "later"}`;
}

/** Hours from joining to each email, if every email before it went out on time. */
export function hoursFromJoin(steps: { delay_minutes: number }[]): number[] {
  let total = 0;
  return steps.map((s) => { total += s.delay_minutes; return total / 60; });
}

export function dayWords(hours: number): string {
  if (hours === 0) return "when they join";
  const d = Math.round(hours / 24);
  return d < 1 ? "within the first day" : `about day ${d}`;
}

export function spanWords(steps: { delay_minutes: number }[]): string {
  const h = hoursFromJoin(steps);
  const last = h[h.length - 1] ?? 0;
  if (!last) return "all at once";
  const d = Math.round(last / 24);
  return d < 1 ? "within a day" : `over about ${plural(d, "day")}`;
}

/** The state pill: what the series is doing, in the owner's words. */
export function seriesState(status: SeriesStatus): { label: string; tone: string } {
  switch (status) {
    case "draft": return { label: "Draft", tone: "" };
    case "pending_approval": return { label: "Waiting for approval", tone: "is-review" };
    case "active": return { label: "Running", tone: "is-live" };
    case "paused": return { label: "Paused", tone: "is-warn" };
    case "blocked": return { label: "Needs attention", tone: "is-blocked" };
    case "stopped": return { label: "Stopped", tone: "" };
    default: return { label: status, tone: "" };
  }
}

/** Why someone left a series. */
export const LEFT_REASON: Record<string, { label: string; detail?: string }> = {
  reached_goal: { label: "Reached the goal", detail: "counted after they joined" },
  opted_out: { label: "Opted out", detail: "marked do not contact" },
  suppressed: { label: "Unsubscribed or bounced" },
  stopped_matching: { label: "Stopped matching", detail: "e.g. became active again" },
  removed: { label: "Removed by you" },
  series_stopped: { label: "Series stopped", detail: "scheduled emails cancelled" },
  send_failed: { label: "An email could not be sent", detail: "never retried" },
  not_confirmed: { label: "Send not confirmed", detail: "never resent or guessed" },
  no_address: { label: "No email address" },
  contact_removed: { label: "Contact deleted or merged" },
  unsubscribe_unavailable: { label: "No unsubscribe link could be made" },
  sender_refused: { label: "The sender refused it" },
  no_consent: { label: "Not subscribed" },
  already_sent: { label: "Address already had this email", detail: "shared with another contact" },
};

/** What a series refusal means, in the owner's words; anything else falls back to the campaign wording. */
export const SERIES_ERROR: Record<string, string> = {
  series_not_found: "That series no longer exists.",
  series_stopped: "This series was stopped. Start a new one instead.",
  series_has_history: "A series that has run cannot be deleted. Stop it instead; what it sent stays recorded.",
  steps_required: "Add at least one email first.",
  too_many_steps: "A series holds up to 10 emails.",
  step_not_found: "That email is no longer in this series. Reload to see it as it is.",
  not_running: "This series is not running.",
  not_paused: "This series is not paused any more. Reload to see where it stands.",
  nothing_to_discard: "There are no changes to discard.",
  entry_mode_invalid: "Choose who enters again.",
  kind_invalid: "That kind of series does not exist.",
  over_daily_cap: "More people match this right now than your daily limit allows. Narrow who enters, or start it as new contacts only.",
  series_approval_requires_review: "Approve a series from its own page.",
  not_awaiting_approval: "This series is no longer waiting for approval. Reload to see where it stands.",
  approval_not_pending: "That approval was already decided. Reload to see where the series stands.",
  version_frozen: "This version is waiting for approval or has been approved, so it can’t be changed. Choose Make changes first.",
  not_an_editable_draft: "This series isn’t a draft right now. Choose Edit or Make changes first.",
  not_in_series: "That person is no longer in this series.",
  rule_invalid: "That rule can’t be used. Choose stages, sources or tags, or a whole number of days.",
  campaign_belongs_to_series: "That email belongs to a series. Change it from the series page.",
};

/** A series' approval summary, as the card says it. */
export function startSummary(input: { name: string; emails: number; mode: "new_contacts" | "matching"; matching: number | null; from: string; cap: number; change: boolean }): string {
  const n = plural(input.emails, "email");
  const head = input.change ? `Update “${input.name}”: ${n}. The people in it carry on with the new emails from where they are.`
    : input.mode === "new_contacts" ? `Start “${input.name}”: ${n} to new contacts as they arrive.`
    : `Start “${input.name}”: ${n} to the ${plural(input.matching ?? 0, "person", "people")} who match today, and anyone who matches later.`;
  return `${head} From ${input.from}. Up to ${input.cap.toLocaleString()} emails a day across all your marketing email.`;
}
