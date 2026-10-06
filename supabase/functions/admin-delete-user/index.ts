import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) throw new Error("Unauthorized");

    // Accept admin OR super_admin (super_admin is the platform owner tier)
    const { data: callerRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id);

    const roleSet = new Set((callerRoles ?? []).map((r: any) => r.role));
    const isSuperAdmin = roleSet.has("super_admin");
    if (!isSuperAdmin && !roleSet.has("admin")) {
      throw new Error("Admin privileges required");
    }

    const body = await req.json();
    const user_id: string | undefined = body?.user_id ?? body?.userId;
    const keepContact: boolean = body?.keep_contact !== false; // default: keep clients row
    if (!user_id || typeof user_id !== "string") throw new Error("Missing user_id");

    if (user_id === caller.id) throw new Error("Cannot delete your own account");

    // Protect platform owner
    const { data: ownerRow } = await admin
      .from("app_settings_owner")
      .select("owner_email")
      .limit(1)
      .maybeSingle();

    if (ownerRow) {
      const { data: targetUser } = await admin.auth.admin.getUserById(user_id);
      if (targetUser?.user?.email && ownerRow.owner_email &&
          targetUser.user.email.toLowerCase() === ownerRow.owner_email.toLowerCase()) {
        throw new Error("Cannot delete the platform owner");
      }
    }

    const errors: Array<{ step: string; error: string }> = [];
    const track = async (step: string, p: Promise<any>) => {
      try {
        const { error } = await p;
        if (error) errors.push({ step, error: error.message });
      } catch (e: any) {
        errors.push({ step, error: e?.message || String(e) });
      }
    };

    // Unlink relationships first (preserves business records owned by the user
    // in CRM form). If keepContact=true the clients row survives, just unlinked.
    if (keepContact) {
      await track("unlink clients.linked_user_id",
        admin.from("clients").update({ linked_user_id: null }).eq("linked_user_id", user_id));
    } else {
      await track("delete clients",
        admin.from("clients").delete().eq("linked_user_id", user_id));
    }
    await track("unlink coach assignments",
      admin.from("clients").update({ assigned_coach_user_id: null }).eq("assigned_coach_user_id", user_id));

    // Per-user owned rows we want to remove
    const owned = [
      "user_roles", "profiles", "user_subscriptions", "user_usage",
      "chat_messages", "credit_accounts", "credit_negative_items",
      "credit_inquiries", "disputes", "dispute_letters", "dispute_outcomes",
      "credit_factor_scores", "credit_report_personal_info",
      "credit_report_uploads", "credit_alerts", "credit_predictions",
      "credit_utilization_snapshots", "tasks", "documents", "consent_events",
      "notifications", "notification_preferences", "push_subscriptions",
      "push_notification_preferences", "push_notification_log",
      "legal_acceptances", "client_goals", "client_memory", "paige_owner_memory", "client_notes",
      "communication_preferences", "tenant_members", "coach_clients",
      "broker_profiles", "broker_team_members", "affiliate_profiles",
    ];
    for (const t of owned) {
      await track(`delete ${t}`, admin.from(t).delete().eq("user_id", user_id));
    }

    // Delete auth user
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user_id);
    if (deleteErr) throw new Error(`Auth delete failed: ${deleteErr.message}. Cleanup errors: ${JSON.stringify(errors)}`);

    // Audit
    await admin.from("audit_logs").insert({
      user_id: caller.id,
      entity: "user",
      action: "admin_delete_user",
      entity_id: user_id,
      data: { deleted_by: caller.id, keep_contact: keepContact, cleanup_errors: errors },
    });

    return new Response(
      JSON.stringify({ success: true, cleanup_errors: errors }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in admin-delete-user:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: error.message?.includes("Unauthorized") || error.message?.includes("Admin") ? 403 : 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
