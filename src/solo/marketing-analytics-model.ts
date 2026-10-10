// Marketing › Analytics figures (INT-342 S1d, owner-approved prototype v2).
//
// Every number comes from reads the Marketing hub already makes: the latest SUBMISSION_READ_LIMIT form
// submissions and the published forms (useSoloCampaigns), and the owner's campaign briefs
// (useSoloCampaignBriefs). Email has its own read on the page. Nothing is estimated, and when the
// submissions read is full and every row falls inside the range, each count is a floor.

import type { CampaignArtifact, CampaignSubmission } from "./useSoloCampaigns";
import type { CampaignBrief } from "./useSoloCampaignBriefs";
import { sendsToPipeline, submissionsInPeriod } from "./marketing-overview-model";

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
};

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
  return {
    days: input.days,
    capped,
    leads: within.length,
    tagged,
    campaignTagged,
    matched,
    opportunities,
    sources: [...sourceCounts.values()].sort(byCount),
    campaignTags: [...tagCounts.values()].sort(byCount),
    capture,
    fromRetired,
  };
}
