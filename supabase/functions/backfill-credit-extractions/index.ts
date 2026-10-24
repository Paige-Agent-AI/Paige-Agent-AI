import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gatewayCompat } from "../_shared/claude.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { refuseCustomerTier, staffOfSubject } from "../_shared/finance-entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 5;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth check - must be admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // E09 F1b: re-extraction is not a customer feature — a portal customer is refused.
    const tier = await refuseCustomerTier(supabase, user.id);
    if (!tier.ok) {
      return new Response(JSON.stringify({ error: tier.error }), { status: tier.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Parse optional single_user_id for targeted re-extraction
    let singleUserId: string | null = null;
    try {
      const body = await req.json();
      singleUserId = body?.target_user_id || null;
    } catch { /* no body = bulk */ }

    // E09 F1b (§59): the header above said "must be admin" but nothing checked it, so any signed-in
    // user could start a re-extraction across EVERY business (model spend plus writes). A bulk run is
    // operator work — the platform owner only. A targeted run is the person themselves, an owner/admin
    // of a business where that person holds a seat, or the platform owner.
    if (!singleUserId) {
      const { data: isOwner, error: ownerErr } = await supabase.rpc("is_platform_owner", { _user_id: user.id });
      if (ownerErr || isOwner !== true) {
        return new Response(JSON.stringify({ error: ownerErr ? "authority_unavailable" : "forbidden" }), {
          status: ownerErr ? 503 : 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (singleUserId !== user.id) {
      const staff = await staffOfSubject(supabase, user.id, singleUserId);
      if (!staff.ok) {
        return new Response(JSON.stringify({ error: staff.error }), { status: staff.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Step 1: Find all completed reports whose extraction is not still WAITING ON A PERSON.
    //
    // `analysis_status = 'completed'` means the PDF was parsed, not that anyone approved what came
    // out of it. Since the chat upload path stopped auto-writing extracted fields, an upload can
    // sit legitimately parsed with `extraction_review_state = 'awaiting_review'` and zero rows in
    // `credit_accounts` — because the human has not said yes yet.
    //
    // Step 2 below reads exactly that emptiness as "this needs backfilling" and re-runs the
    // extraction. That costs a model call per unapproved upload every time this runs, and writes an
    // `extraction_quality_log` row grading data nobody accepted. Worse in principle: it is a second
    // door into the same auto-population the review gate was built to close.
    //
    // HONEST SCOPE (§13): with no matching `credit_accounts` rows the update loop has nothing to
    // target, so today this leaks spend and misleading quality rows rather than unapproved
    // *values*. The exclusion is here so that stays true if the loop ever learns to insert.
    //
    // NULL is included deliberately — every upload predating the review column has it, and those
    // are exactly the historical rows this backfill exists to repair.
    let query = supabase
      .from("credit_report_uploads")
      .select("id, user_id, client_id, file_path, file_name, analysis_status, backfill_status, extraction_review_state")
      .in("analysis_status", ["completed", "complete"])
      .or("extraction_review_state.is.null,extraction_review_state.neq.awaiting_review");
    
    if (singleUserId) {
      query = query.eq("user_id", singleUserId);
    }

    const { data: reports, error: reportError } = await query;
    if (reportError) throw new Error(`Failed to fetch reports: ${reportError.message}`);

    if (!reports || reports.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "No reports found to backfill",
        summary: { total_processed: 0, total_accounts_updated: 0, fields_populated: {} }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 2: Check which reports need backfill (>50% null critical fields)
    const reportsNeedingBackfill: typeof reports = [];
    for (const report of reports) {
      if (report.backfill_status === "completed") continue;

      const { data: accounts } = await supabase
        .from("credit_accounts")
        .select("id, account_number, original_amount, payment_history_json, account_close_date, account_open_date")
        .eq("user_id", report.user_id as string);

      if (!accounts || accounts.length === 0) {
        reportsNeedingBackfill.push(report);
        continue;
      }

      let nullCount = 0;
      const total = accounts.length;
      for (const acct of accounts) {
        const nullFields = [
          acct.account_number == null,
          (acct as any).original_amount == null || (acct as any).original_amount === 0,
          acct.payment_history_json == null,
          acct.account_close_date == null && acct.account_open_date == null,
        ].filter(Boolean).length;
        if (nullFields >= 2) nullCount++;
      }

      if (nullCount / total > 0.5) {
        reportsNeedingBackfill.push(report);
      }
    }

    if (reportsNeedingBackfill.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "All reports have sufficient data — no backfill needed",
        summary: { total_processed: 0, total_accounts_updated: 0, fields_populated: {} }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 3: Process in batches
    const summary = {
      total_processed: 0,
      total_accounts_updated: 0,
      fields_populated: { account_numbers: 0, original_amounts: 0, payment_histories: 0, dates: 0 },
      failed_reports: [] as { report_id: string; error: string }[],
      quality_scores: [] as { report_id: string; score: number }[],
    };

    for (let i = 0; i < reportsNeedingBackfill.length; i += BATCH_SIZE) {
      const batch = reportsNeedingBackfill.slice(i, i + BATCH_SIZE);

      for (const report of batch) {
        try {
          // Mark as in_progress
          await supabase.from("credit_report_uploads")
            .update({ backfill_status: "in_progress" })
            .eq("id", report.id);

          // Get original account count for quality validation
          const { count: originalAccountCount } = await supabase
            .from("credit_accounts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", report.user_id as string);

          // Download PDF and re-analyze
          const { data: fileData } = await supabase.storage
            .from("credit-report-uploads")
            .download(report.file_path as string);

          if (!fileData) {
            summary.failed_reports.push({ report_id: report.id, error: "File not found in storage" });
            await supabase.from("credit_report_uploads")
              .update({ backfill_status: "failed" })
              .eq("id", report.id);
            continue;
          }

          const buffer = await fileData.arrayBuffer();
          const base64 = arrayBufferToBase64(buffer);

          // Run extraction via AI
          const extractionResult = await callAiExtraction(base64);
          if (!extractionResult) {
            summary.failed_reports.push({ report_id: report.id, error: "AI extraction returned no data" });
            await supabase.from("credit_report_uploads")
              .update({ backfill_status: "failed" })
              .eq("id", report.id);
            continue;
          }

          // Quality validation (Part 4)
          const reextractedCount = (extractionResult.positive_accounts?.length || 0) + (extractionResult.negative_items?.length || 0);
          const qualityFlags: string[] = [];
          let qualityScore = 100;

          // Check 1: Account count consistency
          if (originalAccountCount && reextractedCount > 0) {
            const diff = Math.abs(reextractedCount - originalAccountCount) / originalAccountCount;
            if (diff > 0.2) {
              qualityFlags.push(`Account count differs by ${Math.round(diff * 100)}% (original: ${originalAccountCount}, re-extracted: ${reextractedCount})`);
              qualityScore -= 20;
            }
          }

          // Check 2: Score consistency
          const scoreCheck: Record<string, any> = {};
          if (extractionResult.scores) {
            for (const bureau of ["experian", "transunion", "equifax"]) {
              const newScore = extractionResult.scores[bureau];
              if (newScore) scoreCheck[bureau] = { new_score: newScore };
            }
          }

          // Check 4: Required fields
          const allExtracted = [...(extractionResult.positive_accounts || []), ...(extractionResult.negative_items || [])];
          const withAccountNum = allExtracted.filter((a: any) => a.account_number || a.account_number_masked).length;
          const withStatus = allExtracted.filter((a: any) => a.status || a.payment_status).length;
          const withDateOpened = allExtracted.filter((a: any) => a.opened_date || a.account_open_date || a.date_opened).length;
          const requiredFieldsPct = allExtracted.length > 0
            ? Math.round(((withAccountNum + withStatus + withDateOpened) / (allExtracted.length * 3)) * 100)
            : 0;

          if (requiredFieldsPct < 80) {
            qualityFlags.push(`Required fields only ${requiredFieldsPct}% populated`);
            qualityScore -= 15;
          }

          qualityScore = Math.max(0, Math.min(100, qualityScore));

          // Step 3: Field-level updates only (don't overwrite existing data)
          const fieldsUpdated = { account_numbers: 0, original_amounts: 0, payment_histories: 0, dates: 0 };

          // Update positive accounts
          for (const acct of (extractionResult.positive_accounts || [])) {
            const creditorName = (acct.creditor || "").toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim();
            if (!creditorName) continue;

            // Find matching existing account
            const { data: existing } = await supabase
              .from("credit_accounts")
              .select("id, account_number, original_amount, payment_history_json, account_close_date, account_open_date")
              .eq("user_id", report.user_id as string)
              .ilike("creditor", `%${creditorName.substring(0, 10)}%`)
              .limit(5);

            if (!existing || existing.length === 0) continue;

            // Find best match
            const target = existing[0];
            const updates: Record<string, any> = {};

            if (!target.account_number && (acct.account_number || acct.account_number_masked)) {
              updates.account_number = acct.account_number || acct.account_number_masked;
              fieldsUpdated.account_numbers++;
            }
            if ((!target.original_amount || target.original_amount === 0) && acct.original_amount && acct.original_amount > 0) {
              updates.original_amount = acct.original_amount;
              fieldsUpdated.original_amounts++;
            }
            if (!target.payment_history_json && acct.payment_history_percentage != null) {
              updates.payment_history_json = { percentage: acct.payment_history_percentage };
              fieldsUpdated.payment_histories++;
            }
            if (!target.account_close_date && acct.date_closed) {
              updates.account_close_date = acct.date_closed;
              fieldsUpdated.dates++;
            }
            if (!target.account_open_date && (acct.opened_date || acct.account_open_date)) {
              updates.account_open_date = acct.opened_date || acct.account_open_date;
              fieldsUpdated.dates++;
            }

            if (Object.keys(updates).length > 0) {
              updates.updated_at = new Date().toISOString();
              await supabase.from("credit_accounts").update(updates).eq("id", target.id);
              summary.total_accounts_updated++;
            }
          }

          // Update negative items similarly
          for (const item of (extractionResult.negative_items || [])) {
            const creditorName = (item.creditor_name || "").toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim();
            if (!creditorName) continue;

            const { data: existing } = await supabase
              .from("credit_negative_items")
              .select("id, account_number, account_number_masked, original_amount, date_of_occurrence, date_reported")
              .eq("user_id", report.user_id as string)
              .ilike("creditor_name", `%${creditorName.substring(0, 10)}%`)
              .limit(5);

            if (!existing || existing.length === 0) continue;
            const target = existing[0];
            const updates: Record<string, any> = {};

            if (!target.account_number_masked && (item.account_number || item.account_number_masked)) {
              updates.account_number_masked = item.account_number || item.account_number_masked;
              fieldsUpdated.account_numbers++;
            }
            if ((!target.original_amount || target.original_amount === 0) && item.original_amount && item.original_amount > 0) {
              updates.original_amount = item.original_amount;
              fieldsUpdated.original_amounts++;
            }

            if (Object.keys(updates).length > 0) {
              updates.updated_at = new Date().toISOString();
              await supabase.from("credit_negative_items").update(updates).eq("id", target.id);
              summary.total_accounts_updated++;
            }
          }

          // Update summary
          summary.fields_populated.account_numbers += fieldsUpdated.account_numbers;
          summary.fields_populated.original_amounts += fieldsUpdated.original_amounts;
          summary.fields_populated.payment_histories += fieldsUpdated.payment_histories;
          summary.fields_populated.dates += fieldsUpdated.dates;

          // Mark completed
          await supabase.from("credit_report_uploads").update({
            backfill_status: "completed",
            backfill_completed_at: new Date().toISOString(),
            backfill_fields_updated: fieldsUpdated,
          }).eq("id", report.id);

          // Insert quality log
          await supabase.from("extraction_quality_log").insert({
            report_id: report.id,
            client_id: report.client_id,
            user_id: report.user_id,
            extraction_date: new Date().toISOString(),
            account_count_original: originalAccountCount || 0,
            account_count_reextracted: reextractedCount,
            score_consistency_check: scoreCheck,
            creditor_consistency_check: {},
            required_fields_percentage: requiredFieldsPct,
            quality_flags: qualityFlags,
            overall_quality_score: qualityScore,
          });

          summary.quality_scores.push({ report_id: report.id, score: qualityScore });
          summary.total_processed++;

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          summary.failed_reports.push({ report_id: report.id, error: errMsg });
          await supabase.from("credit_report_uploads")
            .update({ backfill_status: "failed" })
            .eq("id", report.id);
        }
      }
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      entity: "credit_report_backfill",
      action: "bulk_backfill_completed",
      data: summary,
    });

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[BACKFILL ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function callAiExtraction(base64: string) {
  const prompt = `You are extracting a consumer credit report into structured JSON. Extract ALL accounts with these fields for each:
- creditor (exact name)
- account_number (exactly as printed, masked or full)
- account_type (revolving, installment, mortgage, etc.)
- balance (current balance)
- credit_limit (for revolving accounts)
- original_amount (original loan amount for installment accounts)
- payment_history_percentage (on-time payment rate)
- opened_date
- date_closed (if closed)
- is_open (boolean)
- status (current, closed, charged off, etc.)
- payment_status
- bureaus_reporting (array of bureau names)

Also extract negative_items with: creditor_name, account_number, account_number_masked, bureau, item_type, amount, original_amount, date_of_occurrence, date_reported, status, payment_history_percentage.

Also extract scores: { equifax: number|null, experian: number|null, transunion: number|null }

Return valid JSON only.`;

  const response = await gatewayCompat("anthropic", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: [
          { type: "text", text: "Extract all account data from this credit report PDF." },
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
        ]},
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`AI extraction failed with status ${response.status}`);
  }

  const aiData = await response.json();
  const raw = (aiData.choices?.[0]?.message?.content || "")
    .replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse AI extraction result");
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
