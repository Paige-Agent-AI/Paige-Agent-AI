// stream-media-read — the governed read of the shared Cloudflare Stream library (EXP07 media
// slice 1). The handler is _shared/stream-media-read/reader.ts; this file only wires the
// caller's client and the read-only Stream adapter. verify_jwt is the default, and the handler
// verifies the caller's JWT again (getUser) and resolves the workspace server-side. READ-ONLY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { streamReadAdapter } from "../_shared/stream-provider/stream.ts";
import { handleStreamMediaRead } from "../_shared/stream-media-read/reader.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return handleStreamMediaRead(req, { caller: null, admin: null, adapter: streamReadAdapter });
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey) {
    return new Response(JSON.stringify({ ok: false, code: "SERVER_NOT_CONFIGURED", error: "The video library isn't available right now. Nothing changed." }), {
      status: 503, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  return handleStreamMediaRead(req, { caller, admin, adapter: streamReadAdapter });
});
