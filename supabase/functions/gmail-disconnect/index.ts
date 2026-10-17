import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readGmailConnectionAuthority } from "../_shared/gmail-connection-authority.ts";

// Local disconnect is one native connector + Vault transaction. Subsequent Google
// revocation is best-effort and cannot be atomic with it. A blocked/unanswered
// revoke never resurrects the disabled and unlinked PAIGE connection.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let nativeWriteAttempted = false;
  let disconnected = false;
  let auditConfirmed = false;
  const unknown = () => response(503, { error: "gmail_disconnect_outcome_unknown", disconnected: null,
    note: "The disconnect could not be confirmed. Inspect the original workspace before retrying." });
  const withheld = (status: number) => response(status, { error: "gmail_disconnected_result_withheld", disconnected: true,
    audit_confirmed: auditConfirmed, note: "PAIGE disconnected Google in the original workspace. Refresh that workspace to inspect the result." });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["connector_id", "expected_updated_at", "expected_tenant_id"].includes(key))) {
      return response(400, { error: "gmail_connector_selection_invalid" });
    }
    const selected = body.connector_id !== undefined;
    if ((selected && (typeof body.connector_id !== "string" || !UUID.test(body.connector_id)
      || typeof body.expected_updated_at !== "string" || !Number.isFinite(Date.parse(body.expected_updated_at))))
      || (!selected && body.expected_updated_at !== undefined)) {
      return response(400, { error: "gmail_connector_selection_invalid" });
    }
    const authority = await readGmailConnectionAuthority(caller, admin, undefined, body.expected_tenant_id);
    if (!authority.ok) return response(authority.status, { error: authority.error });
    const { tenantId, actorId } = authority;
    const currentAuthority = () => readGmailConnectionAuthority(caller, admin, actorId, tenantId);
    const refuse = (check: { status: number; error: string }) => disconnected
      ? withheld(check.status) : response(check.status, { error: check.error });

    const lookup = admin.from("channel_connectors")
      .select("id,credentials_vault_ref,inbound_address,external_account_id,mailbox_class,mailbox_owner_user_id,updated_at")
      .eq("tenant_id", tenantId).eq("channel_type", "email").eq("provider", "gmail");
    // Identity/version are stale-view preconditions, never authority. Old callers
    // can omit them only when two bounded rows prove there is no choice to make.
    const { data, error: readError } = selected
      ? await lookup.eq("id", body.connector_id.toLowerCase()).maybeSingle()
      : await lookup.limit(2);
    const afterRead = await currentAuthority();
    if (!afterRead.ok) return refuse(afterRead);
    if (readError) return response(503, { error: "gmail_connector_lookup_failed" });
    if (!selected && (!Array.isArray(data) || data.length > 1)) {
      return response(409, { error: "gmail_connector_selection_required" });
    }
    const row = selected ? data : data[0];
    if (!row) return selected ? response(409, { error: "gmail_connection_changed" })
      : response(200, { ok: true, disconnected: false });
    if (selected && (row.id !== body.connector_id.toLowerCase() || row.updated_at !== body.expected_updated_at)) {
      return response(409, { error: "gmail_connection_changed" });
    }
    if (row.mailbox_class === "personal" && row.mailbox_owner_user_id !== actorId) {
      return response(403, { error: "gmail_already_personal_to_another_user" });
    }
    if (typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))
      || (row.credentials_vault_ref !== null && row.credentials_vault_ref !==
        `gmail_refresh_token:${tenantId}:${row.external_account_id}`)) {
      return response(409, { error: "gmail_connection_changed" });
    }
    let refreshToken = "";
    if (row.credentials_vault_ref) {
      try {
        const { data: secret, error: secretError } = await admin.rpc("read_channel_secret", { _ref: row.credentials_vault_ref });
        if (!secretError && typeof secret === "string") refreshToken = secret;
      } catch { /* optional external revoke; native disconnect still owns the tombstone */ }
    }
    const afterSecret = await currentAuthority();
    if (!afterSecret.ok) return refuse(afterSecret);
    const providerAllowed = await commsProviderExecutionAllowed(admin, { tenantId, actorUserId: actorId });
    const beforeNative = await currentAuthority();
    if (!beforeNative.ok) return refuse(beforeNative);
    nativeWriteAttempted = true;
    const { data: saved, error: nativeError } = await admin.rpc("disconnect_gmail_connection", {
      _actor_user_id: actorId, _expected_tenant_id: tenantId, _connector_id: row.id,
      _expected_vault_ref: row.credentials_vault_ref, _expected_updated_at: row.updated_at,
    });
    if (nativeError) {
      if (/GMAIL_(?:CONNECTION_CHANGED|CONNECTION_FORBIDDEN|PERSONAL_MAILBOX_CONFLICT|ACTOR_UNAVAILABLE|WORKSPACE_CHANGED|WORKSPACE_UNAVAILABLE|CREDENTIAL_SCOPE_UNAVAILABLE)/.test(nativeError.message ?? "")) {
        return response(409, { error: "gmail_connection_changed", disconnected: false });
      }
      return unknown();
    }
    if (!saved || saved.ok !== true || saved.connector_id !== row.id || saved.tenant_id !== tenantId
      || typeof saved.disconnected !== "boolean") return unknown();
    disconnected = saved.disconnected;
    if (disconnected) {
      // The domain result exists. Lost audit acknowledgement does not mean 'not done'.
      try {
        const { error } = await admin.from("audit_logs").insert({
          user_id: actorId, entity: "gmail_connection", action: "comms:sending_account_disconnected", entity_id: row.id,
          data: { tenant_id: tenantId, address: row.inbound_address ?? null, provider: "gmail" },
        });
        auditConfirmed = !error;
        if (error) console.error("[gmail-disconnect] audit write was not confirmed");
      } catch { console.error("[gmail-disconnect] audit write was not confirmed"); }
    }
    const afterNative = await currentAuthority();
    if (!afterNative.ok) return refuse(afterNative);
    let revocationAcknowledged = false;
    if (disconnected && refreshToken && providerAllowed) {
      try {
        const result = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken }),
        });
        revocationAcknowledged = result.ok;
      } catch { /* canonical local disconnect already committed */ }
    }
    const beforeResult = await currentAuthority();
    if (!beforeResult.ok) return refuse(beforeResult);
    return response(200, { ok: true, disconnected, connector_id: row.id, audit_confirmed: auditConfirmed,
      google_revocation_acknowledged: revocationAcknowledged });
  } catch {
    if (disconnected) return withheld(503);
    if (nativeWriteAttempted) return unknown();
    return response(503, { error: "gmail_authority_unavailable" });
  }
});
