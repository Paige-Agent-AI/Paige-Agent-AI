// Connected MCP Gateway — CONNECT-CONSENT AUTO-APPROVE (owner decision 2026-11-05, ANT-164
// comment 3c731bae: "all the tools approved once the connection is made inside of Integrations";
// amended same day, verbatim: "EVERYTHING SHOULD BE APPROVED. TOP BEING SO CONSERVATIVE LOL").
//
// THE MODEL THIS IMPLEMENTS. A connection IS the operator's consent to the tools it offers: when a
// verify persists a healthy catalog, EVERY discovered tool is approved through the SAME runApprove
// path the per-tool drawer button used — permanent (no expiry), any call shape — so consent rides
// the human connect/check action itself instead of a per-tool ceremony. The first cut consented
// only effect-gated tools (reads "run free anyway"); the amendment includes declared reads too, so
// the approval LEDGER matches what the owner believes he granted ("all of them") instead of
// contradicting the chat's approved-count with a 22-row gap of technically-unnecessary rows.
// ACTION-level consent is unchanged and stays in chat (the approval card before a consequential
// run); this only removes the TOOL-level gate.
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
// Cost is a few RPC round-trips per tool at connect/check time — not a hot path.
//
// HONEST DEGRADE (§13). A tool whose approval fails (transient RPC error, pin raced by a re-key)
// is reported in `failed` and left unapproved — the connection's health result is NOT degraded by
// it and the next check retries. Failures never abort the loop: one bad tool cannot block consent
// for the rest. ONE class can never converge by retry: a tool whose NAME cannot be safely
// recorded (outside the writer's tool-name contract — the hostile-injection class) is refused
// deterministically every check and surfaces only as the permanent failed count; the chat's tool
// summary drops such names, so it can never name them either (§13 keeps the raw name unpersisted
// here too).

import { runApprove, type ApproveDeps } from "./approve.ts";

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
 * Select the tools a connect/check must consent to: EVERY tool the check discovered. The
 * effect-gated ones (mutation-verb name floor, provider-declared mutating effect, undeclared
 * effects failing closed) needed approval to run at all; declared reads ran free — but the owner's
 * amendment includes them so the ledger says "all of them" and a later effect re-classification of
 * a read tool finds consent already recorded rather than a surprise gate.
 */
export function selectConnectConsentTools(
  tools: readonly DiscoveredTool[],
): DiscoveredTool[] {
  return [...tools];
}

/**
 * Approve every discovered tool for one connection, as the connecting operator.
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
