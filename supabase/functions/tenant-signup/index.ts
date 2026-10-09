// tenant-signup — public front-door signup that creates a PRE-CONFIRMED account
// and sends a branded welcome email.
//
// Why this exists: Supabase Auth on this project requires email confirmation,
// but the confirmation-email delivery isn't wired yet (Task #52), so the normal
// auth.signUp path 500s ("Error sending confirmation email") and NO account is
// created. Per the owner's decision ("skip verification for now — build it"),
// we create the user with email_confirm:true via the service role so signup
// works immediately; the client then signs in and is routed into onboarding.
//
// The sign-up email is a WELCOME (not a verification link), sent through Resend
// with the same sender + brand styling the booking flow uses (§6 continuity).
// It's fire-and-forget: a mail failure never blocks account creation.
//
// To restore real email verification later: wire Auth SMTP (Resend), drop the
// email_confirm flag, and let auth.signUp send the confirmation link again.
import { createClient } from "npm:@supabase/supabase-js@2";
import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// --- Welcome email (Resend) -------------------------------------------------
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM =
  Deno.env.get("PLATFORM_DEFAULT_EMAIL_FROM") ?? "Paige Agent AI <hello@paigeagent.ai>";
const PUBLIC_BASE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai").replace(/\/$/, "");
const GOLD = "#D4A752";
const INK = "#241645";
const LOGO_URL = `${PUBLIC_BASE}/pwa-512x512.png`;
const REPLY_TO = Deno.env.get("PLATFORM_SUPPORT_EMAIL") ?? "hello@paigeagent.ai";
const UNSUB_URL = `${PUBLIC_BASE}/unsubscribe`;
const SMS_DISCLOSURE_VERSION = "paige-platform-account-service-v1-2026-08-31";

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function welcomeHtml(firstName: string): string {
  const hi = firstName ? `Welcome, ${esc(firstName)}.` : "Welcome to Paige.";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
  <body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your Paige account is live — set up your workspace.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 0;"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid #e7e8ec;border-radius:14px;overflow:hidden;">
      <tr><td style="background:${INK};padding:24px 32px;text-align:center;">
        <img src="${LOGO_URL}" alt="Paige Agent AI" width="46" height="46" style="display:inline-block;border-radius:11px;" />
        <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#c9b6f0;font-weight:bold;margin-top:10px;">Paige Agent AI</div>
      </td></tr>
      <tr><td style="padding:30px 32px 6px;">
        <h1 style="color:#101828;font-size:22px;margin:0 0 6px;">${hi}</h1>
        <p style="color:#475467;font-size:14px;line-height:1.6;margin:0 0 16px;">
          Your account is live. Paige is your team — she runs the follow-ups, onboarding, and the
          daily brief so you get your time back. One more step: name your workspace and tell Paige
          what you do, and she starts working.
        </p>
      </td></tr>
      <tr><td style="padding:2px 32px 26px;">
        <a href="${PUBLIC_BASE}/onboarding"
           style="display:inline-block;background:${GOLD};color:${INK};font-weight:bold;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:9999px;">
          Set up your workspace
        </a>
      </td></tr>
      <tr><td style="padding:16px 32px 26px;border-top:1px solid #eef0f3;">
        <p style="color:#98a0ae;font-size:12px;margin:0 0 6px;">You're receiving this because an account was created with this email at Paige Agent AI.</p>
        <p style="color:#98a0ae;font-size:12px;margin:0;"><a href="${UNSUB_URL}" style="color:#98a0ae;">Unsubscribe</a></p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function welcomeText(firstName: string): string {
  const hi = firstName ? `Welcome, ${firstName}.` : "Welcome to Paige.";
  return [
    hi,
    "",
    "Your account is live. Paige is your team — she runs the follow-ups, onboarding, and the daily brief so you get your time back.",
    "",
    "One more step: name your workspace and tell Paige what you do.",
    `Set up your workspace: ${PUBLIC_BASE}/onboarding`,
    "",
    "You're receiving this because an account was created with this email at Paige Agent AI.",
    `Unsubscribe: ${UNSUB_URL}`,
  ].join("\n");
}

async function sendWelcome(to: string, firstName: string): Promise<void> {
  if (!RESEND_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject: "Welcome to Paige — your workspace is ready to build",
        html: welcomeHtml(firstName),
        text: welcomeText(firstName),
        // Deliverability: a text/plain part + List-Unsubscribe are two of the
        // biggest inbox-placement signals for transactional mail.
        headers: {
          "List-Unsubscribe": `<${UNSUB_URL}>, <mailto:unsubscribe@paigeagent.ai>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
  } catch {
    /* email never blocks signup */
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, reason: "method", message: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "invalid", message: "Bad request." }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = body.fullName ? String(body.fullName).trim() : null;
  const referralCode = body.referralCode ? String(body.referralCode) : null;
  const marketingOptIn = body.marketingOptIn === true;
  const smsConsent = body.smsConsent === true;
  const phone = body.phone ? String(body.phone).trim() : "";
  const smsConsentSourceUrl = `${PUBLIC_BASE}/auth?mode=signup`;
  // A tenant's CUSTOMER accepting a portal invite already got the tenant's
  // branded invite email — suppress the platform (Paige) welcome so the
  // customer never sees the platform brand (§9).
  const suppressWelcome = body.suppressWelcome === true;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, reason: "invalid", message: "Enter a valid email address." });
  }
  if (password.length < 8) {
    return json({ ok: false, reason: "weak", message: "Password must be at least 8 characters." });
  }
  if (smsConsent && !/^\+[1-9]\d{7,14}$/.test(phone)) {
    return json({
      ok: false,
      reason: "invalid_phone",
      message: "Enter a valid mobile number with country code.",
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return json({ ok: false, reason: "server", message: "Server not configured." }, 500);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // pre-confirmed: no verification email needed to proceed
    user_metadata: {
      ...(fullName ? { full_name: fullName } : {}),
      ...(referralCode ? { referral_code: referralCode } : {}),
      consent_marketing: marketingOptIn,
    },
  });

  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return json({
        ok: false,
        reason: "exists",
        message: "An account with this email already exists — sign in instead.",
      });
    }
    return json({ ok: false, reason: "error", message: error.message || "Could not create your account." });
  }

  // SMS consent is optional, but a selected checkbox is not considered granted
  // until its complete evidence row is durable. If the evidence write fails, the
  // newly created account is removed so no partially-authorized signup survives.
  if (smsConsent && data.user?.id) {
    const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const requestIp = forwardedFor || req.headers.get("cf-connecting-ip") || null;
    const { error: consentError } = await admin.from("communications_consents").insert({
      user_id: data.user.id,
      email,
      phone,
      sms_transactional: true,
      sms_marketing: false,
      source: "signup",
      source_url: smsConsentSourceUrl,
      ip_address: requestIp,
      user_agent: req.headers.get("user-agent"),
      disclosure_version: SMS_DISCLOSURE_VERSION,
      consent_granted_at: new Date().toISOString(),
      revoked_at: null,
    });

    if (consentError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return json({
        ok: false,
        reason: "consent_evidence",
        message: "Your SMS consent could not be recorded. No account or SMS authorization was created. Please try again.",
      }, 500);
    }
  }

  // Sign-up email — the platform welcome, sent through Resend. Fire-and-forget.
  // Skipped for a client-invite signup (they got the tenant's branded invite).
  if (!suppressWelcome && await commsProviderExecutionAllowed(admin, { actorUserId: data.user?.id ?? null, recipientEmail: email })) {
    await sendWelcome(email, (fullName ?? "").split(/\s+/)[0] ?? "");
  }

  return json({ ok: true, user_id: data.user?.id ?? null });
});
