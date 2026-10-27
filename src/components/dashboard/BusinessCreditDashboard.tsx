import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Layers3,
  FileUp,
  RefreshCcw,
  TrendingUp,
  Activity,
  CheckCircle2,
  Lock,
  DollarSign,
  BarChart3,
  ShieldCheck,
  Briefcase,
  Award,
  Sparkles,
  ArrowRight,
  AlertCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBuildScore } from "@/hooks/useBuildScore";
import { useFinancialKPIs } from "@/hooks/useFinancialKPIs";

const BusinessCreditDashboard = () => {
  const { toast } = useToast();
  const { data: buildScore } = useBuildScore();
  const { data: kpis } = useFinancialKPIs();
  const [syncing, setSyncing] = useState(false);

  const handleRunAssessment = () => {
    toast({
      title: "BUILD Assessment Started",
      description: "Analyzing your business credit profile...",
    });
  };

  const handleSyncBureaus = async () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      toast({
        title: "✅ Sync Complete",
        description: "Paige successfully synced your bureau data.",
      });
    }, 2000);
  };

  const handleUploadReport = () => {
    toast({
      title: "Upload Report",
      description: "Select your business credit report PDF...",
    });
  };

  const paydex = buildScore?.paydex || 0;
  const intelliscore = buildScore?.intelliscore || 0;
  const avgBalance = kpis?.avg_balance_90d || 0;
  const fundabilityPct = buildScore?.build_score || 0;

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 70) return "text-warning";
    return "text-destructive";
  };

  return (
    <div className="max-w-[920px] lg:max-w-7xl mx-auto space-y-4 md:space-y-6 p-3 md:p-6 bg-gradient-surface">
      {/* Header Section */}
      <div className="flex flex-col gap-3 md:gap-4">
        <div>
          <div className="flex items-center gap-2 md:gap-3 mb-2">
            <div className="p-2 rounded-lg bg-gradient-gold">
              <Layers3 className="w-5 h-5 md:w-6 md:h-6 text-primary" />
            </div>
            <h1 className="text-2xl md:text-4xl font-bold text-foreground">BUILD Program — Business</h1>
          </div>
          <p className="text-muted-foreground text-sm md:text-lg">
            Strategic account placement for fundable business credit.
          </p>
        </div>
        <div className="flex gap-2 md:gap-3">
          <Button 
            onClick={handleRunAssessment}
            className="bg-gradient-gold hover:opacity-90 text-primary font-semibold shadow-glow text-sm md:text-base flex-1 md:flex-none"
          >
            <Activity className="w-4 h-4 mr-2" />
            Run Assessment
          </Button>
          <Button 
            onClick={handleSyncBureaus}
            disabled={syncing}
            variant="outline"
            className="border-accent text-accent hover:bg-accent/10 text-sm md:text-base"
          >
            <RefreshCcw className={`w-4 h-4 md:mr-2 ${syncing ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">{syncing ? 'Syncing...' : 'Sync'}</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="shadow-card hover:shadow-glow transition-all duration-300 border-gold/20 cursor-pointer">
                <CardHeader className="pb-2 md:pb-3">
                  <CardDescription className="flex items-center gap-1 md:gap-2 text-xs">
                    <BarChart3 className="w-3 h-3 md:w-4 md:h-4 text-gold" />
                    Paydex
                  </CardDescription>
                  <CardTitle className={`text-2xl md:text-4xl font-bold ${getScoreColor(paydex)}`}>
                    {paydex}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Progress value={paydex} className="h-1.5 md:h-2 mb-2" />
                  <p className="text-xs text-muted-foreground">Target: 80+</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Dun & Bradstreet timeliness index. Aim for 80+ by paying early.</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="shadow-card hover:shadow-glow-teal transition-all duration-300 border-accent/20 cursor-pointer">
                <CardHeader className="pb-2 md:pb-3">
                  <CardDescription className="flex items-center gap-1 md:gap-2 text-xs">
                    <TrendingUp className="w-3 h-3 md:w-4 md:h-4 text-accent" />
                    Intelliscore
                  </CardDescription>
                  <CardTitle className={`text-2xl md:text-4xl font-bold ${getScoreColor(intelliscore)}`}>
                    {intelliscore}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Progress value={intelliscore} className="h-1.5 md:h-2 mb-2" />
                  <p className="text-xs text-muted-foreground">Target: 75+</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Experian Business risk score (1–100). 75+ unlocks prime tiers.</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="shadow-card hover:shadow-md transition-all duration-300 border-primary/20 cursor-pointer">
                <CardHeader className="pb-2 md:pb-3">
                  <CardDescription className="flex items-center gap-1 md:gap-2 text-xs">
                    <DollarSign className="w-3 h-3 md:w-4 md:h-4 text-primary" />
                    <span className="hidden sm:inline">Avg Balance (90d)</span>
                    <span className="sm:hidden">Avg Bal</span>
                  </CardDescription>
                  <CardTitle className="text-2xl md:text-4xl font-bold text-foreground">
                    ${(avgBalance / 1000).toFixed(0)}K
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Target: $5K+</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Underwriting optics from bank statements. Keep above target pre-apply.</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="shadow-card hover:shadow-glow transition-all duration-300 border-gold/20 cursor-pointer">
                <CardHeader className="pb-2 md:pb-3">
                  <CardDescription className="flex items-center gap-1 md:gap-2 text-xs">
                    <Award className="w-3 h-3 md:w-4 md:h-4 text-gold" />
                    <span className="hidden sm:inline">Fundability</span>
                    <span className="sm:hidden">Ready</span>
                  </CardDescription>
                  <CardTitle className={`text-2xl md:text-4xl font-bold ${getScoreColor(fundabilityPct)}`}>
                    {Math.round(fundabilityPct)}%
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Progress value={fundabilityPct} className="h-1.5 md:h-2 mb-2" />
                  <p className="text-xs text-muted-foreground">Composite score</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Composite of compliance, bureaus, and cashflow.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Import / Sync Section */}
      <div className="grid grid-cols-1 gap-3 md:gap-4">
        <Card className="shadow-card border-2 border-gold/30 hover:border-gold/50 transition-all group">
          <CardHeader className="pb-3 md:pb-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-3 rounded-lg bg-gradient-gold group-hover:shadow-glow transition-all">
                <FileUp className="w-5 h-5 md:w-6 md:h-6 text-primary" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base md:text-lg">Upload Business Credit Report (PDF)</CardTitle>
                <CardDescription className="text-xs md:text-sm">Dun & Bradstreet, Experian, Equifax, or Nav.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button onClick={handleUploadReport} className="w-full bg-gradient-gold hover:opacity-90 text-primary font-semibold text-sm md:text-base">
              <FileUp className="w-4 h-4 mr-2" />
              Upload Report
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-card border-2 border-accent/30 hover:border-accent/50 transition-all group">
          <CardHeader className="pb-3 md:pb-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-3 rounded-lg bg-gradient-teal group-hover:shadow-glow-teal transition-all">
                <RefreshCcw className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base md:text-lg">Sync from Bureaus</CardTitle>
                <CardDescription className="text-xs md:text-sm">Connect to business bureaus for automatic updates.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={handleSyncBureaus} 
              disabled={syncing}
              className="w-full bg-gradient-teal hover:opacity-90 text-white font-semibold text-sm md:text-base"
            >
              <RefreshCcw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* BUILD Ladder */}
      <Card className="shadow-card border-primary/20 bg-gradient-to-br from-card to-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl md:text-2xl">
            <Award className="w-5 h-5 md:w-6 md:h-6 text-gold" />
            BUILD Ladder
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">Progress through the B.U.I.L.D framework tiers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 md:space-y-6">
            {/* Tier Progress Bar */}
            <div className="grid grid-cols-5 gap-2 md:gap-3">
              {[
                { tier: 'B', label: 'Base', desc: 'Identity & Compliance', unlocked: buildScore?.tier_b_unlocked || true },
                { tier: 'U', label: 'Utility', desc: 'Utility & Vendors', unlocked: buildScore?.tier_u_unlocked || false },
                { tier: 'I', label: 'Intermediate', desc: 'Store/Fleet Cards', unlocked: buildScore?.tier_i_unlocked || false },
                { tier: 'L', label: 'Leverage', desc: 'Corporate/No-PG', unlocked: buildScore?.tier_l_unlocked || false },
                { tier: 'D', label: 'Develop', desc: 'Maintenance Loop', unlocked: buildScore?.tier_d_unlocked || false },
              ].map((item, index) => (
                <div key={item.tier} className="relative">
                  <Card
                    className={`text-center p-2 md:p-4 transition-all duration-300 ${
                      item.unlocked
                        ? 'bg-gradient-gold shadow-glow border-gold'
                        : 'bg-muted/20 border-muted'
                    } ${buildScore?.current_tier === item.tier ? 'ring-4 ring-gold/50' : ''}`}
                  >
                    {item.unlocked ? (
                      <CheckCircle2 className="w-6 h-6 md:w-10 md:h-10 text-primary mx-auto mb-1 md:mb-2" />
                    ) : (
                      <Lock className="w-6 h-6 md:w-10 md:h-10 text-muted-foreground mx-auto mb-1 md:mb-2" />
                    )}
                    <div className="text-xl md:text-3xl font-bold text-foreground mb-0.5 md:mb-1">{item.tier}</div>
                    <div className="text-[10px] md:text-xs font-semibold text-foreground mb-0.5 md:mb-1">{item.label}</div>
                    <div className="text-[9px] md:text-xs text-muted-foreground hidden sm:block">{item.desc}</div>
                  </Card>
                  {index < 4 && (
                    <div className="absolute top-1/2 -right-2 transform -translate-y-1/2 z-10">
                      <ArrowRight className={`w-4 h-4 ${item.unlocked ? 'text-gold' : 'text-muted-foreground'}`} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* BUILD Score */}
            <div className="bg-primary/5 rounded-lg p-4 md:p-6 border border-primary/10">
              <div className="flex items-center justify-between mb-3 md:mb-4">
                <span className="text-base md:text-lg font-semibold text-foreground">BUILD Score</span>
                <span className="text-3xl md:text-5xl font-bold text-gold">
                  {Math.round(buildScore?.build_score || 0)}
                  <span className="text-lg md:text-2xl text-muted-foreground">/100</span>
                </span>
              </div>
              <Progress value={buildScore?.build_score || 0} className="h-3 md:h-4 mb-3 md:mb-4" />
              <p className="text-xs md:text-sm text-muted-foreground text-center">
                70+ unlocks Funding Plan
              </p>
            </div>

            {/* Component Breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Compliance</span>
                  <span className="text-sm font-bold text-foreground">{Math.round(buildScore?.compliance_score || 0)}</span>
                </div>
                <Progress value={buildScore?.compliance_score || 0} className="h-1.5 md:h-2" />
                <p className="text-[10px] md:text-xs text-muted-foreground">20% weight</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Vendors</span>
                  <span className="text-sm font-bold text-foreground">{Math.round(buildScore?.vendors_score || 0)}</span>
                </div>
                <Progress value={buildScore?.vendors_score || 0} className="h-1.5 md:h-2" />
                <p className="text-[10px] md:text-xs text-muted-foreground">25% weight</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Bureaus</span>
                  <span className="text-sm font-bold text-foreground">{Math.round(buildScore?.bureau_health_score || 0)}</span>
                </div>
                <Progress value={buildScore?.bureau_health_score || 0} className="h-1.5 md:h-2" />
                <p className="text-[10px] md:text-xs text-muted-foreground">20% weight</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Funding</span>
                  <span className="text-sm font-bold text-foreground">{Math.round(buildScore?.funding_readiness_score || 0)}</span>
                </div>
                <Progress value={buildScore?.funding_readiness_score || 0} className="h-1.5 md:h-2" />
                <p className="text-[10px] md:text-xs text-muted-foreground">20% weight</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Activity</span>
                  <span className="text-sm font-bold text-foreground">{Math.round(buildScore?.activity_recency_score || 0)}</span>
                </div>
                <Progress value={buildScore?.activity_recency_score || 0} className="h-1.5 md:h-2" />
                <p className="text-[10px] md:text-xs text-muted-foreground">15% weight</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Three Column Layout */}
      <div className="grid grid-cols-1 gap-3 md:gap-4">
        {/* Vendor Summary */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Briefcase className="w-4 h-4 md:w-5 md:h-5 text-gold" />
              Vendor Activity
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">Active tradelines and payment history</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="text-center py-6 md:py-8 text-muted-foreground">
                <Briefcase className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 md:mb-3 opacity-20" />
                <p className="text-xs md:text-sm mb-3 md:mb-4">No tradelines yet</p>
                <Button className="bg-gradient-gold hover:opacity-90 text-primary font-semibold text-sm md:text-base">
                  Add Starter Vendors
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bureau Snapshot */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <ShieldCheck className="w-4 h-4 md:w-5 md:h-5 text-accent" />
              Bureau Snapshot
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">Bureau verification status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 md:space-y-3">
            <div className="flex items-center justify-between p-2 md:p-3 rounded-lg bg-muted/20">
              <span className="text-xs md:text-sm font-medium">D-U-N-S</span>
              <Badge variant="outline" className={buildScore?.duns_verified ? "bg-success/10 text-success border-success/20 text-xs" : "bg-muted text-muted-foreground text-xs"}>
                {buildScore?.duns_verified ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                <span className="hidden sm:inline">{buildScore?.duns_verified ? 'Verified' : 'Pending'}</span>
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 md:p-3 rounded-lg bg-muted/20">
              <span className="text-xs md:text-sm font-medium">Experian Business</span>
              <Badge variant="outline" className="bg-muted text-muted-foreground text-xs">
                <AlertCircle className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">Pending</span>
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 md:p-3 rounded-lg bg-muted/20">
              <span className="text-xs md:text-sm font-medium">Equifax Business</span>
              <Badge variant="outline" className="bg-muted text-muted-foreground text-xs">
                <AlertCircle className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">Pending</span>
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Funding Readiness */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-primary" />
              Funding Readiness
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">Key underwriting metrics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 md:space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs md:text-sm text-muted-foreground">DSCR</span>
              <span className="text-base md:text-lg font-bold">{kpis?.dscr?.toFixed(2) || '0.00'}</span>
            </div>
            <Progress value={(kpis?.dscr || 0) * 50} className="h-1.5 md:h-2" />
            <p className="text-[10px] md:text-xs text-muted-foreground">Target: ≥ 1.25</p>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs md:text-sm text-muted-foreground">Avg Balance (90d)</span>
              <span className="text-base md:text-lg font-bold">${((kpis?.avg_balance_90d || 0) / 1000).toFixed(1)}K</span>
            </div>
            <Progress value={((kpis?.avg_balance_90d || 0) / 50000) * 100} className="h-1.5 md:h-2" />
            <p className="text-[10px] md:text-xs text-muted-foreground">Target: ≥ $5K</p>

            <Button className="w-full mt-3 md:mt-4 text-sm md:text-base" variant="outline">
              View Funding Plan
              <ArrowRight className="w-3 h-3 md:w-4 md:h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Paige Insights */}
      <Card className="shadow-card border-2 border-gold/20 bg-gradient-to-br from-card to-gold/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="w-6 h-6 text-gold" />
            Insights from Paige
          </CardTitle>
          <CardDescription>AI-driven recommendations for your BUILD journey</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 md:space-y-3">
          {buildScore?.tier_u_unlocked === false && (
            <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4 rounded-lg bg-primary/5 border border-primary/10">
              <div className="p-1.5 md:p-2 rounded-full bg-gradient-gold">
                <Sparkles className="w-3 h-3 md:w-4 md:h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-xs md:text-sm font-medium text-foreground mb-1">Unlock Tier U (Utility)</p>
                <p className="text-xs md:text-sm text-muted-foreground">
                  Complete your compliance setup and verify your DUNS number to unlock utility vendor applications.
                </p>
              </div>
            </div>
          )}
          {buildScore?.active_vendors < 3 && (
            <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4 rounded-lg bg-accent/5 border border-accent/10">
              <div className="p-1.5 md:p-2 rounded-full bg-gradient-teal">
                <Briefcase className="w-3 h-3 md:w-4 md:h-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-xs md:text-sm font-medium text-foreground mb-1">Build Your Trade History</p>
                <p className="text-xs md:text-sm text-muted-foreground">
                  You need at least 3 active vendors to unlock Tier I. Apply to Summa, Uline, and Quill to get started.
                </p>
              </div>
            </div>
          )}
          {(kpis?.dscr || 0) < 1.25 && (
            <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4 rounded-lg bg-warning/5 border border-warning/10">
              <div className="p-1.5 md:p-2 rounded-full bg-warning/20">
                <TrendingUp className="w-3 h-3 md:w-4 md:h-4 text-warning" />
              </div>
              <div className="flex-1">
                <p className="text-xs md:text-sm font-medium text-foreground mb-1">Improve Your DSCR</p>
                <p className="text-xs md:text-sm text-muted-foreground">
                  Your DSCR is {kpis?.dscr?.toFixed(2) || '0.00'}. Aim for 1.25+ before applying for LOC to improve approval odds.
                </p>
              </div>
            </div>
          )}
          <Button className="w-full mt-3 md:mt-4 bg-gradient-gold hover:opacity-90 text-primary font-semibold text-sm md:text-base">
            Apply Recommendations
            <ArrowRight className="w-3 h-3 md:w-4 md:h-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default BusinessCreditDashboard;
