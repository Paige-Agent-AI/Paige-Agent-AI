// Connected MCP Gateway — CONNECT-CONSENT AUTO-APPROVE (owner decision 2026-11-05, ANT-164
// comment 3c731bae: "all the tools approved once the connection is made inside of Integrations").
//
// THE MODEL THIS IMPLEMENTS. A connection IS the operator's consent to the tools it offers: when a
// verify persists a healthy catalog, every effect-gated tool the check discovered is approved
// through the SAME runApprove path the per-tool drawer button used — permanent (no expiry), any
// call shape — so consent rides the human connect/check action itself instead of a per-tool
// ceremony. ACTION-level consent is unchanged and stays in chat (the approval card before a
// consequential run); this only removes the TOOL-level gate. Genuinely-declared reads stay
// approval-free exactly as before (effect-policy: a declared read runs without approval).
//
// WHY PERMANENT. The drawer's approval-lifetime choices are all windowed (APPROVAL_LIFETIME_CHOICES,
// settings-integrations-gateway.tsx) — a manual approval always carried an end date. Connect-consent
// is durable by definition, so the writer's null expiry is the correct shape here. The existing revocation semantics are the controls the owner
// accepted: a re-key clears every approval (the next check re-consents), a disconnect removes the
// connection, and per-action cards gate every consequential run.
//
// WHY RUNAPPROVE PER TOOL (no bespoke bulk writer). Each call re-runs the full authority stack —
// tenant read, workspace-race guard, admin gate, v2 ownership, live-pin resolution, endpoint-hash
// binding, and the writer's own in-body FOR UPDATE guard (§59). A bulk writer would have to
// re-implement part of that; composing the existing one keeps ONE home for approval authority.
// Cost is a few RPC round-trips per gated tool at connect/check time — not a hot path.
//
// HONEST DEGRADE (§13). A tool whose approval fails (transient RPC error, pin raced by a re-key)
// is reported in `failed` and left unapproved — the connection's health result is NOT degraded by
// it, the next check retries, and the chat names unapproved tools to the operator exactly as it
// already does. Failures never abort the loop: one bad tool cannot block consent for the rest.

import { runApprove, type ApproveDeps } from "./approve.ts";
import { resolveEffectApproval } from "./effect-policy.ts";

/** One discovered tool, reduced to the two fields the consent decision needs. */
export type DiscoveredTool = {
  name: string;
  effects: readonly string[];
};

export type AutoApproveOutcome = {
  /** Tools that received a durable permanent approval on this pass (closed names, no metadata). */
  approved: string[];
  /** Tools whose approval was attempted and refused, with the gateway's closed error code. */
  failed: Array<{ tool: string; error: string }>;
};

/**
 * Select the tools a connect/check must consent to: exactly those the SERVER-AUTHORITATIVE effect
 * policy gates (mutation-verb name floor, provider-declared mutating effect, or undeclared effects
 * failing closed). A declared read never appears here — it runs without approval by design.
 */
export function selectConnectConsentTools(
  tools: readonly DiscoveredTool[],
): DiscoveredTool[] {
  return tools.filter((t) => resolveEffectApproval(t.name, t.effects).requiresApproval);
}

/**
 * Approve every effect-gated discovered tool for one connection, as the connecting operator.
 * Idempotent: re-running against already-approved tools refreshes them through the writer (and
 * converges legacy windowed approvals to permanent connect-consent). Never throws through — a
 * per-tool failure is collected, not raised, so verify's own result stands.
 */
export async function autoApproveDiscoveredTools(
  deps: ApproveDeps,
  input: { connectionId: string; expectedTenantId: string | null; tools: readonly DiscoveredTool[] },
): Promise<AutoApproveOutcome> {
  const outcome: AutoApproveOutcome = { approved: [], failed: [] };
  for (const tool of selectConnectConsentTools(input.tools)) {
    const result = await runApprove(deps, {
      connectionId: input.connectionId,
      toolName: tool.name,
      expectedTenantId: input.expectedTenantId,
      expectedEndpointHash: null,
      argsShapeHash: null,
      expiresAt: null,
    });
    if (result.httpStatus === 200) outcome.approved.push(tool.name);
    else outcome.failed.push({ tool: tool.name, error: String(result.body.error ?? "approve_failed") });
  }
  return outcome;
}
