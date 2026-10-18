import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { callAdminAccountAction } from "@/lib/functions/adminAccountActions";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import { legacyInviteHeldText, readLegacyInviteSend } from "@/lib/portal/legacyInviteSend";

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
}: {
  contactId: string;
  email: string | null;
  linkedUserId: string | null;
}) {
  const { activeTenantId } = useTenantContext();
  // §60 tier lock (owner-ruled 2026-08-11): the consumer/client portal invite is a
  // solo + sub_account capability ONLY. An Agency manages sub-accounts, not a direct
  // consumer client book — this closes the portal-invite leak on the Agency tier.
  const { has: hasTierFeature } = useTierFeatures();
  const canInvitePortal = hasTierFeature("customer_portal_invite");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [busy, setBusy] = useState<"invite" | "revoke" | "agreement" | "signout" | "reset" | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmSignout, setConfirmSignout] = useState(false);
  const [localLinkedUserId, setLocalLinkedUserId] = useState<string | null>(linkedUserId);

  useEffect(() => { setLocalLinkedUserId(linkedUserId); }, [linkedUserId]);

  const load = async () => {
    // Invites are now bound to this contact at mint (tenant_invite_tokens.contact_id),
    // so the outstanding/pending state is real: read this contact's consumer tokens.
    const [{ data: toks }, { data: env }, { data: client }] = await Promise.all([
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
      supabase.from("clients").select("linked_user_id").eq("id", contactId).maybeSingle(),
    ]);
    setLocalLinkedUserId(
      (client as { linked_user_id: string | null } | null)?.linked_user_id ?? null,
    );
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
      // E09 Slice 6 (§37): the client can't be emailed. No link is copied and none is offered: a link
      // sent some other way would go around their choice.
      if (outcome === "held") {
        toast.error(legacyInviteHeldText(email));
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


  const revokeAccess = async () => {
    if (!localLinkedUserId) return;
    setBusy("revoke");
    try {
      // keep_contact: true — strips their auth login + roles but preserves CRM history
      const { data, error } = await supabase.functions.invoke("admin-delete-user", {
        body: { user_id: localLinkedUserId, keep_contact: true },
      });
      if (error) throw error;
      const revokeErr = (data as { error?: string } | null)?.error;
      if (revokeErr) throw new Error(revokeErr);
      toast.success("Paige access revoked. CRM history preserved.");
      setLocalLinkedUserId(null);
      setConfirmRevoke(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revoke failed");
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

  const hasAccess = Boolean(localLinkedUserId);

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
            <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Active</Badge>
          ) : inviteStatus === "pending" ? (
            <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Invite pending</Badge>
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
              checked={hasAccess || inviteStatus === "pending"}
              disabled={!email || busy !== null}
              onCheckedChange={(next) => {
                if (next) {
                  sendInvite();
                } else if (hasAccess) {
                  setConfirmRevoke(true);
                } else if (inviteStatus === "pending") {
                  cancelPendingInvites();
                }
              }}
              aria-label="Toggle Paige AI platform access"
            />
          </div>

          {hasAccess ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                This client signed in and is connected to their workspace. Use the controls below if they're stuck or need help.
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
            <div className="flex items-center gap-2">
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

      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-destructive" />
              Revoke Paige access?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes their login + any staff roles immediately. Their CRM history (deals, notes, documents, activities) stays intact under this contact. You can re-invite them anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "revoke"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); revokeAccess(); }}
              disabled={busy === "revoke"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy === "revoke" ? "Revoking…" : "Revoke access"}
            </AlertDialogAction>
          </AlertDialogFooter>
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
