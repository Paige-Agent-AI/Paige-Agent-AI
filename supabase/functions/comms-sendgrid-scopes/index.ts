// Safe, non-sending entitlement verification for the restricted SendGrid Mail
// Send executor credential (ANT-43/S7). GET /v3/scopes answers EXACTLY what the
// key may do — this function returns the scope list and nothing else: the key
// itself is read from env inside the edge runtime, never logged, never
// returned, and the ADMIN key is never touched here (CI-forbidden everywhere).
//
// Authority: platform operator only (JWT + is_platform_owner). Fail-closed: no
// key, no operator claim, provider error → error response, never a guessed
// scope list. This is a readiness check, not a send path.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return new Response("method_not_allowed", { status: 405 });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return new Response("unauthorized", { status: 401 });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const token = authHeader.slice(7);
  const { data: userData } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return new Response("unauthorized", { status: 401 });
  const { data: isOperator } = await admin.rpc("is_platform_owner", { _user_id: userId });
  if (isOperator !== true) return new Response("forbidden", { status: 403 });

  const key = Deno.env.get("SENDGRID_MAIL_SEND_API_KEY");
  if (!key) {
    return Response.json({ ok: false, reason: "SENDGRID_EXECUTOR_KEY_NOT_CONFIGURED" }, { status: 503, headers: cors });
  }
  try {
    const res = await fetch("https://api.sendgrid.com/v3/scopes", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      return Response.json({ ok: false, reason: `sendgrid_${res.status}` }, { status: 502, headers: cors });
    }
    const body = await res.json() as { scopes?: string[] };
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s) => typeof s === "string") : [];
    return Response.json({
      ok: true,
      scopes,
      // Readiness summary — the flags a platform operator actually needs:
      // can it send mail, and does it hold anything beyond mail-sending?
      can_send_mail: scopes.includes("mail.send"),
      non_sending_scopes: scopes.filter((s) => s !== "mail.send" && s !== "asm.groups.read" && s !== "api_keys.read"),
    }, { headers: cors });
  } catch (e) {
    return Response.json({ ok: false, reason: "scopes_check_failed" }, { status: 502, headers: cors });
  }
});
