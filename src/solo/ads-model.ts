// The Ads department's evidence model (owner rulings 2026-10-11). Pure and framework-free.
//
// Sales pipelines are the lifecycle of a lead, and Marketing, Sales and Ads read the SAME pipelines and
// stages. This module holds three things:
//
//   1. The pipeline lead funnel, in the exact shape of the server read `get_pipeline_lead_funnel`
//      (deals per stage of one pipeline, and the leads that reached it counted per campaign tag and per
//      ad tag). `parseLeadFunnel` reads the server's answer; `deriveLeadFunnel` builds the same shape
//      from records the page already holds, for when that read is not available (it counts only the
//      submissions the page read, so the page says so).
//   2. The showroom ranking: which of the business's own pictures and videos stand in the ad
//      placements. Featured first (the owner's choice), then the ones whose tracking tag brought the most
//      won deals and leads, then the newest. Nothing else ranks them; there are no provider figures.
//   3. Small helpers for the featured flag and the tracking tag.
//
// Every figure is a count of the workspace's own records. Nothing is spend, reach, clicks or return, and
// nothing is estimated. A tracking tag says which link a visitor arrived on; it never proves an ad was
// paid for.
import type { PipelineDeal, PipelineRecord, PipelineStage, StageType } from "./useSoloCampaigns";
import { safeMediaUrl } from "./marketing-content-model";

/* ───────── the funnel: one shape, from the server or from the page's records ───────── */

export type FunnelStage = { id: string; name: string; orderIndex: number; stageType: StageType; deals: number };
export type FunnelOutcome = { leads: number; open: number; won: number; lost: number };
export type FunnelCampaign = FunnelOutcome & { campaign: string; byStage: Record<string, number> };
export type FunnelAd = FunnelOutcome & { ad: string; campaign: string | null };
export type LeadFunnel = {
  pipeline: { id: string; name: string; isDefault: boolean };
  stages: FunnelStage[];
  leads: { total: number; tagged: number; untagged: number };
  campaigns: FunnelCampaign[];
  ads: FunnelAd[];
  since: string | null;
};

const ROW_CAP = 50;
const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const str = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const STAGE_TYPES: StageType[] = ["open", "won", "lost"];
const byOutcome = <T extends FunnelOutcome>(a: T, b: T) => b.won - a.won || b.leads - a.leads;

/** Reads `get_pipeline_lead_funnel`'s jsonb. Returns null when the answer is not that shape, so the page
 *  falls back to its own records instead of drawing a half-read answer. */
export function parseLeadFunnel(raw: unknown): LeadFunnel | null {
  const value = typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const pipeline = body.pipeline as Record<string, unknown> | undefined;
  if (!pipeline || typeof pipeline.id !== "string" || !Array.isArray(body.stages)) return null;
  const leads = (body.leads ?? {}) as Record<string, unknown>;
  const outcome = (row: Record<string, unknown>): FunnelOutcome => ({ leads: num(row.leads), open: num(row.open), won: num(row.won), lost: num(row.lost) });
  const stages = (body.stages as Record<string, unknown>[]).filter((row) => row && typeof row.id === "string").map((row) => ({
    id: row.id as string,
    name: str(row.name) || "Untitled stage",
    orderIndex: Number(row.order_index ?? row.orderIndex ?? 0) || 0,
    stageType: STAGE_TYPES.includes(row.stage_type as StageType) ? (row.stage_type as StageType) : "open",
    deals: num(row.deals),
  })).sort((a, b) => a.orderIndex - b.orderIndex);
  const campaigns = (Array.isArray(body.campaigns) ? body.campaigns as Record<string, unknown>[] : [])
    .filter((row) => row && str(row.campaign).trim())
    .map((row) => {
      const byStage: Record<string, number> = {};
      const raw = (row.by_stage ?? row.byStage) as Record<string, unknown> | undefined;
      if (raw && typeof raw === "object") for (const [stage, count] of Object.entries(raw)) byStage[stage] = num(count);
      return { campaign: str(row.campaign).trim(), byStage, ...outcome(row) };
    }).sort(byOutcome).slice(0, ROW_CAP);
  const ads = (Array.isArray(body.ads) ? body.ads as Record<string, unknown>[] : [])
    .filter((row) => row && str(row.ad).trim())
    .map((row) => ({ ad: str(row.ad).trim(), campaign: str(row.campaign).trim() || null, ...outcome(row) }))
    .sort(byOutcome).slice(0, ROW_CAP);
  const total = num(leads.total);
  const tagged = Math.min(total, num(leads.tagged));
  return {
    pipeline: { id: pipeline.id, name: str(pipeline.name) || "Untitled pipeline", isDefault: pipeline.is_default === true || pipeline.isDefault === true },
    stages,
    leads: { total, tagged, untagged: leads.untagged === undefined ? Math.max(0, total - tagged) : num(leads.untagged) },
    campaigns,
    ads,
    since: typeof body.since === "string" ? body.since : null,
  };
}

/** One lead as the page's records hold it: when it arrived, the deal it became, and its link's tags. */
export type FunnelSubmission = { createdAt: string; dealId: string | null; campaign: string | null; ad: string | null };

/** The same shape as the server read, counted from the records the page holds. Stage totals count every
 *  deal the workspace read returned; the lead rows count only the submissions passed in. */
export function deriveLeadFunnel(input: {
  pipeline: Pick<PipelineRecord, "id" | "name" | "isDefault">;
  stages: readonly PipelineStage[];
  deals: readonly Pick<PipelineDeal, "id" | "pipelineId" | "stageId">[];
  submissions: readonly FunnelSubmission[];
  since: string | null;
}): LeadFunnel {
  const pipelineId = input.pipeline.id;
  const stages = input.stages.filter((stage) => stage.pipelineId === pipelineId && !stage.archivedAt).sort((a, b) => a.orderIndex - b.orderIndex);
  const stageType = new Map(input.stages.map((stage) => [stage.id, stage.stageType]));
  const perStage = new Map<string, number>();
  for (const deal of input.deals) if (deal.pipelineId === pipelineId) perStage.set(deal.stageId, (perStage.get(deal.stageId) ?? 0) + 1);
  const deals = new Map(input.deals.map((deal) => [deal.id, deal]));
  const since = input.since ? Date.parse(input.since) : null;
  const leads = input.submissions.filter((row) => {
    const deal = row.dealId ? deals.get(row.dealId) : undefined;
    return deal?.pipelineId === pipelineId && (since === null || Date.parse(row.createdAt) >= since);
  });

  const empty = (): FunnelOutcome => ({ leads: 0, open: 0, won: 0, lost: 0 });
  const tally = (target: FunnelOutcome, stageId: string) => {
    target.leads += 1;
    target[stageType.get(stageId) ?? "open"] += 1;
  };
  const campaigns = new Map<string, FunnelCampaign>();
  const ads = new Map<string, FunnelAd & { tags: Map<string, number> }>();
  let tagged = 0;
  for (const row of leads) {
    const stageId = deals.get(row.dealId as string)!.stageId;
    const campaign = row.campaign?.trim() || null;
    const ad = row.ad?.trim() || null;
    if (campaign || ad) tagged += 1;
    if (campaign) {
      const entry = campaigns.get(campaign) ?? { campaign, byStage: {}, ...empty() };
      tally(entry, stageId);
      entry.byStage[stageId] = (entry.byStage[stageId] ?? 0) + 1;
      campaigns.set(campaign, entry);
    }
    if (ad) {
      const entry = ads.get(ad) ?? { ad, campaign: null, tags: new Map(), ...empty() };
      tally(entry, stageId);
      if (campaign) entry.tags.set(campaign, (entry.tags.get(campaign) ?? 0) + 1);
      ads.set(ad, entry);
    }
  }
  return {
    pipeline: { id: pipelineId, name: input.pipeline.name || "Untitled pipeline", isDefault: input.pipeline.isDefault },
    stages: stages.map((stage) => ({ id: stage.id, name: stage.label || "Untitled stage", orderIndex: stage.orderIndex, stageType: stage.stageType, deals: perStage.get(stage.id) ?? 0 })),
    leads: { total: leads.length, tagged, untagged: leads.length - tagged },
    campaigns: [...campaigns.values()].sort(byOutcome).slice(0, ROW_CAP),
    ads: [...ads.values()].map(({ tags, ...row }) => ({ ...row, campaign: [...tags.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null })).sort(byOutcome).slice(0, ROW_CAP),
    since: input.since,
  };
}

/** The pipelines to choose between: archived ones left out, the default first, then by name. */
export function pipelineChoices(pipelines: readonly Pick<PipelineRecord, "id" | "name" | "isDefault" | "lifecycleStatus" | "dealCount">[]) {
  return pipelines.filter((pipeline) => pipeline.lifecycleStatus !== "archived")
    .map(({ id, name, isDefault, dealCount }) => ({ id, name: name || "Untitled pipeline", isDefault, deals: dealCount ?? 0 }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/** True when a read failed because the server function is not there yet (not deployed), as opposed to
 *  failing for any other reason. Both fall back; only the words differ. */
export function isMissingFunction(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "PGRST202" || code === "42883" || /could not find the function|function .* does not exist/i.test(String(message ?? ""));
}

/* ───────── the showroom: the business's own pictures, ranked ───────── */

export const FEATURED_LIMIT = 6;
export type MediaRow = { id: string; kind: string; title: string | null; image_url: string | null; updated_at: string; meta: Record<string, unknown> | null };
export type ShowroomPick = { row: MediaRow; src: string; kind: "image" | "video"; reason: "added" | "featured" | "performing" | "recent"; leads: number; won: number };

export const isFeatured = (row: Pick<MediaRow, "meta">) => row.meta?.ads_featured === true;
const featuredAt = (row: Pick<MediaRow, "meta">) => Date.parse(String(row.meta?.ads_featured_at ?? "")) || 0;

/** The tag that credits a lead to one picture or video: its library id, as the link's utm_content. */
export const trackingTag = (contentId: string) => `utm_content=${contentId}`;

/** Fills the placements in order: featured (newest feature first), then performing (won deals, then
 *  leads, from the funnel's ad rows whose tag is this picture's id), then newest. Pictures with no safe
 *  file are left out, so a slot never shows a broken image. `justAdded` is a picture the owner uploaded
 *  in this visit: it takes the first placement until they leave, so an upload is always seen where it
 *  will run (the page says it stays only if featured). */
export function rankShowroomMedia(media: readonly MediaRow[], ads: readonly Pick<FunnelAd, "ad" | "leads" | "won">[] | null, slots = 3, justAdded: string | null = null): ShowroomPick[] {
  const performance = new Map<string, { leads: number; won: number }>();
  for (const row of ads ?? []) {
    const key = row.ad.trim().toLowerCase();
    const entry = performance.get(key) ?? { leads: 0, won: 0 };
    performance.set(key, { leads: entry.leads + row.leads, won: entry.won + row.won });
  }
  const usable = media.flatMap((row) => {
    const src = safeMediaUrl(row.image_url);
    const kind = row.kind === "video" ? "video" : row.kind === "image" ? "image" : null;
    if (!src || !kind) return [];
    const perf = performance.get(row.id.toLowerCase()) ?? { leads: 0, won: 0 };
    return [{ row, src, kind, ...perf }];
  });
  const newest = (a: { row: MediaRow }, b: { row: MediaRow }) => Date.parse(b.row.updated_at) - Date.parse(a.row.updated_at);
  const added = usable.filter((item) => item.row.id === justAdded);
  const rest = added.length ? usable.filter((item) => item.row.id !== justAdded) : usable;
  const featured = rest.filter((item) => isFeatured(item.row)).sort((a, b) => featuredAt(b.row) - featuredAt(a.row) || newest(a, b));
  const performing = rest.filter((item) => !isFeatured(item.row) && item.leads > 0).sort((a, b) => b.won - a.won || b.leads - a.leads || newest(a, b));
  const recent = rest.filter((item) => !isFeatured(item.row) && item.leads === 0).sort(newest);
  return [
    ...added.map((item) => ({ ...item, reason: "added" as const })),
    ...featured.map((item) => ({ ...item, reason: "featured" as const })),
    ...performing.map((item) => ({ ...item, reason: "performing" as const })),
    ...recent.map((item) => ({ ...item, reason: "recent" as const })),
  ].slice(0, slots) as ShowroomPick[];
}
