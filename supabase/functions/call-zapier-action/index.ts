// call-zapier-action — per-tenant Zapier/MCP action caller (Wave 1 #240, Track B slice B2).
//
// Calls a Zapier MCP action (Streamable HTTP MCP JSON-RPC tools/call) using the
// CALLER'S OWN tenant credentials — the per-tenant replacement for the shared
// ZAPIER_MCP_TOKEN env var + platform-global paige_mcp_connections row.
//
// Body (two shapes):
//   { tool_name: string, arguments?: object }  → run one action (MCP tools/call)
//   { action: "list" }                         → discover enabled actions (MCP tools/list)
//   (legacy `connection_id` is accepted-but-ignored — see §37 note below.)
//   The `action` field is ADDITIVE (§37): existing {tool_name} callers are unaffected.
//
// Security (§9 tenant isolation):
//  • The caller's JWT authenticates them; gated by their current workspace admin role.
//  • The tenant is derived SERVER-SIDE from the JWT (current_user_tenant_id, run in
//    the caller's JWT context) — a client-supplied tenant_id is NEVER trusted for the
//    secret read. Mirrors the proven paige-n8n pattern.
//  • The MCP server URL + bearer token are decrypted server-side ONLY, via the
//    service-role-only get_tenant_mcp_secret RPC. They never touch the browser and
//    are read only for the caller's OWN resolved tenant, never an arbitrary one.
//  • The tenant-supplied MCP server_url is SSRF-guarded via the shared client: https
//    only, no credentials embedded in the URL, numeric validation of every resolved
//    address, redirects refused rather than followed, and a bounded wall clock and
//    response size — so a tenant admin can't point it at an internal target, DNS-rebind
//    onto one, or hold a worker open (§13).
//  • If the tenant has no configured/enabled connection → an honest structured
//    "not_connected" response (§13); NEVER a fallback to the shared env token.
//
// THE EGRESS BOUNDARY. This function's response is serialised into a model's context by
// `paige-ai-chat`. A provider's answer is therefore UNTRUSTED INPUT reaching Paige: it can
// carry instructions aimed at her, credentials, or another tenant's records. So no
// provider payload, prose, schema or error text is returned from here. What is returned is
// the outcome projection from `_shared/mcp-outcome.ts` — which capability ran, whether it
// worked, when, whether it was authorised, and an opaque reference under which the detail
// is held encrypted and tenant-scoped.
//
// AND IT FAILS CLOSED. A capability the workspace has not approved is not called at all.
// A connection proves reachability; `approved_capabilities` is the separate authorisation
// decision, and it is empty until somebody makes it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { mcpListTools } from "../_shared/mcp-client.ts";
import { callApprovedCapability, fileGovernedOutcome, projectDiscovery } from "../_shared/mcp-outcome.ts";
import { resolveZapierMcpConnection, zapierMcpReadAuthorized } from "../_shared/zapier-mcp-auth.ts";

// The SSRF validator that used to live inline here is now `_shared/ssrfGuard.ts`, reached
// through `_shared/mcp-client.ts`. It is the same numeric guard, plus the three things
// every inline copy was missing: credentials in the URL are rejected, the wall clock is
// bounded, and the response body is bounded. Redirects were already refused and still are.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // 1. Authenticate the caller and resolve their tenant from the JWT.
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: isAdmin } = await userClient.rpc("is_current_user_tenant_admin");
  if (isAdmin !== true) return jsonResponse({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  // Two request shapes (§37 — additive, existing `{tool_name, arguments}` callers unchanged):
  //  • { action: "list" }                 → MCP tools/list (discover the tenant's enabled actions)
  //  • { tool_name, arguments? }           → MCP tools/call (run one action) — the original contract
  const isList = body?.action === "list";
  if (!isList && !body?.tool_name) return jsonResponse({ error: "missing_tool_name" }, 400);

  // current_user_tenant_id runs in the caller's JWT context → their own tenant.
  // NEVER trust a client-supplied tenant_id for the secret read (§9).
  const { data: tenantId, error: tErr } = await userClient.rpc("current_user_tenant_id");
  if (tErr || !tenantId) return jsonResponse({ error: "no_tenant" }, 400);
  if (typeof body.expected_tenant_id === "string" && body.expected_tenant_id !== tenantId) {
    return jsonResponse({ error: "tenant_changed" }, 409);
  }
  const fileConnectionTest = async (succeeded: boolean) => {
    if (!isList) return true;
    const { error } = await admin.rpc("record_zapier_mcp_connection_test", {
      _tenant_id: tenantId,
      _actor_id: user.id,
      _succeeded: succeeded,
    });
    if (error) {
      console.error("[call-zapier-action] connection test outcome not recorded:", error.message);
      return false;
    }
    return true;
  };

  // One resolver renews the original grant for discovery, checks and actions.
  const resolved = await resolveZapierMcpConnection(admin, tenantId, user.id);
  if ("error" in resolved) {
    await fileConnectionTest(false);
    return jsonResponse({ ok: false, error: resolved.error }, resolved.status);
  }
  const { secret, auth } = resolved;
  const serverUrl = secret.server_url;
  const stillAuthorized = () => zapierMcpReadAuthorized(userClient, tenantId, user.id, secret.generation);
  if (!await stillAuthorized()) return jsonResponse({ error: "connection_changed" }, 409);
  // 3. Discovery, reduced to the workspace's OWN approved names. The provider's
  //    catalogue and its descriptions are provider-written text and do not cross.

  const approved: string[] = Array.isArray(secret.approved_capabilities)
    ? (secret.approved_capabilities as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  // Missing or malformed pins resolve to an empty map, which refuses everything. That is
  // the correct reading: no pin means no verified contract.
  const pins: Record<string, string> =
    secret.capability_pins && typeof secret.capability_pins === "object" && !Array.isArray(secret.capability_pins)
      ? Object.fromEntries(Object.entries(secret.capability_pins as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string")) as Record<string, string>
      : {};

  if (isList) {
    let discovered: Array<{ name: string }> = [];
    try {
      discovered = await mcpListTools({ serverUrl, auth });
    } catch {
      // The provider's failure reason is not carried; an empty, honest answer is.
      await fileConnectionTest(false);
      return jsonResponse({ ok: false, error: "discovery_unavailable", actions: [], approved_count: 0 });
    }
    const projected = projectDiscovery(discovered, approved);
    if (!await stillAuthorized()) return jsonResponse({ error: "connection_changed" }, 409);
    if (!await fileConnectionTest(true)) {
      return jsonResponse({ ok: false, error: "rail_unavailable", actions: [], approved_count: 0 }, 500);
    }
    if (!await stillAuthorized()) return jsonResponse({ error: "connection_changed" }, 409);
    return jsonResponse({
      ok: true,
      // `actions` is kept as the key so the existing consumer keeps working, but it now
      // carries approved NAMES only — never the provider's descriptions (§37: the
      // consumer's access path is preserved, the unsafe payload is not).
      actions: projected.approved,
      approved_count: projected.approved.length,
      // Stated rather than hidden, so "no actions" is distinguishable from "none approved".
      unapproved_count: projected.unapproved_count,
      // The unapproved NAMES (identifier-shaped, validated in the projection) so the
      // operator can be told exactly which actions are waiting on their approval — the
      // 2026-10-02 gap was a count the operator could not act on.
      unapproved: projected.unapproved,
    });
  }

  // 4. One governed call. Authorisation is checked before anything leaves the process,
  //    and only the projection comes back.
  const { outcome, evidence } = await callApprovedCapability({
    serverUrl,
    auth,
    provider: "zapier",
    capability: String(body.tool_name),
    approvedCapabilities: approved,
    capabilityPins: pins,
    tenantId,
    args: (body.arguments ?? {}) as Record<string, unknown>,
    authorize: async () => {
      const { data, error } = await userClient.rpc("zapier_mcp_action_authorized", {
        _tenant: tenantId, _actor: user.id, _generation: secret.generation,
        _capability: String(body.tool_name), _pin: pins[String(body.tool_name)] ?? "",
      });
      return !error && data === true;
    },
  });

  // The detail is written where a model cannot read it. A failure to store evidence must
  // not turn a completed action into a reported failure, so it is recorded and moved past.
  if (evidence) {
    const { error: eErr } = await admin.rpc("record_tenant_mcp_evidence", {
      _tenant_id: tenantId,
      _provider: evidence.provider,
      _capability: evidence.capability,
      _status: outcome.status,
      _payload: evidence.payload,
      _ref: evidence.ref,
    });
    if (eErr) console.error("[call-zapier-action] evidence not recorded:", eErr.message);
  }

  // 5. Provenance. Every call — including every refusal — leaves a record the workspace
  //    can read, carrying what happened and never what the provider said. The rail entry
  //    is contact-scoped by construction, so it is written only when this turn genuinely
  //    has a contact; `contact_id` is taken from the caller's request rather than invented.
  const contactId = typeof body.contact_id === "string" && body.contact_id ? body.contact_id : null;
  await fileGovernedOutcome(admin, { tenantId, outcome, contactId, actorId: user.id });

  // A completed effect stays recorded under its original workspace even when the
  // caller switches away. Do not disclose that workspace's result in the new one.
  if (!await stillAuthorized()) return jsonResponse({ error: "connection_changed" }, 409);
  return jsonResponse({ ok: outcome.status === "ok", ...outcome });
});
