import { subtabBySlug } from "@/lib/routing/tierBranches";

// Ads became its own department below Marketing (owner ruling 2026-10-10, INT-342). Until then the
// desk lived at `/solo/{account}/growth/ads` and kept its view in `?view=`. Navigation compatibility
// only: account authorization stays with the Solo shell, and the address is never the grant (§9).

const NOT_CARRIED = ["view", "returnTo", "redirect", "next", "tenant", "tenantId", "tenant_id", "account", "role", "token", "access_token", "refresh_token"];

/** The Ads address for a view, keeping every other query value and the hash. Overview is the bare branch. */
export function adsAddress(account: string, view: string | null, search: string, hash: string): string {
  const query = new URLSearchParams(search);
  for (const key of NOT_CARRIED) query.delete(key);
  const slug = view && view !== "overview" ? subtabBySlug("solo", "ads", view)?.slug ?? null : null;
  const suffix = query.toString();
  return `/solo/${encodeURIComponent(account)}/ads${slug ? `/${slug}` : ""}${suffix ? `?${suffix}` : ""}${hash}`;
}

/** `/growth/ads[?view=]` → the Ads department, same view. Null for every other Marketing address. */
export function legacyAdsRoute(account: string | null, segment: string, search: string, hash: string): string | null {
  if (!account || segment !== "ads") return null;
  return adsAddress(account, new URLSearchParams(search).get("view"), search, hash);
}
