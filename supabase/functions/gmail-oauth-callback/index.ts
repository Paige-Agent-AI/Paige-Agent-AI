import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../_shared/comms-provider-boundary.ts";
// Exchanges the Gmail OAuth authorization code for tokens, stores the refresh token
// in VAULT (never a column, never a log), and provisions the tenant's Gmail
// channel_connectors row so send-message can send as this address (#141b).
//
// §18 REUSE: verifyState (constant recompute + compare), the user-mismatch guard, the
// 10-minute expiry, the token exchange, the fail-closed-if-no-refresh-token check, and
// the userinfo email fetch are all cloned VERBATIM from google-calendar-oauth-callback.
//
// DIVERGENCE from calendar — the credential storage + provisioning is the comms rail's,
// NOT calendar's per-user column-AES:
//   • The refresh token goes to VAULT via write_channel_secret(ref, token) under SERVICE
//     ROLE (§9/§34 — the token is NEVER a column and NEVER logged). calendar's
//     staff_calendar_settings.google_refresh_token_encrypted (column-AES via
//     _shared/calendarCrypto.ts) is a DIFFERENT per-user table and is deliberately NOT reused.
//   • tenant_id is resolved SERVER-SIDE from profiles by the state's user id (§9 — never from
//     the request body/state), then a channel_connectors row (channel_type='email',
//     provider='gmail') is upserted under service role with an explicit SAME-TENANT guard
//     against the GLOBAL uq_channel_connectors_inbound_address unique index (a cross-tenant
//     collision is reported HONESTLY as gmail_already_connected_elsewhere, never a 500).
//
// CONFIG-GATED like the start fn (§13): no GOOGLE_OAUTH_CLIENT_ID/SECRET →
// gmail_oauth_not_configured, never a crash. verify_jwt=true.
//
// HONEST ACTIVATION NOTE (§13): going live requires owner-side Google Cloud console work —
// add the gmail.send scope to the OAuth consent screen, enable the Gmail API, register
// <origin>/auth/gmail/callback as an authorized redirect_uri, and complete Google's
// sensitive-scope verification. Until then the flow degrades to gmail_oauth_not_configured
// (or Google rejects the scope at consent) — expected, not a bug.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveTenantForUser } from "../_shared/tenant-for-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const enc = new TextEncoder();

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

// VERBATIM from google-calendar-oauth-callback (§18) — constant recompute + compare,
// verified with the SAME CALENDAR_ENCRYPTION_KEY the start fn signed with.
async function verifyState(state: string): Promise<Record<string, unknown> | null> {
  const secret = Deno.env.get("CALENDAR_ENCRYPTION_KEY");
  if (!secret) throw new Error("CALENDAR_ENCRYPTION_KEY not configured");
  const [payloadPart, signaturePart] = state.split(".");
  if (!payloadPart || !signaturePart) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payloadPart))));
  if (expected !== signaturePart) return null;
  return JSON.parse(base64UrlDecode(payloadPart));
}

function gmailRedirectOrigin(fallbackOrigin: string): string {
  return (Deno.env.get("CALENDAR_OAUTH_REDIRECT_ORIGIN") || fallbackOrigin).replace(/\/$/, "");
}

/** A stable Vault secret NAME for a tenant's Gmail refresh token (§12 naming convention). */
function gmailVaultRef(tenantId: string, googleAccountId: string): string {
  return `gmail_refresh_token:${tenantId}:${googleAccountId}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Honest config gate (§13): no OAuth client secret → the callback can't exchange.
    const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "gmail_oauth_not_configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userSupa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userSupa.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // §9: provisioning the tenant-wide Gmail SENDING identity is an admin action —
    // the SAME gate gmail-oauth-start and gmail-disconnect apply. Without it, a low-privilege
    // member who completes the Google consent could bind their personal mailbox as the
    // tenant's outbound sender. has_role is global; tenant is bound server-side below.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { code, state, origin } = await req.json();
    if (!code || !state || !origin) {
      return new Response(JSON.stringify({ error: "missing_params" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify state (§18 clone)
    let parsed: any;
    try { parsed = await verifyState(state); } catch {
      parsed = null;
    }
    if (!parsed) {
      return new Response(JSON.stringify({ error: "invalid_state" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (parsed.u !== user.id) {
      return new Response(JSON.stringify({ error: "state_user_mismatch" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (Date.now() - Number(parsed.t) > 10 * 60 * 1000) {
      return new Response(JSON.stringify({ error: "state_expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve the tenant SERVER-SIDE from the state's user id (§9 — never body).
    // `admin` (service-role) was created above for the has_role gate; reuse it.
    //
    // This used to read `profiles.tenant_id` keyed on `profiles.id`. That column
    // does not exist and that key is a surrogate, so it returned null for every
    // user and this endpoint could never succeed — see `_shared/tenant-for-user.ts`.
    // `parsed.w` is the workspace the person was standing in, carried inside the
    // SIGNED state, and it is honoured only after an active-membership check.
    // (`t` is already the state's timestamp — see the expiry check above.)
    const resolved = await resolveTenantForUser(admin, parsed.u, parsed.w ?? null);
    const tenantId = resolved.tenantId;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "no_tenant_for_user", detail: resolved.error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Store the refresh token ONLY in Vault (§9/§34) — never a column, never a log. ──
    if (!await commsProviderExecutionAllowed(admin, { tenantId, actorUserId: user.id })) {
      return new Response(JSON.stringify({ error: COMMS_PROVIDER_EXECUTION_DISABLED }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const redirectUri = `${gmailRedirectOrigin(String(origin))}/auth/gmail/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = await tokenRes.json();
    // Fail closed: no refresh_token means we can't send later (offline access wasn't granted).
    if (!tokenRes.ok || !tokenJson.refresh_token) {
      return new Response(JSON.stringify({ error: "token_exchange_failed", detail: tokenJson?.error ?? null }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the connected Gmail address + Google account id (sub) via userinfo.
    let googleEmail: string | null = null;
    let googleSub: string | null = null;
    let googleName: string | null = null;
    try {
      const uRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (uRes.ok) {
        const u = await uRes.json();
        googleEmail = u.email ?? null;
        googleSub = u.sub ?? null;
        googleName = u.name ?? null;
      }
    } catch { /* non-fatal */ }

    if (!googleEmail) {
      // Without the address we cannot key the connector; honest failure, never a fake row (§13).
      return new Response(JSON.stringify({ error: "gmail_email_unavailable" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // The GLOBAL uq_channel_connectors_inbound_address index keys on lower(inbound_address);
    // normalize once so the row, the collision check, and the index all agree.
    const gmailAddr = googleEmail.toLowerCase();
    const accountId = googleSub ?? gmailAddr;

    const ref = gmailVaultRef(tenantId, accountId);
    const { error: vaultErr } = await admin.rpc("write_channel_secret", {
      _ref: ref,
      _secret: String(tokenJson.refresh_token),
      _description: `Gmail refresh token for tenant ${tenantId} (${gmailAddr})`,
    });
    if (vaultErr) {
      // Never echo the token; a vault failure is a real failure (§13).
      return new Response(JSON.stringify({ error: "vault_write_failed", detail: vaultErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Provision the channel_connectors row under service role with a §9 SAME-TENANT
    //    guard against the GLOBAL inbound_address unique index. supabase-js upsert can't
    //    express the partial-index + tenant WHERE the SQL trigger uses, so we do it
    //    explicitly: (1) reconnect our OWN row if present; (2) else honestly reject a
    //    cross-tenant collision; (3) else insert. ──
    const connectorFields = {
      channel_type: "email",
      provider: "gmail",
      inbound_address: gmailAddr,
      external_account_id: accountId,
      from_address: gmailAddr,
      from_name: googleName,
      display_name: googleName ?? gmailAddr,
      credentials_vault_ref: ref,
      status: "active",
      active: true,
    };

    // (1) Our tenant's existing Gmail connector for this address → reconnect (update).
    const { data: ownRow } = await admin
      .from("channel_connectors")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("channel_type", "email")
      .eq("provider", "gmail")
      .eq("inbound_address", gmailAddr)
      .maybeSingle();

    if (ownRow?.id) {
      const { error: updErr } = await admin
        .from("channel_connectors")
        .update({ ...connectorFields, updated_at: new Date().toISOString() })
        .eq("id", ownRow.id)
        .eq("tenant_id", tenantId); // belt-and-suspenders §9 scope
      if (updErr) {
        return new Response(JSON.stringify({ error: "connector_update_failed", detail: updErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // (2) Is this Gmail address already an email connector under ANOTHER tenant?
      //     The GLOBAL unique index would 500 the insert — instead, report it honestly.
      const { data: foreignRow } = await admin
        .from("channel_connectors")
        .select("tenant_id")
        .eq("channel_type", "email")
        .eq("inbound_address", gmailAddr)
        .maybeSingle();
      if (foreignRow && foreignRow.tenant_id && foreignRow.tenant_id !== tenantId) {
        return new Response(JSON.stringify({ error: "gmail_already_connected_elsewhere" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // (3) Fresh insert. tenant_id is set EXPLICITLY (§9) — under service role the
      //     set_channel_connector_tenant() trigger coalesces to new.tenant_id since
      //     current_user_tenant_id() is null in a service-role context.
      const { error: insErr } = await admin
        .from("channel_connectors")
        .insert({ ...connectorFields, tenant_id: tenantId });
      if (insErr) {
        // A race that lost the unique-index bet lands here — surface it honestly.
        const collision = /uq_channel_connectors_inbound_address|duplicate key/i.test(insErr.message);
        return new Response(
          JSON.stringify({ error: collision ? "gmail_already_connected_elsewhere" : "connector_insert_failed", detail: collision ? null : insErr.message }),
          { status: collision ? 409 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    /**
     * Evidence that this workspace granted Paige permission to send as a Google
     * account. It is the counterpart of the disconnect entry, and the pair is
     * what makes the grant's lifetime answerable at all.
     *
     * Placed AFTER both write branches so it records a grant that actually
     * landed: every failure path above returns before reaching here, including
     * the two that report the address is already connected under another tenant.
     * `reconnected` distinguishes re-authorising an address this workspace
     * already held from granting one for the first time.
     *
     * `entity_id` is null on a FIRST connect, honestly: the insert above does not
     * return the new row's id, and widening it would change a write path whose
     * error handling is load-bearing for the unique-index race below it. The row
     * is still identified — tenant, provider and address pin it exactly — and a
     * null here means "not captured", never "no connector".
     *
     * NEVER BLOCKING (the `comms-purchase-number` pattern): the grant exists and
     * the connector row is written by the time this runs, so a failed audit write
     * must not turn a completed connection into a reported failure. Logged
     * loudly, never swallowed (§32).
     *
     * NO SECRET: the refresh token is in Vault and the access token is not
     * persisted at all. Neither, nor the vault ref, appears here. The address
     * does, because an audit row that does not say WHICH account was granted is
     * not evidence of anything.
     */
    const { error: auditErr } = await admin.from("audit_logs").insert({
      user_id: user.id,
      entity: "gmail_connection",
      action: "comms:sending_account_connected",
      entity_id: ownRow?.id ?? null,
      data: {
        tenant_id: tenantId,
        address: gmailAddr,
        provider: "gmail",
        reconnected: Boolean(ownRow?.id),
        // The scope actually granted, so the record cannot later be read as
        // broader than it was. This connection asks to SEND only.
        scope: "gmail.send",
      },
    });
    if (auditErr) console.error("[gmail-oauth-callback] audit write failed:", auditErr.message);

    return new Response(
      JSON.stringify({ ok: true, gmail_address: gmailAddr, return_origin: parsed.r ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error).message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
