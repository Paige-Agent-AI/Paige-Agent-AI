import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
// send-portal-invite — emails a customer their branded invite to a tenant's
// client portal (roadmap #2). The token is minted by create_tenant_invite_token
// (admin-gated RPC) on the client; this function validates it server-side, reads
// the TENANT's brand (the tenant is inviting their own customer, so the email
// wears the tenant's brand, not Paige's — §6), and sends via Resend.
//
// Anti-relay: it only sends for a real, non-revoked, unexpired token, and only
// to the address that token was bound to at mint time (create_tenant_invite_token,
// admin-gated) — a token holder cannot spray arbitrary recipients.
import { createClient } from "npm:@supabase/supabase-js@2";
import { providerExecutionBlocked, QA_BOUNDARY_REFUSAL_NOTE, QA_NO_PROVIDER_EXECUTION_CODE } from "../_shared/inbox-intelligence/provider-boundary.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("PLATFORM_DEFAULT_EMAIL_FROM") ?? "Paige Agent AI <hello@paigeagent.ai>";
const PUBLIC_BASE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai").replace(/\/$/, "");

function json(d: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function textOn(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#FFFFFF";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1B1230" : "#FFFFFF";
}
// §6/§9: the email must wear the TENANT's brand, so the visible sender is the
// tenant's name — never "Paige Agent AI" — over the platform's verified domain.
// Strip anything that could break an RFC-5322 display-name / header-inject.
function senderFrom(tenantName: string, fallbackFrom: string): string {
  const addr = (fallbackFrom.match(/<([^>]+)>/)?.[1] ?? fallbackFrom).trim();
  const name = String(tenantName ?? "").replace(/[<>",\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return name ? `${name} <${addr}>` : fallbackFrom;
}

// Copy varies by who the invite is FOR (§6/§9/§3): a client is invited to their
// portal; a sub-account OWNER is handed the reins of their own workspace. The
// pixels (logo/accent/sender) are the agency's either way; only the words change.
function inviteCopy(kind: string, tenantName: string): { lead: string; cta: string; subject: string; textLead: string } {
  if (kind === "team") {
    return {
      subject: `${tenantName} invited you to join the team`,
      lead: `${esc(tenantName)} invited you to join their workspace team. Set up or sign in to your account to accept the invitation and see your workspace access.`,
      textLead: `${tenantName} invited you to join their workspace team.`,
      cta: "Join the team",
    };
  }
  if (kind === "subaccount_owner") {
    return {
      subject: `${tenantName} set up your workspace — take the reins`,
      lead: `${esc(tenantName)} set you up to run your own workspace. Set up your account to take the reins — your brand, your clients, your team, all yours to run.`,
      textLead: `${tenantName} set you up to run your own workspace. Set up your account to take the reins.`,
      cta: "Set up my account",
    };
  }
  return {
    subject: `${tenantName} invited you to your client portal`,
    lead: `${esc(tenantName)} invited you to your private client portal. It's where you'll work with the team, track your progress, and chat with your assistant — all in one place.`,
    textLead: `${tenantName} invited you to your private client portal.`,
    cta: "Open my portal",
  };
}

function inviteHtml(tenantName: string, accent: string, logo: string | null, joinUrl: string, firstName: string, kind: string): string {
  const on = textOn(accent);
  const hi = firstName ? `Hi ${esc(firstName)},` : "Hi there,";
  const { lead, cta } = inviteCopy(kind, tenantName);
  const header = logo
    ? `<img src="${esc(logo)}" alt="${esc(tenantName)}" height="40" style="max-height:40px;display:inline-block;" />`
    : `<div style="font-size:18px;font-weight:bold;color:#fff;">${esc(tenantName)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 0;"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid #e7e8ec;border-radius:14px;overflow:hidden;">
      <tr><td style="background:${esc(accent)};padding:24px 32px;text-align:center;">${header}</td></tr>
      <tr><td style="padding:30px 32px 6px;">
        <h1 style="color:#101828;font-size:21px;margin:0 0 8px;">${hi}</h1>
        <p style="color:#475467;font-size:14px;line-height:1.6;margin:0 0 18px;">
          ${lead}
        </p>
      </td></tr>
      <tr><td style="padding:2px 32px 28px;">
        <a href="${esc(joinUrl)}" style="display:inline-block;background:${esc(accent)};color:${on};font-weight:bold;font-size:14px;text-decoration:none;padding:13px 26px;border-radius:9999px;">
          ${esc(cta)}
        </a>
        <p style="color:#98a0ae;font-size:12px;margin:14px 0 0;word-break:break-all;">Or paste this link: ${esc(joinUrl)}</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: { token?: string; email?: string; first_name?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad request" }, 400); }
  const token = String(body.token ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const firstName = body.first_name ? String(body.first_name).trim() : "";
  if (!token || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "token and a valid email are required" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "server not configured" }, 500);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Validate the token, then resolve the brand up the parent chain (below).
  const { data: tok } = await admin
    .from("tenant_invite_tokens")
    // `id` is new here: it is the handle every later delivery event is matched back to. Without it
    // a webhook can prove an email was opened but not WHICH invitation it belonged to.
    .select("id, tenant_id, revoked_at, expires_at, email, kind")
    .eq("token", token)
    .maybeSingle();
  if (!tok || tok.revoked_at || new Date(tok.expires_at as string) <= new Date()) {
    return json({ ok: false, error: "invite is not valid" }, 400);
  }

  if (!(await commsProviderExecutionAllowed(admin, { tenantId: tok.tenant_id }))) {
    return json({ ok: false, emailed: false, status: "blocked", code: "COMMS_PROVIDER_EXECUTION_DISABLED" }, 403);
  }

  // Anti-relay: a token bound to a recipient at mint time can ONLY email that
  // address. This stops a token holder from POSTing arbitrary victim addresses
  // and having the platform emit tenant-branded links to them.
  const boundEmail = (tok.email as string | null)?.trim().toLowerCase() || null;
  if (boundEmail && boundEmail !== email) {
    return json({ ok: false, error: "this invite is bound to a different address" }, 400);
  }
  const recipient = boundEmail ?? email;

  // §6/§9: resolve the brand UP the parent chain so a sub-account invite wears its
  // AGENCY's logo + accent (not the child's empty stub, never Paige). The resolver
  // floors unset colors to the platform tokens (#150C31 / #EBB94C) — never a
  // one-off hex — and returns the child's OWN name as tenant_name.
  const { data: brandRows } = await admin.rpc("resolve_tenant_brand", { _tenant_id: tok.tenant_id });
    // QA #1832: a synthetic QA workspace's portal invite must not cause a real send.
    if (await providerExecutionBlocked(admin as never, tok.tenant_id)) {
      return new Response(JSON.stringify({ error: QA_NO_PROVIDER_EXECUTION_CODE, note: QA_BOUNDARY_REFUSAL_NOTE }), {
        status: 403, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
  const rb = (Array.isArray(brandRows) ? brandRows[0] : brandRows) as
    | { tenant_name?: string; primary_color?: string; logo_url?: string | null }
    | null;
  const accent = rb?.primary_color || "#150C31";
  const logoUrl = rb?.logo_url ?? null;
  const joinUrl = `${PUBLIC_BASE}/join/${token}`;
  const tenantName = rb?.tenant_name || "Your workspace";

  // §6/§9: send from the TENANT's own sending identity (their {slug}@ address or a
  // verified custom domain), not the platform's hello@ — so the client sees the
  // coach's brand end-to-end. Falls back to the tenant-name overlay on the platform
  // address if the identity can't be resolved.
  let fromHeader = senderFrom(tenantName, EMAIL_FROM);
  let replyTo: string | undefined;
  try {
    const { data: ident } = await admin.rpc("tenant_sender_identity", { _tenant_id: tok.tenant_id });
    const fromAddr = (ident as { from_address?: string } | null)?.from_address;
    const fromName = (ident as { from_name?: string } | null)?.from_name || tenantName;
    if (fromAddr) {
      const cleanName = String(fromName).replace(/[<>",\r\n]/g, " ").replace(/\s+/g, " ").trim();
      fromHeader = cleanName ? `${cleanName} <${fromAddr}>` : fromAddr;
      replyTo = (ident as { reply_to?: string } | null)?.reply_to || undefined;
    }
  } catch { /* keep the platform-address fallback */ }

  const kind = String((tok as { kind?: string }).kind ?? "consumer");
  const copy = inviteCopy(kind, tenantName);

  // THE LOG IS THE POINT, so it is written on every outcome — including the two where no email was
  // attempted at all. An invitation with no row against it is indistinguishable from one whose row
  // failed to write, and the operator deserves to be told "never sent" rather than shown a blank.
  const logSend = async (
    status: "sent" | "failed",
    messageId: string | null,
    detail: Record<string, unknown>,
  ) => {
    // Never allowed to break the send. A failure to RECORD an email is not a reason to fail an
    // email that already left, and this runs after the provider call precisely so it cannot.
    //
    // The failure must be LOUD, though, not silent. supabase-js does NOT throw on a database-level
    // insert failure (RLS, a constraint, a transient PostgREST error) — it resolves normally with a
    // returned `{ error }`. A bare `try/catch` around the `await` alone would never see that: it
    // only catches a thrown exception, which this call was never going to raise for that class of
    // failure. Swallowing it meant a genuinely-sent email could still leave zero rows against it,
    // silently — found by an independent review tracing this exact function while verifying an
    // unrelated documentation claim about it (§39), the same class of gap #856 closed in the
    // webhook's discarded `originError`.
    try {
      const { error } = await admin.from("email_send_log").insert({
        template_name: kind === "team" ? "team_invite" : "portal_invite",
        recipient_email: recipient,
        message_id: messageId,
        status,
        // The real column, not metadata. `email_send_log.tenant_id` already carries an RLS policy,
        // so scoping the row properly is what keeps one tenant's delivery data away from another's.
        tenant_id: (tok as { tenant_id?: string }).tenant_id ?? null,
        sender_account: "platform",
        metadata: { via: "send-portal-invite", invite_id: (tok as { id?: string }).id ?? null, kind, ...detail },
      });
      if (error) console.error("[send-portal-invite] logSend insert failed", error.message);
    } catch (e) {
      console.error("[send-portal-invite] logSend threw", e instanceof Error ? e.message : "unknown");
    }
  };

  if (!RESEND_KEY) {
    // Honest: nothing was attempted. Previously this returned `emailed: false` and wrote nothing,
    // so the screen could not tell "no provider configured" apart from "provider rejected it".
    await logSend("failed", null, { reason: "no_provider_configured" });
    return json({ ok: true, join_url: joinUrl, emailed: false, reason: "no_provider_configured" });
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromHeader,
        ...(replyTo ? { reply_to: replyTo } : {}),
        to: [recipient],
        subject: copy.subject,
        html: inviteHtml(tenantName, accent, logoUrl, joinUrl, firstName, kind),
        text: `${firstName ? `Hi ${firstName},` : "Hi there,"}\n\n${copy.textLead}\n\nOpen it: ${joinUrl}\n`,
      }),
    });
    // THE BODY WAS BEING THROWN AWAY. Resend answers with `{ id }`, and that id is the ONLY thing
    // a later delivered/opened/clicked webhook carries to identify this email. Discarding it is why
    // the platform could never say more than "the POST was accepted".
    const payload = await res.json().catch(() => ({}));
    const messageId = (payload as { id?: string })?.id ?? null;
    await logSend(res.ok ? "sent" : "failed", messageId, {
      http_status: res.status,
      ...(res.ok ? {} : { provider_error: (payload as { message?: string })?.message ?? null }),
    });
    return json({ ok: true, join_url: joinUrl, emailed: res.ok, messageId });
  } catch (e) {
    // A transport failure is not proof the email did not go. It is proof we do not know.
    await logSend("failed", null, { reason: "transport", detail: e instanceof Error ? e.message : "unknown" });
    return json({ ok: true, join_url: joinUrl, emailed: false, reason: "transport" });
  }
});
