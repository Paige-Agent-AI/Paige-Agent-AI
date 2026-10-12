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
/** One row per ad tag (merged across campaigns). `contentId`, `kind` and `imageUrl` are set when the tag
 *  is the id of one of the business's own pictures or videos; otherwise all three are null. */
export type FunnelAd = FunnelOutcome & { ad: string; campaign: string | null; contentId: string | null; kind: "image" | "video" | null; imageUrl: string | null };
export type LeadFunnel = {
  pipeline: { id: string; name: string; isDefault: boolean };
  /** CURRENT deals in each stage: never limited to the window. */
  stages: FunnelStage[];
  /** Leads in the window. `unfiled` is this business's submissions in the window that reached no pipeline. */
  leads: { total: number; tagged: number; untagged: number; unfiled: number };
  campaigns: FunnelCampaign[];
  ads: FunnelAd[];
  since: string | null;
};

const ROW_CAP = 50;
const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const str = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const STAGE_TYPES: StageType[] = ["open", "won", "lost"];
/** The key a tag is counted under, the server's lower(btrim(tag)). */
export const tagKey = (tag: string) => tag.trim().toLowerCase();
// The contract's order for both lists: won desc, leads desc, key asc.
const byOutcome = <T extends FunnelOutcome>(key: (row: T) => string) => (a: T, b: T) => b.won - a.won || b.leads - a.leads || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/** Reads `get_pipeline_lead_funnel`'s jsonb (contract v2, src/solo/__fixtures__/lead-funnel.contract.json).
 *  Returns null when the answer is not that shape, so the page falls back to its own records instead of
 *  drawing a half-read answer. Rows are keyed case-insensitively; two spellings of one key (never sent by
 *  the server, but never drawn twice either) merge into the first. */
export function parseLeadFunnel(raw: unknown): LeadFunnel | null {
  const value = typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const pipeline = body.pipeline as Record<string, unknown> | undefined;
  if (!pipeline || typeof pipeline.id !== "string" || !Array.isArray(body.stages)) return null;
  const leads = (body.leads ?? {}) as Record<string, unknown>;
  const outcome = (row: Record<string, unknown>): FunnelOutcome => ({ leads: num(row.leads), open: num(row.open), won: num(row.won), lost: num(row.lost) });
  const add = (into: FunnelOutcome, from: FunnelOutcome) => { into.leads += from.leads; into.open += from.open; into.won += from.won; into.lost += from.lost; };
  const stages = (body.stages as Record<string, unknown>[]).filter((row) => row && typeof row.id === "string").map((row) => ({
    id: row.id as string,
    name: str(row.name) || "Untitled stage",
    orderIndex: Number(row.order_index ?? row.orderIndex ?? 0) || 0,
    stageType: STAGE_TYPES.includes(row.stage_type as StageType) ? (row.stage_type as StageType) : "open",
    deals: num(row.deals),
  })).sort((a, b) => a.orderIndex - b.orderIndex);
  const campaigns = new Map<string, FunnelCampaign>();
  for (const row of Array.isArray(body.campaigns) ? body.campaigns as Record<string, unknown>[] : []) {
    if (!row || !str(row.campaign).trim()) continue;
    const name = str(row.campaign).trim();
    const byStage: Record<string, number> = {};
    const raw = (row.by_stage ?? row.byStage) as Record<string, unknown> | undefined;
    if (raw && typeof raw === "object") for (const [stage, count] of Object.entries(raw)) byStage[stage] = num(count);
    const existing = campaigns.get(tagKey(name));
    if (!existing) { campaigns.set(tagKey(name), { campaign: name, byStage, ...outcome(row) }); continue; }
    add(existing, outcome(row));
    for (const [stage, count] of Object.entries(byStage)) existing.byStage[stage] = (existing.byStage[stage] ?? 0) + count;
  }
  const ads = new Map<string, FunnelAd>();
  for (const row of Array.isArray(body.ads) ? body.ads as Record<string, unknown>[] : []) {
    if (!row || !str(row.ad).trim()) continue;
    const ad = str(row.ad).trim();
    const existing = ads.get(tagKey(ad));
    if (existing) { add(existing, outcome(row)); continue; }
    const contentId = str(row.content_id ?? row.contentId).trim() || null;
    const kind = contentId && (row.kind === "image" || row.kind === "video") ? row.kind : null;
    ads.set(tagKey(ad), {
      ad, campaign: str(row.campaign).trim() || null, contentId, kind,
      imageUrl: contentId ? str(row.image_url ?? row.imageUrl).trim() || null : null,
      ...outcome(row),
    });
  }
  const total = num(leads.total);
  const tagged = Math.min(total, num(leads.tagged));
  return {
    pipeline: { id: pipeline.id, name: str(pipeline.name) || "Untitled pipeline", isDefault: pipeline.is_default === true || pipeline.isDefault === true },
    stages,
    leads: { total, tagged, untagged: leads.untagged === undefined ? Math.max(0, total - tagged) : num(leads.untagged), unfiled: num(leads.unfiled) },
    campaigns: [...campaigns.values()].sort(byOutcome((row) => tagKey(row.campaign))).slice(0, ROW_CAP),
    ads: [...ads.values()].sort(byOutcome((row) => tagKey(row.ad))).slice(0, ROW_CAP),
    since: typeof body.since === "string" ? body.since : null,
  };
}

/** One lead as the page's records hold it: when it arrived, the deal it became, and its link's tags. */
export type FunnelSubmission = { createdAt: string; dealId: string | null; campaign: string | null; ad: string | null };
type Outcome = "open" | "won" | "lost";

/** The same shape as the server read, counted the server's way from the records the page holds: keys
 *  case-folded and shown in their most recent spelling; leads count submissions; open/won/lost are LAST
 *  TOUCH (each deal once, under its most recent tagged submission in the window, by its current status).
 *  Stage totals count every deal the workspace read returned; the lead rows count only the submissions
 *  passed in. `content` (the business's own pictures and videos, when the page holds them) names an ad
 *  tag that is a library id. */
export function deriveLeadFunnel(input: {
  pipeline: Pick<PipelineRecord, "id" | "name" | "isDefault">;
  stages: readonly PipelineStage[];
  deals: readonly (Pick<PipelineDeal, "id" | "pipelineId" | "stageId"> & { status?: string })[];
  submissions: readonly FunnelSubmission[];
  since: string | null;
  content?: readonly Pick<MediaRow, "id" | "kind" | "image_url">[];
}): LeadFunnel {
  const pipelineId = input.pipeline.id;
  const stages = input.stages.filter((stage) => stage.pipelineId === pipelineId && !stage.archivedAt).sort((a, b) => a.orderIndex - b.orderIndex);
  const stageType = new Map(input.stages.map((stage) => [stage.id, stage.stageType]));
  const perStage = new Map<string, number>();
  for (const deal of input.deals) if (deal.pipelineId === pipelineId) perStage.set(deal.stageId, (perStage.get(deal.stageId) ?? 0) + 1);
  const deals = new Map(input.deals.map((deal) => [deal.id, deal]));
  const since = input.since ? Date.parse(input.since) : null;
  const inWindow = (row: FunnelSubmission) => since === null || Date.parse(row.createdAt) >= since;
  // Newest first, so the first spelling and the first tagged touch met are the most recent.
  const leads = input.submissions.filter((row) => inWindow(row) && row.dealId && deals.get(row.dealId)?.pipelineId === pipelineId)
    .map((row) => ({ row, campaign: row.campaign?.trim() || null, ad: row.ad?.trim() || null, at: Date.parse(row.createdAt) || 0 }))
    .sort((a, b) => b.at - a.at);
  const statusOf = (dealId: string): Outcome => {
    const deal = deals.get(dealId)!;
    return deal.status === "open" || deal.status === "won" || deal.status === "lost" ? deal.status : stageType.get(deal.stageId) ?? "open";
  };

  const spelling = { campaign: new Map<string, string>(), ad: new Map<string, string>() };
  const leadCount = { campaign: new Map<string, number>(), ad: new Map<string, number>() };
  const adCampaign = new Map<string, Map<string, { n: number; at: number }>>();
  const touched = new Set<string>();
  const deal = { campaign: new Map<string, FunnelOutcome & { byStage: Record<string, number> }>(), ad: new Map<string, FunnelOutcome>() };
  const blank = () => ({ leads: 0, open: 0, won: 0, lost: 0 });
  let tagged = 0;
  for (const { row, campaign, ad, at } of leads) {
    const ck = campaign ? tagKey(campaign) : null;
    const ak = ad ? tagKey(ad) : null;
    if (!ck && !ak) continue;
    tagged += 1;
    if (ck) { if (!spelling.campaign.has(ck)) spelling.campaign.set(ck, campaign!); leadCount.campaign.set(ck, (leadCount.campaign.get(ck) ?? 0) + 1); }
    if (ak) {
      if (!spelling.ad.has(ak)) spelling.ad.set(ak, ad!);
      leadCount.ad.set(ak, (leadCount.ad.get(ak) ?? 0) + 1);
      if (ck) {
        const per = adCampaign.get(ak) ?? new Map();
        const entry = per.get(ck) ?? { n: 0, at: 0 };
        per.set(ck, { n: entry.n + 1, at: Math.max(entry.at, at) });
        adCampaign.set(ak, per);
      }
    }
    // Last touch: this is the deal's most recent tagged submission in the window.
    const dealId = row.dealId as string;
    if (touched.has(dealId)) continue;
    touched.add(dealId);
    const status = statusOf(dealId);
    if (ck) {
      const entry = deal.campaign.get(ck) ?? { ...blank(), byStage: {} };
      entry[status] += 1;
      const stageId = deals.get(dealId)!.stageId;
      entry.byStage[stageId] = (entry.byStage[stageId] ?? 0) + 1;
      deal.campaign.set(ck, entry);
    }
    if (ak) { const entry = deal.ad.get(ak) ?? blank(); entry[status] += 1; deal.ad.set(ak, entry); }
  }
  const library = new Map((input.content ?? []).filter((row) => row.kind === "image" || row.kind === "video").map((row) => [row.id.toLowerCase(), row]));
  const campaigns: FunnelCampaign[] = [...leadCount.campaign.entries()].map(([key, count]) => {
    const outcome = deal.campaign.get(key);
    return { campaign: spelling.campaign.get(key)!, byStage: outcome?.byStage ?? {}, leads: count, open: outcome?.open ?? 0, won: outcome?.won ?? 0, lost: outcome?.lost ?? 0 };
  });
  const ads: FunnelAd[] = [...leadCount.ad.entries()].map(([key, count]) => {
    const outcome = deal.ad.get(key);
    const top = [...(adCampaign.get(key)?.entries() ?? [])].sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    const own = library.get(key);
    return {
      ad: spelling.ad.get(key)!, campaign: top ? spelling.campaign.get(top)! : null,
      contentId: own?.id ?? null, kind: own ? (own.kind as "image" | "video") : null, imageUrl: own?.image_url ?? null,
      leads: count, open: outcome?.open ?? 0, won: outcome?.won ?? 0, lost: outcome?.lost ?? 0,
    };
  });
  return {
    pipeline: { id: pipelineId, name: input.pipeline.name || "Untitled pipeline", isDefault: input.pipeline.isDefault },
    stages: stages.map((stage) => ({ id: stage.id, name: stage.label || "Untitled stage", orderIndex: stage.orderIndex, stageType: stage.stageType, deals: perStage.get(stage.id) ?? 0 })),
    leads: { total: leads.length, tagged, untagged: leads.length - tagged, unfiled: input.submissions.filter((row) => !row.dealId && inWindow(row)).length },
    campaigns: campaigns.sort(byOutcome((row) => tagKey(row.campaign))).slice(0, ROW_CAP),
    ads: ads.sort(byOutcome((row) => tagKey(row.ad))).slice(0, ROW_CAP),
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

/** A page or form's public link with the picture's tag (and a campaign tag, when given) joined on: an
 *  existing query is kept, an existing utm_content or utm_campaign is replaced, and a #fragment stays at
 *  the end. `href` may be relative to `origin`. Null when it is not an http(s) link. */
export function taggedLink(href: string, origin: string, tags: { content: string; campaign?: string | null }): string | null {
  let url: URL;
  try { url = new URL(href, origin); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set("utm_content", tags.content);
  const campaign = tags.campaign?.trim();
  if (campaign) url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

/** Fills the placements in order: featured (newest feature first), then performing (won deals, then
 *  leads, from the funnel's ad row whose content_id, or else whose tag, is this picture's id), then newest. Pictures with no safe
 *  file are left out, so a slot never shows a broken image. `justAdded` is a picture the owner uploaded
 *  in this visit: it takes the first placement until they leave, so an upload is always seen where it
 *  will run (the page says it stays only if featured). */
export function rankShowroomMedia(media: readonly MediaRow[], ads: readonly (Pick<FunnelAd, "ad" | "leads" | "won"> & { contentId?: string | null })[] | null, slots = 3, justAdded: string | null = null): ShowroomPick[] {
  // Keyed by the library id the server matched (content_id); a row without one is matched by its tag.
  const performance = new Map<string, { leads: number; won: number }>();
  for (const row of ads ?? []) {
    const key = (row.contentId ?? row.ad).trim().toLowerCase();
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
