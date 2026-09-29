import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { primaryEmailForUser } from "../_shared/user-contact-methods.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FundingReportRequest {
  userId: string;
  includeBusinessCredit?: boolean;
  includePersonalCredit?: boolean;
  includeFundingOffers?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      userId, 
      includeBusinessCredit = true,
      includePersonalCredit = true,
      includeFundingOffers = true,
    }: FundingReportRequest = await req.json();

    if (!userId) {
      throw new Error('Missing userId');
    }

    // Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError) throw profileError;

    // The report goes to its owner's primary address and nowhere else. It carries their credit
    // accounts and scores, so a recipient supplied in the request body is not honoured.
    const recipientEmail = await primaryEmailForUser(supabase, userId);
    if (!recipientEmail) {
      throw new Error('No email address available');
    }

    // Fetch BUILD score
    const { data: buildScore } = await supabase
      .from('build_scores')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Fetch financial KPIs
    const { data: kpis } = await supabase
      .from('financial_kpis')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Fetch businesses if includeBusinessCredit
    let businesses = [];
    if (includeBusinessCredit) {
      const { data: businessData } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_user_id', userId);
      businesses = businessData || [];
    }

    // Fetch credit accounts if includePersonalCredit
    let creditAccounts = [];
    if (includePersonalCredit) {
      const { data: accountsData } = await supabase
        .from('credit_accounts')
        .select('*')
        .eq('user_id', userId);
      creditAccounts = accountsData || [];
    }

    // Fetch funding offers if includeFundingOffers
    let fundingOffers = [];
    if (includeFundingOffers) {
      const { data: offersData } = await supabase
        .from('funding_offers')
        .select('*')
        .eq('is_active', true);
      fundingOffers = offersData || [];
    }

    // Generate HTML report
    const htmlReport = generateFundingReportHTML({
      profile,
      buildScore,
      kpis,
      businesses,
      creditAccounts,
      fundingOffers,
      includeBusinessCredit,
      includePersonalCredit,
      includeFundingOffers,
    });

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: "Paige AI <onboarding@resend.dev>",
      to: [recipientEmail],
      subject: "Your Funding Readiness Report",
      html: htmlReport,
    });

    console.log('Funding report sent successfully:', emailResponse);

    // Log the notification
    await supabase.from('plaid_notifications').insert({
      user_id: userId,
      channel: 'email',
      template: 'funding_report',
      metadata: {
        email: recipientEmail,
        response: emailResponse,
      },
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        emailData: emailResponse,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error('Error in send-funding-report:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
});

function generateFundingReportHTML(data: any): string {
  const { profile, buildScore, kpis, businesses, creditAccounts, fundingOffers } = data;
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #CFAE70; border-bottom: 3px solid #CFAE70; padding-bottom: 10px; }
          h2 { color: #000; margin-top: 30px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
          .score-box { background: linear-gradient(135deg, #CFAE70 0%, #8B7355 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
          .score-value { font-size: 48px; font-weight: bold; }
          .metric { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
          .metric-label { font-weight: bold; color: #666; }
          .metric-value { font-size: 18px; color: #000; margin-top: 5px; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #000; color: #CFAE70; font-weight: bold; }
          .offer-card { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #CFAE70; text-align: center; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>Funding Readiness Report</h1>
        <p>Hello ${profile.full_name || 'Valued Client'},</p>
        <p>Here's your comprehensive funding readiness analysis generated by Paige AI.</p>
        
        ${buildScore ? `
          <div class="score-box">
            <div class="score-value">${buildScore.build_score || 0}</div>
            <div>BUILD Score™</div>
            <div style="margin-top: 10px; font-size: 14px;">Current Tier: ${buildScore.current_tier || 'B'}</div>
          </div>
          
          <h2>Score Breakdown</h2>
          <div class="metric">
            <div class="metric-label">Bureau Health Score</div>
            <div class="metric-value">${buildScore.bureau_health_score || 0}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Compliance Score</div>
            <div class="metric-value">${buildScore.compliance_score || 0}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Vendor Reporting Score</div>
            <div class="metric-value">${buildScore.vendors_score || 0}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Funding Readiness Score</div>
            <div class="metric-value">${buildScore.funding_readiness_score || 0}%</div>
          </div>
        ` : ''}
        
        ${kpis ? `
          <h2>Financial Health Metrics</h2>
          <div class="metric">
            <div class="metric-label">Debt Service Coverage Ratio (DSCR)</div>
            <div class="metric-value">${kpis.dscr || 'N/A'}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Average Balance (30-day)</div>
            <div class="metric-value">$${(kpis.avg_balance_30d || 0).toLocaleString()}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Average Balance (90-day)</div>
            <div class="metric-value">$${(kpis.avg_balance_90d || 0).toLocaleString()}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Monthly Cash Flow</div>
            <div class="metric-value">
              In: $${(kpis.monthly_inflow || 0).toLocaleString()} | 
              Out: $${(kpis.monthly_outflow || 0).toLocaleString()}
            </div>
          </div>
        ` : ''}
        
        ${businesses && businesses.length > 0 ? `
          <h2>Business Entities</h2>
          <table>
            <thead>
              <tr>
                <th>Business Name</th>
                <th>Entity Type</th>
                <th>EIN</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              ${businesses.map((biz: any) => `
                <tr>
                  <td>${biz.legal_name}</td>
                  <td>${biz.entity_type || 'N/A'}</td>
                  <td>${biz.ein ? `***-**-${biz.ein.slice(-4)}` : 'Pending'}</td>
                  <td>${biz.state_of_formation || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}
        
        ${creditAccounts && creditAccounts.length > 0 ? `
          <h2>Personal Credit Accounts</h2>
          <table>
            <thead>
              <tr>
                <th>Creditor</th>
                <th>Type</th>
                <th>Balance</th>
                <th>Limit</th>
                <th>Utilization</th>
              </tr>
            </thead>
            <tbody>
              ${creditAccounts.map((acc: any) => `
                <tr>
                  <td>${acc.creditor}</td>
                  <td>${acc.type}</td>
                  <td>$${(acc.balance || 0).toLocaleString()}</td>
                  <td>$${(acc.limit_amount || 0).toLocaleString()}</td>
                  <td>${(acc.utilization || 0).toFixed(1)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}
        
        ${fundingOffers && fundingOffers.length > 0 ? `
          <h2>Available Funding Offers</h2>
          ${fundingOffers.slice(0, 5).map((offer: any) => `
            <div class="offer-card">
              <h3 style="margin-top: 0; color: #CFAE70;">${offer.name}</h3>
              <p><strong>Product Type:</strong> ${offer.product_type}</p>
              <p><strong>Limits:</strong> ${offer.limits_range || 'Varies'}</p>
              <p><strong>APR:</strong> ${offer.apr_range || 'Contact for details'}</p>
              <p><strong>Requirements:</strong> ${offer.requirements || 'Standard underwriting'}</p>
            </div>
          `).join('')}
        ` : ''}
        
        <div class="footer">
          <p>This report was generated by Paige AI - Your Credit & Funding Intelligence Assistant</p>
          <p>For questions or to schedule a consultation, please contact your account manager.</p>
          <p style="margin-top: 20px; font-size: 10px;">© ${new Date().getFullYear()} Paige AI. All rights reserved.</p>
        </div>
      </body>
    </html>
  `;
}
