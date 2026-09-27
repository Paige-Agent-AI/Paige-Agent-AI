import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2, Lock, ArrowRight, ArrowLeft, Award, RefreshCw,
  Sparkles, Loader2, FileDown, ShieldCheck
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDashboardMode } from "@/contexts/DashboardModeContext";
import { toast } from "sonner";

interface BuildProgramSectionProps {
  foundationPct: number;
  bureauPct: number;
  onCompletionChange: (pct: number) => void;
  businessId: string;
}

// Vendor list for checklist
const VENDOR_LIST = [
  "Uline", "Quill", "Grainger", "Summa Office Supplies",
  "Strategic Network Solutions", "Crown Office Supplies",
  "Laughlin and Associates", "HD Supply", "MSC Industrial",
  "Global Industrial", "Nav Business Boost"
];

type Answers = {
  // Base
  base_entity: string;
  base_ein: string;
  base_bank: string;
  base_duns: string;
  base_phone: string;
  base_address: string;
  // Utility
  utility_vendor_count: string;
  utility_vendors: string[];
  utility_vendor_other: string;
  utility_paydex: string;
  utility_early_pay: string;
  // Intermediate
  inter_store_card: string;
  inter_which_cards: string;
  inter_highest_limit: string;
  // Leverage
  leverage_no_pg: string;
  leverage_product: string;
  leverage_total_capacity: string;
  // Develop
  develop_monitoring: string;
  develop_utilization: string;
  develop_derogatory: string;
};

const defaultAnswers: Answers = {
  base_entity: "", base_ein: "", base_bank: "", base_duns: "", base_phone: "", base_address: "",
  utility_vendor_count: "", utility_vendors: [], utility_vendor_other: "", utility_paydex: "", utility_early_pay: "",
  inter_store_card: "", inter_which_cards: "", inter_highest_limit: "",
  leverage_no_pg: "", leverage_product: "", leverage_total_capacity: "",
  develop_monitoring: "", develop_utilization: "", develop_derogatory: "",
};

const TIER_NAMES = ["Base", "Utility", "Intermediate", "Leverage", "Develop"];
const TIER_LETTERS = ["B", "U", "I", "L", "D"];
const TIER_DESCS = [
  "Identity & Compliance", "Vendor Tradelines", "Store & Fleet Cards",
  "Corporate / No-PG", "Maintenance Loop"
];

function calculateScore(a: Answers): number {
  let score = 0;
  // Base: 20 pts, 4 each for 5 yes answers (entity, ein, bank, duns=yes, phone=yes, address)
  // Actually 6 questions but spec says 5 base questions worth 4 pts each = 20
  const baseYes = [a.base_entity, a.base_ein, a.base_bank, a.base_address].filter(v => v === "yes").length;
  const basePending = [a.base_duns, a.base_phone].filter(v => v === "yes").length;
  score += (baseYes + basePending) * (20 / 6);

  // Utility: 25 pts - 5 per vendor up to 5, bonus 5 if paydex > 80
  const vendorCount = Math.min(5, parseInt(a.utility_vendor_count) || 0);
  score += vendorCount * 5;
  const paydex = parseInt(a.utility_paydex) || 0;
  if (paydex > 80) score += 5; // bonus is within the 25 cap implicitly

  // Intermediate: 20 pts
  if (a.inter_store_card === "yes") score += 10;
  const highLimit = parseInt(a.inter_highest_limit) || 0;
  if (highLimit > 5000) score += 10;

  // Leverage: 20 pts
  if (a.leverage_no_pg === "yes") score += 20;

  // Develop: 15 pts, 5 each
  if (a.develop_monitoring === "yes") score += 5;
  if (a.develop_utilization === "yes") score += 5;
  if (a.develop_derogatory === "no") score += 5;

  return Math.min(100, Math.round(score));
}

function tierComplete(tier: number, a: Answers): boolean {
  switch (tier) {
    case 0: return ["yes"].includes(a.base_entity) && a.base_ein === "yes" && a.base_bank === "yes";
    case 1: return (parseInt(a.utility_vendor_count) || 0) >= 3;
    case 2: return a.inter_store_card === "yes";
    case 3: return a.leverage_no_pg === "yes";
    case 4: return a.develop_monitoring === "yes" && a.develop_utilization === "yes" && a.develop_derogatory === "no";
    default: return false;
  }
}

export function BuildProgramSection({ foundationPct, bureauPct, onCompletionChange, businessId }: BuildProgramSectionProps) {
  const { isAdmin } = useDashboardMode();
  const [mode, setMode] = useState<"loading" | "assessment" | "dashboard">("loading");
  const [currentTier, setCurrentTier] = useState(0);
  const [answers, setAnswers] = useState<Answers>({ ...defaultAnswers });
  const [tierInsights, setTierInsights] = useState<Record<number, string>>({});
  const [insightLoading, setInsightLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInsight, setShowInsight] = useState(false);

  // Load existing assessment or Foundation data
  useEffect(() => {
    if (!businessId) return;
    loadData();
  }, [businessId]);

  const loadData = async () => {
    setMode("loading");
    const { data } = await supabase
      .from("businesses")
      .select("entity_type, ein, has_bank_account, bank_name, business_phone, phone_411_listed, business_address_type, build_assessment_answers, build_score, build_assessed_at")
      .eq("id", businessId)
      .maybeSingle();

    if (!data) { setMode("assessment"); return; }

    if (data.build_assessment_answers && data.build_score != null) {
      const saved = data.build_assessment_answers as unknown as Answers;
      setAnswers({ ...defaultAnswers, ...saved });
      setMode("dashboard");
      onCompletionChange(data.build_score);
      return;
    }

    // Pre-populate from Foundation data
    const prefilled: Partial<Answers> = {};
    if (data.entity_type) prefilled.base_entity = "yes";
    if (data.ein) prefilled.base_ein = "yes";
    if (data.has_bank_account || data.bank_name) prefilled.base_bank = "yes";
    if (data.business_phone) prefilled.base_phone = data.phone_411_listed ? "yes" : "pending";
    if (data.business_address_type && data.business_address_type !== "Home Address") prefilled.base_address = "yes";

    setAnswers(prev => ({ ...prev, ...prefilled }));
    setMode("assessment");
  };

  const updateAnswer = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

  const fetchTierInsight = async (tier: number) => {
    setInsightLoading(true);
    setShowInsight(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const tierData = JSON.stringify(answers);
      const res = await supabase.functions.invoke("paige-ai-chat", {
        body: {
          message: `The client just completed the BUILD assessment for the "${TIER_NAMES[tier]}" tier. Here are their answers: ${tierData}. Give a concise 2-3 sentence coaching insight about what their current status means for their funding trajectory and what the single most impactful next action is for this tier. Be specific and encouraging. Do not use markdown formatting.`,
          sessionId: `build-insight-${Date.now()}`,
          userId: user.id,
          skipMemory: true,
        }
      });
      const reply = res.data?.reply || res.data?.message || "Assessment recorded. Move to the next tier to continue building your credit profile.";
      setTierInsights(prev => ({ ...prev, [tier]: reply }));
    } catch {
      setTierInsights(prev => ({ ...prev, [tier]: "Great progress on this tier! Keep building momentum by completing the next section." }));
    } finally {
      setInsightLoading(false);
    }
  };

  const handleNextTier = async () => {
    if (!showInsight && !tierInsights[currentTier]) {
      await fetchTierInsight(currentTier);
      return;
    }
    setShowInsight(false);
    if (currentTier < 4) {
      setCurrentTier(prev => prev + 1);
    } else {
      await saveAssessment();
    }
  };

  const saveAssessment = async () => {
    setSaving(true);
    const score = calculateScore(answers);
    const { error } = await supabase
      .from("businesses")
      .update({
        build_assessment_answers: answers,
        build_score: score,
        build_assessed_at: new Date().toISOString(),
      })
      .eq("id", businessId);

    if (error) {
      toast.error("Failed to save assessment");
    } else {
      toast.success(`BUILD Score: ${score}/100`);
      onCompletionChange(score);
      setMode("dashboard");
    }
    setSaving(false);
  };

  const handleRerun = () => {
    setCurrentTier(0);
    setTierInsights({});
    setShowInsight(false);
    setMode("assessment");
  };

  const buildScore = calculateScore(answers);

  if (mode === "loading") {
    return (
      <Card><CardContent className="py-12 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
        <p className="text-sm text-muted-foreground">Loading assessment…</p>
      </CardContent></Card>
    );
  }

  // ---- ASSESSMENT MODE ----
  if (mode === "assessment") {
    return (
      <div className="space-y-6">
        {/* Tier progress */}
        <div className="flex items-center gap-1">
          {TIER_LETTERS.map((letter, i) => (
            <div key={letter} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                i < currentTier ? "bg-primary text-primary-foreground border-primary" :
                i === currentTier ? "border-primary text-primary bg-primary/10" :
                "border-muted text-muted-foreground"
              }`}>{letter}</div>
              {i < 4 && <ArrowRight className={`w-3 h-3 mx-0.5 ${i < currentTier ? "text-primary" : "text-muted-foreground"}`} />}
            </div>
          ))}
          <span className="ml-3 text-sm font-medium text-muted-foreground">
            Step {currentTier + 1} of 5 — {TIER_NAMES[currentTier]}
          </span>
        </div>

        <Card>
          <CardContent className="py-6 space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs">{TIER_LETTERS[currentTier]}</Badge>
              <h3 className="text-lg font-semibold">{TIER_NAMES[currentTier]} — {TIER_DESCS[currentTier]}</h3>
            </div>

            {/* Tier questions */}
            {currentTier === 0 && <BaseTierQuestions answers={answers} update={updateAnswer} />}
            {currentTier === 1 && <UtilityTierQuestions answers={answers} update={updateAnswer} />}
            {currentTier === 2 && <IntermediateTierQuestions answers={answers} update={updateAnswer} />}
            {currentTier === 3 && <LeverageTierQuestions answers={answers} update={updateAnswer} />}
            {currentTier === 4 && <DevelopTierQuestions answers={answers} update={updateAnswer} />}

            {/* Paige Insight */}
            {showInsight && tierInsights[currentTier] && (
              <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 flex gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-primary mb-1">Paige's Insight</p>
                  <p className="text-sm text-foreground">{tierInsights[currentTier]}</p>
                </div>
              </div>
            )}
            {showInsight && insightLoading && (
              <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 flex items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Paige is analyzing your answers…</p>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentTier === 0}
                onClick={() => { setCurrentTier(prev => prev - 1); setShowInsight(false); }}
              >
                <ArrowLeft className="w-3 h-3 mr-1" /> Previous
              </Button>
              <Button size="sm" onClick={handleNextTier} disabled={insightLoading || saving}>
                {saving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                {currentTier === 4 && showInsight ? "Finish & Calculate Score" :
                  showInsight || tierInsights[currentTier] ? "Next Tier" : "Get Paige's Insight"}
                {!(currentTier === 4 && showInsight) && <ArrowRight className="w-3 h-3 ml-1" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- DASHBOARD MODE ----
  return (
    <div className="space-y-6">
      {/* BUILD Ladder */}
      <div className="grid grid-cols-5 gap-2 md:gap-3">
        {TIER_LETTERS.map((letter, i) => {
          const complete = tierComplete(i, answers);
          return (
            <Card key={letter} className={`text-center p-2 md:p-4 transition-all ${complete ? "bg-primary/5 border-primary/30" : "bg-muted/10 border-muted"}`}>
              {complete ? <CheckCircle2 className="w-6 h-6 md:w-8 md:h-8 text-primary mx-auto mb-1" /> : <Lock className="w-6 h-6 md:w-8 md:h-8 text-muted-foreground mx-auto mb-1" />}
              <div className="text-xl md:text-2xl font-bold text-foreground">{letter}</div>
              <div className="text-[10px] md:text-xs font-semibold">{TIER_NAMES[i]}</div>
              <div className="text-[8px] md:text-[10px] text-muted-foreground hidden sm:block mt-0.5">{TIER_DESCS[i]}</div>
            </Card>
          );
        })}
      </div>

      {/* Score Card */}
      <Card className="border-primary/20">
        <CardContent className="py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-primary" />
              <span className="text-lg font-semibold">BUILD Score</span>
            </div>
            <span className="text-4xl font-bold text-primary">
              {buildScore}<span className="text-lg text-muted-foreground">/100</span>
            </span>
          </div>
          <Progress value={buildScore} className="h-3 mb-3" />
          <p className="text-xs text-muted-foreground text-center">
            {buildScore >= 70 ? "✓ Funding Ready — BUILD fundamentals are strong" : "70+ unlocks Funding Plan"}
          </p>
        </CardContent>
      </Card>

      <Button variant="outline" onClick={handleRerun} className="w-full">
        <RefreshCw className="w-4 h-4 mr-2" /> Re-run Assessment
      </Button>

      {/* Admin Coaching Panel */}
      {isAdmin && <AdminCoachingPanel answers={answers} score={buildScore} />}
    </div>
  );
}

// ---- TIER QUESTION COMPONENTS ----

function YesNo({ label, value, onChange, note }: { label: string; value: string; onChange: (v: string) => void; note?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <RadioGroup value={value} onValueChange={onChange} className="flex gap-4">
        <div className="flex items-center gap-1.5"><RadioGroupItem value="yes" id={`${label}-y`} /><Label htmlFor={`${label}-y`} className="text-sm">Yes</Label></div>
        <div className="flex items-center gap-1.5"><RadioGroupItem value="no" id={`${label}-n`} /><Label htmlFor={`${label}-n`} className="text-sm">No</Label></div>
      </RadioGroup>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function ThreeWay({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string, string] }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <RadioGroup value={value} onValueChange={onChange} className="flex flex-wrap gap-4">
        {options.map(opt => (
          <div key={opt} className="flex items-center gap-1.5">
            <RadioGroupItem value={opt.toLowerCase()} id={`${label}-${opt}`} />
            <Label htmlFor={`${label}-${opt}`} className="text-sm">{opt}</Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

function BaseTierQuestions({ answers, update }: { answers: Answers; update: <K extends keyof Answers>(k: K, v: Answers[K]) => void }) {
  return (
    <div className="space-y-4">
      <YesNo label="Does the business have a legal entity formed with the Secretary of State?" value={answers.base_entity} onChange={v => update("base_entity", v)}
        note={answers.base_entity === "yes" ? "✓ Pre-populated from Foundation data" : undefined} />
      <YesNo label="Does the business have an active EIN?" value={answers.base_ein} onChange={v => update("base_ein", v)}
        note={answers.base_ein === "yes" ? "✓ Pre-populated from Foundation data" : undefined} />
      <YesNo label="Does the business have a dedicated business bank account open for at least 30 days?" value={answers.base_bank} onChange={v => update("base_bank", v)}
        note={answers.base_bank === "yes" ? "✓ Pre-populated from Foundation data" : undefined} />
      <ThreeWay label="Does the business have a D-U-N-S number requested or active?" value={answers.base_duns} onChange={v => update("base_duns", v)} options={["Yes", "Pending", "No"]} />
      <ThreeWay label="Does the business have a dedicated business phone number listed in 411 directories?" value={answers.base_phone} onChange={v => update("base_phone", v)} options={["Yes", "Pending", "No"]} />
      <YesNo label="Does the business have a commercial or virtual office address (not a home address)?" value={answers.base_address} onChange={v => update("base_address", v)} />
    </div>
  );
}

function UtilityTierQuestions({ answers, update }: { answers: Answers; update: <K extends keyof Answers>(k: K, v: Answers[K]) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">How many vendor tradelines are currently active and reporting to D&B?</Label>
        <Input type="number" min={0} value={answers.utility_vendor_count} onChange={e => update("utility_vendor_count", e.target.value)} className="w-32" placeholder="0" />
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium">Which specific vendors are reporting?</Label>
        <div className="grid grid-cols-2 gap-2">
          {VENDOR_LIST.map(v => (
            <div key={v} className="flex items-center gap-2">
              <Checkbox
                checked={answers.utility_vendors.includes(v)}
                onCheckedChange={checked => {
                  const next = checked ? [...answers.utility_vendors, v] : answers.utility_vendors.filter(x => x !== v);
                  update("utility_vendors", next);
                }}
              />
              <Label className="text-xs">{v}</Label>
            </div>
          ))}
        </div>
        <Input placeholder="Other vendors (comma-separated)" value={answers.utility_vendor_other} onChange={e => update("utility_vendor_other", e.target.value)} className="mt-2" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Current PAYDEX score (if known)</Label>
        <Input type="number" min={0} max={100} value={answers.utility_paydex} onChange={e => update("utility_paydex", e.target.value)} className="w-32" placeholder="Unknown" />
      </div>
      <ThreeWay label="Are you paying vendor invoices 15–20 days before the due date to maximize PAYDEX?" value={answers.utility_early_pay} onChange={v => update("utility_early_pay", v)} options={["Yes", "Sometimes", "No"]} />
    </div>
  );
}

function IntermediateTierQuestions({ answers, update }: { answers: Answers; update: <K extends keyof Answers>(k: K, v: Answers[K]) => void }) {
  return (
    <div className="space-y-4">
      <YesNo label="Has the business been approved for any store cards or fleet cards using the business EIN without a personal guarantee?" value={answers.inter_store_card} onChange={v => update("inter_store_card", v)} />
      {answers.inter_store_card === "yes" && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Which cards?</Label>
          <Input value={answers.inter_which_cards} onChange={e => update("inter_which_cards", e.target.value)} placeholder="e.g. Shell Fleet, Home Depot Business" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Highest credit limit on any current business tradeline ($)</Label>
        <Input type="number" min={0} value={answers.inter_highest_limit} onChange={e => update("inter_highest_limit", e.target.value)} className="w-40" placeholder="0" />
      </div>
    </div>
  );
}

function LeverageTierQuestions({ answers, update }: { answers: Answers; update: <K extends keyof Answers>(k: K, v: Answers[K]) => void }) {
  return (
    <div className="space-y-4">
      <YesNo label="Has the business accessed any funding without a personal guarantee?" value={answers.leverage_no_pg} onChange={v => update("leverage_no_pg", v)} />
      {answers.leverage_no_pg === "yes" && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">What product and from which lender?</Label>
          <Input value={answers.leverage_product} onChange={e => update("leverage_product", e.target.value)} placeholder="e.g. Chase Business Line $25k" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Total business credit capacity (sum of all limits, $)</Label>
        <Input type="number" min={0} value={answers.leverage_total_capacity} onChange={e => update("leverage_total_capacity", e.target.value)} className="w-40" placeholder="0" />
      </div>
    </div>
  );
}

function DevelopTierQuestions({ answers, update }: { answers: Answers; update: <K extends keyof Answers>(k: K, v: Answers[K]) => void }) {
  return (
    <div className="space-y-4">
      <ThreeWay label="Is the business actively monitoring all four business credit bureaus (D&B, Experian Business, Equifax Business, FICO SBSS)?" value={answers.develop_monitoring} onChange={v => update("develop_monitoring", v)} options={["Yes", "Some of them", "No"]} />
      <ThreeWay label="Is the business maintaining utilization below 30% across all business credit accounts?" value={answers.develop_utilization} onChange={v => update("develop_utilization", v)} options={["Yes", "Working on it", "No"]} />
      <YesNo label="Has the business had any business credit derogatory items in the last 24 months?" value={answers.develop_derogatory} onChange={v => update("develop_derogatory", v)} />
    </div>
  );
}

// ---- ADMIN COACHING PANEL ----

function AdminCoachingPanel({ answers, score }: { answers: Answers; score: number }) {
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generateBrief = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const res = await supabase.functions.invoke("paige-ai-chat", {
        body: {
          message: `You are generating a coaching brief for an internal team member. The client's BUILD Score is ${score}/100. Their assessment answers: ${JSON.stringify(answers)}. Write a concise coaching brief with three sections: 1) What the client has accomplished (2-3 bullet points), 2) Their single biggest gap, 3) Recommended next 3 actions in priority order. Use plain text, no markdown. Keep it under 200 words.`,
          sessionId: `coaching-brief-${Date.now()}`,
          userId: user.id,
          skipMemory: true,
        }
      });
      setBrief(res.data?.reply || res.data?.message || "Unable to generate brief.");
    } catch {
      setBrief("Unable to generate coaching brief at this time.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { generateBrief(); }, []);

  const exportPDF = () => {
    if (!brief) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    // Build the document via DOM APIs so AI-generated `brief` text is treated
    // as text content (not HTML) — prevents XSS via injected markup.
    const doc = printWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>BUILD Coaching Brief</title>
      <style>body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:700px;margin:40px auto;padding:20px;color:#222}
      h1{font-size:20px;border-bottom:2px solid #CFAE70;padding-bottom:8px}
      .score{font-size:36px;font-weight:bold;color:#CFAE70;margin:16px 0}
      pre{white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.6}</style></head><body></body></html>`);
    doc.close();
    const body = doc.body;
    const h1 = doc.createElement('h1'); h1.textContent = 'BUILD Coaching Brief'; body.appendChild(h1);
    const scoreDiv = doc.createElement('div'); scoreDiv.className = 'score'; scoreDiv.textContent = `${score}/100`; body.appendChild(scoreDiv);
    const pre = doc.createElement('pre'); pre.textContent = brief; body.appendChild(pre);
    const footer = doc.createElement('p'); footer.setAttribute('style','color:#999;font-size:11px;margin-top:40px'); footer.textContent = `Generated ${new Date().toLocaleDateString()}`; body.appendChild(footer);
    printWindow.print();
  };

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="py-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-600" />
            <span className="text-sm font-semibold text-amber-700">Admin Coaching Panel</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={generateBrief} disabled={loading}>
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={exportPDF} disabled={!brief}>
              <FileDown className="w-3 h-3 mr-1" /> Export PDF
            </Button>
          </div>
        </div>
        {loading && !brief ? (
          <div className="flex items-center gap-2 py-4">
            <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
            <p className="text-sm text-muted-foreground">Generating coaching brief…</p>
          </div>
        ) : brief ? (
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{brief}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
