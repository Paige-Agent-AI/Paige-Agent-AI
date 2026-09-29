import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { saveUserPrimaryAddresses } from "@/lib/userPrimaryContact";
import { Loader2, ArrowRight, ArrowLeft, Target, TrendingUp, DollarSign, CheckCircle2, Sparkles, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DemographicQuestionsStep, EMPTY_ANSWERS, saveDemographicAnswers, type DemographicAnswers } from "@/components/onboarding/DemographicQuestionsStep";
import { usePlaybook } from "@/lib/playbook";

interface OnboardingFlowProps {
  open: boolean;
  onComplete: () => void;
}

export const OnboardingFlow = ({ open, onComplete }: OnboardingFlowProps) => {
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  // Speak in the tenant's Paige persona, never the platform brand (§3/§6).
  const pb = usePlaybook();
  const brandName = pb.persona.name;

  // Goals
  const [goals, setGoals] = useState<string[]>([]);

  // Personal Info
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");

  // Business Info (optional)
  const [hasBusinessCredit, setHasBusinessCredit] = useState<boolean | null>(null);
  const [legalName, setLegalName] = useState("");
  const [ein, setEin] = useState("");
  const [entityType, setEntityType] = useState("");

  // Demographic answers (Unlock Programs step)
  const [demographicAnswers, setDemographicAnswers] = useState<DemographicAnswers>(EMPTY_ANSWERS);

  // Steps: 1=goals, 2=personal, 3=business?, 4=business info (if biz), 5=demographics
  const totalSteps = hasBusinessCredit ? 6 : 5;
  const demographicStep = hasBusinessCredit ? 5 : 4;
  const progress = (step / totalSteps) * 100;

  const toggleGoal = (goal: string) => {
    setGoals(prev => 
      prev.includes(goal) ? prev.filter(g => g !== goal) : [...prev, goal]
    );
  };

  const usStates = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
  ];

  const handleNext = () => {
    if (step === 1 && goals.length === 0) {
      toast({
        title: "Please Select Goals",
        description: "Choose at least one goal to continue",
        variant: "destructive",
      });
      return;
    }

    if (step === 2 && !fullName.trim()) {
      toast({
        title: "Required Field",
        description: "Please enter your full name",
        variant: "destructive",
      });
      return;
    }

    if (step === 3 && hasBusinessCredit === null) {
      toast({
        title: "Please Select",
        description: "Let us know if you have a business",
        variant: "destructive",
      });
      return;
    }

    if (step === 4 && hasBusinessCredit && !legalName.trim()) {
      toast({
        title: "Required Field",
        description: "Please enter your business name",
        variant: "destructive",
      });
      return;
    }

    if (step === totalSteps) {
      handleComplete();
    } else {
      setStep(step + 1);
    }
  };

  const handleComplete = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Save personal info
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          address,
          city,
          state,
          postal_code: postalCode,
        })
        .eq("user_id", user.id);

      if (profileError) throw profileError;

      // A phone typed here becomes the person's primary phone contact method; any other email or
      // phone they already keep is left as it is. A blank field means "not given" — this form never
      // showed their stored number — so it writes nothing, and never removes a phone they keep.
      if (phone.trim()) {
        const savedPhone = await saveUserPrimaryAddresses(user.id, { phone });
        if (savedPhone.ok === false) throw new Error(savedPhone.error);
      }

      // Save business info if applicable
      if (hasBusinessCredit && legalName) {
        const { error: businessError } = await supabase
          .from("businesses")
          .insert({
            owner_user_id: user.id,
            legal_name: legalName,
            ein,
            entity_type: (entityType as "LLC" | "Corporation" | "Sole Proprietorship" | "Partnership" | null) || null,
          });

        if (businessError) throw businessError;
      }

      // Save demographic answers (additive — only writes provided fields)
      try { await saveDemographicAnswers(supabase, user.id, demographicAnswers); } catch { /* demographic answers are optional; onboarding completes without them */ }

      toast({
        title: `Welcome to ${brandName}!`,
        description: "Your profile has been set up successfully",
      });

      // Welcome email already sent on signup — no need to send again here

      onComplete();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save your information. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkipForNow = () => {
    // Track dismissals — after 3 skips, stop nagging entirely. Otherwise snooze for 7 days.
    try {
      const prevSkips = Number(localStorage.getItem("onboarding_skip_count") || 0);
      const nextSkips = prevSkips + 1;
      localStorage.setItem("onboarding_skip_count", String(nextSkips));
      if (nextSkips >= 3) {
        localStorage.setItem("onboarding_dismissed", "true");
      } else {
        const snoozeUntil = Date.now() + 7 * 24 * 60 * 60 * 1000;
        localStorage.setItem("onboarding_snoozed_until", String(snoozeUntil));
      }
    } catch { /* storage unavailable (private mode): the snooze is best-effort */ }
    toast({
      title: "No problem — explore freely",
      description: "Your setup checklist stays on your dashboard. Finish it whenever you're ready.",
    });
    onComplete();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleSkipForNow(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto sm:max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="text-xl sm:text-2xl">Welcome to {brandName}! 🎉</DialogTitle>
          <DialogDescription>
            Optional setup — takes ~2 minutes. Skip anytime; we'll keep your checklist on the dashboard.
          </DialogDescription>
        </DialogHeader>

        {step > 0 && <Progress value={progress} className="mb-4 sm:mb-6" />}

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="space-y-4 sm:space-y-6 py-2 sm:py-4">
            <div className="text-center space-y-2 sm:space-y-4">
              <div className="w-14 h-14 sm:w-20 sm:h-20 bg-gradient-gold rounded-full mx-auto flex items-center justify-center">
                <Sparkles className="w-7 h-7 sm:w-10 sm:h-10 text-white" />
              </div>
              <h2 className="text-xl sm:text-3xl font-bold">Welcome to {brandName}!</h2>
              <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto">
                {brandName} runs your credit-building and business-financing workflow.
              </p>
            </div>

            {/* Document Upload Reminder */}
            <Card className="p-3 sm:p-4 border-gold/30 bg-gold/5">
              <div className="flex items-start gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gold/20 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-xs sm:text-sm">Have Your Documents Ready</h4>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-fundability-excellent flex-shrink-0" />
                      <span>Personal credit reports (all 3 bureaus)</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-fundability-excellent flex-shrink-0" />
                      <span>Business formation docs (if applicable)</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-fundability-excellent flex-shrink-0" />
                      <span>Business credit ratings (if you have them)</span>
                    </li>
                  </ul>
                  <p className="text-xs text-gold-dark font-medium">
                    Don't have everything? Paige will guide you through every step.
                  </p>
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <Card className="p-2 sm:p-4 text-center space-y-1 sm:space-y-2 border-primary/20">
                <Target className="w-5 h-5 sm:w-8 sm:h-8 mx-auto text-primary" />
                <h3 className="font-semibold text-xs sm:text-base">A.C.C.E.L.</h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">Personal credit repair & optimization</p>
              </Card>
              <Card className="p-2 sm:p-4 text-center space-y-1 sm:space-y-2 border-primary/20">
                <TrendingUp className="w-5 h-5 sm:w-8 sm:h-8 mx-auto text-primary" />
                <h3 className="font-semibold text-xs sm:text-base">B.U.I.L.D.</h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">Business credit building strategies</p>
              </Card>
              <Card className="p-2 sm:p-4 text-center space-y-1 sm:space-y-2 border-primary/20">
                <DollarSign className="w-5 h-5 sm:w-8 sm:h-8 mx-auto text-primary" />
                <h3 className="font-semibold text-xs sm:text-base">Funding</h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">Access to capital & financing</p>
              </Card>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-center gap-2 sm:gap-3">
              <Button onClick={handleSkipForNow} variant="ghost" size="lg" className="w-full sm:w-auto">
                Skip for now
              </Button>
              <Button onClick={() => setStep(1)} size="lg" className="bg-gradient-gold w-full sm:w-auto">
                Get Started
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Goal Selection */}
        {step === 1 && (
          <div className="space-y-6">
            <h3 className="font-semibold text-lg">What are your goals?</h3>
            <p className="text-sm text-muted-foreground">Select all that apply - we'll customize your experience</p>

            <div className="space-y-3">
              <Card 
                className={`p-4 cursor-pointer transition-all ${goals.includes('repair') ? 'border-primary bg-primary/5' : 'border-border'}`}
                onClick={() => toggleGoal('repair')}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${goals.includes('repair') ? 'border-primary bg-primary' : 'border-muted-foreground'}`}>
                    {goals.includes('repair') && <CheckCircle2 className="w-4 h-4 text-white" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Repair & Optimize Personal Credit</p>
                    <p className="text-xs text-muted-foreground">Remove inaccuracies and improve your credit score</p>
                  </div>
                </div>
              </Card>

              <Card 
                className={`p-4 cursor-pointer transition-all ${goals.includes('build') ? 'border-primary bg-primary/5' : 'border-border'}`}
                onClick={() => toggleGoal('build')}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${goals.includes('build') ? 'border-primary bg-primary' : 'border-muted-foreground'}`}>
                    {goals.includes('build') && <CheckCircle2 className="w-4 h-4 text-white" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Build Business Credit</p>
                    <p className="text-xs text-muted-foreground">Establish and grow your business credit profile</p>
                  </div>
                </div>
              </Card>

              <Card 
                className={`p-4 cursor-pointer transition-all ${goals.includes('funding') ? 'border-primary bg-primary/5' : 'border-border'}`}
                onClick={() => toggleGoal('funding')}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${goals.includes('funding') ? 'border-primary bg-primary' : 'border-muted-foreground'}`}>
                    {goals.includes('funding') && <CheckCircle2 className="w-4 h-4 text-white" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Access Funding & Financing</p>
                    <p className="text-xs text-muted-foreground">Get approved for loans and credit lines</p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Step 2: Personal Information */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Personal Information</h3>
            
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Street Address</Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="New York"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger>
                    <SelectValue placeholder="State" />
                  </SelectTrigger>
                  <SelectContent>
                    {usStates.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label htmlFor="postalCode">ZIP</Label>
                <Input
                  id="postalCode"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="10001"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Business Credit Question */}
        {step === 3 && (
          <div className="space-y-6">
            <h3 className="font-semibold text-lg">Do you have a business?</h3>
            <p className="text-sm text-muted-foreground">
              This helps us provide personalized business credit building guidance
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <Button
                variant={hasBusinessCredit === true ? "default" : "outline"}
                onClick={() => setHasBusinessCredit(true)}
                className="h-20 sm:h-24"
              >
                <div>
                  <p className="font-semibold text-sm sm:text-base">Yes, I have a business</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    I want to build business credit
                  </p>
                </div>
              </Button>

              <Button
                variant={hasBusinessCredit === false ? "default" : "outline"}
                onClick={() => setHasBusinessCredit(false)}
                className="h-20 sm:h-24"
              >
                <div>
                  <p className="font-semibold text-sm sm:text-base">No business yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Focus on personal credit for now
                  </p>
                </div>
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Business Information (conditional) */}
        {step === 4 && hasBusinessCredit && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Business Information</h3>

            <div className="space-y-2">
              <Label htmlFor="legalName">Legal Business Name *</Label>
              <Input
                id="legalName"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Acme Corporation"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ein">EIN (Employer ID Number)</Label>
              <Input
                id="ein"
                value={ein}
                onChange={(e) => setEin(e.target.value)}
                placeholder="12-3456789"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="entityType">Entity Type</Label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LLC">LLC</SelectItem>
                  <SelectItem value="Corporation">Corporation</SelectItem>
                  <SelectItem value="Sole Proprietorship">Sole Proprietorship</SelectItem>
                  <SelectItem value="Partnership">Partnership</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Step N: Demographics — Unlock Programs */}
        {step === demographicStep && (
          <DemographicQuestionsStep
            answers={demographicAnswers}
            onChange={setDemographicAnswers}
            onSkipAll={() => { setDemographicAnswers(EMPTY_ANSWERS); handleNext(); }}
          />
        )}

        {/* Navigation */}
        {step > 0 && (
          <>
            <div className="flex justify-between pt-4">
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              )}

              <Button
                onClick={handleNext}
                disabled={isLoading}
                className="ml-auto bg-gradient-gold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : step === totalSteps ? (
                  "Complete Setup"
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Step {step} of {totalSteps}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
