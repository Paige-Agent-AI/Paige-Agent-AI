/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing legacy `any` debt in this
   file (untyped Supabase reads, stale generated types). The E09 Customer Portal identity change
   (CURA, never PAIGE, on customer surfaces) only edited copy here and introduced ZERO new `any`s;
   retyping is tracked separately (#234). */
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Lock, Info, CheckCircle2 } from "lucide-react";

export interface DemographicAnswers {
  gender_identity: string | null;
  ethnicity: string[];
  is_veteran: boolean | null;
  is_service_disabled_veteran: boolean | null;
  is_us_citizen: boolean | null;
  is_permanent_resident: boolean | null;
}

export const EMPTY_ANSWERS: DemographicAnswers = {
  gender_identity: null,
  ethnicity: [],
  is_veteran: null,
  is_service_disabled_veteran: null,
  is_us_citizen: null,
  is_permanent_resident: null,
};

const GENDER_CARDS = [
  { value: "male", label: "Man" },
  { value: "female", label: "Woman" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const ETHNICITY_CHIPS = [
  { value: "black_african_american", label: "Black or African American" },
  { value: "hispanic_latino", label: "Hispanic or Latino" },
  { value: "asian", label: "Asian" },
  { value: "native_american_alaska_native", label: "Native American or Alaska Native" },
  { value: "native_hawaiian_pacific_islander", label: "Native Hawaiian or Pacific Islander" },
  { value: "middle_eastern_north_african", label: "Middle Eastern or North African" },
  { value: "white_caucasian", label: "White or Caucasian" },
  { value: "multiracial", label: "Multiracial" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

interface Props {
  answers: DemographicAnswers;
  onChange: (answers: DemographicAnswers) => void;
  onSkipAll?: () => void;
}

export function DemographicQuestionsStep({ answers, onChange, onSkipAll }: Props) {
  const setGender = (value: string) =>
    onChange({ ...answers, gender_identity: answers.gender_identity === value ? null : value });

  const toggleEthnicity = (value: string) => {
    if (value === "prefer_not_to_say") {
      onChange({ ...answers, ethnicity: answers.ethnicity.includes(value) ? [] : [value] });
      return;
    }
    const next = answers.ethnicity.includes(value)
      ? answers.ethnicity.filter((e) => e !== value)
      : [...answers.ethnicity.filter((e) => e !== "prefer_not_to_say"), value];
    onChange({ ...answers, ethnicity: next });
  };

  const setVeteran = (kind: "yes" | "yes_disabled" | "no" | "skip") => {
    switch (kind) {
      case "yes":
        return onChange({ ...answers, is_veteran: true, is_service_disabled_veteran: false });
      case "yes_disabled":
        return onChange({ ...answers, is_veteran: true, is_service_disabled_veteran: true });
      case "no":
        return onChange({ ...answers, is_veteran: false, is_service_disabled_veteran: false });
      case "skip":
        return onChange({ ...answers, is_veteran: null, is_service_disabled_veteran: null });
    }
  };

  const setCitizenship = (kind: "citizen" | "pr" | "no" | "skip") => {
    switch (kind) {
      case "citizen":
        return onChange({ ...answers, is_us_citizen: true, is_permanent_resident: false });
      case "pr":
        return onChange({ ...answers, is_us_citizen: false, is_permanent_resident: true });
      case "no":
        return onChange({ ...answers, is_us_citizen: false, is_permanent_resident: false });
      case "skip":
        return onChange({ ...answers, is_us_citizen: null, is_permanent_resident: null });
    }
  };

  const veteranSelected =
    answers.is_veteran === true && answers.is_service_disabled_veteran === false
      ? "yes"
      : answers.is_veteran === true && answers.is_service_disabled_veteran === true
        ? "yes_disabled"
        : answers.is_veteran === false
          ? "no"
          : null;

  const citizenshipSelected =
    answers.is_us_citizen === true
      ? "citizen"
      : answers.is_permanent_resident === true
        ? "pr"
        : answers.is_us_citizen === false && answers.is_permanent_resident === false
          ? "no"
          : null;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-full bg-gradient-gold mx-auto flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold">Unlock Programs Built For You</h2>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          Some of the most powerful funding programs in the country are specifically designed for
          business owners like you — but most people never hear about them. Sharing a bit about
          yourself helps us find opportunities you might otherwise miss. All answers are optional
          and kept completely private.
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Lock className="w-3 h-3" /> Private — never shared with lenders
        </div>
      </div>

      {/* Q1 — Gender */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">How do you identify?</h3>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setGender(answers.gender_identity || "")}>
            Skip
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {GENDER_CARDS.map((opt) => {
            const active = answers.gender_identity === opt.value;
            return (
              <Card
                key={opt.value}
                onClick={() => setGender(opt.value)}
                className={`p-3 text-center cursor-pointer transition-all text-sm font-medium ${
                  active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"
                }`}
              >
                {opt.label}
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Women-owned businesses qualify for WOSB federal contracting set-asides and specialized CDFI
          lending programs.
        </p>
      </div>

      {/* Q2 — Ethnicity */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">
            Which of the following best describes your background?{" "}
            <span className="text-muted-foreground font-normal">Select all that apply.</span>
          </h3>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => onChange({ ...answers, ethnicity: [] })}>
            Skip
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {ETHNICITY_CHIPS.map((opt) => {
            const active = answers.ethnicity.includes(opt.value);
            return (
              <Badge
                key={opt.value}
                onClick={() => toggleEthnicity(opt.value)}
                className={`cursor-pointer text-xs px-3 py-1.5 transition-all ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border border-border hover:border-primary/50"
                }`}
              >
                {active && <CheckCircle2 className="w-3 h-3 mr-1" />}
                {opt.label}
              </Badge>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Minority-owned businesses may qualify for SBA 8(a) certification, MBDA Business Center
          resources, and community development lenders with more flexible underwriting.
        </p>
      </div>

      {/* Q3 — Veteran */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Are you a U.S. military veteran?</h3>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setVeteran("skip")}>
            Skip
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { key: "yes", label: "Yes — I served" },
            { key: "yes_disabled", label: "Yes — and I have a service-connected disability" },
            { key: "no", label: "No" },
            { key: "skip", label: "Prefer not to say" },
          ].map((opt) => {
            const active = veteranSelected === opt.key || (opt.key === "skip" && veteranSelected === null && answers.is_veteran === null);
            return (
              <Card
                key={opt.key}
                onClick={() => setVeteran(opt.key as any)}
                className={`p-3 cursor-pointer transition-all text-sm ${
                  active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"
                }`}
              >
                {opt.label}
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Veterans qualify for VetCert certification, SDVOSB federal contracting preferences, and
          veteran-focused SBA lending programs.
        </p>
      </div>

      {/* Q4 — Citizenship */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Are you a U.S. citizen or permanent resident?</h3>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setCitizenship("skip")}>
            Skip
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { key: "citizen", label: "Yes — U.S. citizen" },
            { key: "pr", label: "Yes — permanent resident" },
            { key: "no", label: "No" },
            { key: "skip", label: "Prefer not to say" },
          ].map((opt) => {
            const active = citizenshipSelected === opt.key;
            return (
              <Card
                key={opt.key}
                onClick={() => setCitizenship(opt.key as any)}
                className={`p-3 cursor-pointer transition-all text-sm ${
                  active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"
                }`}
              >
                {opt.label}
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Some federal programs require U.S. citizenship. Knowing this helps us focus on programs
          you actually qualify for.
        </p>
      </div>

      {/* Reassurance */}
      <Card className="p-3 bg-primary/5 border-primary/20">
        <p className="text-xs text-foreground flex items-start gap-2">
          <Lock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <span>
            Your answers are private, never shared with lenders, and do not affect your credit
            profile or funding matches. They only help us find programs designed specifically for
            people in your situation.
          </span>
        </p>
      </Card>

      {onSkipAll && (
        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={onSkipAll}>
            Skip All
          </Button>
        </div>
      )}
    </div>
  );
}

export async function saveDemographicAnswers(
  supabase: any,
  userId: string,
  answers: DemographicAnswers,
): Promise<void> {
  const payload: Record<string, any> = {};
  if (answers.gender_identity !== null) payload.gender_identity = answers.gender_identity;
  if (answers.ethnicity.length > 0) payload.ethnicity = answers.ethnicity;
  if (answers.is_veteran !== null) payload.is_veteran = answers.is_veteran;
  if (answers.is_service_disabled_veteran !== null)
    payload.is_service_disabled_veteran = answers.is_service_disabled_veteran;
  if (answers.is_us_citizen !== null) payload.is_us_citizen = answers.is_us_citizen;
  if (answers.is_permanent_resident !== null)
    payload.is_permanent_resident = answers.is_permanent_resident;

  if (Object.keys(payload).length === 0) return;
  await supabase.from("profiles").update(payload).eq("user_id", userId);
}
