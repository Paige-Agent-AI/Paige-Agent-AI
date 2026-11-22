// social-publish-command — THE one door for publishing saved content to a connected social
// channel (EXP07 row 10). The handler is _shared/social-publish-command/door.ts; this file only
// wires the two Supabase clients and the provider adapter. Zernio is the sole
// Social provider (owner decision, locked November 2) — no alternate fallback. verify_jwt is the default, and the
// handler verifies the caller's JWT again (getUser) and resolves the workspace server-side.
//
// Product controls this door preserves (owner directive 2026-10-25): the workspace's own
// connection (EXP10's lifecycle must say `connected`), the original actor's approval of THIS
// content (the fingerprint proposal/claim), and the provider credential (needs_setup until it
// exists). Nothing here bypasses any of them.
//
// Zernio is the SOLE social provider (ANT-164 3f511055, Nov 2 2026: Zernio sole aggregator,
// Upload-Post retired Nov 3). Zernio's publishing arm does not exist yet — its createPost
// refuses (provider_publishing_unavailable) until EXP07 ships that governed slice, and the door
// records that honestly as a failed attempt with nothing published. It never reaches a second
// provider because there is none.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { zernioSocialAdapter } from "../_shared/social-provider/zernio.ts";
import { handleSocialPublishCommand } from "../_shared/social-publish-command/door.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return handleSocialPublishCommand(req, { caller: null, admin: null, adapter: zernioSocialAdapter });
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
  return handleSocialPublishCommand(req, { caller, admin, adapter: zernioSocialAdapter, storageOrigin: url });
});
