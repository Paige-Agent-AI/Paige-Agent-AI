// Platform-staff invite email (God tier). Owner-gated: mints a platform_admin
// invite and emails the /join-platform link, branded as Paige Agent AI (a
// platform-originated email — NOT a tenant email, so it wears the platform brand).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPlatformEmail } from "../_shared/email/platform-sendgrid.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const FROM = "Paige Agent AI <team@paigeagent.ai>";

function inviteHtml(link: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0B0912;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0912;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#14101F;border:1px solid rgba(201,184,232,0.14);border-radius:16px;overflow:hidden;">
        <tr><td style="height:4px;background:linear-gradient(90deg,#EBB94C,#7A67E8);"></td></tr>
        <tr><td style="padding:32px 32px 8px;text-align:center;">
          <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#EBB94C;font-weight:bold;">Paige Agent AI</div>
          <h1 style="color:#EDE8F6;font-size:22px;margin:14px 0 6px;">You're invited to the team</h1>
          <p style="color:#A79EC2;font-size:14px;line-height:1.6;margin:0 0 24px;">
            You've been invited as a <strong style="color:#EDE8F6;">Platform Admin</strong>. Create your account
            with this email to help run the platform.
          </p>
          <a href="${link}" style="display:inline-block;background:linear-gradient(90deg,#EBB94C,#F2CE77);color:#1B1230;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;">
            Accept your invite
          </a>
          <p style="color:#766E90;font-size:12px;line-height:1.6;margin:24px 0 0;">
            If the button doesn't work, paste this link into your browser:<br>
            <span style="color:#A79EC2;word-break:break-all;">${link}</span>
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;text-align:center;border-top:1px solid rgba(201,184,232,0.1);">
          <p style="color:#766E90;font-size:11px;margin:0;">This invite expires in 14 days. If you weren't expecting it, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    // Caller-scoped client so create_platform_invite's owner check applies to THEM.
    const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const origin = String(body?.origin ?? "https://paigeagent.ai").replace(/\/+$/, "");
    if (!email || !email.includes("@")) return json({ error: "A valid email is required." }, 400);

    const { data: isOwner } = await user.rpc("is_platform_owner");
    if (isOwner !== true) return json({ error: "Owner privileges required." }, 403);

    // Mint the invite (self-gated to the owner).
    const { data: invite, error: invErr } = await user.rpc("create_platform_invite", { _email: email });
    if (invErr) return json({ error: invErr.message }, 400);
    const token = (invite as { token?: string })?.token;
    if (!token) return json({ error: "Could not create invite." }, 500);

    const link = `${origin}/join-platform?token=${token}`;

    // Send the Paige Agent AI-branded email through SendGrid. With no key the transport
    // answers email_provider_not_configured before any request: nothing sent, nothing logged.
    let emailed = false;
    const sent = await sendPlatformEmail({
      from: FROM,
      to: [email],
      subject: "You're invited to the Paige Agent AI team",
      html: inviteHtml(link),
      categories: ["platform_invite"],
    });
    if (sent.error !== "email_provider_not_configured") {
      emailed = sent.ok;
      const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await admin.from("email_send_log").insert({
        template_name: "platform_invite",
        recipient_email: email,
        message_id: sent.id,
        status: sent.ok ? "sent" : "failed",
        sender_account: "platform",
        metadata: { via: "send-platform-invite", status: sent.status },
      }).then(() => {}, () => {});
    }

    // Always return the link so the owner can share it manually if email is off.
    return json({ ok: true, token, link, emailed });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
