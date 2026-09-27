// ingest-rag-outcome
// ----------------------------------------------------------------------
// Generates anonymized rag_documents from platform events:
//   trigger="funding_funded"     → outcome_case  (funding success)
//   trigger="funding_denied"     → denial_pattern
//   trigger="score_milestone"    → credit_strategy (score crossed threshold)
//   trigger="coaching_insight"   → coaching_insight (from a chat session)
//
// Auth: must be the affected user OR an admin OR the service role.
// Embeddings: OpenAI Voyage voyage-3 (1024 dims) — matches schema.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { embeddingsCompat } from "../_shared/voyage.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";
import { anonymize, scoreBand, amountBand, type AnonymizeIdentity } from "../_shared/rag-anonymize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const bodySchema = z.object({
  trigger: z.enum(["funding_funded", "funding_denied", "score_milestone", "coaching_insight"]),
  user_id: z.string().uuid(),
  application_id: z.string().uuid().optional(),
  // score_milestone payload
  bureau: z.string().optional(),
  start_score: z.number().int().optional(),
  end_score: z.number().int().optional(),
  months_elapsed: z.number().int().optional(),
  primary_actions: z.array(z.string()).optional(),
  // coaching_insight payload
  insight_title: z.string().max(200).optional(),
  insight_content: z.string().max(8000).optional(),
  session_id: z.string().optional(),
});

async function embed(text: string, openaiKey: string): Promise<number[] | null> {
  try {
    const trimmed = text.length > 8000 ? text.slice(0, 8000) : text;
    const r = await embeddingsCompat("voyage", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: trimmed }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function loadIdentity(admin: ReturnType<typeof createClient>, userId: string): Promise<AnonymizeIdentity> {
  const [{ data: profile }, { data: biz }] = await Promise.all([
    admin.from("profiles").select("full_name, email, phone").eq("user_id", userId).maybeSingle(),
    admin.from("businesses").select("legal_name, dba, business_street_address, business_city").eq("owner_user_id", userId).limit(5),
  ]);
  const first = profile?.full_name?.split(/\s+/)?.[0] ?? null;
  const last = profile?.full_name?.split(/\s+/)?.slice(-1)?.[0] ?? null;
  return {
    fullName: profile?.full_name ?? null,
    firstName: first,
    lastName: last,
    email: (profile as any)?.email ?? null,
    phone: (profile as any)?.phone ?? null,
    businessLegalName: biz?.[0]?.legal_name ?? null,
    businessDba: biz?.[0]?.dba ?? null,
    street: biz?.[0]?.business_street_address ?? null,
    city: biz?.[0]?.business_city ?? null,
  };
}

function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.max(0, Math.round((db - da) / 86_400_000));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = "unused" ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";

    // Auth: accept either a user JWT or the service role key.
    const isServiceRole = authHeader.includes(supabaseServiceKey);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    let callerId: string | null = null;
    if (!isServiceRole) {
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = user.id;
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid payload", detail: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const payload = parsed.data;

    // Permission: caller must be the affected user, an admin, or service role.
    const admin = createClient(supabaseUrl, supabaseServiceKey);
    if (!isServiceRole && callerId !== payload.user_id) {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
      const isStaff = (roles ?? []).some((r: { role: string }) => r.role === "admin");
      if (!isStaff) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const identity = await loadIdentity(admin, payload.user_id);

    let title = "";
    let content = "";
    let summary = "";
    let documentType: string = "outcome_case";
    const metadata: Record<string, unknown> = {};

    // ---------------- TRIGGER 1: funding_funded ----------------
    if (payload.trigger === "funding_funded") {
      if (!payload.application_id) {
        return new Response(JSON.stringify({ error: "application_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: app } = await admin
        .from("funding_journey_applications")
        .select("lender_name, product_category, product_name, amount_approved, amount_requested, credit_score_at_application, bureau_pulled, application_date, decision_date, business_id, term_months, interest_rate")
        .eq("id", payload.application_id)
        .maybeSingle();
      if (!app) {
        return new Response(JSON.stringify({ error: "application not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: biz } = app.business_id
        ? await admin.from("businesses").select("entity_type, state_of_formation, formation_date, estimated_annual_revenue, naics").eq("id", app.business_id).maybeSingle()
        : { data: null as any };

      const amount = app.amount_approved ?? app.amount_requested;
      const days = daysBetween(app.application_date, app.decision_date);
      const score = app.credit_score_at_application;
      const monthsInBusiness = biz?.formation_date
        ? Math.max(0, Math.round((Date.now() - new Date(biz.formation_date).getTime()) / (30 * 86_400_000)))
        : null;

      documentType = "outcome_case";
      title = `${app.product_category ?? "Funding"} — $${(amount ?? 0).toLocaleString()} — ${days ?? "?"} days — ${score ?? "?"} score`;
      content = anonymize(
        `A ${biz?.entity_type ?? "small business"} in ${biz?.state_of_formation ?? "the U.S."} with ` +
        `${monthsInBusiness != null ? `${monthsInBusiness} months` : "an undisclosed time"} in business and ` +
        `${biz?.estimated_annual_revenue ? "$" + Number(biz.estimated_annual_revenue).toLocaleString() : "undisclosed"} annual revenue ` +
        `secured $${(amount ?? 0).toLocaleString()} in ${app.product_category ?? "financing"}` +
        `${app.product_name ? ` (${app.product_name})` : ""} through ${app.lender_name}. ` +
        `${score ? `The client's ${app.bureau_pulled ?? "credit"} score was ${score} at the time of application. ` : ""}` +
        `${app.term_months ? `Term: ${app.term_months} months. ` : ""}` +
        `${app.interest_rate ? `Rate: ${app.interest_rate}%. ` : ""}` +
        `Time from application to funding: ${days ?? "?"} days.`,
        identity,
      );
      summary = `${app.lender_name} funded $${(amount ?? 0).toLocaleString()} in ${days ?? "?"} days for a ${score ?? "?"}-score profile.`;
      Object.assign(metadata, {
        lender: app.lender_name,
        product_category: app.product_category,
        amount_band: amountBand(amount),
        credit_score_band: scoreBand(score),
        bureau: app.bureau_pulled,
        time_to_funding_days: days,
        entity_type: biz?.entity_type ?? null,
        state: biz?.state_of_formation ?? null,
        outcome: "funded",
      });
    }

    // ---------------- TRIGGER 2: funding_denied ----------------
    if (payload.trigger === "funding_denied") {
      if (!payload.application_id) {
        return new Response(JSON.stringify({ error: "application_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: app } = await admin
        .from("funding_journey_applications")
        .select("lender_name, product_category, amount_requested, credit_score_at_application, bureau_pulled, denial_reason_category, denial_reason_detail, next_steps, business_id")
        .eq("id", payload.application_id)
        .maybeSingle();
      if (!app) {
        return new Response(JSON.stringify({ error: "application not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: biz } = app.business_id
        ? await admin.from("businesses").select("formation_date, estimated_annual_revenue, state_of_formation, entity_type").eq("id", app.business_id).maybeSingle()
        : { data: null as any };
      const monthsInBusiness = biz?.formation_date
        ? Math.max(0, Math.round((Date.now() - new Date(biz.formation_date).getTime()) / (30 * 86_400_000)))
        : null;

      documentType = "denial_pattern";
      title = `${app.lender_name} denial — ${app.denial_reason_category ?? "unspecified"} — ${app.credit_score_at_application ?? "?"} score`;
      content = anonymize(
        `${app.lender_name} denied a ${app.product_category ?? "funding"} application for a client with a ` +
        `${app.credit_score_at_application ?? "?"} ${app.bureau_pulled ?? "credit"} score, ` +
        `${monthsInBusiness != null ? `${monthsInBusiness} months` : "an undisclosed time"} in business, and ` +
        `${biz?.estimated_annual_revenue ? "$" + Number(biz.estimated_annual_revenue).toLocaleString() : "undisclosed"} annual revenue. ` +
        `Denial reason: ${app.denial_reason_category ?? "not categorized"}` +
        `${app.denial_reason_detail ? ` — ${app.denial_reason_detail}` : ""}. ` +
        `Amount requested: $${(app.amount_requested ?? 0).toLocaleString()}. ` +
        `${app.next_steps ? `Recommended next steps: ${app.next_steps}` : ""}`,
        identity,
      );
      summary = `${app.lender_name} denied a ${app.credit_score_at_application ?? "?"}-score profile for ${app.denial_reason_category ?? "unspecified reasons"}.`;
      Object.assign(metadata, {
        lender: app.lender_name,
        product_category: app.product_category,
        denial_reason: app.denial_reason_category,
        credit_score_band: scoreBand(app.credit_score_at_application),
        amount_band: amountBand(app.amount_requested),
        bureau: app.bureau_pulled,
        state: biz?.state_of_formation ?? null,
        entity_type: biz?.entity_type ?? null,
        outcome: "denied",
      });
    }

    // ---------------- TRIGGER 3: score_milestone ----------------
    if (payload.trigger === "score_milestone") {
      if (payload.start_score == null || payload.end_score == null) {
        return new Response(JSON.stringify({ error: "start_score and end_score required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const delta = payload.end_score - payload.start_score;
      const months = payload.months_elapsed ?? null;
      const actions = payload.primary_actions ?? [];
      documentType = "credit_strategy";
      title = `Score improved ${delta} points in ${months ?? "?"} months — ${actions[0] ?? "multi-factor approach"}`;
      content = anonymize(
        `A client improved their ${payload.bureau ?? "credit"} score from ${payload.start_score} to ${payload.end_score} ` +
        `in ${months ?? "an undisclosed period of"} months. ` +
        `${actions.length ? `Primary actions taken: ${actions.join("; ")}. ` : ""}` +
        `${actions.length ? `The highest-impact action appeared to be "${actions[0]}".` : ""}`,
        identity,
      );
      summary = `+${delta} pts in ${months ?? "?"} months on ${payload.bureau ?? "credit"} via ${actions[0] ?? "multi-factor strategy"}.`;
      Object.assign(metadata, {
        bureau: payload.bureau ?? null,
        start_score_band: scoreBand(payload.start_score),
        end_score_band: scoreBand(payload.end_score),
        delta_points: delta,
        months_elapsed: months,
        primary_action: actions[0] ?? null,
      });
    }

    // ---------------- TRIGGER 4: coaching_insight ----------------
    if (payload.trigger === "coaching_insight") {
      if (!payload.insight_content || !payload.insight_title) {
        return new Response(JSON.stringify({ error: "insight_title and insight_content required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      documentType = "coaching_insight";
      title = payload.insight_title.slice(0, 200);
      content = anonymize(payload.insight_content, identity);
      summary = content.length > 240 ? content.slice(0, 237) + "..." : content;
      Object.assign(metadata, {
        source_session_id: payload.session_id ?? null,
      });
    }

    if (!content) {
      return new Response(JSON.stringify({ error: "Could not generate document content" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const embedding = openaiKey ? await embed(`${title}\n\n${content}`, openaiKey) : null;

    // Idempotency: outcome events already have a stable application_id; coaching/score
    // events use a deterministic key so we don't double-write.
    const dedupeKey =
      payload.trigger === "funding_funded" || payload.trigger === "funding_denied"
        ? `${payload.trigger}:${payload.application_id}`
        : payload.trigger === "score_milestone"
        ? `score:${payload.user_id}:${payload.bureau ?? "any"}:${payload.end_score}`
        : `insight:${payload.user_id}:${payload.session_id ?? crypto.randomUUID()}`;
    metadata.dedupe_key = dedupeKey;

    const { data: existing } = await admin
      .from("rag_documents")
      .select("id")
      .filter("metadata->>dedupe_key", "eq", dedupeKey)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ skipped: true, reason: "duplicate", id: existing.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inserted, error: insErr } = await admin
      .from("rag_documents")
      .insert({
        document_type: documentType,
        title,
        content,
        summary,
        embedding,
        metadata,
        source: payload.trigger === "coaching_insight" ? "client_conversation" : "outcome_report",
        client_id: payload.user_id,
        is_anonymized: true,
        is_published: true,
        quality_score: 0.6,
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("rag insert error:", insErr);
      return new Response(JSON.stringify({ error: "Failed to insert", detail: insErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ id: inserted.id, document_type: documentType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ingest-rag-outcome error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});