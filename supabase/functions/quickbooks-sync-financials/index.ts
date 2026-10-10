import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { qbApiGet, parsePnL, parseBalanceSheet, parseMonthlyRevenue, refreshAccessToken } from "../_shared/quickbooks-utils.ts";
import { authorizeQuickBooksSync } from "../_shared/quickbooks-sync-authority.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function ensureFreshToken(supabase: any, connectionId: string) {
  const { data: conn, error } = await supabase
    .from("quickbooks_connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !conn) throw new Error(`Connection ${connectionId} not found`);

  const expiresAt = new Date(conn.token_expires_at).getTime();
  if (expiresAt > Date.now() + 5 * 60 * 1000) {
    const { data: dec } = await supabase.rpc("qb_decrypt_token", { _ciphertext: conn.access_token_encrypted });
    return { accessToken: dec, realmId: conn.qb_realm_id, environment: conn.environment, conn };
  }

  const { data: refDec } = await supabase.rpc("qb_decrypt_token", { _ciphertext: conn.refresh_token_encrypted });
  const newTokens = await refreshAccessToken(refDec);
  const { data: encA } = await supabase.rpc("qb_encrypt_token", { _plaintext: newTokens.access_token });
  const { data: encR } = await supabase.rpc("qb_encrypt_token", { _plaintext: newTokens.refresh_token });
  const newExpiry = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
  await supabase.from("quickbooks_connections").update({
    access_token_encrypted: encA,
    refresh_token_encrypted: encR,
    token_expires_at: newExpiry,
  }).eq("id", conn.id);
  return { accessToken: newTokens.access_token, realmId: conn.qb_realm_id, environment: conn.environment, conn };
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------
// Map a QuickBooks Account.AccountSubType to our banking_relationships
// relationship_type CHECK constraint.
// ----------------------------------------------------------------
function mapQbSubTypeToRelationship(subType: string | undefined, accountType: string | undefined): string | null {
  const s = (subType || "").toLowerCase();
  const t = (accountType || "").toLowerCase();
  if (s.includes("checking")) return "business_checking";
  if (s.includes("savings")) return "business_savings";
  if (s.includes("moneymarket") || s.includes("money_market")) return "business_money_market";
  if (s.includes("cashondhand") || s.includes("cashonhand")) return "business_checking";
  if (s.includes("creditcard") || t.includes("credit card")) return "business_line_of_credit";
  if (s.includes("lineofcredit")) return "business_line_of_credit";
  if (t === "bank") return "business_checking";
  return null;
}

// ----------------------------------------------------------------
// Estimate the average monthly inflow for a single QB account by
// summing positive deposit lines over the last ~6 months.
// We query JournalEntry / Deposit transactions filtered by AccountRef.
// ----------------------------------------------------------------
async function fetchAccountAvgMonthlyInflow(
  realmId: string,
  accessToken: string,
  environment: string,
  accountId: string,
  monthsBack: number,
): Promise<number | null> {
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  const sinceStr = since.toISOString().slice(0, 10);
  try {
    const q = encodeURIComponent(
      `SELECT TotalAmt FROM Deposit WHERE TxnDate >= '${sinceStr}' AND DepositToAccountRef = '${accountId}' MAXRESULTS 500`,
    );
    const res = await qbApiGet(realmId, accessToken, environment, `/query?query=${q}`);
    const deposits: any[] = res?.QueryResponse?.Deposit ?? [];
    if (deposits.length === 0) return null;
    const total = deposits.reduce((s, d) => s + (parseFloat(d?.TotalAmt ?? "0") || 0), 0);
    return Math.round((total / monthsBack) * 100) / 100;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------
// Pull the QB Account list (Bank + CreditCard types) and upsert one
// banking_relationships row per account with source='quickbooks'.
// ----------------------------------------------------------------
async function syncBankingRelationshipsFromQb(
  supabase: any,
  realmId: string,
  accessToken: string,
  environment: string,
  conn: any,
): Promise<number> {
  let upsertCount = 0;
  try {
    const q = encodeURIComponent(
      "SELECT Id, Name, AccountType, AccountSubType, CurrentBalance, OpenDate, FullyQualifiedName " +
        "FROM Account WHERE Active = true AND AccountType IN ('Bank','Credit Card') MAXRESULTS 200",
    );
    const res = await qbApiGet(realmId, accessToken, environment, `/query?query=${q}`);
    const accounts: any[] = res?.QueryResponse?.Account ?? [];
    if (accounts.length === 0) return 0;

    const now = new Date().toISOString();

    for (const acct of accounts) {
      const relType = mapQbSubTypeToRelationship(acct?.AccountSubType, acct?.AccountType);
      if (!relType) continue;

      // QB account "Name" is usually "Chase Business Checking" / "BoA Visa" etc.
      // We use the full account name as the institution_name — the manual UI can
      // group/rename later, but having the verified QB label is more accurate
      // than guessing.
      const institutionName: string = acct?.Name || acct?.FullyQualifiedName || "QuickBooks Account";

      const currentBalance = acct?.CurrentBalance != null ? Number(acct.CurrentBalance) : null;

      // Estimate average monthly inflow from Deposits (best-effort)
      const avgMonthly = await fetchAccountAvgMonthlyInflow(
        realmId,
        accessToken,
        environment,
        acct?.Id,
        6,
      );

      let monthsAtInstitution: number | null = null;
      if (acct?.OpenDate) {
        const openMs = new Date(acct.OpenDate).getTime();
        if (!isNaN(openMs)) {
          monthsAtInstitution = Math.max(
            0,
            Math.round((Date.now() - openMs) / (1000 * 60 * 60 * 24 * 30.4375)),
          );
        }
      }

      const isCreditCard = (acct?.AccountType || "").toLowerCase().includes("credit");

      const row = {
        user_id: conn.user_id,
        business_id: conn.business_id ?? null,
        institution_name: institutionName,
        institution_type: "bank" as const,
        relationship_type: relType,
        current_balance: currentBalance,
        // For credit cards `CurrentBalance` is the amount owed, not deposits;
        // we leave avg_monthly_balance null in that case.
        average_monthly_balance: isCreditCard ? null : (avgMonthly ?? currentBalance),
        months_at_institution: monthsAtInstitution,
        is_primary_institution: false,
        has_direct_deposit: false,
        nsf_count_last_12_months: 0,
        overdraft_count_last_12_months: 0,
        account_standing: "good" as const,
        source: "quickbooks" as const,
        qb_account_id: String(acct.Id),
        qb_synced_at: now,
      };

      const { error } = await supabase
        .from("banking_relationships")
        .upsert(row, { onConflict: "user_id,qb_account_id" });

      if (error) {
        console.warn("[qb-sync] banking_relationships upsert err:", error.message);
      } else {
        upsertCount++;
      }
    }
  } catch (e) {
    console.warn(
      "[qb-sync] syncBankingRelationshipsFromQb failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
  return upsertCount;
}

async function syncOneConnection(supabase: any, connectionId: string) {
  const { accessToken, realmId, environment, conn } = await ensureFreshToken(supabase, connectionId);

  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Fetch reports in parallel
  const [pnlMonthly, pnl30, balance, txnQuery] = await Promise.all([
    qbApiGet(realmId, accessToken, environment, `/reports/ProfitAndLoss?start_date=${fmtDate(oneYearAgo)}&end_date=${fmtDate(today)}&summarize_column_by=Month`),
    qbApiGet(realmId, accessToken, environment, `/reports/ProfitAndLoss?start_date=${fmtDate(thirtyDaysAgo)}&end_date=${fmtDate(today)}`),
    qbApiGet(realmId, accessToken, environment, `/reports/BalanceSheet`),
    qbApiGet(realmId, accessToken, environment, `/query?query=${encodeURIComponent(`SELECT * FROM Purchase WHERE TxnDate >= '${fmtDate(thirtyDaysAgo)}' ORDERBY TxnDate DESC MAXRESULTS 100`)}`).catch(() => ({ QueryResponse: {} })),
  ]);

  const pnl = parsePnL(pnl30);
  const bs = parseBalanceSheet(balance);
  const monthlyRevenue = parseMonthlyRevenue(pnlMonthly);

  // Compute metrics
  const grossMarginPct = pnl.total_revenue > 0 ? (pnl.gross_profit / pnl.total_revenue) * 100 : 0;
  const netMarginPct = pnl.total_revenue > 0 ? (pnl.net_income / pnl.total_revenue) * 100 : 0;

  // Burn rate = avg monthly operating expenses over last 3 months (approximate from 30-day x3 if not available)
  const lastThreeMonthsRev = monthlyRevenue.slice(-3);
  const monthlyBurn = pnl.total_expenses; // 30-day expenses ≈ monthly burn
  const cashRunway = monthlyBurn > 0 ? bs.cash_and_bank_balance / monthlyBurn : null;

  // Insert financials snapshot
  const { error: finErr } = await supabase.from("quickbooks_financials").insert({
    user_id: conn.user_id,
    business_id: conn.business_id,
    qb_connection_id: conn.id,
    period_start: fmtDate(thirtyDaysAgo),
    period_end: fmtDate(today),
    total_revenue: pnl.total_revenue,
    total_expenses: pnl.total_expenses,
    gross_profit: pnl.gross_profit,
    gross_margin_percent: Math.round(grossMarginPct * 100) / 100,
    net_income: pnl.net_income,
    net_margin_percent: Math.round(netMarginPct * 100) / 100,
    cogs: pnl.cogs,
    operating_expenses: pnl.operating_expenses,
    payroll_expenses: pnl.payroll_expenses,
    marketing_expenses: pnl.marketing_expenses,
    professional_fees: pnl.professional_fees,
    cash_and_bank_balance: bs.cash_and_bank_balance,
    accounts_receivable: bs.accounts_receivable,
    accounts_payable: bs.accounts_payable,
    monthly_burn_rate: monthlyBurn,
    cash_runway_months: cashRunway !== null ? Math.round(cashRunway * 100) / 100 : null,
    revenue_per_month: monthlyRevenue,
    top_expense_categories: pnl.top_expense_categories,
  });
  if (finErr) console.warn("[qb-sync] financials insert err:", finErr.message);

  // Insert recent transactions (Purchase entities)
  const purchases = txnQuery?.QueryResponse?.Purchase || [];
  for (const p of purchases.slice(0, 100)) {
    const lineDetails = p.Line?.[0]?.AccountBasedExpenseLineDetail;
    const category = lineDetails?.AccountRef?.name || null;
    const vendor = p.EntityRef?.name || null;
    await supabase.from("quickbooks_transactions").upsert({
      user_id: conn.user_id,
      qb_connection_id: conn.id,
      qb_transaction_id: p.Id,
      transaction_date: p.TxnDate,
      transaction_type: "purchase",
      amount: parseFloat(p.TotalAmt || "0"),
      category,
      vendor_or_customer: vendor,
      description: p.PrivateNote || p.Line?.[0]?.Description || null,
      is_business_expense: true,
    }, { onConflict: "qb_connection_id,qb_transaction_id,transaction_type" });
  }

  // Auto-populate banking_relationships from QB Account list.
  // Best-effort: failures here never block the financials snapshot.
  const bankingRowCount = await syncBankingRelationshipsFromQb(
    supabase,
    realmId,
    accessToken,
    environment,
    conn,
  );

  await supabase.from("quickbooks_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", conn.id);

  return {
    connection_id: conn.id,
    total_revenue: pnl.total_revenue,
    gross_margin: grossMarginPct,
    banking_rows_imported: bankingRowCount,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { user_id, sync_all, connection_id } = body;
    const authHeader = req.headers.get("Authorization");
    const authority = await authorizeQuickBooksSync(
      authHeader, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", sync_all === true,
      async () => {
        const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader! } },
        });
        const { data: { user }, error } = await authClient.auth.getUser();
        return error ? null : user?.id ?? null;
      },
    );
    if (!authority.allowed) {
      return new Response(JSON.stringify({ error: authority.status === 401 ? "Unauthorized" : "Forbidden" }), {
        status: authority.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (sync_all === true) {
      // Cron mode: sync all active connections
      const { data: conns, error: connectionError } = await supabase
        .from("quickbooks_connections")
        .select("id, user_id")
        .eq("is_active", true);
      if (connectionError) throw new Error("QuickBooks connection lookup failed");
      const results = [];
      for (const c of conns || []) {
        try {
          const r = await syncOneConnection(supabase, c.id);
          results.push({ ...r, status: "ok" });
        } catch (e) {
          results.push({ connection_id: c.id, status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
      return new Response(JSON.stringify({ synced: results.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Single user sync — verify caller owns it OR is service role
    const targetUserId = authority.actor === "person" ? authority.userId : user_id;

    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let connectionQuery = supabase
      .from("quickbooks_connections")
      .select("id")
      .eq("user_id", targetUserId)
      .eq("is_active", true);
    if (connection_id) connectionQuery = connectionQuery.eq("id", connection_id);
    const { data: conn, error: connectionError } = await connectionQuery.maybeSingle();
    if (connectionError) throw new Error("QuickBooks connection lookup failed");
    if (!conn) {
      return new Response(JSON.stringify({ error: "No active QB connection" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = await syncOneConnection(supabase, conn.id);
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[qb-sync]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
