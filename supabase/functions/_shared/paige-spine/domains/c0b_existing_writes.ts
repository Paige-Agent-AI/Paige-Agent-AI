import type { SpineCapability } from "../contracts.ts";

/** C0b metadata for existing caller-JWT RPC writers. Seat authority describes the
 * Chat admission gate; each RPC retains its own narrower role/tenant/owner checks.
 * No dispatch, approval, queue or provider behavior changes through this declaration.
 * Invitation tools are intentionally absent: their executor is a protected Edge
 * wrapper, not a caller-accessible public invitation RPC.
 */
export const C0B_EXISTING_WRITE_CAPABILITIES = ([
  {
    key: "action_bus.file", domain: "action_bus", owner: "paige-action-bus",
    tool: "action_file", executor: "public.file_action", selfDescribe: true,
    seatAuthority: "workspace-admin", riskPolicyKey: "ordinary",
    idempotency: "Not idempotent: each call inserts a new action and audit row. No request key or stored operation receipt; blind retry can duplicate work. Existing action-kind and autonomy resolution remain canonical.",
  },
  {
    key: "action_bus.advance", domain: "action_bus", owner: "paige-action-bus",
    tool: "action_advance", executor: "public.advance_action", selfDescribe: false,
    seatAuthority: "workspace-admin", riskPolicyKey: "ordinary",
    idempotency: "Terminal actions return a noop, and pending approval reuses an attached approval. Other transitions can write audits, timestamps or queue workflow runs; no general request-key or exactly-once guarantee. Existing address-scope, kind approval and autonomy guards remain canonical.",
  },
  {
    key: "planning.remove_item", domain: "planning", owner: "paige-planning",
    tool: "plan_remove_item", executor: "public.plan_remove_item", selfDescribe: false,
    seatAuthority: "member", riskPolicyKey: "high",
    idempotency: "The item converges to cancelled but every call writes a resolved timestamp and audit row, and may dismiss its linked action. No operation receipt or expected-version guard; this does not authorize blind retry. SQL retains creator/staff and tenant checks.",
  },
  {
    key: "team.grant_role", domain: "team", owner: "paige-team",
    tool: "member_grant_role", executor: "public.grant_tenant_member_role", selfDescribe: true,
    seatAuthority: "workspace-admin", riskPolicyKey: "high",
    idempotency: "Role insert uses conflict handling, but replay can reactivate membership and writes timestamps and audit rows. No request-key receipt or full-operation retry guarantee. SQL retains resolved-tenant admin/platform-owner and protected-role checks.",
  },
  {
    key: "team.revoke_role", domain: "team", owner: "paige-team",
    tool: "member_revoke_role", executor: "public.revoke_tenant_member_role", selfDescribe: true,
    seatAuthority: "workspace-admin", riskPolicyKey: "high",
    idempotency: "Deleting an absent role converges, but each call resynchronizes membership from current roles and writes audit rows. No request-key receipt or full-operation retry guarantee. SQL retains tenant-owner, protected-role and last-admin refusals.",
  },
  {
    key: "team.set_permission", domain: "team", owner: "paige-team",
    tool: "team_set_permission", executor: "public.set_solo_team_member_permission", selfDescribe: true,
    seatAuthority: "workspace-admin", riskPolicyKey: "high",
    idempotency: "Setting the same permission converges on the member role but writes timestamps and audit rows. No operation receipt or expected-version guard. SQL derives the current actor/tenant, requires tenant ownership and refuses owner targets.",
  },
  {
    key: "team.set_work_profile", domain: "team", owner: "paige-team",
    tool: "team_set_work_profile", executor: "public.set_solo_team_member_work_profile", selfDescribe: true,
    seatAuthority: "workspace-admin", riskPolicyKey: "ordinary",
    idempotency: "Setting the same trimmed work details converges on those fields but writes timestamps and audit rows. No operation receipt or expected-version guard. SQL requires current-tenant owner/admin and never writes permission or role.",
  },
] as const).map(({ key, domain, owner, tool, executor, selfDescribe, seatAuthority, riskPolicyKey, idempotency }) => ({
  key, domain, owner, humanSurface: "PAIGE workspace", readiness: "none", selfDescribe,
  action: { classification: "mutate", executor, chatTool: tool, seatAuthority, riskPolicyKey,
    approvalAuthority: "chat-canonical", idempotency },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
