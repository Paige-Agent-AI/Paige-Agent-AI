// mcp-gateway — the runtime HTTP surface for the Connected MCP Gateway (the provider-agnostic
// `mcp_connections` registry). This is the first deployed caller of the new gateway, so importing
// `_shared/mcp-gateway/*` here is also what puts the whole gateway library into the deploy
// affected-set (INT-105 / edge-affected.py import closure) — until now those modules shipped to
// nothing.
//
// ACTIONS: `verify` (Slice ①) + `create` + `oauth_begin` (Slice ②) + `approve` + `execute` (Slice ③)
// + `tools` (Door 1 — the per-action catalogue `approve` was always missing a list for).
// The OAuth flow COMPLETES out of band in the JWT-less `mcp-oauth-callback` edge fn (the provider
// redirect target — a top-level GET with no JWT cannot be an action on this JWT-gated door; see that
// function). §18: one gateway door, many actions.
//
// AUTHORITY / SECRETS / SSRF: see each handler (`_shared/mcp-gateway/{verify,create,oauth,approve,
// execute}.ts`). This wrapper does the minimum a Deno edge entry must — CORS, authenticate the caller,
// dispatch on the action — then hands the fully-typed request to the action handler. MANAGE actions
// (`verify`/`oauth_begin`/`approve`) need a service-role client (secret decrypt, probe/flow/approval
// support), built INSIDE their branch; `create` takes only the caller-scoped client (§59), so the
// wrapper never puts the service-role client in create's scope, and never sees a secret itself.
// `execute` is a USE action — the runner is the authority (foreign_tenant / owner_only / durable
// consent), and its `mode:"execute"` dispatch is gated behind the owner flag MCP_GATEWAY_EXECUTE_ENABLED
// (default OFF; the "owner go" of runner.ts) resolved here and passed to the handler.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { runVerify } from "../_shared/mcp-gateway/verify.ts";
import { readCreateInput, runCreate } from "../_shared/mcp-gateway/create.ts";
import { runOauthBegin } from "../_shared/mcp-gateway/oauth.ts";
import { readApproveInput, runApprove } from "../_shared/mcp-gateway/approve.ts";
import { readExecuteInput, runExecute } from "../_shared/mcp-gateway/execute.ts";
import { readToolsInput, runTools } from "../_shared/mcp-gateway/tools.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // RLS-scoped as the caller — every authority gate resolves through THIS client.
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const expectedTenantId = typeof body.expected_tenant_id === "string" ? body.expected_tenant_id : null;

  if (action === "verify") {
    const connectionId = typeof body.connection_id === "string" ? body.connection_id : "";
    // service-role client: the ONLY holder of the decrypted-secret read and the probe write. Built
    // HERE, inside the verify branch, so it is never in lexical scope for `create` — which must not
    // touch it (§59): create reads no secret and writes no probe, so its authority is the writer
    // RPC's own in-body §9 gate, resolved through the caller's userClient.
    const admin = createClient(supabaseUrl, serviceKey);
    const result = await runVerify({ userClient, admin }, { connectionId, expectedTenantId });
    return jsonResponse(result.body, result.httpStatus);
  }

  if (action === "create") {
    // Thin JWT-scoped pass-through onto the G1a-1 writer RPCs — { userClient } only (§59); the RPC's
    // in-body §9 authority + credential/SSRF validation is the authority.
    const result = await runCreate({ userClient }, readCreateInput(body, expectedTenantId));
    return jsonResponse(result.body, result.httpStatus);
  }

  if (action === "oauth_begin") {
    const connectionId = typeof body.connection_id === "string" ? body.connection_id : "";
    // service-role client: reads the decrypted server URL and stores the in-flight flow (verifier +
    // client secret encrypted). Built HERE, inside the branch, so it is never in scope for `create`
    // (§59), exactly like verify. The authority is runOauthBegin's gates (mirroring runVerify), not
    // this grant.
    const admin = createClient(supabaseUrl, serviceKey);
    // The provider redirect target — the JWT-less mcp-oauth-callback edge fn, derived from config,
    // NEVER the request. A redirect the caller can influence is an open redirect and an
    // authorization-code interception at once.
    const redirectUri = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mcp-oauth-callback`;
    const result = await runOauthBegin(
      { userClient, admin },
      { connectionId, expectedTenantId, actor: user.id, redirectUri },
    );
    return jsonResponse(result.body, result.httpStatus);
  }

  if (action === "approve") {
    // MANAGE action (mirrors verify/oauth_begin authority). The service-role client is built HERE, in
    // the branch (§59) — approve needs it to read the connection's current endpoint hash and the
    // live-verified tool pin server-side (neither is client-visible). The approval WRITE itself goes
    // through the caller's userClient, so the writer's in-body admin+tenant gate is the authority.
    const admin = createClient(supabaseUrl, serviceKey);
    // The tool pin lives in mcp_connection_tools (service-role read only) — resolve it with the admin
    // client. Injected as a seam so runApprove stays headless-testable (§39).
    const readToolPin = async (connectionId: string, toolName: string): Promise<string | null> => {
      const { data, error } = await admin
        .from("mcp_connection_tools")
        .select("pin")
        .eq("connection_id", connectionId)
        .eq("tool_name", toolName)
        .maybeSingle();
      if (error || !data) return null;
      return typeof (data as { pin?: unknown }).pin === "string" ? (data as { pin: string }).pin : null;
    };
    const result = await runApprove(
      { userClient, admin, readToolPin },
      readApproveInput(body, expectedTenantId),
    );
    return jsonResponse(result.body, result.httpStatus);
  }

  if (action === "tools") {
    // READ action, and the ONLY branch that builds no service-role client — deliberately. The RPC
    // is granted to `authenticated` alone, so the caller's own client IS the authority (§59); an
    // admin client here would resolve its tenant from the request body, which is the shape the
    // writers refuse. Membership suffices: the connection list already discloses tool_count and
    // approved_count to an ordinary member, and this is the per-row expansion of those integers.
    // Admin standing still gates the WRITE, and still gates owner_only visibility, both in-body.
    const result = await runTools({ userClient }, readToolsInput(body, expectedTenantId));
    return jsonResponse(result.body, result.httpStatus);
  }

  if (action === "execute") {
    // USE action — any authenticated tenant member may attempt it; the RUNNER is the authority
    // (foreign_tenant / owner_only capability / durable consent). The service-role client is built
    // HERE (§59) and used only to construct the runner's canonical loader, consent verifier,
    // capability resolver, and Rail receipt. The "owner go" live gate is resolved from env here and
    // passed in — a real `mode:"execute"` dispatch refuses `execute_not_enabled` unless it is set.
    const admin = createClient(supabaseUrl, serviceKey);
    const executeEnabled = (Deno.env.get("MCP_GATEWAY_EXECUTE_ENABLED") ?? "").toLowerCase() === "true";
    const result = await runExecute(
      { userClient, admin },
      readExecuteInput(body, expectedTenantId, user.id, executeEnabled),
    );
    return jsonResponse(result.body, result.httpStatus);
  }

  return jsonResponse({ error: "unsupported_action" }, 400);
});
