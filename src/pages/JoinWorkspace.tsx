/**
 * /join/:token — public landing page that accepts a workspace invite.
 *
 * Consumer (customer) flow — a tenant invited THEIR customer:
 *   1. peek_tenant_invite (public RPC) → tenant brand + the invited email.
 *   2. Accept → if the visitor has no account yet, they create a CUSTOMER login
 *      INLINE on this tenant-branded card (email prefilled from the invite +
 *      password) — they never see the platform /auth page (§9). That account is
 *      customer-only; accept_tenant_invite grants the 'client' role and links a
 *      tenant-scoped clients row, then they go straight to /onboard.
 *
 * Staff (team) & agency-team flow: a STAFF teammate (kind='team') and an AGENCY
 * TEAM member (kind='agency_team') now also create their login INLINE on this
 * branded card — they are never bounced to the unbranded platform /auth page (§9).
 * They are staff, so the Workforce/GLBA acknowledgment gate runs before the accept
 * finishes; accept_tenant_invite then grants the correct membership (tenant staff →
 * tenant_members at the invite's default_role; agency staff → agency_team_members at
 * the token's agency_role). Inline signup can never escalate role beyond the invite.
 * Only an unrecognized/legacy kind still falls back to /auth.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldCheck, ShieldAlert, Eye, EyeOff } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ContextualConsentDialog } from "@/components/legal/ContextualConsentDialog";
import { resolveLandingRoute } from "@/lib/auth/resolveLandingRoute";
import { readableTextOn } from "@/lib/brand/contrast";
import { ConsumerInvitation } from "./ConsumerInvitation";

interface PeekRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  brand: { logo_url?: string | null; primary_color?: string | null } | null;
  kind: string;
  default_role: string;
  expires_at: string;
  is_valid: boolean;
  invited_email: string | null;
}

export default function JoinWorkspace() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<PeekRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentDone, setConsentDone] = useState(false);

  // Inline customer-registration state (consumer invite, not signed in).
  const [step, setStep] = useState<"accept" | "register">("accept");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [regConsent, setRegConsent] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id);
      setAuthed(!!data.user);
    });
  }, []);

  const isConsumerInvite = !!info && info.kind === "consumer";
  // A sub-account OWNER invite: an agency invited the principal of a child
  // workspace. They set up their account INLINE on the agency-branded card (never
  // the platform /auth bounce), but they are staff (an admin of the child), not a
  // customer — so no client-portal copy and no /onboard redirect.
  const isSubaccountOwnerInvite = !!info && info.kind === "subaccount_owner";
  // A tenant STAFF invite (a coach/consultant/agency invited a teammate onto their
  // own workspace) and an AGENCY TEAM invite (an agency invited someone onto its
  // operator team, §9) both now register INLINE on the branded card too — matching
  // the client-portal and sub-account-owner bar. Nobody is bounced to the unbranded
  // platform /auth page anymore.
  const isTenantStaffInvite = !!info && info.kind === "team";
  const isAgencyTeamInvite = !!info && info.kind === "agency_team";
  // Workforce/GLBA acknowledgment gates STAFF invites (tenant staff + agency team),
  // not customers or sub-account owners — preserved from the prior behavior.
  const isStaffInvite = isTenantStaffInvite || isAgencyTeamInvite;
  // Every recognized kind registers inline; an unrecognized/legacy kind still falls
  // back to the platform /auth bounce (defensive — never a dead end).
  const isInlineRegisterInvite =
    isConsumerInvite || isSubaccountOwnerInvite || isTenantStaffInvite || isAgencyTeamInvite;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: e } = await supabase.rpc("peek_tenant_invite", { _token: token });
        if (e) throw e;
        const row = Array.isArray(data) ? (data[0] as PeekRow | undefined) : (data as PeekRow | null);
        if (cancelled) return;
        if (!row) {
          setError("This invite link is not valid.");
        } else {
          setInfo(row);
          if (row.invited_email) setRegEmail(row.invited_email);
          if (!row.is_valid) {
            setError("This invite has expired or been revoked.");
            try { localStorage.removeItem("paige_pending_invite"); } catch { /* ignore */ }
          } else {
            try {
              localStorage.setItem("paige_pending_invite", JSON.stringify({ token, ts: Date.now() }));
            } catch { /* ignore */ }
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load invite");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  /** Run the accept RPC and route the user in (no consent gate — caller handles it). */
  const finishAccept = async (uid: string) => {
    // Solo Team invitations use the single-use, email-bound acceptance contract.
    // Other invite kinds retain their existing specialized acceptance paths.
    const { error: e } = isTenantStaffInvite
      ? await supabase.rpc("accept_solo_team_invite" as never, { _token: token } as never)
      : await supabase.rpc("accept_tenant_invite", { _token: token });
    if (e) throw e;
    try { localStorage.removeItem("paige_pending_invite"); } catch { /* ignore */ }
    toast.success(`Welcome to ${info?.tenant_name ?? "your workspace"}`);
    if (isConsumerInvite) {
      // Explicit customer accept → straight into their portal onboarding.
      window.location.assign("/onboard");
      return;
    }
    const target = await resolveLandingRoute(uid);
    window.location.assign(target);
  };

  /** Consume the invite for an already-authenticated user and route them in. */
  const doAccept = async (uid: string) => {
    // Tenant STAFF invitations capture the Workforce/GLBA acknowledgment first
    // (preserved from the prior staff flow). Agency-team invites are not gated here
    // — the shipped agency flow had no such gate; adding one is a deliberate
    // follow-up, not smuggled in with this branding change.
    if (isTenantStaffInvite && !consentDone) {
      setUserId(uid);
      setConsentOpen(true);
      setAccepting(false);
      return;
    }
    await finishAccept(uid);
  };

  const onAcceptClick = async () => {
    setAccepting(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await doAccept(auth.user.id);
        return;
      }
      // Not signed in. A CUSTOMER or a SUB-ACCOUNT OWNER creates their login
      // inline here on the agency-branded card (never the platform /auth page);
      // only true platform staff go through the platform auth.
      if (isInlineRegisterInvite) {
        setStep("register");
        setAccepting(false);
        return;
      }
      const next = encodeURIComponent(`/join/${token}`);
      navigate(`/auth?next=${next}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept invite");
      setAccepting(false);
    }
  };

  const submitRegister = async () => {
    const email = regEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("Enter a valid email address");
    if (regPassword.length < 8) return toast.error("Password must be at least 8 characters");
    if (!regConsent) return toast.error("Please agree to the terms to continue");
    setAccepting(true);
    try {
      // Solo Beta is the only open account-creation lane. Token-gated legacy,
      // portal, agency, sub-account, and team invites may still be accepted by an
      // existing authorized identity, but this public surface cannot create one.
      const { error: e } = await supabase.auth.signInWithPassword({ email, password: regPassword });
      if (e) throw e;
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Could not establish your session — please try again.");
      await doAccept(auth.user.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not sign in";
      toast.error(msg);
      setAccepting(false);
    }
  };

  // brand.primary_color arrives resolved up the parent chain (peek_tenant_invite →
  // resolve_tenant_brand), already floored to the platform token; the literal below
  // is only a pre-load defensive default (§11 token floor, never off-palette).
  const brandColor = info?.brand?.primary_color || "#150C31";
  const btnStyle = { backgroundColor: brandColor, color: readableTextOn(brandColor) };

  // Consumer signup/confirmation/acceptance has its own recipient-bound flow.
  // Keep the existing staff, agency and sub-account entry contracts unchanged.
  if (info?.kind === "consumer") return <ConsumerInvitation key={token} token={token} info={info} />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <Helmet>
        <title>{info ? `Join ${info.tenant_name}` : "Workspace invite"}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          {info?.brand?.logo_url ? (
            <img src={info.brand.logo_url} alt={info.tenant_name} className="h-12 w-auto mx-auto mb-3 object-contain" />
          ) : (
            <div
              className="h-12 w-12 rounded-lg mx-auto mb-3 flex items-center justify-center text-xl font-semibold"
              style={{ backgroundColor: brandColor, color: readableTextOn(brandColor) }}
            >
              {(info?.tenant_name ?? "?").charAt(0).toUpperCase()}
            </div>
          )}
          <CardTitle>
            {loading ? "Loading invite…" : info ? `Join ${info.tenant_name}` : "Workspace invite"}
          </CardTitle>
          <CardDescription>
            {error
              ? error
              : step === "register"
                ? isSubaccountOwnerInvite
                  ? `Sign in with an existing authorized account to run ${info?.tenant_name ?? "your workspace"}.`
                  : isStaffInvite
                    ? `Sign in with an existing authorized account to join the ${info?.tenant_name ?? "workspace"} team.`
                    : `Sign in with an existing authorized account to open your portal with ${info?.tenant_name ?? "your workspace"}.`
                : info
                  ? isConsumerInvite
                    ? `Accept to open your private client portal with ${info.tenant_name}.`
                    : isSubaccountOwnerInvite
                      ? `You're set up as the owner of ${info.tenant_name}. Set up your account to take the reins.`
                      : isAgencyTeamInvite
                        ? `You've been invited to join the ${info.tenant_name} team. Accept to get started.`
                        : `You've been invited to join the ${info.tenant_name} team as a ${info.default_role}. Accept to access the workspace.`
                  : "Checking your invitation…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="w-4 h-4 mt-0.5 text-destructive flex-shrink-0" />
              <span>Ask whoever sent you this link for a fresh invitation.</span>
            </div>
          ) : step === "register" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="reg-email">Email</Label>
                <Input
                  id="reg-email"
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={accepting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-pw">Password</Label>
                <div className="relative">
                  <Input
                    id="reg-pw"
                    type={showPw ? "text" : "password"}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={accepting}
                    minLength={8}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox checked={regConsent} onCheckedChange={(v) => setRegConsent(!!v)} className="mt-0.5" />
                <span>
                  I agree to the{" "}
                  <Link to="/legal/terms" target="_blank" className="underline" onClick={(e) => e.stopPropagation()}>Terms</Link> and{" "}
                  <Link to="/legal/privacy" target="_blank" className="underline" onClick={(e) => e.stopPropagation()}>Privacy Policy</Link>
                  {isSubaccountOwnerInvite
                    ? `, and to run ${info?.tenant_name ?? "this workspace"} on this platform.`
                    : isStaffInvite
                      ? `, and to join the ${info?.tenant_name ?? "workspace"} team.`
                      : `, and to work with ${info?.tenant_name ?? "this workspace"} through my client portal.`}
                </span>
              </label>
              <Button onClick={submitRegister} disabled={accepting} className="w-full" style={btnStyle}>
                {accepting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {isSubaccountOwnerInvite
                  ? "Sign in & open workspace"
                  : isStaffInvite
                    ? "Sign in & join team"
                    : "Sign in & open portal"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                New Client Portal, Agency, sub-account, and team enrollment is not open during the Solo Beta.
                If you already have authorized access, sign in above; otherwise contact the person who invited you.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="w-4 h-4 mt-0.5 text-green-600 flex-shrink-0" />
                <span>
                  {isConsumerInvite
                    ? `By continuing you agree to ${info?.tenant_name ?? "the workspace"}'s terms and to work with them through your client portal.`
                    : isSubaccountOwnerInvite
                      ? `By continuing you'll set up your account and take ownership of ${info?.tenant_name ?? "your workspace"}.`
                      : "By accepting you agree to the workspace's terms and grant the admin access to manage your membership."}
                </span>
              </div>
              <Button onClick={onAcceptClick} disabled={accepting || !info?.is_valid} className="w-full" style={btnStyle}>
                {accepting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Accept invitation
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      <ContextualConsentDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        userId={userId}
        slug="workforce-acknowledgment"
        actionLabel="Acknowledge and join workspace"
        context={{ tenant_id: info?.tenant_id, role: info?.default_role, source: "join_workspace" }}
        onAccepted={() => {
          setConsentDone(true);
          // Consent recorded — finish the accept directly (do NOT re-run the gate,
          // whose stale closure would still see consentDone=false and re-open it).
          if (userId) {
            setAccepting(true);
            void finishAccept(userId).catch((err) => {
              toast.error(err instanceof Error ? err.message : "Could not accept invite");
              setAccepting(false);
            });
          }
        }}
      />
    </div>
  );
}
