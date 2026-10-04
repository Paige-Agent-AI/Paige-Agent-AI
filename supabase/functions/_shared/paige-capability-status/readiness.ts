// Readiness resolvers — the closed set of "is the thing this capability depends on actually there?"
// questions PAIGE can answer at turn time (C0a, docs/delivery/paige-conversational-loop-r0.md §20).
//
// A capability DECLARES which resolver it needs (Spine `readiness`, or its legacy classification row);
// it never decides readiness itself. Adding a capability of an existing kind adds nothing here. Only a
// genuinely new KIND of dependency (a new provider family) adds an id — and the gatherer must then
// resolve it, or the capability reads "unknown", which never blocks and never over-claims setup.

export const READINESS_RESOLVER_IDS = Object.freeze([
  /** No external dependency — an internal, tenant-scoped RPC or read. */
  "none",
  /** The tenant's n8n instance is connected with a usable API credential. */
  "n8n_connection",
  /** The platform research provider is configured (web search / deep research / fetch). */
  "research_provider",
  /** A tenant-approved MCP provider connection (GHL, Zapier, …). Resolved per provider in C0b. */
  "mcp_connection",
] as const);

export type ReadinessResolverId = (typeof READINESS_RESOLVER_IDS)[number];

/** The turn-time answer for one resolver. `unknown` = not modelled yet; it never blocks a capability. */
export type ReadinessState = "ready" | "not_ready" | "unknown";

export function isReadinessResolverId(value: unknown): value is ReadinessResolverId {
  return typeof value === "string" && (READINESS_RESOLVER_IDS as readonly string[]).includes(value);
}

/** Owner-facing words for what to set up — used only in the `needs_setup` reason. */
export const READINESS_SETUP_HINT: Readonly<Record<ReadinessResolverId, string>> = Object.freeze({
  none: "",
  n8n_connection: "Connect your n8n account first.",
  research_provider: "Web research isn't configured for this workspace yet.",
  mcp_connection: "Connect and approve that app first.",
});
