import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { resolveOperatorIdentity } from "../_shared/operator-identity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AlertCandidate {
  alert_type: string;
  alert_severity: "critical" | "warning" | "informational";
  alert_title: string;
  alert_description: string;
  previous_value?: string;
  new_value?: string;
  bureau?: string;
  related_account_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const {
      client_id,
      new_scores,
      previous_scores,
      new_accounts,
      previous_accounts,
      new_negatives,
      previous_negatives,
      bureau_source,
    } = body;

    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === POST-RESET / FIRST UPLOAD DETECTION ===
    // Check if this is a first upload or a post-reset upload (no previous data to compare against)
    const hasPreviousData = (previous_scores && Object.values(previous_scores).some((v: any) => v != null))
      || (previous_accounts && previous_accounts.length > 0)
      || (previous_negatives && previous_negatives.length > 0);

    if (!hasPreviousData) {
      // First-time upload — generate only an informational summary alert
      const totalAccounts = (new_accounts || []).length + (new_negatives || []).length;
      const bureaus = new Set<string>();
      for (const a of (new_accounts || [])) if (a.bureau_source) bureaus.add(a.bureau_source);
      for (const n of (new_negatives || [])) if (n.bureau) bureaus.add(n.bureau);

      if (totalAccounts > 0) {
        await supabase.from("credit_alerts").insert({
          client_id,
          alert_type: "file_established",
          alert_severity: "informational",
          alert_title: "Credit File Established",
          alert_description: `Your credit file has been analyzed — ${totalAccounts} accounts found across ${bureaus.size || 1} bureau${bureaus.size !== 1 ? "s" : ""}. This is your baseline. Future uploads will detect changes and alert you to significant events.`,
          bureau: bureau_source || null,
        });
      }

      return new Response(
        JSON.stringify({ success: true, alerts_generated: totalAccounts > 0 ? 1 : 0, critical: 0, warnings: 0, informational: totalAccounts > 0 ? 1 : 0, first_upload: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const alerts: AlertCandidate[] = [];
    const bureauLabel = bureau_source || "all";
    const bureauDisplay = bureauLabel === "all" ? "your credit report" :
      bureauLabel.charAt(0).toUpperCase() + bureauLabel.slice(1);

    // === SCORE ALERTS ===
    if (new_scores && previous_scores) {
      for (const bureau of ["experian", "transunion", "equifax"]) {
        const newScore = new_scores[bureau];
        const prevScore = previous_scores[bureau];
        if (newScore == null || prevScore == null) continue;

        const diff = newScore - prevScore;

        if (diff <= -20) {
          alerts.push({
            alert_type: "score_drop_significant",
            alert_severity: "critical",
            alert_title: `Significant Score Drop — ${capitalize(bureau)}`,
            alert_description: `Your ${capitalize(bureau)} score dropped ${Math.abs(diff)} points from ${prevScore} to ${newScore}. This is a significant change that may affect your funding eligibility. Review your recent account activity to identify the cause.`,
            previous_value: String(prevScore),
            new_value: String(newScore),
            bureau,
          });
        } else if (diff <= -10) {
          alerts.push({
            alert_type: "score_drop_moderate",
            alert_severity: "warning",
            alert_title: `Score Decrease — ${capitalize(bureau)}`,
            alert_description: `Your ${capitalize(bureau)} score decreased ${Math.abs(diff)} points from ${prevScore} to ${newScore}. Monitor your accounts for the cause.`,
            previous_value: String(prevScore),
            new_value: String(newScore),
            bureau,
          });
        } else if (diff >= 10) {
          alerts.push({
            alert_type: "score_increase",
            alert_severity: "informational",
            alert_title: `Score Improvement — ${capitalize(bureau)} 🎉`,
            alert_description: `Your ${capitalize(bureau)} score increased ${diff} points from ${prevScore} to ${newScore}. Keep up the positive momentum!`,
            previous_value: String(prevScore),
            new_value: String(newScore),
            bureau,
          });
        }
      }
    }

    // === NEW COLLECTION / CHARGE-OFF ALERTS ===
    const prevNegKeys = new Set(
      (previous_negatives || []).map((n: any) => normalizeKey(n.creditor_name, n.account_number_masked || n.account_number))
    );

    for (const neg of (new_negatives || [])) {
      const key = normalizeKey(neg.creditor_name, neg.account_number_masked || neg.account_number);
      if (prevNegKeys.has(key)) continue;

      const itemType = (neg.item_type || "").toLowerCase();
      const amount = neg.amount ? `$${Number(neg.amount).toLocaleString()}` : "unknown amount";

      if (itemType.includes("collection")) {
        alerts.push({
          alert_type: "new_collection",
          alert_severity: "critical",
          alert_title: `New Collection Account Detected — ${capitalize(neg.bureau || bureauLabel)}`,
          alert_description: `A new collection from ${neg.creditor_name} for ${amount} has appeared on your ${capitalize(neg.bureau || bureauLabel)} report. Collections significantly impact your score and should be addressed immediately.`,
          bureau: neg.bureau || bureauLabel,
          related_account_id: neg.id || undefined,
        });
      } else if (itemType.includes("charge") || itemType.includes("chargeoff")) {
        alerts.push({
          alert_type: "new_charge_off",
          alert_severity: "critical",
          alert_title: `New Charge-Off Detected — ${capitalize(neg.bureau || bureauLabel)}`,
          alert_description: `${neg.creditor_name} has reported a charge-off of ${amount} on your ${capitalize(neg.bureau || bureauLabel)} report. This is one of the most damaging items that can appear on a credit report.`,
          bureau: neg.bureau || bureauLabel,
          related_account_id: neg.id || undefined,
        });
      }
    }

    // === NEW ACCOUNT / IDENTITY THEFT CHECK ===
    const prevAcctKeys = new Set(
      (previous_accounts || []).map((a: any) => normalizeKey(a.creditor || a.creditor_name, a.account_number))
    );

    for (const acct of (new_accounts || [])) {
      const key = normalizeKey(acct.creditor || acct.creditor_name, acct.account_number);
      if (prevAcctKeys.has(key)) continue;

      // Check if recently opened (within 60 days)
      const openDate = acct.account_open_date || acct.opened_on;
      if (openDate) {
        const opened = new Date(openDate);
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        if (opened > sixtyDaysAgo) {
          alerts.push({
            alert_type: "identity_theft_indicator",
            alert_severity: "critical",
            alert_title: "Unknown New Account — Possible Identity Theft",
            alert_description: `A new ${acct.account_type || "account"} from ${acct.creditor || acct.creditor_name} opened ${openDate} has appeared on your ${bureauDisplay} report. If you did not open this account this may indicate identity theft.`,
            bureau: acct.bureau_source || bureauLabel,
            related_account_id: acct.id || undefined,
          });
          continue;
        }
      }

      // New positive account
      const status = (acct.status || acct.payment_status || "").toLowerCase();
      if (status === "current" || status === "open" || acct.is_open) {
        alerts.push({
          alert_type: "new_positive_account",
          alert_severity: "informational",
          alert_title: `New Account Added — ${bureauDisplay}`,
          alert_description: `A new ${acct.account_type || "account"} from ${acct.creditor || acct.creditor_name} has appeared on your ${bureauDisplay} report. New accounts temporarily reduce your average credit age but build long-term credit strength.`,
          bureau: acct.bureau_source || bureauLabel,
          related_account_id: acct.id || undefined,
        });
      }
    }

    // === UTILIZATION ALERTS ===
    if (new_accounts && new_accounts.length > 0) {
      const revolving = (new_accounts || []).filter((a: any) => {
        const t = (a.account_type || a.type || "").toLowerCase();
        return t.includes("revolving") || t.includes("credit card") || t.includes("line of credit");
      });

      let totalBalance = 0, totalLimit = 0;
      for (const r of revolving) {
        totalBalance += Number(r.balance || r.current_balance || 0);
        totalLimit += Number(r.credit_limit || r.limit_amount || 0);
      }

      if (totalLimit > 0) {
        const utilPct = Math.round((totalBalance / totalLimit) * 100);
        if (utilPct > 30) {
          const highCards = revolving
            .filter((r: any) => {
              const lim = Number(r.credit_limit || r.limit_amount || 0);
              const bal = Number(r.balance || r.current_balance || 0);
              return lim > 0 && (bal / lim) > 0.3;
            })
            .map((r: any) => r.creditor || r.creditor_name)
            .slice(0, 3)
            .join(", ");

          alerts.push({
            alert_type: "high_utilization",
            alert_severity: "warning",
            alert_title: `High Credit Utilization — ${bureauDisplay}`,
            alert_description: `Your credit utilization on ${bureauDisplay} is ${utilPct}% — above the recommended 30% threshold. High utilization is the second most impactful score factor. Accounts over 30%: ${highCards || "multiple accounts"}.`,
            new_value: `${utilPct}%`,
            bureau: bureauLabel,
          });
        }
      }

      // Check authorized user count
      const authUserCount = (new_accounts || []).filter((a: any) => a.is_authorized_user || a.responsibility === "authorized_user").length;
      if (authUserCount > 2) {
        alerts.push({
          alert_type: "authorized_user_over_limit",
          alert_severity: "warning",
          alert_title: "Authorized User Accounts Exceed Recommendation",
          alert_description: `You have ${authUserCount} authorized user accounts on ${bureauDisplay}. We recommend keeping this at 2 or fewer. Excess authorized user accounts can signal credit padding to lenders.`,
          new_value: String(authUserCount),
          bureau: bureauLabel,
        });
      }
    }

    // === ACCOUNT CLOSURE DETECTION ===
    for (const prevAcct of (previous_accounts || [])) {
      if (!prevAcct.is_open) continue;
      const key = normalizeKey(prevAcct.creditor || prevAcct.creditor_name, prevAcct.account_number);
      const newAcct = (new_accounts || []).find((a: any) =>
        normalizeKey(a.creditor || a.creditor_name, a.account_number) === key
      );
      if (newAcct && newAcct.is_open === false) {
        // Check if closed in good standing
        const status = (newAcct.status || newAcct.payment_status || "").toLowerCase();
        const isGoodStanding = !status.includes("charge") && !status.includes("collection") && !status.includes("derog");

        if (isGoodStanding) {
          alerts.push({
            alert_type: "comparable_credit_added",
            alert_severity: "informational",
            alert_title: `Comparable Credit Added — ${bureauDisplay}`,
            alert_description: `Your ${newAcct.creditor || newAcct.creditor_name} account closed in good standing on ${bureauDisplay}. This adds comparable credit to your profile.`,
            bureau: newAcct.bureau_source || bureauLabel,
            related_account_id: newAcct.id || undefined,
          });
        } else {
          alerts.push({
            alert_type: "account_closed",
            alert_severity: "warning",
            alert_title: `Account Closure Detected — ${bureauDisplay}`,
            alert_description: `${newAcct.creditor || newAcct.creditor_name} account has been closed on your ${bureauDisplay} report. If you did not close this account, contact the creditor.`,
            bureau: newAcct.bureau_source || bureauLabel,
            related_account_id: newAcct.id || undefined,
          });
        }
      }
    }

    // === ACCOUNT PAID OFF ===
    for (const newAcct of (new_accounts || [])) {
      const bal = Number(newAcct.balance || newAcct.current_balance || 0);
      if (bal !== 0) continue;
      const key = normalizeKey(newAcct.creditor || newAcct.creditor_name, newAcct.account_number);
      const prevAcct = (previous_accounts || []).find((a: any) =>
        normalizeKey(a.creditor || a.creditor_name, a.account_number) === key
      );
      if (prevAcct && Number(prevAcct.balance || prevAcct.current_balance || 0) > 0) {
        alerts.push({
          alert_type: "account_paid_off",
          alert_severity: "informational",
          alert_title: `Account Paid Off — ${bureauDisplay} 🎉`,
          alert_description: `Your ${newAcct.creditor || newAcct.creditor_name} account shows a $0 balance on ${bureauDisplay}. Congratulations on paying off this account!`,
          bureau: newAcct.bureau_source || bureauLabel,
          related_account_id: newAcct.id || undefined,
        });
      }
    }

    // === DEDUPLICATION & INSERT ===
    const scoreAlertTypes = new Set(["score_increase", "score_drop_significant", "score_drop_moderate"]);
    const insertedAlerts: any[] = [];

    for (const alert of alerts) {
      // Check for duplicates (except score alerts which always create new records)
      if (!scoreAlertTypes.has(alert.alert_type)) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        let query = supabase
          .from("credit_alerts")
          .select("id")
          .eq("client_id", client_id)
          .eq("alert_type", alert.alert_type)
          .gte("created_at", thirtyDaysAgo.toISOString());

        if (alert.bureau) query = query.eq("bureau", alert.bureau);
        if (alert.related_account_id) query = query.eq("related_account_id", alert.related_account_id);

        const { data: existing } = await query.limit(1);

        if (existing && existing.length > 0) {
          // Update existing alert
          await supabase
            .from("credit_alerts")
            .update({
              alert_description: alert.alert_description,
              new_value: alert.new_value || null,
              previous_value: alert.previous_value || null,
              is_read: false,
              read_at: null,
            })
            .eq("id", existing[0].id);
          continue;
        }
      }

      // Insert new alert
      const { data: inserted, error } = await supabase
        .from("credit_alerts")
        .insert({
          client_id,
          alert_type: alert.alert_type,
          alert_severity: alert.alert_severity,
          alert_title: alert.alert_title,
          alert_description: alert.alert_description,
          previous_value: alert.previous_value || null,
          new_value: alert.new_value || null,
          bureau: alert.bureau || null,
          related_account_id: alert.related_account_id || null,
        })
        .select("id")
        .single();

      if (!error && inserted) {
        insertedAlerts.push({ ...alert, id: inserted.id });
      }
    }

    // === EMAIL + PUSH NOTIFICATIONS FOR CRITICAL ALERTS ===
    const criticalAlerts = insertedAlerts.filter(a => a.alert_severity === "critical");
    if (criticalAlerts.length > 0) {
      // A push belongs to the business that holds this client and reaches only the devices
      // registered for it. With no single business to name, no push is sent.
      const { data: pushClientRow } = await supabase
        .from("clients")
        .select("tenant_id")
        .eq("linked_user_id", client_id)
        .maybeSingle();
      const pushTenantId = (pushClientRow as { tenant_id?: string | null } | null)?.tenant_id ?? null;
      if (!pushTenantId) console.warn("[detect-credit-alerts] no single business for this client; push skipped");
      // Fire push notifications (one per critical alert) — non-blocking
      for (const alert of pushTenantId ? criticalAlerts : []) {
        try {
          const isScoreChange = alert.alert_type?.includes("score");
          await supabase.functions.invoke("send-push-notification", {
            body: {
              tenant_id: pushTenantId,
              user_id: client_id,
              category: isScoreChange ? "credit_score_changes" : "dispute_updates",
              title: alert.alert_title,
              body: alert.alert_description,
              url: "/app/credit",
              tag: `alert-${alert.alert_type}`,
              data: { alert_id: (alert as any).id, bureau: alert.bureau },
            },
          });
        } catch (e) {
          console.error("Failed to send push notification:", e);
        }
      }
      // Get client profile for email
      const { data: clientProfile } = await supabase
        .from("profiles")
        .select("full_name, user_id")
        .eq("user_id", client_id)
        .maybeSingle();

      if (clientProfile) {
        // Get client email from auth (via edge function context)
        const { data: { user: clientUser } } = await supabase.auth.admin.getUserById(client_id);

        // §45: sign the client alert from the tenant's OWN brand, resolved present-only
        // from the client's tenant — never a hardcoded operator ("The PME Team"). The
        // login line uses the tenant's own sending domain when set, else the neutral
        // platform domain.
        const { data: clientRow } = await supabase
          .from("clients")
          .select("tenant_id")
          .eq("linked_user_id", client_id)
          .maybeSingle();
        const clientTenantId =
          (clientRow as { tenant_id?: string | null } | null)?.tenant_id ?? null;
        const operator = await resolveOperatorIdentity(supabase, clientTenantId);
        const signOffName = operator.from_name ?? operator.product_name;
        const signOff = signOffName ? `\n\nThe ${signOffName} Team` : "";
        const loginDomain =
          (operator.sender as { domain?: string } | undefined)?.domain ?? "paigeagent.ai";

        if (clientUser?.email) {
          for (const alert of criticalAlerts) {
            try {
              await supabase.functions.invoke("send-support-request", {
                body: {
                  type: "credit_alert",
                  to: clientUser.email,
                  subject: `Action Required — ${alert.alert_title} on Your Credit Report`,
                  message: `Hi ${(clientProfile.full_name || "").split(" ")[0] || "there"},\n\nWe detected something important on your credit file that needs your attention.\n\n${alert.alert_title}\n\n${alert.alert_description}\n\nLog in to ${loginDomain} to review the details and take action.${signOff}`,
                },
              });
            } catch (e) {
              console.error("Failed to send client alert email:", e);
            }
          }
        }

        // Notify assigned coach
        const { data: coaching } = await supabase
          .from("coach_clients")
          .select("coach_user_id")
          .eq("client_user_id", client_id)
          .eq("status", "active")
          .limit(1);

        if (coaching && coaching.length > 0) {
          const { data: { user: coachUser } } = await supabase.auth.admin.getUserById(coaching[0].coach_user_id);
          const { data: coachProfile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", coaching[0].coach_user_id)
            .maybeSingle();

          if (coachUser?.email) {
            const coachName = (coachProfile?.full_name || "").split(" ")[0] || "Coach";
            const clientName = clientProfile.full_name || "Your client";

            for (const alert of criticalAlerts) {
              try {
                await supabase.functions.invoke("send-support-request", {
                  body: {
                    type: "credit_alert_coach",
                    to: coachUser.email,
                    subject: `Client Alert — ${clientName} — ${alert.alert_title}`,
                    message: `${coachName},\n\nYour client ${clientName} has a new critical alert on their PaigeAgent credit file.\n\n${alert.alert_title}\n\n${alert.alert_description}\n\nBureau: ${alert.bureau || "N/A"}\n\nLog in to review.\n\nPaigeAgent Alert System`,
                  },
                });
              } catch (e) {
                console.error("Failed to send coach alert email:", e);
              }
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        alerts_generated: insertedAlerts.length,
        critical: criticalAlerts.length,
        warnings: insertedAlerts.filter(a => a.alert_severity === "warning").length,
        informational: insertedAlerts.filter(a => a.alert_severity === "informational").length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("detect-credit-alerts error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function normalizeKey(creditor: string, accountNum?: string | null): string {
  const name = (creditor || "unknown").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const num = (accountNum || "").replace(/[^A-Z0-9]/gi, "");
  return `${name}__${num}`;
}
