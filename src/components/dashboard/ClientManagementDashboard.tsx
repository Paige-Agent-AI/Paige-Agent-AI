/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing legacy `any` debt
   in this large dashboard; the §9 tenant-scope fix (adding an explicit
   .eq("tenant_id", …) to the clients read) introduced ZERO new `any`s — a minimal
   security touch shouldn't retype the whole file. Retyping tracked separately. */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Users, Search, TrendingUp, UserCheck, UserPlus, Upload, Building2, MoreHorizontal, Trash2, UserCog, ArrowRightLeft, Mail, Send, Eye, LogOut, Sparkles, Layers, Loader2 } from "lucide-react";
import { AddClientDialog } from "./AddClientDialog";
import { AddInternalClientDialog } from "./AddInternalClientDialog";
import { QuickUploadReportModal } from "./QuickUploadReportModal";
import { useDashboardMode } from "@/contexts/DashboardModeContext";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import { toast } from "sonner";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses, type WithClientContactMethods } from "@/lib/contact-methods";

// Widened to string: the generated types do not know the contact-methods embed yet.
const INTERNAL_CLIENTS_SELECT: string = `*,${CLIENT_CONTACT_METHODS_EMBED}`;

interface InternalClient {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  entity_name: string | null;
  entity_type: string | null;
  funding_goal: number | null;
  monthly_revenue: number | null;
  status: string;
  linked_user_id: string | null;
  created_at: string;
}

interface AuthClient {
  user_id: string;
  full_name: string | null;
  email?: string | null;
  city: string | null;
  state: string | null;
  created_at: string | null;
  onboarding_completed: boolean | null;
  roles: string[];
  is_minority_owned?: boolean | null;
  is_women_owned?: boolean | null;
  is_veteran_owned?: boolean | null;
  primary_goal_category?: string | null;
  intake_completed?: boolean | null;
  is_complimentary?: boolean | null;
}

interface ClientManagementDashboardProps {
  onViewClient: (clientUserId: string) => void;
  onViewInternalClient?: (clientId: string) => void;
}

export function ClientManagementDashboard({ onViewClient, onViewInternalClient }: ClientManagementDashboardProps) {
  const navigate = useNavigate();
  const { setMode } = useDashboardMode();
  const { activeTenantId } = useTenantContext();
  // §60 tier lock (owner-ruled 2026-08-11): the consumer/client ("Client" role)
  // portal invite is solo + sub_account ONLY. Staff-role invites (admin/…)
  // are untouched — an Agency legitimately invites staff, just not a direct
  // consumer client book.
  const { has: hasTierFeature } = useTierFeatures();
  const canInvitePortal = hasTierFeature("customer_portal_invite");
  const [internalClients, setInternalClients] = useState<InternalClient[]>([]);
  const [authClients, setAuthClients] = useState<AuthClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [addInternalOpen, setAddInternalOpen] = useState(false);
  const [addLegacyOpen, setAddLegacyOpen] = useState(false);
  const [quickUploadOpen, setQuickUploadOpen] = useState(false);
  const [activeView, setActiveView] = useState<"internal" | "auth" | "team">("internal");
  const [demoFilter, setDemoFilter] = useState<{ minority: boolean; women: boolean; veteran: boolean }>({
    minority: false, women: false, veteran: false,
  });

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ type: "internal" | "auth"; id: string; name: string } | null>(null);

  // Force sign-out confirmation state
  const [forceSignOutTarget, setForceSignOutTarget] = useState<{ id: string; name: string } | null>(null);
  const [forceSignOutLoading, setForceSignOutLoading] = useState(false);

  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  // §60: default to the consumer "Client" role only where it's available; on
  // Agency/Enterprise/God the "Client" option is hidden, so default to the least-privileged
  // staff option, "moderator".
  const [inviteRole, setInviteRole] = useState<string>(canInvitePortal ? "user" : "moderator");
  const [inviteSending, setInviteSending] = useState(false);

  // Business-limit override dialog state
  const [limitTarget, setLimitTarget] = useState<{ id: string; name: string } | null>(null);
  const [limitValue, setLimitValue] = useState<string>("999");
  const [limitCurrent, setLimitCurrent] = useState<number | null>(null);
  const [limitSaving, setLimitSaving] = useState(false);

  const openLimitDialog = async (client: AuthClient) => {
    setLimitTarget({ id: client.user_id, name: client.full_name || "this user" });
    setLimitValue("999");
    setLimitCurrent(null);
    try {
      const { data } = await supabase
        .from("user_business_limits" as any)
        .select("max_businesses")
        .eq("user_id", client.user_id)
        .maybeSingle();
      const current = (data as any)?.max_businesses ?? null;
      setLimitCurrent(current);
      if (current != null) setLimitValue(String(current));
    } catch {
      // ignore — fall back to default 999
    }
  };

  const saveBusinessLimit = async () => {
    if (!limitTarget) return;
    const parsed = parseInt(limitValue, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      toast.error("Enter a number 1 or higher");
      return;
    }
    setLimitSaving(true);
    try {
      const { data, error } = await supabase.rpc("admin_set_user_business_limit" as any, {
        _target_user_id: limitTarget.id,
        _max_businesses: parsed,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.success === false) throw new Error(result?.message || "Failed to update limit");
      toast.success(`Set ${limitTarget.name} to ${parsed} business${parsed === 1 ? "" : "es"}`);
      setLimitTarget(null);
    } catch (err: any) {
      console.error("Error setting business limit:", err);
      toast.error(err?.message || "Failed to update limit");
    } finally {
      setLimitSaving(false);
    }
  };

  useEffect(() => {
    fetchAllClients();
  }, [activeTenantId]);

  const fetchAllClients = async () => {
    setLoading(true);
    try {
      // §9 tenant isolation BY CONSTRUCTION. This is a TENANT operator surface
      // (mounted at /admin/clients and the internal coach/admin dashboard — NOT the
      // God-only console). The `clients` read carries an EXPLICIT active-tenant
      // filter: the clients RLS has an is_platform_owner() bypass (migration
      // 20260629180214), so a platform owner's RLS spans every tenant and the
      // "Internal Clients" count card (+ active/withEntity + the tab count) would
      // otherwise bleed cross-tenant rows. With no workspace selected (God tier,
      // activeTenantId === null) we render the zeroed/empty state, never all-tenant
      // rows. Mirrors the CampaignsOverviewStats explicit-.eq pattern (§18).
      //
      // The "auth users" half below (Clients / Team Members cards + tabs) is now
      // tenant-scoped too (#481): profiles/user_roles/businesses have NO tenant_id
      // column and cannot be scoped client-side, so it goes through the
      // get_tenant_people() SECURITY DEFINER RPC, which server-derives the tenant via
      // current_user_tenant_id() and joins the roster through tenant_members. NOTE the
      // seam coupling: this null-tenant short-circuit uses useTenantContext().activeTenantId
      // while the RPC uses current_user_tenant_id() — both resolve to the caller's
      // profiles.active_tenant_id, so they agree; keep them aligned if either resolver changes.
      if (!activeTenantId) {
        setInternalClients([]);
        setAuthClients([]);
        return;
      }

      const { data: intClients } = await supabase
        .from("clients" as any)
        .select(INTERNAL_CLIENTS_SELECT)
        .eq("tenant_id", activeTenantId)
        .order("created_at", { ascending: false });

      // `email` / `phone` are each contact's primary addresses, from its contact methods.
      setInternalClients(((intClients ?? []) as unknown as Array<InternalClient & WithClientContactMethods>)
        .map((row) => withPrimaryAddresses(row)));

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      const roles = roleData?.map((r: any) => r.role) || [];
      const isAdmin = roles.includes("admin");

      if (isAdmin) {
        // §9/§2 (#481): profiles/user_roles/businesses have NO tenant_id column and cannot be
        // scoped client-side. get_tenant_people() is a SECURITY DEFINER RPC that server-derives
        // the tenant from current_user_tenant_id() (never a param, no IDOR), returns only THIS
        // tenant's active members joined to profiles/user_roles/businesses, and is gated by
        // has_role(admin) least-privilege. Null tenant (operator, no workspace) => empty set; no
        // FICO/credit fields on this coaching-generic surface. `supabase as any` matches the file
        // family's house pattern (generated types are stale for this new RPC, #234). NOTE: roles
        // arrive alpha-sorted from the RPC's array_agg (vs the old DB row order) — cosmetic only,
        // roles[0] just seeds the role Select's defaultValue and updateUserRole rewrites all roles.
        const { data: people, error: peopleErr } = await (supabase as any).rpc("get_tenant_people");
        if (peopleErr) throw peopleErr;
        setAuthClients((people as AuthClient[]) || []);
      }
    } catch (err) {
      console.error("Error loading clients:", err);
    } finally {
      setLoading(false);
    }
  };

  // Separate auth users into clients vs team/staff
  const clientUsers = authClients.filter((c) => {
    const r = c.roles || [];
    return r.length === 0 || (r.length === 1 && r[0] === "user");
  });
  const teamUsers = authClients.filter((c) => {
    const r = c.roles || [];
    return r.some((role) => ["admin", "moderator"].includes(role));
  });

  const filteredInternal = internalClients.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.entity_name || "").toLowerCase().includes(q)
    );
  });

  const filterAuth = (list: AuthClient[]) =>
    list.filter((c) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!(c.full_name || "").toLowerCase().includes(q)) return false;
      }
      if (demoFilter.minority && !c.is_minority_owned) return false;
      if (demoFilter.women && !c.is_women_owned) return false;
      if (demoFilter.veteran && !c.is_veteran_owned) return false;
      return true;
    });

  const activeCount = internalClients.filter((c) => c.status === "active").length;
  const withEntity = internalClients.filter((c) => c.entity_name).length;

  // F4 (§13 honesty): the "Team Members" KPI subtitle was a hardcoded "Admin / Coach / Mod"
  // that implied a role breakdown the data doesn't have. Compute the REAL mix and render
  // only the non-zero segments (a member may hold >1 role, so counts can exceed the total).
  const teamRoleCounts = teamUsers.reduce(
    (acc, u) => {
      const r = u.roles || [];
      if (r.includes("admin")) acc.admin++;
      if (r.includes("moderator")) acc.moderator++;
      return acc;
    },
    { admin: 0, moderator: 0 },
  );
  const teamRoleSummary =
    [
      teamRoleCounts.admin ? `${teamRoleCounts.admin} Admin` : null,
      teamRoleCounts.moderator ? `${teamRoleCounts.moderator} Mod` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "No team members";

  // --- Actions ---

  const updateUserRole = async (userId: string, newRole: string) => {
    try {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase.from("user_roles").insert([{ user_id: userId, role: newRole as any }]);
      if (error) throw error;
      toast.success("Role updated successfully");
      fetchAllClients();
    } catch (err: any) {
      console.error("Error updating role:", err);
      toast.error("Failed to update role");
    }
  };

  const updateInternalStatus = async (clientId: string, newStatus: string) => {
    // Optimistic update so the dropdown reflects the new value immediately.
    const previous = internalClients;
    setInternalClients((rows) =>
      rows.map((r) => (r.id === clientId ? { ...r, status: newStatus } : r))
    );
    try {
      const { error } = await supabase
        .from("clients" as any)
        .update({ status: newStatus } as any)
        .eq("id", clientId);
      if (error) throw error;
      toast.success(`Status updated to ${newStatus}`);
      // Refresh in the background to stay in sync with any other edits.
      fetchAllClients();
    } catch (err: any) {
      console.error("Error updating status:", err);
      // Roll back on failure so the UI never lies about persisted state.
      setInternalClients(previous);
      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("clients_status_check")) {
        toast.error("Invalid status value");
      } else {
        toast.error("Failed to update status");
      }
    }
  };

  const deleteInternalClient = async (clientId: string) => {
    try {
      const { error } = await supabase
        .from("clients" as any)
        .delete()
        .eq("id", clientId);
      if (error) throw error;
      toast.success("Client deleted");
      fetchAllClients();
    } catch (err: any) {
      console.error("Error deleting client:", err);
      toast.error("Failed to delete client");
    }
  };

  const deleteAuthUser = async (userId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.functions.invoke("admin-delete-user", {
        body: { user_id: userId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      toast.success("User deleted");
      fetchAllClients();
    } catch (err: any) {
      console.error("Error deleting user:", err);
      toast.error(err.message || "Failed to delete user");
    }
  };

  const moveToInternal = async (client: AuthClient) => {
    try {
      const nameParts = (client.full_name || "Unknown").split(" ");
      const firstName = nameParts[0] || "Unknown";
      const lastName = nameParts.slice(1).join(" ") || "";

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // #612 (§9): create the internal client record UNLINKED — do NOT set linked_user_id to a
      // foreign auth user from the browser. A tenant-admin force-linking an arbitrary uid was the
      // forge that re-opened the #611 cross-tenant credit-report read; the clients
      // linking-integrity trigger now blocks it. Linkage to this person's auth account happens
      // only through the consent path (they accept a portal invite → accept_tenant_invite sets
      // linked_user_id), consistent with how the app already models it ("Not Invited" until
      // accepted). This mirrors AddInternalClientDialog, which also creates unlinked contacts.
      const { data: clientId, error } = await supabase.rpc("create_contact", {
        p_first_name: firstName, p_last_name: lastName, p_email: null,
        p_source: "manual", p_channel: "manual",
      } as any);
      if (error || !clientId) throw error ?? new Error("Client could not be resolved");
      const { error: detailError } = await supabase.from("clients" as any)
        .update({ city: client.city, state: client.state } as any).eq("id", clientId);
      if (detailError) throw detailError;
      toast.success(`${client.full_name} added to Internal Clients — invite them to link their account`);
      fetchAllClients();
    } catch (err: any) {
      console.error("Error moving to internal:", err);
      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("clients_created_by_email_unique")) {
        toast.error("A client with this email already exists in your list");
      } else {
        toast.error(err.message || "Failed to move client");
      }
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "internal") {
      await deleteInternalClient(deleteTarget.id);
    } else {
      await deleteAuthUser(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  const handleForceSignOutConfirm = async () => {
    if (!forceSignOutTarget) return;
    setForceSignOutLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.functions.invoke("admin-force-signout", {
        body: { user_id: forceSignOutTarget.id, scope: "global" },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      toast.success(`${forceSignOutTarget.name} has been signed out of all devices`);
      setForceSignOutTarget(null);
    } catch (err: any) {
      console.error("Error forcing sign out:", err);
      toast.error(err?.message || "Failed to force sign out");
    } finally {
      setForceSignOutLoading(false);
    }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error("Please enter an email address");
      return;
    }
    setInviteSending(true);
    try {
      if (inviteRole === "user") {
        // §9: "Client" (role 'user') gets the tenant-branded client PORTAL invite
        // (/join) via a consumer token — never the staff /accept-invite dashboard
        // path. Mirrors ContactPortalPanel so, on accept, they get a clients row +
        // client role with NO tenant_members membership (no operator dashboard).
        // §60: consumer-portal invite is solo + sub_account only — hard-guard it.
        if (!canInvitePortal) {
          toast.error("Client portal invites aren't available on this account type.");
          return;
        }
        if (!activeTenantId) {
          toast.error("No active workspace to invite into.");
          return;
        }
        const { data: tokRes, error: mintErr } = await supabase.rpc("create_tenant_invite_token", {
          _tenant_id: activeTenantId,
          _kind: "consumer",
          _default_role: "member",
          _expires_in_days: 30,
          _max_uses: null,
          _contact_id: null,
          _email: inviteEmail.trim(),
        });
        if (mintErr) throw mintErr;
        const row = Array.isArray(tokRes) ? tokRes[0] : tokRes;
        const token = (row as { token?: string } | null)?.token;
        if (!token) throw new Error("Could not create the invite");
        const { data: sent } = await supabase.functions.invoke("send-portal-invite", {
          body: { token, email: inviteEmail.trim() },
        });
        const emailed = (sent as { emailed?: boolean } | null)?.emailed;
        toast[emailed === false ? "warning" : "success"](
          emailed === false
            ? `Invite created for ${inviteEmail}, but the email didn't send. Check delivery.`
            : `Client portal invite sent to ${inviteEmail}`,
        );
      } else {
        // Staff roles (moderator/admin/affiliate) keep the admin path.
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke("send-admin-invitation", {
          body: { email: inviteEmail.trim(), role: inviteRole },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const roleLabels: Record<string, string> = {
          admin: "Administrator", moderator: "Moderator",
          affiliate: "Affiliate", user: "Client",
        };
        toast.success(`Invitation sent to ${inviteEmail} as ${roleLabels[inviteRole] || inviteRole}`);
      }
      setInviteOpen(false);
      setInviteEmail("");
      // §60: mirror the initial default — never reset to "user" (Client) on a tier
      // where that option is hidden, which would leave the Select bound to an
      // invisible value (blank trigger) on the next open.
      setInviteRole(canInvitePortal ? "user" : "moderator");
    } catch (err: any) {
      console.error("Error sending invite:", err);
      toast.error(err.message || "Failed to send invitation");
    } finally {
      setInviteSending(false);
    }
  };

  // --- Render helpers ---

  const renderAuthTable = (list: AuthClient[], showPromoteToInternal: boolean) => {
    const filtered = filterAuth(list);
    if (filtered.length === 0) {
      return <p className="text-center text-muted-foreground py-8">No users found.</p>;
    }

    // F2 (§11 no-placeholder): a member with no profile name must not render as a bare
    // em-dash. Fall back to a real, role-derived label ("Unnamed admin"/"Unnamed member").
    // (get_tenant_people returns no email, so an email fallback isn't available here.)
    const roleNoun = (role: string) => {
      switch (role) {
        case "admin": return "admin";
        case "moderator": return "moderator";
        case "affiliate": return "affiliate";
        default: return "member";
      }
    };

    const renderRowActions = (c: AuthClient, sizeClass: string) => (
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="outline" className={sizeClass} onClick={() => onViewClient(c.user_id)}>
          View
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className={`${sizeClass.replace("text-xs", "")} w-8 p-0`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => {
              setMode("client");
              navigate("/app");
            }}>
              <Eye className="w-4 h-4 mr-2" /> View as Client
            </DropdownMenuItem>
            {showPromoteToInternal && (
              <DropdownMenuItem onClick={() => moveToInternal(c)}>
                <ArrowRightLeft className="w-4 h-4 mr-2" /> Move to Internal
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => openLimitDialog(c)}>
              <Layers className="w-4 h-4 mr-2" />
              Set Business Limit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setForceSignOutTarget({ id: c.user_id, name: c.full_name || "this user" })}
            >
              <LogOut className="w-4 h-4 mr-2" /> Force Sign Out (All Devices)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteTarget({ type: "auth", id: c.user_id, name: c.full_name || "this user" })}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete User
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );

    return (
      <>
        {/* Mobile card list */}
        <div className="space-y-3 md:hidden">
          {filtered.map((c) => {
            const primaryRole = c.roles?.[0] || "user";
            const goalLabel = c.primary_goal_category
              ? c.primary_goal_category.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
              : null;
            return (
              <div key={c.user_id} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{c.full_name?.trim() || `Unnamed ${roleNoun(primaryRole)}`}</span>
                      {c.is_complimentary && (
                        <Badge className="bg-gradient-gold text-foreground border-0 text-[10px] flex items-center gap-1 px-1.5 py-0">
                          <Sparkles className="w-3 h-3" />
                          Complimentary
                        </Badge>
                      )}
                    </div>
                    {(c.city || c.state) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {c.city && c.state ? `${c.city}, ${c.state}` : c.city || c.state}
                      </p>
                    )}
                  </div>
                </div>
                {showPromoteToInternal && goalLabel && (
                  <div>
                    <Badge variant="secondary" className="bg-gradient-gold text-foreground border-0 text-[10px]">
                      {goalLabel}
                    </Badge>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Select
                    defaultValue={primaryRole}
                    onValueChange={(value) => updateUserRole(c.user_id, value)}
                  >
                    <SelectTrigger className="w-[120px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="moderator">Moderator</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="affiliate">Affiliate</SelectItem>
                    </SelectContent>
                  </Select>
                  {renderRowActions(c, "h-8 text-xs")}
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                {showPromoteToInternal && <TableHead>Goal</TableHead>}
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const primaryRole = c.roles?.[0] || "user";
                const goalLabel = c.primary_goal_category
                  ? c.primary_goal_category.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
                  : null;
                return (
                  <TableRow key={c.user_id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{c.full_name?.trim() || `Unnamed ${roleNoun(primaryRole)}`}</span>
                        {c.is_complimentary && (
                          <Badge className="bg-gradient-gold text-foreground border-0 text-[10px] flex items-center gap-1 px-1.5 py-0">
                            <Sparkles className="w-3 h-3" />
                            Complimentary
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{c.city && c.state ? `${c.city}, ${c.state}` : "—"}</TableCell>
                    {showPromoteToInternal && (
                      <TableCell>
                        {goalLabel ? (
                          <Badge variant="secondary" className="bg-gradient-gold text-foreground border-0 text-[10px]">
                            {goalLabel}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No intake</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <Select
                        defaultValue={primaryRole}
                        onValueChange={(value) => updateUserRole(c.user_id, value)}
                      >
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="moderator">Moderator</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="affiliate">Affiliate</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">Active</Badge>
                    </TableCell>
                    <TableCell>{renderRowActions(c, "h-7 text-xs")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Internal Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{internalClients.length}</div>
            <p className="text-xs text-muted-foreground">{activeCount} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">With Entities</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{withEntity}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Clients</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{clientUsers.length}</div>
            <p className="text-xs text-muted-foreground">Registered users</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <UserCog className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teamUsers.length}</div>
            <p className="text-xs text-muted-foreground">{teamRoleSummary}</p>
          </CardContent>
        </Card>
      </div>

      {/* Client List */}
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <CardTitle>Client Management</CardTitle>
            <CardDescription>Manage clients, team members, and internal records</CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:gap-3">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setQuickUploadOpen(true)}>
                <Upload className="w-4 h-4 mr-1" /> Upload Report
              </Button>
              <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
                <Mail className="w-4 h-4 mr-1" /> Send Invite
              </Button>
              <Button size="sm" onClick={() => setAddInternalOpen(true)}>
                <UserPlus className="w-4 h-4 mr-1" /> New Client
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeView} onValueChange={(v) => setActiveView(v as any)}>
            <TabsList className="mb-4">
              <TabsTrigger value="internal">Internal Clients ({internalClients.length})</TabsTrigger>
              <TabsTrigger value="auth">Clients ({clientUsers.length})</TabsTrigger>
              <TabsTrigger value="team">Team / Admin ({teamUsers.length})</TabsTrigger>
            </TabsList>

            {activeView === "auth" && (
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs text-muted-foreground mr-1">Filter:</span>
                {[
                  { key: "minority" as const, label: "Minority-Owned" },
                  { key: "women" as const, label: "Women-Owned" },
                  { key: "veteran" as const, label: "Veteran-Owned" },
                ].map((f) => {
                  const active = demoFilter[f.key];
                  return (
                    <Button
                      key={f.key}
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className={`h-7 text-xs ${active ? "bg-gradient-gold border-0" : ""}`}
                      onClick={() => setDemoFilter({ ...demoFilter, [f.key]: !active })}
                    >
                      {f.label}
                    </Button>
                  );
                })}
                {(demoFilter.minority || demoFilter.women || demoFilter.veteran) && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => setDemoFilter({ minority: false, women: false, veteran: false })}>
                    Clear
                  </Button>
                )}
              </div>
            )}

            {/* Internal Clients Tab */}
            <TabsContent value="internal">
              {filteredInternal.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-muted-foreground mb-4">
                    {searchQuery ? "No clients match your search" : "No internal clients yet"}
                  </p>
                  {!searchQuery && (
                    <Button onClick={() => setAddInternalOpen(true)}>
                      <UserPlus className="w-4 h-4 mr-1" /> Create First Client
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {/* Mobile card list */}
                  <div className="space-y-3 md:hidden">
                    {filteredInternal.map((c) => (
                      <div key={c.id} className="rounded-lg border bg-card p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{c.first_name} {c.last_name}</p>
                            {c.email && (
                              <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                            )}
                          </div>
                          <Badge variant={c.linked_user_id ? "default" : "outline"} className="text-[10px] shrink-0">
                            {c.linked_user_id ? "Linked" : "—"}
                          </Badge>
                        </div>
                        {(c.entity_name || c.monthly_revenue) && (
                          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            {c.entity_name && (
                              <div className="col-span-2 truncate"><span className="font-medium text-foreground">Entity:</span> {c.entity_name}</div>
                            )}
                            {c.monthly_revenue && (
                              <div><span className="font-medium text-foreground">Revenue:</span> ${Number(c.monthly_revenue).toLocaleString()}/mo</div>
                            )}
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <Select
                            value={c.status}
                            onValueChange={(value) => updateInternalStatus(c.id, value)}
                          >
                            <SelectTrigger className="w-[130px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                              <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onViewInternalClient?.(c.id)}>
                              View
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => { setMode("client"); navigate("/app"); }}>
                                  <Eye className="w-4 h-4 mr-2" /> View as Client
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setDeleteTarget({ type: "internal", id: c.id, name: `${c.first_name} ${c.last_name}` })}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> Delete Client
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Entity</TableHead>
                          <TableHead>Revenue</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Portal</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredInternal.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium">{c.first_name} {c.last_name}</TableCell>
                            <TableCell className="text-sm">{c.email || "—"}</TableCell>
                            <TableCell className="text-sm">{c.entity_name || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">
                              {c.monthly_revenue ? `$${Number(c.monthly_revenue).toLocaleString()}/mo` : "—"}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={c.status}
                                onValueChange={(value) => updateInternalStatus(c.id, value)}
                              >
                                <SelectTrigger className="w-[110px] h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="pending">Pending</SelectItem>
                                  <SelectItem value="active">Active</SelectItem>
                                  <SelectItem value="inactive">Inactive</SelectItem>
                                  <SelectItem value="archived">Archived</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Badge variant={c.linked_user_id ? "default" : "outline"} className="text-xs">
                                {c.linked_user_id ? "Linked" : "—"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onViewInternalClient?.(c.id)}>
                                  View
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => {
                                      setMode("client");
                                      navigate("/app");
                                    }}>
                                      <Eye className="w-4 h-4 mr-2" /> View as Client
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => setDeleteTarget({ type: "internal", id: c.id, name: `${c.first_name} ${c.last_name}` })}
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" /> Delete Client
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </TabsContent>

            {/* Clients (regular users) Tab */}
            <TabsContent value="auth">
              {renderAuthTable(clientUsers, true)}
            </TabsContent>

            {/* Team / Admin Tab */}
            <TabsContent value="team">
              {renderAuthTable(teamUsers, false)}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Force Sign Out Confirmation Dialog */}
      <AlertDialog open={!!forceSignOutTarget} onOpenChange={(open) => !open && !forceSignOutLoading && setForceSignOutTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force sign out of all devices?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke every active session for <strong>{forceSignOutTarget?.name}</strong> on every device. They'll be required to sign in again. Use this when a client is stuck on an old version or can't log out themselves.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={forceSignOutLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceSignOutConfirm}
              disabled={forceSignOutLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {forceSignOutLoading ? "Signing out..." : "Yes, force sign out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialogs */}
      <AddInternalClientDialog open={addInternalOpen} onOpenChange={setAddInternalOpen} onClientAdded={fetchAllClients} />
      <AddClientDialog open={addLegacyOpen} onOpenChange={setAddLegacyOpen} onClientAdded={fetchAllClients} />
      <QuickUploadReportModal open={quickUploadOpen} onOpenChange={setQuickUploadOpen} />

      {/* Set Business Limit Dialog */}
      <Dialog open={!!limitTarget} onOpenChange={(open) => !open && !limitSaving && setLimitTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Business Limit</DialogTitle>
            <DialogDescription>
              Override the maximum number of businesses <strong>{limitTarget?.name}</strong> can add. Use 999 for unlimited (admins, team, comp accounts).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="limit-value">Max businesses</Label>
              <Input
                id="limit-value"
                type="number"
                min={1}
                value={limitValue}
                onChange={(e) => setLimitValue(e.target.value)}
              />
              {limitCurrent != null && (
                <p className="text-xs text-muted-foreground">Current limit: {limitCurrent}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {[1, 3, 10, 999].map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setLimitValue(String(preset))}
                >
                  {preset === 999 ? "Unlimited (999)" : preset}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLimitTarget(null)} disabled={limitSaving}>Cancel</Button>
            <Button onClick={saveBusinessLimit} disabled={limitSaving}>
              {limitSaving ? "Saving..." : "Save Limit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Role Invitation</DialogTitle>
            <DialogDescription>
              Send an email invitation for someone to join the platform with a specific role.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="name@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* §60: consumer "Client" invite — solo + sub_account only. */}
                  {canInvitePortal && <SelectItem value="user">Client</SelectItem>}
                  <SelectItem value="moderator">Moderator</SelectItem>
                  <SelectItem value="admin">Administrator</SelectItem>
                  <SelectItem value="affiliate">Affiliate Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={sendInvite} disabled={inviteSending}>
              <Send className="w-4 h-4 mr-1" />
              {inviteSending ? "Sending..." : "Send Invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
