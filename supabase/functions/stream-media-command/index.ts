// stream-media-command — the governed upload/lifecycle door for the tenant media library
// (EXP07 media-library slice 2). The handler is _shared/stream-media-command/command.ts;
// this file only wires the two Supabase clients and the Stream adapter. verify_jwt is the
// default, and the handler verifies the caller's JWT again (getUser) and derives the
// workspace server-side. The provider token exists only in the edge environment and never
// crosses into any response — the browser receives ONLY the one-time uploadURL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { streamReadAdapter } from "../_shared/stream-provider/stream.ts";
import { handleStreamMediaCommand } from "../_shared/stream-media-command/command.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return handleStreamMediaCommand(req, { caller: null, admin: null, adapter: streamReadAdapter });
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ ok: false, code: "SERVER_NOT_CONFIGURED", error: "The video library isn't available right now. Nothing changed." }), {
      status: 503, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return handleStreamMediaCommand(req, { caller, admin, adapter: streamReadAdapter });
});
