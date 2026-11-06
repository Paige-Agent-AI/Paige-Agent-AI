// Generic, connection-parameterized capability RUNNER (Phase S foundation + Phase C hard-entry
// safeguards #1262 findings 1/2/4/5, still library-only).
//
// One runner for ANY connected MCP — no per-provider lane. It reuses the hardened
// `withApprovedCapabilitySession` from `../mcp-client.ts`, which lists the provider's tools and
// runs one, IN THE SAME SESSION, so what was verified and what runs are the same catalogue with
// no substitution window.
//
// The permission model (review §7 / owner ruling §2.2):
//   * The provider's LIVE tool catalog + granted scopes ARE Paige's surface. The runner imposes
//     NO separate capability allowlist and NO static read-only ceiling.
//   * read / prepare are always allowed on a provider-authorized tool.
//   * A consequential external effect EXECUTES after owner approval — the approval is the gate.
//     Lacking approval, it is `refused`, NEVER reported as unavailable for being a mutation.
//   * An uncertain result after dispatch is `outcome_unknown` and is NEVER auto-retried.
//
// THE PHASE C HARD-ENTRY SAFEGUARDS wired here (each proven against the in-process fake only):
//   0. SINGLE SOURCE (MCP PR-1): the dispatch endpoint/auth AND the consent identity BOTH derive from
//      the ONE canonical connection row, loaded server-side by `connectionId`
//      (`deps.loadConnection` → `get_mcp_connection_secret`). The request carries NO url, so a caller
//      can never verify consent against endpoint A and dispatch to endpoint B; a row whose tenant is
//      not the caller's server-derived tenant is refused `foreign_tenant` (§9).
//   1. Whether a tool needs approval is decided SERVER-AUTHORITATIVELY (`resolveEffectApproval`):
//      provider `_meta.effects` may raise the gate, never lower it below the mutation-verb name
//      floor. A mislabeled `["read"]` on a `send_*`/`delete_*` tool still requires approval.
//   2. Consent is DURABLE and server-verified (`deps.verifyApproval`, backed by
//      `verify_mcp_connection_approval`): a stored approval bound to the connection, endpoint
//      identity, live fingerprint, action shape and expiry. The runner NEVER infers consent from
//      a pin carried in its own request — there is no `approval` field any more.
//   4. A dispatched call whose result carries `isError` (incl. a malformed non-boolean isError) or
//      an unrecognized shape is never dressed as `executed`/`read_observed` (`validateToolResult`).
//      For a READ it is `tool_error`; for a MUTATION it is `outcome_unknown` — the effect may have
//      landed, so it must never read as "nothing half-done" nor be auto-retried (Codex P2).
//   5. Its `recordReceipt` dep routes the final outcome to the CANONICAL Rail (see rail-receipt.ts),
//      and the runner carries back whether that row actually persisted (`RunnerResult.receipt`) so a
//      completed-but-unrecorded run is reported truthfully, never as a fully-recorded success.
//
// PHASE S/C BOUNDARY: this module is wired into no deployed provider-calling endpoint. `execute`
// is proven only against an in-process fake MCP server in the smoke; a live invocation is Phase C,
// gated behind #1255 + owner go. The safeguards above are the gate it must pass first.

import { withApprovedCapabilitySession } from "../mcp-client.ts";
import type { ReceiptFiling, RunnerOutcome, RunnerResult } from "./types.ts";
import { resolveEffectApproval } from "./effect-policy.ts";
import { projectToolResultData, validateToolResult } from "./result.ts";
import { argsShapeHash, type ApprovalVerifier } from "./consent.ts";
import type { ConnectionLoader } from "./connection.ts";
import { type CallerAuthority, resolveRestrictedUse } from "./authority.ts";

function errorCodeOf(e: unknown): string {
  if (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  return "runner_failed";
}

// Reduce a UUID to its 32-hex canonical key for identity comparison, or `null` when the value is NOT a
// PostgreSQL-valid UUID. This mirrors Postgres's own `uuid` input grammar, so it accepts EXACTLY what
// the typed-`uuid` RPC arg accepts and nothing more: after lowercasing and dropping one optional pair of
// braces, 32 hex digits in eight 4-digit groups with an OPTIONAL single hyphen at any of the seven group
// boundaries. That admits canonical 8-4-4-4-12, hyphenless, the fully-hyphenated 4-4-4-4-4-4-4-4 form,
// and every other Postgres grouping (so a legitimately-loaded row is never a false `connection_mismatch`
// / `foreign_tenant`), while rejecting a leading / trailing / mid-group / doubled hyphen, non-hex, or
// wrong length. The key is produced ONLY for a value that matches the grammar — never by stripping an
// arbitrary string — so two distinct identities can never reduce to the same key and collide (Codex P2),
// while every DB-accepted spelling of the SAME id matches. In production the RPC already rejects a
// non-UUID; this validates independently because the guard is deliberately loader-independent (§39).
const canonicalUuid = (v: string): string | null => {
  const s = v.toLowerCase().replace(/^\{(.*)\}$/, "$1");
  return /^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/.test(s) ? s.replace(/-/g, "") : null;
};

// Do two identifiers name the SAME identity? Both valid UUIDs → compare canonical keys (so any accepted
// spelling matches). A valid UUID vs a non-UUID → NEVER the same (this is what refuses Codex's
// `zzabcdef…` alias against a real UUID row — a malformed value is not silently reduced to a colliding
// key). Neither a UUID → an OPAQUE identifier from an alternate loader, compared EXACTLY: case-
// sensitive and NOT trimmed. Lowercasing or trimming would equate distinct identities (`tenant/foo`
// vs `TENANT/FOO`, or `x` vs `x `) and let consent verify against one id while dispatch resolves the
// other — defeating the loader-independent single-source guard (Codex P2, bba9d5d3). In production both
// ids are UUIDs (the typed-`uuid` RPC + server-resolved tenant), so the first branch always applies;
// the exact fallback keeps the guard loader-independent (§39) without ever coercing two ids to match.
const sameId = (a: string, b: string): boolean => {
  const ka = canonicalUuid(a);
  const kb = canonicalUuid(b);
  if (ka !== null && kb !== null) return ka === kb;
  if (ka !== null || kb !== null) return false;
  return a === b;
};

export type RunnerDeps = {
  /** Records the run's outcome. In production this is the CANONICAL-Rail receipt
   *  (`makeCanonicalRailReceipt`); the smoke injects a collector. Best-effort — a recording
   *  failure never turns a completed action into a reported failure. It MAY return a
   *  `ReceiptFiling` saying whether the row actually persisted; the runner carries that on
   *  `RunnerResult.receipt` so a completed-but-unrecorded run is never reported as fully
   *  recorded (Codex R3). A writer that returns nothing makes no filing claim. */
  recordReceipt?: (r: {
    connectionId: string;
    toolName: string;
    outcome: RunnerOutcome;
    runId: string;
    detail: Record<string, unknown>;
  }) => Promise<ReceiptFiling | void> | ReceiptFiling | void;
  /** Durable, server-side consent check (#1262 finding 2). In production backed by
   *  `verify_mcp_connection_approval`; the smoke injects a fixture-bound fake. When a tool requires
   *  approval and no verifier is wired, the run fails CLOSED. */
  verifyApproval?: ApprovalVerifier;
  /** Resolves a `connection_id` to its CANONICAL endpoint + auth + tenant from the one server-side
   *  connection row (production: `makeRpcConnectionLoader` over `get_mcp_connection_secret`). The
   *  runner dispatches ONLY to what this returns — a caller never supplies a URL (MCP PR-1). When a
   *  run would dispatch and no loader is wired, the run fails CLOSED. */
  loadConnection?: ConnectionLoader;
};

export type RunnerRequest = {
  /** The immutable connection identity. It ALONE selects the row that supplies BOTH the dispatch
   *  endpoint (via `deps.loadConnection`) and the consent identity (via `deps.verifyApproval`) — the
   *  request carries no URL, so consent and dispatch can never derive from two different sources
   *  (MCP PR-1). */
  connectionId: string;
  /** The caller's SERVER-DERIVED tenant. The loaded connection row's tenant must match it or the run
   *  is refused `foreign_tenant` (§9); `get_mcp_connection_secret` is tenant-agnostic, so this is
   *  where cross-tenant use is caught. */
  tenantId: string;
  /** The caller's SERVER-DERIVED authority (INT-082/INT-089). REQUIRED to use an `owner_only`
   *  connection — a run that omits it (or presents an unknown shape) is refused `owner_only_forbidden`
   *  (fail closed). Typed optional so the "missing authority" case is representable and caught, exactly
   *  like the DB's `_loaded_endpoint_hash` guard: a guard that cannot be exercised for its absent case
   *  is not a guard. A `tenant`-visibility connection never consults it. It is a CAPABILITY, never a
   *  role literal — see {@link CallerAuthority}. */
  callerAuthority?: CallerAuthority;
  toolName: string;
  args: Record<string, unknown>;
  mode: "prepare" | "execute";
  timeoutMs?: number;
};

export async function runConnectionCapability(
  req: RunnerRequest,
  deps: RunnerDeps = {},
): Promise<RunnerResult> {
  const runId = crypto.randomUUID();
  // INT-082: when an `owner_only` run is authorized by EXPLICIT system authority, the reason is
  // attached to the receipt detail so the run is attributable (never a silent service-role bypass).
  // HONEST CAVEAT (§13): the canonical Rail writer (`makeCanonicalRailReceipt`) currently DROPS
  // `detail`, so this is best-effort attribution captured on the receipt object / the operational
  // `mcp_connection_receipts` writer — NOT a persisted Rail field. Persisting it is a separate change
  // to the `record_capability_run` contract, out of INT-082's scope. The security property (no system
  // use of an owner_only connection WITHOUT an explicit reason) holds regardless of persistence.
  let authorityDetail: Record<string, unknown> = {};
  const emit = async (
    outcome: RunnerOutcome,
    code: string | null,
    // The bounded data projection, carried ONLY for a validated clean success (see types.ts
    // `RunnerResult.data`). Every other path passes null — an unvalidated payload is never echoed.
    data: string | null = null,
  ): Promise<RunnerResult> => {
    // The receipt is best-effort for the OUTCOME (a landed effect is never downgraded to a failure
    // because its Rail row did not persist — §13/§32) but TRUTHFUL for the RECORD: whatever the
    // writer reports about whether the row persisted is carried through, so a completed-but-
    // unrecorded run is never dressed as fully recorded (Codex R3). No writer, or one that returns
    // nothing → no filing claim (`null`); a writer that throws is itself a filing failure.
    // The DATA projection is deliberately NOT in the receipt detail — receipts are the owner's
    // audit trail of outcomes, not a provider-content store.
    let receipt: ReceiptFiling | null = null;
    try {
      const filing = await deps.recordReceipt?.({
        connectionId: req.connectionId,
        toolName: req.toolName,
        outcome,
        runId,
        detail: { ...authorityDetail, ...(code ? { code } : {}) },
      });
      if (filing) receipt = filing;
    } catch { receipt = { filed: false, reason: "record_threw" }; }
    return { outcome, runId, code, data, receipt };
  };

  // SINGLE SOURCE (MCP PR-1): resolve the ONE canonical connection row server-side by `connectionId`
  // FIRST — for BOTH prepare and execute — so the request never carries a URL and every mode applies
  // the same existence/id/tenant gates. A caller can never verify consent against endpoint A and
  // dispatch to endpoint B, and never gets a "prepared" affirmation for a connection it does not own
  // or that does not exist (Codex P2). Loading is a server-side row read, no provider contact.
  // No loader wired ⇒ fail closed.
  const canon = deps.loadConnection
    ? await deps.loadConnection(req.connectionId)
    : { ok: false as const, reason: "no_connection" as const };
  if (!canon.ok) return await emit("refused", canon.reason);
  // Defense-in-depth (§39): the loaded row MUST be the exact connection the caller named, so the id
  // that backs consent below is provably the id that backs this dispatch. This keeps the single-source
  // invariant LOADER-INDEPENDENT — a future/alternate loader that resolved an alias or redirect to a
  // different row could otherwise reintroduce a two-source divergence (consent for id A, dispatch to
  // row B) without this guard.
  // Identity comparison is by `sameId` (canonical-UUID equality for valid UUIDs; exact, non-stripping
  // otherwise) — a caller may name a valid UUID in any accepted spelling while the row carries the
  // canonical form, but a malformed value is never coerced into a colliding match (Codex P2).
  if (!sameId(req.connectionId, canon.connectionId)) return await emit("refused", "connection_mismatch");
  // §9 isolation: `get_mcp_connection_secret` is tenant-agnostic, so the runner enforces that the
  // row's tenant is the caller's server-derived tenant. A foreign-tenant connection never dispatches
  // — nor prepares.
  if (!sameId(req.tenantId, canon.tenantId)) return await emit("refused", "foreign_tenant");

  // INT-082: an `owner_only` connection is usable only by a caller holding the restricted-use
  // capability. `get_mcp_connections_v2` already HIDES it from an ordinary member's list, but the
  // runner resolves BY ID, so a member who learned the id could otherwise prepare/execute it. Enforce
  // on BOTH prepare and execute, AFTER `foreign_tenant` (a cross-tenant caller is refused first, so an
  // owner_only refusal never leaks that a connection exists in another tenant) and BEFORE the prepare
  // affirmation and any approval/dispatch (an ordinary member never gets an owner_only connection
  // affirmed as prepared, and never reaches the provider). Fail closed: a missing/unknown authority is
  // refused. The check is on the CAPABILITY, never a role literal — a delegated grant added to the
  // server-side mapping (`_mcp_caller_capabilities`) is honored here with no code change (INT-089).
  if (canon.visibility === "owner_only") {
    // The capability authority is checked for the restricted capability AND bound to the loaded
    // connection's tenant via `sameId` (Codex P2) — a cap resolved for another tenant cannot authorize
    // this run even after `foreign_tenant` proved the connection is the caller's own tenant.
    const restricted = resolveRestrictedUse(req.callerAuthority, canon.tenantId, sameId);
    if (!restricted.allowed) return await emit("refused", "owner_only_forbidden");
    // Explicit system authority: record its reason for attribution (see the emit caveat above).
    if (restricted.systemReason) authorityDetail = { restricted_use: "system", system_authority_reason: restricted.systemReason };
  }

  // prepare stages intent only — the connection is validated above, but it opens no session and
  // contacts no provider.
  if (req.mode === "prepare") return await emit("prepared", null);

  let dispatched = false;
  // The server-resolved effect decision, hoisted so the post-dispatch catch can classify a THROWN
  // transport failure by read-vs-mutation without re-deriving it from provider metadata (Codex P2).
  let consequential = false;
  try {
    return await withApprovedCapabilitySession<RunnerResult>(
      { serverUrl: canon.serverUrl, auth: canon.auth, timeoutMs: req.timeoutMs },
      async ({ tools, call }) => {
        // The provider's live catalog IS the surface. A tool the connection does not currently
        // offer is not runnable — that is the provider's authority speaking, not a Paige gate.
        const tool = tools.find((t) => t.name === req.toolName);
        if (!tool) return await emit("refused", "no_longer_offered");

        // (1) SERVER-AUTHORITATIVE effect decision — provider metadata may only RAISE the gate.
        const decision = resolveEffectApproval(tool.name, tool.effects);
        consequential = decision.requiresApproval; // carried into the catch for a post-dispatch throw
        if (decision.requiresApproval) {
          // (2) DURABLE consent — verified against the stored, endpoint-bound approval, never a
          // pin in this request. No verifier wired ⇒ fail closed.
          const shapeHash = await argsShapeHash(req.args);
          const check = deps.verifyApproval
            ? await deps.verifyApproval({
              connectionId: req.connectionId,
              toolName: tool.name,
              livePin: tool.pin,
              // INT-078: bind consent to the endpoint the loader resolved (what we will dispatch to),
              // not merely the connection id — closes the load↔verify TOCTOU.
              loadedEndpointHash: canon.endpointHash,
              argsShapeHash: shapeHash,
            })
            : { authorized: false, reason: "approval_unavailable" };
          if (!check.authorized) {
            // A generic "approval_required" degrades to the precise basis when the store had no
            // opinion, so an operator learns WHY (undeclared effects vs. a missing approval).
            const code = check.reason && check.reason !== "approval_required"
              ? check.reason
              : (decision.basis === "effects_undeclared" ? "effects_undeclared" : "approval_required");
            return await emit("refused", code);
          }
        }

        dispatched = true;
        const result = await call(req.toolName, req.args);
        // (4) The provider RAN it. A clean, recognized result with no error is the ONLY success.
        const validated = validateToolResult(result);
        if (validated.recognized && !validated.isError) {
          // Carry WHAT the tool returned (bounded, sanitized at this provider boundary) so the
          // caller's model can actually confirm a read/execute — the closed vocabulary alone
          // left a successful lookup unconfirmable (2026-11-06 owner incident).
          return await emit(
            decision.requiresApproval ? "executed" : "read_observed",
            null,
            projectToolResultData(result),
          );
        }
        // Not a clean success. A CONSEQUENTIAL (approval-gated) call has already DISPATCHED, so its
        // effect may have landed fully or partially — a provider error / malformed / unaccepted
        // result does NOT prove rollback. Reporting `tool_error` (→ `capability_failed`, which the
        // Rail renders to the owner as "nothing was left half-done") would be catastrophically wrong
        // for a landed mutation and could prompt a DUPLICATING retry, so a mutation's post-dispatch
        // non-success is `outcome_unknown` (→ "may or may not have taken effect; check before running
        // again") and is NEVER auto-retried (Codex P2). A READ has no side effect, so a failed/errored
        // read is honestly `tool_error`.
        const code = validated.recognized ? "provider_reported_error" : "unrecognized_result";
        return await emit(decision.requiresApproval ? "outcome_unknown" : "tool_error", code);
      },
    );
  } catch (e) {
    const code = errorCodeOf(e);
    // Before dispatch: the provider was unreachable / refused the session → provider_unavailable.
    // After dispatch the tools/call itself threw (HTTP error, timeout, malformed envelope). The
    // read-vs-mutation distinction still holds and is carried from `consequential` (resolved BEFORE
    // dispatch — never re-derived from provider metadata here, Codex P2): a MUTATION may have landed,
    // so it is `outcome_unknown` and is never auto-retried; a READ has no side effect, so it is
    // `tool_error` (→ capability_failed), never a false "may have taken effect" warning.
    if (!dispatched) return await emit("provider_unavailable", code);
    return await emit(consequential ? "outcome_unknown" : "tool_error", code);
  }
}
