import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Building2, Globe, BarChart3, FileText, Award, Sparkles, TrendingUp, Plug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FoundationSection } from "./FoundationSection";
import { BuildProgramSection } from "./BuildProgramSection";
import { PublicPresenceSection } from "./PublicPresenceSection";
import { BusinessCreditSection } from "./BusinessCreditSection";
import { FinancialDocsSection } from "./FinancialDocsSection";
import { SeparationAuditCard } from "./SeparationAuditCard";
import { FundingProfileSection } from "./FundingProfileSection";
import { FinancialIntelligenceSection } from "./FinancialIntelligenceSection";
import { ConnectionsSection } from "./ConnectionsSection";
import { BusinessWalkthrough } from "@/components/business/BusinessWalkthrough";
import { BusinessSelector } from "@/components/dashboard/BusinessSelector";
import { AddBusinessFlow } from "@/components/dashboard/AddBusinessFlow";

interface Props {
  clientId?: string; // For internal client mode
}

export function BusinessInfrastructureAssessment({ clientId }: Props) {
  const [businesses, setBusinesses] = useState<{ id: string; legal_name: string }[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("connections");
  const [addBusinessOpen, setAddBusinessOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Post-purchase UX — when Stripe redirects back with ?slot_added=true,
  // confirm the new slot, clear the param, and auto-open the add-business
  // flow so the user can immediately register their next entity.
  useEffect(() => {
    if (searchParams.get("slot_added") !== "true") return;
    toast.success(
      "Business slot added — you can now add another entity to your portfolio",
    );
    const next = new URLSearchParams(searchParams);
    next.delete("slot_added");
    setSearchParams(next, { replace: true });
    const t = setTimeout(() => setAddBusinessOpen(true), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Completion percentages
  const [foundationPct, setFoundationPct] = useState(0);
  const [presencePct, setPresencePct] = useState(0);
  const [bureauPct, setBureauPct] = useState(0);
  const [docsPct, setDocsPct] = useState(0);
  const [buildPct, setBuildPct] = useState(0);

  const overallScore = Math.round(
    (foundationPct * 0.25 + presencePct * 0.15 + bureauPct * 0.25 + docsPct * 0.15 + buildPct * 0.20)
  );

  useEffect(() => { fetchBusinesses(); }, [clientId]);

  const fetchBusinesses = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data } = await supabase
      .from("businesses")
      .select("id, legal_name")
      .eq("owner_user_id", user.id)
      .order("legal_name");

    if (data && data.length > 0) {
      setBusinesses(data);
      setSelectedBusinessId(data[0].id);
    }
  };

  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const roles = (data || []).map((r: { role: string }) => r.role);
      setIsAdmin(roles.includes("admin"));
    })();
  }, []);

  const tabs = [
    { value: "connections", label: "Connections", icon: Plug, pct: 0 },
    { value: "financials", label: "Financial Intel", icon: TrendingUp, pct: 0 },
    { value: "foundation", label: "Foundation", icon: Building2, pct: foundationPct },
    { value: "presence", label: "Public Presence", icon: Globe, pct: presencePct },
    { value: "credit", label: "Business Credit", icon: BarChart3, pct: bureauPct },
    { value: "docs", label: "Financial Docs", icon: FileText, pct: docsPct },
    { value: "build", label: "BUILD Program", icon: Award, pct: buildPct },
    { value: "funding-profile", label: "Funding Profile", icon: Sparkles, pct: 0 },
  ];

  const PlaceholderTab = ({ label }: { label: string }) => (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-sm text-muted-foreground">This section is coming in the next step.</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* Page Walkthrough */}
      <BusinessWalkthrough />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex-1">
          <h2 className="text-xl md:text-2xl font-bold text-foreground">Business Infrastructure Assessment</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Complete each section to maximize your funding readiness.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {businesses.length > 1 && (
            <Select value={selectedBusinessId} onValueChange={setSelectedBusinessId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {businesses.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {businesses.length === 1 && (
            <Badge variant="outline" className="text-sm py-1 px-3">
              <Building2 className="w-3 h-3 mr-1" />
              {businesses[0].legal_name}
            </Badge>
          )}
        </div>
      </div>

      {/* Overall Readiness Score */}
      <Card className="border-primary/20 bg-gradient-to-r from-card to-primary/5">
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Business Readiness Score</span>
            <span className="text-2xl font-bold text-primary">{overallScore}%</span>
          </div>
          <Progress value={overallScore} className="h-2.5" />
          <div className="flex justify-between mt-2">
            {tabs.map(t => (
              <div key={t.value} className="text-center">
                <div className="text-[10px] text-muted-foreground">{t.label}</div>
                <div className={`text-xs font-semibold ${t.pct >= 80 ? "text-emerald-500" : t.pct >= 40 ? "text-amber-500" : "text-muted-foreground"}`}>{t.pct}%</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Multi-business selector */}
      <BusinessSelector />

      {/* Personal/Business Separation Audit — always visible above the tabs */}
      {userId && selectedBusinessId && (
        <SeparationAuditCard userId={userId} businessId={selectedBusinessId} />
      )}

      {/* Tabbed Sections */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start">
          {tabs.map(t => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className={`text-xs gap-1.5 ${t.value === "connections" ? "data-[state=inactive]:bg-primary/10 data-[state=inactive]:text-primary data-[state=inactive]:border data-[state=inactive]:border-primary/30" : ""}`}
            >
              <t.icon className="w-3 h-3" />
              {t.label}
              {t.value === "connections" && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 bg-primary text-primary-foreground border-primary">
                  Apps
                </Badge>
              )}
              {t.value !== "connections" && t.value !== "financials" && t.value !== "funding-profile" && (
                <Badge variant="outline" className={`text-[10px] px-1 py-0 ml-1 ${t.pct >= 80 ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" : t.pct >= 40 ? "bg-amber-500/20 text-amber-600 border-amber-500/30" : ""}`}>
                  {t.pct}%
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="connections" className="mt-4">
          {!userId ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Loading...</CardContent></Card>
          ) : (
            <ConnectionsSection businessId={selectedBusinessId} userId={userId} />
          )}
        </TabsContent>

        <TabsContent value="foundation" className="mt-4">
          {businesses.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No Business Entity Found</h3>
                <p className="text-sm text-muted-foreground">Add a business entity from the Business Organization section to begin.</p>
              </CardContent>
            </Card>
          ) : (
            <FoundationSection businessId={selectedBusinessId} userId={userId} onCompletionChange={setFoundationPct} />
          )}
        </TabsContent>

        <TabsContent value="presence" className="mt-4">
          {businesses.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Globe className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No Business Entity Found</h3>
              <p className="text-sm text-muted-foreground">Add a business entity first.</p>
            </CardContent></Card>
          ) : (
            <PublicPresenceSection businessId={selectedBusinessId} userId={userId} onCompletionChange={setPresencePct} />
          )}
        </TabsContent>

        <TabsContent value="credit" className="mt-4">
          {businesses.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <BarChart3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No Business Entity Found</h3>
              <p className="text-sm text-muted-foreground">Add a business entity first.</p>
            </CardContent></Card>
          ) : (
            <BusinessCreditSection businessId={selectedBusinessId} userId={userId} onCompletionChange={setBureauPct} />
          )}
        </TabsContent>

        <TabsContent value="docs" className="mt-4">
          {businesses.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No Business Entity Found</h3>
              <p className="text-sm text-muted-foreground">Add a business entity first.</p>
            </CardContent></Card>
          ) : (
            <FinancialDocsSection businessId={selectedBusinessId} userId={userId} onCompletionChange={setDocsPct} />
          )}
        </TabsContent>


        <TabsContent value="financials" className="mt-4">
          {!userId ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Loading...</CardContent></Card>
          ) : (
            <FinancialIntelligenceSection
              businessId={selectedBusinessId}
              userId={userId}
              onGoToConnections={() => setActiveTab("connections")}
            />
          )}
        </TabsContent>

        <TabsContent value="funding-profile" className="mt-4">
          {businesses.length === 0 || !selectedBusinessId ? (
            <Card><CardContent className="py-12 text-center">
              <Sparkles className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No Business Entity Found</h3>
              <p className="text-sm text-muted-foreground">Add a business entity first.</p>
            </CardContent></Card>
          ) : (
            <FundingProfileSection businessId={selectedBusinessId} userId={userId} isAdmin={isAdmin} />
          )}
        </TabsContent>

        <TabsContent value="build" className="mt-4">
          {businesses.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No Business Entity Found</h3>
                <p className="text-sm text-muted-foreground">
                  Add a business entity from the Business Organization section to begin your infrastructure assessment.
                </p>
              </CardContent>
            </Card>
          ) : (
            <BuildProgramSection foundationPct={foundationPct} bureauPct={bureauPct} onCompletionChange={setBuildPct} businessId={selectedBusinessId} />
          )}
        </TabsContent>
      </Tabs>

      {/* Post-purchase auto-open from ?slot_added=true */}
      <AddBusinessFlow open={addBusinessOpen} onOpenChange={setAddBusinessOpen} />
    </div>
  );
}
