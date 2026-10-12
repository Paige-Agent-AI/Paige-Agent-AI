// growth-public-visit — the ONE way a visit to a business's published page, live funnel or standalone form is
// recorded (INT-298 MBC 7a; contract docs/delivery/public-visit-evidence-contract.md).
//
// Public (verify_jwt = false): visitors are anonymous. In order, before anything is written:
//   1. origin    — the platform's own domain or a business subdomain (HTTPS), as growth-public-submit
//   2. privacy   — Do Not Track or Global Privacy Control: not recorded, answered 200 { recorded: false }
//   3. agents    — a known automated agent, or none named: not recorded the same way (crawlers, link previews,
//                  headless browsers, which includes PAIGE's own page screenshots)
//   4. rate      — per visitor IP and per target, on the shared durable limiter; fails CLOSED: if the limiter
//                  cannot answer, nothing is recorded
//   5. the visit — growth_public_visit_record decides the business from the target row (never the request),
//                  requires the target to be public now and the business live, and continues a visit only for the
//                  same target within 30 idle minutes
// The browser keeps nothing but the returned visit token, which growth-public-submit may later link a submission to.
// No IP, user agent or cookie is stored; only the referring host and the link's campaign tags.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { overRateLimit, trustedClientIp } from "../_shared/rateLimit.ts";
import { isAllowedOrigin, sanitizeUtm } from "../_shared/growth-intake.ts";
import { notRecordedReason, parseVisitRequest, referrerHost } from "../_shared/growth-visit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BODY_BYTES = 4 * 1024;
const PER_IP_PER_MINUTE = 60;
// Per page, funnel or form: caps how fast any one target's count can be inflated from many addresses.
const PER_TARGET_PER_MINUTE = 300;

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

  // 2–3. Privacy signals and automated agents are answered, never recorded.
  const skip = notRecordedReason(req.headers);
  if (skip) return reply({ recorded: false, reason: skip });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ error: "too_large" }, 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return reply({ error: "too_large" }, 413);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({ error: "invalid_json" }, 400); }
  const visit = parseVisitRequest(body);
  if (!visit) return reply({ error: "invalid_visit" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // 4. Rate limit per visitor; a limiter that cannot answer records nothing.
  if (await overRateLimit(admin, `gpv:ip:${trustedClientIp(req)}`, PER_IP_PER_MINUTE, 60, true)
    || await overRateLimit(admin, `gpv:target:${visit.kind}:${visit.targetId}`, PER_TARGET_PER_MINUTE, 60, true)) {
    return reply({ recorded: false, reason: "rate_limited" }, 429);
  }

  // 5. The visit.
  const { data, error } = await admin.rpc("growth_public_visit_record", {
    p_kind: visit.kind,
    p_target_id: visit.targetId,
    p_visit_token: visit.token,
    p_step: visit.step,
    p_utm: sanitizeUtm(body.utm),
    p_referrer_host: referrerHost(body.referrer),
  });
  if (error) {
    if (/PUBLIC_VISIT_TARGET_UNAVAILABLE/.test(error.message ?? "")) return reply({ recorded: false, reason: "not_public" }, 404);
    console.error("growth-public-visit: record failed", error.message);
    return reply({ recorded: false, reason: "not_saved" }, 500);
  }
  const token = (data as { visit_token?: unknown } | null)?.visit_token;
  if (typeof token !== "string") {
    console.error("growth-public-visit: the writer returned no visit token");
    return reply({ recorded: false, reason: "not_saved" }, 500);
  }
  return reply({ recorded: true, token, started: (data as { started?: unknown }).started === true });
});
