import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Mail, MessageSquare, ShieldCheck, BellOff } from "lucide-react";

interface CommPrefs {
  email_enabled: boolean;
  sms_enabled: boolean;
  sms_phone_number: string | null;
  sms_phone_verified: boolean;
  email_credit_alerts: boolean;
  email_funding_alerts: boolean;
  email_score_milestones: boolean;
  email_coaching_reminders: boolean;
  email_weekly_summary: boolean;
  email_onboarding: boolean;
  email_affiliate_program: boolean;
  sms_credit_alerts: boolean;
  sms_funding_alerts: boolean;
  sms_score_milestones: boolean;
  sms_coaching_reminders: boolean;
  unsubscribed_all: boolean;
}

const DEFAULTS: CommPrefs = {
  email_enabled: true,
  sms_enabled: false,
  sms_phone_number: "",
  sms_phone_verified: false,
  email_credit_alerts: true,
  email_funding_alerts: true,
  email_score_milestones: true,
  email_coaching_reminders: true,
  email_weekly_summary: true,
  email_onboarding: true,
  email_affiliate_program: true,
  sms_credit_alerts: true,
  sms_funding_alerts: true,
  sms_score_milestones: true,
  sms_coaching_reminders: true,
  unsubscribed_all: false,
};

export const NotificationsSettings = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<CommPrefs>(DEFAULTS);
  const [userEmail, setUserEmail] = useState<string>("");
  const [phoneInput, setPhoneInput] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    void loadPrefs();
  }, []);

  const loadPrefs = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserEmail(user.email ?? "");

      const { data, error } = await supabase
        .from("communication_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setPrefs({ ...DEFAULTS, ...(data as any) });
        setPhoneInput((data as any).sms_phone_number ?? "");
      }
    } catch (err) {
      console.error("Failed to load notification preferences", err);
    } finally {
      setLoading(false);
    }
  };

  const updatePref = async <K extends keyof CommPrefs>(key: K, value: CommPrefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from("communication_preferences")
        .update({ [key]: value } as any)
        .eq("user_id", user.id);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to update preference", err);
      toast({ title: "Could not save preference", variant: "destructive" });
      void loadPrefs();
    } finally {
      setSaving(false);
    }
  };

  const handleSendCode = async () => {
    if (!phoneInput) {
      toast({ title: "Enter a phone number first", variant: "destructive" });
      return;
    }
    setSendingCode(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-sms-verification", {
        body: { phone_number: phoneInput },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setCodeSent(true);
      toast({ title: "Verification code sent", description: "Check your phone for the 6-digit code." });
    } catch (err: any) {
      toast({
        title: "Could not send code",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    if (verificationCode.length !== 6) {
      toast({ title: "Enter the 6-digit code", variant: "destructive" });
      return;
    }
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-sms-code", {
        body: { code: verificationCode, phone_number: phoneInput },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Phone verified", description: "SMS notifications are now available." });
      setVerificationCode("");
      setCodeSent(false);
      await loadPrefs();
    } catch (err: any) {
      toast({
        title: "Verification failed",
        description: err?.message ?? "Invalid or expired code.",
        variant: "destructive",
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleUnsubscribeAll = async () => {
    if (!confirm("Unsubscribe from ALL emails and SMS? You can re-enable individual categories later.")) return;
    await updatePref("unsubscribed_all", true);
    toast({ title: "Unsubscribed from all notifications" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Notifications</h2>
        <p className="text-muted-foreground">
          Choose which alerts you receive by email and SMS. All notifications are opt-in.
        </p>
      </div>

      {prefs.unsubscribed_all && (
        <Alert>
          <BellOff className="h-4 w-4" />
          <AlertDescription>
            You are currently unsubscribed from all notifications.{" "}
            <button
              className="underline font-medium"
              onClick={() => updatePref("unsubscribed_all", false)}
            >
              Re-enable notifications
            </button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="email">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="email" className="gap-2">
            <Mail className="h-4 w-4" /> Email
          </TabsTrigger>
          <TabsTrigger value="sms" className="gap-2">
            <MessageSquare className="h-4 w-4" /> SMS
          </TabsTrigger>
        </TabsList>

        {/* EMAIL TAB */}
        <TabsContent value="email">
          <Card className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-semibold">Master email toggle</Label>
                <p className="text-sm text-muted-foreground">Enable or disable all emails</p>
              </div>
              <Switch
                checked={prefs.email_enabled && !prefs.unsubscribed_all}
                disabled={saving || prefs.unsubscribed_all}
                onCheckedChange={(v) => updatePref("email_enabled", v)}
              />
            </div>

            <Separator />

            <div className="space-y-4 opacity-100">
              {[
                ["email_credit_alerts", "Credit Alerts", "New inquiries, score drops, and credit events"],
                ["email_score_milestones", "Score Milestones", "When you cross a meaningful score threshold"],
                ["email_funding_alerts", "Funding Opportunities", "New lender matches and capital opportunities"],
                ["email_weekly_summary", "Weekly Summary", "Mondays — your week's progress and next action"],
                ["email_coaching_reminders", "Coaching Reminders", "Reminders for upcoming strategy sessions"],
                ["email_onboarding", "Onboarding", "Welcome and getting-started messages"],
                ["email_affiliate_program", "Partner Program", "Application updates, commission earnings, payments, and monthly statements"],
              ].map(([key, label, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <div>
                    <Label htmlFor={key as string}>{label}</Label>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <Switch
                    id={key as string}
                    checked={(prefs as any)[key as string] && prefs.email_enabled && !prefs.unsubscribed_all}
                    disabled={!prefs.email_enabled || prefs.unsubscribed_all || saving}
                    onCheckedChange={(v) => updatePref(key as keyof CommPrefs, v as any)}
                  />
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-sm">Email address</Label>
              <p className="text-sm text-muted-foreground">{userEmail || "—"}</p>
            </div>

            <Button variant="ghost" size="sm" onClick={handleUnsubscribeAll} className="text-destructive">
              Unsubscribe from all emails and SMS
            </Button>
          </Card>
        </TabsContent>

        {/* SMS TAB */}
        <TabsContent value="sms">
          <Card className="p-6 space-y-6">
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {/* customer-identity-exempt: TCPA notice naming the registered sender; must match the A2P campaign brand (compliance decision, round 2 list) */}
                <strong>TCPA Notice:</strong> By enabling SMS you consent to receive transactional text
                messages from PaigeAgent. Reply STOP to any message to unsubscribe. Message and data rates
                may apply.
              </AlertDescription>
            </Alert>

            {!prefs.sms_phone_verified ? (
              <div className="space-y-4">
                <div>
                  <Label className="text-base font-semibold">Verify your phone</Label>
                  <p className="text-sm text-muted-foreground">
                    SMS notifications require phone verification before they can be enabled.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone-input">Phone number</Label>
                  <div className="flex gap-2">
                    <Input
                      id="phone-input"
                      type="tel"
                      placeholder="+1 (555) 123-4567"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      disabled={sendingCode || codeSent}
                    />
                    <Button onClick={handleSendCode} disabled={sendingCode || codeSent || !phoneInput}>
                      {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Code"}
                    </Button>
                  </div>
                </div>

                {codeSent && (
                  <div className="space-y-2">
                    <Label htmlFor="code-input">6-digit verification code</Label>
                    <div className="flex gap-2">
                      <Input
                        id="code-input"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                      />
                      <Button onClick={handleVerifyCode} disabled={verifying || verificationCode.length !== 6}>
                        {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                      </Button>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => {
                        setCodeSent(false);
                        setVerificationCode("");
                      }}
                    >
                      Use a different number
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Master SMS toggle</Label>
                    <p className="text-sm text-muted-foreground">
                      Verified: {prefs.sms_phone_number}
                    </p>
                  </div>
                  <Switch
                    checked={prefs.sms_enabled && !prefs.unsubscribed_all}
                    disabled={saving || prefs.unsubscribed_all}
                    onCheckedChange={(v) => updatePref("sms_enabled", v)}
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  {[
                    ["sms_credit_alerts", "Credit Alerts"],
                    ["sms_score_milestones", "Score Milestones"],
                    ["sms_funding_alerts", "Funding Opportunities"],
                    ["sms_coaching_reminders", "Coaching Reminders"],
                  ].map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <Label htmlFor={key as string}>{label}</Label>
                      <Switch
                        id={key as string}
                        checked={(prefs as any)[key as string] && prefs.sms_enabled && !prefs.unsubscribed_all}
                        disabled={!prefs.sms_enabled || prefs.unsubscribed_all || saving}
                        onCheckedChange={(v) => updatePref(key as keyof CommPrefs, v as any)}
                      />
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground border-t pt-4">
                  Reply <strong>STOP</strong> to any message to unsubscribe instantly.
                </p>
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default NotificationsSettings;
