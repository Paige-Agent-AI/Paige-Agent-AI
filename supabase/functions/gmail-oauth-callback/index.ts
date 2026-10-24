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
//   • tenant_id is current SERVER authority, checked against signed consent scope.
//     The service-only native transaction rechecks actor/workspace/admin authority,
//     mailbox privacy and collisions before writing Vault + channel_connectors
//     together. Google exchange cannot be atomic with local persistence.
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
import { readGmailConnectionAuthority } from "../_shared/gmail-connection-authority.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let nativeWriteAttempted = false;
  let connectionSaved = false;
  let auditConfirmed = false;

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

    // Same canonical current-workspace owner/admin gate as start and disconnect.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authority = await readGmailConnectionAuthority(userSupa, admin, user.id);
    if (!authority.ok) {
      return new Response(JSON.stringify({ error: authority.error }), {
        status: authority.status,
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
    let parsed: Record<string, unknown> | null;
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
    if (!Number.isFinite(Number(parsed.t)) || Number(parsed.t) > Date.now()
      || Date.now() - Number(parsed.t) > 10 * 60 * 1000) {
      return new Response(JSON.stringify({ error: "state_expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A signed previous workspace is a guard, never a fallback target. In
    // particular, a stale/revoked preference must not fall through to a different
    // primary workspace while a person completes this consent round.
    const signedWorkspace = parsed.w ?? null;
    const stateIssuedAt = Number(parsed.t);
    const currentAuthority = async () => {
      const check = await readGmailConnectionAuthority(userSupa, admin, user.id, signedWorkspace);
      if (!check.ok) return check;
      if (Date.now() - stateIssuedAt > 10 * 60 * 1000) {
        return { ok: false as const, status: 400, error: "state_expired" };
      }
      return check;
    };
    const refuseAuthority = (check: { status: number; error: string }) => new Response(JSON.stringify(connectionSaved ? {
      error: "gmail_connection_saved_result_withheld", connection_saved: true, audit_confirmed: auditConfirmed,
      note: "The connection was saved in the original workspace. Refresh that workspace to inspect it before reconnecting.",
    } : { error: check.error }), {
      status: check.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const bound = await currentAuthority();
    if (!bound.ok) return refuseAuthority(bound);
    const tenantId = bound.tenantId;
    if (parsed.r !== origin) return new Response(JSON.stringify({ error: "state_origin_mismatch" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    // ── Store the refresh token ONLY in Vault (§9/§34) — never a column, never a log. ──
    if (!await commsProviderExecutionAllowed(admin, { tenantId, actorUserId: user.id })) {
      return new Response(JSON.stringify({ error: COMMS_PROVIDER_EXECUTION_DISABLED }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const beforeExchange = await currentAuthority();
    if (!beforeExchange.ok) return refuseAuthority(beforeExchange);

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
    const afterExchange = await currentAuthority();
    if (!afterExchange.ok) return refuseAuthority(afterExchange);
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
    const beforePersist = await currentAuthority();
    if (!beforePersist.ok) return refuseAuthority(beforePersist);

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

    // ── Provision the channel_connectors row under service role with a §9 SAME-TENANT
    //    guard against the GLOBAL inbound_address unique index. supabase-js upsert can't
    //    express the partial-index + tenant WHERE the SQL trigger uses, so we do it
    //    explicitly: (1) reconnect our OWN row if present; (2) else honestly reject a
    //    cross-tenant collision; (3) else insert. ──
    //    #1140: a purpose=inbox consent is the PERSONAL mailbox policy — the granting
    //    user is bound as the mailbox owner and the scopes Google actually granted are
    //    recorded, so read/organize gates refuse by column when consent narrows.
    const purpose = parsed.p === "inbox" ? "inbox" : "send";
    const grantedScopes: string[] = typeof tokenJson.scope === "string"
      ? tokenJson.scope.split(" ").filter((scope: string) => scope.startsWith("https://"))
      : [];

    // (1) Our tenant's existing Gmail connector for this address → reconnect (update).
    const { data: ownRow, error: ownReadError } = await admin
      .from("channel_connectors")
      .select("id,mailbox_class,mailbox_owner_user_id")
      .eq("tenant_id", tenantId)
      .eq("channel_type", "email")
      .eq("provider", "gmail")
      .eq("inbound_address", gmailAddr)
      .maybeSingle();
    const afterConnectorRead = await currentAuthority();
    if (!afterConnectorRead.ok) return refuseAuthority(afterConnectorRead);
    if (ownReadError || (ownRow && typeof ownRow.id !== "string")) return new Response(
      JSON.stringify({ error: "gmail_connector_lookup_failed" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );

    if (ownRow?.id) {
      // #1140: an inbox consent must NEVER silently privatize a connector that is
      // currently the tenant's SHARED support mailbox — every other staff seat would
      // lose the shared history the moment the row flips to personal. Reconnecting
      // one's own personal mailbox (already personal) stays allowed.
      if (ownRow.mailbox_class !== "personal" && ownRow.mailbox_class !== "shared_support") {
        return new Response(JSON.stringify({ error: "gmail_connector_lookup_failed" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // A sending-only consent must not replace a teammate's private credential either.
      if (ownRow.mailbox_class === "personal" && ownRow.mailbox_owner_user_id !== user.id) {
          return new Response(JSON.stringify({ error: "gmail_already_personal_to_another_user", detail: "This address is already a teammate's private inbox. One mailbox belongs to one person — it cannot be re-owned from a different account." }), {
            status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
      }
      if (purpose === "inbox" && ownRow.mailbox_class === "shared_support") {
          return new Response(JSON.stringify({ error: "gmail_shared_connector_conflict", detail: "This address is the workspace's shared support mailbox. Connecting it as a personal inbox would hide it from the rest of the team — connect a different address, or ask the workspace owner to move the shared mailbox first." }), {
            status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
      }
    } else {
      // (2) Is this Gmail address already an email connector under ANOTHER tenant?
      //     The GLOBAL unique index would 500 the insert — instead, report it honestly.
      const { data: foreignRow, error: collisionReadError } = await admin
        .from("channel_connectors")
        .select("tenant_id")
        .eq("channel_type", "email")
        .eq("inbound_address", gmailAddr)
        .maybeSingle();
      const afterCollisionRead = await currentAuthority();
      if (!afterCollisionRead.ok) return refuseAuthority(afterCollisionRead);
      if (collisionReadError || (foreignRow && typeof foreignRow.tenant_id !== "string")) {
        return new Response(JSON.stringify({ error: "gmail_connector_lookup_failed" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (foreignRow) {
        return new Response(JSON.stringify({ error: foreignRow.tenant_id !== tenantId
          ? "gmail_already_connected_elsewhere" : "gmail_address_connector_conflict" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // The preflight above is only a readable early refusal. The native writer
    // rechecks under locks and commits the existing Vault + connector together.
    // A losing collision/policy transaction cannot overwrite the stable secret.
    const beforeVault = await currentAuthority();
    if (!beforeVault.ok) return refuseAuthority(beforeVault);
    nativeWriteAttempted = true;
    const { data: saved, error: saveError } = await admin.rpc("provision_gmail_connection", {
      _actor_user_id: user.id, _expected_tenant_id: tenantId, _google_account_id: accountId,
      _gmail_address: gmailAddr, _display_name: googleName, _purpose: purpose,
      _granted_scopes: grantedScopes, _refresh_token: String(tokenJson.refresh_token),
    });
    if (saveError) {
      const message = saveError.message ?? "";
      const conflict = saveError.code === "23505" || /GMAIL_(?:ADDRESS|PERSONAL_MAILBOX|SHARED_MAILBOX)_CONFLICT/.test(message);
      const authorityRefused = /GMAIL_(?:CONNECTION_FORBIDDEN|ACTOR_UNAVAILABLE|WORKSPACE_UNAVAILABLE|WORKSPACE_CHANGED|MAILBOX_POLICY_UNAVAILABLE)/.test(message);
      if (conflict || authorityRefused) return new Response(JSON.stringify({
        error: conflict ? "gmail_connection_conflict" : "workspace_changed", connection_saved: false,
        note: "Google consent returned, but this workspace did not save a connection. Refresh the workspace before trying again.",
      }), { status: conflict ? 409 : 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "gmail_connection_outcome_unknown", connection_saved: null,
        note: "The connection write could not be confirmed. Inspect the original workspace before reconnecting." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!saved || saved.ok !== true || saved.connection_saved !== true || saved.tenant_id !== tenantId
      || saved.gmail_address !== gmailAddr || typeof saved.connector_id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.connector_id)
      || typeof saved.reconnected !== "boolean"
      || !["personal", "shared_support"].includes(saved.mailbox_class)) return new Response(JSON.stringify({
        error: "gmail_connection_outcome_unknown", connection_saved: null,
        note: "The connection write could not be confirmed. Inspect the original workspace before reconnecting.",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    connectionSaved = true;

    /**
     * Evidence that this workspace granted Paige permission to send as a Google
     * account. It is the counterpart of the disconnect entry, and the pair is
     * what makes the grant's lifetime answerable at all.
     *
     * Placed AFTER native readback so it records a grant that actually
     * landed: every failure path above returns before reaching here, including
     * the two that report the address is already connected under another tenant.
     * `reconnected` distinguishes re-authorising an address this workspace
     * already held from granting one for the first time.
     *
     * The transaction returns the actual saved connector identity; even a first
     * connection now has an exact audit entity without another domain write.
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
    try {
      const { error: auditErr } = await admin.from("audit_logs").insert({
        user_id: user.id,
        entity: "gmail_connection",
        action: "comms:sending_account_connected",
        entity_id: saved.connector_id,
        data: {
          tenant_id: tenantId,
          address: gmailAddr,
          provider: "gmail",
          reconnected: saved.reconnected,
          // Actual returned grant, never a fallback to the requested scopes.
          scope: grantedScopes.join(" ") || null,
          purpose,
          mailbox_class: saved.mailbox_class,
        },
      });
      auditConfirmed = !auditErr;
      if (auditErr) console.error("[gmail-oauth-callback] audit write was not confirmed");
    } catch {
      console.error("[gmail-oauth-callback] audit write was not confirmed");
    }
    const beforeResult = await currentAuthority();
    if (!beforeResult.ok) return refuseAuthority(beforeResult);

    return new Response(
      JSON.stringify({ ok: true, connection_saved: true, audit_confirmed: auditConfirmed,
        gmail_address: gmailAddr, return_origin: parsed.r ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (nativeWriteAttempted) return new Response(JSON.stringify(connectionSaved ? {
      error: "gmail_connection_saved_result_withheld", connection_saved: true, audit_confirmed: auditConfirmed,
      note: "The connection was saved in the original workspace. Refresh that workspace before reconnecting.",
    } : { error: "gmail_connection_outcome_unknown", connection_saved: null,
      note: "The connection write could not be confirmed. Inspect the original workspace before reconnecting." }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    return new Response(JSON.stringify({ error: String((err as Error).message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
