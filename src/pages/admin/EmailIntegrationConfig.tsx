/**
 * Email connect home (#141a) — the ONE place a tenant connects email so Paige can
 * send and receive from the unified inbox. Reachable from the integrations hub's
 * new "Email" tile and from every Conversations "Connect a channel" CTA (#518).
 *
 * §18: it does NOT rebuild domain verification — it REUSES <EmailDomainsPanel/>
 * (the live SPF/DKIM/DMARC verify surface backed by manage-tenant-domain). When a
 * domain is verified, the provision-on-verify DB trigger stands up the active
 * email channel_connectors row; this page reads that row to show real connection
 * state (§13 honest — never a faked "Connected").
 *
 * §11: compact PageHeader variant="plain" (no hero on a working surface), built on
 * the shared primitive layer (PageShell + SectionCard + StatePill). Gmail OAuth
 * (#141b) and generic SMTP (#141c) are BOTH real state-driven Connect/Disconnect
 * controls, each reading its own provider row (provider='gmail' | 'smtp') for honest
 * state — never a dead button (§13/§31). SMTP shows an inline host/port/username/
 * password/from form (A2PTab pattern) that invokes smtp-connect, then reloads state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell, PageHeader, SectionCard, StatePill } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { EmailDomainsPanel } from "@/components/admin/EmailDomainsPanel";
import { TenantDomainIdentityCard } from "@/components/admin/TenantDomainIdentityCard";
import { resolveFunctionError } from "@/lib/integrations/connectError";
import { useTenantContext } from "@/hooks/useTenantContext";
import { toast } from "sonner";
import { ChevronDown, KeyRound, Loader2, Link as LinkIcon, Mail, Unlink } from "lucide-react";

type GmailConnector = {
  id: string;
  tenant_id: string;
  updated_at: string;
  from_address: string | null;
  display_name: string | null;
};

type SmtpConnector = {
  tenant_id: string;
  from_address: string | null;
  display_name: string | null;
};

type EmailViewScope = { tenantId: string | null; actorId: string | null; ready: boolean; epoch: number };

// SMTP + OAuth failure copy now lives in the ONE shared home (§18):
// `resolveFunctionError` in @/lib/integrations/connectError — every connect/disconnect
// site on this page consumes it so a tenant never sees a raw framework code.

export default function EmailIntegrationConfig() {
  const { activeTenantId, activeUserId, loading: tenantLoading, accountContextLoading, accountContextStatus } = useTenantContext();
  const scopeReady = Boolean(activeTenantId && activeUserId && !tenantLoading && !accountContextLoading && accountContextStatus === "ready");
  const scope = useRef<EmailViewScope>({ tenantId: activeTenantId, actorId: activeUserId, ready: scopeReady, epoch: 0 });
  if (scope.current.tenantId !== activeTenantId || scope.current.actorId !== activeUserId || scope.current.ready !== scopeReady) {
    scope.current = { tenantId: activeTenantId, actorId: activeUserId, ready: scopeReady, epoch: scope.current.epoch + 1 };
  }
  const renderedScope = scope.current;
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; lifecycle.current += 1; };
  }, []);
  const current = useCallback((ticket: EmailViewScope, life: number) => mounted.current && lifecycle.current === life
    && ticket.ready && scope.current.epoch === ticket.epoch, []);
  const [gmail, setGmail] = useState<GmailConnector | null>(null);
  const [smtp, setSmtp] = useState<SmtpConnector | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedEpoch, setLoadedEpoch] = useState<number | null>(null);
  const [gmailReadError, setGmailReadError] = useState(false);
  const [smtpReadError, setSmtpReadError] = useState(false);
  const [gmailBusy, setGmailBusy] = useState(false);
  // Honest inline note when the OAuth flow isn't switched on yet (§13/§31) — never a
  // silent failure behind the Connect button.
  const [gmailNote, setGmailNote] = useState<string | null>(null);

  // SMTP inline form (#141c) — the A2PTab Input+Label pattern. Password is type=password.
  const [smtpBusy, setSmtpBusy] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpError, setSmtpError] = useState<string | null>(null);

  const loadGmail = useCallback(async () => {
    const ticket = renderedScope; const life = lifecycle.current;
    if (!current(ticket, life)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    try {
      // RLS may legitimately expose several tenants to platform staff. The existing
      // workspace context narrows this view; it never grants endpoint authority.
      const { data, error } = await sb.from("channel_connectors")
        .select("id, tenant_id, updated_at, from_address, display_name")
        .eq("tenant_id", ticket.tenantId).eq("channel_type", "email").eq("provider", "gmail")
        .eq("active", true).eq("status", "active")
        .order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(1);
      if (!current(ticket, life)) return;
      const row = Array.isArray(data) ? data[0] as GmailConnector | undefined : undefined;
      const refused = Boolean(error || !Array.isArray(data) || data.length > 1 || row && row.tenant_id !== ticket.tenantId);
      setGmail(refused ? null : row ?? null); setGmailReadError(refused);
    } catch {
      if (current(ticket, life)) { setGmail(null); setGmailReadError(true); }
    }
  }, [renderedScope, current]);

  const loadSmtp = useCallback(async () => {
    const ticket = renderedScope; const life = lifecycle.current;
    if (!current(ticket, life)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    try {
      const { data, error } = await sb.from("channel_connectors")
        .select("tenant_id, from_address, display_name")
        .eq("tenant_id", ticket.tenantId).eq("channel_type", "email").eq("provider", "smtp")
        .eq("active", true).eq("status", "active").maybeSingle();
      if (!current(ticket, life)) return;
      const row = data as SmtpConnector | null;
      const refused = Boolean(error || row && row.tenant_id !== ticket.tenantId);
      setSmtp(refused ? null : row); setSmtpReadError(refused);
    } catch {
      if (current(ticket, life)) { setSmtp(null); setSmtpReadError(true); }
    }
  }, [renderedScope, current]);

  useEffect(() => {
    const ticket = renderedScope; const life = lifecycle.current;
    setGmail(null); setSmtp(null); setLoadedEpoch(null); setGmailBusy(false);
    setGmailReadError(false); setSmtpReadError(false); setGmailNote(null);
    if (!current(ticket, life)) { setLoading(false); return; }
    setLoading(true);
    void (async () => {
      await Promise.all([loadGmail(), loadSmtp()]);
      if (current(ticket, life)) { setLoadedEpoch(ticket.epoch); setLoading(false); }
    })();
  }, [renderedScope, current, loadGmail, loadSmtp]);

  const viewCurrent = scopeReady && loadedEpoch === renderedScope.epoch;
  const viewLoading = tenantLoading || accountContextLoading || scopeReady && (loading || !viewCurrent);
  const visibleGmail = viewCurrent ? gmail : null;
  const visibleSmtp = viewCurrent ? smtp : null;
  const gmailConnected = Boolean(visibleGmail?.from_address);
  const smtpConnected = Boolean(visibleSmtp?.from_address);

  // §36: a non-technical coach clicks "Connect Gmail" and signs in — no prompt-engineering.
  // On {error:'gmail_oauth_not_configured'} we show an honest note, never a dead redirect.
  const connectGmail = async () => {
    setGmailBusy(true);
    setGmailNote(null);
    const { data, error } = await supabase.functions.invoke("gmail-oauth-start", {
      body: { origin: window.location.origin },
    });
    const url = (data as { authorization_url?: string } | null)?.authorization_url;
    if (error || !url) {
      setGmailBusy(false);
      const { code, message } = await resolveFunctionError({ error, data, action: "connect Gmail" });
      // Not switched on yet → an honest inline note, never a red error toast (§13/§36).
      if (code === "gmail_oauth_not_configured") {
        setGmailNote(message);
      } else {
        toast.error(message);
      }
      return;
    }
    window.location.href = url; // redirect to Google — busy stays true through navigation
  };

  const disconnectGmail = async () => {
    const ticket = renderedScope; const life = lifecycle.current;
    if (!current(ticket, life) || !viewCurrent) return;
    const selected = visibleGmail;
    if (!selected?.id || selected.tenant_id !== ticket.tenantId || !selected.updated_at || !Number.isFinite(Date.parse(selected.updated_at))) {
      toast.error("Refresh the Google connection before disconnecting it.");
      return;
    }
    setGmailBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-disconnect", { body: {
        expected_tenant_id: ticket.tenantId, connector_id: selected.id, expected_updated_at: selected.updated_at,
      } });
      if (!current(ticket, life)) return;
      if (error || (data as { error?: string } | null)?.error) {
        const failure = await resolveFunctionError({ error, data, action: "disconnect Gmail" });
        if (current(ticket, life)) toast.error(failure.message);
        return;
      }
      if (data?.ok !== true || data.disconnected !== true || data.connector_id !== selected.id) {
        toast.error("The Google disconnect could not be confirmed. Inspect the connection before retrying.");
        return;
      }
      toast.success("Gmail disconnected");
      setGmail(null);
      await loadGmail();
    } catch {
      if (current(ticket, life)) toast.error("The Google disconnect could not be confirmed. Inspect the connection before retrying.");
    } finally { if (current(ticket, life)) setGmailBusy(false); }
  };

  // #141c: a coach fills host/port/user/pass/from and it just connects (§36). smtp-connect
  // SSRF-guards + reachability-tests before provisioning; on failure we show an honest inline
  // message keyed to the returned code (§13/§31) — never a silent fail behind the button.
  const connectSmtp = async () => {
    setSmtpError(null);
    const portNum = Number(smtpPort);
    if (!smtpHost.trim() || !Number.isFinite(portNum) || !smtpUser || !smtpPass || !smtpFrom.trim()) {
      setSmtpError("Fill in the server, port, username, password, and from-address.");
      return;
    }
    setSmtpBusy(true);
    const { data, error } = await supabase.functions.invoke("smtp-connect", {
      body: {
        host: smtpHost.trim(),
        port: portNum,
        secure: portNum === 465,
        username: smtpUser,
        password: smtpPass,
        from_address: smtpFrom.trim(),
      },
    });
    setSmtpBusy(false);
    if (error || (data as { error?: string } | null)?.error) {
      setSmtpError((await resolveFunctionError({ error, data, action: "connect your SMTP server" })).message);
      return;
    }
    // §13 honest: connect proves the server is REACHABLE (TCP/TLS handshake), not that the
    // username/password authenticate — denomailer exposes no AUTH-only probe. So don't claim
    // "connected"; credentials are confirmed on the first real send.
    toast.success("SMTP saved — we'll confirm delivery on your first send.");
    // Clear the password from state the moment it's stored server-side; keep host/from for context.
    setSmtpPass("");
    void loadSmtp();
  };

  const disconnectSmtp = async () => {
    setSmtpBusy(true);
    const { data, error } = await supabase.functions.invoke("smtp-disconnect", { body: {} });
    setSmtpBusy(false);
    if (error || (data as { error?: string } | null)?.error) {
      toast.error((await resolveFunctionError({ error, data, action: "disconnect SMTP" })).message);
      return;
    }
    toast.success("SMTP disconnected");
    setSmtp(null);
    setSmtpHost("");
    setSmtpUser("");
    setSmtpFrom("");
    setSmtpPort("587");
    void loadSmtp();
  };

  return (
    <PageShell width="wide">
      <PageHeader
        variant="plain"
        icon={Mail}
        title="Email"
        description="Your included Paige addresses live here. Paige shows when each one is ready; your own domain or mailbox remains optional."
        backHref="/choose-account"
      />

      <TenantDomainIdentityCard />

      {/* The domain-verify mechanism — REUSED, not rebuilt (§18). */}
      <details className="group rounded-xl border border-border/70 bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">Use your own email domain</h2>
            <p className="text-xs text-muted-foreground">Optional branding with guided SPF, DKIM, and DMARC verification.</p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border/60 p-4">
          <EmailDomainsPanel />
        </div>
      </details>

      {/* Additional connect methods — Gmail OAuth + bring-your-own SMTP. Real state, no dead buttons (§13). */}
      <details className="group rounded-xl border border-border/70 bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">Connect an existing mailbox</h2>
            <p className="text-xs text-muted-foreground">Optional Gmail, Google Workspace, or SMTP connection.</p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-border/60 p-4 md:grid-cols-2">
          <SectionCard
            icon={Mail}
            title="Gmail / Google Workspace"
            description="Connect your Google inbox with OAuth."
            actions={
              viewLoading ? (
                <Skeleton className="h-5 w-24 rounded-full" />
              ) : !scopeReady || gmailReadError ? (
                <StatePill state="off">Unavailable</StatePill>
              ) : gmailConnected ? (
                <StatePill state="success">Connected</StatePill>
              ) : (
                <StatePill state="off">Not connected</StatePill>
              )
            }
          >
            {viewLoading ? (
              <Skeleton className="h-4 w-64" />
            ) : !scopeReady ? (
              <p role="status">Choose or refresh your workspace to manage this connection.</p>
            ) : gmailReadError ? (
              <p role="status">The Google connection could not be read. Refresh this workspace before changing it.</p>
            ) : gmailConnected ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Paige sends as{" "}
                  <span className="font-medium text-foreground">{visibleGmail?.from_address}</span> through your
                  Google account — no DNS setup needed.
                </p>
                <Button variant="outline" size="sm" onClick={() => void disconnectGmail()} disabled={gmailBusy}>
                  {gmailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Sign in with Google to send from your existing Gmail or Workspace address — no DNS setup.
                </p>
                <Button variant="gold" size="sm" onClick={() => void connectGmail()} disabled={gmailBusy}>
                  {gmailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
                  Connect Gmail
                </Button>
                {gmailNote && (
                  <p className="text-sm text-[hsl(var(--warning))]">{gmailNote}</p>
                )}
              </div>
            )}
          </SectionCard>

          {/* SMTP — bring your own mail server (#141c). Connected → Disconnect; else an inline form. */}
          <SectionCard
            icon={KeyRound}
            title="SMTP"
            description="Bring your own SMTP mail server."
            actions={
              viewLoading ? (
                <Skeleton className="h-5 w-24 rounded-full" />
              ) : !scopeReady || smtpReadError ? (
                <StatePill state="off">Unavailable</StatePill>
              ) : smtpConnected ? (
                <StatePill state="success">Connected</StatePill>
              ) : (
                <StatePill state="off">Not connected</StatePill>
              )
            }
          >
            {viewLoading ? (
              <Skeleton className="h-4 w-64" />
            ) : !scopeReady ? (
              <p role="status">Choose or refresh your workspace to manage this connection.</p>
            ) : smtpReadError ? (
              <p role="status">The SMTP connection could not be read. Refresh this workspace before changing it.</p>
            ) : smtpConnected ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Paige sends as{" "}
                  <span className="font-medium text-foreground">{visibleSmtp?.from_address}</span> through your
                  SMTP server. Your credentials are stored encrypted — never shown again. We confirm the
                  username and password on your first send.
                </p>
                <Button variant="outline" size="sm" onClick={() => void disconnectSmtp()} disabled={smtpBusy}>
                  {smtpBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Point Paige at any SMTP host with your server, port, and login to send from an existing
                  mailbox — no DNS setup.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="smtp-host">SMTP server</Label>
                    <Input
                      id="smtp-host"
                      value={smtpHost}
                      placeholder="smtp.yourprovider.com"
                      autoComplete="off"
                      onChange={(e) => setSmtpHost(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-port">Port</Label>
                    <Input
                      id="smtp-port"
                      value={smtpPort}
                      inputMode="numeric"
                      placeholder="587"
                      onChange={(e) => setSmtpPort(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-from">From address</Label>
                    <Input
                      id="smtp-from"
                      value={smtpFrom}
                      type="email"
                      placeholder="you@yourdomain.com"
                      autoComplete="off"
                      onChange={(e) => setSmtpFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-user">Username</Label>
                    <Input
                      id="smtp-user"
                      value={smtpUser}
                      placeholder="you@yourdomain.com"
                      autoComplete="off"
                      onChange={(e) => setSmtpUser(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-pass">Password</Label>
                    <Input
                      id="smtp-pass"
                      value={smtpPass}
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      onChange={(e) => setSmtpPass(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use ports 465 (SSL), 587, 25, or 2525. Your login is stored encrypted and used only to
                  send on your behalf.
                </p>
                {smtpError && <p className="text-sm text-destructive">{smtpError}</p>}
                {/* GOLD — the one act on this card: connect the server (§11). */}
                <Button variant="gold" size="sm" onClick={() => void connectSmtp()} disabled={smtpBusy}>
                  {smtpBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
                  Connect SMTP
                </Button>
              </div>
            )}
          </SectionCard>
        </div>
      </details>
    </PageShell>
  );
}
