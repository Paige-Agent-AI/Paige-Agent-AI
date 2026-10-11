import { subtabBySlug } from "@/lib/routing/tierBranches";

// Ads became its own department below Marketing (owner ruling 2026-10-10, INT-342). Until then the
// desk lived at `/solo/{account}/growth/ads` and kept its view in `?view=`. Navigation compatibility
// only: account authorization stays with the Solo shell, and the address is never the grant (§9).

// Only campaign tracking tags travel with a moved link. Nothing on Ads reads any other query value,
// and an allowlist means an identity, token or redirect key can never ride along.
const CARRIED = /^utm_[a-z_]+$/;

/** The Ads address for a view, keeping only tracking tags and the hash. Overview is the bare branch. */
export function adsAddress(account: string, view: string | null, search: string, hash: string): string {
  const query = new URLSearchParams();
  new URLSearchParams(search).forEach((value, key) => { if (CARRIED.test(key)) query.append(key, value); });
  const slug = view && view !== "overview" ? subtabBySlug("solo", "ads", view)?.slug ?? null : null;
  const suffix = query.toString();
  return `/solo/${encodeURIComponent(account)}/ads${slug ? `/${slug}` : ""}${suffix ? `?${suffix}` : ""}${hash}`;
}

/** `/growth/ads[?view=]` → the Ads department, same view. Null for every other Marketing address. */
export function legacyAdsRoute(account: string | null, segment: string, search: string, hash: string): string | null {
  if (!account || segment !== "ads") return null;
  return adsAddress(account, new URLSearchParams(search).get("view"), search, hash);
}
