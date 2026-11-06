// Connected MCP Capability Gateway — shared types (Phase S, server/schema-first).
//
// The gateway is PROVIDER-AGNOSTIC by construction: everything is keyed by an immutable
// connection_id and a provider_key STRING (a descriptor row, never a 2-value enum). It reuses
// the hardened provider-agnostic core in `../mcp-client.ts` (session lifecycle, tools/list,
// tools/call, fingerprint pins, SSRF guard) and adds only the connection-keyed orchestration.
//
// It does NOT import the n8n|zapier-typed `../mcp-outcome.ts` wrapper — depending on that 2-value
// `McpProvider` union is exactly the special-casing this gateway exists to remove.

import type { McpAuth, McpToolFingerprint } from "../mcp-client.ts";

/** The closed effect vocabulary a tool may declare. Model-safe (never provider prose). */
export type CapabilityEffect = "read" | "create" | "update" | "send" | "delete";

/** A resolved connection, as the runner/intake need it. Secrets arrive already decrypted from
 *  the service-role RPC `get_mcp_connection_secret`; they never reach a model or a browser. */
export type GatewayConnection = {
  connectionId: string;
  tenantId: string;
  providerKey: string;
  serverUrl: string;
  auth: McpAuth;
  transport: string;
  grantedScopes: string[];
};

/** The sanitized, MODEL-SAFE view of one capability. Carries identity + effect shape only —
 *  never the provider's raw description or input schema (those stay inside mcp-client.ts). */
export type SafeCapability = {
  name: string;
  effects: CapabilityEffect[];
  app: string;
  actionType: string;
  /** Whether this connection has an approval pinned for this tool (an operator decision fact). */
  approved: boolean;
};

/** What the model may reason over about a connection. Counts + sanitized capabilities +
 *  operator-approved labels; nothing a provider wrote free-hand. */
export type CapabilitySummary = {
  connectionId: string;
  providerKey: string;
  /** A human label supplied by the operator/registry, NOT provider free-text. */
  label: string;
  toolCount: number;
  approvedCount: number;
  capabilities: SafeCapability[];
  /** Freshness: when the catalog was last observed, never presented as "verified now". */
  observedAt: string | null;
};

/** Read-only intake result. Intake performs discovery only — never a mutating tools/call. */
export type IntakeResult = {
  ok: boolean;
  /** Maps to mcp_connections.health via the probe RPC. */
  health: "healthy" | "needs_attention" | "checking" | "unknown";
  status: "connected" | "error" | "pending_verification";
  tools: McpToolFingerprint[];
  /** A closed error code (never raw provider text). */
  errorCode: string | null;
};

/** Runner outcomes. `read_observed`/`prepared` never touch an external effect; `executed` is a
 *  real tools/call (Phase S proves it only against an in-process fake — never a live provider).
 *  `tool_error` is a call that DISPATCHED and the provider reported failure (`isError`) or answered
 *  in a shape we do not accept — distinct from `refused` (never dispatched), `provider_unavailable`
 *  (never reached), and `outcome_unknown` (threw after dispatch, landing unknown). #1262 finding 4. */
export type RunnerOutcome =
  | "read_observed"
  | "prepared"
  | "executed"
  | "tool_error"
  | "refused"
  | "provider_unavailable"
  | "outcome_unknown";

/** Whether the run's outcome actually landed on the canonical Rail (#1262 finding 5, Codex R3).
 *  `filed` is true only when the receipt writer confirmed the row persisted. When it is false the
 *  `reason` says whether that was DELIBERATE (`not_applicable` — a prepared run or an actor with no
 *  Rail row to write) or a genuine FAILURE (`record_failed`/`record_threw` — the write was owed and
 *  did not persist). The runner NEVER downgrades a completed action's `outcome` because of a receipt
 *  failure (§13/§32: a landed effect stays `executed`), but it must not report a fully-recorded
 *  success when the Rail truth never persisted either — this is that honest, separable signal. */
export type ReceiptFiling = { filed: boolean; reason: "not_applicable" | "record_failed" | "record_threw" | null };

export type RunnerResult = {
  outcome: RunnerOutcome;
  runId: string;
  /** Refusal/why code — closed vocabulary, never provider prose. */
  code: string | null;
  /** A bounded, sanitized projection of the provider's tool result — NON-NULL only for a VALIDATED
   *  clean success (`read_observed`/`executed`), because only a recognized non-error result is safe
   * to echo. Without it a successful read is unconfirmable by the caller's model: the closed
   * vocabulary says "read_observed" but shows nothing that was read, so the model honestly reports
   * it could not confirm the lookup (the 2026-11-06 owner incident). The projection is produced at
   * the provider boundary by {@link projectToolResultData} (control-stripped, length-capped); it is
   * still PROVIDER-WRITTEN CONTENT downstream — a prompt-injection surface to be labeled as data,
   * never executed as instructions. `null` for every other outcome (refused/errored/unknown —
   * nothing validated exists to share, and `outcome_unknown` in particular must never echo an
   * unvalidated payload that could dress an uncertain landing as a confirmed one). */
  data: string | null;
  /** Whether the receipt for this run persisted on the canonical Rail. `null` when the caller wired
   * no receipt writer (or one that reports nothing) — the runner then makes no filing claim. A
   * wired writer that reports `{ filed: false, reason: "record_failed" }` means the action's
   * outcome is truthful but its Rail row is owed, not recorded. */
  receipt: ReceiptFiling | null;
};
