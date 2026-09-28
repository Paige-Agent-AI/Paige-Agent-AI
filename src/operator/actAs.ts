import { supabase } from "@/integrations/supabase/client";
import { resolveTierKey } from "@/lib/tier/tierFeatures";
import { workspaceRootForTenant } from "@/lib/auth/workspaceEntry";

/**
 * Where an operator lands when they act as a tenant — decided BEFORE anything is recorded.
 *
 * WHY THIS EXISTS. Entering from Fleet → Directory used to call the audited
 * `operator_enter_tenant` and then stop: a toast said "Acting as …", the audit log said the
 * operator had entered, and the operator was still on the directory with no tenant view and no
 * way out. On production that left an act-as open for hours that nobody had actually reached.
 * An operator audit trail that records access which never happened breaks the one claim the
 * trail exists to make.
 *
 * So an act-as completes on both sides or on neither: the landing is resolved first, and a
 * tenant whose workspace an operator cannot reach is refused before the server records an entry.
 *
 * WHICH SHELLS ADMIT AN OPERATOR TODAY (traced 2026-09-27, file:line in the PR):
 *   - standalone → `/solo/{n}`: mounts; its header carries the operator's exit.
 *   - sub-account → `/business/{n}`: mounts; its header carries the operator's exit.
 *   - agency / enterprise → `/agency/{n}`: does NOT mount. `AgencyEntry` sends every platform
 *     operator back to the console, and `AgencyApp` in agency mode assumes an agency manager.
 *     Entering one would record an act-as the operator can never stand in, so it is refused.
 */
export type ActAsLanding =
  | { kind: "land"; root: string }
  | { kind: "unavailable"; reason: string };

export type ActAsTenant = {
  name: string;
  account_type?: string | null;
  parent_tenant_id?: string | null;
  account_number?: number | string | null;
};

export function operatorLandingFor(tenant: ActAsTenant | null | undefined): ActAsLanding {
  if (!tenant) {
    return { kind: "unavailable", reason: "Paige couldn't find that tenant. Nothing was entered." };
  }
  const tier = resolveTierKey({
    account_type: tenant.account_type ?? null,
    parent_tenant_id: tenant.parent_tenant_id ?? null,
    isPlatformStaff: false,
  });
  if (tier === "agency" || tier === "enterprise") {
    return {
      kind: "unavailable",
      reason: `${tenant.name} is an agency workspace, which can't be entered from the console yet. Enter one of its sub-accounts instead. Nothing was entered.`,
    };
  }
  const root = workspaceRootForTenant(tenant);
  if (!root) {
    return {
      kind: "unavailable",
      reason: `Paige couldn't confirm ${tenant.name}'s workspace address. Nothing was entered.`,
    };
  }
  return { kind: "land", root };
}

/**
 * The tenant row a landing is resolved from, read fresh. For a tenant the Fleet directory lists but
 * the tenant provider's snapshot does not have yet (provisioned after it loaded). The same columns
 * and the same access rules as the provider's own read; a failed or empty read is `null`, which
 * refuses the entry before anything is recorded.
 */
export async function readActAsTenant(tenantId: string): Promise<ActAsTenant | null> {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, account_type, parent_tenant_id, account_number")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  // `account_number` is live but not yet in the generated types (the provider casts the same way).
  return data as unknown as ActAsTenant;
}

/**
 * A full load, as the account chooser does: the destination shell mounts on fresh providers
 * that read the new scope from the server, not from state carried over from the console.
 * An indirection so tests can observe the landing without a browser.
 */
export const landAt = {
  go(root: string): void {
    window.location.assign(root);
  },
};
