import type { SpineCapability } from "../contracts.ts";

/** Existing caller-JWT invitation Edge wrapper. The service-only SQL authority
 * verifies active owner/admin membership in the explicitly named workspace; Chat
 * separately rejects disagreement with its caller-derived Team roster. This metadata
 * creates no public invitation RPC and changes no token, approval or delivery behavior.
 */
export const TEAM_INVITATION_CAPABILITIES = ([
  { key: "team.invite_member", tool: "team_invite_member", classification: "external_effect", selfDescribe: true,
    idempotency: "Not idempotent: create replaces a pending invitation with a new token and audit row. Email is a separate best-effort send reported by emailed; a live invitation does not prove email delivery. No request-key receipt or blind retry authority." },
  { key: "team.invite_resend", tool: "team_invite_resend", classification: "external_effect", selfDescribe: false,
    idempotency: "Not idempotent: resend revokes the old link and creates a new token, then attempts email separately. Accepted invitations are refused. No request-key receipt; replay can rotate the link again and attempt another email." },
  { key: "team.invite_revoke", tool: "team_invite_revoke", classification: "mutate", selfDescribe: false,
    idempotency: "Revoke preserves the first revoked timestamp but writes updated timestamps and audit rows again; accepted or missing invitations are refused. No request-key receipt or full-operation retry guarantee. This route sends no email." },
] as const).map(({ key, tool, classification, selfDescribe, idempotency }) => ({
  key, domain: "team", owner: "paige-team", humanSurface: "PAIGE workspace", readiness: "none", selfDescribe,
  action: { classification, executor: "edge.solo-team-invitations", chatTool: tool,
    seatAuthority: "workspace-admin", riskPolicyKey: "high", approvalAuthority: "chat-canonical", idempotency },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
