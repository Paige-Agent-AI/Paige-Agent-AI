/**
 * Presentation-only derivation for the Solo shell's Owner/Team label.
 *
 * INT-071 census repair: the label derives from AUTHORITATIVE membership
 * ownership (the `has_tenant_role` 'owner' verdict over tenant_members
 * is_owner / role='owner'), never from the display-only
 * `tenants.owner_user_id` pointer — two authoritative Owner seats were shown
 * "Team workspace" because the pointer names someone else. Authorization is
 * untouched: solo_setup_access_scope() and every server contract keep their
 * own owner definitions (that seam is a separate, plan-first PR).
 *
 * The verdict is keyed to the ACTIVE tenant+user: while unresolved — or still
 * keyed to a previous identity after an account switch — the label fails to
 * "member" ("Team workspace"), so the prior workspace's Owner claim can never
 * leak across a switch and a URL/account name can never manufacture the
 * visible Owner claim.
 */
export interface MembershipRoleProbe {
  tenant: string;
  user: string;
  owner: boolean;
  admin: boolean;
}

export function soloShellRole(
  probe: MembershipRoleProbe | null,
  activeTenantId: string | null,
  activeUserId: string | null,
): "admin" | "member" {
  if (probe === null || probe.tenant !== activeTenantId || probe.user !== activeUserId) return "member";
  return probe.owner ? "admin" : "member";
}
