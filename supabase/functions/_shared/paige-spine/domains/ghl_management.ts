import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";
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

/**
 * WHAT THE `defineCapability()` DECLARATION BELOW IS, AND IS NOT (the agreements file's
 * honesty, verbatim): NOTHING consumes a `DefinedCapability` at runtime — no registry, no
 * resolver, no dispatch reads it. Its only runtime behaviour is to THROW on import if its
 * declared risk contradicts the canonical policy. What it DOES do is satisfy the
 * capability-kit anti-bypass contract: a classified mutating action carries its governed
 * declaration, so the RISK entry is the declaration's dependency rather than bypass debt.
 * The declaration's seams name the REAL homes — the canonical mcp-gateway (the one governed
 * door this lane dispatches through) and its canonical Rail recorder.
 */
export const GHL_RUN_CAPABILITY = defineCapability({
  identity: {
    id: "integrations.ghl_run_action",
    version: 1,
    domain: "integrations",
    owner: "solo-integrations",
    humanSurface: "/solo/:account/settings/integrations",
    description: "Run a tool in the tenant's GoHighLevel CRM through the canonical MCP gateway — reads contacts/conversations, writes move real CRM records and send real messages.",
  },
  input: objectInputSchema({
    description: "Run one GHL tool, resolved from the workspace's discovered catalogue.",
    properties: {
      tool_name: { type: "string", minLength: 1, maxLength: 64 },
      // The arguments passthrough: the exact shape is the discovered tool's own (each GHL
      // tool's inputs differ); the gateway validates the resolved tool and its durable
      // approval server-side.
      // NOTE: the kit's schema contract forbids additionalProperties on nested objects, so
      // the free-form arguments map is DECLARED as its JSON-serialized form here — the chat
      // tool's own schema carries the native object; the gateway's per-tool consent and
      // approval checks validate the real shape server-side.
      arguments_json: { type: "string", minLength: 2, maxLength: 65536 },
    },
    required: ["tool_name"],
  }),
  effect: "external_effect",
  governance: {
    actionRiskKey: "ghl_run_action",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("integrations.ghl.run"),
  },
  tenantScope: {
    source: "server",
    tenantResolver: "current_user_tenant_id",
    actorResolver: "authenticated_user",
    revalidateAt: ["before_availability", "before_execution", "before_receipt"],
  },
  availability: {
    resolver: "paige-capability-status",
    states: ["live", "needs_approval", "not_for_tier", "unavailable"],
  },
  providerBinding: {
    kind: "mcp",
    operation: "mcp-gateway.execute",
    connectionResolver: "mcp-gateway",
  },
  idempotency: {
    mode: "required",
    key: "tenant + actor + the Chat confirmation fingerprint (paige_pending_confirmations) — the execute-once guard; the gateway's consent verifier additionally binds the per-tool durable approval, and provider actions are never auto-retried after uncertain results.",
    readback: "the gateway's closed outcome vocabulary (outcome/code/run_id/recorded)",
    replay: "return_recorded_result",
  },
  receipt: {
    rail: true,
    recorder: "record_capability_run",
    redaction: "tenant_safe",
    visibility: "owner_internal",
  },
  outcome: { projector: "capability-record" },
});
