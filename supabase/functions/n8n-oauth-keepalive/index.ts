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
// WHAT THIS DOES, every 6 hours, for every enabled n8n OAuth row:
//   1. resolves the tenant's CURRENT OWNER (the lease fence's own authority check) and
//      ACQUIRES the same governed refresh lease the chat lane uses — no parallel authority;
//   2. if the access token is inside its expiry margin, refreshes through the SAME
//      discover → refresh → rotate path, keeping n8n's refresh token cycling on a schedule;
//   3. tells withdrawal from stumble — a REFUSED grant records the honest death state
//      (probe 'token_expired', which readiness and the Integrations tile surface as
//      "reconnect needed"); every OTHER failure is TRANSIENT and records NOTHING
//      (probe 'provider_unavailable'), because throwing away a live grant over a network
//      blip is the exact bug class this repo already fixed once (tenant-n8n-oauth's
//      isGrantWithdrawn split: "without the split, a stumble and a revocation look
//      identical, so a connection gets thrown away for a network blip");
//   4. records RECOVERY too — a successful refresh probes 'connected', clearing any stale
//      death record so the owner is never told to reconnect a grant the keepalive itself
//      just proved alive;
//   5. always releases the lease. No secrets in logs, events, or the response.
//
// AUTH: CRON-invoked (no Supabase JWT) — verify_jwt=false in config.toml; the function
// fails closed to the internal-caller gate used by its scheduled siblings (service-role
// bearer OR a valid x-cron-token via verify_cron_token), exactly like comms-scheduled-drain.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { discoverAuthorizationServer, refreshTokens, isExpired, isGrantWithdrawn } from "../_shared/mcp-oauth.ts";

type Lease = { lease: string; generation: string; server_url: string; access_token: string; refresh_token: string | null; expires_at: string | null; issuer: string; client_id: string; client_secret: string | null; oauth_scopes: string[] };
/** The minimal structural client this function needs (the repo's RpcClient seam — avoids
 *  generic-instantiation friction against the generated client types). */
type RpcClient = { rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

/** Refresh when the access token is inside this margin — keeps every run of the schedule
 *  cycling the refresh token instead of skipping on a still-warm access token. */
const REFRESH_MARGIN_MS = 20 * 60 * 1000;
const OUTCOME_WORDS = ["refreshed", "reauthorization_required", "provider_unavailable", "skipped_uptodate", "skipped_no_owner", "skipped_busy", "error"] as const;
type Outcome = (typeof OUTCOME_WORDS)[number];

const internalCaller = async (req: Request, admin: RpcClient): Promise<boolean> => {
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const cronToken = req.headers.get("x-cron-token") ?? "";
  if (!cronToken) return false;
  const { data } = await admin.rpc("verify_cron_token", { _token: cronToken } as never);
  return data === true;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey) as unknown as RpcClient;
  if (!(await internalCaller(req, admin))) return jsonResponse({ error: "unauthorized" }, 401);

  // Every enabled n8n OAuth connection in the platform, with its tenant's CURRENT OWNER
  // resolved through the canonical authority check the lease fence itself uses.
  const { data: rows, error: rowsErr } = await admin.rpc("list_n8n_keepalive_targets");
  if (rowsErr || !Array.isArray(rows)) return jsonResponse({ error: "targets_unavailable" }, 500);

  const summary: Record<Outcome, number> = { refreshed: 0, reauthorization_required: 0, provider_unavailable: 0, skipped_uptodate: 0, skipped_no_owner: 0, skipped_busy: 0, error: 0 };

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
        // No refresh material: the grant cannot be renewed — the honest death state
        // (matches the chat lane's no-refresh-token refusal).
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
        // Record RECOVERY: a refresh that just succeeded proves the grant alive — clear
        // any stale death record so the owner is never told to reconnect a live grant.
        // (probe 'connected' with no marks payload leaves workflow approvals untouched.)
        await rpc("probe", { state: "connected" });
        outcome = "refreshed";
      } catch (e) {
        if (isGrantWithdrawn(e) || String((e as Error)?.message ?? "").includes("N8N_GRANT_GONE")) {
          // The provider itself withdrew the grant — the honest death state, surfaced by
          // readiness and the Integrations tile as "reconnect needed".
          await rpc("probe", { state: "token_expired" }).catch(() => undefined);
          outcome = "reauthorization_required";
        } else {
          // Everything else — discovery network blips, token-endpoint timeouts, rotate RPC
          // hiccups, scope surprises — is TRANSIENT. Record provider_unavailable (never a
          // health verdict) and leave the grant untouched; the next schedule retries.
          await rpc("probe", { state: "provider_unavailable" }).catch(() => undefined);
          outcome = "provider_unavailable";
        }
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // The single-flight lease is contended by a live user turn — their turn wins; ours
      // retries next schedule. Never a connection-health verdict.
      outcome = msg.includes("N8N_BUSY") ? "skipped_busy" : "error";
    } finally {
      if (lease) {
        try { await admin.rpc("n8n_oauth_service", { _operation: "release", _input: bound }); } catch { /* best-effort; the 2-minute lease expires on its own */ }
      }
      summary[outcome] += 1;
    }
  }

  // Counts only — never a tenant id, owner id, or any secret material.
  return jsonResponse({ ok: true, ...summary });
});
