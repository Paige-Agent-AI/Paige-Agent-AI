import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Award, Sparkles, Lock, Info, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { toast } from "sonner";
import {
  DemographicQuestionsStep,
  EMPTY_ANSWERS,
  saveDemographicAnswers,
  type DemographicAnswers,
} from "@/components/onboarding/DemographicQuestionsStep";
import {
  CERTIFICATION_TYPES,
  getUnlockedPrograms,
  type DemographicProfile,
} from "@/lib/unlockedPrograms";

interface Props {
  businessId: string;
  userId: string;
  isAdmin?: boolean;
}

interface CertRow {
  id?: string;
  certification_type: string;
  status: "not_started" | "in_progress" | "certified" | "expired" | "denied";
  certified_at?: string | null;
}

export function FundingProfileSection({ businessId, userId, isAdmin }: Props) {
  const [answers, setAnswers] = useState<DemographicAnswers>(EMPTY_ANSWERS);
  const [businessFlags, setBusinessFlags] = useState({
    is_minority_owned: false as boolean | null,
    is_women_owned: false as boolean | null,
    is_veteran_owned: false as boolean | null,
    is_service_disabled_veteran_owned: false as boolean | null,
    is_hubzone_located: false as boolean | null,
  });
  const [certifications, setCertifications] = useState<Record<string, CertRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, userId]);

  const loadAll = async () => {
    setLoading(true);
    const [profileRes, bizRes, certRes] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "gender_identity, ethnicity, is_veteran, is_service_disabled_veteran, is_us_citizen, is_permanent_resident",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("businesses")
        .select(
          "is_minority_owned, is_women_owned, is_veteran_owned, is_service_disabled_veteran_owned, is_hubzone_located",
        )
        .eq("id", businessId)
        .maybeSingle(),
      supabase
        .from("business_certifications")
        .select("id, certification_type, status, certified_at")
        .eq("business_id", businessId),
    ]);

    if (profileRes.data) {
      setAnswers({
        gender_identity: profileRes.data.gender_identity ?? null,
        ethnicity: (profileRes.data.ethnicity ?? []) as string[],
        is_veteran: profileRes.data.is_veteran ?? null,
        is_service_disabled_veteran:
          profileRes.data.is_service_disabled_veteran ?? null,
        is_us_citizen: profileRes.data.is_us_citizen ?? null,
        is_permanent_resident: profileRes.data.is_permanent_resident ?? null,
      });
    }
    if (bizRes.data) {
      setBusinessFlags({
        is_minority_owned: bizRes.data.is_minority_owned ?? false,
        is_women_owned: bizRes.data.is_women_owned ?? false,
        is_veteran_owned: bizRes.data.is_veteran_owned ?? false,
        is_service_disabled_veteran_owned:
          bizRes.data.is_service_disabled_veteran_owned ?? false,
        is_hubzone_located: bizRes.data.is_hubzone_located ?? false,
      });
    }
    if (certRes.data) {
      const map: Record<string, CertRow> = {};
      for (const row of certRes.data) {
        map[row.certification_type] = row as CertRow;
      }
      setCertifications(map);
    }
    setLoading(false);
  };

  const saveDemographics = async () => {
    setSaving(true);
    try {
      await saveDemographicAnswers(supabase, userId, answers);
      await supabase
        .from("businesses")
        .update({
          is_minority_owned: businessFlags.is_minority_owned,
          is_women_owned: businessFlags.is_women_owned,
          is_veteran_owned: businessFlags.is_veteran_owned,
          is_service_disabled_veteran_owned: businessFlags.is_service_disabled_veteran_owned,
          is_hubzone_located: businessFlags.is_hubzone_located,
        })
        .eq("id", businessId);
      toast.success("Funding profile saved");
    } catch {
      toast.error("Failed to save funding profile");
    } finally {
      setSaving(false);
    }
  };

  const updateCertStatus = async (
    type: string,
    status: CertRow["status"],
  ) => {
    const existing = certifications[type];
    const payload: TablesInsert<"business_certifications"> = {
      business_id: businessId,
      user_id: userId,
      certification_type: type,
      status,
      certified_at: status === "certified" ? new Date().toISOString().slice(0, 10) : null,
    };
    if (existing?.id) {
      const { error } = await supabase
        .from("business_certifications")
        .update({ status, certified_at: payload.certified_at })
        .eq("id", existing.id);
      if (error) {
        toast.error("Couldn't update certification");
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("business_certifications")
        .insert(payload)
        .select()
        .single();
      if (error) {
        toast.error("Couldn't create certification record");
        return;
      }
      setCertifications((prev) => ({ ...prev, [type]: data as CertRow }));
    }
    setCertifications((prev) => ({ ...prev, [type]: { ...(prev[type] || {}), ...payload } as CertRow }));

    // Mirror "certified" booleans to businesses table for fast access
    const mirrorMap: Record<string, string> = {
      "8a": "has_8a_certification",
      wosb: "has_wosb_certification",
      vetcert: "has_vetcert_certification",
    };
    if (mirrorMap[type]) {
      await supabase
        .from("businesses")
        .update({ [mirrorMap[type]]: status === "certified" } as TablesUpdate<"businesses">)
        .eq("id", businessId);
    }
    toast.success("Certification status updated");
  };

  const demographicProfile: DemographicProfile = {
    ...answers,
    ...businessFlags,
    has_8a_certification: certifications["8a"]?.status === "certified",
    has_wosb_certification: certifications["wosb"]?.status === "certified",
    has_vetcert_certification: certifications["vetcert"]?.status === "certified",
  };
  const unlockedPrograms = getUnlockedPrograms(demographicProfile);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Loading funding profile…
        </CardContent>
      </Card>
    );
  }

  const statusBadge = (status?: CertRow["status"]) => {
    const map: Record<string, { label: string; class: string; icon: React.ElementType }> = {
      certified: { label: "Certified", class: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: CheckCircle2 },
      in_progress: { label: "In Progress", class: "bg-amber-500/15 text-amber-600 border-amber-500/30", icon: AlertCircle },
      expired: { label: "Expired", class: "bg-destructive/15 text-destructive border-destructive/30", icon: AlertCircle },
      denied: { label: "Denied", class: "bg-destructive/15 text-destructive border-destructive/30", icon: AlertCircle },
      not_started: { label: "Not Started", class: "bg-muted text-muted-foreground border-border", icon: Info },
    };
    const meta = map[status || "not_started"];
    const Icon = meta.icon;
    return (
      <Badge variant="outline" className={`text-xs ${meta.class}`}>
        <Icon className="w-3 h-3 mr-1" />
        {meta.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Unlocked programs banner */}
      {unlockedPrograms.length > 0 && (
        <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-accent/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary mt-1 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">
                  Paige found {unlockedPrograms.length} program{unlockedPrograms.length === 1 ? "" : "s"} you may qualify for
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Ask Paige about: {unlockedPrograms.slice(0, 3).map((p) => p.name).join(" · ")}
                  {unlockedPrograms.length > 3 ? ` +${unlockedPrograms.length - 3} more` : ""}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Demographics editor */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Award className="w-5 h-5 text-primary" />
            Owner Demographics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DemographicQuestionsStep answers={answers} onChange={setAnswers} />
        </CardContent>
      </Card>

      {/* Business ownership flags */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Business Ownership Designations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: "is_minority_owned", label: "Minority-Owned Business" },
            { key: "is_women_owned", label: "Women-Owned Business" },
            { key: "is_veteran_owned", label: "Veteran-Owned Business" },
            { key: "is_service_disabled_veteran_owned", label: "Service-Disabled Veteran-Owned" },
            { key: "is_hubzone_located", label: "Located in a HUBZone" },
          ].map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border">
              <Label htmlFor={row.key} className="text-sm font-medium cursor-pointer">
                {row.label}
              </Label>
              <Switch
                id={row.key}
                checked={!!businessFlags[row.key as keyof typeof businessFlags]}
                onCheckedChange={(v) =>
                  setBusinessFlags((prev) => ({ ...prev, [row.key]: v as boolean }))
                }
              />
            </div>
          ))}
          <Button onClick={saveDemographics} disabled={saving} className="w-full sm:w-auto">
            {saving ? "Saving…" : "Save Funding Profile"}
          </Button>
          <p className="text-xs text-muted-foreground flex items-start gap-1">
            <Lock className="w-3 h-3 mt-0.5 shrink-0" />
            Private to your account. Used only to surface targeted funding opportunities — never shared with lenders.
          </p>
        </CardContent>
      </Card>

      {/* Certifications tracker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Certifications Tracker</CardTitle>
          <p className="text-sm text-muted-foreground">
            Federal and state certifications open additional funding doors.{" "}
            {!isAdmin && "Certification status is updated by your team — contact us if you've recently been certified."}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {CERTIFICATION_TYPES.map((cert) => {
            const row = certifications[cert.key];
            return (
              <div
                key={cert.key}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-border"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{cert.name}</p>
                  <p className="text-xs text-muted-foreground">{cert.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(row?.status)}
                  {isAdmin ? (
                    <Select
                      value={row?.status || "not_started"}
                      onValueChange={(v) => updateCertStatus(cert.key, v as CertRow["status"])}
                    >
                      <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="not_started">Not Started</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="certified">Certified</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                        <SelectItem value="denied">Denied</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Button asChild variant="ghost" size="sm" className="text-xs h-8">
                    <a href={cert.url} target="_blank" rel="noopener noreferrer">
                      Apply <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
