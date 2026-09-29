// growth-public-submit — the ONE way a visitor's answers reach a growth form, for every business.
//
// Public (verify_jwt = false): visitors are anonymous. Before anything is written it checks, in order:
//   1. origin    — the platform's own domain, a business subdomain, or this project's preview deploys
//   2. bot trap  — a filled hidden field, or a submission faster than a person can type, is dropped
//                  with an ordinary 200 so a bot learns nothing
//   3. rate      — per visitor IP and per form, on the shared durable limiter (_shared/rateLimit.ts)
//   4. the form  — must exist and be ACTIVE; its business comes from the form row, never the request
//   5. content   — only the form's own fields, each in the shape its field type allows
//                  (_shared/growth-intake.ts); unknown and invalid keys are dropped and reported back
// The row is written with the service role, so nothing the browser sends can set tenant_id,
// contact_id, deal_id or processing state. The AFTER INSERT trigger hands it to
// growth-process-submission, which creates the lead, attaches the deal and sends the owner's alert.
//
// Replaces the browser's direct insert into growth_form_submissions (revoked in
// 20270518000000_public_form_intake.sql).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { overRateLimit, trustedClientIp } from "../_shared/rateLimit.ts";
import { isAllowedOrigin, looksLikeBot, sanitizeAnswers, sanitizeUtm } from "../_shared/growth-intake.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/i;
const MAX_BODY_BYTES = 64 * 1024;
const PER_IP_PER_MINUTE = 10;
const PER_FORM_PER_MINUTE = 60;

function corsFor(origin: string | null): Record<string, string> {
  return {
    ...(origin && isAllowedOrigin(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsFor(origin);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: isAllowedOrigin(origin) ? 204 : 403, headers: cors });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  // 1. Origin.
  if (!isAllowedOrigin(origin)) return reply({ error: "origin_not_allowed" }, 403);

  // Body, size-capped before parsing.
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return reply({ error: "too_large" }, 413);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = JSON.parse(text); } catch { return reply({ error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object") return reply({ error: "invalid_json" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // 2. Bot trap — accepted-looking, never written.
  if (looksLikeBot(body.hp, body.elapsed_ms)) {
    console.warn("growth-public-submit: bot trap", { origin });
    return reply({ ok: true });
  }

  // 3. Rate limit per visitor. (Per form once the form is known.)
  const ip = trustedClientIp(req);
  if (await overRateLimit(admin, `gps:ip:${ip}`, PER_IP_PER_MINUTE)) {
    return reply({ error: "rate_limited" }, 429);
  }

  // 4. Resolve the form: by id, by (tenant id, slug), or by (workspace slug, form slug).
  let formQuery = admin
    .from("growth_forms")
    .select("id, tenant_id, status, schema_json, success_action_json");
  if (typeof body.form_id === "string" && UUID_RE.test(body.form_id)) {
    formQuery = formQuery.eq("id", body.form_id);
  } else if (typeof body.tenant_id === "string" && UUID_RE.test(body.tenant_id) && typeof body.slug === "string" && SLUG_RE.test(body.slug)) {
    formQuery = formQuery.eq("tenant_id", body.tenant_id).eq("slug", body.slug);
  } else if (typeof body.workspace === "string" && SLUG_RE.test(body.workspace) && typeof body.form === "string" && SLUG_RE.test(body.form)) {
    const { data: tenant } = await admin.from("tenants").select("id").eq("slug", body.workspace).maybeSingle();
    if (!tenant?.id) return reply({ error: "form_not_found" }, 404);
    formQuery = formQuery.eq("tenant_id", tenant.id).eq("slug", body.form);
  } else {
    return reply({ error: "form_required" }, 400);
  }
  const { data: form, error: formErr } = await formQuery.maybeSingle();
  if (formErr) {
    console.error("growth-public-submit: form lookup failed", formErr.message);
    return reply({ error: "lookup_failed" }, 500);
  }
  if (!form || form.status !== "active") return reply({ error: "form_not_found" }, 404);

  if (await overRateLimit(admin, `gps:form:${form.id}`, PER_FORM_PER_MINUTE)) {
    return reply({ error: "rate_limited" }, 429);
  }

  // 5. Only the form's own fields.
  const { answers, unknownKeys, invalidKeys, missingRequired } = sanitizeAnswers(form.schema_json, body.answers);
  if (missingRequired.length > 0 || invalidKeys.length > 0) {
    return reply({ error: "invalid_answers", missing_required: missingRequired, invalid: invalidKeys }, 422);
  }
  if (Object.keys(answers).length === 0) return reply({ error: "no_answers" }, 422);

  const referrer = (req.headers.get("referer") ?? "").slice(0, 500) || null;
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 500) || null;

  const { data: row, error: insErr } = await admin
    .from("growth_form_submissions")
    .insert({
      form_id: form.id,
      tenant_id: form.tenant_id,
      payload_json: answers,
      utm_json: sanitizeUtm(body.utm),
      consent_json: {},
      source: "paige_form",
      referrer,
      user_agent: userAgent,
    })
    .select("id")
    .single();
  if (insErr || !row) {
    console.error("growth-public-submit: insert failed", insErr?.message);
    return reply({ error: "not_saved" }, 500);
  }

  return reply({
    ok: true,
    submission_id: row.id,
    success_action: form.success_action_json ?? null,
    // Keys the form does not have were not saved; the caller should surface this loudly.
    ...(unknownKeys.length ? { ignored_keys: unknownKeys } : {}),
  });
});
