import type { SpineCapability } from "../contracts.ts";

// Existing roster/presence RPCs keep their caller-derived workspace/platform scope.
// Chat's existing owner/admin gate is unchanged, including the hidden single-user lookup.
export const TEAM_READ_CAPABILITIES = [
  { key: "team.list_team", tool: "crm_list_team", executor: "public.list_team_members", selfDescribe: true },
  { key: "team.presence_who_online", tool: "presence_who_online", executor: "public.presence_list_online", selfDescribe: true },
  { key: "team.presence_is_online", tool: "presence_is_online", executor: "public.presence_check_user", selfDescribe: false },
].map(({ key, tool, executor, selfDescribe }) => ({
  key, domain: "team", owner: "paige-team-reads", humanSurface: "PAIGE workspace", readiness: "none", selfDescribe,
  action: { classification: "read", executor, chatTool: tool, seatAuthority: "workspace-admin",
    idempotency: "existing caller-JWT scope-resolving read; no rows written", riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
