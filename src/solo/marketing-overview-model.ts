// Marketing › Overview figures, derived from reads the Marketing hub already makes.
//
// Every number here comes from one of three sources and nothing else:
//   - the owner's campaign briefs (useSoloCampaignBriefs),
//   - published and draft Vibe Studio work (useSoloCampaigns: pages, funnels, forms),
//   - the latest SUBMISSION_READ_LIMIT form submissions (useSoloCampaigns).
// There is no email, ad, visit or spend source in this workspace, so none of those appear. A
// comparison with the previous period is shown only when the submissions read provably covers
// that whole period; otherwise it is left out rather than guessed.

import type { CampaignArtifact, CampaignDraft, CampaignSubmission } from "./useSoloCampaigns";
import type { CampaignBrief } from "./useSoloCampaignBriefs";

export const DAY_MS = 86_400_000;
/** The bound on useSoloCampaigns' submissions read. */
export const SUBMISSION_READ_LIMIT = 200;
export const PERIODS = [7, 30] as const;
export type PeriodDays = (typeof PERIODS)[number];

export type Delta = { previous: number; change: number; percent: number | null };

export type DailyPoint = { day: string; label: string; leads: number; opportunities: number };
export type SourceSlice = { key: string; label: string; count: number; kind: "tag" | "other" | "untagged" };
export type ContentRow = { id: string; name: string; count: number };
export type StatusKey = "running" | "approved" | "review" | "draft" | "paused" | "blocked" | "completed";
export type StatusSlice = { key: StatusKey; label: string; count: number };

export type MarketingOverviewModel = {
  periodDays: PeriodDays;
  /** True when the submissions read was full and every row fell inside the period: older ones may exist. */
  capped: boolean;
  campaigns: { total: number; running: number; blocked: number; newInPeriod: number };
  published: { total: number; pages: number; funnels: number; forms: number; drafts: number };
  leads: { count: number; tagged: number; delta: Delta | null };
  opportunities: { count: number; delta: Delta | null };
  daily: DailyPoint[];
  sources: SourceSlice[];
  topContent: ContentRow[];
  status: StatusSlice[];
};

const NAMED_SOURCES = 4;
const TOP_CONTENT = 5;

const STATUS_LABEL: Record<StatusKey, string> = {
  running: "Running",
  approved: "Approved, not launched",
  review: "Awaiting review",
  draft: "Draft",
  paused: "Paused",
  blocked: "Blocked",
  completed: "Completed",
};
const STATUS_ORDER: StatusKey[] = ["running", "approved", "review", "draft", "paused", "blocked", "completed"];

export function isBlockedBrief(brief: Pick<CampaignBrief, "lifecycleStatus" | "blocker">): boolean {
  return brief.lifecycleStatus === "blocked" || Boolean(brief.blocker);
}

function statusOf(brief: CampaignBrief): StatusKey | null {
  if (brief.lifecycleStatus === "archived") return null;
  if (isBlockedBrief(brief)) return "blocked";
  switch (brief.lifecycleStatus) {
    case "active": return "running";
    case "approved": return "approved";
    case "ready_for_review": return "review";
    case "paused": return "paused";
    case "completed": return "completed";
    default: return "draft";
  }
}

const at = (iso: string | null | undefined) => {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(value) ? value : null;
};

function dayKey(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight `offset` calendar days from `time`'s day. Built from the date, never by adding
 * 24-hour blocks, so a daylight-saving change cannot shift a boundary off midnight. */
function midnight(time: number, offset = 0): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
}

/**
 * The submissions inside the last `periodDays` whole calendar days (today included). A row stamped
 * slightly ahead of this device's clock still counts as today. This is the one definition of "last
 * N days" for Marketing; Overview and Analytics both use it.
 */
export function submissionsInPeriod<T extends { createdAt: string }>(submissions: readonly T[], periodDays: number, now = Date.now()) {
  const periodStart = midnight(now, -(periodDays - 1));
  const dated = submissions.map((s) => ({ s, t: at(s.createdAt) })).filter((row): row is { s: T; t: number } => row.t !== null);
  const within = dated.filter((row) => row.t >= periodStart).map((row) => row.s);
  const oldest = dated.reduce((min, row) => Math.min(min, row.t), Number.POSITIVE_INFINITY);
  // The read returns the latest SUBMISSION_READ_LIMIT. If none of them is older than the period,
  // older ones in the period may exist beyond it, so the count is a floor.
  const capped = submissions.length >= SUBMISSION_READ_LIMIT && oldest >= periodStart;
  return { within, capped, periodStart, dated, oldest };
}

function deltaOf(current: number, previous: number): Delta {
  return { previous, change: current - previous, percent: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null };
}

export function deriveMarketingOverview(input: {
  briefs: readonly CampaignBrief[];
  artifacts: readonly CampaignArtifact[];
  drafts: readonly CampaignDraft[];
  submissions: readonly CampaignSubmission[];
  periodDays: PeriodDays;
  now?: number;
}): MarketingOverviewModel {
  const now = input.now ?? Date.now();
  const { briefs, artifacts, drafts, submissions, periodDays } = input;
  // The period is whole calendar days ending today, so the chart's first bar is a full day.
  const { periodStart, dated, oldest, capped } = submissionsInPeriod(submissions, periodDays, now);
  const previousStart = midnight(now, -(2 * periodDays - 1));
  const within = dated.filter((row) => row.t >= periodStart);
  const previous = dated.filter((row) => row.t >= previousStart && row.t < periodStart);
  const full = submissions.length >= SUBMISSION_READ_LIMIT;
  // The previous period is complete only if the read was not full, or it reaches back past it.
  const previousCovered = !full || oldest < previousStart;

  const leadsCount = within.length;
  const opportunitiesCount = within.filter((row) => row.s.dealId).length;

  const daily: DailyPoint[] = [];
  const byDay = new Map<string, DailyPoint>();
  for (let i = 0; i < periodDays; i += 1) {
    const time = midnight(now, i - (periodDays - 1));
    const point = { day: dayKey(time), label: new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" }), leads: 0, opportunities: 0 };
    daily.push(point);
    byDay.set(point.day, point);
  }
  const today = daily[daily.length - 1];
  for (const row of within) {
    // Every counted lead lands on a bar: one stamped ahead of this clock goes on today.
    const point = byDay.get(dayKey(row.t)) ?? today;
    point.leads += 1;
    if (row.s.dealId) point.opportunities += 1;
  }

  // Sources: the utm_source on the link each visitor submitted from, merged case-insensitively.
  const tagCounts = new Map<string, { label: string; count: number }>();
  let untagged = 0;
  for (const row of within) {
    const tag = row.s.trackingSource?.trim();
    if (!tag) { untagged += 1; continue; }
    const key = tag.toLowerCase();
    const entry = tagCounts.get(key) ?? { label: tag, count: 0 };
    entry.count += 1;
    tagCounts.set(key, entry);
  }
  const ranked = [...tagCounts.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  const sources: SourceSlice[] = ranked.slice(0, NAMED_SOURCES).map(([key, entry]) => ({ key, label: entry.label, count: entry.count, kind: "tag" }));
  const rest = ranked.slice(NAMED_SOURCES).reduce((sum, [, entry]) => sum + entry.count, 0);
  if (rest) sources.push({ key: "__other", label: "Other sources", count: rest, kind: "other" });
  if (untagged) sources.push({ key: "__untagged", label: "No tracking tag", count: untagged, kind: "untagged" });

  // Top content: leads per form in the period. Pages and funnels collect through their forms.
  const names = new Map<string, string>();
  for (const item of artifacts) if (item.type === "form") names.set(item.id, item.name);
  for (const item of drafts) if (item.type === "form" && !names.has(item.id)) names.set(item.id, item.name);
  const perForm = new Map<string, number>();
  for (const row of within) perForm.set(row.s.formId, (perForm.get(row.s.formId) ?? 0) + 1);
  const topContent = [...perForm.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_CONTENT)
    .map(([id, count]) => ({ id, name: names.get(id) ?? "A form no longer listed", count }));

  const statusCounts = new Map<StatusKey, number>();
  for (const brief of briefs) {
    const key = statusOf(brief);
    if (key) statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
  }
  const status = STATUS_ORDER.map((key) => ({ key, label: STATUS_LABEL[key], count: statusCounts.get(key) ?? 0 }));

  const live = briefs.filter((brief) => brief.lifecycleStatus !== "archived");
  return {
    periodDays,
    capped,
    campaigns: {
      total: live.length,
      running: statusCounts.get("running") ?? 0,
      blocked: statusCounts.get("blocked") ?? 0,
      newInPeriod: live.filter((brief) => { const t = at(brief.createdAt); return t !== null && t >= periodStart; }).length,
    },
    published: {
      total: artifacts.length,
      pages: artifacts.filter((item) => item.type === "page").length,
      funnels: artifacts.filter((item) => item.type === "funnel").length,
      forms: artifacts.filter((item) => item.type === "form").length,
      drafts: drafts.length,
    },
    leads: {
      count: leadsCount,
      tagged: within.filter((row) => row.s.trackingSource?.trim()).length,
      delta: previousCovered ? deltaOf(leadsCount, previous.length) : null,
    },
    opportunities: {
      count: opportunitiesCount,
      delta: previousCovered ? deltaOf(opportunitiesCount, previous.filter((row) => row.s.dealId).length) : null,
    },
    daily,
    sources,
    topContent,
    status,
  };
}
