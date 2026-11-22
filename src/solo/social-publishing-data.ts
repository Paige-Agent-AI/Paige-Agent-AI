import { supabase } from "@/integrations/supabase/client";
import type { ContentPiece } from "./marketing-content-model";
import { socialDeskPosts } from "./social-publishing-model";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";

// The existing protected library and original publication reader remain the only stores.
const COLUMNS = "id,kind,channel,status,title,body,image_url,size,brief,meta,updated_at";
export const SOCIAL_LIBRARY_LIMIT = 100;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function readSocialPiece(tenantId: string, id: string): Promise<ContentPiece | null> {
  const { data, error } = await supabase.from("marketing_content" as never).select(COLUMNS)
    .eq("tenant_id", tenantId).eq("id", id).neq("status", "archived").maybeSingle();
  if (error) throw error;
  return data as unknown as ContentPiece | null;
}
export async function readSocialDesk(tenantId: string, canManage: boolean, pieceId: string | null) {
  const receipts = await supabase.rpc("content_publication_list" as never, { p_content_id: null, p_tenant_id: tenantId } as never);
  if (receipts.error) throw receipts.error;
  let pieces: ContentPiece[] = [];
  let capped = false;
  if (canManage) {
    const library = await supabase.from("marketing_content" as never).select(COLUMNS)
      .eq("tenant_id", tenantId).neq("status", "archived").order("updated_at", { ascending: false }).limit(SOCIAL_LIBRARY_LIMIT);
    if (library.error) throw library.error;
    pieces = (library.data ?? []) as unknown as ContentPiece[];
    capped = pieces.length === SOCIAL_LIBRARY_LIMIT;
    // An original deep link still works when its piece is older than the gallery window.
    if (pieceId && !pieces.some(p => p.id === pieceId)) {
      const piece = await readSocialPiece(tenantId, pieceId);
      if (piece) pieces = [...pieces, piece];
    }
    const loaded = new Set(pieces.map(p => p.id));
    const mediaIds = [...new Set(pieces.flatMap(p => Array.isArray(p.meta?.media_content_ids) && p.meta.media_content_ids.length <= 20
      ? p.meta.media_content_ids.filter((id): id is string => typeof id === "string" && UUID.test(id) && !loaded.has(id)) : []))];
    // A saved post may refer to original media older than the recent-library window.
    for (let offset = 0; offset < mediaIds.length; offset += 100) {
      const assets = await supabase.from("marketing_content" as never).select(COLUMNS).eq("tenant_id", tenantId)
        .in("id", mediaIds.slice(offset, offset + 100)).neq("status", "archived");
      if (assets.error) throw assets.error;
      pieces.push(...((assets.data ?? []) as unknown as ContentPiece[]));
    }
  }
  return { pieces, posts: socialDeskPosts(tenantId, pieces, receipts.data), capped };
}

export async function checkSocialPerformance(tenantId: string, contentId: string, publicationId: string): Promise<void> {
  const result = await supabase.functions.invoke("social-publish-command", { body: {
    action: "performance", expected_tenant_id: tenantId, content_id: contentId, publication_id: publicationId,
  } });
  const errorBody = await readFunctionErrorBody(result.error, result.data);
  if (result.error || result.data?.state !== "performance" || result.data?.publication_id !== publicationId) {
    throw Error(typeof errorBody?.error === "string" ? errorBody.error : "The original post’s performance could not be checked. Try again later.");
  }
}

export type SocialDraft = { title: string; caption: string; mediaIds: string[] };
const recoveryKey = (tenantId: string) => `paige:social-draft-save:${tenantId}`;
export function pendingSocialDraft(tenantId: string): string | null {
  try { return sessionStorage.getItem(recoveryKey(tenantId)); } catch { return null; }
}
function remember(tenantId: string, key: string | null) {
  // A failed recovery marker must stop creation; a timeout can otherwise duplicate the original save.
  if (key) sessionStorage.setItem(recoveryKey(tenantId), key);
  else sessionStorage.removeItem(recoveryKey(tenantId));
}
export async function recoverSocialDraft(tenantId: string): Promise<ContentPiece | null> {
  const key = pendingSocialDraft(tenantId);
  if (!key) return null;
  const { data, error } = await supabase.from("marketing_content" as never).select(COLUMNS)
    .eq("tenant_id", tenantId).contains("meta", { social_draft_key: key }).limit(2);
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1) return null;
  remember(tenantId, null);
  return data[0] as unknown as ContentPiece;
}
/** An uncertain create is only looked up, never replayed. Revisions use the original content id. */
export async function saveSocialDraft(tenantId: string, draft: SocialDraft, original: ContentPiece | null): Promise<ContentPiece> {
  if (!draft.caption.trim()) throw Error("Add a caption before saving.");
  if (!original && pendingSocialDraft(tenantId)) throw Error("Check the previous draft save before creating another post.");
  const key = original ? null : crypto.randomUUID();
  if (key) remember(tenantId, key);
  const meta = { ...(original?.meta ?? {}), media_content_ids: draft.mediaIds, ...(key ? { social_draft_key: key } : {}) };
  let saved;
  try {
    saved = await supabase.rpc("save_marketing_content" as never, {
      p_kind: "text", p_title: draft.title.trim() || "Untitled social post", p_body: draft.caption,
      p_channel: "social_post", p_meta: meta, p_id: original?.id ?? null, p_tenant_id: tenantId,
    } as never);
  } catch { throw Error("The draft save is unconfirmed. Check the same save before trying again."); }
  if (saved.error || typeof saved.data !== "string") {
    if (key && ["42501", "22023", "P0002"].includes(saved.error?.code ?? "")) remember(tenantId, null);
    throw Error("The draft save could not be confirmed. Check the same save before trying again.");
  }
  const piece = await readSocialPiece(tenantId, saved.data);
  if (!piece) throw Error("The saved draft could not be read back. Check the same save before trying again.");
  if (key) remember(tenantId, null);
  return piece;
}
