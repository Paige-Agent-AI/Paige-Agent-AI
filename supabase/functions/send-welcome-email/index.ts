import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendPlatformEmail } from "../_shared/email/platform-sendgrid.ts";

// Welcome / onboarding email — sends from hello@ through PAIGE's SendGrid transport, which moves a
// paigeagent.ai address onto mail.paigeagent.ai keeping the local part (owner ruling 2026-10-26).
const FROM = Deno.env.get("WELCOME_EMAIL_FROM") ?? "Paige Agent AI <hello@paigeagent.ai>";
const APP_URL = "https://app.paigeagent.ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WelcomeEmailRequest {
  fullName: string;
  email: string;
  goals?: string[];
}

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Welcome email function invoked");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      console.error("Authentication error:", userError);
      throw new Error("User not authenticated");
    }

    const { fullName, email }: WelcomeEmailRequest = await req.json();
    console.log("Sending welcome email to:", email);
    const name = esc(fullName || "there");

    const sent = await sendPlatformEmail({
      from: FROM,
      to: [email],
      subject: "Welcome to Paige Agent AI",
      html: `<!doctype html><html><head><meta charset="utf-8"></head>
        <body style="margin:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 0;"><tr><td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border:1px solid #e7e8ec;border-radius:16px;overflow:hidden;">
            <tr><td style="height:5px;background:linear-gradient(90deg,#EBB94C,#7A67E8);"></td></tr>
            <tr><td style="padding:32px 36px 8px;">
              <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#98a0ae;font-weight:bold;">Paige Agent AI</div>
              <h1 style="color:#101828;font-size:23px;margin:12px 0 6px;">Welcome, ${name}.</h1>
              <p style="color:#475467;font-size:15px;line-height:1.65;margin:0 0 18px;">
                You just hired Paige. She runs the parts of your coaching practice you used to dread —
                client management, follow-ups, onboarding, scheduling, and the daily brief — so you get
                your time back and every client feels looked after.
              </p>
              <div style="background:#faf7ef;border-left:4px solid #EBB94C;border-radius:8px;padding:18px 20px;margin:18px 0;">
                <div style="font-size:13px;font-weight:700;color:#101828;margin-bottom:10px;">Get started in three moves</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#344054;line-height:1.6;">
                  <tr><td style="padding:4px 0;"><strong>1. Set up your workspace</strong> — your brand, voice, and the way you work.</td></tr>
                  <tr><td style="padding:4px 0;"><strong>2. Connect your calendar</strong> — Paige books, confirms, and reminds for you.</td></tr>
                  <tr><td style="padding:4px 0;"><strong>3. Let Paige take the first pass</strong> — she drafts your follow-ups and welcome sequences for your approval.</td></tr>
                </table>
              </div>
              <div style="text-align:center;margin:26px 0 8px;">
                <a href="${APP_URL}/app" style="display:inline-block;background:linear-gradient(90deg,#EBB94C,#F2CE77);color:#241645;font-weight:bold;text-decoration:none;padding:13px 30px;border-radius:999px;font-size:15px;">
                  Open your workspace
                </a>
              </div>
            </td></tr>
            <tr><td style="padding:18px 36px 28px;border-top:1px solid #eef0f3;">
              <p style="color:#98a0ae;font-size:12.5px;margin:0;">Questions? Just reply to this email — it comes straight to the team.</p>
            </td></tr>
          </table>
          <p style="color:#b3b8c2;font-size:11px;margin:16px 0 0;">© 2026 Paige Agent AI</p>
        </td></tr></table></body></html>`,
    }, { apiKey: Deno.env.get("SENDGRID_MAIL_SEND_API_KEY") ?? null });

    if (sent.ok) console.log("Welcome email accepted by SendGrid:", sent.id);
    else console.error("Welcome email not accepted:", sent.error, sent.unconfirmed ? "(unconfirmed)" : "");

    // Create in-app notification (coaching-only).
    const { error: notifError } = await supabaseClient
      .from("notifications")
      .insert({
        user_id: user.id,
        type: "welcome",
        title: "Welcome to Paige Agent AI",
        message: `Hi ${fullName || "there"} — Paige is ready. Open your workspace to set up your brand and let her take the first pass at your follow-ups.`,
        action_url: "/app",
      });

    if (notifError) {
      console.error("Error creating notification:", notifError);
    }

    if (!sent.ok) {
      // A 5xx/timeout/throw is UNCONFIRMED: SendGrid may have accepted it, so it is neither "sent" nor a
      // plain failure to resend. The in-app welcome above is written either way.
      return new Response(JSON.stringify({
        success: false,
        error: sent.unconfirmed ? "email_unconfirmed" : sent.error,
        unconfirmed: sent.unconfirmed,
        data: { data: null, error: { message: sent.error } },
      }), { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // `data` keeps the shape the Resend SDK returned ({ data: { id }, error }); the id is SendGrid's X-Message-Id.
    return new Response(JSON.stringify({ success: true, data: { data: { id: sent.id }, error: null } }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-welcome-email function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
