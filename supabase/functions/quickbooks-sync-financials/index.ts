import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { authorizeQuickBooksSync } from "../_shared/quickbooks-sync-authority.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const parsed = await req.json().catch(() => null);
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const { sync_all } = body;
    const authHeader = req.headers.get("Authorization");
    const authority = await authorizeQuickBooksSync(
      authHeader, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", sync_all === true,
      async () => {
        const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader! } },
        });
        const { data: { user }, error } = await authClient.auth.getUser();
        return error ? null : user?.id ?? null;
      },
    );
    if (!authority.allowed) {
      return new Response(JSON.stringify({ error: authority.status === 401 ? "Unauthorized" : "Forbidden" }), {
        status: authority.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // The legacy user-owned snapshots do not establish company authority, complete
    // pagination, currency, or accounting basis. Production currently has no sync
    // deployment. Do not activate these provider reads merely by deploying the
    // caller repair. Replace this containment when the company-bound adapter lands.
    return new Response(JSON.stringify({
      error: "FINANCE_SOURCE_UNAVAILABLE",
      reason: "Company-bound QuickBooks synchronization is not ready",
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[qb-sync]", msg);
    return new Response(JSON.stringify({ error: "QuickBooks sync unavailable" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
