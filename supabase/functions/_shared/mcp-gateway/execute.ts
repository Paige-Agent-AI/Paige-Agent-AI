// Connected MCP Gateway — EXECUTE (Slice ③: the runtime dispatch door).
//
// The action that finally RUNS a tool on a connected MCP, composing the hardened, headless-proven
// runner (`runConnectionCapability`, runner.ts) with its PRODUCTION deps — the canonical connection
// loader, the durable consent verifier, the capability resolver, and the canonical-Rail receipt.
// §18/§14: this handler WIRES those existing seams; it re-implements none of the runner's §9,
// single-source, consent, or receipt safeguards.
//
// AUTHORITY (§9). Unlike verify/approve (MANAGE actions gated on tenant-admin), execute is a USE
// action: any authenticated tenant member may ATTEMPT it, and the RUNNER is the authority —
//   * the caller's tenant is server-derived (`current_user_tenant_id`, never the body); the runner
//     refuses a connection whose row-tenant is not that tenant (`foreign_tenant`, §9);
//   * an `owner_only` connection needs the restricted capability, resolved server-side by
//     `_mcp_caller_capabilities` (INT-082/INT-089) — a member who merely learned the id is refused;
//   * a consequential (mutation) tool dispatches ONLY against a durable, endpoint-bound approval
//     (`verify_mcp_connection_approval`), never a pin carried in this request.
// The edge adds ONLY the workspace-switch-race guard (a clean 409 instead of the runner's
// `foreign_tenant` when the caller switched away from the tenant they launched from).
//
// THE "OWNER GO" LIVE GATE (runner.ts:38-40 + §32/§33). A real tools/call is a consequential,
// frequently IRREVERSIBLE external effect that cannot be verified headless (there is no live MCP
// provider in CI). So `mode:"execute"` dispatch is gated behind an explicit owner flag,
// `MCP_GATEWAY_EXECUTE_ENABLED` (default OFF): with it unset the action refuses `execute_not_enabled`
// BEFORE any dep is built or any provider is contacted — exactly the §33 pattern (wire the path live
// and verifiable, keep the consequential runtime behavior behind the owner's own switch, so the
// merge blind-ships no live external effect). `mode:"prepare"` stages intent and contacts NO provider
// (runner.ts:216), so it is always allowed — a UI can confirm a connection+tool is runnable by this
// caller without executing anything.
//
// SECRET DISCIPLINE (§13). The endpoint + credential are decrypted only inside the runner's loader,
// used for one session, and dropped. This handler's response carries the runner outcome, its closed
// code, the run id, whether the canonical-Rail receipt persisted, and — for a VALIDATED clean
// success only — a bounded, sanitized `data` projection of the tool result (never secrets, never an
// unvalidated payload, never provider prose for any non-success outcome).

import { runConnectionCapability } from "./runner.ts";
import { makeRpcConnectionLoader } from "./connection.ts";
import { makeRpcApprovalVerifier } from "./consent.ts";
import { makeRpcCapabilityResolver } from "./authority.ts";
import { makeCanonicalRailReceipt } from "./rail-receipt.ts";
import type { RunnerOutcome, RunnerResult } from "./types.ts";

// The one thing runExecute needs from a Supabase client: an awaitable `rpc` (a PromiseLike, matching
// verify.ts/create.ts, so the real SupabaseClient satisfies the dep under `deno check`).
// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export type ExecuteDeps = {
  /** RLS-scoped as the caller (anon key + the caller's Authorization). Resolves the server-derived
   *  tenant; the runner's own §9 checks are the authority, not this client. */
  userClient: RpcClient;
  /** service-role client — builds the runner's canonical loader, consent verifier, capability
   *  resolver, and Rail receipt. The EXECUTE grant is never the guard: the runner re-enforces
   *  tenant, owner_only authority, and durable consent server-side (§59). */
  admin: RpcClient;
};

export type ExecuteInput = {
  connectionId: string;
  toolName: string;
  /** The tool arguments. Only the SHAPE (sorted top-level keys) is bound to consent (consent.ts
   *  argsShapeHash); values are dispatched verbatim to the provider. */
  args: Record<string, unknown>;
  /** `prepare` stages intent (no provider contact); `execute` dispatches. The wrapper defaults an
   *  absent/unknown mode to `prepare` — never accidentally execute. */
  mode: "prepare" | "execute";
  /** The tenant the caller BELIEVED they were acting on when the request left the browser. */
  expectedTenantId: string | null;
  /** The authenticated caller's user id (from the wrapper's getUser). The runner's capability
   *  resolution and the Rail receipt actor derive from it — never a request body. */
  actor: string;
  timeoutMs?: number;
  /** The resolved "owner go" flag (MCP_GATEWAY_EXECUTE_ENABLED). The wrapper reads env; this handler
   *  stays env-free and headless-testable. Gates `mode:"execute"` only. */
  executeEnabled: boolean;
};

export type ExecuteResult = {
  httpStatus: number;
  // Response body carries only model-/browser-safe facts; never a secret or provider prose.
  body: Record<string, unknown>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
// An untrusted caller must not dictate an unbounded wait: the client's `withApprovedCapabilitySession`
// applies `opts.timeoutMs ?? DEFAULT_TIMEOUT_MS` (15s) with NO upper clamp, so a large body value would
// hold the edge invocation open for as long as it asked. Clamp a caller-supplied timeout to this ceiling
// (still generous vs the 15s default); an absent/non-positive value falls through to the runner default.
const MAX_EXECUTE_TIMEOUT_MS = 30_000;

// §9 (peer-gate #1) — the runner's loader/tenant refusal codes reveal, for a connection the caller may
// NOT own, whether it exists (`no_connection`), is disabled (`connection_disabled`), is a non-executable
// facet (`connection_unusable`), or is in another tenant (`foreign_tenant`) — a cross-tenant STATE oracle
// keyed on a guessed connection UUID. It is reachable even without the owner-go flag via `mode:"prepare"`,
// which still loads the connection and runs these checks before the prepared short-circuit. execute is the
// first deployed HTTP caller to surface them, so it collapses every "you cannot prove you own this
// connection" refusal to ONE uniform `not_found` in the body — matching approve's discipline (a
// foreign/invisible connection is uniformly not_found). `owner_only_forbidden` is included so an ordinary
// member never learns an owner_only connection exists, mirroring `get_mcp_connections_v2`'s hiding. The
// runner's precise code still rides the canonical Rail receipt / internal logs — only the CLIENT view is
// collapsed. Every other refusal (approval_required, contract_changed, no_longer_offered, …) concerns an
// OWNED, authorized connection's tool/consent state and is safe to surface unchanged.
const CONNECTION_OPAQUE_CODES = new Set([
  "no_connection", "connection_disabled", "connection_unusable", "connection_mismatch",
  "foreign_tenant", "owner_only_forbidden",
]);

/** Map the runner's closed outcome to an HTTP status. The JSON body's `outcome`/`code` are the
 *  AUTHORITATIVE result; the status reflects the class only.
 *   - clean success (`executed`/`read_observed`/`prepared`) → 200;
 *   - `outcome_unknown` → 200 DELIBERATELY: the dispatch happened and the landing is uncertain, so a
 *     5xx (which invites a duplicating retry) would be catastrophically wrong — the body's
 *     `outcome:"outcome_unknown"` is the honest "check before running again" signal (Codex P2);
 *   - `refused` → 403 (authority/consent/usability refusal — the closed code says which);
 *   - `provider_unavailable`/`tool_error` → 502 (the provider was unreachable or reported failure). */
function httpForOutcome(outcome: RunnerOutcome): number {
  switch (outcome) {
    case "executed":
    case "read_observed":
    case "prepared":
    case "outcome_unknown":
      return 200;
    case "refused":
      return 403;
    case "provider_unavailable":
    case "tool_error":
      return 502;
  }
}

/**
 * Resolve tenant + authority, then run one connection capability through the hardened runner. Returns
 * an HTTP status + a closed, secret-free body for every handled path (the runner never throws; the
 * pre-runner resolution failures are closed 4xx codes). A client transport-layer REJECTION from a
 * pre-runner `rpc` call (distinct from a Postgres error, which arrives in `.error`) is not caught here
 * and falls through to the wrapper's fail-closed platform 500 — no body, no stack, no secret — the same
 * posture as the sibling verify/create/oauth handlers.
 */
export async function runExecute(deps: ExecuteDeps, input: ExecuteInput): Promise<ExecuteResult> {
  const { userClient, admin } = deps;
  const { connectionId, toolName, args, mode, expectedTenantId, actor, timeoutMs, executeEnabled } = input;

  if (!UUID_RE.test(connectionId)) return { httpStatus: 400, body: { error: "bad_connection_id" } };
  const id = connectionId.toLowerCase();
  if (!TOOL_NAME_RE.test(toolName)) return { httpStatus: 400, body: { error: "bad_tool_name" } };

  // THE "OWNER GO" LIVE GATE — refuse a real dispatch before ANY dep is built or provider contacted.
  // `prepare` (no provider contact) is always allowed. See the header for why this is flag-gated.
  if (mode === "execute" && !executeEnabled) {
    return { httpStatus: 403, body: { error: "execute_not_enabled" } };
  }

  // Tenant from the caller's JWT — never the body (§9).
  const { data: tenantId, error: tErr } = await userClient.rpc("current_user_tenant_id");
  if (tErr || typeof tenantId !== "string" || !tenantId) {
    return { httpStatus: 400, body: { error: "no_tenant" } };
  }

  // Workspace-switch-race guard: a clean 409 when the caller switched away from the tenant they
  // launched from (otherwise the runner refuses `foreign_tenant`, which is safe but opaque).
  if (expectedTenantId && expectedTenantId !== tenantId) {
    return { httpStatus: 409, body: { error: "tenant_mismatch" } };
  }

  // Server-resolved caller authority (INT-082/INT-089), BOUND to the resolved tenant so a capability
  // cached across a workspace switch can never authorize an owner_only run in another tenant (Codex P2).
  // Fails closed to empty caps on any RPC error — an unresolvable authority grants nothing.
  const callerAuthority = await makeRpcCapabilityResolver(admin)({ tenantId, actorUserId: actor });

  const result: RunnerResult = await runConnectionCapability(
    { connectionId: id, tenantId, callerAuthority, toolName, args: args ?? {}, mode, timeoutMs },
    {
      // The three production deps. Each is the §18 one home for its concern; the runner composes them.
      loadConnection: makeRpcConnectionLoader(admin),
      verifyApproval: makeRpcApprovalVerifier(admin),
      recordReceipt: makeCanonicalRailReceipt(admin, { tenantId, actorId: actor }),
    },
  );

  // Honest receipt truth (Codex R3): true only if the Rail row persisted; false → the outcome is real
  // but its Rail row is owed; null → no filing claim. Never dressed as fully-recorded.
  const recorded = result.receipt ? result.receipt.filed : null;

  // §9 (peer-gate #1): collapse a "cannot prove you own this connection" refusal to a uniform not_found
  // so execute reveals nothing about a foreign/unauthorized connection. The outcome stays `refused`; only
  // the leaky code is replaced.
  if (result.outcome === "refused" && result.code && CONNECTION_OPAQUE_CODES.has(result.code)) {
    return { httpStatus: 404, body: { outcome: "refused", code: "not_found", run_id: result.runId, recorded } };
  }

  return {
    httpStatus: httpForOutcome(result.outcome),
    // `data` is the bounded, sanitized projection of a VALIDATED clean result (read_observed /
    // executed only — null everywhere else, see types.ts). It is provider-written content crossing
    // to the caller on purpose: without it a successful read is unconfirmable by the caller's
    // model. Callers forwarding it to a model must label it as data, not instructions.
    body: { outcome: result.outcome, code: result.code, run_id: result.runId, data: result.data, recorded },
  };
}

/** Translate the untrusted HTTP body into a typed ExecuteInput. An absent/unknown mode defaults to
 *  `prepare` (fail-safe — never accidentally execute); a non-object `args` becomes `{}`. `actor` and
 *  `executeEnabled` are resolved by the wrapper (JWT + env), never the body. */
export function readExecuteInput(
  body: Record<string, unknown>,
  expectedTenantId: string | null,
  actor: string,
  executeEnabled: boolean,
): ExecuteInput {
  const mode: "prepare" | "execute" = body.mode === "execute" ? "execute" : "prepare";
  const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
    ? (body.args as Record<string, unknown>)
    : {};
  const timeoutMs = typeof body.timeout_ms === "number" && Number.isFinite(body.timeout_ms) && body.timeout_ms > 0
    ? Math.min(body.timeout_ms, MAX_EXECUTE_TIMEOUT_MS)
    : undefined;
  return {
    connectionId: typeof body.connection_id === "string" ? body.connection_id : "",
    toolName: typeof body.tool_name === "string" ? body.tool_name : "",
    args,
    mode,
    expectedTenantId,
    actor,
    timeoutMs,
    executeEnabled,
  };
}
