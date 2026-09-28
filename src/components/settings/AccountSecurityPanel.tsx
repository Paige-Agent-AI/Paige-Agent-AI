import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard, StatePill } from "@/components/ui/page";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  PasswordStrengthIndicator,
  MIN_PASSWORD_LENGTH,
} from "@/components/auth/PasswordStrengthIndicator";
import { performSignOut, customerSignOutTarget } from "@/lib/auth/signOut";
import {
  KeyRound,
  ShieldCheck,
  LogOut,
  ShieldAlert,
  Loader2,
  Eye,
  EyeOff,
  Smartphone,
  Copy,
  Check,
} from "lucide-react";

/**
 * AccountSecurityPanel — the ONE self-service account-security surface, shared
 * by every tenant user (client, tenant staff, agency operator). §9 parity: the
 * same Change Password / Two-Factor / Sign-out-everywhere controls render the
 * same way for all audiences — the client dashboard mounts it (ProfileSettings)
 * and so does the admin settings hub (AdminSettingsHub → Account Security tab).
 *
 * Audience-agnostic by construction: no operator-only fleet controls leak here,
 * no vertical/finance copy (§2). Built on the §11 primitive layer (SectionCard,
 * StatePill) — gold is spent ONLY on the act moment (Update password / Verify /
 * Turn on), never a resting control.
 *
 * SAFETY: this is enrollment-only 2FA. It does NOT enforce AAL2 anywhere — no
 * assurance-level gate is introduced, so enabling a factor can never lock a user
 * out at sign-in. Turning 2FA on is purely additive and opt-in.
 */

type MfaFactor = {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
};

type PendingEnrollment = {
  factorId: string;
  qr: string;
  secret: string;
};

// Supabase surfaces a reauthentication requirement (when the project has
// "Secure password change" enabled) via an error code/message rather than a
// thrown auth error — detect it so we can tell the user honestly instead of
// swallowing it behind a generic "please try again".
function isReauthRequired(err: unknown): boolean {
  const code = (err as { code?: string })?.code?.toLowerCase() ?? "";
  const msg = (err as { message?: string })?.message?.toLowerCase() ?? "";
  return (
    code.includes("reauth") ||
    msg.includes("reauthenticat") ||
    msg.includes("session_not_found") ||
    (msg.includes("aal") && msg.includes("required"))
  );
}

function ChangePasswordCard() {
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [changing, setChanging] = useState(false);

  const handleChangePassword = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast({
        title: "Password too short",
        description: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Re-enter the same password in both fields.",
        variant: "destructive",
      });
      return;
    }
    setChanging(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      toast({ title: "Password updated", description: "Your new password is active now." });
    } catch (error) {
      if (isReauthRequired(error)) {
        // Honest, specific handling (§13): the project requires a fresh identity
        // check before a password change. OAuth-only users setting a first
        // password can also land here depending on the project's reauth config.
        toast({
          title: "Verify it's you first",
          description:
            "For your security, changing your password here needs an extra identity check. Sign out and use the “Forgot password” link on the sign-in page to reset it by email.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Couldn't update password",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setChanging(false);
    }
  };

  return (
    <SectionCard
      icon={KeyRound}
      title="Change password"
      description="Set a new password. It takes effect immediately on this account — no email round-trip."
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="acct-new-password">New password</Label>
            <div className="relative">
              <Input
                id="acct-new-password"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                autoComplete="new-password"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acct-confirm-password">Confirm password</Label>
            <Input
              id="acct-confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
          </div>
        </div>

        {newPassword && <PasswordStrengthIndicator password={newPassword} />}

        <Button
          variant="gold"
          onClick={handleChangePassword}
          disabled={changing || !newPassword || !confirmPassword}
        >
          {changing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Updating…
            </>
          ) : (
            "Update password"
          )}
        </Button>
      </div>
    </SectionCard>
  );
}

function TwoFactorCard() {
  const { toast } = useToast();
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingEnrollment | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  const verifiedFactors = factors.filter(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
  const isOn = verifiedFactors.length > 0;

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      // `all` includes both verified and unverified; we surface verified TOTP
      // as the "on" state and treat stray unverified factors as not-yet-enrolled.
      const all = (data?.all ?? []) as MfaFactor[];
      setFactors(all);
    } catch (error) {
      toast({
        title: "Couldn't load two-factor status",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadFactors();
  }, [loadFactors]);

  const startEnroll = async () => {
    setEnrolling(true);
    try {
      // Clean up orphaned unverified TOTP factors from any abandoned prior attempt
      // (navigate-away / reload without Cancel). Left alone they accumulate
      // invisibly and a same-day retry collides on gotrue's friendly-name
      // uniqueness, silently blocking setup with no UI recovery (§12/§13).
      const { data: existing } = await supabase.auth.mfa.listFactors();
      const stray = ((existing?.all ?? []) as MfaFactor[]).filter(
        (f) => f.factor_type === "totp" && f.status !== "verified",
      );
      for (const f of stray) {
        await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        // Full timestamp (not date-only) so repeated same-day setups never collide.
        friendlyName: `Authenticator ${new Date().toISOString()}`,
      });
      if (error) throw error;
      setPending({
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setCode("");
    } catch (error) {
      toast({
        title: "Couldn't start setup",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setEnrolling(false);
    }
  };

  const cancelEnroll = async () => {
    if (!pending) return;
    // Clean up the unverified factor so a cancelled setup never leaves a stray
    // half-enrolled TOTP behind (§12 — organized, no loose artifacts).
    const factorId = pending.factorId;
    setPending(null);
    setCode("");
    try {
      await supabase.auth.mfa.unenroll({ factorId });
    } catch {
      /* best-effort cleanup */
    }
    void loadFactors();
  };

  const verifyEnroll = async () => {
    if (!pending || code.length !== 6) return;
    setVerifying(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: pending.factorId,
        code,
      });
      if (error) throw error;
      setPending(null);
      setCode("");
      await loadFactors();
      toast({
        title: "Two-factor is on",
        description: "You'll be asked for a code from your authenticator app going forward.",
      });
    } catch (error) {
      toast({
        title: "That code didn't match",
        description: error instanceof Error ? error.message : "Check the code and try again.",
        variant: "destructive",
      });
    } finally {
      setVerifying(false);
    }
  };

  const disableFactor = async (factorId: string) => {
    setDisablingId(factorId);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      await loadFactors();
      toast({ title: "Two-factor turned off", description: "This authenticator was removed." });
    } catch (error) {
      toast({
        title: "Couldn't turn off two-factor",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDisablingId(null);
    }
  };

  const copySecret = async () => {
    if (!pending) return;
    try {
      await navigator.clipboard.writeText(pending.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the secret is still visible to type manually */
    }
  };

  return (
    <SectionCard
      icon={ShieldCheck}
      title="Two-factor authentication"
      description="Add a code from an authenticator app as a second layer on your account."
      actions={
        loading ? (
          <StatePill state="pending">Loading</StatePill>
        ) : isOn ? (
          <StatePill state="on">On</StatePill>
        ) : (
          <StatePill state="off">Off</StatePill>
        )
      }
    >
      <div className="space-y-4">
        {isOn && !pending && (
          <div className="space-y-3">
            {verifiedFactors.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {f.friendly_name || "Authenticator app"}
                    </p>
                    <p className="text-xs text-muted-foreground">Verified · time-based codes</p>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={disablingId === f.id}>
                      {disablingId === f.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Turn off"
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Turn off two-factor?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes your authenticator from this account. You can add it
                        back anytime, but until you do you'll only have your password.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it on</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => disableFactor(f.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Turn off two-factor
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}

        {!isOn && !pending && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Not set up yet. You'll scan a QR code with an app like Google Authenticator,
              1Password, or Authy.
            </p>
            <Button variant="gold" onClick={startEnroll} disabled={enrolling}>
              {enrolling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                "Turn on"
              )}
            </Button>
          </div>
        )}

        {pending && (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <img
                src={pending.qr}
                alt="Scan this QR code with your authenticator app"
                className="h-40 w-40 shrink-0 rounded-lg border border-border bg-white p-2"
              />
              <div className="space-y-3 min-w-0">
                <div>
                  <p className="text-sm font-medium">Scan, then enter the 6-digit code</p>
                  <p className="text-xs text-muted-foreground">
                    Open your authenticator app, scan the code, then type the number it shows.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Can't scan? Enter this key manually
                  </Label>
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-muted px-2 py-1 text-xs break-all">
                      {pending.secret}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={copySecret}
                      aria-label="Copy setup key"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Verification code</Label>
                  <InputOTP maxLength={6} value={code} onChange={setCode}>
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={cancelEnroll} disabled={verifying}>
                Cancel
              </Button>
              <Button
                variant="gold"
                onClick={verifyEnroll}
                disabled={verifying || code.length !== 6}
              >
                {verifying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  "Verify & turn on"
                )}
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Save your recovery access: keep your authenticator app — and any backup it offers —
          somewhere you can still reach if you lose your phone, so you don't lose this second layer.
        </p>
      </div>
    </SectionCard>
  );
}

function SessionsCard() {
  const [signingOut, setSigningOut] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  const handleLocalSignOut = async () => {
    if (signingOut || signingOutAll) return;
    setSigningOut(true);
    // Customers return to their coach's branded gateway; staff exit to root.
    const target = await customerSignOutTarget("/");
    // Held (with a toast) when an operator's act-as will not end; the button comes back.
    if (!(await performSignOut(target))) setSigningOut(false);
  };

  const handleSignOutAllDevices = async () => {
    if (signingOut || signingOutAll) return;
    setSigningOutAll(true);
    const target = await customerSignOutTarget("/");
    // Signing out every device is a security action: end an open act-as if possible, never hold it.
    await performSignOut({ redirectTo: target, scope: "global", actAs: "attempt" });
  };

  return (
    <SectionCard
      icon={LogOut}
      title="Where you're signed in"
      description="Sign out of this device, or force every browser, tablet, and phone using your account to sign back in."
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="outline"
          onClick={handleLocalSignOut}
          disabled={signingOut || signingOutAll}
          className="gap-2"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={signingOut || signingOutAll} className="gap-2">
              <ShieldAlert className="h-4 w-4" />
              Sign out of all devices
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out of all devices?</AlertDialogTitle>
              <AlertDialogDescription>
                This will end your session everywhere — including any phone, tablet, or browser
                where you're currently signed in. You'll need to sign in again on each device.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={signingOutAll}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleSignOutAllDevices}
                disabled={signingOutAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {signingOutAll ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing out…
                  </>
                ) : (
                  "Yes, sign me out everywhere"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SectionCard>
  );
}

export function AccountSecurityPanel({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="space-y-4">
        <ChangePasswordCard />
        <TwoFactorCard />
        <SessionsCard />
      </div>
    </div>
  );
}

export default AccountSecurityPanel;
