// EXP08 Team Hub: the scheduled stale-file sweep (pg_cron hourly at :41, migration 20271114260008).
// Contract: docs/delivery/exp08-team-hub-increment3-attachments-contract.md §4–§5.
//
// team-hub-file sweeps a person's stale uploads when that person next finishes an upload. This runs the
// same sweep on a schedule, for people who never upload again. The loop lives in
// _shared/team-hub/file-sweep.ts; this function only authorizes the caller and reports the counts.
//
// Auth: service-role bearer OR a valid x-cron-token (the paige-media-sweeper pattern). The cron poster
// presents no Supabase JWT, so the gateway runs with verify_jwt=false and this gate fails closed before
// any sweep work. Logs carry counts and reason codes only, never a file name or path.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { runTeamHubFileSweep, type TeamHubSweepClient } from "../_shared/team-hub/file-sweep.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, code: "unavailable" }, 503);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
  });
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let authorized = bearer.length > 0 && bearer === SERVICE_KEY;
  if (!authorized) {
    const cronToken = request.headers.get("x-cron-token") ?? "";
    if (cronToken) {
      const verified = await admin.rpc("verify_cron_token", { _token: cronToken });
      authorized = !verified.error && verified.data === true;
    }
  }
  if (!authorized) return json({ ok: false, code: "unauthorized" }, 401);

  const summary = await runTeamHubFileSweep(admin as unknown as TeamHubSweepClient);
  if (!summary.ok) console.warn("team_hub_file_sweep_incomplete", summary);
  return json(summary, summary.code === "list_failed" ? 500 : 200);
});
