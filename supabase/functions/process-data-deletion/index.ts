// Process pending data deletion requests (GLBA / privacy compliance).
// Runs daily via pg_cron. Anonymizes PII and deletes derived records.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { deleteUserContactMethods } from "../_shared/user-contact-methods.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const results: Array<Record<string, unknown>> = [];

  try {
    const { data: pending, error: fetchErr } = await supabase
      .from("data_deletion_requests")
      .select("id, user_id, requested_at")
      .eq("status", "pending");

    if (fetchErr) throw fetchErr;

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const req of pending) {
      const userId = req.user_id;
      const stepErrors: string[] = [];

      // Helper that records (but does not throw) per-step errors
      const safe = async (label: string, fn: () => Promise<{ error: any }>) => {
        try {
          const { error } = await fn();
          if (error) stepErrors.push(`${label}: ${error.message}`);
        } catch (e: any) {
          stepErrors.push(`${label}: ${e?.message || String(e)}`);
        }
      };

      // 1. Anonymize PII in profiles
      await safe("profiles_anonymize", () =>
        supabase
          .from("profiles")
          .update({
            full_name: "DELETED",
            address: null,
            city: null,
            state: null,
            postal_code: null,
            ssn_encrypted: null,
            ssn_last_4: null,
            date_of_birth: null,
          })
          .eq("user_id", userId),
      );

      // 1b. Erase every email and phone the person holds (their contact methods).
      await safe("user_contact_methods", async () => {
        await deleteUserContactMethods(supabase, userId);
        return { error: null };
      });

      // 2. Delete derived sensitive records
      await safe("credit_report_verifications", () =>
        supabase.from("credit_report_verifications").delete().eq("user_id", userId),
      );
      await safe("credit_negative_items", () =>
        supabase.from("credit_negative_items").delete().eq("user_id", userId),
      );
      await safe("chat_messages", () =>
        supabase.from("chat_messages").delete().eq("user_id", userId),
      );

      // 3. Clear analysis payloads on uploads (keep file metadata for audit)
      await safe("credit_report_uploads_clear", () =>
        supabase
          .from("credit_report_uploads")
          .update({ analysis_result: null, negative_items_extracted: null })
          .eq("user_id", userId),
      );

      // 4. Banking — best-effort, tables may not exist on all envs
      await safe("connected_bank_accounts", () =>
        supabase.from("connected_bank_accounts").delete().eq("user_id", userId),
      );
      await safe("plaid_transactions", () =>
        supabase.from("plaid_transactions").delete().eq("user_id", userId),
      );

      // 5. Anonymize client memory
      await safe("client_memory", () =>
        supabase
          .from("client_memory")
          .update({ content: "DELETED", is_active: false })
          .eq("client_user_id", userId),
      );

      // S5: owner/workspace memory is a second durable home for the same person — a deletion
      // must not leave a canonical copy behind.
      await safe("paige_owner_memory", () =>
        supabase
          .from("paige_owner_memory")
          .update({ content: "DELETED", is_active: false })
          .eq("user_id", userId),
      );

      // 6. Mark request completed
      await safe("mark_completed", () =>
        supabase
          .from("data_deletion_requests")
          .update({ status: "completed", processed_at: new Date().toISOString() })
          .eq("id", req.id),
      );

      // 7. Audit log
      await supabase.from("audit_logs").insert({
        user_id: userId,
        entity: "data_deletion_requests",
        entity_id: req.id,
        action: "process_deletion",
        data: {
          processed_at: new Date().toISOString(),
          step_errors: stepErrors,
        },
      });

      results.push({ request_id: req.id, user_id: userId, errors: stepErrors });
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[process-data-deletion] fatal", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
