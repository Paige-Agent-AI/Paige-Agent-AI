import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Send,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileSignature,
  LogIn,
  ShieldOff,
  PauseCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { callAdminAccountAction } from "@/lib/functions/adminAccountActions";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import { isLegacyInviteHeld, legacyInviteHeldText, readLegacyInviteSend } from "@/lib/portal/legacyInviteSend";
import {
  PORTAL_ACCESS_NOTE_MAX,
  PORTAL_ACCESS_REASONS_FOR,
  PORTAL_ACCESS_REASON_LABEL,
  portalAccessConfirmCopy,
  portalAccessRefusalCopy,
  portalAccessStateOf,
  setPortalAccess,
  type PortalAccessAction,
  type PortalAccessReason,
  type PortalAccessStateName,
} from "@/lib/client-portal-access";

type Invite = {
  id: string;
  email: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  created_via: string;
};

type Envelope = {
  id: string;
  envelope_id: string;
  envelope_type: string;
  status: string;
  sent_at: string;
  signed_at: string | null;
  completed_pdf_url: string | null;
};

export function ContactPortalPanel({
  contactId,
  email,
  linkedUserId,
  name,
}: {
  contactId: string;
  email: string | null;
  linkedUserId: string | null;
  /** How the confirm names the client. Optional for the older mounts. */
  name?: string | null;
}) {
  const { activeTenantId, activeUserId, activeTenant } = useTenantContext();
  // §60 tier lock (owner-ruled 2026-08-11): the consumer/client portal invite is a
  // solo + sub_account capability ONLY. An Agency manages sub-accounts, not a direct
  // consumer client book — this closes the portal-invite leak on the Agency tier.
  const { has: hasTierFeature } = useTierFeatures();
  const canInvitePortal = hasTierFeature("customer_portal_invite");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [busy, setBusy] = useState<"invite" | "revoke" | "agreement" | "signout" | "reset" | null>(null);
  // E09 Slice 7: which access change is being confirmed. "end" replaced the old account-deleting revoke;
  // "pause" is the gentler, reversible choice, and it is what switching a joined client OFF opens.
  const [confirmAccess, setConfirmAccess] = useState<PortalAccessAction | null>(null);
  const [accessReason, setAccessReason] = useState<PortalAccessReason | null>(null);
  const [accessNote, setAccessNote] = useState("");
  const [confirmSignout, setConfirmSignout] = useState(false);
  const [localLinkedUserId, setLocalLinkedUserId] = useState<string | null>(linkedUserId);
  const [accessState, setAccessState] = useState<PortalAccessStateName>("open");
  const [accessChangedAt, setAccessChangedAt] = useState<string | null>(null);
  const clientName = name?.trim() || "this client";
  const businessName = activeTenant?.name?.trim() || "your business";

  useEffect(() => { setLocalLinkedUserId(linkedUserId); }, [linkedUserId]);

  const load = async () => {
    // Invites are now bound to this contact at mint (tenant_invite_tokens.contact_id),
    // so the outstanding/pending state is real: read this contact's consumer tokens.
    const [{ data: toks }, { data: env }, accessRead] = await Promise.all([
      supabase
        .from("tenant_invite_tokens")
        .select("id, email, expires_at, last_used_at, created_at, revoked_at")
        .eq("contact_id", contactId)
        .eq("kind", "consumer")
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("paige_signature_envelopes")
        .select("*")
        .eq("contact_id", contactId)
        .order("sent_at", { ascending: false }),
      // Authoritative linked-user state, re-read on every load() (§13). The prop only
      // SEEDS the initial render; a revoke/accept that happened while this panel was
      // unmounted — e.g. collapsed in the Conversations fold-out (#121), where the
      // accordion unmounts closed content — would otherwise leave a stale snapshot on
      // remount (reporting a revoked account as active, or missing a fresh acceptance).
      supabase.from("clients").select("linked_user_id, portal_access_state, portal_access_changed_at").eq("id", contactId).maybeSingle(),
    ]);
    // The access columns arrive with migration 20271111010000 (the generated types do not know them
    // yet). Until it is applied that read fails, so fall back to the link alone rather than showing a
    // joined client as having no access.
    const client = accessRead.error
      ? (await supabase.from("clients").select("linked_user_id").eq("id", contactId).maybeSingle()).data
      : accessRead.data;
    const row = client as unknown as { linked_user_id: string | null; portal_access_state?: string | null; portal_access_changed_at?: string | null } | null;
    setLocalLinkedUserId(row?.linked_user_id ?? null);
    setAccessState(portalAccessStateOf(row?.portal_access_state));
    setAccessChangedAt(row?.portal_access_changed_at ?? null);
    setInvites(
      ((toks as Array<{ id: string; email: string | null; expires_at: string; last_used_at: string | null; created_at: string }>) || []).map((t) => ({
        id: t.id,
        email: t.email ?? email ?? "",
        expires_at: t.expires_at,
        used_at: t.last_used_at,
        created_at: t.created_at,
        created_via: "portal_invite",
      })),
    );
    setEnvelopes((env as Envelope[]) || []);
    return row;
  };

  useEffect(() => { load(); }, [contactId]);

  // Live: mint a consumer invite token BOUND to this contact + email, email the
  // customer a tenant-branded link to their portal, and copy the link as a
  // fallback. On accept, accept_tenant_invite links them to THIS exact contact
  // (via the bound contact_id), and the token can only ever email this address.
  const sendInvite = async () => {
    // §60: portal-invite is solo + sub_account only — hard-guard the action too,
    // not just the UI, so a stale/hidden trigger can never mint a consumer token.
    if (!canInvitePortal) return;
    if (!email) return toast.error("Contact needs an email address first");
    if (!activeTenantId) return toast.error("No active workspace to invite into");
    setBusy("invite");
    try {
      const { data: tokRes, error: mintErr } = await supabase.rpc("create_tenant_invite_token", {
        _tenant_id: activeTenantId,
        _kind: "consumer",
        _default_role: "member",
        _expires_in_days: 30,
        _max_uses: null,
        _contact_id: contactId,
        _email: email,
      });
      if (mintErr) throw mintErr;
      const row = Array.isArray(tokRes) ? tokRes[0] : tokRes;
      const token = (row as { token?: string } | null)?.token;
      if (!token) throw new Error("Could not create the invite");

      const joinUrl = `${window.location.origin}/join/${token}`;
      const { data: sent, error: sendError } = await supabase.functions.invoke("send-portal-invite", {
        body: { token, email },
      });
      const outcome = await readLegacyInviteSend(sent, sendError);
      // E09 Slice 6 (§37): Paige held it, or could not check. No link is copied and none is offered: a
      // link sent some other way would go around the client's choice. The server revoked the token it was
      // handed, so the reload below shows nothing pending.
      if (isLegacyInviteHeld(outcome)) {
        toast.error(legacyInviteHeldText(email, outcome));
        await load();
        return;
      }
      try { await navigator.clipboard.writeText(joinUrl); } catch { /* clipboard optional */ }
      toast.success(outcome === "emailed" ? `Invite emailed to ${email} — link also copied` : `Invite link copied — send it to ${email}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the invite");
    } finally {
      setBusy(null);
    }
  };

  const cancelPendingInvites = async () => {
    // Revoke every outstanding (unaccepted, non-revoked) consumer token for this
    // contact so the /join link stops working.
    setBusy("invite");
    try {
      const { error } = await supabase
        .from("tenant_invite_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("contact_id", contactId)
        .eq("kind", "consumer")
        .is("revoked_at", null)
        .is("last_used_at", null);
      if (error) throw error;
      toast.success("Pending invite canceled");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel the invite");
    } finally {
      setBusy(null);
    }
  };


  // E09 Slice 7, D10 (§58 call-out): turning access OFF for a joined client used to call
  // `admin-delete-user`, which unlinked the person from EVERY business and deleted their login. It now
  // pauses (or, by choice, ends) THIS business's access through the tenant-scoped seam, keeps the login
  // and every other business untouched. Restore gives a paused client back; an ended one needs a new
  // invitation. Pause is here for every tier this panel mounts on (§60/§61: customer_portal_invite —
  // Solo, Sub-account, Enterprise), not only on the Solo client record.
  const openConfirm = (action: PortalAccessAction) => { setAccessReason(null); setAccessNote(""); setConfirmAccess(action); };
  const changeAccess = async (action: PortalAccessAction) => {
    if (!localLinkedUserId || !activeTenantId) return;
    if (action !== "restore" && !accessReason) return;
    setBusy("revoke");
    try {
      const session = await supabase.auth.getSession();
      const actorId = session.data.session?.user.id ?? null;
      if (session.error || !actorId || (activeUserId && actorId !== activeUserId)) {
        toast.error(portalAccessRefusalCopy("SCOPE_CHANGED", clientName));
        return;
      }
      const result = await setPortalAccess({
        actorId, tenantId: activeTenantId, contactId, action,
        reason: action === "restore" ? null : accessReason, note: action === "restore" ? null : accessNote,
        expectedChangedAt: accessChangedAt,
      });
      // Success is what a fresh read says, not what the writer acknowledged (§70.1).
      const fresh = await load();
      const now = portalAccessStateOf(fresh?.portal_access_state);
      const expected: PortalAccessStateName = action === "end" ? "ended" : action === "pause" ? "paused" : "open";
      if (result.ok && now === expected) {
        // Precise: End removes this business's coach assignment rows, so "untouched" is said of the login only.
        toast.success(action === "end" ? "Portal access ended. Their login is untouched and their history stays on this contact."
          : action === "pause" ? "Portal access paused. You can restore it later."
            : "Portal access restored.");
        setConfirmAccess(null);
        setAccessReason(null);
        setAccessNote("");
        return;
      }
      toast.error(result.ok || !result.code ? portalAccessRefusalCopy("UNCONFIRMED", clientName)
        : portalAccessRefusalCopy(result.code, clientName, result.restoreBlockedBy));
      if (result.code === "ACCESS_CHANGED") setConfirmAccess(null);
    } catch {
      toast.error(portalAccessRefusalCopy("UNCONFIRMED", clientName));
    } finally {
      setBusy(null);
    }
  };

  const runAccountAction = async (action: "signout_all" | "password_reset") => {
    if (!localLinkedUserId) return;
    const key = action === "signout_all" ? "signout" : "reset";
    setBusy(key);
    try {
      const data = await callAdminAccountAction(action, localLinkedUserId);
      const actionErr = (data as { error?: string } | null)?.error;
      if (actionErr) throw new Error(actionErr);
      toast.success(
        action === "signout_all"
          ? "Client signed out of all devices"
          : "Password reset email sent",
      );
      if (action === "signout_all") setConfirmSignout(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const latestInvite = invites[0];
  const inviteStatus = latestInvite
    ? latestInvite.used_at ? "accepted"
    : new Date(latestInvite.expires_at) < new Date() ? "expired"
    : "pending"
    : "none";

  const paused = Boolean(localLinkedUserId) && accessState === "paused";
  const ended = !localLinkedUserId && accessState === "ended";
  const hasAccess = Boolean(localLinkedUserId) && !paused;

  // §60 tier lock: the whole consumer-portal panel (invite + agreements + access
  // controls) is a solo + sub_account capability. An Agency/Enterprise/God tier
  // never sees it — the panel is entirely about a direct consumer client book.
  if (!canInvitePortal) return null;

  return (
    <div className="space-y-3">
      {/* Paige AI Platform Access — explicit grant/revoke switch */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <LogIn className="h-4 w-4" /> Paige AI Platform Access
          </CardTitle>
          {hasAccess ? (
            // One family of state chips (outline, ink text). The filled primary chip measured 3.41:1 in dark.
            <Badge variant="outline" className="gap-1 text-foreground"><CheckCircle2 className="h-3 w-3 text-[hsl(var(--success))]" /> Active</Badge>
          ) : paused ? (
            // Ink and a dashed edge, never the warning hue: beside the gold Restore it read as a second gold.
            <Badge variant="outline" className="gap-1 border-dashed text-foreground"><PauseCircle className="h-3 w-3" /> Access paused</Badge>
          ) : inviteStatus === "pending" ? (
            <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Invite pending</Badge>
          ) : ended ? (
            <Badge variant="outline" className="gap-1"><ShieldOff className="h-3 w-3" /> Access ended</Badge>
          ) : inviteStatus === "expired" ? (
            <Badge variant="outline" className="gap-1 text-amber-600"><AlertCircle className="h-3 w-3" /> Expired</Badge>
          ) : (
            <Badge variant="outline">No access</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Grant client-side Paige access</div>
              <div className="text-xs text-muted-foreground">
                When ON, this contact gets their own scoped workspace and can only see <strong>their own</strong> account, businesses, documents, and Paige conversations. Staff continue to see this contact through the admin workspace.
              </div>
            </div>
            <Switch
              // 44px hit area on touch around the drawn track; the track itself is unchanged.
              className="relative shrink-0 before:absolute before:-inset-x-[5px] before:-inset-y-[14px] before:content-['']"
              checked={hasAccess || inviteStatus === "pending"}
              disabled={!email || busy !== null}
              onCheckedChange={(next) => {
                if (next && paused) {
                  openConfirm("restore");
                } else if (next) {
                  sendInvite();
                } else if (hasAccess) {
                  openConfirm("pause");
                } else if (inviteStatus === "pending") {
                  cancelPendingInvites();
                }
              }}
              aria-label="Toggle Paige AI platform access"
            />
          </div>

          {localLinkedUserId ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {paused
                  ? "This client’s portal access is paused. They’ll see that it’s paused the next time they open your portal. Restore it to give it back."
                  : "This client signed in and is connected to their workspace. Use the controls below if they're stuck or need help."}
              </div>
              {/* 44px tap targets on a phone (in px: this workspace's root type is 14px, so rem units fall
                  short); the desktop row keeps the compact size. */}
              <div className="flex flex-wrap items-center gap-2 [&>button]:min-h-[44px] sm:[&>button]:min-h-9">
                {paused && (
                  <Button size="sm" variant="gold" onClick={() => openConfirm("restore")} disabled={busy !== null}>
                    <RefreshCw className="h-3.5 w-3.5 mr-2" />
                    Restore access
                  </Button>
                )}
                {hasAccess && (
                  <Button size="sm" variant="outline" onClick={() => openConfirm("pause")} disabled={busy !== null}>
                    <PauseCircle className="h-3.5 w-3.5 mr-2" />
                    Pause access
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => openConfirm("end")} disabled={busy !== null}
                  className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <ShieldOff className="h-3.5 w-3.5 mr-2" />
                  End access
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmSignout(true)}
                  disabled={busy !== null}
                >
                  <LogIn className="h-3.5 w-3.5 mr-2 rotate-180" />
                  {busy === "signout" ? "Signing out…" : "Force sign out"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runAccountAction("password_reset")}
                  disabled={busy !== null || !email}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  {busy === "reset" ? "Sending…" : "Send password reset"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 [&>button]:min-h-[44px] sm:[&>button]:min-h-9">
              <Button
                size="sm"
                variant="outline"
                onClick={sendInvite}
                disabled={!email || busy === "invite"}
              >
                {latestInvite ? <RefreshCw className="h-3.5 w-3.5 mr-2" /> : <Send className="h-3.5 w-3.5 mr-2" />}
                {busy === "invite" ? "Sending…" : latestInvite ? "Resend invite" : "Send invite"}
              </Button>
              {!email && <span className="text-xs text-muted-foreground">Add an email to send.</span>}
            </div>
          )}

          {invites.length > 0 && (
            <div className="border-t pt-3">
              <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Invite history</div>
              <div className="space-y-1.5">
                {invites.slice(0, 5).map(inv => (
                  <div key={inv.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {inv.email} · sent {formatDistanceToNow(new Date(inv.created_at), { addSuffix: true })}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {inv.used_at ? "accepted" : new Date(inv.expires_at) < new Date() ? "expired" : "pending"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agreements */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileSignature className="h-4 w-4" /> Agreements
          </CardTitle>
          <Badge variant="secondary">{envelopes.length}</Badge>
        </CardHeader>
        <CardContent>
          {envelopes.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No agreements sent yet.
            </div>
          ) : (
            <div className="space-y-2">
              {envelopes.map(e => (
                <div key={e.id} className="flex items-center justify-between border border-border rounded p-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium capitalize">{e.envelope_type.replace("_", " ")}</div>
                    <div className="text-xs text-muted-foreground">
                      Sent {formatDistanceToNow(new Date(e.sent_at), { addSuffix: true })}
                      {e.signed_at && <> · Signed {formatDistanceToNow(new Date(e.signed_at), { addSuffix: true })}</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={e.status === "completed" ? "default" : "secondary"} className="text-[10px] capitalize">
                      {e.status}
                    </Badge>
                    {e.completed_pdf_url && (
                      <Button variant="ghost" size="sm" className="h-7" onClick={() => window.open(e.completed_pdf_url!, "_blank")}>
                        View PDF
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmAccess !== null} onOpenChange={(open) => { if (!open) setConfirmAccess(null); }}>
        <AlertDialogContent>
          {confirmAccess && (() => {
            const copy = portalAccessConfirmCopy(confirmAccess, clientName, businessName);
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    {confirmAccess === "pause" ? <PauseCircle className="h-4 w-4 text-muted-foreground" />
                      : confirmAccess === "restore" ? <RefreshCw className="h-4 w-4 text-muted-foreground" />
                        : <ShieldOff className="h-4 w-4 text-destructive" />}
                    {copy.title}
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <ul className="list-disc space-y-1 pl-4 text-left">{copy.lines.map((line) => <li key={line}>{line}</li>)}</ul>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {confirmAccess !== "restore" && (
                  <div className="space-y-3">
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">Reason <span className="font-normal text-muted-foreground">(only your team sees it)</span></legend>
                      <RadioGroup value={accessReason ?? ""} onValueChange={(value) => setAccessReason(value as PortalAccessReason)} aria-label="Reason">
                        {/* The whole row is the label, so the 44px row is the tap target, not the 16px dot. */}
                        {PORTAL_ACCESS_REASONS_FOR[confirmAccess].map((value) => (
                          <label key={value} htmlFor={`access-reason-${value}`} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm">
                            <RadioGroupItem id={`access-reason-${value}`} value={value} />
                            <span>{PORTAL_ACCESS_REASON_LABEL[value]}</span>
                          </label>
                        ))}
                      </RadioGroup>
                    </fieldset>
                    <div className="space-y-1">
                      <Label htmlFor="access-note">Note for your team <span className="font-normal text-muted-foreground">(optional)</span></Label>
                      <Textarea id="access-note" value={accessNote} maxLength={PORTAL_ACCESS_NOTE_MAX} rows={2}
                        onChange={(event) => setAccessNote(event.target.value.slice(0, PORTAL_ACCESS_NOTE_MAX))} />
                      <p className="text-xs text-muted-foreground">Only your team sees this. The client never does.</p>
                    </div>
                    {confirmAccess === "pause" && (
                      <p className="text-xs text-muted-foreground">
                        Want this to be permanent?{" "}
                        <button type="button" className="min-h-[44px] underline underline-offset-2 hover:text-foreground sm:min-h-0" onClick={() => openConfirm("end")}>End access instead</button>
                      </p>
                    )}
                  </div>
                )}
                <AlertDialogFooter className="[&>button]:min-h-[44px] sm:[&>button]:min-h-10">
                  <AlertDialogCancel disabled={busy === "revoke"}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => { e.preventDefault(); void changeAccess(confirmAccess); }}
                    disabled={busy === "revoke" || (confirmAccess !== "restore" && !accessReason)}
                    // Gold is spent on the one act that gives access back (§11), matching the record card.
                    // Pause is the inverse-ink "do it" control, as on the record card: the shared primary's
                    // dark-theme pairing measured 3.41:1, below AA, so this control does not use it.
                    className={confirmAccess === "end" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      : confirmAccess === "restore" ? buttonVariants({ variant: "gold" }) : "bg-foreground text-background hover:bg-foreground/90"}
                  >
                    {busy === "revoke" ? (confirmAccess === "end" ? "Ending…" : confirmAccess === "pause" ? "Pausing…" : "Restoring…") : copy.confirm}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmSignout} onOpenChange={setConfirmSignout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <LogIn className="h-4 w-4 rotate-180" />
              Force sign out this client?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This immediately invalidates every active session for this client across every device and browser. They'll need to sign in again. Use this when a customer reports they're stuck and can't sign out themselves. Their account, roles, and data are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "signout"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); runAccountAction("signout_all"); }}
              disabled={busy === "signout"}
            >
              {busy === "signout" ? "Signing out…" : "Force sign out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
