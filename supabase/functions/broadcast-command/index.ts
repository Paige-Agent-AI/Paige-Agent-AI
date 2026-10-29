// broadcast-command — the governed admission door for live broadcasting (EXP07 broadcast
// slice). The handler is _shared/broadcast-command/command.ts; this file only wires the
// two Supabase clients and the RealtimeKit adapter. verify_jwt is the default, and the
// handler verifies the caller's JWT again (getUser) and derives the workspace
// server-side. The platform token exists only in the edge environment; the browser
// receives ONLY the provider-minted per-participant pass.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { realtimeKitAdapter } from "../_shared/realtimekit-provider/realtimekit.ts";
import { handleBroadcastCommand } from "../_shared/broadcast-command/command.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return handleBroadcastCommand(req, { caller: null, admin: null, adapter: realtimeKitAdapter });
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ ok: false, code: "SERVER_NOT_CONFIGURED", error: "Live broadcasting isn't available right now. Nothing changed." }), {
      status: 503, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return handleBroadcastCommand(req, { caller, admin, adapter: realtimeKitAdapter });
});
