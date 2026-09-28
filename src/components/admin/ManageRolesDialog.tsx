import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Crown, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";

// The roles a member can be granted here. Mirrors ASSIGNABLE_ROLES in MembersAdmin.
// super_admin / platform_admin are intentionally absent — never grantable from this surface. So is
// coach: it is a title a business gives its people, never a role anyone is granted.
const EDITABLE_ROLES = ["admin", "sales_rep", "broker", "cs_rep", "finance", "viewer"] as const;
type EditableRole = typeof EDITABLE_ROLES[number];

// Staff roles that keep a member visible in Members & Roles (mirrors isStaffRow).
const STAFF_ROLE_SET = new Set<string>([
  "admin", "sales_rep", "broker", "broker_team_member", "affiliate",
  "cs_rep", "finance", "viewer", "moderator", "owner", "super_admin",
]);

const roleColor: Record<string, string> = {
  admin: "bg-red-500/15 text-red-700 dark:text-red-300",
  sales_rep: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  broker: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  cs_rep: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  finance: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  viewer: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  owner: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
};

// Exported (§18 one home) so tenant-scoped role legends elsewhere (e.g. the Solo
// Setup › People roles legend) reuse the SAME copy instead of forking it.
export const ROLE_LABEL: Record<EditableRole, string> = {
  admin: "Admin", sales_rep: "Sales Rep", broker: "Broker",
  cs_rep: "Customer Success", finance: "Finance", viewer: "Viewer",
};

export const ROLE_BLURB: Record<EditableRole, string> = {
  admin: "Runs the whole account — settings, billing, and the team.",
  sales_rep: "Works the pipeline and closes new business.",
  broker: "Brings deals in and manages their book of referrals.",
  cs_rep: "Keeps clients happy and handles day-to-day support.",
  finance: "Owns invoices, payments, and the money view.",
  viewer: "Looks, doesn't touch — read-only across the account.",
};

export interface ManageRolesMember {
  user_id: string;
  email: string | null;
  full_name: string | null;
  roles: string[];
  // #227 G1: the PER-TENANT owner (tenant_members.is_owner for the active tenant). The
  // platform-owner signal is derived from roles.includes("super_admin") — no separate field.
  tenant_is_owner: boolean;
}

interface Props {
  member: ManageRolesMember | null;
  currentUserId: string | null;
  tenantId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
  onNeedsCoachReassign: (userId: string, label: string) => void;
}

export function ManageRolesDialog({
  member, currentUserId, tenantId, open, onOpenChange, onSaved, onNeedsCoachReassign,
}: Props) {
  const [baseline, setBaseline] = useState<Record<string, boolean>>({});
  const [staged, setStaged] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const isSelf = !!member && member.user_id === currentUserId;
  // #227 G1: split the ownership signal. The per-tenant owner keeps their admin lock;
  // the platform owner (super_admin, who may not be a tenant member) stays shielded too.
  const isTenantOwner = member?.tenant_is_owner ?? false;
  const isPlatformOwner = member?.roles.includes("super_admin") ?? false;
  const isProtectedOwner = isTenantOwner || isPlatformOwner;

  // Capture baseline from the member's roles whenever the dialog opens on a member.
  useEffect(() => {
    if (!member) return;
    const base: Record<string, boolean> = {};
    EDITABLE_ROLES.forEach((r) => { base[r] = member.roles.includes(r); });
    setBaseline(base);
    setStaged(base);
  }, [member, open]);

  // The admin switch is locked ON when it would strip an owner's (per-tenant or platform)
  // or one's own admin.
  const adminLocked = (isProtectedOwner || isSelf) && baseline.admin;

  const diff = useMemo(() => {
    const toAdd: EditableRole[] = [];
    const toRemove: EditableRole[] = [];
    EDITABLE_ROLES.forEach((r) => {
      if (staged[r] && !baseline[r]) toAdd.push(r);
      if (!staged[r] && baseline[r]) toRemove.push(r);
    });
    return { toAdd, toRemove };
  }, [staged, baseline]);

  const pendingCount = diff.toAdd.length + diff.toRemove.length;

  // Would this save drop the member's last staff role (and they're not the owner)?
  const removesLastStaffRole = useMemo(() => {
    if (!member || member.tenant_is_owner || member.roles.includes("super_admin")) return false;
    const remaining = new Set(member.roles);
    diff.toRemove.forEach((r) => remaining.delete(r));
    diff.toAdd.forEach((r) => remaining.add(r));
    return ![...remaining].some((r) => STAFF_ROLE_SET.has(r));
  }, [member, diff]);

  const set = (role: EditableRole, on: boolean) =>
    setStaged((prev) => ({ ...prev, [role]: on }));

  const handleSave = async () => {
    if (!member || !tenantId || pendingCount === 0) return;

    if (removesLastStaffRole) {
      const ok = await confirm({
        title: "Remove their last staff role?",
        description: "They'll drop off Members & Roles and lose staff access. You can re-add a role later.",
        actionLabel: "Remove role",
        destructive: true,
      });
      if (!ok) return;
    }

    setSaving(true);
    const succeeded: { added: EditableRole[]; removed: EditableRole[] } = { added: [], removed: [] };
    let coachReassignNeeded = false;
    const failures: string[] = [];

    try {
      // Adds first, so a partial failure leaves the member with MORE access, not less.
      for (const role of diff.toAdd) {
        const { error } = await supabase.rpc("grant_tenant_member_role", {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- role widened to the RPC enum
          _user_id: member.user_id, _role: role as any, _tenant_id: tenantId,
        });
        if (error) failures.push(`Couldn't add ${ROLE_LABEL[role]} — ${error.message}`);
        else succeeded.added.push(role);
      }

      // Then removes, each through the guarded revoke RPC (never a client-side delete).
      for (const role of diff.toRemove) {
        const { data, error } = await supabase.rpc("revoke_tenant_member_role", {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- role widened to the RPC enum
          _user_id: member.user_id, _role: role as any, _tenant_id: tenantId,
        });
        if (error) {
          const msg = /(?:ROLE_CHANGE_FORBIDDEN|LAST_ADMIN):?\s*(.*)/i.exec(error.message)?.[1]
            || error.message;
          failures.push(`Couldn't remove ${ROLE_LABEL[role]} — ${msg}`);
          continue;
        }
        const res = data as { ok?: boolean; reason?: string } | null;
        if (res && res.ok === false && res.reason === "active_clients") {
          coachReassignNeeded = true; // they still have assigned clients — route to reassign
          continue;
        }
        succeeded.removed.push(role);
      }

      if (failures.length) {
        failures.forEach((f) => toast.error(f));
      }

      if (coachReassignNeeded) {
        onOpenChange(false);
        onNeedsCoachReassign(member.user_id, member.full_name || member.email || "Coach");
        toast.message("Reassign their clients first", {
          description: "Then re-open Manage roles.",
        });
      }

      if (succeeded.added.length || succeeded.removed.length) {
        const parts: string[] = [];
        if (succeeded.added.length) parts.push(`added ${succeeded.added.map((r) => ROLE_LABEL[r]).join(", ")}`);
        if (succeeded.removed.length) parts.push(`removed ${succeeded.removed.map((r) => ROLE_LABEL[r]).join(", ")}`);
        toast.success(parts.length ? `Roles updated — ${parts.join("; ")}` : "Roles updated");
      }

      onSaved();
      // Close only on a fully clean save; if anything failed or coach needs reassigning,
      // keep the dialog open so the actor sees the real state (unless we already closed above).
      if (!failures.length && !coachReassignNeeded) onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update roles");
    } finally {
      setSaving(false);
    }
  };

  if (!member) return null;

  return (
    <>
      {confirmDialog}
      <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage roles</DialogTitle>
          <DialogDescription>
            Give this person every role they actually run. Turn roles on or off, then save.
          </DialogDescription>
        </DialogHeader>

        {/* Identity strip — always know whose roles you're editing (self is the headline case). */}
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          {isProtectedOwner && <Crown className="w-4 h-4 text-yellow-500 shrink-0" />}
          <div className="min-w-0">
            <div className="font-medium truncate">{member.full_name || member.email || "—"}</div>
            {member.full_name && <div className="text-xs text-muted-foreground truncate">{member.email}</div>}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {isProtectedOwner && <Badge className={roleColor.owner}>Owner</Badge>}
            {isSelf && (
              <Badge variant="outline" className="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30">
                You
              </Badge>
            )}
          </div>
        </div>

        <TooltipProvider>
          <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
            {EDITABLE_ROLES.map((role) => {
              const on = !!staged[role];
              const wasOn = !!baseline[role];
              const changed = on !== wasOn;
              const locked = role === "admin" && adminLocked;
              return (
                <div
                  key={role}
                  className={`rounded-lg border p-3 flex items-start justify-between gap-3 ${
                    changed ? "border-l-2 border-l-indigo-500" : ""
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className={`mt-0.5 shrink-0 w-2.5 h-2.5 rounded-sm ${roleColor[role] || "bg-muted"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{ROLE_LABEL[role]}</span>
                        {changed && on && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Adding</span>
                        )}
                        {changed && !on && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Removing</span>
                        )}
                        {locked && <Lock className="w-3 h-3 text-muted-foreground" />}
                      </div>
                      <p className="text-sm text-muted-foreground leading-snug">{ROLE_BLURB[role]}</p>
                    </div>
                  </div>
                  {locked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <Switch checked disabled aria-label={`${ROLE_LABEL[role]} (locked on)`} />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isPlatformOwner
                          ? "The platform owner always keeps admin."
                          : isTenantOwner
                            ? "A workspace owner always keeps admin."
                            : "You can't remove your own admin access."}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Switch
                      checked={on}
                      disabled={saving}
                      onCheckedChange={(v) => set(role, v)}
                      aria-label={`Toggle ${ROLE_LABEL[role]}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </TooltipProvider>

        <p className="text-xs text-muted-foreground">
          {pendingCount === 0
            ? "No changes yet."
            : `${pendingCount} change${pendingCount === 1 ? "" : "s"} pending` +
              `${diff.toAdd.length ? ` — ${diff.toAdd.length} to add` : ""}` +
              `${diff.toRemove.length ? `${diff.toAdd.length ? "," : " —"} ${diff.toRemove.length} to remove` : ""}`}
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || pendingCount === 0}
            className="bg-[hsl(var(--gold))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--gold))]/90"
          >
            {saving ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>) : "Save roles"}
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  );
}
