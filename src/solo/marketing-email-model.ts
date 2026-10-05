// Marketing › Email: every figure the tab shows, derived from read_email_marketing_dashboard (one read,
// the caller's own business). Nothing is estimated here: a rate needs emails that report opens and
// clicks, a comparison needs a previous period with sends, and a missing figure stays missing.

export const EMAIL_PERIODS = [7, 30, 90] as const;

export type DashboardStats = {
  sent: number; sent_prev: number; tracked: number; tracked_prev: number;
  opened: number; opened_prev: number; clicked: number; clicked_prev: number; bounced: number;
  conversions: number; conversions_prev: number; new_subscribers: number; new_subscribers_prev: number; unsubscribes: number;
};
export type SeriesDay = { day: string; sent: number; tracked: number; opened: number; clicked: number };
export type CampaignRow = {
  id: string; name: string; kind: string; status: string; blocked_reason: string | null; updated_at: string;
  version_id: string | null; version_state: string | null; subject: string | null; scheduled_for: string | null;
  segment_name: string | null; conversion_goal: string | null; recipients: number | null;
  first_sent_at: string | null; last_sent_at: string | null;
  sent: number; tracked: number; opened: number; clicked: number; failed: number; not_confirmed: number; skipped: number; waiting: number;
};
export type SegmentRow = { id: string; name: string; rule: Record<string, unknown>; eligible: number; matched: number };
export type ActivityRow = { kind: "campaign_sent" | "unsubscribed" | "bounced" | "subscribed"; at: string; title?: string | null; detail?: string | null; campaign_id?: string };
export type Dashboard = {
  period_days: number; time_zone: string; generated_at: string;
  stats: DashboardStats; series: SeriesDay[];
  campaign_count: number; campaigns: CampaignRow[];
  audience: { contacts: number; with_email: number; new_leads: number; customers: number; inactive_90: number; newsletter_subscribers: number };
  segment_count: number; segments: SegmentRow[];
  activity: ActivityRow[];
  sending: { daily_cap: number; used_last_24h: number; remaining_today: number; postal_address_set: boolean };
};

export type Delta = { change: number; percent: number | null } | null;
const countDelta = (now: number, before: number, comparable: boolean): Delta =>
  comparable ? { change: now - before, percent: before > 0 ? Math.round(((now - before) / before) * 100) : null } : null;

/** A rate in whole percent with one decimal, or null when nothing was measured. */
export const rate = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** The change between two rates in percentage points, or null when either side was not measured. */
export const pointsDelta = (now: number | null, before: number | null): number | null =>
  now === null || before === null ? null : Math.round((now - before) * 10) / 10;

export type EmailStats = {
  sent: { value: number; delta: Delta };
  openRate: { value: number | null; points: number | null };
  clickRate: { value: number | null; points: number | null };
  subscribers: { value: number; delta: Delta };
  conversions: { value: number; delta: Delta; clicks: number };
  /** Sent through a route that does not report opens and clicks (the business's own Gmail or mail server). */
  untracked: number;
};

export function deriveStats(s: DashboardStats): EmailStats {
  const hadEarlierSends = s.sent_prev > 0;
  const openNow = rate(s.opened, s.tracked), openBefore = rate(s.opened_prev, s.tracked_prev);
  const clickNow = rate(s.clicked, s.tracked), clickBefore = rate(s.clicked_prev, s.tracked_prev);
  return {
    sent: { value: s.sent, delta: countDelta(s.sent, s.sent_prev, hadEarlierSends) },
    openRate: { value: openNow, points: pointsDelta(openNow, openBefore) },
    clickRate: { value: clickNow, points: pointsDelta(clickNow, clickBefore) },
    // Subscribers and conversions compare even with no earlier sends (they are counts of events), but two
    // empty periods have nothing to compare.
    subscribers: { value: s.new_subscribers, delta: countDelta(s.new_subscribers, s.new_subscribers_prev, s.new_subscribers + s.new_subscribers_prev > 0) },
    conversions: { value: s.conversions, delta: countDelta(s.conversions, s.conversions_prev, s.conversions + s.conversions_prev > 0), clicks: s.clicked },
    untracked: Math.max(0, s.sent - s.tracked),
  };
}

export type RatePoint = { day: string; label: string; sent: number; openRate: number | null; clickRate: number | null };

/** One point per calendar day. A day with no tracked sends has no rate, never a 0%: the chart draws no dot
 *  there and its line runs straight between the days that were measured. */
export function ratePoints(series: SeriesDay[], locale?: string): RatePoint[] {
  const format = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  return series.map((d) => ({
    day: d.day,
    label: format.format(new Date(`${d.day.slice(0, 10)}T00:00:00Z`)),
    sent: d.sent,
    openRate: rate(d.opened, d.tracked),
    clickRate: rate(d.clicked, d.tracked),
  }));
}

export const KIND_LABEL: Record<string, string> = {
  standard: "Campaign", newsletter: "Newsletter", announcement: "Announcement", promotion: "Promotion",
  reengagement: "Re-engagement", event: "Event", welcome: "Welcome", custom: "Campaign",
};

type Tone = "is-live" | "is-warn" | "is-blocked" | "is-review" | "";
export type CampaignState = { label: string; tone: Tone; detail: string };

const BLOCK_REASON: Record<string, string> = {
  postal_address_missing: "Add your business's postal address in Settings.",
  business_inactive: "This business is not active.",
  sender_needs_attention: "The approved sender needs attention.",
  sender_changed: "The sender changed since approval.",
  sender_not_found: "The approved sender was removed.",
  series_error: "This series could not run. Choose Edit, check who enters, and approve it again.",
};
export const blockReason = (reason: string | null) => (reason ? BLOCK_REASON[reason] ?? "Sending is paused." : "Sending is paused.");

/** "; 2 failed; 3 not confirmed": a failure the provider reported is not the same as an answer that never
 *  came (outcome_unknown, never resent), so the two are counted apart. */
export function unsent(c: { failed: number; not_confirmed: number }): string {
  return (c.failed ? `; ${c.failed.toLocaleString()} failed` : "") + (c.not_confirmed ? `; ${c.not_confirmed.toLocaleString()} not confirmed` : "");
}

/** Under a cent reads as such; "$0.00" would say it is free. */
export const costWords = (usd: number) => (usd < 0.01 ? "less than $0.01" : `$${usd.toFixed(2)}`);

/** What a campaign's status means to the owner, in one label and one line. */
export function campaignState(c: CampaignRow): CampaignState {
  const people = (n: number) => `${n.toLocaleString()} ${n === 1 ? "person" : "people"}`;
  switch (c.status) {
    case "draft": return { label: "Draft", tone: "", detail: c.sent
      ? `A new version, not sent yet. Earlier versions reached ${people(c.sent)}.`
      : "Not sent. Only you can send it, after you approve it." };
    case "pending_approval": return { label: "Awaiting approval", tone: "is-review", detail: `Ready to send to ${people(c.recipients ?? 0)} once approved.` };
    case "scheduled": return c.scheduled_for && Date.parse(c.scheduled_for) > Date.now()
      ? { label: "Scheduled", tone: "is-review", detail: `Approved. Sends ${new Date(c.scheduled_for).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.` }
      : { label: "Approved", tone: "is-review", detail: "Approved, waiting to send." };
    case "sending": return { label: "Sending", tone: "is-review", detail: `${c.sent.toLocaleString()} of ${(c.recipients ?? 0).toLocaleString()} sent so far.` };
    case "completed": return { label: "Sent", tone: "is-live", detail: `Sent to ${people(c.sent)}.` };
    case "partially_completed": return { label: "Partly sent", tone: "is-warn", detail: `Sent to ${people(c.sent)}${unsent(c)}.` };
    // A handoff that never reported back may still have arrived, and is never sent again: never call it "not sent".
    case "failed": return c.not_confirmed
      ? { label: "Not confirmed", tone: "is-warn", detail: `${c.not_confirmed.toLocaleString()} handed to the sender with no reply; they may have arrived and will not be sent again.` }
      : { label: "Not sent", tone: "is-blocked", detail: "No email went out." };
    case "blocked": return { label: "Paused", tone: "is-blocked", detail: blockReason(c.blocked_reason) };
    case "cancelled": return { label: "Cancelled", tone: "", detail: c.sent ? `Stopped after ${people(c.sent)}.` : "Cancelled before sending." };
    default: return { label: c.status, tone: "", detail: "" };
  }
}

export const ACTIVITY_LABEL: Record<ActivityRow["kind"], string> = {
  campaign_sent: "Campaign sent", subscribed: "New newsletter subscriber", unsubscribed: "Unsubscribed", bounced: "Address suppressed",
};
export function activityDetail(a: ActivityRow): string {
  if (a.kind === "campaign_sent") return a.title ?? "Campaign";
  if (a.kind === "bounced") return a.detail === "complaint" ? "Marked an email as spam" : "Bounced; no longer emailed";
  if (a.kind === "unsubscribed") return "From an unsubscribe link";
  return a.detail === "paige_form" ? "From your form" : "Opted in";
}

/** "2 hours ago" style, for the activity list. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (s < 60) return "Just now";
  if (s < 3600) return unit(Math.floor(s / 60), "minute");
  if (s < 86400) return unit(Math.floor(s / 3600), "hour");
  if (s < 86400 * 30) return unit(Math.floor(s / 86400), "day");
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
