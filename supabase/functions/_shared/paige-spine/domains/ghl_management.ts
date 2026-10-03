import type { SpineCapability } from "../contracts.ts";
/**
 * The GHL governed chat lane (GHL-1) — declared from the REAL discovered tool catalogue.
 *
 * The owner's live connection (2026-10-03: bearer PIT, 36 real tools — contacts_*,
 * conversations_*, opportunities_*, calendars_*, payments_*, blogs_*, social-posting_*,
 * emails_*, locations_*) is the discovery event the M4 lane named as the gate: no chat
 * capability was declared until a real connection showed GHL's actual tool names. This
 * registers the two governed chat tools that surface now exists for, mirroring the zapier
 * lane's shape exactly:
 *   • LIST — the read-only connection check + tool catalogue (approved AND unapproved
 *     names, never just counts) through the canonical gateway's tools action.
 *   • RUN — the consequential dispatch through the canonical gateway's execute action
 *     (prepare always available; live execute behind the owner go MCP_GATEWAY_EXECUTE_ENABLED),
 *     per-tool durable approval required by the gateway's consent verifier.
 * Reads run ungated; every write runs propose-first — the operator approves the specific
 * action in the conversation. No new store, executor, or authority: the gateway is the one
 * home; these tools are Chat's adapter onto it.
 */
export const GHL_LIST_ACTIONS = {
 key: "integrations.ghl_list_actions", domain: "integrations", owner: "solo-integrations",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: "ghl_list_actions", riskPolicyKey: "read_only", approvalAuthority: "none",
 idempotency: "Read-only catalogue read through the canonical gateway's tools action; recorded honestly, never a provider tool call." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "mcp-gateway.tools", railVisibility: "Connection check and catalogue outcomes file governed Chat action audit rows; provider payloads stay behind the gateway's closed outcome vocabulary." },
 chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "SCR-GHL-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const GHL_RUN_ACTION = {
 key: "integrations.ghl_run_action", domain: "integrations", owner: "solo-integrations",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "ghl_run_action", riskPolicyKey: "high", approvalAuthority: "chat-canonical",
 idempotency: "Caller-scoped one-time confirmation for writes; provider actions are never automatically retried after uncertain results. The gateway's consent verifier additionally requires the per-tool durable approval." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "mcp-gateway.execute", railVisibility: "Every executed action files the governed outcome the operator sees through the gateway's canonical Rail receipt; the provider's answer is returned as the gateway's closed outcome vocabulary, never raw prose." },
 chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "SCR-GHL-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const GHL_MANAGEMENT_CAPABILITIES = [GHL_LIST_ACTIONS, GHL_RUN_ACTION] as const;
