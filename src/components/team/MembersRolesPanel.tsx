// Members & Roles — the ONE canonical tenant staff console (#616), living inside
// the Team floor (/admin/team). Consolidates the former MembersAdmin console +
// CoachesAdmin coach fields + ManageRolesDialog into this single admin-gated
// surface (§18 one home). The whole actionable console renders INSIDE
// RoleGate allow=["admin"] so a broadly-gated TeamHub can mount it without
// exposing admin-destructive controls to coach/sales_rep/viewer (§9/§51).
//
// Data: the roster arrives from useTeamRoster (parent). Pending invitations and
// coach-management fields are fetched HERE (useTeamRoster carries neither) and are
// gated behind isAdmin so a non-admin staffer never fires them (RoleGate gates
// render, not effects). Coach fields come through the gated get_tenant_coach_fields
// RPC (cross-user profile SELECT is own-row only), and the accepting quick-pill /
// drawer write through set_coach_fields (own-record-or-tenant-admin).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Users2, UserPlus, MoreHorizontal, Mail, Trash2, UserCog, ShieldOff, ShieldCheck,
  LogOut, UserMinus, Crown, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { SectionCard, SectionNote, FilterChip, StatePill } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoleGate } from "@/components/auth/RoleGate";
import { MemberProfileDrawer, type CoachFields } from "@/components/admin/MemberProfileDrawer";
import { InviteMemberDialog } from "@/components/admin/InviteMemberDialog";
import { ReassignCoachDialog } from "@/components/admin/ReassignCoachDialog";
import { ManageRolesDialog } from "@/components/admin/ManageRolesDialog";
import { isAvatarBucketUrl } from "@/components/ui/avatar-uploader";
import { useUserRoles } from "@/hooks/useUserRoles";
import { useTenantContext } from "@/hooks/useTenantContext";
import { GROUP_LABEL, GROUP_ORDER, groupForMember, roleLabel, type TeamGroup } from "@/lib/team/teamGroups";
import type { RosterMember } from "@/hooks/useTeamRoster";

// A "staff role" grants platform/workspace authority. Clients / no-role auth users
// live in Contacts, not here.
const STAFF_ROLES = ["admin", "sales_rep", "broker", "broker_team_member", "affiliate", "cs_rep", "finance", "viewer", "moderator", "owner", "super_admin"] as const;
const STAFF_ROLE_SET = new Set<string>(STAFF_ROLES);
// #227: roster visibility uses the per-tenant owner OR any global staff role (incl. the
// platform super_admin, which lives in the global roles set).
const isStaffRow = (m: RosterMember) => m.tenant_is_owner || m.roles.some((r) => STAFF_ROLE_SET.has(r));
// #227 destructive-action shield: a per-tenant owner OR the platform super_admin is never
// suspendable/revocable/deletable from a tenant surface (§9/§51). super_admin comes from the
// GLOBAL roles so a platform owner appearing in a roster read stays shielded.
const isShielded = (m: RosterMember) => m.tenant_is_owner || m.roles.includes("super_admin");

const ROLE_FILTERS = ["all", "owner", "admin", "sales_rep", "broker", "cs_rep", "finance", "viewer"] as const;
type RoleFilter = typeof ROLE_FILTERS[number];

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  last_status?: string | null;
  last_error?: string | null;
}

function initialsOf(m: RosterMember): string {
  const s = (m.full_name || m.email || "?").split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("");
  return s.toUpperCase() || "?";
}

export function MembersRolesPanel({
  members,
  loading,
  refresh,
  initialRoleFilter,
}: {
  members: RosterMember[];
  loading: boolean;
  refresh?: () => void;
  initialRoleFilter?: string | null;
}) {
  const { isAdmin } = useUserRoles();
  const { activeTenantId } = useTenantContext();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RoleFilter>(
    initialRoleFilter && (ROLE_FILTERS as readonly string[]).includes(initialRoleFilter)
      ? (initialRoleFilter as RoleFilter)
      : "all",
  );
  const [includeNonStaff, setIncludeNonStaff] = useState(false);

  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [coachFields, setCoachFields] = useState<Record<string, CoachFields>>({});
  // Who has clients assigned to them. "Coach" is a title, so serving clients is decided by
  // assignment, never by a role.
  const [servesClients, setServesClients] = useState<Set<string>>(new Set());

  // Dialog / drawer targets
  const [inviteOpen, setInviteOpen] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<RosterMember | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [manageRolesTarget, setManageRolesTarget] = useState<RosterMember | null>(null);
  const [reassignCoachId, setReassignCoachId] = useState<string | null>(null);
  const [reassignLabel, setReassignLabel] = useState<string | undefined>();
  const [removeTarget, setRemoveTarget] = useState<RosterMember | null>(null);
  const [removeConfirmText, setRemoveConfirmText] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<RosterMember | null>(null);
  const [profileTarget, setProfileTarget] = useState<RosterMember | null>(null);

  // H2: re-seed the role filter if the ?role= param resolves after mount.
  useEffect(() => {
    if (initialRoleFilter && (ROLE_FILTERS as readonly string[]).includes(initialRoleFilter)) {
      setFilter(initialRoleFilter as RoleFilter);
    }
  }, [initialRoleFilter]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  // --- Pending invitations (H1 — NOT carried by useTeamRoster). isAdmin-gated (R2). ---
  const loadInvites = useCallback(async () => {
    if (!isAdmin) return;
    const { data: pending } = await supabase
      .from("invitations")
      .select("id, email, role, invited_by, created_at, expires_at")
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    const staff = (pending ?? []).filter((i: { role: string }) => STAFF_ROLE_SET.has(i.role));
    const emails = staff.map((i: { email: string }) => i.email);
    const statusByEmail = new Map<string, { status: string; error: string | null }>();
    if (emails.length) {
      const { data: sendRows } = await supabase
        .from("email_send_log")
        .select("recipient_email, status, error_message, created_at")
        .eq("template_name", "role-invitation")
        .in("recipient_email", emails)
        .order("created_at", { ascending: false })
        .limit(500);
      (sendRows ?? []).forEach((r: { recipient_email: string; status: string; error_message: string | null }) => {
        if (!statusByEmail.has(r.recipient_email)) statusByEmail.set(r.recipient_email, { status: r.status, error: r.error_message });
      });
    }
    setInvites(staff.map((i: PendingInvite) => {
      const s = statusByEmail.get(i.email);
      return { ...i, last_status: s?.status ?? null, last_error: s?.error ?? null };
    }));
  }, [isAdmin]);

  useEffect(() => { void loadInvites(); }, [loadInvites]);

  // Realtime: refresh invites on any change (roster itself refreshes in useTeamRoster).
  useEffect(() => {
    if (!isAdmin) return;
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (scheduled) return; scheduled = setTimeout(() => { scheduled = null; void loadInvites(); }, 350); };
    const channel = supabase.channel("members-roles-invites")
      .on("postgres_changes", { event: "*", schema: "public", table: "invitations" }, bump)
      .subscribe();
    return () => { if (scheduled) clearTimeout(scheduled); supabase.removeChannel(channel); };
  }, [isAdmin, loadInvites]);

  // --- Client-facing profile fields via the gated RPC (own-record-or-tenant-admin), for every
  // member, plus who has clients assigned to them. ---
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  const memberIdKey = memberIds.join(",");

  const loadCoachFields = useCallback(async () => {
    if (!isAdmin || memberIds.length === 0) { setCoachFields({}); setServesClients(new Set()); return; }
    const { data: assigned } = await supabase
      .from("clients")
      .select("assigned_coach_user_id")
      .in("assigned_coach_user_id", memberIds);
    setServesClients(new Set((assigned ?? []).map((r) => r.assigned_coach_user_id).filter((id): id is string => !!id)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new RPC not yet in generated types (#234)
    const { data, error } = await supabase.rpc("get_tenant_coach_fields" as any, { _user_ids: memberIds });
    if (error) return;
    const map: Record<string, CoachFields> = {};
    (data ?? []).forEach((r: { user_id: string; coach_specialties: string[] | null; coach_capacity: number | null; coach_accepting_clients: boolean | null; coach_timezone: string | null; coach_bio: string | null }) => {
      map[r.user_id] = {
        specialties: r.coach_specialties ?? [],
        capacity: r.coach_capacity ?? null,
        accepting: r.coach_accepting_clients ?? true,
        timezone: r.coach_timezone ?? null,
        bio: r.coach_bio ?? null,
      };
    });
    setCoachFields(map);
  }, [isAdmin, memberIds, memberIdKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadCoachFields(); }, [loadCoachFields]);

  const refreshAll = useCallback(() => { refresh?.(); void loadInvites(); void loadCoachFields(); }, [refresh, loadInvites, loadCoachFields]);

  // --- Actions (ported from MembersAdmin — same RPCs/edge fns, same owner guards). ---
  const handleSuspend = async () => {
    if (!suspendTarget) return;
    const { error } = await supabase.rpc("suspend_user", { _user_id: suspendTarget.user_id, _reason: suspendReason || "No reason provided" });
    if (error) { toast.error(error.message); return; }
    toast.success("User suspended");
    setSuspendTarget(null); setSuspendReason(""); refreshAll();
  };
  const handleReactivate = async (m: RosterMember) => {
    const { error } = await supabase.rpc("reactivate_user", { _user_id: m.user_id });
    if (error) { toast.error(error.message); return; }
    toast.success("User reactivated"); refreshAll();
  };
  const handleForceSignout = async (m: RosterMember) => {
    const { error } = await supabase.functions.invoke("admin-force-signout", { body: { userId: m.user_id } });
    if (error) { toast.error(error.message); return; }
    toast.success("Signed user out of all sessions");
  };
  const handleRevokeAccess = async () => {
    if (!revokeTarget) return;
    // Whoever holds clients has them reassigned first, whatever role they hold.
    const { count: assignedCount, error: assignedErr } = await supabase.from("clients").select("id", { count: "exact", head: true }).eq("assigned_coach_user_id", revokeTarget.user_id);
    // If the count cannot be read, nothing is changed: the guard fails closed.
    if (assignedErr || assignedCount === null) { toast.error("Couldn't check their assigned clients, so nothing was changed. Try again."); return; }
    if (assignedCount > 0) {
      setReassignCoachId(revokeTarget.user_id); setReassignLabel(revokeTarget.full_name || revokeTarget.email || "this teammate"); setRevokeTarget(null);
      toast.message("Reassign their clients first", { description: "Then re-open Revoke access." }); return;
    }
    const { error } = await supabase.rpc("revoke_platform_access", { _user_id: revokeTarget.user_id });
    if (error) { toast.error(error.message); return; }
    toast.success("Platform access revoked"); setRevokeTarget(null); refreshAll();
  };
  const handleRemoveUser = async () => {
    if (!removeTarget) return;
    if (removeConfirmText.trim().toLowerCase() !== (removeTarget.email || "").toLowerCase()) { toast.error("Type the user's email exactly to confirm"); return; }
    // Whoever holds clients has them reassigned first, whatever role they hold.
    const { count: assignedCount, error: assignedErr } = await supabase.from("clients").select("id", { count: "exact", head: true }).eq("assigned_coach_user_id", removeTarget.user_id);
    // If the count cannot be read, nothing is changed: the guard fails closed.
    if (assignedErr || assignedCount === null) { toast.error("Couldn't check their assigned clients, so nothing was changed. Try again."); return; }
    if (assignedCount > 0) {
      setReassignCoachId(removeTarget.user_id); setReassignLabel(removeTarget.full_name || removeTarget.email || "this teammate"); setRemoveTarget(null);
      toast.message("Reassign their clients first", { description: "Then re-open Delete." }); return;
    }
    const { data, error } = await supabase.functions.invoke("admin-delete-user", { body: { user_id: removeTarget.user_id } });
    if (error) { toast.error(error.message); return; }
    if ((data as { error?: string })?.error) { toast.error((data as { error: string }).error); return; }
    toast.success("User deleted"); setRemoveTarget(null); setRemoveConfirmText(""); refreshAll();
  };
  const handleRevokeInvite = async (id: string) => {
    const { error } = await supabase.from("invitations").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Invitation revoked"); void loadInvites();
  };
  const handleResendInvite = async (inv: PendingInvite) => {
    const { data, error } = await supabase.functions.invoke("send-admin-invitation", { body: { email: inv.email, role: inv.role } });
    if (error) { toast.error(error.message); return; }
    if ((data as { error?: string })?.error) { toast.error((data as { error: string }).error); return; }
    toast.success(`Resent invite to ${inv.email}`); void loadInvites();
  };

  // Coach quick-pill: flip "accepting", keeping the coach's current specialties/capacity.
  const toggleAccepting = async (m: RosterMember) => {
    const cf = coachFields[m.user_id];
    if (!cf) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new RPC not yet in generated types (#234)
    const { error } = await supabase.rpc("set_coach_fields" as any, {
      _user_id: m.user_id, _specialties: cf.specialties, _capacity: cf.capacity, _accepting: !cf.accepting, _timezone: cf.timezone,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(!cf.accepting ? "Now accepting new clients" : "Paused new clients");
    void loadCoachFields();
  };

  // --- Filtering ---
  const staffOnly = useMemo(() => members.filter(isStaffRow), [members]);
  const nonStaffCount = members.length - staffOnly.length;
  const filtered = useMemo(() => {
    const source = includeNonStaff ? members : staffOnly;
    const q = search.trim().toLowerCase();
    return source.filter((m) => {
      if (filter !== "all") {
        if (filter === "owner" && !m.tenant_is_owner) return false;
        if (filter !== "owner" && !m.roles.includes(filter)) return false;
      }
      if (q && !`${m.email ?? ""} ${m.full_name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [members, staffOnly, includeNonStaff, filter, search]);

  const counts = useMemo(() => {
    const source = includeNonStaff ? members : staffOnly;
    const c: Record<string, number> = { all: source.length };
    ROLE_FILTERS.forEach((r) => { if (r !== "all") c[r] = 0; });
    source.forEach((m) => { if (m.tenant_is_owner) c.owner++; m.roles.forEach((r) => { if (c[r] !== undefined) c[r]++; }); });
    return c;
  }, [members, staffOnly, includeNonStaff]);

  const byGroup = useMemo(() => {
    const map = new Map<TeamGroup, RosterMember[]>();
    for (const m of filtered) {
      const g = groupForMember(m);
      const list = map.get(g);
      if (list) list.push(m); else map.set(g, [m]);
    }
    return map;
  }, [filtered]);
  const nonEmptyGroups = GROUP_ORDER.filter((g) => (byGroup.get(g)?.length ?? 0) > 0);

  const renderInviteStatus = (inv: PendingInvite) => {
    if (!inv.last_status) return <span className="text-xs text-muted-foreground">Not sent</span>;
    if (inv.last_status === "sent") return <Badge variant="secondary" className="gap-1"><CheckCircle2 className="w-3 h-3" /> Delivered</Badge>;
    if (inv.last_status === "pending") return <Badge variant="outline">Queued</Badge>;
    if (inv.last_status === "suppressed") return <Badge variant="destructive" className="gap-1"><ShieldOff className="w-3 h-3" /> Suppressed</Badge>;
    return <Badge variant="destructive" className="gap-1" title={inv.last_error ?? undefined}><AlertTriangle className="w-3 h-3" /> {inv.last_status === "dlq" ? "Failed" : inv.last_status}</Badge>;
  };

  const nothingToShow = !loading && nonEmptyGroups.length === 0 && invites.length === 0;

  return (
    <RoleGate allow={["admin"]} fallback={<></>}>
      {/* ONE raised surface — the only SectionCard. Groups + invites are hairline
          rows inside it, never nested cards (§25 no card-on-card). */}
      <SectionCard
        title="Members & Roles"
        description="Your staff, grouped by role."
        actions={
          <Button variant="gold" size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" /> Invite
          </Button>
        }
      >
        {/* Toolbar */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {ROLE_FILTERS.map((r) => (
              <FilterChip key={r} active={filter === r} onClick={() => setFilter(r)} className="capitalize">
                {r.replace("_", " ")} <span className="ml-1 tabular-nums opacity-60">{counts[r] ?? 0}</span>
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Input placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <div className="ml-auto flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
              <Switch id="mr-non-staff" checked={includeNonStaff} onCheckedChange={setIncludeNonStaff} />
              <Label htmlFor="mr-non-staff" className="cursor-pointer text-sm">
                Non-staff{nonStaffCount > 0 && <span className="ml-1 text-xs text-muted-foreground">({nonStaffCount})</span>}
              </Label>
            </div>
          </div>
        </div>

        {/* Pending invitations — foldout inside the card, hidden when none (H1). */}
        {invites.length > 0 && (
          <Collapsible defaultOpen className="mt-4 rounded-md border border-border">
            <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-sm font-medium">
              <Mail className="h-4 w-4 text-muted-foreground" />
              Pending invitations <span className="tabular-nums text-muted-foreground">({invites.length})</span>
              <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-border/60 border-t border-border/60">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{inv.email}</div>
                      {inv.last_error && <div className="max-w-sm truncate text-xs text-destructive" title={inv.last_error}>{inv.last_error}</div>}
                    </div>
                    <Badge variant="outline" className="capitalize">{inv.role.replace("_", " ")}</Badge>
                    {renderInviteStatus(inv)}
                    <div className="ml-auto flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => handleResendInvite(inv)}><Mail className="mr-1 h-3.5 w-3.5" /> Resend</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleRevokeInvite(inv.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Roster — hairline-divided role groups (S1 eyebrow headers). */}
        {loading && members.length === 0 ? (
          <div className="mt-4 space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted/50" />)}
          </div>
        ) : nothingToShow ? (
          <SectionNote
            icon={Users2}
            className="mt-4"
            action={<Button variant="ghost" size="sm" onClick={() => setInviteOpen(true)}>Invite someone</Button>}
          >
            It's just you so far — invite admins, coaches, and staff to build out the team.
          </SectionNote>
        ) : nonEmptyGroups.length === 0 ? (
          <SectionNote icon={Users2} className="mt-4">No members match these filters.</SectionNote>
        ) : (
          <div className="mt-4 space-y-4">
            {nonEmptyGroups.map((g) => (
              <div key={g}>
                <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {GROUP_LABEL[g]} <span className="tabular-nums">{byGroup.get(g)!.length}</span>
                </div>
                <div className="divide-y divide-border/60 rounded-md border border-border">
                  {byGroup.get(g)!.map((m) => {
                    const cf = coachFields[m.user_id];
                    const hasClients = servesClients.has(m.user_id);
                    const shielded = isShielded(m);
                    return (
                      <div key={m.user_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <button type="button" className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => setProfileTarget(m)}>
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-[11px] font-semibold text-muted-foreground">
                            {isAvatarBucketUrl(m.avatar_url) ? <img src={m.avatar_url!} alt="" className="h-full w-full object-cover" /> : initialsOf(m)}
                          </span>
                          {m.tenant_is_owner && <Crown className="h-4 w-4 shrink-0 text-gold-dark" />}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium hover:underline">{m.full_name || m.email || "—"}</span>
                            {m.full_name && m.email && <span className="block truncate text-xs text-muted-foreground">{m.email}</span>}
                          </span>
                        </button>

                        {/* #227 B2: primary badge is the PER-TENANT role (+ an explicit Owner
                            badge when tenant_is_owner), not the global roles that read as an
                            agency-wide Admin/Coach on a child. */}
                        <div className="flex flex-wrap items-center gap-1">
                          {m.tenant_is_owner && <Badge variant="outline">Owner</Badge>}
                          {m.tenant_role && !m.tenant_is_owner && (
                            <Badge variant="outline" className="capitalize">{roleLabel(m.tenant_role)}</Badge>
                          )}
                        </div>

                        <div className="ml-auto flex items-center gap-2">
                          {hasClients && cf && (
                            <button type="button" onClick={() => toggleAccepting(m)} title="Toggle accepting new clients">
                              <StatePill state={cf.accepting ? "success" : "off"}>{cf.accepting ? "Accepting" : "Paused"}</StatePill>
                            </button>
                          )}
                          <StatePill state={m.suspended_at ? "off" : "success"}>{m.suspended_at ? "Suspended" : "Active"}</StatePill>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuLabel>Manage user</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {/* Tier 1 — safe on EVERY row, incl. shielded owners. */}
                              <DropdownMenuItem onClick={() => setProfileTarget(m)}><UserCog className="mr-2 h-4 w-4" /> View profile</DropdownMenuItem>
                              {/* Manage roles is omitted (not disabled) for shielded rows —
                                  owner/super_admin role changes are refused server-side and
                                  administered from the God surface (§9 operator scope). */}
                              {!shielded && (
                                <DropdownMenuItem onClick={() => setManageRolesTarget(m)}><UserCog className="mr-2 h-4 w-4" /> Manage roles</DropdownMenuItem>
                              )}
                              {hasClients && (
                                <DropdownMenuItem onClick={() => { setReassignCoachId(m.user_id); setReassignLabel(m.full_name || m.email || "this teammate"); }}><UserCog className="mr-2 h-4 w-4" /> Reassign clients</DropdownMenuItem>
                              )}
                              {shielded ? (
                                /* Omit-and-explain: no disabled-with-no-reason rows (§11/§36
                                   no fake affordances) — one honest, non-interactive line. */
                                <>
                                  <DropdownMenuSeparator />
                                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                                    <ShieldCheck className="h-4 w-4 shrink-0" />
                                    Protected owner — platform actions disabled
                                  </div>
                                </>
                              ) : (
                                /* Tier 2 — destructive platform actions, non-shielded only. */
                                <>
                                  <DropdownMenuSeparator />
                                  {m.suspended_at ? (
                                    <DropdownMenuItem onClick={() => handleReactivate(m)}><ShieldCheck className="mr-2 h-4 w-4" /> Reactivate</DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem onClick={() => setSuspendTarget(m)}><ShieldOff className="mr-2 h-4 w-4" /> Suspend</DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onClick={() => handleForceSignout(m)}><LogOut className="mr-2 h-4 w-4" /> Force sign-out</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => setRevokeTarget(m)}><UserMinus className="mr-2 h-4 w-4" /> Revoke platform access</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setRemoveTarget(m); setRemoveConfirmText(""); }} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete user (permanent)</DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Drawer + dialogs — all inside the admin gate. #227 G1: explicit field maps (no
          blind `as` cast) so the per-tenant ownership signal reaches the dialogs typed,
          and a future rename fails typecheck loudly instead of arriving `undefined`. */}
      <MemberProfileDrawer
        member={profileTarget ? {
          user_id: profileTarget.user_id,
          email: profileTarget.email,
          full_name: profileTarget.full_name,
          created_at: profileTarget.created_at,
          last_sign_in_at: profileTarget.last_sign_in_at,
          suspended_at: profileTarget.suspended_at,
          suspended_reason: profileTarget.suspended_reason,
          roles: profileTarget.roles,
          tenant_is_owner: profileTarget.tenant_is_owner,
        } : null}
        open={!!profileTarget}
        onOpenChange={(o) => { if (!o) setProfileTarget(null); }}
        coachFields={profileTarget ? coachFields[profileTarget.user_id] ?? null : null}
        onCoachSaved={loadCoachFields}
      />
      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={refreshAll} />
      <ReassignCoachDialog
        open={!!reassignCoachId}
        onOpenChange={(o) => { if (!o) { setReassignCoachId(null); setReassignLabel(undefined); } }}
        fromCoachId={reassignCoachId}
        fromCoachLabel={reassignLabel}
        onReassigned={refreshAll}
      />
      <ManageRolesDialog
        member={manageRolesTarget ? {
          user_id: manageRolesTarget.user_id,
          email: manageRolesTarget.email,
          full_name: manageRolesTarget.full_name,
          roles: manageRolesTarget.roles,
          tenant_is_owner: manageRolesTarget.tenant_is_owner,
        } : null}
        currentUserId={currentUserId}
        tenantId={activeTenantId}
        open={!!manageRolesTarget}
        onOpenChange={(o) => { if (!o) setManageRolesTarget(null); }}
        onSaved={refreshAll}
        onNeedsCoachReassign={(id, label) => { setReassignCoachId(id); setReassignLabel(label); }}
      />

      {/* Suspend */}
      <Dialog open={!!suspendTarget} onOpenChange={(o) => { if (!o) { setSuspendTarget(null); setSuspendReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend {suspendTarget?.email}?</DialogTitle>
            <DialogDescription>They'll be blocked from signing in. You can reactivate them anytime.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Reason (saved to audit log)</Label>
            <Textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} rows={3} placeholder="Why are you suspending this user?" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSuspendTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleSuspend}>Suspend</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke access (soft) */}
      <Dialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke platform access for {revokeTarget?.email}?</DialogTitle>
            <DialogDescription>Strips every staff role and removes them from any workspace. Their auth account stays put, so they remain visible as a client/lead in Contacts and can be re-promoted later. Reversible.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button onClick={handleRevokeAccess}>Revoke access</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete user (hard) */}
      <Dialog open={!!removeTarget} onOpenChange={(o) => { if (!o) { setRemoveTarget(null); setRemoveConfirmText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Permanently delete {removeTarget?.email}?</DialogTitle>
            <DialogDescription>Deletes the auth account and most associated data. Not reversible. If you only want to remove staff access, use <strong>Revoke platform access</strong> instead.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Type the user's email to confirm</Label>
            <Input value={removeConfirmText} onChange={(e) => setRemoveConfirmText(e.target.value)} placeholder={removeTarget?.email ?? ""} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRemoveTarget(null); setRemoveConfirmText(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleRemoveUser}>Delete permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RoleGate>
  );
}
