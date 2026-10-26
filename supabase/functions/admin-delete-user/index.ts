import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// EXP08 stage 0 (owner ruling 2026-10-26): deleting a login is a PLATFORM act — it removes the
// person from every workspace at once — so it is the Platform Operator's (§53), never the global
// `admin` row that an owner/admin seat in ANY workspace writes. See _shared/operatorAuth.ts.
import { requireOperator } from "../_shared/operatorAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Platform Operator only (super_admin OR platform_admin), from the VERIFIED JWT — before the
    // body is read. A workspace owner/admin is refused here, whatever workspaces they hold.
    const guard = await requireOperator(req);
    if (!guard.ok) return guard.response;
    const admin = guard.admin;
    const caller = { id: guard.userId };

    const body = await req.json();
    const user_id: string | undefined = body?.user_id ?? body?.userId;
    const keepContact: boolean = body?.keep_contact !== false; // default: keep clients row
    if (!user_id || typeof user_id !== "string") throw new Error("Missing user_id");

    if (user_id === caller.id) throw new Error("Cannot delete your own account");

    // §53: a platform_admin may not remove a super_admin (it cannot grant one either). Fail closed
    // when the role read errors.
    const [{ data: callerRoles, error: callerRolesErr }, { data: targetRoles, error: targetRolesErr }] =
      await Promise.all([
        admin.from("user_roles").select("role").eq("user_id", caller.id),
        admin.from("user_roles").select("role").eq("user_id", user_id),
      ]);
    if (callerRolesErr || targetRolesErr) throw new Error("Could not read roles; nothing was deleted");
    const callerIsSuperAdmin = (callerRoles ?? []).some((r: any) => r.role === "super_admin");
    const targetIsSuperAdmin = (targetRoles ?? []).some((r: any) => r.role === "super_admin");
    if (targetIsSuperAdmin && !callerIsSuperAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

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
    const track = async (step: string, p: PromiseLike<any>) => {
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
    // S5/P2: two stores key the person by a DIFFERENT column — client_memory by
    // client_user_id (a bare user_id filter there is a PostgREST 400 swallowed into
    // cleanup_errors, which the S5 cutover made load-bearing: a deletion must remove BOTH
    // the canonical owner-memory copy AND the legacy client-memory originals).
    const columnByTable: Record<string, string> = {
      client_memory: "client_user_id",
      paige_owner_memory: "user_id",
      credit_alerts: "client_id",
      client_notes: "author_user_id",
      coach_clients: "client_user_id",
    };
    for (const t of owned) {
      await track(`delete ${t}`, admin.from(t).delete().eq(columnByTable[t] ?? "user_id", user_id));
    }
    // Private customer AI history is authored by this Auth subject. Its existing
    // caller FK is RESTRICT, so the canonical account-deletion path removes only
    // this audience before Auth deletion. Business/staff history is unaffected.
    await track("delete private customer conversations", admin.from("paige_chat_threads")
      .delete().eq("caller_user_id", user_id).eq("audience", "customer_private"));

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
