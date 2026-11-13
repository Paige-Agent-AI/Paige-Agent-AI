import type { ContentPiece } from "./marketing-content-model";
import { readSocialSchedule, storedSocialSchedule, type SocialSchedule } from "../../supabase/functions/_shared/social-publish-command/schedule";

export type SocialMediaPreview = { contentId: string; type: "image" | "video"; url: string; alt: string };
export type SocialPerformance = { state: "unavailable" | "available" | "pending" | "unsupported" | "error"; checkedAt: string | null; values: Record<string, number>; measuredAt?: string; lastCheckState?: string };
export type SocialDeskPost = {
  key: string; pieceId: string; receiptId: string | null; title: string; caption: string; platform: string | null;
  destination: string | null; status: string; url: string | null; updatedAt: string; revision: string | null;
  media: SocialMediaPreview[]; performance: SocialPerformance;
  schedule?: SocialSchedule;
};
export const SOCIAL_ATTEMPT_PENDING = new Set(["approved", "publishing", "outcome_unknown", "registered", "scheduled", "schedule_changing"]);
const PLATFORM = new Set(["tiktok","instagram","facebook","linkedin","youtube","x","threads","pinterest","google_business","snapchat","discord","telegram"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const record = (x: unknown): Record<string, unknown> | null => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
const str = (x: unknown): string | null => typeof x === "string" && x.trim() ? x : null;
export function safeSocialUrl(value: unknown): string | null {
  try { const u = new URL(String(value)); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function snapshotMedia(value: unknown): SocialMediaPreview[] {
  let parsed: unknown; try { parsed = typeof value === "string" ? JSON.parse(value) : value; } catch { return []; }
  if (!Array.isArray(parsed) || parsed.length > 20) return [];
  const assets: SocialMediaPreview[] = [];
  for (const item of parsed) {
    const a = record(item), url = safeSocialUrl(a?.source_url);
    if (!a || typeof a.content_id !== "string" || !UUID.test(a.content_id) || !url || !["image","video"].includes(String(a.type))) return [];
    assets.push({contentId:a.content_id,type:a.type as "image"|"video",url,alt:str(a.alt_text) ?? "Saved post media"});
  }
  return assets;
}
export function publicationPerformance(value: unknown): SocialPerformance {
  const a = record(value), values: Record<string,number> = {};
  for (const key of ["views","likes","comments","shares","reposts","quotes","clicks"]) {
    const v = record(a?.metrics)?.[key]; if (typeof v === "number" && Number.isFinite(v) && v >= 0) values[key] = v;
  }
  const state = ["available","pending","unsupported","error"].includes(String(a?.state)) ? a?.state as SocialPerformance["state"] : "unavailable";
  const checkedAt = str(a?.checked_at);
  const measured = str(a?.measured_at), lastCheck = str(a?.last_check_state);
  return {state:state === "available" && !Object.keys(values).length ? "pending" : state,checkedAt:checkedAt && Number.isFinite(Date.parse(checkedAt)) ? checkedAt : null,values,
    ...(measured && Number.isFinite(Date.parse(measured)) ? {measuredAt:measured} : {}),
    ...(lastCheck && ["available","pending","unsupported","error","unverified","stale"].includes(lastCheck) ? {lastCheckState:lastCheck} : {})};
}

/** A projection of original library + publication rows. Catalog status never implies a social post. */
export function socialDeskPosts(tenantId: string, pieces: ContentPiece[], rows: unknown): SocialDeskPost[] {
  if (!Array.isArray(rows)) throw Error("Social publication read could not be verified.");
  const byId = new Map(pieces.map(p=>[p.id,p]));
  const posts: SocialDeskPost[] = [], revisions = new Map<string,Set<string>>();
  for (const value of rows) {
    const row = record(value);
    if (!row || row.tenant_id !== tenantId) throw Error("Social publication workspace changed.");
    // Website output and Go Live records stay with their original surfaces.
    if (typeof row.platform !== "string" || !PLATFORM.has(row.platform) || typeof row.content_id !== "string" || !UUID.test(row.content_id)) continue;
    if (typeof row.id !== "string" || !UUID.test(row.id) || typeof row.status !== "string") throw Error("Social receipt identity could not be verified.");
    const args = record(row.request_args), piece = byId.get(row.content_id), revision = str(args?.content_revision);
    if (revision && (SOCIAL_ATTEMPT_PENDING.has(row.status) || ["published","partial"].includes(row.status))) { const set = revisions.get(row.content_id) ?? new Set<string>(); set.add(revision); revisions.set(row.content_id,set); }
    posts.push({key:`publication:${row.id}`,pieceId:row.content_id,receiptId:row.id,title:piece?.title || "Saved social post",
      caption:str(args?.caption) ?? "",platform:row.platform,destination:str(args?.channel_label),status:row.status,
      url:safeSocialUrl(row.provider_post_url),updatedAt:str(row.updated_at) ?? str(row.created_at) ?? "",revision,
      media:snapshotMedia(args?.media_snapshot),performance:publicationPerformance(record(row.provider_response)?.analytics),
      schedule:readSocialSchedule(record(record(row.provider_response)?.schedule)?.current) ?? storedSocialSchedule(args?.schedule) ?? undefined});
  }
  for (const piece of pieces) {
    if (piece.channel !== "social_post" || piece.status === "archived" || revisions.get(piece.id)?.has(piece.updated_at)) continue;
    const ids = record(piece.meta)?.media_content_ids;
    const media: SocialMediaPreview[] = [];
    if (Array.isArray(ids)) for (const id of ids) { const a = byId.get(String(id)), url = safeSocialUrl(a?.image_url);
      if (a && url && ["image","video"].includes(a.kind)) media.push({contentId:a.id,type:a.kind as "image"|"video",url,alt:a.title || "Saved post media"}); }
    posts.push({key:`content:${piece.id}`,pieceId:piece.id,receiptId:null,title:piece.title || "Untitled post",caption:piece.body || "",
      platform:str(record(piece.meta)?.social_platform),destination:null,status:"draft",url:null,updatedAt:piece.updated_at,
      revision:piece.updated_at,media,performance:{state:"unavailable",checkedAt:null,values:{}}});
  }
  return posts.sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0)||a.key.localeCompare(b.key));
}
