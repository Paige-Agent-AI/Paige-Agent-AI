// THE LANDING-PAGE LIST READ — one home for every Paige surface that lists a workspace's pages.
//
// EXP08 A2b (plan S2): moved out of paige-ai-chat's `growth_list` branch, byte for byte, so the
// Team Hub agent turn resolves "publish the spring page" through the same read the chat uses (§18).
// The chat's behaviour is unchanged (§58): ./list-pages.test.ts runs the code as it stood in the chat
// and this helper against the same fake and asserts the same wire requests and the same result.
//
// Pages only. Forms and funnels are not listed here (A2b plan section 8).
//
// Scope (§9): the page list goes through the CALLER'S own session and is EXPLICITLY pinned to the
// server-derived workspace. Don't rely on RLS alone: a platform admin's manage-RLS would span
// tenants, and the URLs below are built from that one workspace's slug — cross-tenant rows would get
// wrong links (§13). No workspace → an empty list, never a leak. The service role reads only the
// workspace's own public slug, and only when a published page needs a real URL.

/** The query builder subset this read uses. A supabase-js client satisfies it structurally. */
export interface GrowthPageListClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export type GrowthPageListItem = { id: unknown; slug: unknown; title: unknown; status: unknown; url: string | null };
export type GrowthPageListResult = { success: true; count: number; pages: GrowthPageListItem[] };

/**
 * List the workspace's landing pages, most recently updated first, at most 100. A published page
 * carries its REAL public URL (§13 — never a made-up link); drafts have none yet.
 * Throws the page query's own error object, exactly as the chat branch did.
 */
export async function listGrowthPages(caller: GrowthPageListClient, admin: GrowthPageListClient, tenantId: string | null): Promise<GrowthPageListResult> {
  const _listTid = tenantId ?? null;
  const { data: pages, error } = _listTid
    ? await caller
        .from("growth_pages")
        .select("id, slug, title, status, published_at, updated_at")
        .eq("tenant_id", _listTid)
        .order("updated_at", { ascending: false })
        .limit(100)
    // deno-lint-ignore no-explicit-any
    : { data: [] as any[], error: null };
  if (error) throw error;
  // Resolve the tenant slug once to build the REAL public URL for published
  // pages (§13 — never a made-up link); drafts have no public URL yet.
  let tenantSlug: string | null = null;
  // deno-lint-ignore no-explicit-any
  if ((pages || []).some((p: any) => p.status === "published") && tenantId) {
    const { data: t } = await admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
    // deno-lint-ignore no-explicit-any
    tenantSlug = (t as any)?.slug ?? null;
  }
  return {
    success: true,
    count: (pages || []).length,
    // deno-lint-ignore no-explicit-any
    pages: (pages || []).map((p: any) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      status: p.status,
      url: p.status === "published" && tenantSlug ? `/p/${tenantSlug}/${p.slug}` : null,
    })),
  };
}
