import { useEffect, useState } from "react";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Plug, CheckCircle2, AlertTriangle, TrendingUp, Wallet, PieChart as PieIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend } from "recharts";
import { formatDistanceToNow } from "date-fns";

interface Props {
  businessId?: string;
  userId: string;
  onGoToConnections?: () => void;
}

interface QBConnection {
  id: string;
  qb_company_name: string | null;
  last_synced_at: string | null;
  environment: string;
  is_active: boolean;
}

interface QBFinancials {
  total_revenue: number;
  total_expenses: number;
  gross_profit: number;
  gross_margin_percent: number;
  net_income: number;
  net_margin_percent: number;
  cash_and_bank_balance: number;
  accounts_receivable: number;
  accounts_payable: number;
  monthly_burn_rate: number;
  cash_runway_months: number | null;
  payroll_expenses: number;
  marketing_expenses: number;
  revenue_per_month: { month: string; revenue: number }[];
  top_expense_categories: { name: string; amount: number }[];
  synced_at: string;
}

const PIE_COLORS = ["#d4a574", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function runwayColor(months: number | null): string {
  if (months === null) return "text-muted-foreground";
  if (months >= 6) return "text-emerald-500";
  if (months >= 3) return "text-amber-500";
  return "text-red-500";
}

function marginColor(pct: number, type: "gross" | "net" | "payroll" | "marketing"): string {
  if (type === "gross") {
    if (pct >= 50) return "text-emerald-500";
    if (pct >= 30) return "text-amber-500";
    return "text-red-500";
  }
  if (type === "net") {
    if (pct >= 10) return "text-emerald-500";
    if (pct >= 5) return "text-amber-500";
    return "text-red-500";
  }
  if (type === "payroll") {
    if (pct >= 15 && pct <= 30) return "text-emerald-500";
    if (pct <= 40) return "text-amber-500";
    return "text-red-500";
  }
  // marketing
  if (pct >= 5 && pct <= 15) return "text-emerald-500";
  if (pct <= 25) return "text-amber-500";
  return "text-red-500";
}

export function FinancialIntelligenceSection({ businessId, userId, onGoToConnections }: Props) {
  // The customer's agent (Cura, or the business's own name for it), never PAIGE, the owner's COO.
  const { agentName } = useCustomerIdentity();
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<QBConnection | null>(null);
  const [financials, setFinancials] = useState<QBFinancials | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    const { data: conn } = await supabase
      .from("quickbooks_connections")
      .select("id, qb_company_name, last_synced_at, environment, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    setConnection(conn as QBConnection | null);

    if (conn) {
      const { data: fin } = await supabase
        .from("quickbooks_financials")
        .select("*")
        .eq("qb_connection_id", conn.id)
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setFinancials(fin as unknown as QBFinancials | null);
    } else {
      setFinancials(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // Listen for ?connected=true after OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      toast.success("QuickBooks connected!");
      // Strip query to avoid re-toast
      window.history.replaceState({}, "", window.location.pathname);
    }
    const qbErr = params.get("qb_error");
    if (qbErr) toast.error(`QuickBooks: ${qbErr}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("quickbooks-sync-financials", {
        body: {},
      });
      if (error) throw error;
      toast.success("QuickBooks synced");
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect QuickBooks? This will remove all synced financial data.")) return;
    try {
      const { error } = await supabase.functions.invoke("quickbooks-disconnect", { body: {} });
      if (error) throw error;
      toast.success("QuickBooks disconnected");
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  if (loading) {
    return (
      <Card><CardContent className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></CardContent></Card>
    );
  }

  // ====== Not connected — empty state directing to Connections tab ======
  if (!connection) {
    return (
      <Card className="border-dashed border-primary/30">
        <CardContent className="py-16 text-center space-y-5">
          <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
            <Plug className="w-6 h-6 text-primary" />
          </div>
          <div className="space-y-2 max-w-md mx-auto">
            <h3 className="text-lg font-semibold text-foreground">
              Connect QuickBooks to unlock your Financial Intelligence dashboard
            </h3>
            <p className="text-sm text-muted-foreground">
              Once connected, {agentName} works from your real revenue, margins, cash runway, burn rate, and expense intelligence — not estimates.
            </p>
          </div>
          <Button
            onClick={() => onGoToConnections?.()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            Go to Connections
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Read-only access · OAuth secured · Disconnect anytime
          </p>
        </CardContent>
      </Card>
    );
  }

  // ====== Connected ======
  const payrollPct = financials && financials.total_revenue > 0 ? (Number(financials.payroll_expenses) / Number(financials.total_revenue)) * 100 : 0;
  const marketingPct = financials && financials.total_revenue > 0 ? (Number(financials.marketing_expenses) / Number(financials.total_revenue)) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <div>
              <div className="font-semibold">{connection.qb_company_name || "QuickBooks Connected"}</div>
              <div className="text-xs text-muted-foreground">
                {connection.last_synced_at
                  ? `Last synced ${formatDistanceToNow(new Date(connection.last_synced_at), { addSuffix: true })}`
                  : "Not yet synced"} · {connection.environment}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              {syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Sync Now
            </Button>
            <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={handleDisconnect}>
              Disconnect
            </Button>
          </div>
        </CardContent>
      </Card>

      {!financials ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No financial data yet. Click Sync Now to pull your latest QuickBooks data.
        </CardContent></Card>
      ) : (
        <>
          {/* Row 1 — Revenue + Profit */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <MetricCard label="Total Revenue (30d)" value={fmtCurrency(Number(financials.total_revenue))} icon={<TrendingUp className="w-4 h-4" />} />
            <MetricCard
              label="Gross Margin"
              value={`${Number(financials.gross_margin_percent).toFixed(1)}%`}
              subtext={fmtCurrency(Number(financials.gross_profit))}
              colorClass={marginColor(Number(financials.gross_margin_percent), "gross")}
              benchmark="Healthy: 50%+ services / 30%+ product"
            />
            <MetricCard
              label="Net Margin"
              value={`${Number(financials.net_margin_percent).toFixed(1)}%`}
              subtext={fmtCurrency(Number(financials.net_income))}
              colorClass={marginColor(Number(financials.net_margin_percent), "net")}
              benchmark="Healthy: 10%+"
            />
          </div>

          {/* Revenue trend chart */}
          {financials.revenue_per_month && financials.revenue_per_month.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Revenue Trend (Trailing 12 Months)</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={financials.revenue_per_month}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                    <Line type="monotone" dataKey="revenue" stroke="#d4a574" strokeWidth={2} dot={{ fill: "#d4a574" }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Row 2 — Cash + Runway */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <MetricCard label="Cash & Bank" value={fmtCurrency(Number(financials.cash_and_bank_balance))} icon={<Wallet className="w-4 h-4" />} />
            <MetricCard label="Accounts Receivable" value={fmtCurrency(Number(financials.accounts_receivable))} />
            <MetricCard label="Monthly Burn Rate" value={fmtCurrency(Number(financials.monthly_burn_rate))} />
            <MetricCard
              label="Cash Runway"
              value={financials.cash_runway_months !== null ? `${Number(financials.cash_runway_months).toFixed(1)} mo` : "N/A"}
              colorClass={runwayColor(financials.cash_runway_months !== null ? Number(financials.cash_runway_months) : null)}
              benchmark="Green 6+ · Amber 3-6 · Red <3"
            />
          </div>

          {/* Row 3 — Expense intelligence */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <MetricCard
              label="Payroll % of Revenue"
              value={`${payrollPct.toFixed(1)}%`}
              colorClass={marginColor(payrollPct, "payroll")}
              benchmark="Healthy: 15-30%"
            />
            <MetricCard
              label="Marketing % of Revenue"
              value={`${marketingPct.toFixed(1)}%`}
              colorClass={marginColor(marketingPct, "marketing")}
              benchmark="Healthy: 5-15%"
            />
            {financials.top_expense_categories && financials.top_expense_categories.length > 0 && (
              <Card className="md:row-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><PieIcon className="w-4 h-4" /> Top Expense Categories</CardTitle>
                </CardHeader>
                <CardContent className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={financials.top_expense_categories.slice(0, 6)}
                        dataKey="amount"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        innerRadius={40}
                      >
                        {financials.top_expense_categories.slice(0, 6).map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, subtext, colorClass, benchmark, icon }: { label: string; value: string; subtext?: string; colorClass?: string; benchmark?: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">{icon} {label}</div>
        <div className={`text-2xl font-bold ${colorClass || "text-foreground"}`}>{value}</div>
        {subtext && <div className="text-xs text-muted-foreground mt-1">{subtext}</div>}
        {benchmark && <div className="text-[10px] text-muted-foreground/70 mt-1">{benchmark}</div>}
      </CardContent>
    </Card>
  );
}
