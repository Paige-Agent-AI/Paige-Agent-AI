// n8n-oauth-keepalive — the scheduled grant keepalive for EVERY tenant's n8n MCP OAuth
// connection (platform-wide: every current and future Solo Shell; no tenant-specific code).
//
// THE PROBLEM (owner report 2026-10-03, "I keep losing my n8n MCP connection and having to
// reconnect it"; prod history: grants re-OAuthed 09-04, 09-05, 09-06, 09-11, 09-13, 09-23,
// 10-02): the n8n access token lives one hour and is refreshed ON USE by the chat lane.
// Between uses nothing cycles the refresh token, and when n8n invalidates the grant
// (their platform rotates sessions), the death is SILENT — the owner discovers it mid-task
// and runs the whole OAuth dance again.
//
// WHAT THIS DOES, twice a day, for every enabled n8n OAuth row:
//   1. resolves the tenant's CURRENT OWNER (the lease fence's own authority check) and
//      ACQUIRES the same governed refresh lease the chat lane uses — no parallel authority;
//   2. if the access token is inside its expiry margin, refreshes through the SAME
//      discover → refresh → rotate path, keeping n8n's refresh token cycling on a schedule;
//   3. on a dead grant (n8n refuses the refresh), records the honest state
//      (probe 'token_expired' → status error + last_error, which the readiness lane and the
//      Integrations tile already surface as "reconnect needed") — the death becomes visible
//      within hours instead of at the owner's next mid-task failure;
//   4. always releases the lease. No secrets in logs, events, or the response.
//
// AUTH: CRON-invoked (no Supabase JWT) — verify_jwt=false in config.toml; the function
// fails closed to the internal-caller gate used by its scheduled siblings (service-role
// bearer OR a valid x-cron-token via verify_cron_token), exactly like comms-scheduled-drain.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { discoverAuthorizationServer, refreshTokens, isExpired } from "../_shared/mcp-oauth.ts";

type Lease = { lease: string; generation: string; server_url: string; access_token: string; refresh_token: string | null; expires_at: string | null; issuer: string; client_id: string; client_secret: string | null; oauth_scopes: string[] };

/** Refresh when the access token is inside this margin — keeps every run of the schedule
 *  cycling the refresh token instead of skipping on a still-warm access token. */
const REFRESH_MARGIN_MS = 20 * 60 * 1000;
const OUTCOME_WORDS = ["refreshed", "reauthorization_required", "skipped_uptodate", "skipped_no_owner", "skipped_busy", "error"] as const;
type Outcome = (typeof OUTCOME_WORDS)[number];

const internalCaller = async (req: Request, admin: ReturnType<typeof createClient>): Promise<boolean> => {
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const cronToken = req.headers.get("x-cron-token") ?? "";
  if (!cronToken) return false;
  const { data } = await admin.rpc("verify_cron_token", { _token: cronToken });
  return data === true;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  if (!(await internalCaller(req, admin))) return jsonResponse({ error: "unauthorized" }, 401);

  // Every enabled n8n OAuth connection in the platform, with its tenant's CURRENT OWNER
  // resolved through the canonical authority check the lease fence itself uses.
  const { data: rows, error: rowsErr } = await admin.rpc("list_n8n_keepalive_targets");
  if (rowsErr || !Array.isArray(rows)) return jsonResponse({ error: "targets_unavailable" }, 500);

  const summary: Record<Outcome, number> = { refreshed: 0, reauthorization_required: 0, skipped_uptodate: 0, skipped_no_owner: 0, skipped_busy: 0, error: 0 };

  for (const row of rows as Array<{ tenant_id: string; owner_id: string | null }>) {
    let outcome: Outcome = "error";
    let lease: Lease | null = null;
    let bound: Record<string, unknown> = { tenant_id: row.tenant_id, actor_id: row.owner_id };
    const rpc = async (operation: string, extra: Record<string, unknown> = {}) => {
      const { data, error } = await admin.rpc("n8n_oauth_service", { _operation: operation, _input: { ...bound, ...extra } });
      if (error) throw error;
      return data;
    };
    try {
      if (!row.owner_id) { outcome = "skipped_no_owner"; continue; }
      lease = await rpc("acquire") as Lease;
      bound = { ...bound, lease: lease.lease, generation: lease.generation };
      const withinMargin = lease.expires_at
        ? (Date.parse(lease.expires_at) - Date.now()) <= REFRESH_MARGIN_MS
        : true;
      if (!withinMargin) { outcome = "skipped_uptodate"; continue; }
      if (!lease.refresh_token) {
        // No refresh material: the grant cannot be renewed — the honest death state.
        await rpc("probe", { state: "token_expired" });
        outcome = "reauthorization_required";
        continue;
      }
      try {
        const server = await discoverAuthorizationServer(lease.issuer);
        const tokens = await refreshTokens({
          server, clientId: lease.client_id, clientSecret: lease.client_secret,
          refreshToken: lease.refresh_token, resource: lease.server_url, grantedScopes: lease.oauth_scopes,
        });
        const scopeRefused = tokens.scopes.length !== lease.oauth_scopes.length
          || !tokens.scopes.every((s: string) => lease!.oauth_scopes.includes(s))
          || new Set(tokens.scopes).size !== tokens.scopes.length
          || !tokens.accessToken || isExpired(tokens.expiresAt);
        if (scopeRefused) throw new Error("provider_scope_refused");
        await rpc("rotate", { tokens });
        outcome = "refreshed";
      } catch {
        // n8n refused the refresh — the grant is dead on their side. Record the honest
        // state; the readiness lane and the Integrations tile surface "reconnect needed".
        await rpc("probe", { state: "token_expired" }).catch(() => undefined);
        outcome = "reauthorization_required";
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // The single-flight lease is contended by a live user turn — their turn wins; ours
      // retries next schedule. Never a connection-health verdict.
      outcome = msg.includes("N8N_BUSY") ? "skipped_busy" : "error";
    } finally {
      if (lease) await admin.rpc("n8n_oauth_service", { _operation: "release", _input: bound }).catch(() => undefined);
      summary[outcome] += 1;
    }
  }

  // Counts only — never a tenant id, owner id, or any secret material.
  return jsonResponse({ ok: true, ...summary });
});
