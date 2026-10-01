// Security canary: probes growth_forms and growth_pages as an anonymous caller
// to verify that internal/restricted columns are not reachable. Logs every run
// and raises an admin notification on regression.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
// §68: this probe is the safety loop that gates Paige's autonomy rungs, so it must not be
// drivable by anyone who can reach the URL. Reuses the ONE cron/service gate (§18) rather than
// growing a second copy of the security logic.
import { isAuthorizedInternalCaller, adminClient } from "../_shared/systems-check-http.ts";
import { primaryEmailsForUsers } from "../_shared/user-contact-methods.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Columns the public anon role MUST NOT be able to select. If any of these
// come back populated (or the request succeeds at all on the restricted
// projection), we treat the run as a regression.
const PROBES: Array<{
  name: string;
  table: "growth_forms" | "growth_pages";
  restrictedCols: string[];
  filter: string;
}> = [
  {
    name: "growth_forms_internal_columns",
    table: "growth_forms",
    restrictedCols: ["tenant_id", "notify_user_ids", "workflow_slug", "pipeline_id", "stage_id"],
    filter: "status=eq.active",
  },
  {
    name: "growth_pages_internal_columns",
    table: "growth_pages",
    // `entry_page_id` was named here and does not exist on growth_pages — every run of this probe
    // returned 42703 (undefined_column), so this half of the canary had never actually probed
    // anything. Replaced with columns that DO exist and that anon must never read: the owning
    // tenant, the author, and the unpublished draft body.
    restrictedCols: ["tenant_id", "created_by", "draft_blocks_json"],
    filter: "status=eq.published",
  },
];

type ProbeResult = {
  probe_name: string;
  target: string;
  status: "pass" | "regression" | "error";
  leaked_columns: string[];
  sample_payload: unknown;
  http_status: number | null;
  error_message: string | null;
};

async function runProbe(p: typeof PROBES[number]): Promise<ProbeResult> {
  const select = encodeURIComponent(p.restrictedCols.join(","));
  const url = `${SUPABASE_URL}/rest/v1/${p.table}?select=${select}&${p.filter}&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    // Expected outcome: 401/403 OR a 200 with rows that contain only NULLs
    // for restricted columns (i.e. column-level grants stripped them).
    if (res.status === 401 || res.status === 403) {
      return {
        probe_name: p.name,
        target: p.table,
        status: "pass",
        leaked_columns: [],
        sample_payload: { http: res.status, body: text.slice(0, 300) },
        http_status: res.status,
        error_message: null,
      };
    }
    if (res.status === 200) {
      let rows: Array<Record<string, unknown>> = [];
      try { rows = JSON.parse(text); } catch { /* ignore */ }
      const leaked = new Set<string>();
      for (const row of rows) {
        for (const col of p.restrictedCols) {
          if (row && Object.prototype.hasOwnProperty.call(row, col) && row[col] !== null && row[col] !== undefined) {
            leaked.add(col);
          }
        }
      }
      return {
        probe_name: p.name,
        target: p.table,
        status: leaked.size > 0 ? "regression" : "pass",
        leaked_columns: [...leaked],
        sample_payload: rows.slice(0, 1),
        http_status: 200,
        error_message: null,
      };
    }
    return {
      probe_name: p.name,
      target: p.table,
      status: "error",
      leaked_columns: [],
      sample_payload: { body: text.slice(0, 300) },
      http_status: res.status,
      error_message: `unexpected_status_${res.status}`,
    };
  } catch (e) {
    return {
      probe_name: p.name,
      target: p.table,
      status: "error",
      leaked_columns: [],
      sample_payload: null,
      http_status: null,
      error_message: String(e).slice(0, 500),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Fail closed. An unauthenticated caller could otherwise drive unbounded service-role writes
  // into security_canary_runs — and, now that §68 reads this table to decide what Paige may do
  // unwatched, could manufacture the evidence that grants authority.
  if (!(await isAuthorizedInternalCaller(req, adminClient()))) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const results = await Promise.all(PROBES.map(runProbe));

  const { error: insertErr } = await admin.from("security_canary_runs").insert(results);
  if (insertErr) console.error("canary_insert_failed", insertErr);

  const regressions = results.filter((r) => r.status === "regression");
  if (regressions.length > 0) {
    const lines = regressions.map(
      (r) => `• ${r.target}: leaked columns [${r.leaked_columns.join(", ")}]`,
    );
    await admin.from("paige_admin_notifications").insert({
      severity: "urgent",
      title: `🚨 Security canary regression (${regressions.length})`,
      body:
        `Anonymous probe was able to read restricted columns:\n` +
        lines.join("\n") +
        `\n\nReview RLS policies and column GRANTs on growth_forms / growth_pages.`,
      link_to: `/operator/settings/governance/security`,
      source_workflow_key: "security_canary_regression",
      scope: "admin",
    });

    // Email the platform operators (§53: super_admin + platform_admin) at their primary address.
    // Not the tenant-level `admin` role: this alert describes the platform's own column grants,
    // and a tenant admin is not the audience for it. A failed read is logged below, loudly.
    try {
      const { data: roleRows, error: roleErr } = await admin
        .from("user_roles")
        .select("user_id")
        .in("role", ["super_admin", "platform_admin"]);
      if (roleErr) throw new Error(`operator role read failed: ${roleErr.message}`);
      const userIds = [...new Set((roleRows ?? []).map((r: any) => r.user_id).filter(Boolean))] as string[];
      const emails = await primaryEmailsForUsers(admin, userIds);
      const { data: nameRows } = userIds.length
        ? await admin.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] };
      const nameOf = new Map((nameRows ?? []).map((p: any) => [p.user_id, p.full_name as string | null]));
      const recipients = userIds
        .filter((id) => emails.has(id))
        .map((id) => ({ user_id: id, email: emails.get(id)!, full_name: nameOf.get(id) ?? null }));
      if (recipients.length > 0) {
        const runAt = new Date().toISOString();
        const emailRegressions = regressions.map((r) => ({
          target: r.target,
          leaked_columns: r.leaked_columns,
          http_status: r.http_status,
        }));
        await Promise.allSettled(
          recipients.map((p: any) =>
            fetch(`${SUPABASE_URL}/functions/v1/send-transactional-email`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SERVICE_KEY}`,
              },
              body: JSON.stringify({
                templateName: "security-canary-regression",
                recipientEmail: p.email,
                recipientUserId: p.user_id,
                idempotencyKey: `canary-${runAt}-${p.user_id}`,
                purpose: "transactional",
                templateData: {
                  recipientName: p.full_name?.split(" ")?.[0] ?? null,
                  runAt,
                  regressions: emailRegressions,
                  reviewUrl: "https://paigeagent.ai/operator/settings/governance/security",
                },
              }),
            }).catch((e) => console.error("canary_email_send_failed", p.user_id, e)),
          ),
        );
      } else {
        console.error("canary: no platform operator has a primary email; regression email not sent");
      }
    } catch (e) {
      console.error("canary_email_dispatch_failed", e);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      checked: results.length,
      regressions: regressions.length,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
