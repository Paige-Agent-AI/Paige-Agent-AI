// Connected MCP Gateway — VERIFY (Slice ①: the probe's first live caller).
//
// A connection created in the registry starts `pending_verification`: the row is a CLAIM
// (an address + a credential) that has never been proven. Postgres cannot make an outbound
// request, so a row can only become `connected` when something reaches the provider, runs the
// MCP handshake read-only, and writes the result through the service-role probe. This module is
// that something, factored out of the Deno edge wrapper so the whole authority + mapping path is
// headless-provable (the wrapper only builds the two clients and translates the result to HTTP).
//
// AUTHORITY (§9/§59). The caller's tenant is resolved SERVER-SIDE from their JWT
// (`current_user_tenant_id`), never from the body. Three gates, all bound to that one active
// tenant, must pass before any secret is read:
//   1. the body's `expected_tenant_id` (if present) equals the server-resolved tenant — the
//      workspace-switch-race guard the sibling `tenant-mcp-connect` established;
//   2. the caller is a tenant admin (`is_current_user_tenant_admin`) — the `manage` gate the
//      G1a-1 writer RPCs require;
//   3. the connection is visible to THIS caller in `get_mcp_connections_v2` (RLS + tenant +
//      owner_only visibility scoped) — a connection in another tenant is simply absent, so a
//      cross-tenant id gets the same `not_found` a nonexistent one does (no IDOR, no info leak).
// `get_mcp_connection_secret` is tenant-AGNOSTIC (service role, loads any id), so after the loader
// resolves the row we RE-ASSERT its tenant equals the caller's active tenant (defense in depth).
//
// SECRET DISCIPLINE (§13). The secret is decrypted server-side inside the loader, used for one
// read-only intake, and dropped. Nothing here returns the server URL, the credential, or raw
// provider text — only status/health, a tool count, and a closed error code the product renders.

import { makeRpcConnectionLoader } from "./connection.ts";
import { runReadOnlyIntake } from "./intake.ts";
import type { IntakeResult } from "./types.ts";
import type { McpAuth, McpToolFingerprint } from "../mcp-client.ts";

// The one thing runVerify needs from a Supabase client: an awaitable `rpc`. The real
// `SupabaseClient.rpc()` returns a PostgrestFilterBuilder — a thenable (`PromiseLike`), NOT a full
// `Promise` (it lacks catch/finally/[Symbol.toStringTag]) — and `await` only needs a thenable, so
// the seam is typed `PromiseLike`. Typing it `Promise` made the real client fail to satisfy the
// dep under `deno check` (the smoke's esbuild strips types, so only the Deno ratchet catches it).
// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export type VerifyDeps = {
  /** RLS-scoped as the caller (anon key + the caller's Authorization). All authority gates run here. */
  userClient: RpcClient;
  /** service-role client — the ONLY thing allowed to read the decrypted secret and write the probe. */
  admin: RpcClient;
};

export type VerifyInput = {
  connectionId: string;
  /** The tenant the caller BELIEVED they were acting on when the request left the browser. */
  expectedTenantId: string | null;
};

export type VerifyResult = {
  httpStatus: number;
  // Response body carries only model-/browser-safe facts; never a secret or provider prose.
  body: Record<string, unknown>;
};

// Substring-matching a credential against provider-controlled catalog text is only SOUND when the
// credential is long enough not to collide with ordinary text. Below this floor a token like "a"
// would match "search"/"read" and permanently reject a HEALTHY provider (a false-positive DoS),
// while a real bearer/OAuth/API credential is far longer. The fully sound fix is a writer-side
// MINIMUM credential length, so a stored secret is always both scannable AND collision-free — that
// is a writer migration, tracked for Slice ② (INT-153). Until then a sub-floor credential is not
// scanned by this defense-in-depth guard (the leak of a <12-char string is not a meaningful
// credential exposure, and matching it would reject legitimate catalogs).
const MIN_SECRET_SCAN_LEN = 12;

/** The credential material a healthy provider must NEVER echo back to us. For bearer/header auth it is
 *  the exact token we send (scanned once it clears the floor). For the `none` kind the secret lives in
 *  the URL path/query (Zapier's shape) and a server can percent-DECODE its own route, so a stored
 *  `%73ecret…` can come back as `secret…` — scan BOTH the raw segment and its decoded form. Short/common
 *  URL parts (`api`, `mcp`, `v1`) stay below the floor, so a bearer connection's public path never
 *  registers as a secret. */
function credentialMaterial(auth: McpAuth, serverUrl: string): string[] {
  const out: string[] = [];
  if ((auth.kind === "bearer" || auth.kind === "header") && typeof auth.token === "string" && auth.token.length >= MIN_SECRET_SCAN_LEN) {
    out.push(auth.token);
  } else if (auth.kind === "none") {
    try {
      const u = new URL(serverUrl);
      for (const seg of [...u.pathname.split("/"), ...u.searchParams.values()]) {
        let decoded = seg;
        try { decoded = decodeURIComponent(seg); } catch { /* malformed escape — keep the raw form */ }
        if (seg.length >= MIN_SECRET_SCAN_LEN) out.push(seg);
        if (decoded !== seg && decoded.length >= MIN_SECRET_SCAN_LEN) out.push(decoded);
      }
    } catch { /* the loader already validated the url shape; nothing to scan */ }
  }
  return out;
}

/** True if a discovered tool REFLECTS our own credential back inside a provider-controlled field
 *  (name/app/actionType/effects). A compromised or hostile MCP server can copy the bearer token it
 *  received — or the secret in a credential-bearing URL — into a tool name, and persisting that
 *  verbatim would downgrade an encrypted, service-role-only credential into plaintext catalog data
 *  that later surfaces to client state / logs (§13 — no secret in an artifact). The SHA-256 fields
 *  (schemaHash/authorityHash/pin) cannot carry a raw secret, so they are not scanned. A server that
 *  echoes our secret is not healthy: the caller rejects the WHOLE catalog rather than store any of it. */
export function intakeReflectsCredential(tools: McpToolFingerprint[], auth: McpAuth, serverUrl: string): boolean {
  const secrets = credentialMaterial(auth, serverUrl);
  const headerValues = Object.values(auth.headers ?? {});
  // Supplementary values can be short configuration such as a region. Long values use the same
  // substring defense as tokens; short values match whole lexical tokens, not e.g. "us" in
  // "customers". This is a reflection defense, not a claim to detect encoded/covert exfiltration.
  const reflectsHeader = (field: string) => headerValues.some(value => {
    if (value.length >= MIN_SECRET_SCAN_LEN) return field.includes(value);
    if (!value) return false;
    // Keep punctuation WITHIN a private value intact; inspect only its surrounding boundaries.
    for (let at = field.indexOf(value); at !== -1; at = field.indexOf(value, at + 1)) {
      if (!/[A-Za-z0-9]/.test(field[at - 1] ?? "") && !/[A-Za-z0-9]/.test(field[at + value.length] ?? "")) return true;
    }
    return false;
  });
  if (secrets.length === 0 && headerValues.length === 0) return false;
  for (const t of tools) {
    for (const field of [t.name, t.app, t.actionType, ...(Array.isArray(t.effects) ? t.effects : [])]) {
      if (typeof field === "string" && (secrets.some((s) => field.includes(s)) || reflectsHeader(field))) return true;
    }
  }
  return false;
}

/** Map the read-only intake's tool fingerprints to the shape the probe RPC persists. The probe is
 *  authoritative for the catalog: it replaces the connection's tools with exactly this set. */
export function mapFingerprintsToProbeTools(intake: IntakeResult): Array<Record<string, unknown>> {
  return intake.tools.map((t) => ({
    tool_name: t.name,
    schema_hash: t.schemaHash,
    authority_hash: t.authorityHash,
    pin: t.pin,
    app: t.app,
    action_type: t.actionType,
    effects: t.effects,
  }));
}

/**
 * Authorize, then read-only-verify one connection and persist the result via the service-role probe.
 * Returns an HTTP status + a safe body; never throws through (a provider that is down or refuses the
 * credential is a health fact recorded on the row, not an exception). The caller is already
 * authenticated by the wrapper; this enforces tenant scope and the manage gate.
 */
export async function runVerify(deps: VerifyDeps, input: VerifyInput): Promise<VerifyResult> {
  const { userClient, admin } = deps;
  const { connectionId, expectedTenantId } = input;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId)) {
    return { httpStatus: 400, body: { error: "bad_connection_id" } };
  }
  // Normalize to the canonical lowercase form Postgres returns for a uuid, so the JS ownership
  // compare below matches a mixed-case input the way PG's case-insensitive uuid type does. Without
  // this, an uppercase/mixed-case id passes the case-insensitive regex, then fails the exact
  // string compare against the lowercase v2 rows → a spurious not_found. Fail-closed either way
  // (a case mismatch could only narrow the gate, never widen it — no IDOR), so this is a
  // usability fix, not a security fix; every downstream use keys off the canonical id.
  const id = connectionId.toLowerCase();

  // Tenant from the caller's JWT context — never the body (§9).
  const { data: tenantId, error: tErr } = await userClient.rpc("current_user_tenant_id");
  if (tErr || typeof tenantId !== "string" || !tenantId) {
    return { httpStatus: 400, body: { error: "no_tenant" } };
  }

  // Workspace-switch-race guard: refuse if the caller has since switched away from the tenant they
  // launched the verify from. A rebind to a different (also-theirs) workspace is silent otherwise.
  if (expectedTenantId && expectedTenantId !== tenantId) {
    return { httpStatus: 409, body: { error: "tenant_mismatch" } };
  }

  // Manage gate — mirror the G1a-1 writer RPCs (`mcp.connections.manage` = tenant admin).
  const { data: isAdmin } = await userClient.rpc("is_current_user_tenant_admin");
  if (isAdmin !== true) {
    return { httpStatus: 403, body: { error: "forbidden" } };
  }

  // §9 ownership + visibility: the connection must appear in the caller's own tenant-scoped v2 read.
  // A row in another tenant, or an owner_only row this caller cannot see, is absent → not_found.
  const { data: v2, error: vErr } = await userClient.rpc("get_mcp_connections_v2");
  if (vErr) return { httpStatus: 500, body: { error: "lookup_failed" } };
  const rows = Array.isArray(v2) ? v2 : [];
  const owned = rows.some((r) => r && typeof r === "object" && (r as { connection_id?: unknown }).connection_id === id);
  if (!owned) return { httpStatus: 404, body: { error: "not_found" } };

  // Authorized. Resolve the endpoint + auth SERVER-SIDE from the one row (the loader is the §18 home
  // for secret→connection resolution + usability). It fails closed on a disabled/unusable row.
  const loader = makeRpcConnectionLoader(admin);
  const resolved = await loader(id);
  if (!resolved.ok) {
    // Record an honest, secret-free health state so the row does not sit on a stale "pending".
    // If THIS write itself fails, we must not return a successful error-state response — an
    // already-`connected` row would silently stay connected/healthy despite a failed verify
    // (e.g. an expired OAuth token). Surface probe_write_failed exactly as the success branch does.
    const { error: lpErr } = await admin.rpc("mcp_connection_probe", {
      _connection_id: id,
      _status: "error",
      _health: "needs_attention",
      _last_error_code: resolved.reason,
      _tools: null,
    });
    if (lpErr) return { httpStatus: 500, body: { error: "probe_write_failed" } };
    return { httpStatus: 200, body: { ok: false, status: "error", health: "needs_attention", tool_count: 0, error_code: resolved.reason } };
  }

  // Defense in depth (§9): the tenant-agnostic loader loaded SOME row; it must be the caller's.
  if (resolved.tenantId !== tenantId) {
    return { httpStatus: 403, body: { error: "forbidden" } };
  }

  // INT-152: bind the probe write to the generation the loader read (compare-and-write). The parameter is
  // included ONLY when a numeric generation was actually loaded — so during the deploy window where this
  // edge is live but the migration's 6-arg probe is not yet applied (the loader then returns no
  // config_generation → null), the call omits the key and resolves to the still-live 5-arg probe rather
  // than erroring on an unknown argument (§37 deploy-ordering safety). Post-migration it is always a number.
  const genParam: { _expected_generation?: number } =
    typeof resolved.configGeneration === "number" ? { _expected_generation: resolved.configGeneration } : {};

  // Read-only handshake: initialize + tools/list via the SSRF-guarded client. Never a tools/call.
  const intake = await runReadOnlyIntake({ serverUrl: resolved.serverUrl, auth: resolved.auth });

  // Credential-reflection guard (§13). A compromised/hostile server can echo the credential we just
  // sent it back inside a tool field; persisting that would leak a service-role-only secret into the
  // plaintext catalog. If the healthy-looking catalog reflects our secret, reject the WHOLE catalog
  // and record an honest error — never store a poisoned tool set. Only meaningful on a successful
  // read (a failed intake carries no catalog to persist).
  if (intake.ok && intakeReflectsCredential(intake.tools, resolved.auth, resolved.serverUrl)) {
    const { data: rProbeRes, error: rpErr } = await admin.rpc("mcp_connection_probe", {
      _connection_id: id,
      _status: "error",
      _health: "needs_attention",
      _last_error_code: "provider_reflected_credential",
      _tools: null,
      ...genParam,   // INT-152: bind the error write to the loaded config (see genParam note above)
    });
    if (rpErr) return { httpStatus: 500, body: { error: "probe_write_failed" } };
    // INT-152: the connection was re-keyed while this verify was in flight — the error write was a no-op
    // against the fresh config, so report the race honestly rather than a stale "error" state (§13).
    if (rProbeRes && (rProbeRes as { applied?: unknown }).applied === false) {
      return { httpStatus: 409, body: { ok: false, status: "pending_verification", tool_count: 0, error_code: "config_changed_during_verify" } };
    }
    return { httpStatus: 200, body: { ok: false, status: "error", health: "needs_attention", tool_count: 0, error_code: "provider_reflected_credential" } };
  }

  // Persist through the service-role probe — the ONLY writer of status='connected'/health='healthy'
  // and of mcp_connection_tools. Replace the catalog only on a successful read (a failed probe must
  // not wipe a previously-good catalog to empty).
  const { data: probeRes, error: pErr } = await admin.rpc("mcp_connection_probe", {
    _connection_id: id,
    _status: intake.status,
    _health: intake.health,
    _last_error_code: intake.errorCode,
    _tools: intake.ok ? mapFingerprintsToProbeTools(intake) : null,
    ...genParam,   // INT-152: compare-and-write against the loaded config (see genParam note above)
  });
  if (pErr) return { httpStatus: 500, body: { error: "probe_write_failed" } };
  // INT-152: a stale generation means the connection was re-keyed while this verify was in flight — the
  // probe did NOT clobber the fresh config or catalog. Report the race honestly (§13); do not claim a
  // connection this verify never actually persisted.
  if (probeRes && (probeRes as { applied?: unknown }).applied === false) {
    return { httpStatus: 409, body: { ok: false, status: "pending_verification", tool_count: 0, error_code: "config_changed_during_verify" } };
  }

  return {
    httpStatus: 200,
    body: {
      ok: intake.ok,
      status: intake.status,
      health: intake.health,
      tool_count: intake.ok ? intake.tools.length : 0,
      error_code: intake.errorCode,
    },
  };
}
