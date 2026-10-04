// growth-publish-command — THE ONE PUBLISH DOOR (Vibe Studio V2b, owner ruling 2026-10-04).
//
// POST { action: "publish" | "unpublish", kind: "page" | "form" | "funnel" | "image", id,
//        approved_fingerprint?, expected_tenant_id? }
//
// The Studio Publish panel and Paige's chat both publish and unpublish through this function, so
// there is one authority decision, one approval, one executor, one readback and one receipt for
// every way a piece goes live. The handler is _shared/growth-publish-command/door.ts; this file only
// wires the two Supabase clients. verify_jwt is the default (true), and the handler verifies the
// caller's JWT again (getUser) and resolves the workspace server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { decideDeclaredCapability } from "../_shared/capability-kit/decision.ts";
import { STUDIO_PUBLISH_KIT_BY_ACTION } from "../_shared/paige-spine/domains/studio_publish.ts";
import { handleGrowthPublishCommand, type PublishDoorDeps } from "../_shared/growth-publish-command/door.ts";

// THE authority decision for every act this door runs: the Spine's declaration for the act's key,
// through the canonical Kit gate. An unknown key has no declaration and the gate throws; the door
// refuses on a throw. Precedent: sales-invoice-command / SALES_INVOICE_KIT_BY_ACTION.
const decide: PublishDoorDeps["decide"] = (key, input) =>
  decideDeclaredCapability(STUDIO_PUBLISH_KIT_BY_ACTION[key as keyof typeof STUDIO_PUBLISH_KIT_BY_ACTION], input);

Deno.serve((req) => {
  // The preflight needs no clients; the handler answers it.
  if (req.method === "OPTIONS") return handleGrowthPublishCommand(req, { caller: null, admin: null, decide });
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
  return handleGrowthPublishCommand(req, { caller, admin, decide });
});
