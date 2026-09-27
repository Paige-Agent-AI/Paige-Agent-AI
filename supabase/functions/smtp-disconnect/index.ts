// Disconnects the caller's tenant SMTP connector (#141c). Idempotent.
//
// §18 clone of gmail-disconnect, adapted for bring-your-own SMTP:
//   • §9: scoped to the caller's OWN tenant (current_user_tenant_id from the JWT), and
//     gated to an admin — never a cross-tenant teardown.
//   • Deactivates the tenant's provider='smtp' channel_connectors row (active=false,
//     status='disabled') and clears credentials_vault_ref so the row no longer references
//     the secret.
//   • DROPS the Google-revoke step gmail-disconnect has — a generic SMTP connector has no
//     OAuth token to revoke; there is only the Vault {user,pass} blob to tombstone.
//   • Best-effort tombstone of the Vault secret: there is no delete half of the Vault bridge
//     yet (only write/read_channel_secret), so we OVERWRITE it with a tombstone value and
//     unlink the ref from the row. §13 HONEST: the secret row itself remains in vault.secrets
//     (now inert — overwritten AND unlinked); a true delete bridge is a follow-up, not
//     silently claimed here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const userSupa = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userSupa.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // §9: role + tenant gate. has_role is global, so bind the teardown to the caller's own
  // tenant (JWT-scoped) — never a cross-tenant disconnect.
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: callerTenant } = await userSupa.rpc("current_user_tenant_id");
  if (!callerTenant) {
    // No tenant context → nothing to disconnect. Idempotent success.
    return new Response(JSON.stringify({ ok: true, disconnected: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Locate the tenant's SMTP connector (service role, explicitly tenant-scoped §9).
  const { data: row } = await admin
    .from("channel_connectors")
    .select("id, credentials_vault_ref")
    .eq("tenant_id", callerTenant)
    .eq("channel_type", "email")
    .eq("provider", "smtp")
    .maybeSingle();

  if (!row?.id) {
    // Already gone / never connected — idempotent success (§31 no dead-end).
    return new Response(JSON.stringify({ ok: true, disconnected: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Best-effort tombstone of the Vault {user,pass} blob (no delete bridge yet, §13). A failure
  // here never blocks the disconnect — the row is unlinked regardless. supabase-js returns
  // { data, error } (it does not throw), so awaiting + ignoring the result is the safe form.
  if (row.credentials_vault_ref) {
    try {
      await admin.rpc("write_channel_secret", {
        _ref: row.credentials_vault_ref,
        _secret: JSON.stringify({ user: "", pass: "" }),
        _description: `SMTP credentials revoked/disconnected for tenant ${callerTenant}`,
      });
    } catch { /* best-effort — teardown proceeds */ }
  }

  // Deactivate + unlink the secret ref (§9 tenant-scoped). Idempotent.
  const { error } = await admin
    .from("channel_connectors")
    .update({
      active: false,
      status: "disabled",
      credentials_vault_ref: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("tenant_id", callerTenant);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, disconnected: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
