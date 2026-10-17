/**
 * Experience 04 E4-S3 — "See it, then verify it": the ONE client-side home that turns a read
 * REFERENCE (a destination and, for a client, its id and name) into an in-app address and the frozen
 * words the owner reads. Chat uses it now; the client record (Track D) will import the same module, so
 * the two can never name or address one record two ways.
 *
 * The address is built from the CURRENT account (never stored), through the one route map
 * `resolveCanonicalRecordLink`; the destination re-reads the record under its own session and RLS,
 * so a link grants nothing. The tier comes from the shared tier helpers (§60) — never an inline
 * account-type compare — and fails closed: a sub-account gets the client list only, every other
 * destination resolves to nothing there, and agency, enterprise, operator or no workspace get nothing.
 */
import { isSoloStandalone, resolveTierKey } from "@/lib/tier/tierFeatures";
import { resolveCanonicalRecordLink } from "../../../supabase/functions/_shared/canonical-app-url";
import type { ReadLinkDestination, ReadRecordLink } from "../../../supabase/functions/_shared/paige-turn/record-links";

export type WorkspaceLinkTier = "solo" | "sub_account";

export type WorkspaceLinkTenant = {
  account_type: string | null;
  parent_tenant_id: string | null;
  account_number?: number | string | null;
};

export function workspaceLinkTier(
  t: { account_type: string | null; parent_tenant_id: string | null } | null | undefined,
): WorkspaceLinkTier | null {
  if (!t) return null;
  const classification = { account_type: t.account_type, parent_tenant_id: t.parent_tenant_id, isPlatformStaff: false };
  if (isSoloStandalone(classification)) return "solo";
  if (resolveTierKey(classification) === "sub_account") return "sub_account";
  return null;
}

/** The frozen list labels. Exact record labels are applied only after route resolution. */
export const DESTINATION_LABEL: Readonly<Record<ReadLinkDestination, string>> = Object.freeze({
  contacts: "Open Clients",
  sales_agreements: "Open terms & agreements",
  sales_invoices: "Open invoices",
  sales_collections: "Open collections",
  operations_work: "Open delivery work",
  business_time_zone: "Open business time zone setting",
  executive: "Open Executive",
  finance: "Open Finance",
  sales_pipeline: "Open Sales pipeline",
  systems_check: "Open Systems Check",
  business_game_plan: "Open Business Game Plan",
  trust_compass: "Open Trust Compass",
  mind: "Open Mind",
  calendar: "Open Calendar",
  pipeline: "Open pipeline",
});

export type WorkspaceLinkTarget = { label: string; to: string; status: "exact" | "surface_only" };

export function workspaceLinkTarget(link: ReadRecordLink, tenant: WorkspaceLinkTenant | null | undefined): WorkspaceLinkTarget | null {
  const tier = workspaceLinkTier(tenant);
  if (!tier || !tenant) return null;
  return routeLinkTarget(link, tier, tenant.account_number ?? null);
}

/**
 * The same answer, for a surface that is ALREADY mounted inside one tier's route tree (the Solo Sales
 * workspace, the Solo client record): the tier is the tree the page lives in and the account is the
 * route's own `:account` segment, so the link can never point at a different account than the one on
 * screen. Same route map, same frozen labels, same fail-closed rules (E4-S3 PR beta).
 */
export function routeLinkTarget(link: ReadRecordLink, tier: WorkspaceLinkTier, account: string | number | null | undefined): WorkspaceLinkTarget | null {
  const resolved = resolveCanonicalRecordLink({
    actor: "account",
    tier,
    account: account ?? null,
    destination: link.destination,
    recordId: link.record_id,
  });
  if (!resolved) return null;
  const label = resolved.status === "exact" && link.destination === "contacts"
    ? (link.subject ? `Open ${link.subject}` : "Open client record")
    : resolved.status === "exact" && link.destination === "sales_invoices"
      ? "Open invoice"
      : resolved.status === "exact" && link.destination === "pipeline"
        ? "Open deal"
        : DESTINATION_LABEL[link.destination];
  return { label, to: resolved.path, status: resolved.status };
}

/** Every reference that resolves for this account, in order; the rest are dropped. */
export function workspaceLinkTargets(links: readonly ReadRecordLink[], tenant: WorkspaceLinkTenant | null | undefined): WorkspaceLinkTarget[] {
  const out: WorkspaceLinkTarget[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const target = workspaceLinkTarget(link, tenant);
    if (!target || seen.has(target.to)) continue;
    seen.add(target.to);
    out.push(target);
  }
  return out;
}
