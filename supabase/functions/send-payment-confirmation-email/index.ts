import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendPlatformEmail } from "../_shared/email/platform-sendgrid.ts";

// Billing / receipts — sends from billing@ through PAIGE's SendGrid transport, which moves a
// paigeagent.ai address onto mail.paigeagent.ai keeping the local part (owner ruling 2026-10-26).
const FROM = Deno.env.get("BILLING_EMAIL_FROM") ?? "Paige Agent AI <billing@paigeagent.ai>";
const APP_URL = "https://app.paigeagent.ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentConfirmationRequest {
  planName: string;
  amount: number;
  subscriptionEnd?: string;
}

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Payment confirmation email function invoked");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      console.error("Authentication error:", userError);
      throw new Error("User not authenticated");
    }

    const { planName, amount, subscriptionEnd }: PaymentConfirmationRequest = await req.json();
    console.log("Sending payment confirmation to:", user.email);

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .single();

    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount / 100);
    const name = esc(profile?.full_name || "there");
    const nextDate = subscriptionEnd
      ? new Date(subscriptionEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;

    const sent = await sendPlatformEmail({
      from: FROM,
      to: [user.email!],
      subject: "Payment confirmed — Paige Agent AI",
      html: `<!doctype html><html><head><meta charset="utf-8"></head>
        <body style="margin:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 0;"><tr><td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border:1px solid #e7e8ec;border-radius:16px;overflow:hidden;">
            <tr><td style="height:5px;background:linear-gradient(90deg,#EBB94C,#7A67E8);"></td></tr>
            <tr><td style="padding:32px 36px 8px;">
              <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#98a0ae;font-weight:bold;">Paige Agent AI</div>
              <h1 style="color:#101828;font-size:22px;margin:12px 0 4px;">Payment confirmed</h1>
              <p style="color:#475467;font-size:15px;line-height:1.6;margin:0 0 20px;">Thanks, ${name} — your subscription is active.</p>
              <div style="font-size:34px;font-weight:800;color:#101828;text-align:center;margin:8px 0 20px;">${formattedAmount}</div>
              <div style="background:#f7f8fa;border:1px solid #eef0f3;border-radius:10px;padding:18px 20px;margin:0 0 20px;font-size:14px;color:#344054;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:5px 0;color:#98a0ae;width:130px;">Plan</td><td style="padding:5px 0;font-weight:600;">${esc(planName)}</td></tr>
                  <tr><td style="padding:5px 0;color:#98a0ae;">Amount</td><td style="padding:5px 0;font-weight:600;">${formattedAmount}</td></tr>
                  ${nextDate ? `<tr><td style="padding:5px 0;color:#98a0ae;">Next billing date</td><td style="padding:5px 0;">${esc(nextDate)}</td></tr>` : ""}
                </table>
              </div>
              <p style="color:#475467;font-size:14px;line-height:1.6;margin:0 0 8px;">
                Your full workspace is unlocked — Paige is running your pipeline, follow-ups, onboarding,
                scheduling, and the daily brief.
              </p>
              <div style="text-align:center;margin:24px 0 8px;">
                <a href="${APP_URL}/app" style="display:inline-block;background:linear-gradient(90deg,#EBB94C,#F2CE77);color:#241645;font-weight:bold;text-decoration:none;padding:13px 30px;border-radius:999px;font-size:15px;">
                  Open your workspace
                </a>
              </div>
            </td></tr>
            <tr><td style="padding:18px 36px 28px;border-top:1px solid #eef0f3;">
              <p style="color:#98a0ae;font-size:12.5px;margin:0;">Manage your subscription anytime in account settings. Keep this email for your records — reply if anything looks off.</p>
            </td></tr>
          </table>
          <p style="color:#b3b8c2;font-size:11px;margin:16px 0 0;">© 2026 Paige Agent AI</p>
        </td></tr></table></body></html>`,
    }, { apiKey: Deno.env.get("SENDGRID_MAIL_SEND_API_KEY") ?? null });

    if (!sent.ok) {
      // A 5xx/timeout/throw is UNCONFIRMED: SendGrid may have accepted it, so it is neither "sent" nor a
      // plain failure to resend. The receipt is not retried here either way.
      console.error("Payment confirmation email not accepted:", sent.error, sent.unconfirmed ? "(unconfirmed)" : "");
      return new Response(JSON.stringify({
        success: false,
        error: sent.unconfirmed ? "email_unconfirmed" : sent.error,
        unconfirmed: sent.unconfirmed,
        data: { data: null, error: { message: sent.error } },
      }), { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
    console.log("Payment confirmation email accepted by SendGrid:", sent.id);

    // `data` keeps the shape the Resend SDK returned ({ data: { id }, error }); the id is SendGrid's X-Message-Id.
    return new Response(JSON.stringify({ success: true, data: { data: { id: sent.id }, error: null } }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-payment-confirmation-email function:", error);
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
