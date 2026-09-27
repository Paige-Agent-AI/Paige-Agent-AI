/**
 * Workspace Settings — visible to tenant admins (and platform owner).
 *
 * Lets the workspace owner edit branding (name, logo URL, primary color,
 * from-name, support email) and mint a self-serve invite link that
 * consumers/members can use to join the workspace via /join/:token.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Copy, Link2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import { SubAccountsPanel } from "@/components/admin/SubAccountsPanel";
import { toast } from "sonner";

interface InviteRow {
  id: string;
  token: string;
  kind: string;
  default_role: string;
  expires_at: string;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
  created_at: string;
}

interface BrandState {
  name: string;
  logo_url: string;
  primary_color: string;
  from_name: string;
  support_email: string;
}

const EMPTY_BRAND: BrandState = {
  name: "",
  logo_url: "",
  primary_color: "#CFAE70",
  from_name: "",
  support_email: "",
};

export function WorkspaceSettingsPanel() {
  const { activeTenant, isPlatformOwner, refresh } = useTenantContext();
  // §60 tier lock (owner 2026-08-11): "Consumer signup" invites mint the SAME
  // consumer portal token as the 4 contact-surface senders — solo + sub_account
  // ONLY. On Agency/Enterprise/God the consumer option is hidden and the mint is
  // hard-guarded; the "Team member" invite (staff/coach) stays on every tier.
  const { has: hasTierFeature } = useTierFeatures();
  const canInvitePortal = hasTierFeature("customer_portal_invite");
  const tenantId = activeTenant?.id ?? null;

  const [brand, setBrand] = useState<BrandState>(EMPTY_BRAND);
  const [savingBrand, setSavingBrand] = useState(false);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [minting, setMinting] = useState(false);
  const [inviteKind, setInviteKind] = useState<"consumer" | "team">("consumer");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [expiresDays, setExpiresDays] = useState<number>(30);

  const isAdmin = isPlatformOwner || activeTenant !== null; // tenants RLS already gates UPDATE

  useEffect(() => {
    if (!activeTenant) return;
    const b = (activeTenant as { brand?: Partial<BrandState> } & typeof activeTenant)
      .brand as Partial<BrandState> | undefined;
    setBrand({
      name: activeTenant.name ?? "",
      logo_url: b?.logo_url ?? "",
      primary_color: b?.primary_color ?? "#CFAE70",
      from_name: b?.from_name ?? "",
      support_email: b?.support_email ?? "",
    });
  }, [activeTenant]);

  const loadInvites = useCallback(async () => {
    if (!tenantId) return;
    setLoadingInvites(true);
    try {
      const { data, error } = await supabase
        .from("tenant_invite_tokens")
        .select("id, token, kind, default_role, expires_at, max_uses, uses, revoked_at, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setInvites((data ?? []) as InviteRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load invites");
    } finally {
      setLoadingInvites(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  // §60: if this tier can't send consumer/portal invites, never leave the kind on
  // "consumer" (its option is hidden) — snap it to the always-available "team".
  useEffect(() => {
    if (!canInvitePortal) setInviteKind("team");
  }, [canInvitePortal]);

  const saveBrand = async () => {
    if (!tenantId) return;
    setSavingBrand(true);
    try {
      // The workspace NAME is a column and is still written directly.
      const { error } = await supabase
        .from("tenants")
        .update({ name: brand.name.trim() || "Untitled Workspace" })
        .eq("id", tenantId);
      if (error) throw error;

      // The BRAND is a jsonb document with more keys than this panel edits, so it
      // goes through `set_tenant_brand`, which merges (`brand || _patch`).
      //
      // This used to write the whole object with exactly these four keys, which
      // DELETED every other key on save — including `business_name`, `website`
      // and `business_phone`, the three fields `tenant_comms_readiness()` grades
      // for carrier registration. Saving workspace branding silently un-did the
      // business details someone had just filled in on Connections, and the
      // readiness ladder would drop back to "Partly filled in" with no visible
      // cause. A whole-object write to a shared document is a data-loss bug even
      // when every key it names is correct.
      const { error: brandError } = await supabase.rpc("set_tenant_brand" as never, {
        _tenant_id: tenantId,
        _patch: {
          logo_url: brand.logo_url || null,
          primary_color: brand.primary_color || null,
          from_name: brand.from_name || null,
          support_email: brand.support_email || null,
        },
      } as never);
      if (brandError) throw brandError;
      toast.success("Workspace branding saved");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingBrand(false);
    }
  };

  const mintInvite = async () => {
    if (!tenantId) return;
    // §60 hard-guard: never mint a consumer/portal invite on a tier that can't (the
    // UI hides the option, but guard the action too — UI is not the auth boundary).
    if (inviteKind === "consumer" && !canInvitePortal) {
      toast.error("Consumer/client invites aren't available on this account type.");
      return;
    }
    setMinting(true);
    try {
      const { data, error } = await supabase.rpc("create_tenant_invite_token", {
        _tenant_id: tenantId,
        _kind: inviteKind,
        _default_role: inviteRole,
        _expires_in_days: expiresDays,
        _max_uses: null,
      });
      if (error) throw error;
      toast.success("Invite link created");
      const tok = (data as { token?: string } | null)?.token;
      if (tok) {
        await navigator.clipboard.writeText(buildJoinUrl(tok)).catch(() => undefined);
        toast.message("Copied to clipboard");
      }
      await loadInvites();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setMinting(false);
    }
  };

  const revokeInvite = async (id: string) => {
    try {
      const { error } = await supabase
        .from("tenant_invite_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast.success("Invite revoked");
      await loadInvites();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke");
    }
  };

  if (!tenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>Pick a workspace to manage its settings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="w-4 h-4" /> Workspace branding
          </CardTitle>
          <CardDescription>
            Controls the name, color, and "from" identity shown to everyone in this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">Workspace name</Label>
              <Input
                id="ws-name"
                value={brand.name}
                onChange={(e) => setBrand((b) => ({ ...b, name: e.target.value }))}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-primary">Primary color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ws-primary"
                  type="color"
                  value={brand.primary_color || "#CFAE70"}
                  onChange={(e) => setBrand((b) => ({ ...b, primary_color: e.target.value }))}
                  className="w-16 h-10 p-1"
                  disabled={!isAdmin}
                />
                <Input
                  value={brand.primary_color}
                  onChange={(e) => setBrand((b) => ({ ...b, primary_color: e.target.value }))}
                  disabled={!isAdmin}
                />
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ws-logo">Logo URL</Label>
              <Input
                id="ws-logo"
                placeholder="https://…/logo.png"
                value={brand.logo_url}
                onChange={(e) => setBrand((b) => ({ ...b, logo_url: e.target.value }))}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-from">Email "From" name</Label>
              <Input
                id="ws-from"
                placeholder="Paige Agent AI"
                value={brand.from_name}
                onChange={(e) => setBrand((b) => ({ ...b, from_name: e.target.value }))}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-support">Support email</Label>
              <Input
                id="ws-support"
                type="email"
                placeholder="support@yourdomain.com"
                value={brand.support_email}
                onChange={(e) => setBrand((b) => ({ ...b, support_email: e.target.value }))}
                disabled={!isAdmin}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveBrand} disabled={savingBrand || !isAdmin}>
              {savingBrand ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save branding
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="w-4 h-4" /> Invite links
          </CardTitle>
          <CardDescription>
            Generate a link anyone can use to join this workspace.{" "}
            {canInvitePortal ? (
              <>Choose <strong>Consumer</strong> for client signups, or <strong>Team</strong> for staff and coaches.</>
            ) : (
              <>Invite <strong>Team</strong> members — staff and coaches.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={inviteKind} onValueChange={(v) => setInviteKind(v as "consumer" | "team")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {canInvitePortal && <SelectItem value="consumer">Consumer signup</SelectItem>}
                  <SelectItem value="team">Team member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Default role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "member" | "admin")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expires in (days)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={expiresDays}
                onChange={(e) => setExpiresDays(Number(e.target.value) || 30)}
              />
            </div>
            <Button onClick={mintInvite} disabled={minting}>
              {minting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Generate link
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Active links</h4>
              <Button variant="ghost" size="sm" onClick={loadInvites} disabled={loadingInvites}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingInvites ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3">No invite links yet.</p>
            ) : (
              <div className="space-y-2">
                {invites.map((inv) => (
                  <InviteRow key={inv.id} inv={inv} onRevoke={() => revokeInvite(inv.id)} />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Owner-only: create + manage child workspaces (renders null otherwise). */}
      <SubAccountsPanel />
    </div>
  );
}

function InviteRow({ inv, onRevoke }: { inv: InviteRow; onRevoke: () => void }) {
  const url = useMemo(() => buildJoinUrl(inv.token), [inv.token]);
  const status = inv.revoked_at
    ? "Revoked"
    : new Date(inv.expires_at) < new Date()
      ? "Expired"
      : inv.max_uses && inv.uses >= inv.max_uses
        ? "Used up"
        : "Active";

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs capitalize">{inv.kind}</Badge>
          <Badge variant="secondary" className="text-xs capitalize">{inv.default_role}</Badge>
          <Badge
            variant={status === "Active" ? "default" : "outline"}
            className="text-xs"
          >
            {status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {inv.uses}{inv.max_uses ? ` / ${inv.max_uses}` : ""} uses · expires{" "}
            {new Date(inv.expires_at).toLocaleDateString()}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate mt-1 font-mono">{url}</div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(url).then(
              () => toast.success("Copied"),
              () => toast.error("Copy failed"),
            );
          }}
        >
          <Copy className="w-3.5 h-3.5" />
        </Button>
        {!inv.revoked_at && (
          <Button variant="ghost" size="sm" onClick={onRevoke}>
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );
}

function buildJoinUrl(token: string) {
  if (typeof window === "undefined") return `/join/${token}`;
  return `${window.location.origin}/join/${token}`;
}
