import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../_shared/comms-provider-boundary.ts";
// Starts Google OAuth for a tenant's Gmail SENDING connection (#141b).
// Returns { authorization_url } for the client to redirect to, or an honest
// { error: "gmail_oauth_not_configured" } degrade when the OAuth client isn't set.
//
// §18 REUSE: this clones the calendar OAuth start (google-calendar-oauth-start) —
// signState (HMAC-SHA256 over a nonce+user+timestamp+returnOrigin) and the
// allowedReturnOrigin anti-open-redirect allow-list are VERBATIM, and the state is
// signed with the SAME CALENDAR_ENCRYPTION_KEY the calendar flow uses (§14 cost-low:
// we reuse that HMAC key + GOOGLE_OAUTH_CLIENT_ID/SECRET rather than minting new
// secrets; the calendar callback and this callback never share a redirect_uri so the
// state audiences don't collide). verify_jwt=true (an authenticated admin caller).
//
// DIVERGENCE from calendar: the requested scope is gmail.send + userinfo.email —
// gmail.send is the MINIMUM for outbound; we deliberately do NOT request
// gmail.readonly/modify here (inbound sync is the separate follow-up #536).
//
// HONEST ACTIVATION NOTE (§13): going live requires owner-side Google Cloud console
// work — add the gmail.send scope to the OAuth consent screen, enable the Gmail API,
// register <origin>/auth/gmail/callback as an authorized redirect_uri, and complete
// Google's sensitive-scope verification. Until then the flow correctly degrades to
// gmail_oauth_not_configured (or Google rejects the scope at consent) — expected, not a bug.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readGmailConnectionAuthority } from "../_shared/gmail-connection-authority.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const enc = new TextEncoder();

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? enc.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// VERBATIM from google-calendar-oauth-start (§18) — state signed with CALENDAR_ENCRYPTION_KEY.
async function signState(payload: Record<string, unknown>): Promise<string> {
  const secret = Deno.env.get("CALENDAR_ENCRYPTION_KEY");
  if (!secret) throw new Error("CALENDAR_ENCRYPTION_KEY not configured");
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payloadPart)));
  return `${payloadPart}.${base64UrlEncode(sig)}`;
}

// VERBATIM from google-calendar-oauth-start (§18) — anti-open-redirect allow-list.
function allowedReturnOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const allowed =
      url.protocol === "http:" && host === "localhost" ||
      url.protocol === "https:" && (
        host === "paigeagent.ai" ||
        host === "www.paigeagent.ai" ||
        host === "app.paigeagent.ai"
      );
    return allowed ? url.origin : null;
  } catch {
    return null;
  }
}

// Reuse the calendar redirect-origin env override (or the request origin fallback).
function gmailRedirectOrigin(fallbackOrigin: string): string {
  return (Deno.env.get("CALENDAR_OAUTH_REDIRECT_ORIGIN") || fallbackOrigin).replace(/\/$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Connection management uses the same canonical current-workspace owner/admin
    // contract as SOLO Settings, callback and disconnect, not a global title role.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const authority = await readGmailConnectionAuthority(supa, admin, user.id, body.expected_tenant_id);
    if (!authority.ok) {
      return new Response(JSON.stringify({ error: authority.error }), {
        status: authority.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Honest config gate (§13/§31): no OAuth client → the Connect button gets a real
    // reason, never a dead redirect. Mirrors google-calendar-oauth-start.
    const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
    if (!clientId) {
      return new Response(JSON.stringify({ error: "gmail_oauth_not_configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = body.origin as string | undefined;
    const returnOrigin = origin ? allowedReturnOrigin(origin) : null;
    if (!returnOrigin) {
      return new Response(JSON.stringify({ error: "origin_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // #1140 two-mailbox pilot: purpose 'inbox' is the INCREMENTAL consent for a personal
    // read mailbox — the SAME flow, a WIDER (still least-privilege, still
    // permanent-delete-free) scope set. Anything else keeps the original sending consent.
    const purpose = body.purpose === "inbox" ? "inbox" : "send";

    const redirectUri = `${gmailRedirectOrigin(returnOrigin)}/auth/gmail/callback`;

    // The workspace the caller is STANDING IN, resolved server-side from their
    // verified JWT and carried in the SIGNED state (§9 — never a body field, and
    // the callback re-checks active membership before honouring it).
    //
    // Without this, a person who belongs to more than one tenant would connect
    // their mailbox to whichever workspace ranked first, not the one they were
    // looking at. `w`, not `t`: `t` is already this state's timestamp.
    const activeTenant = authority.tenantId;
    if (!await commsProviderExecutionAllowed(admin, { tenantId: activeTenant, actorUserId: user.id })) {
      return new Response(JSON.stringify({ error: COMMS_PROVIDER_EXECUTION_DISABLED }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const state = await signState({
      u: user.id,
      p: purpose,
      n: crypto.randomUUID(),
      t: Date.now(),
      r: returnOrigin,
      w: activeTenant,
    });
    const current = await readGmailConnectionAuthority(supa, admin, user.id, activeTenant);
    if (!current.ok) return new Response(JSON.stringify({ error: current.error }), {
      status: current.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      // gmail.send is the MINIMUM outbound scope (purpose 'send'). purpose 'inbox' (#1140)
      // asks for the personal-mailbox READ + reversible-organization set instead:
      // gmail.modify = every read/write EXCEPT immediate permanent deletion (the scope
      // itself refuses what the pilot refuses), gmail.labels = label management. The
      // granted set is recorded per connector so a later revoked scope refuses by column.
      scope: (purpose === "inbox" ? [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.labels",
        "https://www.googleapis.com/auth/userinfo.email",
      ] : [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email",
      ]).join(" "),
      access_type: "offline",   // needed to receive a refresh_token
      prompt: "consent",        // force the consent screen so a refresh_token is returned
      include_granted_scopes: "true",
      state,
    });

    const authorization_url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return new Response(JSON.stringify({ authorization_url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error).message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
