// social-publish-command — THE one door for publishing saved content to a connected social
// channel (EXP07 row 10). The handler is _shared/social-publish-command/door.ts; this file only
// wires the two Supabase clients and the provider adapter. verify_jwt is the default, and the
// handler verifies the caller's JWT again (getUser) and resolves the workspace server-side.
//
// Product controls this door preserves (owner directive 2026-10-25): the workspace's own
// connection (EXP10's lifecycle must say `connected`), the original actor's approval of THIS
// content (the fingerprint proposal/claim), and the provider credential (needs_setup until it
// exists). Nothing here bypasses any of them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { uploadPostSocialAdapter } from "../_shared/social-provider/upload-post.ts";
import { handleSocialPublishCommand } from "../_shared/social-publish-command/door.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return handleSocialPublishCommand(req, { caller: null, admin: null, adapter: uploadPostSocialAdapter });
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ ok: false, code: "SERVER_NOT_CONFIGURED", error: "Publishing isn't available right now. Nothing changed." }), {
      status: 503, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return handleSocialPublishCommand(req, { caller, admin, adapter: uploadPostSocialAdapter });
});
