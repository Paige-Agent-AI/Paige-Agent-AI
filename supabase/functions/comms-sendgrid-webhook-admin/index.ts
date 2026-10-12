// Operator-only SendGrid Event Webhook administration (ANT-78/S7.3).
//
// The owner's preferred AUTOMATED configuration path, inside the existing
// Communications control plane. Platform Operator only (JWT + is_platform_owner).
// GET  ?action=inspect  — read-only current webhook state (no keys).
// POST {action:"prepare"} — inspect -> reuse-or-configure the approved PAIGE
//   receiver with signature verification ON and delivery DISABLED, then return
//   the verification public key ONCE for installation as
//   SENDGRID_WEBHOOK_PUBLIC_KEY. NEVER enables delivery.
// The scoped webhook-admin credential (SENDGRID_WEBHOOK_ADMIN_API_KEY) is read
// from env, never logged, never returned; the Mail Send executor key and the
// full-access admin key are never read here (CI-guarded).
import { createClient } from "npm:@supabase/supabase-js@2";
import { inspectWebhook, prepareSignedDisabledWebhook } from "../_shared/comms-email/sendgrid-webhook-admin.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const action = req.method === "GET" ? (url.searchParams.get("action") ?? "inspect") : null;
  if (req.method !== "GET" && req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return new Response("unauthorized", { status: 401 });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: userData } = await admin.auth.getUser(authHeader.slice(7));
  const userId = userData?.user?.id;
  if (!userId) return new Response("unauthorized", { status: 401 });
  const { data: isOperator } = await admin.rpc("is_platform_owner", { _user_id: userId });
  if (isOperator !== true) return new Response("forbidden", { status: 403 });

  const key = Deno.env.get("SENDGRID_WEBHOOK_ADMIN_API_KEY");
  if (!key) {
    return Response.json({ ok: false, reason: "SENDGRID_WEBHOOK_ADMIN_API_KEY_NOT_CONFIGURED" }, { status: 503, headers: cors });
  }
  const fetchImpl: typeof fetch = (input: unknown, init?: RequestInit) => fetch(input as string, init ?? {});

  try {
    if (req.method === "GET" || action === "inspect") {
      const settings = await inspectWebhook(fetchImpl, key);
      // Truthful state report; no keys, no credentials.
      return Response.json({ ok: true, settings }, { headers: cors });
    }
    let body: { action?: string } = {};
    try { body = await req.json(); } catch { /* handled below */ }
    if (body.action !== "prepare") return new Response("bad_request", { status: 400 });
    const result = await prepareSignedDisabledWebhook(fetchImpl, key);
    return Response.json({
      ok: true,
      action: result.action,
      settings: result.settings,
      // Returned ONCE for the operator to install; never logged server-side.
          verification_public_key: result.publicKeyPem,
      next_step: "install_as_SENDGRID_WEBHOOK_PUBLIC_KEY_then_verify_with_console_test_event",
    }, { headers: cors });
  } catch (e) {
    const message = (e as Error).message ?? "";
    console.error("[comms-sendgrid-webhook-admin] operation_failed", message.slice(0, 200));
    return Response.json({ ok: false, reason: message.slice(0, 200) || "operation_failed" }, { status: 502, headers: cors });
  }
});
