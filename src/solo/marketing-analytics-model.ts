// Marketing › Analytics figures (INT-342 S1d, owner-approved prototype v2).
//
// Every number comes from reads the Marketing hub already makes: the latest SUBMISSION_READ_LIMIT form
// submissions and the published forms (useSoloCampaigns), and the owner's campaign briefs
// (useSoloCampaignBriefs). Email has its own read on the page. Nothing is estimated, and when the
// submissions read is full and every row falls inside the range, each count is a floor.

import type { CampaignArtifact, CampaignSubmission } from "./useSoloCampaigns";
import type { CampaignBrief } from "./useSoloCampaignBriefs";
import { SUBMISSION_READ_LIMIT, sendsToPipeline, submissionsInPeriod } from "./marketing-overview-model";

// Week, month and quarter: the periods the email read also serves (read_email_marketing_dashboard
// accepts 7, 30 or 90). Email counts back from now; submissions count whole days ending today, so the two
// windows can differ by under a day.
export const RANGES = [
  { key: "week", label: "Week", days: 7, noun: "week" },
  { key: "month", label: "Month", days: 30, noun: "month" },
  { key: "quarter", label: "Quarter", days: 90, noun: "quarter" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "month";
export const rangeOf = (key: string | null | undefined) => RANGES.find((range) => range.key === key) ?? RANGES[1];

export type SourceRow = { label: string; count: number };
export type CampaignTagRow = { tag: string; count: number; brief: string | null };
/** Where a form's leads go, in Overview's words: a pipeline, an email alert only, automations but no pipeline, or nowhere. */
export type RouteState = "pipeline" | "alert" | "automations" | "none";
export type CapturePoint = { id: string; name: string; count: number; route: RouteState; failed: number };

/** One bar of the leads chart: a day (week and month ranges) or a week (quarter). */
export type TrendPoint = { key: string; label: string; leads: number; tagged: number; matched: number; opportunities: number };
/** What became of each lead, from the submission's own record. */
export type OutcomeKey = "opportunity" | "client" | "saved" | "waiting" | "failed";
export type OutcomeSlice = { key: OutcomeKey; label: string; count: number };
export type SourceSlice = { key: string; label: string; count: number; kind: "tag" | "other" | "untagged" };
export type WeekdayBar = { key: string; label: string; count: number };

export type MarketingAnalyticsModel = {
  days: number;
  /** The read was full and none of it is older than the range: more leads in the range may exist. */
  capped: boolean;
  leads: number;
  tagged: number;
  /** Leads whose link carried any campaign tag, matched to a brief or not. */
  campaignTagged: number;
  matched: number;
  opportunities: number;
  sources: SourceRow[];
  campaignTags: CampaignTagRow[];
  capture: CapturePoint[];
  /** Leads in the range from a form that is no longer published. */
  fromRetired: number;
  trend: TrendPoint[];
  /** "day" or "week": what one point of the trend covers. */
  trendStep: "day" | "week";
  outcomes: OutcomeSlice[];
  /** The four most-used source tags, everything else, and leads with no tag: the source ring. */
  sourceSlices: SourceSlice[];
  weekdays: WeekdayBar[];
  /** Leads by weekday (Mon first) and local hour: heat[day][hour]. */
  heat: number[][];
  /** The same five figures for the period just before, only when the read provably covers it. */
  previous: { leads: number; tagged: number; matched: number; opportunities: number } | null;
};

const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  opportunity: "Became an opportunity",
  client: "Added to Clients",
  saved: "Saved, nothing more yet",
  waiting: "Waiting to be processed",
  failed: "Couldn’t process",
};
const OUTCOME_ORDER: OutcomeKey[] = ["opportunity", "client", "saved", "waiting", "failed"];
const NAMED_SOURCES = 4;
// Monday first, as a business week reads.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function outcomeOf(submission: CampaignSubmission): OutcomeKey {
  if (submission.dealId) return "opportunity";
  if (submission.contactId) return "client";
  if (submission.state === "error") return "failed";
  if (submission.state === "pending" || submission.state === "claimed") return "waiting";
  return "saved";
}

type FormLike = Pick<CampaignArtifact, "id" | "type" | "name" | "routingTargets" | "routingConfigured" | "recentDispatches"> & {
  intakePipelineId?: string | null;
  intakeAlert?: boolean;
};

const routeOf = (form: FormLike): RouteState =>
  sendsToPipeline(form) ? "pipeline" : form.intakeAlert ? "alert" : form.routingConfigured ? "automations" : "none";

export function deriveMarketingAnalytics(input: {
  submissions: readonly CampaignSubmission[];
  briefs: readonly Pick<CampaignBrief, "shortRef" | "name">[];
  forms: readonly FormLike[];
  days: number;
  now?: number;
}): MarketingAnalyticsModel {
  const { within, capped } = submissionsInPeriod(input.submissions, input.days, input.now);
  const refs = new Map<string, string>();
  for (const brief of input.briefs) if (brief.shortRef) refs.set(brief.shortRef.trim().toLowerCase(), brief.name);

  // Tags merge case-insensitively, as on Overview; the first spelling seen is the one shown.
  const sourceCounts = new Map<string, SourceRow>();
  const tagCounts = new Map<string, CampaignTagRow>();
  let tagged = 0, campaignTagged = 0, matched = 0, opportunities = 0;
  for (const submission of within) {
    const source = submission.trackingSource?.trim();
    if (source) {
      tagged += 1;
      const key = source.toLowerCase();
      const row = sourceCounts.get(key) ?? { label: source, count: 0 };
      row.count += 1;
      sourceCounts.set(key, row);
    }
    const campaign = submission.trackingCampaign?.trim();
    if (campaign) {
      campaignTagged += 1;
      const key = campaign.toLowerCase();
      const brief = refs.get(key) ?? null;
      if (brief) matched += 1;
      const row = tagCounts.get(key) ?? { tag: campaign, count: 0, brief };
      row.count += 1;
      tagCounts.set(key, row);
    }
    if (submission.dealId) opportunities += 1;
  }

  const byForm = new Map<string, number>();
  for (const submission of within) byForm.set(submission.formId, (byForm.get(submission.formId) ?? 0) + 1);
  const liveForms = input.forms.filter((form) => form.type === "form");
  const liveIds = new Set(liveForms.map((form) => form.id));
  const capture = liveForms
    .map((form) => ({
      id: form.id,
      name: form.name,
      count: byForm.get(form.id) ?? 0,
      route: routeOf(form),
      failed: form.recentDispatches?.failed ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const fromRetired = within.filter((submission) => !liveIds.has(submission.formId)).length;

  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;

  // The trend: whole local days from the range's first midnight; a quarter is drawn by week so 90 bars
  // never crowd the card.
  const now = input.now ?? Date.now();
  const first = submissionsInPeriod([], input.days, now).periodStart;
  const trendStep: "day" | "week" = input.days > 31 ? "week" : "day";
  const span = trendStep === "week" ? 7 : 1;
  const start = new Date(first);
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const trend: TrendPoint[] = [];
  for (let offset = 0; offset < input.days; offset += span) {
    const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset).getTime();
    trend.push({ key: String(from), label: format.format(from), leads: 0, tagged: 0, matched: 0, opportunities: 0 });
  }
  const bucketOf = (time: number) => {
    let index = trend.length - 1;
    while (index > 0 && Number(trend[index].key) > time) index -= 1;
    return trend[index];
  };
  const weekdayCounts = WEEKDAYS.map(() => 0);
  const heat = WEEKDAYS.map(() => Array.from({ length: 24 }, () => 0));
  const isMatched = (submission: CampaignSubmission) => Boolean(submission.trackingCampaign && refs.has(submission.trackingCampaign.trim().toLowerCase()));
  const outcomeCounts: Record<OutcomeKey, number> = { opportunity: 0, client: 0, saved: 0, waiting: 0, failed: 0 };
  for (const submission of within) {
    const time = Date.parse(submission.createdAt);
    const point = bucketOf(time);
    point.leads += 1;
    if (submission.dealId) point.opportunities += 1;
    if (submission.trackingSource?.trim()) point.tagged += 1;
    if (isMatched(submission)) point.matched += 1;
    const day = (new Date(time).getDay() + 6) % 7;
    weekdayCounts[day] += 1;
    heat[day][new Date(time).getHours()] += 1;
    outcomeCounts[outcomeOf(submission)] += 1;
  }

  // The period just before, compared only when every submission in it was read: the read is not full,
  // or it reaches back past that period's start.
  const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - input.days).getTime();
  const all = input.submissions.map((submission) => ({ submission, time: Date.parse(submission.createdAt) })).filter((row) => Number.isFinite(row.time));
  const covered = input.submissions.length < SUBMISSION_READ_LIMIT || all.some((row) => row.time < prevStart);
  const before = all.filter((row) => row.time >= prevStart && row.time < first).map((row) => row.submission);
  const previous = covered ? {
    leads: before.length,
    tagged: before.filter((submission) => submission.trackingSource?.trim()).length,
    matched: before.filter(isMatched).length,
    opportunities: before.filter((submission) => submission.dealId).length,
  } : null;

  const sources = [...sourceCounts.values()].sort(byCount);
  const named = sources.slice(0, NAMED_SOURCES);
  const rest = sources.slice(NAMED_SOURCES).reduce((sum, row) => sum + row.count, 0);
  const sourceSlices: SourceSlice[] = [
    ...named.map((row) => ({ key: `tag:${row.label.toLowerCase()}`, label: row.label, count: row.count, kind: "tag" as const })),
    ...(rest ? [{ key: "other", label: "Other sources", count: rest, kind: "other" as const }] : []),
    ...(within.length - tagged ? [{ key: "untagged", label: "No tracking tag", count: within.length - tagged, kind: "untagged" as const }] : []),
  ];
  return {
    days: input.days,
    capped,
    leads: within.length,
    tagged,
    campaignTagged,
    matched,
    opportunities,
    sources,
    campaignTags: [...tagCounts.values()].sort(byCount),
    capture,
    fromRetired,
    trend,
    trendStep,
    outcomes: OUTCOME_ORDER.map((key) => ({ key, label: OUTCOME_LABEL[key], count: outcomeCounts[key] })),
    sourceSlices,
    weekdays: WEEKDAYS.map((label, index) => ({ key: label, label, count: weekdayCounts[index] })),
    heat,
    previous,
  };
}
