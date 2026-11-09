// Connected MCP Gateway — APPROVE (Slice ③: the operator's per-tool consent writer).
//
// The MANAGE action that records a DURABLE, endpoint-bound approval for one (connection, tool), so a
// later `execute` of a consequential tool can spend it (`verify_mcp_connection_approval`, consent.ts).
// §18/§14: it composes the already-live, hardened writer `set_mcp_connection_approval` (migration
// 20270323000000) — it re-implements none of that writer's FOR UPDATE lock, reviewed-endpoint guard,
// or pin/shape validation.
//
// AUTHORITY (§9/§59) — mirrors runVerify / runOauthBegin exactly (a connection-scoped admin action):
//   1. tenant from `current_user_tenant_id` (never the body);
//   2. workspace-switch-race guard (`expected_tenant_id`);
//   3. `is_current_user_tenant_admin` — the manage gate the writer's `_mcp_resolve_tenant(_,true)`
//      also enforces in-body;
//   4. §9 ownership/visibility via `get_mcp_connections_v2` — a foreign/invisible id is `not_found`
//      (the same as a nonexistent one; no IDOR).
// The writer is then called through the caller's userClient, so its IN-BODY admin+tenant gate is the
// real authority; the edge can only NARROW it (§59 — the EXECUTE grant is never the guard).
//
// WHY THE EDGE READS THE PIN + ENDPOINT HASH SERVER-SIDE (§13 honest note). `set_mcp_connection_approval`
// REQUIRES the tool's fingerprint `_pin` (64-hex) and a reviewed `_expected_endpoint_hash`. NEITHER is
// exposed to a client today — `get_mcp_connections_v2` returns tool_count + host only, while the pin
// (`mcp_connection_tools.pin`) and the endpoint hash (`get_mcp_connection_secret`) are service-role-only.
// So the edge resolves BOTH server-side: the live-verified tool pin (the catalog the last `verify`
// persisted) and the endpoint hash. A caller MAY still supply `expected_endpoint_hash` (a forward seam
// for the Slice ④ review surface); whatever it supplies is compared by the writer against the connection's
// CURRENT locked endpoint and can only FAIL the write (a stale hash → MCP_ENDPOINT_CHANGED), never widen
// it — so accepting it is safe. HONEST DEGRADE (§13): until the Slice ④ review surface exposes the endpoint
// hash to the admin client, the "the operator reviewed THIS endpoint" guarantee reduces to an
// edge-read-vs-writer-locked-read TOCTOU check (still real — a re-point landing between the two reads is
// refused MCP_ENDPOINT_CHANGED). The full reviewed-endpoint semantic is a tracked Slice ④ follow-up.

import { mapWriterError } from "./writer-errors.ts";

// The one thing runApprove needs from a Supabase client: an awaitable `rpc` (a PromiseLike, matching
// verify.ts/create.ts, so the real SupabaseClient satisfies the dep under `deno check`).
// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export type ApproveDeps = {
  /** RLS-scoped as the caller (anon key + the caller's Authorization). All authority gates run here,
   *  and the writer is called through it so its in-body admin+tenant gate is the authority (§59). */
  userClient: RpcClient;
  /** service-role client — reads the connection's current endpoint hash (`get_mcp_connection_secret`)
   *  when the caller supplied none. Never the guard: the writer re-checks tenant + endpoint in-body. */
  admin: RpcClient;
  /** Service-role read of the live-verified tool fingerprint (`mcp_connection_tools.pin`) for
   *  (connection, tool). Injectable seam (headless-testable) — the wrapper builds it from the admin
   *  table read. Returns null when the tool is not in the connection's verified catalog. */
  readToolPin: (connectionId: string, toolName: string) => Promise<string | null>;
};

export type ApproveInput = {
  connectionId: string;
  toolName: string;
  /** The tenant the caller BELIEVED they were acting on when the request left the browser. */
  expectedTenantId: string | null;
  /** Optional operator-reviewed endpoint hash (a forward seam for the Slice ④ review surface). When
   *  absent, the edge reads the connection's current hash server-side. Either way the writer compares
   *  it against the locked endpoint and refuses a mismatch — it can only fail the write, never widen it. */
  expectedEndpointHash: string | null;
  /** Optional action-shape binding (consent.ts argsShapeHash) — restricts the approval to one call shape. */
  argsShapeHash: string | null;
  /** Optional expiry (ISO 8601) after which the approval no longer authorizes execution. */
  expiresAt: string | null;
};

export type ApproveResult = {
  httpStatus: number;
  // Response body carries only model-/browser-safe facts; never a secret, a raw PG message, or a
  // gate-distinguishing suffix (mapWriterError collapses every 42501 to a uniform MCP_FORBIDDEN).
  body: Record<string, unknown>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

/** The one-home builder for the live-verified tool pin reader (§18). The pin lives in
 *  `mcp_connection_tools` (service-role read only) — both the wrapper's approve branch and its
 *  verify branch (connect-consent, owner decision 2026-11-05) build this from the service-role
 *  client, so runApprove and the connect-consent pass resolve pins through the identical path.
 *  Typed against the minimal `from` seam the real SupabaseClient satisfies under `deno check`. */
// deno-lint-ignore no-explicit-any
export function makeReadToolPin(admin: { from: (table: string) => any }): ApproveDeps["readToolPin"] {
  return async (connectionId: string, toolName: string): Promise<string | null> => {
    const { data, error } = await admin
      .from("mcp_connection_tools")
      .select("pin")
      .eq("connection_id", connectionId)
      .eq("tool_name", toolName)
      .maybeSingle();
    if (error || !data) return null;
    return typeof (data as { pin?: unknown }).pin === "string" ? (data as { pin: string }).pin : null;
  };
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Authorize (identical gates to runVerify), resolve the pin + endpoint hash server-side, then record
 * the durable approval through the caller's userClient (its in-body admin+tenant gate is the authority).
 * Returns an HTTP status + a safe body for every handled path; a client transport-layer rpc REJECTION
 * (distinct from a Postgres error, which arrives in `.error`) falls through to the wrapper's fail-closed
 * platform 500 — no body, no secret — the same posture as the sibling verify/oauth handlers.
 */
export async function runApprove(deps: ApproveDeps, input: ApproveInput): Promise<ApproveResult> {
  const { userClient, admin, readToolPin } = deps;
  const { connectionId, toolName, expectedTenantId, expectedEndpointHash, argsShapeHash, expiresAt } = input;

  if (!UUID_RE.test(connectionId)) return { httpStatus: 400, body: { error: "bad_connection_id" } };
  const id = connectionId.toLowerCase();
  if (!TOOL_NAME_RE.test(toolName)) return { httpStatus: 400, body: { error: "bad_tool_name" } };
  // Shape-validate the optional forward-seam inputs early (the writer re-validates them in-body; this
  // is a fast, closed reject of obvious junk, never the authority).
  if (expectedEndpointHash !== null && !HEX64_RE.test(expectedEndpointHash)) {
    return { httpStatus: 400, body: { error: "bad_expected_endpoint" } };
  }
  if (argsShapeHash !== null && !HEX64_RE.test(argsShapeHash)) {
    return { httpStatus: 400, body: { error: "bad_args_shape" } };
  }
  // §13 (Codex P2): fast-reject an obviously-malformed or already-past `expires_at` here so a clearly
  // bad value gets a clean 400 without a round-trip. This edge-clock check is a UX PRE-FILTER, NOT the
  // authority: a value that is future here can still lapse during the intervening RPCs, and a
  // calendar-invalid string the writer's `timestamptz` cast rejects (22007/22008 → `bad_timestamp`) is
  // caught there. The ATOMIC guarantee that `approved: true` is never returned for an approval that
  // cannot authorize a run is the `trg_mcp_reject_past_approval_expiry` trigger (migration
  // 20270334000000) — it fires inside the writer's own transaction and raises MCP_EXPIRY_IN_PAST (→ 400).
  if (expiresAt !== null) {
    const expiryMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiryMs)) return { httpStatus: 400, body: { error: "bad_expiry" } };
    if (expiryMs <= Date.now()) return { httpStatus: 400, body: { error: "expiry_in_past" } };
  }

  // 1. Tenant from the caller's JWT — never the body (§9).
  const { data: tenantId, error: tErr } = await userClient.rpc("current_user_tenant_id");
  if (tErr || typeof tenantId !== "string" || !tenantId) {
    return { httpStatus: 400, body: { error: "no_tenant" } };
  }

  // 2. Workspace-switch-race guard.
  if (expectedTenantId && expectedTenantId !== tenantId) {
    return { httpStatus: 409, body: { error: "tenant_mismatch" } };
  }

  // 3. Manage gate — mirror the writer RPCs (`mcp.connections.manage` = tenant admin).
  const { data: isAdmin } = await userClient.rpc("is_current_user_tenant_admin");
  if (isAdmin !== true) {
    return { httpStatus: 403, body: { error: "forbidden" } };
  }

  // 4. §9 ownership + visibility: the connection must appear in the caller's own tenant-scoped v2 read.
  //    A row in another tenant, or an owner_only row this admin cannot see, is absent → not_found.
  const { data: v2, error: vErr } = await userClient.rpc("get_mcp_connections_v2");
  if (vErr) return { httpStatus: 500, body: { error: "lookup_failed" } };
  const rows = Array.isArray(v2) ? v2 : [];
  const owned = rows.some((r) => r && typeof r === "object" && (r as { connection_id?: unknown }).connection_id === id);
  if (!owned) return { httpStatus: 404, body: { error: "not_found" } };

  // Read the live-verified tool pin server-side — the client cannot obtain it. A tool absent from the
  // connection's verified catalog cannot be approved (verify the connection first).
  const pin = await readToolPin(id, toolName);
  if (typeof pin !== "string" || !HEX64_RE.test(pin)) {
    return { httpStatus: 409, body: { error: "tool_not_verified" } };
  }

  // Resolve the endpoint hash consent binds to. Prefer an operator-reviewed value (Slice ④ forward
  // seam); else read the connection's CURRENT hash server-side. The writer compares whichever it gets
  // against the locked endpoint, so a wrong value can only fail the write (§9 defense in depth below is
  // an extra check on the server-read path).
  let endpointHash = expectedEndpointHash;
  if (!endpointHash) {
    const { data: sec, error: sErr } = await admin.rpc("get_mcp_connection_secret", { _connection_id: id });
    if (sErr) return { httpStatus: 500, body: { error: "lookup_failed" } };
    const row = (sec ?? {}) as { configured?: unknown; enabled?: unknown; tenant_id?: unknown; endpoint_hash?: unknown };
    if (row.configured !== true) return { httpStatus: 409, body: { error: "connection_unconfigured" } };
    // A disabled connection is owned (v2 confirmed it above) — report its true state, not a misleading
    // `forbidden` (peer-gate #2). Checked before the tenant compare, which a disabled row may not satisfy.
    if (row.enabled === false) return { httpStatus: 409, body: { error: "connection_disabled" } };
    // §9 defense in depth: the tenant-agnostic read loaded SOME row; it must be the caller's own.
    if (typeof row.tenant_id !== "string" || row.tenant_id !== tenantId) {
      return { httpStatus: 403, body: { error: "forbidden" } };
    }
    endpointHash = typeof row.endpoint_hash === "string" ? row.endpoint_hash : null;
    if (!endpointHash || !HEX64_RE.test(endpointHash)) {
      return { httpStatus: 409, body: { error: "no_endpoint" } };
    }
  }

  // Record the durable approval through the caller's userClient — the writer's in-body admin+tenant
  // gate + FOR UPDATE endpoint-review guard is the authority (§59). Map any coded error to a safe,
  // suffix-stripped body (§18 one home).
  const { error: wErr } = await userClient.rpc("set_mcp_connection_approval", {
    _connection_id: id,
    _tool_name: toolName,
    _pin: pin,
    _tenant_id: tenantId,
    _args_shape_hash: argsShapeHash,
    _expires_at: expiresAt,
    _expected_endpoint_hash: endpointHash,
  });
  if (wErr) {
    const mapped = mapWriterError(wErr, "approve_failed");
    return { httpStatus: mapped.httpStatus, body: mapped.body };
  }

  return {
    httpStatus: 200,
    body: { ok: true, connection_id: id, tool_name: toolName, approved: true },
  };
}

/** Translate the untrusted HTTP body into a typed ApproveInput. Absent/wrong-typed optional fields
 *  become null; the writer's in-body checks own final validation. `expected_tenant_id` is passed
 *  separately (the wrapper shares it across actions). */
export function readApproveInput(
  body: Record<string, unknown>,
  expectedTenantId: string | null,
): ApproveInput {
  return {
    connectionId: typeof body.connection_id === "string" ? body.connection_id : "",
    toolName: typeof body.tool_name === "string" ? body.tool_name : "",
    expectedTenantId,
    expectedEndpointHash: nonEmptyString(body.expected_endpoint_hash),
    argsShapeHash: nonEmptyString(body.args_shape_hash),
    expiresAt: nonEmptyString(body.expires_at),
  };
}
