/**
 * useAgencyPeople — the Agency Team / People adapter (Slice B, adapter 4).
 *
 * Mirrors the Solo `src/solo/data` pattern and its Slice-A siblings
 * (useAgencyRoster / useAgencyMetrics / useAgencyCommandCenter): a THIN typed
 * composition over the EXISTING production seams, reshaped into the prop shapes the
 * agency Team chrome already renders (TEAM / TEAM_ROLES / TEAM_ACCOUNTS / TEAM_SEATS /
 * TEAM_CAP / TEAM_PERF / TEAM_ACTS). Only the DATA source changes; no re-query family.
 * §18: the mutation seams here are the SAME server-gated RPCs AgencyTeamPanel already
 * ships — this adapter is one more caller of them, never a fork.
 *
 * §51 SCOPE SPINE (session-derived ONLY — never a client-supplied tenant_id):
 *   • AGENCY AGGREGATE  (isAgency && !acting) → the AGENCY TEAM (the operator's staff
 *     that runs the book of sub-accounts):
 *       - agency_list_team()  (Args: never; RAISE 42501 for a non-agency caller — the
 *         #86-leak firewall) → agency_role / email / full_name / is_you / joined_at /
 *         scoped_count / scoped_subaccounts / status.                         [REAL]
 *       - activeTenant.seat_limit → seat capacity.                            [REAL]
 *     Mutations (agency-team management, server-authorized on agency_team_can_manage):
 *       agency_set_member_role / agency_set_member_status / agency_remove_member.
 *   • OWN-BOOK / ACTING  (!isAgency  ||  acting != null) → the SUB-ACCOUNT's OWN staff:
 *       - useTeamRoster(enabled, activeTenantId)  (admin-list-users edge fn, RLS-scoped
 *         to the caller's OWN tenant) → the sub's own members ONLY.           [REAL]
 *     This mode NEVER calls agency_list_team (gated OFF here, belt-and-suspenders over
 *     the server-side RAISE) and NEVER the agency-team mutations (they authorize on the
 *     agency, not the sub — the adapter rejects them honestly instead of firing).
 *
 * invite() mints a tenant invite via create_tenant_invite_token for the caller's OWN /
 * active tenant (session-derived `activeTenantId` — never a client-supplied id); the
 * RPC authorizes the mint server-side (§60 consumer/team guard). Valid in both modes.
 *
 * §13 HONESTY: the roster, per-role breakdown, per-member sub-account ASSIGNMENTS, and
 * seat usage are REAL. Utilization / hours-booked / focus (TEAM_CAP), department
 * workload/performance (TEAM_PERF), and the cross-book activity feed (TEAM_ACTS) have NO
 * backend today — each is emitted as an explicit typed PREVIEW marker, never a fabricated
 * number. A cross-book hours/rate/load roll-up off the RLS own-book tables would be the
 * #86 leak — so those per-account metric columns stay Preview too.
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTeamRoster, type RosterMember } from "@/hooks/useTeamRoster";
import { isAgencyAggregate, type AgencyShellCtx } from "./useAgencyRoster";

/* ── Result of the mutation seams (mirrors the sibling adapters' shape) ── */
export interface PeopleMutationResult {
  ok: boolean;
  error?: string;
  /** Present only for a successful invite mint. */
  token?: string;
}

/**
 * One person on the team, unified across both modes. Identity + role + status +
 * scope are REAL; utilization / hours / focus have no backend and stay Preview (null).
 */
export interface AgencyPersonRow {
  /** auth user id — REAL */
  userId: string;
  /** full_name → email local part → "Teammate" — REAL */
  name: string;
  /** email — REAL | null */
  email: string | null;
  /** raw role key: agency_role (agency mode) | tenant_role/first role (own mode) — REAL */
  role: string;
  /** human role label — REAL (derived) */
  roleLabel: string;
  /** lifecycle: active / invited / suspended — REAL */
  status: string;
  /** is this the calling operator — REAL */
  isYou: boolean;
  /** joined/created ISO — REAL | null */
  joinedAt: string | null;
  /** manager-tier (can run sub-accounts / tenant owner-admin) — REAL (derived) */
  isManager: boolean;
  /** sub-accounts this member is scoped to — REAL (agency) | null (own has no scoping) */
  scopedSubaccounts: string[] | null;
  /** count of scoped sub-accounts — REAL (agency) | null (own) */
  scopedCount: number | null;
  /** PREVIEW — no per-member utilization backend (never fabricated) */
  utilization: null;
  /** PREVIEW — no per-member hours-booked backend */
  hoursBooked: null;
  /** PREVIEW — no per-member "current focus" backend */
  focus: null;
}

/** Per-role breakdown (feeds TEAM_ROLES). All REAL / derived from the roster. */
export interface AgencyRoleSummary {
  /** role key — REAL */
  role: string;
  /** human label — REAL */
  label: string;
  /** members holding this role — REAL */
  count: number;
  /** their names — REAL */
  names: string[];
  /** manager-tier role — REAL */
  isManager: boolean;
}

/** Per-member sub-account assignment (feeds TEAM_ACCOUNTS). Scope is REAL; metrics Preview. */
export interface AgencyAccountAssignment {
  /** owning member user id — REAL */
  userId: string;
  /** owning member name — REAL */
  owner: string;
  /** sub-account ids this member works inside — REAL (agency mode) */
  scopedSubaccountIds: string[];
  /** count — REAL */
  scopedCount: number;
  /** PREVIEW — no per-account hours roll-up (cross-book off own tables = #86 leak) */
  hours: null;
  /** PREVIEW — no per-account rate */
  rate: null;
  /** PREVIEW — no per-account load classification */
  load: null;
}

/** Seat capacity (feeds TEAM_SEATS). REAL from activeTenant.seat_limit + roster count. */
export interface AgencySeats {
  /** seat ceiling — REAL | null (unset) */
  limit: number | null;
  /** active members using a seat — REAL */
  used: number;
  /** remaining — REAL (derived) | null when no limit is set */
  available: number | null;
}

/** Typed PREVIEW markers — surfaces with NO backend today (§13, never fabricated). */
export interface AgencyPeoplePreview {
  /** TEAM_CAP — team capacity/utilization line. No backend. */
  utilization: true;
  /** TEAM_PERF — department workload/performance. No backend. */
  workload: true;
  /** TEAM_ACTS — cross-book team activity feed. No parentage-gated backend. */
  activity: true;
}

export interface AgencyPeopleData {
  mode: "agency" | "own";
  /** REAL roster (agency team | sub's own staff). */
  people: AgencyPersonRow[];
  /** REAL per-role breakdown. */
  roles: AgencyRoleSummary[];
  /** REAL per-member sub-account assignments (agency mode; empty in own mode). */
  accounts: AgencyAccountAssignment[];
  /** REAL seat capacity. */
  seats: AgencySeats;
  /** Typed PREVIEW markers for the no-backend surfaces. */
  preview: AgencyPeoplePreview;
  /**
   * TRUE when the caller can manage the AGENCY team (agency-aggregate mode). In own /
   * acting mode the agency-team mutations don't apply — the surface hides the controls
   * and the mutations reject honestly rather than firing a server RAISE.
   */
  canManage: boolean;
  loading: boolean;
  isError: boolean;
  /** Mutations — the SAME server-gated seams AgencyTeamPanel ships (§18). */
  setRole: (userId: string, role: string, scopedSubaccounts?: string[]) => Promise<PeopleMutationResult>;
  setStatus: (userId: string, status: "active" | "suspended") => Promise<PeopleMutationResult>;
  remove: (userId: string) => Promise<PeopleMutationResult>;
  invite: (args: {
    email: string;
    role?: "owner" | "admin" | "member";
    kind?: "team" | "consumer";
    expiresInDays?: number;
  }) => Promise<PeopleMutationResult>;
  refresh: () => void;
}

/** agency_list_team() row (typed, Args: never). */
interface AgencyTeamRow {
  user_id: string;
  email: string;
  full_name: string;
  is_you: boolean;
  joined_at: string;
  scoped_count: number;
  scoped_subaccounts: string[];
  agency_role: string;
  status: string;
}

const POLL = { refetchInterval: 45_000, refetchOnWindowFocus: true } as const;

const AGENCY_ROLE_LABEL: Record<string, string> = {
  agency_owner: "Owner",
  agency_admin: "Admin",
  agency_manager: "Manager",
  agency_biller: "Billing",
  agency_specialist: "Specialist",
  agency_viewer: "Viewer",
};
const AGENCY_MANAGER_ROLES = new Set(["agency_owner", "agency_admin", "agency_manager"]);
const TENANT_ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function nameOf(fullName: string | null, email: string | null): string {
  if (fullName && fullName.trim()) return fullName.trim();
  if (email && email.includes("@")) return email.split("@")[0];
  return "Teammate";
}

function titleCase(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

export function useAgencyPeople(ctx: AgencyShellCtx): AgencyPeopleData {
  const aggregate = isAgencyAggregate(ctx);
  const { activeTenant, activeTenantId } = useTenantContext();

  // ── AGENCY-AGGREGATE roster: agency_list_team() (gated OFF in own / acting mode) ──
  const team = useQuery({
    queryKey: ["agency-list-team"],
    enabled: aggregate,
    queryFn: async (): Promise<AgencyTeamRow[]> => {
      const { data, error } = await supabase.rpc("agency_list_team");
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as AgencyTeamRow[];
    },
    ...POLL,
  });

  // ── OWN-BOOK / ACTING roster: the sub's OWN members via useTeamRoster (RLS-scoped).
  // Always mounted (rules of hooks); fires ONLY when NOT aggregate. Never agency_list_team.
  const roster = useTeamRoster(!aggregate, activeTenantId);

  // ── Unified people rows ──
  const people = useMemo<AgencyPersonRow[]>(() => {
    if (aggregate) {
      return (team.data ?? []).map((m): AgencyPersonRow => ({
        userId: m.user_id,
        name: nameOf(m.full_name ?? null, m.email ?? null),
        email: m.email ?? null,
        role: m.agency_role,
        roleLabel: AGENCY_ROLE_LABEL[m.agency_role] ?? titleCase(m.agency_role),
        status: m.status,
        isYou: !!m.is_you,
        joinedAt: m.joined_at ?? null,
        isManager: AGENCY_MANAGER_ROLES.has(m.agency_role),
        scopedSubaccounts: Array.isArray(m.scoped_subaccounts) ? m.scoped_subaccounts : [],
        scopedCount: typeof m.scoped_count === "number" ? m.scoped_count : 0,
        utilization: null,
        hoursBooked: null,
        focus: null,
      }));
    }
    // Own-book: reshape RosterMember. Role = per-tenant role for the ACTIVE tenant
    // (#227 authoritative tenant_role / tenant_is_owner), NOT the global platform roles.
    return roster.members.map((m: RosterMember): AgencyPersonRow => {
      const role = m.tenant_is_owner ? "owner" : m.tenant_role ?? "member";
      return {
        userId: m.user_id,
        name: nameOf(m.full_name, m.email),
        email: m.email,
        role,
        roleLabel: TENANT_ROLE_LABEL[role] ?? titleCase(role),
        status: m.suspended_at ? "suspended" : "active",
        isYou: false, // useTeamRoster carries no "is you" flag; not a fabricated guess
        joinedAt: m.created_at ?? null,
        isManager: m.tenant_is_owner || m.tenant_role === "admin",
        scopedSubaccounts: null, // a sub's own staff have no sub-account scoping concept
        scopedCount: null,
        utilization: null,
        hoursBooked: null,
        focus: null,
      };
    });
  }, [aggregate, team.data, roster.members]);

  // ── Per-role breakdown (TEAM_ROLES) — REAL, derived ──
  const roles = useMemo<AgencyRoleSummary[]>(() => {
    const map = new Map<string, AgencyRoleSummary>();
    for (const p of people) {
      const existing = map.get(p.role);
      if (existing) {
        existing.count += 1;
        existing.names.push(p.name);
      } else {
        map.set(p.role, {
          role: p.role,
          label: p.roleLabel,
          count: 1,
          names: [p.name],
          isManager: p.isManager,
        });
      }
    }
    return Array.from(map.values());
  }, [people]);

  // ── Per-member sub-account assignments (TEAM_ACCOUNTS) — REAL scope; metrics Preview ──
  const accounts = useMemo<AgencyAccountAssignment[]>(() => {
    if (!aggregate) return []; // own-book staff have no cross-account assignments
    return people
      .filter((p) => (p.scopedCount ?? 0) > 0)
      .map((p): AgencyAccountAssignment => ({
        userId: p.userId,
        owner: p.name,
        scopedSubaccountIds: p.scopedSubaccounts ?? [],
        scopedCount: p.scopedCount ?? 0,
        hours: null,
        rate: null,
        load: null,
      }));
  }, [aggregate, people]);

  // ── Seats (TEAM_SEATS) — REAL from activeTenant.seat_limit + active member count ──
  const seats = useMemo<AgencySeats>(() => {
    const limit = typeof activeTenant?.seat_limit === "number" ? activeTenant.seat_limit : null;
    const used = people.filter((p) => p.status === "active").length;
    return {
      limit,
      used,
      available: limit === null ? null : Math.max(0, limit - used),
    };
  }, [activeTenant?.seat_limit, people]);

  const refresh = useCallback(() => {
    if (aggregate) void team.refetch();
    else roster.refresh();
  }, [aggregate, team, roster]);

  // ── Mutations ──
  // Agency-team management RPCs authorize on the AGENCY (agency_team_can_manage); they
  // only apply in agency-aggregate mode. In own / acting mode we reject honestly rather
  // than fire a server RAISE for a caller that isn't managing an agency team.
  const guardAgencyManage = useCallback((): PeopleMutationResult | null => {
    if (!aggregate) {
      return { ok: false, error: "Team-role management is available in the agency workspace." };
    }
    return null;
  }, [aggregate]);

  const setRole = useCallback(
    async (userId: string, role: string, scopedSubaccounts?: string[]): Promise<PeopleMutationResult> => {
      const blocked = guardAgencyManage();
      if (blocked) return blocked;
      const { error } = await supabase.rpc("agency_set_member_role", {
        _target_user: userId,
        _role: role,
        _scoped: role === "agency_specialist" ? scopedSubaccounts ?? [] : [],
      });
      if (error) return { ok: false, error: error.message };
      refresh();
      return { ok: true };
    },
    [guardAgencyManage, refresh],
  );

  const setStatus = useCallback(
    async (userId: string, status: "active" | "suspended"): Promise<PeopleMutationResult> => {
      const blocked = guardAgencyManage();
      if (blocked) return blocked;
      const { error } = await supabase.rpc("agency_set_member_status", {
        _target_user: userId,
        _status: status,
      });
      if (error) return { ok: false, error: error.message };
      refresh();
      return { ok: true };
    },
    [guardAgencyManage, refresh],
  );

  const remove = useCallback(
    async (userId: string): Promise<PeopleMutationResult> => {
      const blocked = guardAgencyManage();
      if (blocked) return blocked;
      const { error } = await supabase.rpc("agency_remove_member", { _target_user: userId });
      if (error) return { ok: false, error: error.message };
      refresh();
      return { ok: true };
    },
    [guardAgencyManage, refresh],
  );

  const invite = useCallback(
    async (args: {
      email: string;
      role?: "owner" | "admin" | "member";
      kind?: "team" | "consumer";
      expiresInDays?: number;
    }): Promise<PeopleMutationResult> => {
      const email = args.email.trim();
      if (!/.+@.+\..+/.test(email)) return { ok: false, error: "Enter a valid email." };
      // §51: mint for the caller's OWN / active tenant only — never a client-supplied id.
      // The RPC authorizes the mint server-side (§60 consumer/team tier guard).
      if (!activeTenantId) return { ok: false, error: "No active tenant to invite into." };
      const { data, error } = await supabase.rpc("create_tenant_invite_token", {
        _tenant_id: activeTenantId,
        _kind: args.kind ?? "team",
        _default_role: args.role ?? "member",
        _expires_in_days: args.expiresInDays ?? 30,
        _max_uses: null,
      });
      if (error) return { ok: false, error: error.message };
      const token = (data as { token?: string } | null)?.token;
      refresh();
      return { ok: true, token };
    },
    [activeTenantId, refresh],
  );

  return {
    mode: aggregate ? "agency" : "own",
    people,
    roles,
    accounts,
    seats,
    preview: { utilization: true, workload: true, activity: true },
    canManage: aggregate,
    loading: aggregate ? team.isLoading : roster.loading,
    isError: aggregate ? team.isError : !!roster.error,
    setRole,
    setStatus,
    remove,
    invite,
    refresh,
  };
}
