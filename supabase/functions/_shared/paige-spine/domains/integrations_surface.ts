import type { SpineCapability } from "../contracts.ts";

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
