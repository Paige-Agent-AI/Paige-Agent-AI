import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SUPPORT-REQUEST] ${step}${detailsStr}`);
};

interface SupportRequest {
  subject: string;
  category: string;
  message: string;
  preferredContact: string;
  requestConsultation: boolean;
  // NOTE: planSlug is intentionally NOT read from the request body. The support
  // SLA + routing inbox are entitlements, so the plan is resolved SERVER-SIDE
  // (see resolvePlanSlug) — a client-supplied slug is spoofable and is ignored.
  userEmail: string;
}

// ── Support entitlements as CONFIG DATA, not a hardcoded slug ladder ──────────
// A plan maps to a support TIER; the tier carries the SLA + routing capability.
// Adding a new plan is one map entry (or it safely inherits STANDARD) — so a new
// tier tomorrow never silently loses its SLA, and can never reach the enterprise
// inbox via a spoofed/ drifted slug. Only `enterprise` routes to enterprise@; the
// non-default SLA values below are operator-tunable support policy defaults.
type SupportTier = "dedicated" | "priority" | "standard_48" | "standard_72" | "standard";

interface SupportTierConfig {
  slaHours: number | null;
  priorityLabel: string; // subject-line priority tag
  badgeColor: string; // internal email badge background
  routingInbox: string;
  responseCopy: string; // user-facing expected-response line
  dedicatedManager: boolean; // white-glove / dedicated success manager
}

const SUPPORT_TIERS: Record<SupportTier, SupportTierConfig> = {
  dedicated: {
    slaHours: 2,
    priorityLabel: "🔴 ENTERPRISE - 2 HOUR SLA",
    badgeColor: "#DC2626",
    routingInbox: "enterprise@paigeagent.ai",
    responseCopy: "Within 2 hours (Enterprise SLA)",
    dedicatedManager: true,
  },
  priority: {
    slaHours: 24,
    priorityLabel: "🟠 PRIORITY - 24 HOUR SLA",
    badgeColor: "#F59E0B",
    routingInbox: "support@paigeagent.ai",
    responseCopy: "Within 24 hours (Priority Support)",
    dedicatedManager: false,
  },
  standard_48: {
    slaHours: 48,
    priorityLabel: "🟡 48 HOUR SLA",
    badgeColor: "#10B981",
    routingInbox: "support@paigeagent.ai",
    responseCopy: "Within 48 hours",
    dedicatedManager: false,
  },
  standard_72: {
    slaHours: 72,
    priorityLabel: "🟢 72 HOUR SLA",
    badgeColor: "#10B981",
    routingInbox: "support@paigeagent.ai",
    responseCopy: "Within 72 hours",
    dedicatedManager: false,
  },
  standard: {
    slaHours: null,
    priorityLabel: "🔵 STANDARD",
    badgeColor: "#10B981",
    routingInbox: "support@paigeagent.ai",
    responseCopy: "As soon as our team is available",
    dedicatedManager: false,
  },
};

// Plan slug → support tier. Covers the current real taxonomy (pricingConfig.ts:
// starter/growth/scale/broker/broker_workspace/broker_beta_starter/enterprise),
// the legacy grandfathered slugs (premium/professional), and the invite/admin
// slugs (solo/agency/team; 'academy' kept for back-compat with pre-rename
// tokens). Any unknown/new slug falls through to STANDARD via
// the resolver default — never crashes, never misroutes to the enterprise inbox.
const PLAN_SUPPORT_TIER: Record<string, SupportTier> = {
  enterprise: "dedicated",
  broker: "priority",
  broker_workspace: "priority",
  scale: "priority",
  premium: "priority", // legacy
  agency: "priority",
  academy: "priority", // back-compat: pre-rename middle-tier slug
  growth: "standard_48",
  professional: "standard_48", // legacy
  team: "standard_48",
  starter: "standard_72",
  solo: "standard_72",
  broker_beta_starter: "standard_72",
  free: "standard",
};

function supportConfigForPlan(planSlug: string): SupportTierConfig {
  return SUPPORT_TIERS[PLAN_SUPPORT_TIER[planSlug] ?? "standard"];
}

// Resolve the caller's plan SERVER-SIDE — mirrors the authoritative resolution in
// check-subscription + SubscriptionContext so support entitlement matches what the
// user actually has: staff (admin/coach) → enterprise, complimentary → premium,
// otherwise the persisted user_subscriptions.plan_slug (default "free"). This is
// read-only; it never trusts a client-supplied slug.
async function resolvePlanSlug(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  // Staff bypass — admins get full (enterprise) support entitlement.
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (roleRows ?? []).map((r: { role?: string }) => r.role);
  if (roles.includes("admin")) return "enterprise";

  // Complimentary access — Pro-level (premium) support without Stripe.
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("is_complimentary")
    .eq("user_id", userId)
    .maybeSingle();
  if ((profileRow as { is_complimentary?: boolean } | null)?.is_complimentary) {
    return "premium";
  }

  const { data: subRow } = await supabase
    .from("user_subscriptions")
    .select("plan_slug")
    .eq("user_id", userId)
    .maybeSingle();
  return (subRow as { plan_slug?: string } | null)?.plan_slug || "free";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    // Forward the caller's JWT so the RLS-gated reads below (user_roles,
    // profiles, user_subscriptions — all `auth.uid() = user_id`) resolve as the
    // authenticated user. Without this the client runs as the anon role with
    // auth.uid() = NULL, every read returns 0 rows, and resolvePlanSlug collapses
    // to "free" for EVERY caller — silently stripping paid/enterprise SLA + the
    // enterprise@ routing inbox. `auth.getUser(token)` below still verifies the
    // token explicitly, so identity is unchanged; the header only scopes RLS.
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Unauthorized");

    const user = userData.user;
    logStep("User authenticated", { userId: user.id, email: user.email });

    const requestData: SupportRequest = await req.json();
    logStep("Request received", {
      category: requestData.category,
      consultation: requestData.requestConsultation,
    });

    // Get user profile for additional context
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name, phone")
      .eq("user_id", user.id)
      .single();

    const userName = profile?.full_name || user.email;

    // Resolve the plan SERVER-SIDE (never from the request body) and read its
    // support entitlement as config data — this closes both the drifted-ladder
    // gap and the client-side planSlug spoof in one move.
    const planSlug = await resolvePlanSlug(supabaseClient, user.id);
    const support = supportConfigForPlan(planSlug);
    logStep("Plan resolved server-side", { planSlug, routingInbox: support.routingInbox });

    const priority = support.priorityLabel;
    const isEnterprise = support.dedicatedManager;
    const is3MConsultation = requestData.category === "3m_framework" ||
                            (requestData.requestConsultation && isEnterprise);

    // Send notification to support team
    const supportEmail = await resend.emails.send({
      from: "PaigeAgent.ai Support <support@paigeagent.ai>",
      to: [support.routingInbox],
      subject: `${priority} | ${requestData.category.toUpperCase()} | ${requestData.subject}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 700px; margin: 0 auto; padding: 20px; }
              .priority { 
                display: inline-block; 
                padding: 8px 16px; 
                border-radius: 6px; 
                font-weight: bold;
                margin-bottom: 20px;
                background: ${support.badgeColor};
                color: white;
              }
              .info-grid { 
                display: grid; 
                grid-template-columns: 150px 1fr; 
                gap: 12px; 
                background: #f9fafb; 
                padding: 20px; 
                border-radius: 8px;
                margin: 20px 0;
              }
              .info-label { font-weight: 600; color: #6b7280; }
              .message-box { 
                background: white; 
                border: 2px solid #e5e7eb; 
                border-radius: 8px; 
                padding: 20px; 
                margin: 20px 0;
              }
              .consultation-badge {
                display: inline-block;
                background: #CFAE70;
                color: white;
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: bold;
                margin-left: 8px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>New Support Request</h1>
              <div class="priority">${priority}</div>
              ${is3MConsultation ? '<span class="consultation-badge">3M FRAMEWORK CONSULTATION</span>' : ''}
              
              <div class="info-grid">
                <div class="info-label">User:</div>
                <div>${userName}</div>
                
                <div class="info-label">Email:</div>
                <div>${user.email}</div>
                
                ${profile?.phone ? `
                <div class="info-label">Phone:</div>
                <div>${profile.phone}</div>
                ` : ''}
                
                <div class="info-label">Plan:</div>
                <div><strong>${planSlug.toUpperCase()}</strong></div>
                
                <div class="info-label">Category:</div>
                <div>${requestData.category.replace(/_/g, ' ').toUpperCase()}</div>
                
                <div class="info-label">Preferred Contact:</div>
                <div>${requestData.preferredContact}</div>
                
                ${requestData.requestConsultation ? `
                <div class="info-label">Consultation:</div>
                <div><strong>✅ REQUESTED</strong></div>
                ` : ''}
              </div>
              
              <h3>Subject: ${requestData.subject}</h3>
              
              <div class="message-box">
                <h4>Message:</h4>
                <p>${requestData.message.replace(/\n/g, '<br>')}</p>
              </div>
              
              ${isEnterprise ? `
              <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 16px; margin-top: 20px;">
                <strong>⚠️ ENTERPRISE SLA:</strong> Response required within 2 hours
                ${is3MConsultation ? '<br><strong>📞 3M Framework consultation requested - coordinate with Success Manager</strong>' : ''}
              </div>
              ` : ''}
            </div>
          </body>
        </html>
      `,
    });

    logStep("Support team notified", { messageId: supportEmail.data?.id });

    // Send confirmation to user
    const userConfirmation = await resend.emails.send({
      from: "PaigeAgent.ai Support <support@paigeagent.ai>",
      to: [user.email!],
      subject: `Support Request Received: ${requestData.subject}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #CFAE70, #B8935A); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
              .badge { display: inline-block; background: #10B981; color: white; padding: 6px 12px; border-radius: 4px; font-size: 12px; margin-top: 8px; }
              .response-time { background: #f3f4f6; padding: 16px; border-radius: 6px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">Support Request Received</h1>
                <span class="badge">${planSlug.toUpperCase()} PLAN</span>
              </div>
              <div class="content">
                <p>Hi ${userName},</p>
                
                <p>We've received your support request and ${isEnterprise ? 'your dedicated success manager' : 'our team'} will respond shortly.</p>
                
                <div class="response-time">
                  <strong>Expected Response Time:</strong><br>
                  ⏱️ ${support.responseCopy}
                </div>
                
                <p><strong>Request Category:</strong> ${requestData.category.replace(/_/g, ' ')}</p>
                <p><strong>Subject:</strong> ${requestData.subject}</p>
                
                ${is3MConsultation ? `
                <div style="background: #FEF3C7; padding: 16px; border-radius: 6px; margin: 20px 0;">
                  <strong>📅 3M Framework Consultation</strong><br>
                  Your dedicated success manager will reach out to schedule your strategy session for the Make, Manage, Multiply framework.
                </div>
                ` : ''}
                
                <p style="margin-top: 24px;">Thank you for being a valued ${planSlug} member!</p>
                
                <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                  Best regards,<br>
                  The PaigeAgent.ai Team
                </p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    logStep("User confirmation sent", { messageId: userConfirmation.data?.id });

    // Log the support request in audit trail
    await supabaseClient
      .from("audit_logs")
      .insert({
        user_id: user.id,
        entity: "support_request",
        action: "created",
        data: {
          category: requestData.category,
          plan_slug: planSlug,
          consultation_requested: requestData.requestConsultation,
          is_3m_framework: is3MConsultation,
        },
      });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Support request submitted successfully" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
