// The door's REAL export binding: the page's PUBLISHED columns + the tenant's brand floor →
// the ONE shared builder (supabase/functions/_shared/growth/export-portable.ts — the same file
// the Studio's download card binds), so a deployed hosted copy and a downloaded export are
// built by one implementation and can never drift. The sha256 of the built HTML is the
// deployment's identity and the verification target.
import { PAIGE_APP_ORIGIN } from "../canonical-app-url.ts";
import { buildPortableExport, PortableExportRefused } from "../growth/export-portable.ts";
import { buildGrowthBrandFloor } from "../../../../src/components/growth/growth-theme.ts";
import type { GrowthBlock, GrowthPageTheme } from "../growth/types.ts";
import type { HostingExport } from "../growth-hosting-command/contract.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

/** The row shape peek_tenant_portal_brand returns (the same reader the Studio's loadBrand uses). */
type BrandRow = Record<string, string | null> | null | undefined;

export async function buildHostingExport(
  admin: Client,
  page: Record<string, unknown>,
  tenantSlug: string,
): Promise<HostingExport | null> {
  if (page.status !== "published") return null;
  const blocks = Array.isArray(page.blocks_json) ? (page.blocks_json as GrowthBlock[])
    : typeof page.blocks_json === "string" ? safeParseBlocks(page.blocks_json) : [];
  const theme = (typeof page.theme_json === "object" && page.theme_json !== null ? page.theme_json : null) as GrowthPageTheme | null;
  const seo = (typeof page.seo_json === "object" && page.seo_json !== null ? page.seo_json : null) as { description?: string; og_image?: string } | null;

  const { data: brandData, error: brandError } = await admin.rpc("peek_tenant_portal_brand", { _slug: tenantSlug });
  if (brandError) return null;
  const brandRow = ((Array.isArray(brandData) ? brandData[0] : brandData) as BrandRow) ?? null;

  try {
    const built = buildPortableExport({
      status: "published",
      tenantSlug,
      tenantName: brandRow?.tenant_name ?? null,
      pageId: String(page.id),
      pageSlug: String(page.slug ?? ""),
      pageTitle: String(page.title ?? ""),
      publishedAt: typeof page.published_at === "string" ? page.published_at : null,
      blocks,
      theme,
      seo,
      brandFloor: buildGrowthBrandFloor(brandRow as never),
    }, { origin: PAIGE_APP_ORIGIN, exportedAt: new Date().toISOString() });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(built.html));
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { html: built.html, fileName: built.fileName, sha256 };
  } catch (e) {
    if (e instanceof PortableExportRefused) return null;
    console.error("[growth-hosting] export build failed", (e as Error)?.message);
    return null;
  }
}

function safeParseBlocks(raw: string): GrowthBlock[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GrowthBlock[]) : [];
  } catch {
    return [];
  }
}
