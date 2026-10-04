import type { SpineCapability } from "../contracts.ts";
/**
 * Zapier governed lane (M3) — the Spine declaration of the LIVE Zapier chat surface.
 *
 * n8n got its domain when its chat tools shipped; Zapier's two governed tools
 * (`zapier_list_actions`, `zapier_run_action` — live in the paige-ai-chat manifest since
 * the Wave-1 lane) were never registered, so the Spine could not see a surface Paige
 * actually drives. This registers what EXISTS, no more:
 *   • LIST — the read-only connection test + enabled-action discovery (MCP tools/list,
 *     Rail-recorded, honest not_connected).
 *   • RUN — the consequential dispatch (MCP tools/call on an approved action) behind the
 *     chat-canonical propose-first autonomy policy.
 * The tools execute through the legacy call-zapier-action lane (tenant_mcp_connections
 * store) today; the canonical mcp_connections gateway serves the same provider
 * (provider_key='zapier', auth_kind ∈ {oauth,url}) through the provider-agnostic execute
 * path pinned by the M1 contract. No new tool, executor, or store is created here —
 * this is the registry catching up to the surface, the same adoption shape the calendar
 * presets took (E5).
 */
export const ZAPIER_LIST_ACTIONS = {
 key: "integrations.zapier_list_actions", domain: "integrations", owner: "solo-integrations", readiness: "mcp_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: "zapier_list_actions", riskPolicyKey: "read_only", approvalAuthority: "none",
 idempotency: "Read-only MCP tools/list provider call recorded in Rail; no app action is ever run by discovery." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "mcp-outcome.projectOutcomeForModel", railVisibility: "Connection test and action-discovery outcomes file governed Chat action audit rows; provider payloads stay in the encrypted tenant-scoped store, never the Rail." },
 chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "SCR-ZAPIER-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const ZAPIER_RUN_ACTION = {
 key: "integrations.zapier_run_action", domain: "integrations", owner: "solo-integrations", readiness: "mcp_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "zapier_run_action", riskPolicyKey: "high", approvalAuthority: "chat-canonical",
 idempotency: "Caller-scoped one-time confirmation for writes; provider actions are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "mcp-outcome.projectOutcomeForModel", railVisibility: "Every executed action files the governed outcome the operator sees; the provider's answer is returned as an opaque encrypted reference, never raw prose." },
 chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "SCR-ZAPIER-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const ZAPIER_MANAGEMENT_CAPABILITIES = [ZAPIER_LIST_ACTIONS, ZAPIER_RUN_ACTION] as const;
