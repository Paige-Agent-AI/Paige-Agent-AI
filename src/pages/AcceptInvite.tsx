import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck } from "lucide-react";
import { safeRedirectOr } from "@/lib/auth/safeRedirect";
import "./workspace/workspace-theme.css";

type InviteType = "btf_client" | "team_member";

interface InviteInfo {
  type: InviteType;
  email: string;
  displayName: string;
  role?: string;
  tier?: string;
  expired: boolean;
  alreadyUsed?: boolean;
  brand: { name: string; program: string };
  redirectTo: string;
}

/**
 * Unified Accept Invite page.
 * - Detects token type (BTF client vs internal team)
 * - Renders the correct branding (BTF = Mogul Maker Academy white-label, team = Paige)
 * - Sets password, signs the user in, routes to the right next step.
 *
 * Both /accept-invite (canonical) and /workspace/accept-invite (back-compat with already-sent
 * BTF emails) mount this component.
 */
export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");

  // ---- Lookup token on mount ----
  useEffect(() => {
    if (!token) {
      setError("This activation link is missing its token. Please re-open the email.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data, error: invErr } = await supabase.functions.invoke("accept-invite", {
          body: { action: "lookup", token },
        });
        if (invErr || !data?.ok) {
          setError(data?.error ?? invErr?.message ?? "Invite not found or no longer valid");
        } else {
          setInfo(data as InviteInfo);
          setFullName(data.displayName ?? "");
        }
      } catch (error: unknown) {
        setError(error instanceof Error ? error.message : "Unable to verify invite");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const isBtf = info?.type === "btf_client";

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: consumeErr } = await supabase.functions.invoke("accept-invite", {
        body: { action: "consume", token, password, fullName: fullName || undefined },
      });
      if (consumeErr || !data?.ok) {
        throw new Error(data?.error ?? consumeErr?.message ?? "Activation failed");
      }
      // Sign the user in with the password they just set.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: data.email,
        password,
      });
      if (signInErr) {
        throw new Error(`Account activated, but sign-in failed: ${signInErr.message}`);
      }
      navigate(safeRedirectOr(data.redirectTo, "/app"), { replace: true });
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Activation failed");
      setSubmitting(false);
    }
  }

  // ============ Loading ============
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Verifying your invite…</span>
        </div>
      </div>
    );
  }

  // ============ Error / expired ============
  if (error || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Invite unavailable</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              If you think this is a mistake, please reply to the email you received and we'll
              send you a fresh link.
            </p>
            <Button variant="outline" onClick={() => navigate("/")}>Go home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (info.expired || info.alreadyUsed) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-6 ${isBtf ? "workspace-theme" : "bg-background"}`}>
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>{info.alreadyUsed ? "Already activated" : "Invite expired"}</CardTitle>
            <CardDescription>
              {info.alreadyUsed
                ? "This invite has already been used. Sign in instead."
                : "This invite is no longer valid. Reach out to request a new one."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/auth")}>Go to sign in</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isBtf) {
    return (
      <div className="workspace-theme min-h-screen flex items-center justify-center px-6 py-12">
        <Helmet>
          <title>Enrollment unavailable · {info.brand?.name || "Client Portal"}</title>
          <meta name="robots" content="noindex,nofollow" />
        </Helmet>
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Client Portal enrollment is not open</CardTitle>
            <CardDescription>
              {/* A customer of a business reads that business, never the platform's COO product (owner ruling, 2026-10-19). */}
              {`This invitation can't create a new Client Portal account. Ask ${info.brand?.name || "the business that invited you"} for a new invitation.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={() => navigate("/auth?mode=login")}>Sign in to an existing account</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============ White-label workspace client ============
  // Brand is DATA-DRIVEN off the invite (info.brand.{name,program}), resolved by the
  // accept-invite lookup — never a hardcoded vertical name here (§9). The workspace
  // theme (workspace-theme.css) supplies the white-label palette for this tenant.
  if (isBtf) {
    const brandName = info.brand?.name || info.displayName;
    const brandProgram = info.brand?.program || "";
    return (
      <div className="workspace-theme min-h-screen flex items-center justify-center px-6 py-12">
        <Helmet>
          <title>{`Activate Your Workspace · ${brandName}`}</title>
          <meta name="robots" content="noindex,nofollow" />
        </Helmet>
        <div className="workspace-card p-8 max-w-md w-full">
          <div
            className="workspace-gold text-2xl font-bold mb-1 text-center"
            style={{ fontFamily: '"Bookman Old Style", Georgia, serif' }}
          >
            {brandName}
          </div>
          {brandProgram ? (
            <p className="text-xs uppercase tracking-[0.2em] text-center mb-6" style={{ color: "rgba(8,20,40,0.55)" }}>
              {brandProgram} Workspace
            </p>
          ) : (
            <div className="mb-6" />
          )}
          <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: '"Bookman Old Style", Georgia, serif' }}>
            Welcome, {info.displayName}.
          </h1>
          <p className="text-sm mb-6" style={{ color: "rgba(8,20,40,0.75)" }}>
            Set a password to activate your private workspace. From here you'll complete intake,
            upload documents, and message your coach.
          </p>

          <form onSubmit={handleActivate} className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider">Email</Label>
              <Input value={info.email} disabled className="bg-white/70" />
            </div>
            <div>
              <Label htmlFor="fullName" className="text-xs uppercase tracking-wider">Your full name</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs uppercase tracking-wider">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" />
            </div>
            <div>
              <Label htmlFor="confirm" className="text-xs uppercase tracking-wider">Confirm password</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={submitting} className="w-full" style={{ backgroundColor: "#CFAE70", color: "#0a1628" }}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activate Workspace"}
            </Button>

            <p className="text-xs text-center flex items-center justify-center gap-1.5" style={{ color: "rgba(8,20,40,0.55)" }}>
              <ShieldCheck className="h-3 w-3" />
              Your data is encrypted and private.
            </p>
          </form>
        </div>
      </div>
    );
  }

  // ============ Internal Team (Paige) ============
  const roleLabel = (info.role ?? "team member").replace(/_/g, " ");
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <Helmet>
        <title>Activate Your Account · PaigeAgent.ai</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <Card className="max-w-md w-full">
        <CardHeader>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">PaigeAgent.ai</p>
          <CardTitle className="text-2xl">Welcome to the team, {info.displayName}.</CardTitle>
          <CardDescription>
            You've been invited as <span className="font-semibold capitalize text-foreground">{roleLabel}</span>.
            Set a password to activate your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleActivate} className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input value={info.email} disabled />
            </div>
            <div>
              <Label htmlFor="fullName">Your full name</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activate Account"}
            </Button>

            <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3 w-3" />
              Your password is hashed and never visible to admins.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
