import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

/**
 * Integrations surface — Paige's visibility into what's connected, what's
 * available, and what's healthy (#1140 follow-on; the owner's capability
 * mandate: "Paige and her agents need to read, write, create").
 *
 * This first wave is READ verbs — the 80% of integration questions owners
 * actually ask: "what am I connected to?", "is my email working?", "what
 * else can I connect?". The write verbs (connect/disconnect/configure)
 * involve OAuth flows and provider-specific logic — a deliberate later wave.
 *
 * The adapter (public.list_integration_surface) reads from channel_connectors
 * (the live connection state) joined against the Integration Capability
 * Registry's provider catalogue, so the answer is always the tenant's REAL
 * state, never a cached or guessed one.
 */
export const INTEGRATIONS_LIST = {
  key: "integrations.list",
  domain: "integrations",
  owner: "integrations",
  humanSurface: "/solo/:account/settings/integrations",
  evidence: {
    signalKinds: ["integrations.connection_state"],
    adapter: "public.list_integration_surface",
    audience: "owner_internal",
    freshness: "live read of channel_connectors on every call; no cached snapshot, so no row can be stale",
    staleAfterDays: 1,
    projectionWindowDays: 1,
    sourceSystem: "channel_connectors",
    sourceActorTypes: ["person"],
    classification: "operational",
    lifecycle: "current",
    safeSummary: "An integration's connection state and provider.",
    referencePrefix: "integrations:",
    factValues: {
      channel: ["email", "sms", "calendar", "voice", "mcp", "whatsapp", "instagram", "facebook"],
      status: ["active", "disabled", "pending"],
      provider: ["resend", "twilio", "google", "calendly", "n8n", "zapier", "gohighlevel", "generic-remote"],
    },
  },
  action: {
    classification: "read",
    executor: "public.list_integration_surface",
    idempotency: "read-only projection; no rows are written",
    riskPolicyKey: "read_only",
    approvalAuthority: "none",
    chatTool: "integrations_list",
  },
  outcome: {
    kinds: ["current"],
    projector: "public.list_integration_surface",
    railVisibility: "owner_internal",
  },
  chatBinding: "PARTIAL",
  mindBinding: "PARTIAL",
  sharedPrimitiveChange: "SCR-INTEGRATIONS-MIND",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const INTEGRATIONS_HEALTH = {
  key: "integrations.health",
  domain: "integrations",
  owner: "integrations",
  humanSurface: "/solo/:account/settings/connections",
  evidence: {
    signalKinds: ["integrations.health_state"],
    adapter: "public.list_integration_surface",
    audience: "owner_internal",
    freshness: "live read of connection status and last activity; health = active AND recently used",
    staleAfterDays: 1,
    projectionWindowDays: 1,
    sourceSystem: "channel_connectors",
    sourceActorTypes: ["person", "agent"],
    classification: "operational",
    lifecycle: "current",
    safeSummary: "An integration's health (connected, degraded, or disconnected).",
    referencePrefix: "integrations:",
    factValues: {
      health: ["healthy", "degraded", "disconnected", "unconfigured", "unknown"],
    },
  },
  action: {
    classification: "read",
    executor: "public.list_integration_surface",
    idempotency: "read-only health projection",
    riskPolicyKey: "read_only",
    approvalAuthority: "none",
    chatTool: "integrations_health",
  },
  outcome: {
    kinds: ["current"],
    projector: "public.list_integration_surface",
    railVisibility: "owner_internal",
  },
  chatBinding: "PARTIAL",
  mindBinding: "PARTIAL",
  sharedPrimitiveChange: "SCR-INTEGRATIONS-MIND",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;

// The kit-governed declaration for the live read half (integrations.list), routed through
// defineCapability() per the capability-kit anti-bypass guard (a direct ToolDef literal in a
// spine domain is refused debt). The ToolDef below derives its description and parameters from
// THIS declaration — the crm_task/team_hub one-home pattern. The description keeps the chat
// binding's factual listing sentence but drops its PAIGE-COO coaching voice (specialist turns
// carry no PAIGE-chat persona guidance, EXP08 A1b notes) and states the read-only rule. The chat's
// pre-existing inline def stays untouched; unifying the two is a follow-up for that file's next
// owner. integrations_health has NO live chat executor and is deliberately absent.
export const INTEGRATIONS_LIST_READ_CAPABILITY = defineCapability({
  identity: { id: "integrations.list", version: 1, domain: "integrations", owner: "integrations",
    humanSurface: "/solo/:account/settings/integrations",
    description: "List every integration/connection on this workspace — channel (email/SMS/calendar), provider, status, health, and addresses. READ-ONLY: it never connects, disconnects or changes anything. Report the statuses exactly as returned; never imply a connection is healthy or broken beyond what the status says." },
  input: objectInputSchema({ description: "No arguments: the workspace and the person are the signed-in session's own.", properties: {}, required: [] }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("integrations.list.read") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user",
    revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.list_integration_surface", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

export const INTEGRATIONS_READ_TOOLS = [{ type: "function" as const, function: {
  name: "integrations_list", description: INTEGRATIONS_LIST_READ_CAPABILITY.identity.description,
  parameters: INTEGRATIONS_LIST_READ_CAPABILITY.input,
} }];
