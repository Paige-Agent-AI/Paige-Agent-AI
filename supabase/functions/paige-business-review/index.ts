// E2-6a — the business review seam for the owner-facing UI (Experience 02).
//
// A THIN TRANSPORT, never a second source of truth: the Solo Command Center's Business
// Intelligence surfaces call this edge, which runs the ONE fabric composer
// (`_shared/paige-context/business-review.ts` → composeBusinessReview) on the signed-in
// person's OWN session. Every figure, window note and not-available reason the UI renders
// comes from the same composer the chat tool `get_business_snapshot` uses; the issuer's own
// body re-proves workspace and the owner/admin seat on every read, so this edge holds no
// authority of its own and creates no parallel read path.
//
// WHAT IT DOES: verify_jwt is on (caller JWT required). The handler resolves the caller's
// user id and active workspace through their own client, bounds the optional request body
// (period / custom bounds / focus — the same vocabulary the chat tool accepts), and returns
// the composer's structured snapshot plus its bounded projection. The composer is total:
// every read failure lands inside the snapshot with a reason, so the only HTTP error paths
// are authentication and an unreadable body.
//
// WHAT IT NEVER DOES: no service-role client anywhere; no writes beyond the issuer's
// 15-minute evidence-reference bookkeeping; no approvals; no effectful execution (INT-346
// restrictions untouched); no caching — each request composes fresh (re-read discipline).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { composeBusinessReview } from "../_shared/paige-context/business-review.ts";
import { SNAPSHOT_PERIOD_KEYS, SNAPSHOT_DOMAINS } from "../_shared/paige-context/snapshot.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BODY_BYTES = 4_096;

/** Bounded parse of the optional request: unknown keys and oversized values are refused, never guessed. */
function parseRequest(body: unknown): { ok: true; request: { period?: string; timezone: string; customStart?: string; customEnd?: string; focus?: string[] } } | { ok: false; error: string } {
  if (body === undefined || body === null) return { ok: true, request: { timezone: "UTC" } };
  if (typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "The request body must be an object." };
  const args = body as Record<string, unknown>;
  if (Object.keys(args).some((k) => k !== "period" && k !== "custom_start" && k !== "custom_end" && k !== "focus" && k !== "timezone"))
    return { ok: false, error: "Only period, custom_start, custom_end, focus and timezone can be given." };
  const text = (v: unknown, max: number): string | null => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  let period: string | undefined;
  if (args.period !== undefined) {
    const p = text(args.period, 40);
    if (!p || !(SNAPSHOT_PERIOD_KEYS as readonly string[]).includes(p)) return { ok: false, error: "period must be one of: " + SNAPSHOT_PERIOD_KEYS.join(", ") + "." };
    period = p;
  }
  let timezone = "UTC";
  if (args.timezone !== undefined) {
    const tz = text(args.timezone, 80);
    if (!tz) return { ok: false, error: "timezone must be an IANA zone name." };
    timezone = tz; // the composer's period resolver refuses an unknown zone as invalid_timezone
  }
  let customStart: string | undefined;
  let customEnd: string | undefined;
  if (args.custom_start !== undefined) {
    const s = text(args.custom_start, 40);
    if (!s) return { ok: false, error: "custom_start must be a date or ISO instant." };
    customStart = s;
  }
  if (args.custom_end !== undefined) {
    const e = text(args.custom_end, 40);
    if (!e) return { ok: false, error: "custom_end must be a date or ISO instant." };
    customEnd = e;
  }
  let focus: string[] | undefined;
  if (args.focus !== undefined) {
    if (!Array.isArray(args.focus) || args.focus.length > 6) return { ok: false, error: "focus must be a list of at most 6 areas." };
    const words: string[] = [];
    for (const raw of args.focus) {
      const word = typeof raw === "string" ? raw.trim().slice(0, 40).toLowerCase() : "";
      if (!word || !(SNAPSHOT_DOMAINS as readonly string[]).includes(word)) return { ok: false, error: "focus entries must be known area names." };
      if (!words.includes(word)) words.push(word);
    }
    focus = words;
  }
  return { ok: true, request: { period, timezone, customStart, customEnd, focus } };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    // The caller's OWN session, mandatory: the issuer re-proves workspace, membership and the
    // owner/admin seat in its own body on every read. No service-role client exists here.
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let parsed: ReturnType<typeof parseRequest>;
    if (req.method === "POST" || req.method === "GET") {
      if (req.method === "POST") {
        const raw = await req.text();
        if (raw.length > MAX_BODY_BYTES) {
          return new Response(JSON.stringify({ error: "The request body is too large." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        parsed = parseRequest(raw.trim() ? JSON.parse(raw) : undefined);
      } else {
        parsed = parseRequest(undefined);
      }
    } else {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!parsed.ok) {
      return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // The workspace is read on the caller's own session — server-resolved, never a body arg.
    const scope = await supabaseClient.rpc("current_user_tenant_id");
    const tenantId = !scope.error && typeof scope.data === "string" && scope.data !== "" ? scope.data : null;

    const review = await composeBusinessReview(
      supabaseClient,
      // `who` is what this seam resolved; role/accountShape are not invented here (the issuer
      // decides authority), matching the chat dispatch's honest nulls.
      { actorId: user.id, tenantId, role: null, accountShape: null },
      { ...parsed.request, timezone: parsed.request.timezone },
    );

    // The composer is total: a bad period is the only ok:false; every read gap is in-snapshot.
    if (!review.ok) {
      return new Response(JSON.stringify({ ok: false, reason: review.reason }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, snapshot: review.snapshot, projection: review.projection }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // No internal error text leaves the edge.
    console.error("[paige-business-review] failed:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "The business review could not be read right now." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
