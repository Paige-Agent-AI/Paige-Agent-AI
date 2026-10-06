import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// The Claude model id resolves through _shared/claude-models.ts, the one place it is chosen (INT-329).
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

    const { analysisId } = await req.json();
    if (!analysisId) {
      return new Response(JSON.stringify({ error: 'analysisId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the analysis record
    const { data: analysis, error: fetchError } = await supabase
      .from('financial_document_analyses')
      .select('*, documents(file_name), businesses(legal_name)')
      .eq('id', analysisId)
      .single();

    if (fetchError || !analysis || !analysis.full_analysis) {
      return new Response(JSON.stringify({ error: 'Analysis not found or incomplete' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ownership check: only the analysis's owner or an admin may read.
    if ((analysis as any).user_id !== user.id) {
      const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const fa = analysis.full_analysis as Record<string, any>;

    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', analysis.user_id)
      .single();

    const businessName = (analysis as any).businesses?.legal_name || 'Business Entity';
    const ownerName = profile?.full_name || 'Business Owner';
    const docName = (analysis as any).documents?.file_name || 'Financial Document';

    // Generate the lender-ready summary using AI
    const summaryPrompt = `Generate a professional, lender-ready one-page financial summary document based on this analysis data. 
Format it as clean HTML that can be converted to PDF. Use professional formatting with clear sections.

Business: ${businessName}
Owner: ${ownerName}
Source Document: ${docName}
Document Type: ${fa.doc_type || 'Financial Document'}
Period: ${fa.period_start || 'N/A'} to ${fa.period_end || 'N/A'}

Financial Data:
${JSON.stringify(fa, null, 2)}

Create a document with these sections:
1. Header with business name, date, and "CONFIDENTIAL - LENDER REVIEW" watermark
2. Executive Summary (2-3 sentences)
3. Key Financial Metrics (table format: Avg Monthly Revenue, Avg Daily Balance, Total Deposits, Total Withdrawals, Revenue Trend)
4. Monthly Performance Breakdown (if available)
5. Strengths (green flags)
6. Risk Factors (red flags with severity)
7. Key Ratios (DSCR, profit margin if available)
8. Footer with generation date and disclaimer

Use professional styling. Colors: use #CFAE70 for accents, #000000 for text. Keep it clean and data-focused.
Return ONLY the HTML content, no markdown fences.`;

    const aiResponse = await gatewayCompat("anthropic", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a financial document formatter. Generate clean, professional HTML for lender-ready summaries. Return only HTML, no markdown." },
          { role: "user", content: summaryPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const statusMessage = aiResponse.status === 429
        ? "Rate limits exceeded, please try again later."
        : aiResponse.status === 402
          ? "Payment required."
          : "Failed to generate summary.";
      return new Response(JSON.stringify({ error: statusMessage }), {
        status: aiResponse.status === 429 || aiResponse.status === 402 ? aiResponse.status : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiResponse.json();
    let htmlContent = aiData.choices?.[0]?.message?.content || '';
    htmlContent = htmlContent.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();

    // Return the HTML for client-side PDF generation
    return new Response(JSON.stringify({ 
      success: true, 
      html: htmlContent,
      businessName,
      ownerName,
      period: `${fa.period_start || 'N/A'} to ${fa.period_end || 'N/A'}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorId = crypto.randomUUID();
    console.error(`[LENDER-SUMMARY-ERROR-${errorId}]`, error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ error: 'An error occurred', errorId }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
