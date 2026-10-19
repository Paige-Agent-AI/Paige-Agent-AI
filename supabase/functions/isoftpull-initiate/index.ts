// iSoftpull soft credit pull — INITIATE
// Stub: returns a "pending_credentials" response until ISOFTPULL_API_KEY +
// ISOFTPULL_ENABLED=true are configured. When live, this will start an
// iSoftpull session and return an embed token / redirect URL for the borrower.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { refuseCustomerTier } from "../_shared/finance-entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface InitiateBody {
  user_id?: string;
  consent_confirmed: boolean;
  disclosure_version?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // E09 F1b: a soft credit pull is not a customer feature — a portal customer is refused before any
    // consent is recorded or a provider is contacted. (The pull is for the caller's own record only;
    // body.user_id is not read.)
    const tier = await refuseCustomerTier(supabase, user.id);
    if (!tier.ok) {
      return new Response(JSON.stringify({ error: tier.error }), {
        status: tier.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as InitiateBody;
    if (!body.consent_confirmed) {
      return new Response(
        JSON.stringify({ error: "Consent must be explicitly confirmed (FCRA §604)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Log FCRA-compliant consent to canonical consent_events table
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
    const ua = req.headers.get("user-agent") ?? null;

    await supabase.from("consent_events").insert({
      user_id: user.id,
      consent_type: "credit_report_access",
      disclosure_version: body.disclosure_version ?? "isoftpull_v1.0",
      granted: true,
      ip_address: ip,
      user_agent: ua,
      metadata: {
        purpose: "soft_credit_pull",
        provider: "isoftpull",
      },
    });

    const isoftpullEnabled =
      (Deno.env.get("ISOFTPULL_ENABLED") ?? "false").toLowerCase() === "true";
    const apiKey = Deno.env.get("ISOFTPULL_API_KEY");

    if (!isoftpullEnabled || !apiKey) {
      return new Response(
        JSON.stringify({
          status: "pending_credentials",
          message: "iSoftpull integration coming soon",
        }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // TODO: live iSoftpull session-start call
    // const result = await fetch("https://api.isoftpull.com/v1/sessions", { ... });
    // return embed token / redirect URL.

    return new Response(
      JSON.stringify({ status: "pending_credentials", message: "iSoftpull integration coming soon" }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("isoftpull-initiate error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
