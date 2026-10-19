import { useEffect, useState } from "react";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  Sparkles,
  Building2,
  CreditCard,
  Globe,
  Mail,
  MessageSquare,
  ShoppingBag,
  Users2,
  FileSpreadsheet,
  Receipt,
  Wallet,
  Store,
  BarChart3,
  ShieldCheck,
  LineChart,
  Database,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QuickBooksConsentDialog } from "./QuickBooksConsentDialog";

interface Props {
  businessId?: string;
  userId: string;
}

interface ComingSoonItem {
  key: string;
  name: string;
  description: string;
  icon: React.ElementType;
}

const COMING_SOON: ComingSoonItem[] = [
  { key: "stripe", name: "Stripe", description: "Connect your payment processing for revenue analytics and MRR tracking", icon: CreditCard },
  { key: "google_business", name: "Google Business Profile", description: "Sync your business listing for credibility scoring with lenders", icon: Globe },
  { key: "gusto", name: "Gusto", description: "Connect payroll data for payroll-to-revenue ratio coaching", icon: Users2 },
  { key: "square", name: "Square", description: "Connect point-of-sale data for retail revenue intelligence", icon: Store },
  { key: "shopify", name: "Shopify", description: "Connect your store for eCommerce revenue and inventory coaching", icon: ShoppingBag },
  { key: "xero", name: "Xero", description: "Alternative accounting integration for non-QuickBooks users", icon: Receipt },
  { key: "hubspot", name: "HubSpot", description: "Connect your CRM for CAC and pipeline analytics", icon: Users2 },
  { key: "google_drive", name: "Google Drive", description: "Sync financial documents and statements directly", icon: FileSpreadsheet },
  { key: "mailchimp", name: "Mailchimp", description: "Connect email marketing for CAC attribution", icon: Mail },
  { key: "slack", name: "Slack", description: "Get your portal's notifications and alerts in your Slack workspace", icon: MessageSquare },
];

export function ConnectionsSection({ businessId, userId }: Props) {
  // The customer's agent (Cura, or the business's own name for it), never PAIGE, the owner's COO.
  const { agentName } = useCustomerIdentity();
  const [loading, setLoading] = useState(true);
  const [qbConnected, setQbConnected] = useState(false);
  const [qbCompanyName, setQbCompanyName] = useState<string | null>(null);
  const [qbLastSync, setQbLastSync] = useState<string | null>(null);
  const [plaidCount, setPlaidCount] = useState(0);
  const [consentOpen, setConsentOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dnbPaydex, setDnbPaydex] = useState<number | null>(null);
  const [experianIntelliscore, setExperianIntelliscore] = useState<number | null>(null);
  const [equifaxSbfe, setEquifaxSbfe] = useState<number | null>(null);

  const fetchStatuses = async () => {
    setLoading(true);
    const [qbRes, plaidRes, bizRes] = await Promise.all([
      supabase
        .from("quickbooks_connections")
        .select("qb_company_name, last_synced_at, is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("connected_bank_accounts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true),
      supabase
        .from("businesses")
        .select("dnb_paydex_score, experian_intelliscore, equifax_sbfe_score")
        .eq("owner_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (qbRes.data) {
      setQbConnected(true);
      setQbCompanyName(qbRes.data.qb_company_name);
      setQbLastSync(qbRes.data.last_synced_at);
    } else {
      setQbConnected(false);
      setQbCompanyName(null);
      setQbLastSync(null);
    }
    setPlaidCount(plaidRes.count || 0);
    setDnbPaydex(bizRes.data?.dnb_paydex_score ?? null);
    setExperianIntelliscore(bizRes.data?.experian_intelliscore ?? null);
    setEquifaxSbfe(bizRes.data?.equifax_sbfe_score ?? null);
    setLoading(false);
  };

  useEffect(() => {
    fetchStatuses();
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      toast.success("QuickBooks connected!");
      window.history.replaceState({}, "", window.location.pathname);
    }
    const qbErr = params.get("qb_error");
    if (qbErr) toast.error(`QuickBooks: ${qbErr}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleQBSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("quickbooks-sync-financials", { body: {} });
      if (error) throw error;
      toast.success("QuickBooks synced");
      await fetchStatuses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleQBDisconnect = async () => {
    if (!confirm("Disconnect QuickBooks? This will remove all synced financial data.")) return;
    try {
      const { error } = await supabase.functions.invoke("quickbooks-disconnect", { body: {} });
      if (error) throw error;
      toast.success("QuickBooks disconnected");
      await fetchStatuses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  const liveConnectedCount = (qbConnected ? 1 : 0) + (plaidCount > 0 ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* Header summary */}
      <Card className="border-primary/20 bg-gradient-to-br from-card to-primary/5">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Plug className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold text-foreground">App Connections</div>
              <div className="text-xs text-muted-foreground">
                Connect external apps so {agentName} can work from your real data instead of estimates.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
              {liveConnectedCount} connected
            </Badge>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              2 live · {COMING_SOON.length} coming soon
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ===================== CONNECTED APPS ===================== */}
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Connected Apps</h3>
          <p className="text-xs text-muted-foreground">Live integrations — connect now so {agentName} works from your real data.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* QuickBooks Online */}
          <Card
            className={`relative flex flex-col transition-all ${
              qbConnected
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-primary/30 hover:border-primary/60 hover:shadow-md"
            }`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-md bg-[#2CA01C] text-white flex items-center justify-center font-bold text-sm shrink-0">
                    qb
                  </div>
                  <CardTitle className="text-sm">QuickBooks Online</CardTitle>
                </div>
                {qbConnected ? (
                  <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] gap-1 shrink-0">
                    <CheckCircle2 className="w-3 h-3" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] shrink-0">Not Connected</Badge>
                )}
              </div>
              <CardDescription className="text-xs leading-snug pt-1">
                Connect your books for real-time P&L coaching, cash flow analysis, and expense optimization
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 pb-3 mt-auto">
              {qbConnected ? (
                <div className="space-y-2">
                  <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                    {qbCompanyName || "Connected"}
                  </div>
                  {qbLastSync && (
                    <div className="text-[10px] text-muted-foreground">
                      Last sync {new Date(qbLastSync).toLocaleDateString()}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleQBSync} disabled={syncing} className="h-7 text-xs flex-1">
                      {syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                      Sync
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleQBDisconnect} className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10">
                      Disconnect
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setConsentOpen(true)}
                  className="w-full h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Connect
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Plaid */}
          <Card
            className={`relative flex flex-col transition-all ${
              plaidCount > 0
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-primary/30 hover:border-primary/60 hover:shadow-md"
            }`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-md bg-foreground text-background flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <CardTitle className="text-sm">Plaid — Bank Accounts</CardTitle>
                </div>
                {plaidCount > 0 ? (
                  <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] gap-1 shrink-0">
                    <CheckCircle2 className="w-3 h-3" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] shrink-0">Not Connected</Badge>
                )}
              </div>
              <CardDescription className="text-xs leading-snug pt-1">
                Link your personal and business bank accounts for cash flow visibility and funding readiness assessment
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 pb-3 mt-auto">
              {plaidCount > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                    {plaidCount} account{plaidCount === 1 ? "" : "s"} linked
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => (window.location.href = "/app/business")}
                    className="w-full h-7 text-xs"
                  >
                    Manage
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => (window.location.href = "/app/business")}
                  className="w-full h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Connect
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ===================== BUSINESS CREDIT DATA ===================== */}
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Business Credit Data</h3>
          <p className="text-xs text-muted-foreground">
            Upload your latest bureau report to import your scores. Direct API sync coming soon.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Nav.com — still aggregator coming soon */}
          <Card className="relative flex flex-col border-border/50 opacity-75">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <CardTitle className="text-sm">Nav.com</CardTitle>
                </div>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/40 text-[10px] gap-1 shrink-0">
                  <Sparkles className="w-3 h-3" /> Coming Soon
                </Badge>
              </div>
              <CardDescription className="text-xs leading-snug pt-1">
                Aggregated business credit profile across D&B, Experian, and Equifax in one feed.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 pb-3 mt-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={() => toast.info("We'll notify you the moment Nav.com goes live.")}
                className="w-full h-8 text-xs"
              >
                Request Early Access
              </Button>
            </CardContent>
          </Card>

          {/* D&B card with upload */}
          <BusinessCreditUploadCard
            name="D&B Direct+"
            icon={ShieldCheck}
            description="DUNS-based PAYDEX, Delinquency Predictor, and Failure Score from Dun & Bradstreet."
            scoreLabel="Score"
            scoreValue={dnbPaydex}
            scorePrefix="Paydex"
            buttonLabel="Upload D&B Report"
            anchor="bureau-dnb"
          />

          {/* Experian Business card with upload */}
          <BusinessCreditUploadCard
            name="Experian Business"
            icon={LineChart}
            description="Intelliscore Plus, FSR, and full Business Credit Advantage report."
            scoreLabel="Intelliscore"
            scoreValue={experianIntelliscore}
            scorePrefix="Intelliscore"
            buttonLabel="Upload Experian Report"
            anchor="bureau-experian"
          />

          {/* Equifax SBFE card with upload */}
          <BusinessCreditUploadCard
            name="Equifax SBFE"
            icon={Database}
            description="Small Business Financial Exchange score used by SBA lenders and major banks."
            scoreLabel="SBFE Score"
            scoreValue={equifaxSbfe}
            scorePrefix="SBFE Score"
            buttonLabel="Upload SBFE Report"
            anchor="bureau-equifax"
          />
        </div>
      </div>

      {/* ===================== COMING SOON ===================== */}
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Coming Soon — Vote for what you want next
          </h3>
          <p className="text-xs text-muted-foreground">
            We add integrations based on member demand. Tell {agentName} in chat which one you need most.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {COMING_SOON.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.key} className="relative flex flex-col border-border/50 opacity-75">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <CardTitle className="text-sm">{card.name}</CardTitle>
                    </div>
                    <Badge
                      variant="outline"
                      className="bg-primary/10 text-primary border-primary/40 text-[10px] gap-1 shrink-0"
                    >
                      <Sparkles className="w-3 h-3" /> Coming Soon
                    </Badge>
                  </div>
                  <CardDescription className="text-xs leading-snug pt-1">
                    {card.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 pb-3 mt-auto">
                  <Button size="sm" variant="outline" disabled className="w-full h-8 text-xs cursor-not-allowed">
                    Coming Soon
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <QuickBooksConsentDialog open={consentOpen} onOpenChange={setConsentOpen} businessId={businessId} />
    </div>
  );
}

interface BusinessCreditUploadCardProps {
  name: string;
  icon: React.ElementType;
  description: string;
  scoreLabel: string;
  scoreValue: number | null;
  scorePrefix: string;
  buttonLabel: string;
  anchor: string;
}

function BusinessCreditUploadCard({
  name,
  icon: Icon,
  description,
  scoreValue,
  scorePrefix,
  buttonLabel,
  anchor,
}: BusinessCreditUploadCardProps) {
  const hasScore = scoreValue !== null && scoreValue !== undefined;
  return (
    <Card className="relative flex flex-col border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <CardTitle className="text-sm">{name}</CardTitle>
          </div>
          {hasScore && (
            <Badge
              variant="outline"
              className="bg-primary/10 text-primary border-primary/40 text-[10px] gap-1 shrink-0"
            >
              <CheckCircle2 className="w-3 h-3" /> Imported
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs leading-snug pt-1">{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-3 mt-auto space-y-2">
        <div className="text-xs text-muted-foreground">
          {hasScore ? (
            <span className="font-medium text-foreground">
              {scorePrefix}: {scoreValue}
            </span>
          ) : (
            <span>No report uploaded</span>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => {
            window.location.href = `/app/credit#${anchor}`;
          }}
          className="w-full h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {buttonLabel}
        </Button>
        <p className="text-[10px] text-muted-foreground italic text-center">
          Direct API sync coming soon
        </p>
      </CardContent>
    </Card>
  );
}
