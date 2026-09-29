import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, DollarSign, FileText, Mail, StickyNote, Upload, AlertTriangle, Brain, TrendingUp, Database, User, Phone, AtSign, MapPin, Calendar, Shield, MessageSquare, Trash2, Edit3, Briefcase, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readUserPrimaryAddresses } from "@/lib/userPrimaryContact";
import type { Json } from "@/integrations/supabase/types";
import { ReportUploadTab } from "./ReportUploadTab";
import { OutreachCenter } from "./OutreachCenter";
import { PMEFundingReadiness } from "./PMEFundingReadiness";
import { ClientMemoryTab } from "./ClientMemoryTab";
// [§194] ClientOutcomesTab removed — credit monitoring only, no dispute outcomes.
import { AdminAccountManagement } from "./AdminAccountManagement";
import { AdminFactoryResetDialog, AdminChatHistory, AdminFundingOverride } from "./admin/AdminClientTools";
import { ClientDemographicsCard } from "./ClientDemographicsCard";
import { ClientGoalsCard } from "./ClientGoalsCard";
import { ClientFundingJourneyTab } from "@/components/funding-journey/ClientFundingJourneyTab";
import { QuickBooksAdminSummary } from "./admin/QuickBooksAdminSummary";
import { AdminBusinessPortfolioCard } from "@/components/admin/AdminBusinessPortfolioCard";
import { useTenantFeature } from "@/hooks/useTenantFeature";

interface ClientFileViewProps {
  clientUserId: string;
  onBack: () => void;
  userRole?: "admin" | "member";
}

interface ClientProfile {
  full_name: string | null;
  city: string | null;
  state: string | null;
  street_address: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  ssn_last_4: string | null;
  estimated_fico_eq: number | null;
  estimated_fico_ex: number | null;
  estimated_fico_tu: number | null;
  onboarding_completed: boolean | null;
  has_discrepancies: boolean | null;
  cross_bureau_discrepancies: Json[] | null;
  last_report_analyzed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_complimentary: boolean | null;
  // Intake / discovery
  primary_goal: string | null;
  primary_goal_category: string | null;
  goal_timeline: string | null;
  goal_amount: number | null;
  experience_level: string | null;
  financing_preference: string | null;
  biggest_obstacle: string | null;
  intake_completed: boolean | null;
  // Demographics
  gender_identity: string | null;
  ethnicity: string[] | null;
  is_veteran: boolean | null;
  is_service_disabled_veteran: boolean | null;
  is_us_citizen: boolean | null;
  is_permanent_resident: boolean | null;
  // Banking & assets
  primary_bank_name: string | null;
  primary_bank_months: number | null;
  primary_bank_average_balance: number | null;
  monthly_revenue_range: string | null;
  has_investment_accounts: boolean | null;
  investment_account_value_range: string | null;
  total_liquid_assets_range: string | null;
  has_real_estate_equity: boolean | null;
  real_estate_equity_range: string | null;
  has_equipment_assets: boolean | null;
  has_invoice_receivables: boolean | null;
  // Misc
  pme_phase: string | null;
  has_broker_access: boolean | null;
}

export function ClientFileView({ clientUserId, onBack, userRole = "member" }: ClientFileViewProps) {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  // The client's primary phone, from their contact methods.
  const [phone, setPhone] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("profile");
  const [subscription, setSubscription] = useState<{ plan_slug: string; status: string } | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [negativeCount, setNegativeCount] = useState(0);
  const [showFactoryReset, setShowFactoryReset] = useState(false);
  // Credit/funding surfaces (business credit portfolio, credit-report uploads)
  // are opt-in per tenant (§2/§9) — hidden entirely for generic coaching tenants.
  const { enabled: fundingEnabled } = useTenantFeature("funding_readiness");


  useEffect(() => {
    fetchProfile();
    fetchClientData();
  }, [clientUserId]);

  const fetchProfile = async () => {
    const [profileRes, subRes, rolesRes, contact] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "full_name, city, state, street_address:address, zip_code:postal_code, date_of_birth, ssn_last_4, estimated_fico_eq, estimated_fico_ex, estimated_fico_tu, onboarding_completed, has_discrepancies, cross_bureau_discrepancies, last_report_analyzed_at, created_at, updated_at, is_complimentary, primary_goal, primary_goal_category, goal_timeline, goal_amount, experience_level, financing_preference, biggest_obstacle, intake_completed, gender_identity, ethnicity, is_veteran, is_service_disabled_veteran, is_us_citizen, is_permanent_resident, primary_bank_name, primary_bank_months, primary_bank_average_balance, monthly_revenue_range, has_investment_accounts, investment_account_value_range, total_liquid_assets_range, has_real_estate_equity, real_estate_equity_range, has_equipment_assets, has_invoice_receivables, pme_phase, has_broker_access",
        )
        .eq("user_id", clientUserId)
        .maybeSingle(),
      supabase
        .from("user_subscriptions")
        .select("plan_slug, status")
        .eq("user_id", clientUserId)
        .maybeSingle(),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", clientUserId),
      readUserPrimaryAddresses(clientUserId),
    ]);

    if (profileRes.data) setProfile(profileRes.data as unknown as ClientProfile);
    setPhone(contact.phone);
    if (subRes.data) setSubscription(subRes.data);
    if (rolesRes.data) setRoles(rolesRes.data.map((r) => r.role));

    // Fetch the client's email via the admin edge function (browser cannot read auth.users directly)
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id === clientUserId) {
        setEmail(user.email || null);
      } else {
        const { data: listData } = await supabase.functions.invoke("admin-list-users");
        const authUsers = (listData?.users ?? []) as Array<{ id: string; email: string | null }>;
        const match = authUsers.find((u) => u.id === clientUserId);
        if (match?.email) setEmail(match.email);
      }
    } catch (err) {
      // Non-fatal — email will simply show as "—"
      console.warn("Could not resolve client email", err);
    }
  };

  const fetchClientData = async () => {
    const negRes = await supabase
      .from("credit_negative_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", clientUserId);
    setNegativeCount(negRes.count || 0);
  };

  const bestFICO = Math.max(
    profile?.estimated_fico_eq || 0,
    profile?.estimated_fico_ex || 0,
    profile?.estimated_fico_tu || 0
  );

  const toggleComplimentary = async (next: boolean) => {
    if (userRole !== "admin") return;
    // Optimistic update
    setProfile((prev) => prev ? { ...prev, is_complimentary: next } : prev);
    const { error } = await supabase
      .from("profiles")
      .update({ is_complimentary: next })
      .eq("user_id", clientUserId);
    if (error) {
      setProfile((prev) => prev ? { ...prev, is_complimentary: !next } : prev);
      toast.error("Failed to update complimentary access", { description: error.message });
      return;
    }
    toast.success(next ? "Complimentary access granted" : "Complimentary access revoked");
  };

  const ProfileField = ({ label, value, icon: Icon }: { label: string; value: string | null | undefined; icon?: React.ElementType }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
        <p className="text-sm font-medium text-foreground">{value || "—"}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground">
            {profile?.full_name || "Client File"}
          </h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {profile?.city && profile?.state && (
              <span className="text-sm text-muted-foreground">{profile.city}, {profile.state}</span>
            )}
            {bestFICO > 0 && (
              <Badge variant={bestFICO >= 700 ? "default" : bestFICO >= 600 ? "secondary" : "destructive"}>
                FICO: {bestFICO}
              </Badge>
            )}
            <Badge variant={profile?.onboarding_completed ? "default" : "outline"}>
              {profile?.onboarding_completed ? "Active" : "Pending"}
            </Badge>
            {profile?.is_complimentary && (
              <Badge className="bg-gradient-gold text-foreground border-0 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Complimentary
              </Badge>
            )}
            {profile?.has_discrepancies && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Cross-Bureau Discrepancies
              </Badge>
            )}
          </div>
        </div>
        {userRole === "admin" && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card">
              <Sparkles className="w-4 h-4 text-accent" />
              <Label htmlFor="complimentary-toggle" className="text-xs font-medium cursor-pointer">
                Complimentary
              </Label>
              <Switch
                id="complimentary-toggle"
                checked={!!profile?.is_complimentary}
                onCheckedChange={toggleComplimentary}
              />
            </div>
            <Button variant="destructive" size="sm" onClick={() => setShowFactoryReset(true)}>
              <Trash2 className="w-4 h-4 mr-1" /> Factory Reset
            </Button>
          </div>
        )}
      </div>

      <AdminFactoryResetDialog
        clientUserId={clientUserId}
        clientName={profile?.full_name || "Client"}
        open={showFactoryReset}
        onOpenChange={setShowFactoryReset}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="profile" className="text-xs">
            <User className="w-3 h-3 mr-1" /> Profile
          </TabsTrigger>
          {fundingEnabled && (
            <TabsTrigger value="credit-reports" className="text-xs">
              <Upload className="w-3 h-3 mr-1" /> Credit Reports
            </TabsTrigger>
          )}
          <TabsTrigger value="account-mgmt" className="text-xs">
            <Database className="w-3 h-3 mr-1" /> Account Mgmt
          </TabsTrigger>
          {fundingEnabled && (
            <>
              <TabsTrigger value="funding" className="text-xs">
                <DollarSign className="w-3 h-3 mr-1" /> Funding Readiness
              </TabsTrigger>
              <TabsTrigger value="funding-journey" className="text-xs">
                <Briefcase className="w-3 h-3 mr-1" /> Funding Journey
              </TabsTrigger>
            </>
          )}
          <TabsTrigger value="documents" className="text-xs">
            <FileText className="w-3 h-3 mr-1" /> Documents
          </TabsTrigger>
          <TabsTrigger value="outreach" className="text-xs">
            <Mail className="w-3 h-3 mr-1" /> Outreach
          </TabsTrigger>
          <TabsTrigger value="memory" className="text-xs">
            <Brain className="w-3 h-3 mr-1" /> Memory
          </TabsTrigger>
          {/* [§194] Outcomes tab removed */}
          <TabsTrigger value="chat-history" className="text-xs">
            <MessageSquare className="w-3 h-3 mr-1" /> Chat
          </TabsTrigger>
          <TabsTrigger value="notes" className="text-xs">
            <StickyNote className="w-3 h-3 mr-1" /> Notes
          </TabsTrigger>
        </TabsList>

        {/* Profile Overview Tab */}
        <TabsContent value="profile" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Personal Information */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="w-5 h-5" /> Personal Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-6">
                  <ProfileField label="Full Name" value={profile?.full_name} icon={User} />
                  <ProfileField label="Email" value={email} icon={AtSign} />
                  <ProfileField label="Phone" value={phone} icon={Phone} />
                  <ProfileField label="Date of Birth" value={profile?.date_of_birth ? new Date(profile.date_of_birth).toLocaleDateString() : null} icon={Calendar} />
                  <ProfileField label="SSN (Last 4)" value={profile?.ssn_last_4 ? `••••${profile.ssn_last_4}` : null} icon={Shield} />
                </div>

                {/* Address */}
                <div className="mt-6 pt-6 border-t border-border">
                  <h4 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> Address
                  </h4>
                  <div className="grid grid-cols-2 gap-6">
                    <ProfileField label="Street Address" value={profile?.street_address} />
                    <ProfileField label="City" value={profile?.city} />
                    <ProfileField label="State" value={profile?.state} />
                    <ProfileField label="Zip Code" value={profile?.zip_code} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick Stats Sidebar */}
            <div className="space-y-4">
              {/* Credit Scores — funding/credit content, gated (§2/§9) */}
              {fundingEnabled && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Credit Scores</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Equifax</span>
                      <span className="font-semibold">{profile?.estimated_fico_eq || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Experian</span>
                      <span className="font-semibold">{profile?.estimated_fico_ex || "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">TransUnion</span>
                      <span className="font-semibold">{profile?.estimated_fico_tu || "—"}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Account Stats */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Account Stats</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {fundingEnabled && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Negative Items</span>
                      <Badge variant={negativeCount > 0 ? "destructive" : "default"}>{negativeCount}</Badge>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Subscription</span>
                    <Badge variant="outline">{subscription?.plan_slug || "None"}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Roles</span>
                    <div className="flex gap-1">
                      {roles.length > 0 ? roles.map(r => (
                        <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                      )) : <span className="text-sm">—</span>}
                    </div>
                  </div>
                  {profile?.last_report_analyzed_at && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Last Report</span>
                      <span className="text-xs">{new Date(profile.last_report_analyzed_at).toLocaleDateString()}</span>
                    </div>
                  )}
                  {profile?.created_at && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Joined</span>
                      <span className="text-xs">{new Date(profile.created_at).toLocaleDateString()}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Goals & Discovery (coaches/admins can update status + notes) */}
          <div className="mt-6">
            <ClientGoalsCard clientUserId={clientUserId} canEdit />
          </div>

          {/* Demographics & Funding Profile (read-only for admins/coaches) */}
          <div className="mt-6">
            <ClientDemographicsCard clientUserId={clientUserId} />
          </div>

          {/* Financial Profile — banking & asset data captured during intake */}
          {(profile?.primary_bank_name ||
            profile?.monthly_revenue_range ||
            profile?.has_investment_accounts ||
            profile?.has_real_estate_equity ||
            profile?.total_liquid_assets_range) && (
            <div className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <DollarSign className="w-5 h-5" /> Financial Profile
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <ProfileField label="Primary Bank" value={profile?.primary_bank_name} />
                    <ProfileField
                      label="Months at Bank"
                      value={profile?.primary_bank_months ? String(profile.primary_bank_months) : null}
                    />
                    <ProfileField
                      label="Avg Monthly Balance"
                      value={
                        profile?.primary_bank_average_balance
                          ? `$${Number(profile.primary_bank_average_balance).toLocaleString()}`
                          : null
                      }
                    />
                    <ProfileField label="Monthly Revenue" value={profile?.monthly_revenue_range} />
                    <ProfileField label="Liquid Assets" value={profile?.total_liquid_assets_range} />
                    <ProfileField
                      label="Investment Accounts"
                      value={
                        profile?.has_investment_accounts
                          ? profile?.investment_account_value_range || "Yes"
                          : profile?.has_investment_accounts === false
                          ? "No"
                          : null
                      }
                    />
                    <ProfileField
                      label="Real Estate Equity"
                      value={
                        profile?.has_real_estate_equity
                          ? profile?.real_estate_equity_range || "Yes"
                          : profile?.has_real_estate_equity === false
                          ? "No"
                          : null
                      }
                    />
                    <ProfileField
                      label="Equipment Assets"
                      value={
                        profile?.has_equipment_assets === true
                          ? "Yes"
                          : profile?.has_equipment_assets === false
                          ? "No"
                          : null
                      }
                    />
                    <ProfileField
                      label="Invoice Receivables"
                      value={
                        profile?.has_invoice_receivables === true
                          ? "Yes"
                          : profile?.has_invoice_receivables === false
                          ? "No"
                          : null
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* QuickBooks Financial Summary — gives coaches financial context before strategy sessions */}
          <div className="mt-6">
            <QuickBooksAdminSummary clientUserId={clientUserId} />
          </div>

          {/* Business Portfolio — collapsible view of all client entities, scores, and credit reports */}
          {fundingEnabled && (
            <div className="mt-6">
              <AdminBusinessPortfolioCard clientUserId={clientUserId} />
            </div>
          )}
        </TabsContent>

        {fundingEnabled && (
          <TabsContent value="credit-reports" className="mt-4">
            <ReportUploadTab clientUserId={clientUserId} />
          </TabsContent>
        )}

        <TabsContent value="account-mgmt" className="mt-4">
          <AdminAccountManagement clientUserId={clientUserId} userRole={userRole} />
        </TabsContent>

        {fundingEnabled && (
          <TabsContent value="funding" className="mt-4">
            <div className="space-y-6">
              <PMEFundingReadiness />
              {userRole === "admin" && <AdminFundingOverride clientUserId={clientUserId} />}
            </div>
          </TabsContent>
        )}

        {fundingEnabled && (
          <TabsContent value="funding-journey" className="mt-4">
            <ClientFundingJourneyTab clientUserId={clientUserId} />
          </TabsContent>
        )}

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Client documents coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outreach" className="mt-4">
          <OutreachCenter clientUserId={clientUserId} />
        </TabsContent>

        <TabsContent value="memory" className="mt-4">
          <ClientMemoryTab clientUserId={clientUserId} />
        </TabsContent>

        {/* [§194] outcomes tab removed */}

        <TabsContent value="chat-history" className="mt-4">
          <AdminChatHistory clientUserId={clientUserId} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Client notes coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>


      </Tabs>
    </div>
  );
}
