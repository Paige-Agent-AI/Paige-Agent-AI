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
import type { BusinessReviewWho } from "../_shared/paige-context/business-review.ts";
import { dispatchBusinessSnapshotChat } from "../_shared/paige-context/business-review-chat.ts";
import { SNAPSHOT_PERIOD_KEYS, SNAPSHOT_DOMAINS } from "../_shared/paige-context/snapshot.ts";
import { readCalendarAccountShape, type CalendarBookingReadCaller } from "../_shared/calendar-booking-read.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BODY_BYTES = 4_096;
type IdentityReply = { data: unknown; error: unknown };
type ReviewIdentityCaller = Pick<CalendarBookingReadCaller, 'auth'> & {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<IdentityReply> & {
    abortSignal(signal: AbortSignal): PromiseLike<IdentityReply>;
  };
  // The original SDK table selector is not awaitable until select() is called.
  from(table: 'tenants'): unknown;
};

/** Resolve metadata from the original caller-native authority, never from body/headers or a
 * global app role. Each domain STILL re-proves its own read authority. An unconfirmed identity
 * stays unresolved, preserving the existing total/partial review rather than inventing access. */
async function resolveReviewWho(caller: ReviewIdentityCaller, actorId: string, tenantId: string | null,
  requestSignal: AbortSignal): Promise<BusinessReviewWho> {
  const unresolved: BusinessReviewWho = { actorId, tenantId, role: null, accountShape: null };
  if (!tenantId || requestSignal.aborted) return unresolved;
  const controller = new AbortController(), stop = () => controller.abort();
  requestSignal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, 2_000);
  const expired = new Promise<BusinessReviewWho>(resolve => controller.signal.addEventListener('abort', () => resolve(unresolved), { once: true }));
  const lookup = async (): Promise<BusinessReviewWho> => {
    try {
      // Preserve original SDK builders/binding. The incumbent Calendar classification helper
      // owns its minimal caller-visible row validation and the canonical SOLO predicate.
      const originalTable = caller.from.bind(caller);
      const classificationCaller: CalendarBookingReadCaller = { auth: caller.auth,
        rpc: (name, args) => caller.rpc(name, args) as ReturnType<CalendarBookingReadCaller['rpc']>,
        from(table) {
          const builder = originalTable(table);
          if (!builder || typeof builder !== 'object' || !('select' in builder) || typeof builder.select !== 'function')
            throw new Error('classification_reader_unavailable');
          // The incumbent helper only calls select() on this initial selector;
          // retain its original SDK filter/abort chain rather than fabricating a Promise.
          return builder as ReturnType<CalendarBookingReadCaller['from']>;
        } };
      const [shape, owner, admin] = await Promise.all([
        readCalendarAccountShape(classificationCaller, tenantId, controller.signal),
        caller.rpc('has_tenant_role', { _user_id: actorId, _tenant_id: tenantId, _role: 'owner' }).abortSignal(controller.signal),
        caller.rpc('has_tenant_role', { _user_id: actorId, _tenant_id: tenantId, _role: 'admin' }).abortSignal(controller.signal),
      ]);
      if (controller.signal.aborted || shape.status !== 'available' || owner.error || admin.error) return unresolved;
      const [scope, actor] = await Promise.all([
        caller.rpc('current_user_tenant_id').abortSignal(controller.signal), caller.auth.getUser(),
      ]);
      if (controller.signal.aborted || scope.error || scope.data !== tenantId || actor.error || actor.data.user?.id !== actorId) return unresolved;
      return { actorId, tenantId, role: owner.data === true ? 'owner' : admin.data === true ? 'admin' : null,
        accountShape: shape.accountShape };
    } catch { return unresolved; }
  };
  try { return await Promise.race([lookup(), expired]); }
  finally { clearTimeout(timer); requestSignal.removeEventListener('abort', stop); controller.abort(); }
}

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

    const chat = new URL(req.url).searchParams.get('chat') === '1';
    let chatArgs: unknown = {};
    let parsed: ReturnType<typeof parseRequest>;
    if (req.method === "POST" || req.method === "GET") {
      if (req.method === "POST") {
        const raw = await req.text();
        if (raw.length > MAX_BODY_BYTES) {
          return new Response(JSON.stringify({ error: "The request body is too large." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const body = raw.trim() ? JSON.parse(raw) : undefined;
        if (chat) {
          if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body)))
            return new Response(JSON.stringify({ error: 'The request body must be an object.' }), { status: 400, headers: corsHeaders });
          const { timezone, ...toolArgs } = body ?? {};
          chatArgs = toolArgs;
          // The existing Chat parser owns tool vocabulary/aliases and its honest
          // needs_input response. The web parser still owns time-zone validation.
          parsed = parseRequest({ timezone });
        } else parsed = parseRequest(body);
      } else {
        parsed = parseRequest(undefined);
      }
    } else {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!parsed.ok) {
      return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Per-user rate limit (the review's P2, the chat seam's own pattern): each call costs
    // ~12-20 issuer RPCs, so the same 20/min/user bound the chat path enforces applies here.
    const { data: rateLimitCheck } = await supabaseClient.rpc("check_rate_limit", {
      _user_id: user.id,
      _function_name: "paige-business-review",
      _max_requests: 20,
      _window_minutes: 1,
    });
    if (rateLimitCheck === false) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" } },
      );
    }

    // The workspace is read on the caller's own session — server-resolved, never a body arg.
    const scope = await supabaseClient.rpc("current_user_tenant_id");
    const tenantId = !scope.error && typeof scope.data === "string" && scope.data !== "" ? scope.data : null;

    if (chat && (!tenantId || req.headers.get('x-paige-review-scope') !== tenantId))
      return new Response(JSON.stringify({ error: 'The original business workspace could not be verified.' }), { status: 403, headers: corsHeaders });
    const who = await resolveReviewWho({ auth: supabaseClient.auth,
      rpc: (name, args) => supabaseClient.rpc(name, args), from: supabaseClient.from.bind(supabaseClient),
    }, user.id, tenantId, req.signal);

    if (chat) {
      // A binding assertion, never authority. A workspace switch must refuse
      // before any composer/issuer read, not merely hide its eventual response.
      const result = await dispatchBusinessSnapshotChat(
        { who, timezone: parsed.request.timezone },
        { caller: supabaseClient }, chatArgs,
      );
      const after = await supabaseClient.rpc('current_user_tenant_id');
      if (after.error || after.data !== tenantId)
        return new Response(JSON.stringify({ error: 'The original business workspace could not be verified.' }), { status: 403, headers: corsHeaders });
      return new Response(JSON.stringify({ version: 1, actor_id: user.id, tenant_id: tenantId,
        timezone: parsed.request.timezone, result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    const review = await composeBusinessReview(
      supabaseClient,
      // Original native membership/classification only; each source still decides current authority.
      who,
      { ...parsed.request, timezone: parsed.request.timezone },
      // Additive response negotiation on this existing endpoint. Old web tabs
      // omit the marker and keep their original closed snapshot shape. Old Edge
      // versions ignore the query, so the new web can also read their response.
      { financeEvidence: new URL(req.url).searchParams.get('finance_sources') === '1' },
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
