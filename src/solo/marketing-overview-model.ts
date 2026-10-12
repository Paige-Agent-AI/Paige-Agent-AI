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

type FormRouteFields = Pick<CampaignArtifact, "routingTargets" | "intakePipelineId">;

/** The pipeline fields the default-route rule reads. Structural, so any read of the Sales workspace fits. */
export type DefaultPipelineWorkspace = {
  pipelines?: readonly { id: string; name?: string; isDefault?: boolean; lifecycleStatus?: string; createdAt?: string }[];
  stages?: readonly { id: string; pipelineId?: string; label?: string; stageType?: string; archivedAt?: string | null; orderIndex?: number }[];
} | null | undefined;

/** Where a form with no deal route of its own files its leads: the business's DEFAULT pipeline, first open
 *  stage. The same pick growth_attach_submission_default_deal makes (20271021042001): the oldest
 *  non-archived default pipeline, then its first non-archived open stage by order. Null when there is no
 *  such pipeline or it has no open stage (the server skips with no_default_pipeline / no_open_stage). A
 *  missing workspace is null too: never claim a destination the records don't show. */
export function defaultPipelineTarget(ws: DefaultPipelineWorkspace): { pipelineId: string; pipelineName: string; stageId: string; stageLabel: string } | null {
  const byAge = (a: { id: string; createdAt?: string }, b: { id: string; createdAt?: string }) =>
    (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0) || a.id.localeCompare(b.id);
  const pipeline = [...(ws?.pipelines ?? [])].filter((p) => p.isDefault === true && p.lifecycleStatus !== "archived").sort(byAge)[0];
  if (!pipeline) return null;
  const stage = [...(ws?.stages ?? [])]
    .filter((s) => s.pipelineId === pipeline.id && s.stageType === "open" && !s.archivedAt)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0) || a.id.localeCompare(b.id))[0];
  if (!stage) return null;
  return { pipelineId: pipeline.id, pipelineName: pipeline.name || "Untitled pipeline", stageId: stage.id, stageLabel: stage.label || "its first open stage" };
}

/** True when the default pipeline can take a lead: exactly the server's default_ready
 *  (marketing.forms.unrouted_current) and growth_attach_submission_default_deal's precondition. */
export const defaultPipelineReady = (ws: DefaultPipelineWorkspace) => defaultPipelineTarget(ws) !== null;

/** What a default pipeline in Sales would change for a form that reaches no pipeline today. */
export function defaultPipelineHint(ws: DefaultPipelineWorkspace): string {
  const hasDefault = (ws?.pipelines ?? []).some((p) => p.isDefault === true && p.lifecycleStatus !== "archived");
  return hasDefault ? "Your default pipeline in Sales has no open stage to take them" : "Setting a default pipeline in Sales would catch them";
}

/** How a form's default destination reads to the owner: "<Pipeline> (default) → <first open stage>". */
export const defaultRouteLabel = (target: NonNullable<ReturnType<typeof defaultPipelineTarget>>) =>
  `${target.pipelineName} (default) → ${target.stageLabel}`;

/** "own": the form routes its own deals (an enabled pipeline_attach automation, or its intake route while
 *  it has no enabled automation at all, as growth-process-submission plans it). "default": it has no own
 *  route, so the processor files its leads into the default pipeline, which can take them. "none": no own
 *  route and no usable default pipeline, so its leads reach no pipeline. */
export function pipelineRouteOf(form: FormRouteFields, defaultReady: boolean): "own" | "default" | "none" {
  const targets = form.routingTargets ?? [];
  if (targets.includes("pipeline_attach") || (Boolean(form.intakePipelineId) && targets.length === 0)) return "own";
  return defaultReady ? "default" : "none";
}

/** A form's leads reach a pipeline when it routes its own deals, or (owner ruling 2026-10-11) when it has
 *  no own route and the business's default pipeline has an open stage to take them. This mirrors
 *  growth_attach_submission_default_deal and Marketing's server producer marketing.forms.unrouted_current,
 *  which counts such a form as routed. `defaultReady` defaults to false so a caller that does not know the
 *  pipelines never claims a destination; Overview and Analytics pass defaultPipelineReady(workspace). */
export const sendsToPipeline = (form: FormRouteFields, defaultReady = false) => pipelineRouteOf(form, defaultReady) !== "none";

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

/** The first midnight of the period Overview and its server read share: whole local days ending today. */
export const periodStartOf = (periodDays: number, now = Date.now()) => midnight(now, -(periodDays - 1));

/** The server's counts over every lead in the period, with the period before (Marketing's producer, read
 *  through the shared INT-340 seam). Only the figures change: the daily chart and top forms stay on the
 *  records they are drawn from. Structural, so this file needs nothing from the read itself. */
export type OverviewServerFigures = {
  leads: number;
  tagged: number;
  opportunities: number;
  sources: readonly { key: string; label: string; count: number }[];
  otherSources: number;
  untagged: number;
};

export function withServerOverview(model: MarketingOverviewModel, current: OverviewServerFigures, previous: OverviewServerFigures | null): MarketingOverviewModel {
  const named = current.sources.slice(0, NAMED_SOURCES);
  const rest = current.sources.slice(NAMED_SOURCES).reduce((sum, row) => sum + row.count, 0) + current.otherSources;
  return {
    ...model,
    capped: false,
    leads: { count: current.leads, tagged: current.tagged, delta: previous ? deltaOf(current.leads, previous.leads) : null },
    opportunities: { count: current.opportunities, delta: previous ? deltaOf(current.opportunities, previous.opportunities) : null },
    sources: [
      ...named.map((row) => ({ key: row.key, label: row.label, count: row.count, kind: "tag" as const })),
      ...(rest ? [{ key: "__other", label: "Other sources", count: rest, kind: "other" as const }] : []),
      ...(current.untagged ? [{ key: "__untagged", label: "No tracking tag", count: current.untagged, kind: "untagged" as const }] : []),
    ],
  };
}

