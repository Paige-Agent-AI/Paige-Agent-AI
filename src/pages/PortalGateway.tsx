/**
 * /portal/:tenantSlug — the tenant-branded gateway a CUSTOMER returns to.
 *
 * A signed-out customer has no session, so we resolve the tenant's public brand
 * by slug (peek_tenant_portal_brand) and wear it here: their coach's logo, name,
 * and color — never the Paige platform page (§6/§9). This surface is both:
 *   • where customer sign-out lands them ("signed out — log back in"), and
 *   • the durable "log back in" page they can bookmark.
 *
 * Sign-in only. A tenant's customers are created by invite (/join/:token), so
 * there is no self-serve signup here — just email + password back into /app.
 *
 * On a tenant host (<slug>.paigeagent.ai) this is a PUBLIC entry only (E09 decision D5): it wears the
 * same brand and links out to this gateway on the app origin, where sign-in and the session live. It
 * never reads a session there and never collects a credential, so no session is ever born on the
 * tenant origin — and it never navigates to a relative /app, which host routing pins back to
 * /portal/<slug> on a tenant host (the redirect loop this replaces).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { readableTextOn } from "@/lib/brand/contrast";
import { resolveLandingRoute } from "@/lib/auth/resolveLandingRoute";
import { cachePortalSlug } from "@/lib/auth/signOut";
import { tenantHostPortalEntryUrl, tenantSlugFromHostname, trustedAppOrigin } from "@/lib/hostRouting";
import "./ConsumerInvitation.css";

interface PortalBrand {
  tenant_name: string;
  tenant_slug: string;
  logo_url: string | null;
  primary_color: string | null;
}

async function boundedGateway<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([Promise.resolve(request), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Your portal could not be reached. Check your connection and try again.")), 20_000);
  })]); } finally { clearTimeout(timer!); }
}

export default function PortalGateway() {
  const navigate = useNavigate();
  const { tenantSlug: routeSlug = "" } = useParams<{ tenantSlug: string }>();
  // The hostname is routing context, never authorization. On a tenant host the hostname tenant wins
  // over the route param, so a mismatched path can never brand or link another business.
  const [tenantHost] = useState(() => ({
    slug: tenantSlugFromHostname(window.location.hostname),
    entryUrl: tenantHostPortalEntryUrl(window.location.hostname),
  }));
  const tenantSlug = tenantHost.slug ?? routeSlug;
  const [brand, setBrand] = useState<PortalBrand | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const attempt = useRef({sequence: 0});

  const customerTarget = useCallback(async (subject: string) => {
    const target = await boundedGateway(resolveLandingRoute(subject, { customerPortal: true }));
    if (target === "/pricing" || target === "/onboarding") {
      throw new Error("No active customer access was found. Ask your provider for a current invitation.");
    }
    if (target === "/app" || target.startsWith("/onboard/")) {
      // The public slug is presentation, never membership. The native reader
      // resolves only the actual caller's current active customer relationship.
      const { data, error } = await boundedGateway(supabase.rpc("get_client_portal_brand"));
      const ownBrand = Array.isArray(data) ? data[0] : data;
      // Match the public reader's lower(trim(_slug)) lookup. Its public DTO
      // deliberately omits tenant IDs; membership still comes from this reader.
      if (error || typeof ownBrand?.tenant_slug !== "string"
        || ownBrand.tenant_slug.trim().toLowerCase() !== tenantSlug.trim().toLowerCase()) {
        throw new Error("This login does not have access to this business’s portal. Use the portal link from your provider.");
      }
    }
    const { data, error } = await boundedGateway(supabase.auth.getUser());
    if (error || data.user?.id !== subject) throw new Error("Your session changed. Sign in again to continue.");
    return target;
  }, [tenantSlug]);

  // If a customer is already signed in, don't show a login wall — route them in.
  // Keep the spinner up until this settles so an authed visitor never sees a
  // flash of the sign-in form on their bookmarked gateway.
  useEffect(() => {
    // A tenant host never reads a session: it is a public entry that links out to the app origin.
    if (tenantHost.entryUrl) { setCheckingAuth(false); return; }
    let cancelled = false;
    const lifetime = attempt.current;
    ++lifetime.sequence;
    boundedGateway(supabase.auth.getUser()).then(async ({ data }) => {
      if (cancelled) return;
      if (data.user) {
        const target = await customerTarget(data.user.id);
        if (!cancelled) navigate(target, { replace: true });
        return; // leave checkingAuth true — we're navigating away
      }
      setCheckingAuth(false);
    }).catch((error) => { if (!cancelled) { toast.error(error instanceof Error ? error.message : "Your portal could not be verified. Try again."); setCheckingAuth(false); } });
    return () => { cancelled = true; ++lifetime.sequence; };
  }, [customerTarget, navigate, tenantHost.entryUrl]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setNotFound(false);
    (async () => {
      try {
        const { data, error } = await boundedGateway(supabase.rpc("peek_tenant_portal_brand", { _slug: tenantSlug }));
        if (cancelled) return;
        if (error) throw error;
        const row = Array.isArray(data) ? (data[0] as PortalBrand | undefined) : (data as PortalBrand | null);
        if (!row) {
          setNotFound(true);
        } else {
          setBrand(row);
          // Remember this tenant so involuntary logouts (session expiry) can
          // still return the customer here instead of the Paige page (§9).
          cachePortalSlug(row.tenant_slug);
        }
      } catch {
        // Transient RPC/network failure is not a bad slug. Don't tell a customer
        // with a valid bookmark that their link is invalid — offer a retry.
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantSlug, reloadKey]);

  const brandColor = brand?.primary_color || "#CFAE70";
  const btnStyle = { backgroundColor: brandColor, color: readableTextOn(brandColor) };
  // Hold the spinner until BOTH the brand peek and the auth probe settle, so an
  // already-authed visitor never sees a flash of the sign-in form.
  const busy = loading || checkingAuth;

  const signIn = async () => {
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return toast.error("Enter a valid email address");
    if (!password) return toast.error("Enter your password");
    const currentAttempt = ++attempt.current.sequence;
    setSubmitting(true);
    try {
      const { data, error } = await boundedGateway(supabase.auth.signInWithPassword({ email: em, password }));
      if (currentAttempt !== attempt.current.sequence) return;
      if (error) throw error;
      if (!data.user) throw new Error("Could not sign you in — please try again.");
      setPassword("");
      const target = await customerTarget(data.user.id);
      if (currentAttempt !== attempt.current.sequence) return;
      navigate(target, { replace: true });
    } catch (err) {
      if (currentAttempt !== attempt.current.sequence) return;
      toast.error(err instanceof Error ? err.message : "Could not sign in");
      setSubmitting(false);
    }
  };

  const sendReset = async () => {
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return toast.error("Enter your email above first, then tap reset");
    setSendingReset(true);
    try {
      // Route to the real recovery handler (which renders the set-new-password
      // form), carrying the tenant slug so the reset stays under the coach's
      // brand and returns here when done. Sending them straight back to /portal
      // would consume the one-time token without ever letting them set a password.
      // Always an app origin: a tenant, unknown or hostile hostname never picks the email's target.
      const redirectTo = `${trustedAppOrigin(window.location)}/reset-password?portal=${encodeURIComponent(tenantSlug)}`;
      const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo });
      if (error) throw error;
      toast.success("Check your email for a link to reset your password.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reset email");
    } finally {
      setSendingReset(false);
    }
  };

  const title = busy
    ? "Loading…"
    : loadError || notFound
      ? "Client Portal"
      : `Welcome back to ${brand?.tenant_name}`;

  const description = busy
    ? " "
    : loadError
      ? "We couldn't load this page. Check your connection and try again."
      : notFound
        ? "This portal link isn't valid. Please use the link your provider gave you, or the invitation email they sent."
        : "Sign in to open your private client portal.";

  return (
    <div className="customer-entry min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <Helmet>
        <title>{brand ? `${brand.tenant_name} — Client Portal` : "Client Portal"}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          {busy ? null : brand?.logo_url ? (
            <img src={brand.logo_url} alt={brand.tenant_name} className="h-12 w-auto mx-auto mb-3 object-contain" />
          ) : brand ? (
            <div
              className="h-12 w-12 rounded-lg mx-auto mb-3 flex items-center justify-center text-xl font-semibold"
              style={{ backgroundColor: brandColor, color: readableTextOn(brandColor) }}
            >
              {brand.tenant_name.charAt(0).toUpperCase()}
            </div>
          ) : null}
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {busy ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <Button onClick={() => setReloadKey((k) => k + 1)} className="w-full" style={btnStyle}>
              Try again
            </Button>
          ) : notFound ? null : tenantHost.entryUrl ? (
            <>
              <Button asChild className="w-full" style={btnStyle}>
                <a href={tenantHost.entryUrl} data-portal-entry="">Sign in to your portal</a>
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                You’ll sign in securely on {new URL(tenantHost.entryUrl).host}.
              </p>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="portal-email">Email</Label>
                <Input
                  id="portal-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={submitting}
                  autoComplete="email"
                  onKeyDown={(e) => { if (e.key === "Enter") signIn(); }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="portal-pw">Password</Label>
                <div className="relative">
                  <Input
                    id="portal-pw"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={submitting}
                    autoComplete="current-password"
                    className="pr-[48px]"
                    onKeyDown={(e) => { if (e.key === "Enter") signIn(); }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-0 top-1/2 -translate-y-1/2 min-w-[44px] flex items-center justify-center text-muted-foreground/60 hover:text-muted-foreground"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button onClick={signIn} disabled={submitting} className="w-full" style={btnStyle}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Sign in
              </Button>
              <button
                type="button"
                disabled={sendingReset}
                onClick={sendReset}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                {sendingReset ? "Sending reset link…" : "Forgot your password?"}
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
