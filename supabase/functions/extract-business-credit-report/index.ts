import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gatewayCompat } from "../_shared/claude.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { refuseCustomerTier, staffOfBusiness } from "../_shared/finance-entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Bureau = "dnb" | "experian_business" | "equifax_sbfe";

const ALLOWED_BUREAUS: Bureau[] = ["dnb", "experian_business", "equifax_sbfe"];

function bureauPrompt(bureau: Bureau): string {
  if (bureau === "dnb") {
    return `You are parsing a Dun & Bradstreet business credit report PDF. Extract these fields and return ONLY valid JSON:
{
  "duns_number": string|null,
  "report_date": "YYYY-MM-DD"|null,
  "paydex_score": number 0-100|null,
  "delinquency_score": number|null,           // Delinquency Predictor Score
  "financial_stress_score": number|null,      // Financial Stress Score
  "trade_line_count": number|null,
  "highest_credit_extended": number|null,     // dollar amount
  "days_beyond_terms": number|null,           // average DBT
  "derogatory_count": number|null,
  "payment_trend": string|null                // e.g. "improving", "stable", "declining"
}
If a value is not present, return null. Do not invent numbers.`;
  }
  if (bureau === "experian_business") {
    return `You are parsing an Experian Business credit report PDF (Intelliscore Plus). Extract these fields and return ONLY valid JSON:
{
  "report_date": "YYYY-MM-DD"|null,
  "intelliscore": number 0-100|null,                 // Intelliscore Plus score
  "financial_stability_risk": number|null,           // FSR rating 1-5
  "days_beyond_terms": number|null,
  "trade_line_count": number|null,
  "highest_credit_extended": number|null,
  "derogatory_count": number|null,
  "payment_trend": string|null
}
If a value is not present, return null. Do not invent numbers.`;
  }
  return `You are parsing an Equifax Small Business / SBFE credit report PDF. Extract these fields and return ONLY valid JSON:
{
  "report_date": "YYYY-MM-DD"|null,
  "sbfe_score": number|null,
  "payment_index": number|null,
  "trade_line_count": number|null,
  "days_beyond_terms": number|null,
  "derogatory_count": number|null,
  "highest_credit_extended": number|null,
  "payment_trend": string|null
}
If a value is not present, return null. Do not invent numbers.`;
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

function dateOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) throw new Error("Unauthorized");

    // E09 F1b: business credit reports are not a customer feature — a portal customer is refused
    // before the file is read or stored.
    const tier = await refuseCustomerTier(supabase, user.id);
    if (!tier.ok) {
      return new Response(JSON.stringify({ error: tier.error }), { status: tier.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const contentType = req.headers.get("content-type") || "";
    let bureau: Bureau;
    let businessId: string | null = null;
    let fileName: string;
    let fileBytes: Uint8Array;
    let mimeType = "application/pdf";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const bureauField = String(form.get("bureau") || "");
      if (!ALLOWED_BUREAUS.includes(bureauField as Bureau)) {
        throw new Error(`Invalid bureau: ${bureauField}`);
      }
      bureau = bureauField as Bureau;
      businessId = (form.get("business_id") as string | null) || null;
      const file = form.get("file") as File | null;
      if (!file) throw new Error("Missing file");
      fileName = file.name || `${bureau}-${Date.now()}.pdf`;
      mimeType = file.type || mimeType;
      fileBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = await req.json();
      const bureauField = String(body.bureau || "");
      if (!ALLOWED_BUREAUS.includes(bureauField as Bureau)) {
        throw new Error(`Invalid bureau: ${bureauField}`);
      }
      bureau = bureauField as Bureau;
      businessId = body.business_id || null;
      fileName = body.file_name || `${bureau}-${Date.now()}.pdf`;
      if (!body.file_base64) throw new Error("Missing file_base64");
      const bin = atob(body.file_base64);
      fileBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) fileBytes[i] = bin.charCodeAt(i);
    }

    // E09 F1b: a business_id from the request must be a business the caller owns, or one belonging to a
    // business (tenant) they are an owner/admin of (or the platform owner). It used to be written onto
    // the report as given.
    if (businessId) {
      const { data: biz, error: bizReadErr } = await supabase
        .from("businesses")
        .select("owner_user_id, tenant_id")
        .eq("id", businessId)
        .maybeSingle();
      if (bizReadErr) {
        return new Response(JSON.stringify({ error: "business_lookup_failed" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!biz) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (biz.owner_user_id !== user.id) {
        const staff = await staffOfBusiness(supabase, user.id, biz.tenant_id ?? null);
        if (!staff.ok) {
          return new Response(JSON.stringify({ error: staff.error }), { status: staff.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    // 1) Upload PDF to private storage bucket
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${user.id}/${bureau}/${Date.now()}_${safeName}`;
    const { error: uploadErr } = await supabase.storage
      .from("business-credit-reports")
      .upload(storagePath, fileBytes, { contentType: mimeType, upsert: false });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // 2) Insert pending row
    const { data: inserted, error: insertErr } = await supabase
      .from("business_credit_reports")
      .insert({
        user_id: user.id,
        business_id: businessId,
        bureau,
        file_path: storagePath,
        extraction_status: "pending",
      })
      .select("id")
      .single();
    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
    const reportId = inserted.id as string;

    // 3) Run AI extraction via the direct-Anthropic gateway shim
    // Re-encode bytes to base64 for the Gateway image_url payload
    let binStr = "";
    const chunk = 0x8000;
    for (let i = 0; i < fileBytes.length; i += chunk) {
      binStr += String.fromCharCode.apply(
        null,
        Array.from(fileBytes.subarray(i, i + chunk)) as unknown as number[],
      );
    }
    const b64 = btoa(binStr);
    const dataUrl = `data:${mimeType};base64,${b64}`;

    const aiRes = await gatewayCompat("anthropic", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content:
              "You extract structured business credit data from PDFs. Always respond with strict JSON only — no prose, no markdown fences.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: bureauPrompt(bureau) },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errTxt = await aiRes.text();
      console.error("AI gateway error", aiRes.status, errTxt);
      await supabase
        .from("business_credit_reports")
        .update({ extraction_status: "failed", extraction_error: `AI error ${aiRes.status}` })
        .eq("id", reportId);
      throw new Error(`AI extraction failed (${aiRes.status})`);
    }

    const aiJson = await aiRes.json();
    const aiContent: string = aiJson?.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson(aiContent) ?? {};

    // 4) Map extracted JSON to business_credit_reports columns
    const reportPatch: Record<string, unknown> = {
      report_date: dateOrNull(parsed.report_date),
      raw_text: aiContent.slice(0, 50000),
      paydex_score: intOrNull(parsed.paydex_score),
      intelliscore: intOrNull(parsed.intelliscore),
      sbfe_score: intOrNull(parsed.sbfe_score),
      payment_trend: typeof parsed.payment_trend === "string" ? parsed.payment_trend : null,
      days_beyond_terms: intOrNull(parsed.days_beyond_terms),
      trade_line_count: intOrNull(parsed.trade_line_count),
      derogatory_count: intOrNull(parsed.derogatory_count),
      highest_credit_extended: num(parsed.highest_credit_extended),
      extraction_status: "extracted",
    };

    await supabase.from("business_credit_reports").update(reportPatch).eq("id", reportId);

    // 5) Update businesses table with the latest scores
    const today = new Date().toISOString();
    const reportDate = (reportPatch.report_date as string | null) ?? today.slice(0, 10);

    if (businessId) {
      const bizPatch: Record<string, unknown> = {
        business_credit_last_updated: today,
      };
      if (bureau === "dnb") {
        bizPatch.dnb_paydex_score = reportPatch.paydex_score ?? null;
        bizPatch.dnb_paydex = reportPatch.paydex_score ?? null; // keep legacy column in sync
        bizPatch.dnb_delinquency_score = intOrNull(parsed.delinquency_score);
        bizPatch.dnb_financial_stress_score = intOrNull(parsed.financial_stress_score);
        bizPatch.dnb_duns_number = typeof parsed.duns_number === "string" ? parsed.duns_number : null;
        bizPatch.dnb_report_date = reportDate;
        bizPatch.dnb_last_verified = today;
      } else if (bureau === "experian_business") {
        bizPatch.experian_intelliscore_score = reportPatch.intelliscore ?? null;
        bizPatch.experian_intelliscore = reportPatch.intelliscore ?? null; // legacy
        bizPatch.experian_financial_stability_risk = intOrNull(parsed.financial_stability_risk);
        bizPatch.experian_days_beyond_terms = intOrNull(parsed.days_beyond_terms);
        bizPatch.experian_report_date = reportDate;
        bizPatch.experian_last_verified = today;
      } else {
        bizPatch.equifax_sbfe_score = reportPatch.sbfe_score ?? null;
        bizPatch.equifax_payment_index_score = intOrNull(parsed.payment_index);
        bizPatch.equifax_payment_index = intOrNull(parsed.payment_index); // legacy
        bizPatch.equifax_report_date = reportDate;
        bizPatch.equifax_last_verified = today;
      }
      // Strip nulls so we don't overwrite existing data when AI couldn't read a field
      const cleanedPatch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(bizPatch)) if (v != null) cleanedPatch[k] = v;

      const { error: bizErr } = await supabase
        .from("businesses")
        .update(cleanedPatch)
        .eq("id", businessId)
        .eq("owner_user_id", user.id);
      if (bizErr) console.error("businesses update failed", bizErr);
    }

    // 6) Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      entity: "business_credit_reports",
      entity_id: reportId,
      action: "extract",
      data: { bureau, business_id: businessId },
    });

    return new Response(
      JSON.stringify({
        success: true,
        report_id: reportId,
        bureau,
        extracted: reportPatch,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    console.error("extract-business-credit-report error", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
