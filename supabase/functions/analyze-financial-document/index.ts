import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gatewayCompat } from "../_shared/claude.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: rateLimitOk } = await supabase.rpc('check_rate_limit', {
      _user_id: user.id, _function_name: 'analyze-financial-document', _max_requests: 10, _window_minutes: 60,
    });
    if (!rateLimitOk) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again in an hour.', retryAfter: 3600 }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' },
      });
    }

    const { documentId, businessId } = await req.json();
    if (!documentId) {
      return new Response(JSON.stringify({ error: 'documentId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the document record
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !doc) {
      return new Response(JSON.stringify({ error: 'Document not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ownership check: only the document's owner or an admin may analyze.
    if (doc.user_id !== user.id) {
      const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Create or update analysis record
    const { data: analysisRecord, error: insertError } = await supabase
      .from('financial_document_analyses')
      .upsert({
        document_id: documentId,
        user_id: doc.user_id,
        business_id: businessId || doc.business_id,
        analysis_status: 'processing',
      }, { onConflict: 'document_id' })
      .select()
      .single();

    if (insertError) {
      // If upsert fails due to no unique constraint, try insert
      const { data: newRecord, error: newError } = await supabase
        .from('financial_document_analyses')
        .insert({
          document_id: documentId,
          user_id: doc.user_id,
          business_id: businessId || doc.business_id,
          analysis_status: 'processing',
        })
        .select()
        .single();
      
      if (newError) throw newError;
    }

    // Download the file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(doc.bucket_name)
      .download(doc.file_path);

    if (downloadError || !fileData) {
      await supabase.from('financial_document_analyses')
        .update({ analysis_status: 'failed', error_message: 'Failed to download file' })
        .eq('document_id', documentId);
      return new Response(JSON.stringify({ error: 'Failed to download file' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    const systemPrompt = `You are a financial document analysis expert working for a business credit and funding platform.
You will receive a financial document. Detect the document type FIRST, then extract relevant data.

DOCUMENT TYPES:
- bank_statement, profit_and_loss, tax_return, balance_sheet, income_statement
- denial_letter — adverse action notice from a lender. Detect by phrases like "we are unable to approve", "your application has been denied", "adverse action", "we regret to inform", "credit decision", lender letterhead + denial language.
- other

If the document is a DENIAL LETTER, return ONLY this JSON shape (do NOT include the financial fields below):
{
  "doc_type": "denial_letter",
  "denial_letter": {
    "lender_name": "string",
    "denial_date": "YYYY-MM-DD or null",
    "denial_reason_text": "the verbatim reason language from the letter",
    "denial_reason_category": "credit_score_too_low" | "insufficient_time_in_business" | "insufficient_revenue" | "too_much_existing_debt" | "no_collateral" | "incomplete_application" | "industry_restriction" | "too_many_recent_inquiries" | "derogatory_items" | "insufficient_cash_flow" | "personal_guarantee_declined" | "entity_structure_issue" | "other",
    "credit_score_referenced": number or null,
    "bureau_referenced": "Experian" | "Equifax" | "TransUnion" | null,
    "product_referenced": "string or null"
  },
  "summary": "1-2 sentence plain-language summary of the denial and the most likely category map."
}

Map common denial language to categories:
- "credit score below our minimum" / "FICO too low" → credit_score_too_low
- "time in business" / "newly established" → insufficient_time_in_business
- "annual revenue" / "monthly revenue" / "below our minimum revenue" → insufficient_revenue
- "debt-to-income" / "existing obligations" / "DTI" → too_much_existing_debt
- "collateral" / "secured" → no_collateral
- "incomplete" / "missing documentation" → incomplete_application
- "industry" / "SIC" / "NAICS" → industry_restriction
- "inquiries" / "recent credit applications" → too_many_recent_inquiries
- "delinquencies" / "collections" / "charge-offs" / "bankruptcy" → derogatory_items
- "cash flow" / "DSCR" → insufficient_cash_flow
- "personal guarantor" / "personal guarantee" → personal_guarantee_declined
- "entity structure" / "business formation" → entity_structure_issue

For ALL OTHER document types, return:
{
  "doc_type": "bank_statement" | "profit_and_loss" | "tax_return" | "balance_sheet" | "income_statement" | "other",
  "institution_name": "string or null",
  "account_holder": "string or null",
  "period_start": "YYYY-MM-DD or null",
  "period_end": "YYYY-MM-DD or null",
  "avg_monthly_revenue": number or null,
  "avg_daily_balance": number or null,
  "total_deposits": number or null,
  "total_withdrawals": number or null,
  "ending_balance": number or null,
  "revenue_trend": "increasing" | "decreasing" | "stable" | "volatile" | "insufficient_data",
  "revenue_trend_detail": "string explaining the trend",
  "nsf_count": number,
  "overdraft_count": number,
  "largest_deposit": { "amount": number, "date": "YYYY-MM-DD or null", "description": "string" },
  "largest_withdrawal": { "amount": number, "date": "YYYY-MM-DD or null", "description": "string" },
  "monthly_breakdown": [{ "month": "YYYY-MM", "revenue": number, "expenses": number, "net": number }],
  "lender_red_flags": [{ "flag": "string", "severity": "high" | "medium" | "low", "recommendation": "string" }],
  "lender_green_flags": [{ "flag": "string" }],
  "key_metrics": {
    "debt_service_coverage_ratio": number or null,
    "profit_margin": number or null,
    "monthly_burn_rate": number or null,
    "runway_months": number or null
  },
  "summary": "2-3 sentence plain-language summary"
}

Be thorough. Return ONLY valid JSON — no markdown.`;

    const aiResponse = await gatewayCompat("anthropic", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this financial document and extract all relevant data into the structured JSON format. Be thorough — identify every red flag and positive signal." },
              { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorId = crypto.randomUUID();
      const statusMessage = aiResponse.status === 429
        ? "Rate limits exceeded, please try again later."
        : aiResponse.status === 402
          ? "Payment required — the AI provider reported a billing/quota issue."
          : "AI analysis failed. Please try again.";

      await supabase.from('financial_document_analyses')
        .update({ analysis_status: 'failed', error_message: statusMessage })
        .eq('document_id', documentId);

      return new Response(JSON.stringify({ error: statusMessage, errorId }), {
        status: aiResponse.status === 429 || aiResponse.status === 402 ? aiResponse.status : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiResponse.json();
    let rawContent = aiData.choices?.[0]?.message?.content || '';
    rawContent = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(rawContent);
    } catch {
      await supabase.from('financial_document_analyses')
        .update({ analysis_status: 'failed', error_message: 'Failed to parse AI response' })
        .eq('document_id', documentId);
      return new Response(JSON.stringify({ error: 'Failed to parse analysis' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Branch: denial letter — store separately and surface guidance
    if (analysis.doc_type === "denial_letter" && analysis.denial_letter) {
      const dl = analysis.denial_letter;
      await supabase.from('financial_document_analyses')
        .update({
          analysis_status: 'completed',
          doc_type_detected: 'denial_letter',
          full_analysis: analysis,
        })
        .eq('document_id', documentId);

      await supabase.from('audit_logs').insert({
        user_id: user.id,
        entity: 'financial_document_analysis',
        action: 'denial_letter_parsed',
        entity_id: documentId,
        data: {
          lender_name: dl.lender_name,
          denial_reason_category: dl.denial_reason_category,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        analysis,
        denial_letter_proposal: {
          lender_name: dl.lender_name,
          application_date: dl.denial_date || new Date().toISOString().split("T")[0],
          decision_date: dl.denial_date,
          status: "denied",
          denial_reason_category: dl.denial_reason_category,
          denial_reason_detail: dl.denial_reason_text,
          credit_score_at_application: dl.credit_score_referenced,
          bureau_pulled: dl.bureau_referenced,
          product_name: dl.product_referenced,
          denial_letter_url: doc.file_path,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Save results (financial documents)
    await supabase.from('financial_document_analyses')
      .update({
        analysis_status: 'completed',
        doc_type_detected: analysis.doc_type,
        period_start: analysis.period_start,
        period_end: analysis.period_end,
        avg_monthly_revenue: analysis.avg_monthly_revenue,
        avg_daily_balance: analysis.avg_daily_balance,
        revenue_trend: analysis.revenue_trend,
        nsf_count: analysis.nsf_count || 0,
        overdraft_count: analysis.overdraft_count || 0,
        largest_deposit: analysis.largest_deposit?.amount,
        largest_deposit_description: analysis.largest_deposit?.description,
        largest_withdrawal: analysis.largest_withdrawal?.amount,
        largest_withdrawal_description: analysis.largest_withdrawal?.description,
        lender_red_flags: analysis.lender_red_flags || [],
        full_analysis: analysis,
      })
      .eq('document_id', documentId);

    // Also update the financial_kpis table if relevant
    if (analysis.avg_monthly_revenue || analysis.avg_daily_balance) {
      await supabase.from('financial_kpis').upsert({
        user_id: doc.user_id,
        avg_balance_30d: analysis.avg_daily_balance,
        avg_balance_90d: analysis.avg_daily_balance,
        monthly_inflow: analysis.total_deposits || analysis.avg_monthly_revenue,
        monthly_outflow: analysis.total_withdrawals,
        nsf_count: analysis.nsf_count || 0,
        dscr: analysis.key_metrics?.debt_service_coverage_ratio,
        last_calculated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      entity: 'financial_document_analysis',
      action: 'ai_analysis_completed',
      entity_id: documentId,
      data: {
        doc_type: analysis.doc_type,
        red_flags_count: analysis.lender_red_flags?.length || 0,
        avg_monthly_revenue: analysis.avg_monthly_revenue,
      },
    });

    return new Response(JSON.stringify({ success: true, analysis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error(`[FINANCIAL-ANALYSIS-ERROR-${errorId}]`, error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ error: 'An error occurred', errorId }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
