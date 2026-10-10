import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ScoreSchema = z.object({
  equifax: z.number().nullable().optional(),
  experian: z.number().nullable().optional(),
  transunion: z.number().nullable().optional(),
});

const NegativeItemSchema = z.object({
  creditor_name: z.string().nullable().optional(),
  account_number: z.string().nullable().optional(),
  account_number_masked: z.string().nullable().optional(),
  bureau: z.string().nullable().optional(),
  item_type: z.string().nullable().optional(),
  amount: z.number().nullable().optional(),
  original_amount: z.number().nullable().optional(),
  date_of_occurrence: z.string().nullable().optional(),
  date_reported: z.string().nullable().optional(),
  date_opened: z.string().nullable().optional(),
  date_closed: z.string().nullable().optional(),
  dispute_basis: z.string().nullable().optional(),
  estimated_score_impact: z.number().nullable().optional(),
  status: z.string().nullable().optional().default("active"),
  is_cross_bureau_discrepancy: z.boolean().optional().default(false),
  responsibility: z.string().nullable().optional(),
  payment_history_percentage: z.number().nullable().optional(),
  account_type: z.string().nullable().optional(),
}).passthrough();

const InquirySchema = z.object({
  creditor_name: z.string().nullable().optional(),
  inquiry_date: z.string().nullable().optional(),
  bureau: z.string().nullable().optional(),
  is_authorized: z.boolean().optional().default(true),
}).passthrough();

const PositiveAccountSchema = z.object({
  creditor: z.string().nullable().optional(),
  account_number: z.string().nullable().optional(),
  account_type: z.string().nullable().optional(),
  balance: z.number().nullable().optional(),
  credit_limit: z.number().nullable().optional(),
  utilization: z.number().nullable().optional(),
  status: z.string().nullable().optional().default("current"),
  account_open_date: z.string().nullable().optional(),
  is_open: z.boolean().optional().default(true),
  payment_status: z.string().nullable().optional(),
  account_number_masked: z.string().nullable().optional(),
  original_amount: z.number().nullable().optional(),
  date_closed: z.string().nullable().optional(),
  responsibility: z.string().nullable().optional(),
  payment_history_percentage: z.number().nullable().optional(),
  bureau_source: z.string().nullable().optional(),
}).passthrough();

const DiscrepancySchema = z.object({
  account_name: z.string(),
  issue: z.string(),
  bureaus_affected: z.array(z.string()),
});

const SyncPayloadSchema = z.object({
  target_user_id: z.string().uuid(),
  client_id: z.string().uuid().nullable().optional(),
  report_type: z.string().optional().default("consumer"),
  scores: ScoreSchema.optional(),
  negative_items: z.array(NegativeItemSchema).optional().default([]),
  hard_inquiries: z.array(InquirySchema).optional().default([]),
  positive_accounts: z.array(PositiveAccountSchema).optional().default([]),
  oldest_account_date: z.string().nullable().optional(),
  average_account_age_months: z.number().nullable().optional(),
  oldest_account_age_months: z.number().nullable().optional(),
  discrepancies: z.array(DiscrepancySchema).optional().default([]),
  priority_disputes: z.array(z.object({
    account_name: z.string(),
    bureau: z.string(),
    dispute_basis: z.string(),
  })).optional().default([]),
  report_upload_id: z.string().uuid().nullable().optional(),
  fraud_alerts: z.any().nullable().optional(),
  security_freezes: z.any().nullable().optional(),
  score_model: z.string().nullable().optional(),
  validation_flags: z.any().nullable().optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth: accept either user token or service role key
    let targetUserId: string;
    let callerUserId: string;

    if (authHeader.includes(supabaseServiceKey)) {
      const rawData = await req.json();
      let payload;
      try {
        payload = SyncPayloadSchema.parse(rawData);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return new Response(JSON.stringify({ error: "Invalid payload", details: err.issues }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw err;
      }
      targetUserId = payload.target_user_id;
      callerUserId = "service_role";

      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      return await processSync(supabase, payload, targetUserId, callerUserId);
    }

    // User token auth
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawData = await req.json();
    let payload;
    try {
      payload = SyncPayloadSchema.parse(rawData);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return new Response(JSON.stringify({ error: "Invalid payload", details: err.issues }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw err;
    }

    targetUserId = payload.target_user_id;
    callerUserId = user.id;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authorization check: a person syncs their own records; an admin may sync anyone's. An assignment
    // opens reads only, so it does not let anyone write credit data into a client's records.
    if (user.id !== targetUserId) {
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return await processSync(supabase, payload, targetUserId, callerUserId);
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(JSON.stringify({ error: "Internal error", message: error instanceof Error ? error.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Fuzzy string similarity (simple Dice coefficient)
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bi = a.substring(i, i + 2);
    bigrams.set(bi, (bigrams.get(bi) || 0) + 1);
  }
  let intersect = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bi = b.substring(i, i + 2);
    const count = bigrams.get(bi) || 0;
    if (count > 0) {
      bigrams.set(bi, count - 1);
      intersect++;
    }
  }
  return (2 * intersect) / (a.length - 1 + b.length - 1);
}

// Normalize creditor names for dedup comparison
const STRIP_SUFFIXES = /\b(INC|LLC|CORP|CORPORATION|NA|N\.A\.|FSB|BANK|BK|FIN|FNCL|FINCL|CO|COMPANY|LTD|LP|FINANCIAL|SERVICES|SVC|SVCS|GROUP|GRP|ASSOC|ASSOCIATION)\b/gi;
function normalizeCreditorName(name: string): string {
  return (name || "unknown")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(STRIP_SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function processSync(supabase: any, payload: any, targetUserId: string, callerUserId: string) {
  const results: Record<string, any> = {};
  let currentStep = "init";
  const clientId = payload.client_id || null;
  const negativeItemLogs: any[] = [];

  console.log("=== SYNC PAYLOAD COUNTS (raw) ===", {
    negative_items: payload.negative_items?.length ?? 0,
    positive_accounts: payload.positive_accounts?.length ?? 0,
    hard_inquiries: payload.hard_inquiries?.length ?? 0,
    priority_disputes: payload.priority_disputes?.length ?? 0,
    client_id: clientId,
    target_user_id: targetUserId,
  });

  // Defensive filter: drop rows missing the minimum identifiers required to be useful.
  // The AI sometimes returns partial rows (e.g. a creditor with no name on a tri-merge column gap).
  // Filtering here lets the sync succeed for the rest of the report instead of failing the whole upload.
  const droppedNegatives: any[] = [];
  payload.negative_items = (payload.negative_items || []).filter((n: any) => {
    if (!n || typeof n !== "object") return false;
    const hasName = typeof n.creditor_name === "string" && n.creditor_name.trim().length > 0;
    const hasBureau = typeof n.bureau === "string" && n.bureau.trim().length > 0;
    const hasType = typeof n.item_type === "string" && n.item_type.trim().length > 0;
    if (!hasName || !hasBureau || !hasType) {
      droppedNegatives.push({ creditor_name: n.creditor_name, bureau: n.bureau, item_type: n.item_type });
      return false;
    }
    return true;
  });

  const droppedPositives: any[] = [];
  payload.positive_accounts = (payload.positive_accounts || []).filter((a: any) => {
    if (!a || typeof a !== "object") return false;
    const hasName = typeof a.creditor === "string" && a.creditor.trim().length > 0;
    if (!hasName) {
      droppedPositives.push({ creditor: a.creditor, account_type: a.account_type });
      return false;
    }
    // account_type missing → default to "unknown" so we keep the row
    if (!a.account_type || typeof a.account_type !== "string" || a.account_type.trim().length === 0) {
      a.account_type = "unknown";
    }
    return true;
  });

  const droppedInquiries: any[] = [];
  payload.hard_inquiries = (payload.hard_inquiries || []).filter((q: any) => {
    if (!q || typeof q !== "object") return false;
    const hasName = typeof q.creditor_name === "string" && q.creditor_name.trim().length > 0;
    const hasBureau = typeof q.bureau === "string" && q.bureau.trim().length > 0;
    const hasDate = typeof q.inquiry_date === "string" && q.inquiry_date.trim().length > 0;
    if (!hasName || !hasBureau || !hasDate) {
      droppedInquiries.push({ creditor_name: q.creditor_name, bureau: q.bureau, inquiry_date: q.inquiry_date });
      return false;
    }
    return true;
  });

  console.log("=== SYNC PAYLOAD COUNTS (filtered) ===", {
    negative_items: payload.negative_items.length,
    positive_accounts: payload.positive_accounts.length,
    hard_inquiries: payload.hard_inquiries.length,
    dropped_negatives: droppedNegatives.length,
    dropped_positives: droppedPositives.length,
    dropped_inquiries: droppedInquiries.length,
  });
  if (droppedNegatives.length || droppedPositives.length || droppedInquiries.length) {
    console.warn("Dropped incomplete rows:", { droppedNegatives, droppedPositives, droppedInquiries });
  }

  const withClientId = (obj: any) => clientId ? { ...obj, client_id: clientId } : obj;

  try {
    // ========== STEP 1: CREDIT SCORES ==========
    currentStep = "scores";
    if (payload.scores) {
      const { equifax, experian, transunion } = payload.scores;
      const { data: prevProfile } = await supabase
        .from("profiles")
        .select("estimated_fico_eq, estimated_fico_ex, estimated_fico_tu")
        .eq("user_id", targetUserId).maybeSingle();

      if (!prevProfile) {
        // #734 — an error-free update that matches ZERO rows is not a success. The profile row
        // was already fetched above, so absence is knowable without another query: there is no
        // row to update, no update is attempted, and the response says so instead of
        // scores_updated:true (which every producer would read as "the scores were written").
        results.scores_updated = false;
        results.scores_no_profile_row = true;
      } else {
        const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
        if (equifax != null) updateFields.estimated_fico_eq = equifax;
        if (experian != null) updateFields.estimated_fico_ex = experian;
        if (transunion != null) updateFields.estimated_fico_tu = transunion;
        if (payload.score_model && ["FICO", "VantageScore", "Unknown"].includes(payload.score_model)) {
          updateFields.score_model = payload.score_model;
        }

        const { error: scoreErr } = await supabase.from("profiles").update(updateFields).eq("user_id", targetUserId);
        if (scoreErr) {
          console.error("Score update error:", scoreErr);
          results.scores_error = scoreErr.message;
        } else {
          results.scores_updated = true;
          const { error: scoreAuditErr } = await supabase.from("audit_logs").insert({
            user_id: targetUserId, entity: "credit_scores", action: "scores_updated_via_chat_upload",
            data: {
              previous: { equifax: prevProfile.estimated_fico_eq, experian: prevProfile.estimated_fico_ex, transunion: prevProfile.estimated_fico_tu },
              new: { equifax, experian, transunion },
              source: "chat_report_upload", updated_by: callerUserId,
            },
          });
          if (scoreAuditErr) console.error("Score audit-log insert error:", scoreAuditErr);
        }
      }
    }

    // ========== STEP 2: NEGATIVE ITEMS (account_number-first dedup) ==========
    currentStep = "negative_items";
    let negativeItemsInserted = 0;
    let negativeItemsUpdated = 0;
    let negativeItemsFailed = 0;

    console.log(`=== NEGATIVE ITEMS: ${payload.negative_items.length} items to process ===`);

    const normalizeBureau = (b: string): string => {
      const lower = (b || "").toLowerCase().trim();
      if (lower.includes("trans")) return "transunion";
      if (lower.includes("exper")) return "experian";
      if (lower.includes("equi")) return "equifax";
      return "";
    };
    const normalizeItemType = (t: string): string => {
      const lower = (t || "").toLowerCase().trim().replace(/-/g, "_");
      const map: Record<string, string> = {
        charge_off: "charge_off", chargeoff: "charge_off", "charged off": "charge_off",
        collection: "collection", collections: "collection",
        late_payment: "late_payment", "late payment": "late_payment", late: "late_payment",
        bankruptcy: "bankruptcy", repossession: "repossession", foreclosure: "foreclosure",
        tax_lien: "tax_lien", "tax lien": "tax_lien",
        civil_judgment: "civil_judgment", "civil judgment": "civil_judgment",
        student_loan_default: "student_loan_default",
      };
      return map[lower] || "collection";
    };
    const normalizeStatus = (s: string): string => {
      const lower = (s || "active").toLowerCase().trim();
      if (["active", "disputed", "removed", "verified", "updated"].includes(lower)) return lower;
      return "active";
    };

    for (let idx = 0; idx < payload.negative_items.length; idx++) {
      const item = payload.negative_items[idx];
      const bureau = normalizeBureau(item.bureau);
      const itemType = normalizeItemType(item.item_type);
      const status = normalizeStatus(item.status);
      const removalProb = item.estimated_score_impact != null ? Math.max(0, Math.min(100, Math.round(item.estimated_score_impact))) : null;
      const accountNumber = item.account_number || item.account_number_masked || null;

      if (!["transunion", "experian", "equifax"].includes(bureau)) {
        console.warn(`[NEG ${idx + 1}] Skipping — unrecognized bureau: '${item.bureau}'`);
        negativeItemsFailed++;
        continue;
      }

      // DEDUP PRIORITY 1: account_number + bureau
      let existing: any = null;
      if (accountNumber) {
        let q = supabase.from("credit_negative_items").select("id")
          .eq("user_id", targetUserId).eq("bureau", bureau).eq("account_number", accountNumber);
        if (clientId) q = q.eq("client_id", clientId); else q = q.is("client_id", null);
        const { data: rows } = await q;
        if (rows && rows.length > 0) existing = rows[0];
      }

      // DEDUP PRIORITY 2: normalized creditor + bureau + item_type (fallback)
      if (!existing) {
        const normalizedName = normalizeCreditorName(item.creditor_name);
        let q = supabase.from("credit_negative_items").select("id, creditor_name")
          .eq("user_id", targetUserId).eq("bureau", bureau).eq("item_type", itemType);
        if (clientId) q = q.eq("client_id", clientId); else q = q.is("client_id", null);
        const { data: candidates } = await q;
        if (candidates && candidates.length > 0) {
          // Exact normalized match first
          const exactNorm = candidates.find((c: any) => normalizeCreditorName(c.creditor_name) === normalizedName);
          if (exactNorm) {
            existing = exactNorm;
            if (exactNorm.creditor_name !== item.creditor_name) {
              console.log(`[DEDUP NEG] Auto-merged case variant: "${item.creditor_name}" → "${exactNorm.creditor_name}"`);
            }
          } else {
            // Fuzzy match at 85%
            const fuzzy = candidates.find((c: any) => similarity(normalizeCreditorName(c.creditor_name), normalizedName) >= 0.85);
            if (fuzzy) existing = fuzzy;
          }
        }
      }

      if (existing) {
        // #734 — the UPDATE branch reads its own error. An update that failed is counted
        // failed, never updated; previously negativeItemsUpdated++ ran unconditionally, so
        // results.negative_items.failed under-reported and a caller could not see the loss.
        const { error: updateErr } = await supabase.from("credit_negative_items").update({
          status, amount: item.amount, item_type: itemType,
          notes: item.dispute_basis, removal_probability: removalProb,
          date_of_occurrence: item.date_of_occurrence || null,
          date_reported: item.date_reported || null,
          account_number: accountNumber,
          account_number_masked: accountNumber,
          original_amount: item.original_amount || null,
          is_removable: true, updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
        if (updateErr) {
          console.error(`[NEG ${idx + 1}] Update error:`, updateErr);
          negativeItemsFailed++;
        } else {
          negativeItemsUpdated++;
        }
      } else {
        const insertPayload = withClientId({
          user_id: targetUserId, creditor_name: item.creditor_name,
          account_number: accountNumber, account_number_masked: accountNumber,
          bureau, item_type: itemType, amount: item.amount,
          original_amount: item.original_amount || null,
          date_of_occurrence: item.date_of_occurrence || null,
          date_reported: item.date_reported || null,
          status, notes: item.dispute_basis, removal_probability: removalProb, is_removable: true,
        });
        const { error: insertErr } = await supabase.from("credit_negative_items").insert(insertPayload);
        if (insertErr) {
          console.error(`[NEG ${idx + 1}] Insert error:`, insertErr);
          negativeItemsFailed++;
        } else {
          negativeItemsInserted++;
        }
      }
    }
    // #734 — dropped rows (filtered before any write was attempted) are named per group so a
    // caller can reconcile input counts against inserted+updated+failed without guessing.
    results.negative_items = { inserted: negativeItemsInserted, updated: negativeItemsUpdated, failed: negativeItemsFailed, dropped: droppedNegatives.length };

    // ========== STEP 3: HARD INQUIRIES ==========
    currentStep = "hard_inquiries";
    let inquiriesInserted = 0;
    let inquiriesFailed = 0;
    for (const inq of payload.hard_inquiries) {
      const { data: existingInq } = await supabase
        .from("credit_inquiries").select("id")
        .eq("user_id", targetUserId).eq("creditor_name", inq.creditor_name).eq("inquiry_date", inq.inquiry_date)
        .maybeSingle();

      if (!existingInq) {
        // #734 — the insert reads its own error; previously the error was discarded and
        // inquiriesInserted++ ran unconditionally, counting failed writes as successes with
        // no failed counter for the group at all.
        const { error: inqErr } = await supabase.from("credit_inquiries").insert({
          user_id: targetUserId, creditor_name: inq.creditor_name, inquiry_date: inq.inquiry_date,
          bureau: inq.bureau, is_authorized: inq.is_authorized,
          status: inq.is_authorized ? "active" : "disputed",
        });
        if (inqErr) {
          console.error(`[INQ ${inq.creditor_name}] Insert error:`, inqErr);
          inquiriesFailed++;
        } else {
          inquiriesInserted++;
        }
      }
    }
    results.hard_inquiries = { inserted: inquiriesInserted, failed: inquiriesFailed, dropped: droppedInquiries.length };

    // ========== STEP 4: POSITIVE ACCOUNTS (account_number-first dedup) ==========
    currentStep = "positive_accounts";
    let accountsInserted = 0;
    let accountsUpdated = 0;
    let accountsFailed = 0;
    const accountTypeMap: Record<string, string> = {
      revolving: "credit_card", "credit card": "credit_card", credit_card: "credit_card",
      installment: "personal_loan", "auto loan": "auto_loan", auto: "auto_loan", auto_loan: "auto_loan",
      mortgage: "mortgage", "student loan": "student_loan", student_loan: "student_loan",
      collections: "collections", "personal loan": "personal_loan", personal_loan: "personal_loan",
      "secured card": "credit_card", rental: "personal_loan", open: "credit_card",
    };

    for (const acct of payload.positive_accounts) {
      const accountNumber = acct.account_number || acct.account_number_masked || null;
      const mappedType = accountTypeMap[acct.account_type?.toLowerCase()] || "credit_card";
      const normalizedName = normalizeCreditorName(acct.creditor);

      // Flag possible concatenated names (extraction errors)
      let validationFlags: any[] = [];
      if (normalizedName.length > 25) {
        validationFlags.push({ type: "possible_concatenated_name", message: "Creditor name may be concatenated from extraction error" });
      }

      // DEDUP PRIORITY 1: account_number match
      let existing: any = null;
      if (accountNumber) {
        const { data: rows } = await supabase.from("credit_accounts").select("id")
          .eq("user_id", targetUserId).eq("account_number", accountNumber);
        if (rows && rows.length > 0) existing = rows[0];
      }

      // DEDUP PRIORITY 2: normalized creditor name match (exact then fuzzy at 85%)
      if (!existing) {
        const { data: candidates } = await supabase.from("credit_accounts").select("id, creditor")
          .eq("user_id", targetUserId);
        if (candidates && candidates.length > 0) {
          // Exact normalized match first
          const exactNorm = candidates.find((c: any) => normalizeCreditorName(c.creditor) === normalizedName);
          if (exactNorm) {
            existing = exactNorm;
            // Auto-merge case-sensitivity duplicates — log it
            if (exactNorm.creditor !== acct.creditor) {
              console.log(`[DEDUP] Auto-merged case variant: "${acct.creditor}" → "${exactNorm.creditor}"`);
              await supabase.from("audit_logs").insert({
                user_id: targetUserId, entity: "credit_accounts", action: "auto_merge_case_variant",
                data: { original_name: acct.creditor, merged_into: exactNorm.creditor, account_id: exactNorm.id },
              });
            }
          } else {
            // Fuzzy match at 85%
            const fuzzy = candidates.find((c: any) => similarity(normalizeCreditorName(c.creditor), normalizedName) >= 0.85);
            if (fuzzy) existing = fuzzy;
          }
        }
      }

      const bureauSource = acct.bureau_source || null;
      const acctData: any = {
        balance: acct.balance, current_balance: acct.balance,
        credit_limit: acct.credit_limit, limit_amount: acct.credit_limit,
        utilization: acct.utilization, status: acct.status || "current",
        is_open: acct.is_open ?? true,
        account_open_date: acct.account_open_date || null,
        account_close_date: acct.date_closed || null,
        original_amount: acct.original_amount || null,
        account_number: accountNumber,
        bureau_source: bureauSource,
        updated_at: new Date().toISOString(),
      };

      if (validationFlags.length > 0) {
        acctData.needs_review = true;
        acctData.validation_flags = validationFlags;
      }

      if (existing) {
        // #734 — both branches read their own error; previously update and insert errors were
        // discarded and the counters incremented unconditionally, with no failed counter.
        const { error: acctUpdErr } = await supabase.from("credit_accounts").update(acctData).eq("id", existing.id);
        if (acctUpdErr) {
          console.error(`[ACCT ${acct.creditor}] Update error:`, acctUpdErr);
          accountsFailed++;
        } else {
          accountsUpdated++;
        }
      } else {
        const { error: acctInsErr } = await supabase.from("credit_accounts").insert(withClientId({
          user_id: targetUserId, creditor: acct.creditor, type: mappedType, ...acctData,
        }));
        if (acctInsErr) {
          console.error(`[ACCT ${acct.creditor}] Insert error:`, acctInsErr);
          accountsFailed++;
        } else {
          accountsInserted++;
        }
      }
    }
    results.positive_accounts = { inserted: accountsInserted, updated: accountsUpdated, failed: accountsFailed, dropped: droppedPositives.length };

    // ========== STEP 5: RECALCULATE CREDIT FACTOR SCORES ==========
    currentStep = "credit_factors";
    try {
      const [negRes, acctRes, inqRes] = await Promise.all([
        supabase.from("credit_negative_items").select("*").eq("user_id", targetUserId).eq("status", "active"),
        supabase.from("credit_accounts").select("*").eq("user_id", targetUserId),
        supabase.from("credit_inquiries").select("*").eq("user_id", targetUserId).eq("status", "active"),
      ]);

      const negatives = negRes.data || [];
      const accounts = acctRes.data || [];
      const inquiries = inqRes.data || [];

      // Filter out duplicates and disputed ownership from scoring
      const scorableNegatives = negatives.filter((n: any) => !n.duplicate_of_id && !n.is_disputed_ownership);
      const scorableAccounts = accounts.filter((a: any) => !a.duplicate_of_id && !a.is_disputed_ownership);

      // --- Payment History Score ---
      const chargeOffs = scorableNegatives.filter((n: any) => {
        const t = (n.item_type || "").toLowerCase();
        return t.includes("charge") || t === "charge-off" || t === "charge_off";
      });
      const collections = scorableNegatives.filter((n: any) => (n.item_type || "").toLowerCase().includes("collection"));
      const latePayments = scorableNegatives.filter((n: any) => (n.item_type || "").toLowerCase().includes("late"));
      
      let paymentHistoryScore = 100;
      paymentHistoryScore -= Math.min(chargeOffs.length * 15, 75);
      paymentHistoryScore -= Math.min(collections.length * 12, 60);
      paymentHistoryScore -= Math.min(latePayments.length * 5, 25);
      const highBalanceNegs = scorableNegatives.filter((n: any) => (n.amount || 0) > 1000);
      paymentHistoryScore -= Math.min(highBalanceNegs.length * 3, 15);
      paymentHistoryScore = Math.max(0, paymentHistoryScore);

      // --- Utilization Score ---
      const revolvingAccounts = scorableAccounts.filter((a: any) => a.type === "credit_card" && a.is_open !== false);
      const totalRevolvingBalance = revolvingAccounts.reduce((s: number, a: any) => s + (Number(a.current_balance || a.balance) || 0), 0);
      const totalRevolvingLimit = revolvingAccounts.reduce((s: number, a: any) => s + (Number(a.credit_limit || a.limit_amount) || 0), 0);
      const aggregateUtilization = totalRevolvingLimit > 0 ? (totalRevolvingBalance / totalRevolvingLimit) * 100 : 0;
      
      const cardsOver30 = revolvingAccounts.filter((a: any) => { const l = Number(a.credit_limit || a.limit_amount) || 0; const b = Number(a.current_balance || a.balance) || 0; return l > 0 && (b / l) > 0.3; }).length;
      const cardsOver50 = revolvingAccounts.filter((a: any) => { const l = Number(a.credit_limit || a.limit_amount) || 0; const b = Number(a.current_balance || a.balance) || 0; return l > 0 && (b / l) > 0.5; }).length;
      const cardsOver70 = revolvingAccounts.filter((a: any) => { const l = Number(a.credit_limit || a.limit_amount) || 0; const b = Number(a.current_balance || a.balance) || 0; return l > 0 && (b / l) > 0.7; }).length;

      let utilizationScore = 100;
      if (aggregateUtilization > 70) utilizationScore = 15;
      else if (aggregateUtilization > 50) utilizationScore = 35;
      else if (aggregateUtilization > 30) utilizationScore = 55;
      else if (aggregateUtilization > 10) utilizationScore = 80;
      utilizationScore -= Math.min(cardsOver70 * 10, 30);
      utilizationScore = Math.max(0, utilizationScore);

      // --- Credit Age Score ---
      const accountsWithDates = scorableAccounts.filter((a: any) => a.account_open_date);
      const now = new Date();
      let oldestAgeMonths = 0, newestAgeMonths = 0, avgAgeMonths = 0;

      if (accountsWithDates.length > 0) {
        const ages = accountsWithDates.map((a: any) => {
          const opened = new Date(a.account_open_date!);
          return Math.round((now.getTime() - opened.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
        });
        oldestAgeMonths = Math.max(...ages);
        newestAgeMonths = Math.min(...ages);
        avgAgeMonths = Math.round(ages.reduce((s: number, a: number) => s + a, 0) / ages.length);
      } else if (payload.oldest_account_age_months != null) {
        oldestAgeMonths = payload.oldest_account_age_months;
        avgAgeMonths = payload.average_account_age_months || oldestAgeMonths;
      }

      let creditAgeScore = 0;
      if (avgAgeMonths >= 84) creditAgeScore = 100;
      else if (avgAgeMonths >= 60) creditAgeScore = 80;
      else if (avgAgeMonths >= 36) creditAgeScore = 60;
      else if (avgAgeMonths >= 24) creditAgeScore = 45;
      else if (avgAgeMonths >= 12) creditAgeScore = 30;
      else creditAgeScore = 15;

      // --- Credit Mix Score ---
      const revolvingCount = scorableAccounts.filter((a: any) => a.type === "credit_card").length;
      const installmentCount = scorableAccounts.filter((a: any) => ["personal_loan", "auto_loan", "student_loan"].includes(a.type)).length;
      const mortgageCount = scorableAccounts.filter((a: any) => a.type === "mortgage").length;
      const typeCount = [revolvingCount > 0, installmentCount > 0, mortgageCount > 0].filter(Boolean).length;
      
      let creditMixScore = typeCount >= 3 ? 100 : typeCount === 2 ? 70 : typeCount === 1 ? 40 : 10;
      if (scorableAccounts.length >= 10) creditMixScore = Math.min(100, creditMixScore + 10);

      // --- Inquiry Score ---
      const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const inqByBureau = { tu: 0, ex: 0, eq: 0 };
      for (const inq of inquiries) {
        const b = (inq.bureau || "").toLowerCase();
        if (b.includes("trans")) inqByBureau.tu++;
        else if (b.includes("exper")) inqByBureau.ex++;
        else if (b.includes("equi")) inqByBureau.eq++;
      }
      const recentInquiries = inquiries.filter((i: any) => new Date(i.inquiry_date) >= sixMonthsAgo).length;
      let inquiryScore = 100;
      if (recentInquiries > 6) inquiryScore = 20;
      else if (recentInquiries > 4) inquiryScore = 40;
      else if (recentInquiries > 2) inquiryScore = 60;
      else if (recentInquiries > 0) inquiryScore = 80;
      const inquiryBudgetRemaining = Math.max(0, 6 - recentInquiries);

      const overallScore = Math.round(
        paymentHistoryScore * 0.35 + utilizationScore * 0.30 + creditAgeScore * 0.15 + creditMixScore * 0.10 + inquiryScore * 0.10
      );

      const factorData = {
        user_id: targetUserId,
        payment_history_score: paymentHistoryScore,
        utilization_score: utilizationScore,
        credit_age_score: creditAgeScore,
        credit_mix_score: creditMixScore,
        inquiry_score: inquiryScore,
        overall_fundability_score: overallScore,
        active_negatives: scorableNegatives.length,
        removed_negatives: 0,
        total_negatives: scorableNegatives.length,
        aggregate_utilization: Math.round(aggregateUtilization * 100) / 100,
        total_balance: totalRevolvingBalance,
        total_credit_limit: totalRevolvingLimit,
        cards_over_30_pct: cardsOver30,
        cards_over_50_pct: cardsOver50,
        cards_over_70_pct: cardsOver70,
        average_account_age_months: avgAgeMonths,
        oldest_account_age_months: oldestAgeMonths,
        newest_account_age_months: newestAgeMonths,
        revolving_count: revolvingCount,
        installment_count: installmentCount,
        mortgage_count: mortgageCount,
        total_inquiries_tu: inqByBureau.tu,
        total_inquiries_ex: inqByBureau.ex,
        total_inquiries_eq: inqByBureau.eq,
        inquiry_budget_remaining: inquiryBudgetRemaining,
        oldest_negative_date: scorableNegatives.length > 0 ? scorableNegatives.reduce((oldest: string | null, n: any) => {
          const d = n.date_of_occurrence || n.date_reported;
          return d && (!oldest || d < oldest) ? d : oldest;
        }, null as string | null) : null,
        data_sources: { chat_report_upload: new Date().toISOString() },
        calculated_at: new Date().toISOString(),
      };

      const { data: existingFactors } = await supabase
        .from("credit_factor_scores").select("id").eq("user_id", targetUserId).maybeSingle();

      // #734 — the factor write reads its own error; previously a failed update/insert still
      // left credit_factors_recalculated:true. A write error is distinct from the calculation
      // throw this step's catch already reports as factor_score_error.
      let factorWriteError: string | null = null;
      if (existingFactors) {
        const { error: fwErr } = await supabase.from("credit_factor_scores").update(factorData).eq("id", existingFactors.id);
        if (fwErr) factorWriteError = fwErr.message;
      } else {
        const { error: fwErr } = await supabase.from("credit_factor_scores").insert(withClientId(factorData));
        if (fwErr) factorWriteError = fwErr.message;
      }
      if (factorWriteError) {
        console.error("Factor score write error:", factorWriteError);
        results.credit_factors_recalculated = false;
        results.credit_factors_error = factorWriteError;
      } else {
        results.credit_factors_recalculated = true;
        results.factor_scores = {
          payment_history: paymentHistoryScore, utilization: utilizationScore,
          credit_age: creditAgeScore, credit_mix: creditMixScore, inquiries: inquiryScore, overall: overallScore,
        };
      }
    } catch (factorErr) {
      console.error("Factor score calc error:", factorErr);
      results.factor_score_error = String(factorErr);
    }

    // ========== STEP 6: AUTO-CREATE DISPUTE DRAFTS ==========
    // [§194] Auto-dispute creation removed — Paige is monitoring-only.
    currentStep = "disputes";
    results.disputes_auto_created = 0;

    // ========== STEP 7: CROSS-BUREAU DISCREPANCIES ==========
    currentStep = "discrepancies";
    const hasDiscrepancies = payload.discrepancies.length > 0;
    // #734 — the profile update is read back: an error, or an update that matched zero rows
    // (no profile), must not be reported as flagged. Previously discrepancies_flagged reported
    // the INTENT (payload content) regardless of whether anything was written.
    const { data: discRows, error: discErr } = await supabase.from("profiles").update({
      has_discrepancies: hasDiscrepancies,
      cross_bureau_discrepancies: hasDiscrepancies ? payload.discrepancies : null,
      last_report_source: "chat_upload",
      last_report_analyzed_at: new Date().toISOString(),
    }).eq("user_id", targetUserId).select("user_id");
    if (discErr) {
      console.error("Discrepancies profile update error:", discErr);
      results.discrepancies_flagged = false;
      results.discrepancies_error = discErr.message;
    } else if (!discRows || discRows.length === 0) {
      results.discrepancies_flagged = false;
      results.discrepancies_no_profile_row = true;
    } else {
      results.discrepancies_flagged = hasDiscrepancies;
    }

    // ========== STEP 8: PME FUNDING READINESS RECALCULATION ==========
    currentStep = "funding_readiness";
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("estimated_fico_eq, estimated_fico_ex, estimated_fico_tu")
        .eq("user_id", targetUserId).maybeSingle();

      if (profile) {
        const scores = [profile.estimated_fico_eq, profile.estimated_fico_ex, profile.estimated_fico_tu].filter(Boolean) as number[];
        const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;
        const personalCreditScore = avgScore > 0 ? Math.round(((avgScore - 300) / 550) * 250) : 0;

        const { data: existingReadiness } = await supabase
          .from("funding_readiness_scores")
          .select("id, business_credit_score, entity_structure_score, banking_history_score, revenue_documentation_score, lender_alignment_score")
          .eq("user_id", targetUserId).maybeSingle();

        // #734 — the readiness write reads its own error; previously both branches discarded
        // it and funding_readiness_recalculated reported true regardless.
        let readinessWriteError: string | null = null;
        if (existingReadiness) {
          const overall = personalCreditScore +
            (existingReadiness.business_credit_score || 0) + (existingReadiness.entity_structure_score || 0) +
            (existingReadiness.banking_history_score || 0) + (existingReadiness.revenue_documentation_score || 0) +
            (existingReadiness.lender_alignment_score || 0);
          const { error: frErr } = await supabase.from("funding_readiness_scores").update({
            personal_credit_score: personalCreditScore, overall_score: overall,
            last_calculated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }).eq("id", existingReadiness.id);
          if (frErr) readinessWriteError = frErr.message;
        } else {
          const { error: frErr } = await supabase.from("funding_readiness_scores").insert({
            user_id: targetUserId, personal_credit_score: personalCreditScore,
            overall_score: personalCreditScore, last_calculated_at: new Date().toISOString(),
          });
          if (frErr) readinessWriteError = frErr.message;
        }
        if (readinessWriteError) {
          console.error("Funding readiness write error:", readinessWriteError);
          results.funding_readiness_recalculated = false;
          results.funding_readiness_error = readinessWriteError;
        } else {
          results.funding_readiness_recalculated = true;
        }
      }
    } catch (frErr) {
      console.error("Funding readiness recalc error:", frErr);
    }

    // ========== STEP 9: ACTIVITY LOG ==========
    currentStep = "audit_log";
    // #734 — this step referenced `disputesCreated`, an identifier removed with the §194
    // auto-dispute block, so EVERY run threw a ReferenceError HERE — after steps 1–8 had
    // already written — and answered 500 while the writes stood: the uncertain outcome,
    // lived. The truthful value is the §194 constant the results already carry.
    const { error: syncAuditErr } = await supabase.from("audit_logs").insert({
      user_id: targetUserId, entity: "credit_report", action: "chat_report_analyzed",
      data: {
        report_type: payload.report_type,
        scores: payload.scores || null,
        negative_items_count: payload.negative_items.length,
        hard_inquiries_count: payload.hard_inquiries.length,
        positive_accounts_count: payload.positive_accounts.length,
        discrepancies_count: payload.discrepancies.length,
        disputes_auto_created: results.disputes_auto_created,
        synced_by: callerUserId, source: "chat_document_upload",
        sync_results: results,
      },
    });
    if (syncAuditErr) console.error("Sync audit-log insert error:", syncAuditErr);

    // #734 — the followups are fire-and-forget BY DESIGN: report them as initiated (their
    // outcomes are unknown at response time and are never implied to have completed). An
    // invoke that returns an error is reported under followup_errors, not swallowed.
    results.followups_initiated = [];
    results.followup_errors = {};

    // ========== STEP 10: DETECT CREDIT ALERTS ==========
    currentStep = "detect_alerts";
    try {
      const { error: alertErr } = await supabase.functions.invoke("detect-credit-alerts", {
        body: {
          client_id: targetUserId,
          new_scores: payload.scores || null,
          previous_scores: results.previous_scores || null,
          new_accounts: payload.positive_accounts || [],
          previous_accounts: results.previous_accounts || [],
          new_negatives: payload.negative_items || [],
          previous_negatives: results.previous_negatives || [],
          bureau_source: payload.report_type === "consumer" ? "all" : null,
        },
      });
      if (alertErr) {
        console.error("Alert detection failed (non-blocking):", alertErr);
        results.followup_errors["detect-credit-alerts"] = alertErr.message ?? String(alertErr);
      } else {
        results.followups_initiated.push("detect-credit-alerts");
      }
    } catch (alertErr) {
      console.error("Alert detection failed (non-blocking):", alertErr);
      results.followup_errors["detect-credit-alerts"] = alertErr instanceof Error ? alertErr.message : String(alertErr);
    }

    // ========== STEP 11: AUTO-STAGE DISPUTES (fire-and-forget) ==========
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const bureauSources = [...new Set(payload.negative_items.map((n: any) => {
        const lower = (n.bureau || "").toLowerCase();
        if (lower.includes("trans")) return "transunion";
        if (lower.includes("exper")) return "experian";
        if (lower.includes("equi")) return "equifax";
        return lower;
      }).filter(Boolean))];

      fetch(`${supabaseUrl}/functions/v1/auto-stage-disputes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          client_id: targetUserId,
          bureau_source: bureauSources.length === 1 ? bureauSources[0] : "all",
        }),
      }).catch(err => console.error("Auto-stage-disputes fire-and-forget failed:", err));
      // The call was placed; its outcome is unknown at response time by design.
      results.followups_initiated.push("auto-stage-disputes");
    } catch (stageErr) {
      console.error("Auto-stage-disputes setup failed (non-blocking):", stageErr);
    }

    // ========== STEP 12: GENERATE PREDICTIONS (fire-and-forget) ==========
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      fetch(`${supabaseUrl}/functions/v1/generate-credit-predictions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ user_id: targetUserId }),
      }).catch(err => console.error("generate-credit-predictions fire-and-forget failed:", err));
      results.followups_initiated.push("generate-credit-predictions");
    } catch (predErr) {
      console.error("Predictions setup failed (non-blocking):", predErr);
    }

    // ========== OUTCOME CLASSIFICATION (#734) ==========
    //
    // Additive summary a caller can classify from without re-deriving per-group counts:
    //   complete — every attempted write landed (dropped rows were never attempted);
    //   partial  — some writes landed, or a group was skipped (no row to write to);
    //   failed   — writes were attempted and NONE landed anywhere.
    // Only the four PAYLOAD groups (scores, negative_items, hard_inquiries, positive_accounts)
    // can make a run not-a-total-failure: a derived recalc landing while every requested row
    // failed must not dress that up as success. Derived groups (credit_factors, discrepancies,
    // funding_readiness) still surface their own failures in failed_groups. The fire-and-forget
    // followups are excluded entirely: initiated ≠ completed, and their outcomes stay unknown
    // at response time by design.
    currentStep = "outcome";
    const failedGroups: string[] = [];
    const skippedGroups: string[] = [];
    const groupsAttempted: string[] = [];
    let anyRequestedWriteSucceeded = false;

    if (payload.scores) {
      groupsAttempted.push("scores");
      if (results.scores_error) failedGroups.push("scores");
      else if (results.scores_no_profile_row) skippedGroups.push("scores");
      else if (results.scores_updated === true) anyRequestedWriteSucceeded = true;
    }
    const negRes = results.negative_items;
    if (negRes && negRes.inserted + negRes.updated + negRes.failed > 0) {
      groupsAttempted.push("negative_items");
      if (negRes.failed > 0) failedGroups.push("negative_items");
      if (negRes.inserted + negRes.updated > 0) anyRequestedWriteSucceeded = true;
    }
    const inqRes = results.hard_inquiries;
    if (inqRes && inqRes.inserted + inqRes.failed > 0) {
      groupsAttempted.push("hard_inquiries");
      if (inqRes.failed > 0) failedGroups.push("hard_inquiries");
      if (inqRes.inserted > 0) anyRequestedWriteSucceeded = true;
    }
    const acctRes = results.positive_accounts;
    if (acctRes && acctRes.inserted + acctRes.updated + acctRes.failed > 0) {
      groupsAttempted.push("positive_accounts");
      if (acctRes.failed > 0) failedGroups.push("positive_accounts");
      if (acctRes.inserted + acctRes.updated > 0) anyRequestedWriteSucceeded = true;
    }
    if (results.credit_factors_recalculated === true || results.credit_factors_error || results.factor_score_error) {
      groupsAttempted.push("credit_factors");
      if (results.credit_factors_recalculated !== true) failedGroups.push("credit_factors");
    }
    // The discrepancies profile write always runs; its readback classifies it.
    groupsAttempted.push("discrepancies");
    if (results.discrepancies_error) failedGroups.push("discrepancies");
    else if (results.discrepancies_no_profile_row) skippedGroups.push("discrepancies");
    if (results.funding_readiness_recalculated === true || results.funding_readiness_error) {
      groupsAttempted.push("funding_readiness");
      if (results.funding_readiness_recalculated !== true) failedGroups.push("funding_readiness");
    }

    let outcomeStatus: "complete" | "partial" | "failed";
    if (failedGroups.length === 0 && skippedGroups.length === 0) outcomeStatus = "complete";
    else if (!anyRequestedWriteSucceeded && failedGroups.length > 0) outcomeStatus = "failed";
    else outcomeStatus = "partial";

    results.outcome = {
      status: outcomeStatus,
      groups_attempted: groupsAttempted,
      failed_groups: failedGroups,
      skipped_groups: skippedGroups,
    };

    // success is now a claim about the writes: false only when writes were attempted and
    // none landed. A partial run keeps success:true — writes DID land, and the per-group
    // evidence + outcome.status carry the failure detail for the caller to act on.
    const allWritesFailed = outcomeStatus === "failed";
    return new Response(JSON.stringify({ success: !allWritesFailed, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`Sync error at step '${currentStep}':`, error);
    // #734 — an unexpected throw can happen AFTER earlier writes landed; the response must
    // not force callers to guess what stood. partial_results carries what the callee had
    // recorded before the failure (the caller treats a 500 as an UNCERTAIN outcome, never
    // as "nothing happened").
    return new Response(JSON.stringify({ error: "Internal error", failed_step: currentStep, message: error instanceof Error ? error.message : "Unknown", partial_results: results }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
