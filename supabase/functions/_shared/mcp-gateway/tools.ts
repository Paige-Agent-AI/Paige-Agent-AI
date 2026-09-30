// mcp-gateway — the `tools` action. Door 1: name the ACTIONS a connected tool offers, so the
// per-action approve surface can list real choices instead of an empty box.
//
// WHY THIS IS AN EDGE ACTION AND NOT JUST AN RPC. Whether a given action needs the owner's
// approval is decided by `resolveEffectApproval` (./effect-policy.ts) — TypeScript, not SQL, and
// deliberately so: the server floor wins over a provider's own claim, so a `send_*`/`delete_*`
// name still requires approval even when the provider labels it `["read"]`. Re-implementing that
// in SQL, or in the browser, forks the one rule that decides whether Paige may act — and two
// copies of an authority rule drift. So the RPC returns FACTS and this action applies the ONE
// policy to them.
//
// It also means the list can be honest about something the surface previously could not say: a
// tool that is genuinely a declared read runs WITHOUT approval. The old copy implied everything
// was gated; `resolveEffectApproval` returns `requiresApproval: false` for exactly that case and
// the runner skips the consent check for it. Showing "needs your approval" against such a tool
// would be a new false statement, so each row carries its own answer and the reason for it.
//
// NO SERVICE-ROLE CLIENT. Every sibling MANAGE action builds one; this one must not, and cannot
// need one. The RPC is granted to `authenticated` ONLY — granting it to service_role would let any
// edge branch holding an admin client read the owner_only catalogue of any tenant named in a
// request body. The caller's own client is the authority here, exactly as §59 requires: the
// grant is never the guard, the RPC's in-body bind is.
//
// READ, NOT MANAGE. Unlike `approve`, this does not require tenant-admin standing. The connection
// list already discloses `tool_count`/`approved_count` to an ordinary member, and this is the
// per-row expansion of those two integers. Admin standing still governs the WRITE, and still
// governs whether an `owner_only` connection is visible at all — both inside the RPC.

import { resolveEffectApproval } from "./effect-policy.ts";
import type { CapabilityEffect } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

/** One action, as the owner is shown it. Identity + effect shape + the approval story. */
export type GatewayTool = {
  name: string;
  effects: CapabilityEffect[];
  app: string;
  actionType: string;
  /** Server-authoritative: does Paige need consent before running this? */
  requiresApproval: boolean;
  /** WHY, so the surface can explain rather than assert. Null only when no approval is needed. */
  approvalBasis: "server_name_floor" | "provider_declared_effect" | "effects_undeclared" | null;
  /** An approval ROW exists. Strictly weaker than "the runner will authorize this". */
  approved: boolean;
  approvedAt: string | null;
  expiresAt: string | null;
  /** Verdicts computed on the SERVER clock / against the server's pin. Never client arithmetic. */
  approvalExpired: boolean;
  approvalStale: boolean;
  approvedByYou: boolean;
  /**
   * Why an existing approval would NOT authorize a run, or null when nothing a
   * catalogue can see would stop it. Null on an unapproved action too — `approved`
   * carries that, and conflating "no consent" with "consent is fine" is the bug
   * this field exists to make impossible.
   *
   * Five of the seven reasons `verify_mcp_connection_approval` refuses on. The other
   * two are about a specific dispatch (the endpoint a runner loaded, the arguments a
   * call carries) and cannot be known from a list, so a null here is never a promise
   * that a run will succeed — only that nothing visible from here blocks it.
   */
  approvalBlockedReason:
    | "endpoint_missing"
    | "contract_changed"
    | "approval_not_endpoint_bound"
    | "endpoint_changed"
    | "approval_expired"
    | null;
  observedAt: string | null;
};

export type ToolsResult = {
  httpStatus: number;
  body:
    | {
        ok: true;
        connection_id: string;
        tools: GatewayTool[];
        tool_count: number;
        approved_count: number;
        /** Freshness of the catalogue itself, never presented as "verified now". */
        observed_at: string | null;
      }
    | { error: string };
};

export function readToolsInput(
  body: Record<string, unknown>,
  expectedTenantId: string | null,
): { connectionId: string; expectedTenantId: string | null } {
  return {
    connectionId: typeof body.connection_id === "string" ? body.connection_id : "",
    expectedTenantId,
  };
}

const EFFECTS: readonly string[] = ["read", "create", "update", "send", "delete"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The closed vocabulary the RPC may answer with. Anything else is treated as a block with no
 *  nameable reason rather than passed through — a reason string the surface cannot render is
 *  worse than an honest "something about this approval no longer holds". */
const BLOCK_REASONS: readonly string[] = [
  "endpoint_missing",
  "contract_changed",
  "approval_not_endpoint_bound",
  "endpoint_changed",
  "approval_expired",
];
// The identifier grammar the DB, `toSafeCapabilities` and `approve`'s own guard all share. The RPC
// already drops rows failing it; re-checking costs nothing and means this module is safe to point
// at any row source, not only that one.
const NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
// `app`/`actionType` come from provider `_meta` and are provider-controlled. The RPC returns them
// verbatim; the printable-charset bound is applied here, mirroring `sanitizeLabel` in
// capability-summary.ts, so a provider cannot smuggle prose, newlines or control bytes into the
// surface. Kept identical to that function on purpose — if one changes, both must.
function sanitizeLabel(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[^A-Za-z0-9 ._:/@+-]/g, "").trim().slice(0, max);
}

function safeEffects(raw: unknown): CapabilityEffect[] {
  if (!Array.isArray(raw)) return [];
  const out = raw.filter((e): e is CapabilityEffect => typeof e === "string" && EFFECTS.includes(e));
  return [...new Set(out)].sort();
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const bool = (v: unknown): boolean => v === true;

/** A reason the surface can render, or null. An unknown non-empty string means the RPC knows
 *  something this module does not, so it is reported as a block under the safest reason rather
 *  than dropped — dropping it would silently promote a blocked approval back to "fine". */
function blockReason(v: unknown): GatewayTool["approvalBlockedReason"] {
  if (typeof v !== "string" || !v) return null;
  return (BLOCK_REASONS.includes(v) ? v : "contract_changed") as GatewayTool["approvalBlockedReason"];
}

/**
 * List the actions one connection offers, with each one's approval story.
 *
 * Authority is the RPC's in-body bind, reached through the CALLER's client. A connection in
 * another tenant, an `owner_only` one the caller lacks standing for, and an id that does not exist
 * are indistinguishable by design — the RPC raises one identical refusal for all three, and this
 * maps it to a single `not_found` so the edge cannot re-open the existence oracle the RPC just
 * closed.
 */
export async function runTools(
  deps: { userClient: Client },
  input: { connectionId: string; expectedTenantId: string | null },
): Promise<ToolsResult> {
  const { userClient } = deps;
  const { connectionId, expectedTenantId } = input;

  // Same guard, same code, same status as `approve`, `execute` and `oauth_begin`. Without it a
  // malformed id travels to Postgres, comes back as an unrecognised `invalid input syntax` error
  // and is reported as a 500 `lookup_failed` — a different refusal shape from every sibling, for
  // an input the module could have rejected without a round trip. It reveals nothing either way
  // (malformed is not an existence answer), which is why this is a consistency fix, not a leak fix.
  if (!UUID_RE.test(connectionId)) return { httpStatus: 400, body: { error: "bad_connection_id" } };

  // Workspace-switch-race guard, mirroring `approve`. A list rendered for the workspace the person
  // has just left is a quieter error than a refused write, and a worse one: it looks correct.
  const { data: tenantId, error: tErr } = await userClient.rpc("current_user_tenant_id");
  if (tErr || typeof tenantId !== "string" || !tenantId) {
    return { httpStatus: 400, body: { error: "no_tenant" } };
  }
  if (expectedTenantId && expectedTenantId !== tenantId) {
    return { httpStatus: 409, body: { error: "tenant_mismatch" } };
  }

  const { data, error } = await userClient.rpc("get_mcp_connection_tools", {
    _connection_id: connectionId,
  });

  if (error) {
    // The RPC raises ONE MCP_FORBIDDEN (42501) for unknown / foreign-tenant / owner_only-without-
    // standing. Collapsing it to a single `not_found` keeps that uniformity end to end; anything
    // that distinguished them here would hand back the oracle the RPC pays to suppress. Every
    // other failure is a genuine lookup fault and says so.
    const msg = typeof error?.message === "string" ? error.message : "";
    if (msg.includes("MCP_FORBIDDEN")) return { httpStatus: 404, body: { error: "not_found" } };
    if (msg.includes("MCP_NO_TENANT")) return { httpStatus: 400, body: { error: "no_tenant" } };
    return { httpStatus: 500, body: { error: "lookup_failed" } };
  }

  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : [];
  const tools: GatewayTool[] = [];
  let observedAt: string | null = null;

  for (const r of rows) {
    const name = typeof r?.tool_name === "string" ? r.tool_name : "";
    // A name that is not an identifier is the injection surface, not a tool — dropped, never
    // sanitized into something that looks like one.
    if (!NAME_RE.test(name)) continue;

    const effects = safeEffects(r.effects);
    // THE ONE POLICY. Not re-derived here, not re-derived in the browser.
    const decision = resolveEffectApproval(name, effects);
    const seen = str(r.observed_at);
    if (seen && (!observedAt || seen > observedAt)) observedAt = seen;

    tools.push({
      name,
      effects,
      app: sanitizeLabel(r.app, 100),
      actionType: sanitizeLabel(r.action_type, 80),
      requiresApproval: decision.requiresApproval,
      approvalBasis: decision.basis,
      approved: bool(r.approved),
      approvedAt: str(r.approved_at),
      expiresAt: str(r.expires_at),
      approvalExpired: bool(r.approval_expired),
      approvalStale: bool(r.approval_stale),
      approvedByYou: bool(r.approved_by_you),
      approvalBlockedReason: blockReason(r.approval_blocked_reason),
      observedAt: seen,
    });
  }

  tools.sort((a, b) => a.name.localeCompare(b.name));

  return {
    httpStatus: 200,
    body: {
      ok: true,
      connection_id: connectionId,
      tools,
      tool_count: tools.length,
      // Consent that still AUTHORISES something. An approval that has expired, gone stale, lost its
      // endpoint binding or been left pointing at an endpoint this connection no longer uses is a
      // row that authorises nothing, so it is not counted as consent. This legitimately disagrees
      // with the connection list's `approved_count`, which counts approval ROWS.
      approved_count: tools.filter((t) => t.approved && t.approvalBlockedReason === null).length,
      observed_at: observedAt,
    },
  };
}
