import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { revokeToken } from "../_shared/quickbooks-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: conn, error: readError } = await supabase
      .from("quickbooks_connections")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw new Error('Connection read unavailable');
    if (!conn) return new Response(JSON.stringify({ success: true, message: "No connection to disconnect" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Persist local disconnection before external work. Finance bindings are revoked
    // atomically by the connection lifecycle trigger; historical anchors are retained.
    const { data: disconnected, error: disconnectError } = await supabase.from('quickbooks_connections')
      .update({ is_active: false }).eq('id', conn.id).eq('user_id', user.id).select('id').maybeSingle();
    if (disconnectError || !disconnected) throw new Error('Connection disconnection unavailable');

    // Legacy revokeToken does not validate the provider response. Never describe this
    // best-effort attempt as confirmed provider revocation.
    try {
      const { data: refDec } = await supabase.rpc("qb_decrypt_token", { _ciphertext: conn.refresh_token_encrypted });
      if (refDec) await revokeToken(refDec);
    } catch (e) {
      console.warn("[qb-disconnect] provider revocation unverified");
    }

    await supabase.from("audit_logs").insert({
      user_id: user.id,
      entity: "quickbooks_connection",
      action: "disconnected",
      data: { realm_id: conn.qb_realm_id, company_name: conn.qb_company_name },
    });

    return new Response(JSON.stringify({ success: true, disconnected: true, provider_revocation: 'unverified' }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[qb-disconnect] disconnection unavailable");
    return new Response(JSON.stringify({ error: 'DISCONNECTION_UNAVAILABLE' }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
