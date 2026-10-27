// backfill-welcome — one-off sender for the branded Paige welcome email to the
// accounts that were created before the welcome build shipped. Targets a FIXED
// internal recipient list (the owner's own company accounts) and is gated by a
// static token so it can't be drive-by triggered. Returns the SendGrid per-email
// result (X-Message-Id as `id`) so delivery is verifiable. Safe to remove once the
// backfill is done.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sendPlatformEmail } from "../_shared/email/platform-sendgrid.ts";

const EMAIL_FROM =
  Deno.env.get("PLATFORM_DEFAULT_EMAIL_FROM") ?? "Paige Agent AI <hello@paigeagent.ai>";
const PUBLIC_BASE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai").replace(/\/$/, "");
const GOLD = "#D4A752";
const INK = "#241645";
const LOGO_URL = `${PUBLIC_BASE}/pwa-512x512.png`;
const REPLY_TO = Deno.env.get("PLATFORM_SUPPORT_EMAIL") ?? "hello@paigeagent.ai";
const UNSUB_URL = `${PUBLIC_BASE}/unsubscribe`;
const TOKEN = "paige-welcome-backfill-2026";

const RECIPIENTS = [
  { email: "mrmogulmaker@gmail.com", name: "Mr. Mogul Maker" },
  { email: "mogulmakeracademy@gmail.com", name: "Mogul Maker Academy" },
  { email: "firststerlingcapital@gmail.com", name: "1st Sterling Capital" },
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function welcomeHtml(name: string): string {
  const hi = name ? `Welcome, ${esc(name)}.` : "Welcome to Paige.";
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
        <p style="color:#98a0ae;font-size:12px;margin:0 0 6px;">You're receiving this because you have a Paige Agent AI account.</p>
        <p style="color:#98a0ae;font-size:12px;margin:0;"><a href="${UNSUB_URL}" style="color:#98a0ae;">Unsubscribe</a></p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function welcomeText(name: string): string {
  const hi = name ? `Welcome, ${name}.` : "Welcome to Paige.";
  return [
    hi,
    "",
    "Your account is live. Paige is your team — she runs the follow-ups, onboarding, and the daily brief so you get your time back.",
    "",
    "One more step: name your workspace and tell Paige what you do.",
    `Set up your workspace: ${PUBLIC_BASE}/onboarding`,
    "",
    "You're receiving this because you have a Paige Agent AI account.",
    `Unsubscribe: ${UNSUB_URL}`,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  let token = url.searchParams.get("token") ?? "";
  if (!token && req.method === "POST") {
    try { token = (await req.json())?.token ?? ""; } catch { /* ignore */ }
  }
  if (token !== TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const r of RECIPIENTS) {
    const sent = await sendPlatformEmail({
      from: EMAIL_FROM,
      to: [r.email],
      replyTo: REPLY_TO,
      subject: "Welcome to Paige — your workspace is ready to build",
      html: welcomeHtml(r.name),
      text: welcomeText(r.name),
      headers: {
        "List-Unsubscribe": `<${UNSUB_URL}>, <mailto:unsubscribe@paigeagent.ai>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    // No key: the transport answers before any request, so nothing was sent to anyone.
    if (sent.error === "email_provider_not_configured") {
      return new Response(JSON.stringify({ ok: false, error: sent.error }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (sent.status === 0) {
      // No provider answer (unreachable/timeout) or a refused recipient/content.
      results.push({ email: r.email, ok: false, error: sent.error, unconfirmed: sent.unconfirmed });
    } else {
      results.push({ email: r.email, status: sent.status, ok: sent.ok, id: sent.id, error: sent.ok ? null : sent.error });
    }
  }

  return new Response(JSON.stringify({ ok: true, from: EMAIL_FROM, results }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
