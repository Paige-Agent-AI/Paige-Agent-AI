import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gatewayCompat } from "../_shared/claude.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
// N5 §2/§9 — the funding methodology corpus is no longer bundled into platform code;
// it lives in the installable Marketplace funding preset (tenant KB). This extraction
// pass parses the report structure and does not need the coaching methodology inline.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DOCUMENT_SOURCE_INSTRUCTION = `You are analyzing a specific PDF document that has been provided to you. You must ONLY report information that you can directly read from this document. Do not use your training data or prior knowledge to fill in account details, creditor names, balances, or scores. If you cannot read a specific piece of information from the document, state "Not visible in document" rather than providing an estimate or assumption. Every account name, balance, score, and date you report must be directly extractable from the uploaded document text.`;

const READ_CHECK_PROMPT = `${DOCUMENT_SOURCE_INSTRUCTION}

Before any analysis, verify that you can literally read the PDF. Return ONLY valid JSON with this exact structure:
{
  "document_kind": "credit_report" | "business_credit_report" | "financial_document" | "other",
  "report_category": "consumer" | "business" | "unknown",
  "can_read_document": boolean,
  "parse_error": "string or null",
  "visible_text_excerpt": "string — 2 to 6 exact lines copied from the document",
  "first_five_account_names": ["string"],
  "directly_read_account_count": number,
  "confidence_statement": "I was able to directly read N accounts from this document",
  "fraud_alerts_visible": boolean,
  "visible_scores": {
    "equifax": number or null,
    "experian": number or null,
    "transunion": number or null
  },
  "consumer_indicators": {
    "has_ssn": boolean,
    "has_personal_name": boolean,
    "consumer_bureaus_detected": ["Experian", "TransUnion", "Equifax"]
  },
  "business_indicators": {
    "has_ein": boolean,
    "has_business_name_as_primary": boolean,
    "business_bureaus_detected": ["D&B", "Experian Business", "Equifax Business", "FICO SBSS"]
  }
}

Rules:
- The account names must be literal names visible in the PDF, not guesses.
- Determine report_category: if you see a Social Security Number, personal name as primary borrower, and consumer bureau names (Experian, TransUnion, Equifax) → "consumer". If you see an EIN, business name as primary, and business bureau names (D&B, Experian Business, Equifax Business, FICO SBSS) → "business". Otherwise "unknown".
- If this is a tri-merge credit report, identify the first five tradeline or collection account names you can actually read.
- If you cannot read any account names from a credit report, set can_read_document to false and parse_error to "Unable to parse document content — please ensure the uploaded file is a readable PDF credit report".
- Do not include markdown.`;

const CREDIT_REPORT_EXTRACTION_PROMPT = `${DOCUMENT_SOURCE_INSTRUCTION}

You are extracting a consumer tri-merge credit report into structured JSON.

=== REPORT TYPE VALIDATION ===
This function processes CONSUMER credit reports ONLY. If the document is a business credit report (contains EIN as primary identifier, business name as primary borrower, or business bureau names like D&B, Experian Business, Equifax Business, FICO SBSS), set report_type to "business" and return minimal data — do not extract accounts.

=== SCORE MODEL DETECTION ===
Determine the scoring model used in this report. Look at the document header, footer, and score section for explicit mentions of "FICO", "VantageScore", or the provider name.
- MyFreeScoreNow, myFICO, Experian FICO → score_model = "FICO"
- Credit Karma, Credit Sesame, NerdWallet, VantageScore → score_model = "VantageScore"
- If the report explicitly says "FICO Score" or "FICO® Score" → "FICO"
- If the report explicitly says "VantageScore" → "VantageScore"
- If the model cannot be determined → "Unknown"

=== TRI-MERGE FORMAT RECOGNITION ===
Tri-merge reports present each account in a three-column format: TransUnion (left), Experian (middle), Equifax (right). Each account section shows which bureaus report it. Dashes (--) in a column mean the account is NOT reported at that bureau. You MUST read each column independently and correctly identify which bureaus report each account. An account with data in one column and dashes in the other two reports to only ONE bureau. This bureau-specific reporting is critical for dispute targeting.

=== ACCOUNT NUMBER EXTRACTION (CRITICAL) ===
For EVERY account — positive or negative — you MUST extract the account number exactly as it appears on the report. Most bureaus show partial/masked numbers like "XXXX-XXXX-1234" or "****1234" or "5678". Extract exactly what is printed. NEVER fabricate, guess, or infer an account number. If no account number is visible for an account, set account_number to null. Account numbers are the definitive identifier for deduplication — without them the system cannot reliably distinguish between separate accounts.

=== FRAUD ALERT & SECURITY FREEZE DETECTION (HIGHEST PRIORITY) ===
Check the Consumer Statement section at the top of the report FIRST.
- FRAUD ALERTS: If an Initial Fraud Alert, Extended Fraud Alert, or ID Security Alert is present, extract it immediately. Record: alert type, which bureaus have it active, expiration date if listed.
- SECURITY FREEZES: If a security freeze is noted on any bureau, extract it. A freeze prevents new credit from being opened at that bureau — any application will be auto-declined unless lifted.

=== NEGATIVE ITEM EXTRACTION — ALL TYPES ===
Extract and categorize ALL of the following:
1. Collection/Charge-off accounts — current balance owed, original creditor name (from "Original Creditor" field), which bureaus report them
2. Late payment history — even if account is now current. Extract late dates from "Days Late" section and Two-Year Payment History grid. Record as separate items with late_payment type.
3. Collection accounts placed with agencies — extract original creditor from "Original Creditor" field
4. Derogatory remarks: "Profit and Loss Write-Off", "Unpaid Balance Reported as Loss", "Charged Off as Bad Debt" or similar creditor remarks
5. Public records: bankruptcies, tax liens, judgments, civil suits

=== CROSS-BUREAU DISCREPANCY DETECTION ===
After extracting all accounts, compare the same debt across bureaus. Flag as high-priority dispute targets:
- Same debt under different tradeline names at different bureaus (e.g., "JEFFERSON CAPITAL SYST" vs "JEFFCAPSYS")
- Same debt appearing at some bureaus but not others, especially large balances
- Same account showing different balances at different bureaus
- Same account showing different open dates or status at different bureaus
Each discrepancy is an FCRA Section 611 dispute target.

=== DISPUTE BASIS LANGUAGE — LEGITIMATE STATUTORY GROUNDS ONLY ===
- Charge-off accounts: "Requesting verification of accuracy and completeness pursuant to FCRA Section 611. Please provide original account agreement and payment history."
- Collection accounts: "Requesting full validation pursuant to FDCPA Section 809(b). Provide verification of original creditor, original amount, and authority to collect."
- Cross-bureau discrepancies: "Account reported inconsistently across bureaus in violation of FCRA Section 623(a)(1) accuracy requirements. Requesting correction."
- Not mine / unknown: "No knowledge of this account. Requesting removal pursuant to FCRA Section 611 and method of verification used."
- Unauthorized inquiries: "Did not authorize this inquiry. Requesting removal pursuant to FCRA Section 604."
NEVER fabricate creditor agreements or promises that do not exist in the report.

=== PRIORITY RANKING ===
Rank negative items for dispute priority:
1. Single-bureau items with large balances (highest success rate, isolated impact)
2. Cross-bureau discrepancies (strongest dispute basis under FCRA)
3. Most recent charge-offs with highest balances (suppress scores most)
4. Older items with smaller balances (less impact but cleanable)
5. Third-party collection accounts (disputable for validation)

Return ONLY valid JSON with this exact structure:
{
  "report_type": "consumer" | "business",
  "bureau_detected": "string",
  "fraud_alerts": [
    {
      "alert_type": "string",
      "bureaus": ["TransUnion", "Experian", "Equifax"],
      "expiration_date": "YYYY-MM-DD or null",
      "note": "string"
    }
  ],
  "security_freezes": [
    {
      "bureau": "string",
      "status": "active" | "temporary_lift",
      "note": "string"
    }
  ],
  "scores": {
    "equifax": number or null,
    "experian": number or null,
    "transunion": number or null
  },
  "score_model": "FICO" | "VantageScore" | "Unknown",
  "profile_summary": "string",
  "estimated_total_score_impact": number,
  "personal_information": {
    "name_variations": [
      {
        "value": "string — full name as printed on the report",
        "bureau_source": "experian" | "transunion" | "equifax" | "all_three"
      }
    ],
    "addresses": [
      {
        "value": "string — full address as printed",
        "bureau_source": "experian" | "transunion" | "equifax" | "all_three",
        "date_range": "string or null — date range if shown e.g. '01/2020 - Present'"
      }
    ],
    "employers": [
      {
        "value": "string — employer name as printed",
        "bureau_source": "experian" | "transunion" | "equifax" | "all_three",
        "date_range": "string or null"
      }
    ],
    "phones": [
      {
        "value": "string — phone number as printed",
        "bureau_source": "experian" | "transunion" | "equifax" | "all_three"
      }
    ],
    "date_of_birth": "string or null — as printed on report (YYYY-MM-DD if possible)",
    "ssn_last_4": "string or null — last 4 digits of SSN if visible on the report (e.g. '1234'), otherwise null",
    "ssn_variations_detected": boolean
  },
  "negative_items": [
    {
      "category": "late_payment" | "collection" | "charge_off" | "hard_inquiry" | "public_record" | "repossession" | "foreclosure" | "bankruptcy" | "tax_lien" | "judgment" | "other",
      "creditor_name": "string — exact name as printed on the report",
      "original_creditor": "string or null",
      "account_number": "string or null — exact masked/partial number as printed on the report, e.g. XXXX1234. NEVER fabricate.",
      "account_number_masked": "string or null — same as account_number for backwards compatibility",
      "amount": number or null,
      "original_amount": number or null,
      "date_reported": "YYYY-MM-DD or null",
      "date_of_occurrence": "YYYY-MM-DD or null",
      "date_opened": "YYYY-MM-DD or null",
      "date_closed": "YYYY-MM-DD or null",
      "date_of_last_activity": "YYYY-MM-DD or null",
      "bureaus_reporting": ["TransUnion", "Experian", "Equifax"],
      "bureau": "string",
      "status": "string — exact status as printed: Open, Closed, Paid, Collection, Charge-off, etc.",
      "account_type": "string — exact type as printed: Revolving, Installment, Mortgage, Automobile, Open, Collection, etc.",
      "responsibility": "Individual" | "Joint" | "Authorized User" | "Co-signer" | null,
      "payment_history_percentage": number or null,
      "creditor_remarks": "string or null",
      "estimated_score_impact": number,
      "is_disputable": boolean,
      "dispute_reason_suggestion": "string",
      "dispute_priority": number,
      "notes": "string"
    }
  ],
  "cross_bureau_discrepancies": [
    {
      "account_name": "string",
      "account_number": "string or null",
      "issue": "string",
      "bureaus_affected": ["string"],
      "dispute_basis": "FCRA Section 623(a)(1) — inconsistent reporting across bureaus"
    }
  ],
  "positive_accounts": [
    {
      "creditor": "string — exact creditor name as printed on the report",
      "account_number": "string or null — exact masked/partial number as printed. NEVER fabricate.",
      "account_type": "revolving" | "installment" | "mortgage" | "auto_loan" | "student_loan" | "other",
      "balance": number or null,
      "credit_limit": number or null,
      "original_amount": number or null,
      "utilization": number or null,
      "payment_status": "string",
      "payment_history_percentage": number or null,
      "account_age_months": number or null,
      "is_open": boolean,
      "opened_date": "YYYY-MM-DD or null",
      "date_closed": "YYYY-MM-DD or null",
      "date_of_last_activity": "YYYY-MM-DD or null",
      "responsibility": "Individual" | "Joint" | "Authorized User" | null,
      "bureaus_reporting": ["string"]
    }
  ],
  "payment_history_summary": {
    "on_time_percentage": number or null,
    "total_accounts": number,
    "accounts_in_good_standing": number,
    "accounts_with_issues": number
  },
  "hard_inquiries": [
    {
      "creditor_name": "string",
      "date": "YYYY-MM-DD",
      "bureau": "string",
      "is_authorized": boolean
    }
  ],
  "public_records": [
    {
      "type": "string",
      "filed_date": "YYYY-MM-DD or null",
      "amount": number or null,
      "status": "string"
    }
  ],
  "credit_age": {
    "oldest_account_months": number or null,
    "average_account_age_months": number or null,
    "newest_account_months": number or null
  },
  "funding_strategy_summary": "string",
  "document_verification": {
    "visible_text_excerpt": "string",
    "first_five_account_names": ["string"],
    "directly_read_account_count": number,
    "confidence_statement": "I was able to directly read N accounts from this document",
    "fraud_alerts_visible": boolean
  }
}

PERSONAL INFORMATION EXTRACTION RULES:
- Look for the "Personal Information" or "Consumer Information" section at the top of the report
- Extract ALL name variations, including maiden names, aliases, AKAs
- Extract ALL addresses with their date ranges if shown
- Extract ALL employers with date ranges if shown
- Extract ALL phone numbers listed
- For each item, determine which bureau(s) reported it by reading the tri-merge columns
- If an item appears in all three bureau columns, set bureau_source to "all_three"
- If the report shows multiple SSN fragments or variations, set ssn_variations_detected to true
- Extract the date of birth exactly as printed

ACCOUNT NUMBER RULES (NON-NEGOTIABLE):
- For every positive_account: extract "account_number" exactly as shown on the report
- For every negative_item: extract "account_number" and also copy to "account_number_masked" for backwards compatibility
- If the account number is not visible, set both fields to null
- NEVER guess or fabricate account numbers — accuracy is critical for deduplication

Use the verified read-check below as hard evidence. If your extraction conflicts with the verified read-check, leave the conflicting field null instead of inventing a value.
`;

class AIRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let uploadId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rateLimitOk } = await supabase.rpc("check_rate_limit", {
      _user_id: user.id,
      _function_name: "analyze-credit-report",
      _max_requests: 10,
      _window_minutes: 60,
    });

    if (!rateLimitOk) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again in an hour.", retryAfter: 3600 }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "3600" } },
      );
    }

    const requestBody = await req.json();
    uploadId = requestBody.uploadId;

    if (!uploadId) {
      return new Response(JSON.stringify({ error: "uploadId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: upload, error: uploadError } = await supabase
      .from("credit_report_uploads")
      .select("*")
      .eq("id", uploadId)
      .single();

    if (uploadError || !upload) {
      return new Response(JSON.stringify({ error: "Upload not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ownership check: only the upload's owner or an admin may analyze.
    if (upload.user_id !== user.id) {
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    await supabase
      .from("credit_report_uploads")
      .update({ analysis_status: "processing", error_message: null })
      .eq("id", uploadId);

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("credit-report-uploads")
      .download(upload.file_path);

    if (downloadError || !fileData) {
      return await failUpload(supabase, uploadId, "Failed to download file", 500);
    }

    const base64 = arrayBufferToBase64(await fileData.arrayBuffer());
    const readCheck = await runReadCheck(base64);

    // Check if this is a business report — reject early
    if (readCheck.report_category === "business") {
      const message = "This appears to be a business credit report. Business credit reports are analyzed in the Business Profile tab under Business Credit. Please upload this report there.";
      await supabase.from("credit_report_uploads").update({
        analysis_status: "failed",
        error_message: message,
        report_type: "business",
      }).eq("id", uploadId);
      return new Response(JSON.stringify({ error: message, report_type: "business", redirect: "/app?tab=business-credit" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!readCheck.can_read_document || readCheck.document_kind === "other" || readCheck.directly_read_account_count < 1 || (readCheck.first_five_account_names || []).length < 1) {
      const message = readCheck.parse_error || "Unable to parse document content — please ensure the uploaded file is a readable PDF credit report";
      await logAuditFailure(supabase, user.id, uploadId, "read_check_failed", {
        read_check: readCheck,
        file_name: upload.file_name,
      });
      return await failUpload(supabase, uploadId, message, 422);
    }

    const analysisResult = await runStructuredExtraction(base64, readCheck);

    // Double-check: if AI says it's a business report, reject
    if (analysisResult.report_type === "business") {
      const message = "This appears to be a business credit report. Business credit reports are analyzed in the Business Profile tab under Business Credit. Please upload this report there.";
      await supabase.from("credit_report_uploads").update({
        analysis_status: "failed",
        error_message: message,
        report_type: "business",
      }).eq("id", uploadId);
      return new Response(JSON.stringify({ error: message, report_type: "business", redirect: "/app?tab=business-credit" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    analysisResult.document_verification = {
      visible_text_excerpt: readCheck.visible_text_excerpt || "",
      first_five_account_names: readCheck.first_five_account_names || [],
      directly_read_account_count: readCheck.directly_read_account_count || 0,
      confidence_statement: readCheck.confidence_statement || `I was able to directly read ${readCheck.directly_read_account_count || 0} accounts from this document`,
      fraud_alerts_visible: Boolean(readCheck.fraud_alerts_visible),
    };

    const validationErrors = validateStructuredExtraction(analysisResult, readCheck);
    if (validationErrors.length > 0) {
      await logAuditFailure(supabase, user.id, uploadId, "structured_extraction_validation_failed", {
        validation_errors: validationErrors,
        read_check: readCheck,
        analysis_result: analysisResult,
      });
      return await failUpload(
        supabase,
        uploadId,
        validationErrors[0] || "Unable to parse document content — please ensure the uploaded file is a readable PDF credit report",
        422,
      );
    }

    // Run bureau accuracy validation pass
    const validationFlags = runBureauValidation(analysisResult);

    const { error: updateError } = await supabase
      .from("credit_report_uploads")
      .update({
        analysis_status: "completed",
        report_type: analysisResult.report_type || "consumer",
        bureau_detected: analysisResult.bureau_detected,
        analysis_result: { ...analysisResult, validation_flags: validationFlags },
        negative_items_extracted: analysisResult.negative_items || [],
        positive_accounts_extracted: analysisResult.positive_accounts || [],
        profile_summary: analysisResult.profile_summary,
        estimated_score_impact: analysisResult.estimated_total_score_impact || 0,
        error_message: null,
        last_analyzed_at: new Date().toISOString(),
      })
      .eq("id", uploadId);

    if (updateError) {
      console.error("Failed to save analysis:", updateError);
      return new Response(JSON.stringify({ error: "Failed to save analysis results" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract and store personal information
    const personalInfo = analysisResult.personal_information;
    if (personalInfo) {
      const piRecords: any[] = [];
      const targetUserId = upload.user_id;
      const clientId = upload.client_id || null;

      for (const name of (personalInfo.name_variations || [])) {
        piRecords.push({
          user_id: targetUserId, client_id: clientId, credit_report_upload_id: uploadId,
          field_type: "name", field_value: name.value, bureau_source: name.bureau_source || "unknown",
        });
      }
      for (const addr of (personalInfo.addresses || [])) {
        piRecords.push({
          user_id: targetUserId, client_id: clientId, credit_report_upload_id: uploadId,
          field_type: "address", field_value: addr.value, bureau_source: addr.bureau_source || "unknown",
          date_range: addr.date_range || null,
        });
      }
      for (const emp of (personalInfo.employers || [])) {
        piRecords.push({
          user_id: targetUserId, client_id: clientId, credit_report_upload_id: uploadId,
          field_type: "employer", field_value: emp.value, bureau_source: emp.bureau_source || "unknown",
          date_range: emp.date_range || null,
        });
      }
      for (const phone of (personalInfo.phones || [])) {
        piRecords.push({
          user_id: targetUserId, client_id: clientId, credit_report_upload_id: uploadId,
          field_type: "phone", field_value: phone.value, bureau_source: phone.bureau_source || "unknown",
        });
      }
      if (personalInfo.date_of_birth) {
        piRecords.push({
          user_id: targetUserId, client_id: clientId, credit_report_upload_id: uploadId,
          field_type: "dob", field_value: personalInfo.date_of_birth, bureau_source: "all_three",
        });
      }
      if (personalInfo.ssn_variations_detected) {
        piRecords.push({
          user_id: targetUserId, client_id: clientId, credit_report_upload_id: uploadId,
          field_type: "ssn_variation", field_value: "Multiple SSN variations detected", bureau_source: "all_three",
        });
      }

      if (piRecords.length > 0) {
        const { error: piError } = await supabase.from("credit_report_personal_info").insert(piRecords);
        if (piError) console.error("Failed to insert personal info:", piError);
      }

      // === Mirror primary identity fields onto profiles + linked clients row ===
      // Pick the most recent / first-listed name, address, phone for canonical fields.
      try {
        const primaryName = personalInfo.name_variations?.[0]?.value || null;
        const primaryAddressRaw = personalInfo.addresses?.[0]?.value || null;
        const primaryPhone = personalInfo.phones?.[0]?.value || null;
        const dob = personalInfo.date_of_birth || null;

        // Parse "123 Main St, Atlanta, GA 30301" → {street, city, state, zip}
        const parseAddress = (addr: string | null) => {
          if (!addr) return { street: null as string | null, city: null as string | null, state: null as string | null, zip: null as string | null };
          const parts = addr.split(",").map(p => p.trim()).filter(Boolean);
          let street = parts[0] || null;
          let city: string | null = null;
          let state: string | null = null;
          let zip: string | null = null;
          if (parts.length >= 2) {
            city = parts[1];
            const last = parts[parts.length - 1];
            const m = last.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
            if (m) {
              state = m[1].toUpperCase();
              zip = m[2];
            } else {
              const m2 = last.match(/(\d{5}(?:-\d{4})?)/);
              if (m2) zip = m2[1];
              const m3 = last.match(/\b([A-Z]{2})\b/i);
              if (m3) state = m3[1].toUpperCase();
            }
          }
          return { street, city, state, zip };
        };

        const addr = parseAddress(primaryAddressRaw);
        const ssnLast4 = personalInfo.ssn_last_4 || null;

        // Build profile patch — only fill blanks (never overwrite client-entered data) except for phone/address which we always refresh from latest report
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("full_name, phone, address, city, state, date_of_birth, ssn_last_4")
          .eq("user_id", targetUserId)
          .maybeSingle();

        if (existingProfile) {
          const patch: Record<string, any> = {};
          if (primaryName && !existingProfile.full_name) patch.full_name = primaryName;
          if (primaryPhone) patch.phone = primaryPhone;
          if (addr.street) patch.address = addr.street;
          if (addr.city) patch.city = addr.city;
          if (addr.state) patch.state = addr.state;
          if (dob && !existingProfile.date_of_birth) patch.date_of_birth = dob;
          if (ssnLast4 && !existingProfile.ssn_last_4) patch.ssn_last_4 = ssnLast4;

          if (Object.keys(patch).length > 0) {
            const { error: profErr } = await supabase
              .from("profiles")
              .update(patch)
              .eq("user_id", targetUserId);
            if (profErr) console.error("[analyze-credit-report] profile mirror failed:", profErr);
            else console.log("[analyze-credit-report] mirrored to profile:", Object.keys(patch));
          }
        }

        // Mirror onto linked clients row (CRM record visible to admins/coaches)
        const linkedClientId = clientId || null;
        if (linkedClientId || targetUserId) {
          // Find the clients row either by explicit clientId or by linked_user_id
          const clientQuery = linkedClientId
            ? supabase.from("clients").select("id, first_name, last_name, phone, street_address, city, state, zip_code").eq("id", linkedClientId).maybeSingle()
            : supabase.from("clients").select("id, first_name, last_name, phone, street_address, city, state, zip_code").eq("linked_user_id", targetUserId).maybeSingle();

          const { data: clientRow } = await clientQuery;
          if (clientRow) {
            const cPatch: Record<string, any> = {};
            // Split full name → first/last only when blank
            if (primaryName) {
              const nameParts = primaryName.trim().split(/\s+/);
              const first = nameParts[0];
              const last = nameParts.slice(1).join(" ");
              if (first && !clientRow.first_name) cPatch.first_name = first;
              if (last && !clientRow.last_name) cPatch.last_name = last;
            }
            if (primaryPhone) cPatch.phone = primaryPhone;
            if (addr.street) cPatch.street_address = addr.street;
            if (addr.city) cPatch.city = addr.city;
            if (addr.state) cPatch.state = addr.state;
            if (addr.zip) cPatch.zip_code = addr.zip;

            if (Object.keys(cPatch).length > 0) {
              const { error: cErr } = await supabase.from("clients").update(cPatch).eq("id", clientRow.id);
              if (cErr) console.error("[analyze-credit-report] client mirror failed:", cErr);
              else console.log("[analyze-credit-report] mirrored to client row:", clientRow.id, Object.keys(cPatch));
            }
          }
        }
      } catch (mirrorErr) {
        console.error("[analyze-credit-report] identity mirror exception:", mirrorErr);
      }
    }

    await supabase.from("audit_logs").insert({
      user_id: user.id,
      entity: "credit_report_upload",
      action: "ai_analysis_completed",
      entity_id: uploadId,
      data: {
        report_type: analysisResult.report_type,
        bureau_detected: analysisResult.bureau_detected,
        negative_items_count: analysisResult.negative_items?.length || 0,
        positive_accounts_count: analysisResult.positive_accounts?.length || 0,
        fraud_alerts_count: analysisResult.fraud_alerts?.length || 0,
        security_freezes_count: analysisResult.security_freezes?.length || 0,
        discrepancies_count: analysisResult.cross_bureau_discrepancies?.length || 0,
        personal_info_count: personalInfo ? (personalInfo.name_variations?.length || 0) + (personalInfo.addresses?.length || 0) + (personalInfo.employers?.length || 0) + (personalInfo.phones?.length || 0) : 0,
        document_verification: analysisResult.document_verification,
        validation_flags: validationFlags,
      },
    });

    // === Auto-sync structured data into credit_accounts / credit_negative_items / credit_factor_scores ===
    // Only consumer reports go through this sync; business reports use a different pipeline.
    let syncResult: any = null;
    let syncError: string | null = null;
    const reportTypeForSync = (analysisResult.report_type || "consumer").toLowerCase();
    if (reportTypeForSync === "consumer") {
      try {
        const syncPayload = {
          target_user_id: upload.user_id,
          report_type: "consumer",
          scores: analysisResult.scores,
          score_model: analysisResult.score_model,
          negative_items: (analysisResult.negative_items || []).map((item: any) => ({
            creditor_name: item.creditor_name,
            account_number: item.account_number || item.account_number_masked || null,
            account_number_masked: item.account_number || item.account_number_masked || null,
            bureau: item.bureau || item.bureaus_reporting?.[0] || "unknown",
            item_type: item.category || "collection",
            amount: item.amount,
            original_amount: item.original_amount || null,
            date_of_occurrence: item.date_of_occurrence,
            date_reported: item.date_reported,
            dispute_basis: item.dispute_reason_suggestion,
            estimated_score_impact: item.estimated_score_impact,
            status: item.status || "active",
          })),
          hard_inquiries: analysisResult.hard_inquiries || [],
          positive_accounts: (analysisResult.positive_accounts || []).map((acct: any) => ({
            creditor: acct.creditor,
            account_number: acct.account_number || null,
            account_type: acct.account_type,
            balance: acct.balance,
            credit_limit: acct.credit_limit,
            original_amount: acct.original_amount || null,
            utilization: acct.utilization,
            payment_status: acct.payment_status,
            payment_history_percentage: acct.payment_history_percentage || null,
            account_open_date: acct.opened_date,
            date_closed: acct.date_closed || null,
            is_open: acct.is_open,
            responsibility: acct.responsibility || null,
          })),
          discrepancies: analysisResult.cross_bureau_discrepancies || [],
          priority_disputes: [],
          report_upload_id: uploadId,
          fraud_alerts: analysisResult.fraud_alerts,
          security_freezes: analysisResult.security_freezes,
          validation_flags: validationFlags,
        };

        const syncResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-credit-report-data`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Service role lets the sync run for the report's actual owner, regardless of who triggered analysis (admin, coach, or client)
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify(syncPayload),
        });

        if (!syncResp.ok) {
          syncError = `sync-credit-report-data returned ${syncResp.status}`;
          console.error("[ANALYZE] Auto-sync failed:", syncError, await syncResp.text().catch(() => ""));
        } else {
          syncResult = await syncResp.json().catch(() => ({ success: true }));
          console.log("[ANALYZE] Auto-sync complete for upload", uploadId);
        }
      } catch (e: any) {
        syncError = e?.message || "Unknown sync error";
        console.error("[ANALYZE] Auto-sync threw:", syncError);
      }

      await supabase.from("audit_logs").insert({
        user_id: upload.user_id,
        entity: "credit_report_upload",
        action: syncError ? "auto_sync_failed" : "auto_sync_completed",
        entity_id: uploadId,
        data: { sync_error: syncError, sync_result: syncResult ? { ok: true } : null },
      });
    }

    return new Response(JSON.stringify({ success: true, analysis: analysisResult, validation_flags: validationFlags, sync: { ok: !syncError, error: syncError } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error(`[ANALYZE-REPORT-ERROR-${errorId}]`, error instanceof Error ? error.message : "Unknown");

    if (uploadId && error instanceof AIRequestError) {
      await createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
        .from("credit_report_uploads")
        .update({ analysis_status: "failed", error_message: error.message })
        .eq("id", uploadId);
    }

    const status = error instanceof AIRequestError ? (error.status === 429 || error.status === 402 ? error.status : 500) : 500;
    const message = error instanceof AIRequestError ? error.message : "An error occurred while processing your request";

    return new Response(JSON.stringify({ error: message, errorId }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function runReadCheck(base64: string) {
  return await callAiJson(
    READ_CHECK_PROMPT,
    [
      { type: "text", text: "Perform the read-check on this uploaded PDF credit report before any analysis." },
      { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
    ],
    "google/gemini-2.5-pro",
  );
}

async function runStructuredExtraction(base64: string, readCheck: any) {
  const prompt = `${CREDIT_REPORT_EXTRACTION_PROMPT}
=== VERIFIED READ CHECK ===
${JSON.stringify(readCheck, null, 2)}
=== END VERIFIED READ CHECK ===`;

  return await callAiJson(
    prompt,
    [
      { type: "text", text: "Extract the structured credit report data from this uploaded PDF using only document-visible facts." },
      { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
    ],
    "google/gemini-2.5-pro",
  );
}

async function callAiJson(systemPrompt: string, userContent: any[], model: string) {
  const response = await gatewayCompat("anthropic", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const statusMessage = response.status === 429
      ? "Rate limits exceeded, please try again later."
      : response.status === 402
        ? "Payment required — the AI provider reported a billing/quota issue."
        : "AI analysis failed. Please try again.";
    throw new AIRequestError(response.status, statusMessage);
  }

  const aiData = await response.json();
  const rawContent = cleanJsonResponse(aiData.choices?.[0]?.message?.content || "");

  try {
    return JSON.parse(rawContent);
  } catch (_error) {
    throw new Error("Failed to parse AI analysis result");
  }
}

function runBureauValidation(analysisResult: any): any[] {
  const flags: any[] = [];
  const reportBureau = (analysisResult.bureau_detected || "").toLowerCase();

  const allAccounts = [
    ...(analysisResult.positive_accounts || []).map((a: any) => ({ ...a, _source: "positive", _name: a.creditor })),
    ...(analysisResult.negative_items || []).map((a: any) => ({ ...a, _source: "negative", _name: a.creditor_name })),
  ];

  const accountNumbersSeen = new Map<string, any[]>();

  for (const acct of allAccounts) {
    const acctNum = acct.account_number || acct.account_number_masked;

    // Flag placeholder account numbers
    if (acctNum) {
      const stripped = acctNum.replace(/[^0-9a-zA-Z]/g, "");
      if (/^(X+|0+)$/i.test(stripped) || stripped.length === 0) {
        flags.push({
          type: "masked_account_number",
          account: acct._name,
          account_number: acctNum,
          message: "Account number contains only placeholder characters — no real digits for deduplication",
        });
      }

      // Track for same-bureau duplicate detection
      const bureaus = acct.bureaus_reporting || [acct.bureau];
      for (const b of bureaus) {
        const key = `${(b || "").toLowerCase()}::${acctNum.toLowerCase()}`;
        if (!accountNumbersSeen.has(key)) accountNumbersSeen.set(key, []);
        accountNumbersSeen.get(key)!.push(acct);
      }
    }

    // Flag missing payment history percentage
    const phPct = acct.payment_history_percentage;
    if (phPct == null && acct.is_open !== false && acct._source === "positive") {
      flags.push({
        type: "missing_payment_history",
        account: acct._name,
        message: "Payment history percentage missing for open account — may affect comparable credit classification",
      });
    }

    // Flag zero original amount on closed installment
    if (!acct.is_open && acct._source === "positive") {
      const origAmt = acct.original_amount;
      const acctType = (acct.account_type || "").toLowerCase();
      if ((acctType.includes("install") || acctType.includes("auto") || acctType.includes("mortgage")) && (!origAmt || origAmt === 0)) {
        flags.push({
          type: "missing_original_amount",
          account: acct._name,
          message: "Original amount is zero or null for closed installment account — comparable credit projection cannot be calculated",
        });
      }
    }

    // Flag type mismatch (e.g. MORTGAGE creditor as revolving)
    const name = (acct._name || "").toLowerCase();
    const type = (acct.account_type || "").toLowerCase();
    if (name.includes("mortgage") && type.includes("revolv")) {
      flags.push({
        type: "possible_misclassification",
        account: acct._name,
        account_type: acct.account_type,
        message: "Creditor name suggests mortgage but account type is revolving — possible misclassification",
      });
    }
  }

  // Flag same account number appearing more than once on same bureau
  for (const [key, records] of accountNumbersSeen.entries()) {
    if (records.length > 1) {
      flags.push({
        type: "same_bureau_duplicate",
        bureau_key: key,
        accounts: records.map((r: any) => r._name),
        message: `Same account number appears ${records.length} times on the same bureau — definitive duplicate`,
        auto_merge: true,
      });
    }
  }

  return flags;
}

function validateStructuredExtraction(analysisResult: any, readCheck: any) {
  const errors: string[] = [];
  const scores = analysisResult?.scores || {};

  for (const bureau of ["equifax", "experian", "transunion"]) {
    const score = scores[bureau];
    if (score != null && !isScoreInRange(score)) {
      errors.push(`Extracted ${bureau} score is outside the valid range.`);
    }

    const visibleScore = readCheck?.visible_scores?.[bureau];
    if (visibleScore != null && score != null && Number(visibleScore) !== Number(score)) {
      errors.push(`Extracted ${bureau} score did not match the verified document read-check.`);
    }
  }

  const accountNames = [
    ...(analysisResult?.negative_items || []).map((item: any) => item?.creditor_name).filter(Boolean),
    ...(analysisResult?.positive_accounts || []).map((item: any) => item?.creditor).filter(Boolean),
  ];

  if (readCheck?.directly_read_account_count < 1 || accountNames.length < 1) {
    errors.push("Unable to parse document content — please ensure the uploaded file is a readable PDF credit report");
  }

  if (readCheck?.fraud_alerts_visible && (!Array.isArray(analysisResult?.fraud_alerts) || analysisResult.fraud_alerts.length === 0)) {
    errors.push("Fraud alerts were visible in the document but missing from the extraction.");
  }

  return errors;
}

async function failUpload(supabase: ReturnType<typeof createClient>, uploadId: string, message: string, status: number) {
  await supabase
    .from("credit_report_uploads")
    .update({ analysis_status: "failed", error_message: message })
    .eq("id", uploadId);

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function logAuditFailure(supabase: ReturnType<typeof createClient>, userId: string, uploadId: string, action: string, data: Record<string, unknown>) {
  await supabase.from("audit_logs").insert({
    user_id: userId,
    entity: "credit_report_upload",
    action,
    entity_id: uploadId,
    data,
  });
}

function cleanJsonResponse(content: string) {
  return content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

function isScoreInRange(value: unknown) {
  return typeof value === "number" && value >= 300 && value <= 850;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}
