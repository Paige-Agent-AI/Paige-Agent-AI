// growth-hosting-command — THE HOSTING DOOR (EXP06 WEB-05, owner direction 2026-10-28 88b2f756:
// implementation within existing authority, provider activation HELD).
//
// POST { action: "deploy" | "recover", page_id, approved_fingerprint?, expected_tenant_id? }
//
// The Studio's host path (and any future chat tool) deploys and removes a page's hosted copy
// through this function, so there is one authority decision, one approval, one executor, one
// verification and one receipt. The handler is _shared/growth-hosting-command/door.ts; this file
// only wires the two Supabase clients, the export builder and the provider configuration.
//
// DORMANT BY DESIGN: with GROWTH_HOSTING_CF_ACCOUNT_ID / GROWTH_HOSTING_CF_API_TOKEN unset (the
// current, owner-held state) every path answers HOSTING_NOT_ENABLED — no token exists to create,
// nothing provisions, and no approval is minted. verify_jwt is the default (true).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { decideDeclaredCapability } from "../_shared/capability-kit/decision.ts";
import { GROWTH_HOSTING_KIT_BY_ACTION } from "../_shared/paige-spine/domains/growth_hosting.ts";
import { handleGrowthHostingCommand, type HostingDoorDeps } from "../_shared/growth-hosting-command/door.ts";
import { buildHostingExport } from "../_shared/growth-hosting/export.ts";

// THE authority decision for every act this door runs: the Spine's declaration for the act's key,
// through the canonical Kit gate (precedent: growth-publish-command / STUDIO_PUBLISH_KIT_BY_ACTION).
const decide: HostingDoorDeps["decide"] = (key, input) =>
  decideDeclaredCapability(GROWTH_HOSTING_KIT_BY_ACTION[key as keyof typeof GROWTH_HOSTING_KIT_BY_ACTION], input);

// The platform's provider configuration — BOTH values or the honest dormant refusal. No default,
// no fallback, no silent enable.
const providerConfig = (() => {
  const accountId = Deno.env.get("GROWTH_HOSTING_CF_ACCOUNT_ID");
  const apiToken = Deno.env.get("GROWTH_HOSTING_CF_API_TOKEN");
  return accountId && apiToken ? { accountId, apiToken } : null;
})();

Deno.serve((req) => {
  if (req.method === "OPTIONS") return handleGrowthHostingCommand(req, { caller: null, admin: null, decide, providerConfig, buildExport: async () => null });
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ ok: false, code: "SERVER_NOT_CONFIGURED", error: "Hosting isn't available right now. Nothing was changed." }), {
      status: 503, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return handleGrowthHostingCommand(req, {
    caller, admin, decide, providerConfig,
    buildExport: (page, tenantSlug) => buildHostingExport(admin, page, tenantSlug),
  });
});
