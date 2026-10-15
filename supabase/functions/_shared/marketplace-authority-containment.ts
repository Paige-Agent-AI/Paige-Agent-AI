const EDGE_FUNCTION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ActiveMarketplaceTenantInput = {
  activeAccountTenantId: unknown;
  expectedTenantId: unknown;
  authorizedTenantIds: readonly unknown[];
};

const canonicalTenantId = (value: unknown): string | null => {
  if (typeof value !== "string" || !TENANT_UUID.test(value)) return null;
  return value.toLowerCase();
};

/**
 * Resolve Marketplace browse scope only when the request's active account,
 * the Chat persona/current-tenant expectation, and an active membership agree.
 * Membership order is irrelevant; absence or ambiguity always fails closed.
 */
export function resolveActiveMarketplaceTenant(input: ActiveMarketplaceTenantInput): string | null {
  const activeTenantId = canonicalTenantId(input.activeAccountTenantId);
  const expectedTenantId = canonicalTenantId(input.expectedTenantId);
  if (!activeTenantId || !expectedTenantId || activeTenantId !== expectedTenantId) return null;
  const authorized = new Set(input.authorizedTenantIds.map(canonicalTenantId).filter(Boolean));
  return authorized.has(activeTenantId) ? activeTenantId : null;
}

/** Reject a tenant accepted earlier in the request if current authority moved or disappeared. */
export function retainActiveMarketplaceTenant(initialTenantId: unknown, currentTenantId: unknown): string | null {
  const initial = canonicalTenantId(initialTenantId);
  const current = canonicalTenantId(currentTenantId);
  return initial && current && initial === current ? current : null;
}

/**
 * Return the only representation safe to interpolate into an Edge Function URL.
 * Reject whitespace, case folding, encoding, traversal, delimiters, Unicode, and
 * every other non-canonical spelling rather than normalizing attacker input.
 */
export function canonicalDirectFunctionName(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!EDGE_FUNCTION_SLUG.test(value)) return null;
  return value;
}

/**
 * INT-310 dispatch allowlist — the edge functions a workflow may invoke with the SERVICE-ROLE bearer
 * (`_shared/workflowDispatch.ts`, used by paige-mcp run_workflow, the action bus's workflow executor and
 * the dispatch-queued-workflow-runs sweeper). That bearer passes every internal-caller gate, and the run's
 * payload is shaped by whoever queued it (registry rows via paige-mcp register_workflow; run rows via RLS
 * inserts — including against platform rows — or the action bus), so an unlisted target would be a
 * confused deputy: it could name another tenant in its own body. Allowlist, not denylist: a new target is
 * dispatchable only after it is reviewed to derive its tenant/actor server-side and never from the body.
 *
 * Deliberately EMPTY today (grounded 2026-10-05): the two direct targets ever registered are
 *   • `send-message` — its service-role path takes the sending tenant from a body `message_id`,
 *     `contact_id` or `connector_id` row, so a dispatched run could send through another tenant's channel;
 *   • `credit-verification-initiate` — no such function exists in this repo.
 * Neither has ever run (prod `paige_workflow_runs`: 0 rows for either). User-triggered direct workflows
 * (`trigger-workflow`) forward the caller's OWN auth and are unaffected.
 */
const SERVICE_DISPATCH_DIRECT_FUNCTIONS: ReadonlySet<string> = new Set<string>([]);

/** May a workflow dispatch this function with the service-role bearer? Unlisted → no. */
export function isServiceDispatchDirectFunctionAllowed(value: unknown): boolean {
  const canonical = canonicalDirectFunctionName(value);
  return canonical !== null && SERVICE_DISPATCH_DIRECT_FUNCTIONS.has(canonical);
}

/**
 * INT-310 — the edge functions paige-orchestrator may invoke as a `runtime='local'` sub-agent. The target
 * name comes from a `paige_subagents` row, which a tenant admin can write under RLS, and the call carries
 * the SERVICE-ROLE bearer — so only canonical names built for the orchestrator's `{input, context}`
 * contract (caller gate + server-resolved tenant binding) may be reached. A new local specialist is
 * added here when it is built to that contract.
 */
const ORCHESTRATOR_LOCAL_AGENT_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "paige-deep-research",
  "paige-problem-reverse-engineer",
  "subagent-compliance",
  "subagent-content-drafter",
  "subagent-data-consistency",
  "subagent-email-composer",
  "subagent-fundability",
  "subagent-funding-path",
  "subagent-intake-concierge",
  "subagent-stack-strategist",
]);

/** May the orchestrator invoke this `local` sub-agent function with the service-role bearer? */
export function isOrchestratorLocalAgentFunctionAllowed(value: unknown): boolean {
  const canonical = canonicalDirectFunctionName(value);
  return canonical !== null && ORCHESTRATOR_LOCAL_AGENT_FUNCTIONS.has(canonical);
}

/** Marketplace mutations are not reachable through generic workflow dispatch. */
export function isMarketplaceDirectFunctionBlocked(value: unknown): boolean {
  const canonical = canonicalDirectFunctionName(value);
  if (!canonical) return true;
  return canonical === "marketplace" || canonical.startsWith("marketplace-");
}
