import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { primaryPhonesForUsers } from "../_shared/user-contact-methods.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!adminRole) throw new Error("Admin access required");

    // Fetch profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, full_name, address, city, state, postal_code, created_at, onboarding_completed, estimated_fico_tu, estimated_fico_ex, estimated_fico_eq")
      .order("created_at", { ascending: false });

    if (profilesError) throw profilesError;

    // Each person's primary phone. A failed read fails the export rather than shipping a file
    // whose Phone column is silently empty.
    const phoneMap = await primaryPhonesForUsers(supabase, (profiles || []).map((p) => p.user_id));

    // Fetch subscriptions
    const { data: subs } = await supabase
      .from("user_subscriptions")
      .select("user_id, plan_slug, status, trial_ends_at, current_period_end");

    const subsMap = new Map((subs || []).map(s => [s.user_id, s]));

    // Fetch businesses
    const { data: businesses } = await supabase
      .from("businesses")
      .select("owner_user_id, legal_name, entity_type, ein, state_of_formation");

    const bizMap = new Map<string, string[]>();
    (businesses || []).forEach(b => {
      const list = bizMap.get(b.owner_user_id) || [];
      list.push(b.legal_name);
      bizMap.set(b.owner_user_id, list);
    });

    // Fetch user emails from auth (service role)
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const emailMap = new Map((authUsers || []).map(u => [u.id, u.email]));

    // Build CSV
    const headers = [
      "Email", "Full Name", "Phone", "Address", "City", "State", "Zip",
      "Signup Date", "Onboarding Complete", "Plan", "Sub Status",
      "Trial Ends", "Period End", "FICO TU", "FICO EX", "FICO EQ", "Businesses"
    ];

    const escCsv = (val: unknown) => {
      const s = val == null ? "" : String(val);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = (profiles || []).map(p => {
      const sub = subsMap.get(p.user_id);
      const biz = bizMap.get(p.user_id);
      return [
        emailMap.get(p.user_id) || "",
        p.full_name, phoneMap.get(p.user_id) ?? "", p.address, p.city, p.state, p.postal_code,
        p.created_at ? new Date(p.created_at).toISOString().split("T")[0] : "",
        p.onboarding_completed ? "Yes" : "No",
        sub?.plan_slug || "", sub?.status || "",
        sub?.trial_ends_at ? new Date(sub.trial_ends_at).toISOString().split("T")[0] : "",
        sub?.current_period_end ? new Date(sub.current_period_end).toISOString().split("T")[0] : "",
        p.estimated_fico_tu, p.estimated_fico_ex, p.estimated_fico_eq,
        biz?.join("; ") || ""
      ].map(escCsv).join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="paige-clients-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Export failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: error instanceof Error && msg.includes("nauthorized") ? 401 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
