// Team — the LIVE OPS FLOOR (IA slice 1c-ix). Replaces the 1c-v placeholder EmptyState
// (§18: extend the existing surface, no new route — this stays at /admin/team, aliases
// /admin/members, /admin/coaches). A working surface: COMPACT plain PageHeader (§11 banner
// rule — the floor leads, no hero), scoreboard + live availability, handoff queue, members
// & roles, assignments, and a reserved comp panel.
//
// HONESTY (§13): AVAILABILITY, MEMBERS, and ASSIGNMENTS render REAL data. SCOREBOARD and
// HANDOFF QUEUE render crafted EmptyStates because no producer writes their data yet — the
// queries + realtime are REAL, so they fill the instant a producer starts. COMP is reserved.
// No fabricated numbers, no fake rows, no "Paige noticed" language.
//
// §9: NO client-supplied tenant_id. Presence RPCs derive tenant server-side; scoreboard/
// handoff are RLS-only reads; activeTenantId (from useTenantContext) appears ONLY inside the
// realtime filter strings. View filters are client-side and never leak higher-tier scope to
// a lower role.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, ArrowLeftRight, Wallet } from "lucide-react";
import { PageShell, PageHeader, SectionNote, StatePill } from "@/components/ui/page";
import { RoleGate } from "@/components/auth/RoleGate";
import { useUserRoles } from "@/hooks/useUserRoles";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useCommandCenterView } from "@/hooks/useCommandCenterView";
import {
  resolvePersona,
  TEAM_VIEW_ENABLED,
  type CommandCenterView,
} from "@/lib/roleViews/commandCenterRegistry";
import { useTeamRoster } from "@/hooks/useTeamRoster";
import { useTeamScoreboard } from "@/hooks/useTeamScoreboard";
import { useHandoffQueue } from "@/hooks/useHandoffQueue";
import { TeamViewToggle } from "@/components/team/TeamViewToggle";
import { TeamScoreboard } from "@/components/team/TeamScoreboard";
import { AvailabilityRail } from "@/components/team/AvailabilityRail";
import { HandoffQueuePanel } from "@/components/team/HandoffQueuePanel";
import { MembersRolesPanel } from "@/components/team/MembersRolesPanel";
import { AssignmentsPanel } from "@/components/team/AssignmentsPanel";

function TeamFloor() {
  const { roles, userId } = useUserRoles();
  const { activeTenantId, activeTenant, isPlatformOwner } = useTenantContext();

  // Presentation-only persona/view resolution — NEVER gates a data read (§9), mirrors
  // PracticeOverview. Team stays gated OFF until TEAM_VIEW_ENABLED flips.
  const isOwner = (!!userId && activeTenant?.owner_user_id === userId) || isPlatformOwner;
  const persona = resolvePersona(roles, isOwner);
  const availableViews = useMemo<CommandCenterView[]>(
    () => persona.views.filter((v) => v !== "team" || TEAM_VIEW_ENABLED),
    [persona.views],
  );
  const { view, setView, canSwitch } = useCommandCenterView(availableViews, persona.defaultView, "paige_team_view");

  // "My Queue" narrows to the signed-in user; a platform owner in "business" also collapses
  // to their own scope so RLS never surfaces every tenant's rows (§9, mirrors PracticeOverview).
  const effectiveMine = view === "mine" || (view === "business" && isPlatformOwner);
  const restrictToUserId = effectiveMine ? userId : null;

  // Shared roster (one admin-list-users call; self-degrades to empty for non-admins, §13).
  // #227: pass the active tenant so the roster carries per-tenant ownership/role and
  // filters out ancestor agency owners (Part C/E).
  const roster = useTeamRoster(true, activeTenantId);
  const scoreboard = useTeamScoreboard(activeTenantId);
  const handoffs = useHandoffQueue(activeTenantId);

  const canManagePresence =
    isPlatformOwner || roles.includes("admin") || roles.includes("manager");

  // "My Queue" handoff filter (client-side; never a tenant param, never widens a lower role).
  const handoffItems = useMemo(() => {
    if (!effectiveMine || !userId) return handoffs.items;
    return handoffs.items.filter(
      (h) =>
        h.to_user_id_target === userId ||
        h.from_user_id === userId ||
        (h.to_role_target != null && roles.includes(h.to_role_target)),
    );
  }, [handoffs.items, effectiveMine, userId, roles]);

  const ownerUnscoped = isPlatformOwner && !activeTenantId;
  const hasHandoffs = handoffItems.length > 0;

  // H2: /admin/coaches redirects to /admin/team?role=coach — open the roster coach-filtered.
  const [params] = useSearchParams();
  const roleParam = params.get("role");

  return (
    <PageShell width="wide">
      <PageHeader
        variant="plain"
        title="Team"
        description="Your team's live operations floor — staff, availability, and handoffs in one place."
        actions={canSwitch ? <TeamViewToggle views={availableViews} value={view} onChange={setView} /> : undefined}
      />

      {/* TIER 1 — the real work leads: the staff console + live availability, then
          a populated handoff queue (H5 — kept proactively visible, not buried), then
          assignments. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <MembersRolesPanel
          members={roster.members}
          loading={roster.loading}
          refresh={roster.refresh}
          initialRoleFilter={roleParam}
        />
        <AvailabilityRail
          tenantId={activeTenantId}
          rolesByUser={roster.rolesByUser}
          canManage={canManagePresence}
        />
      </div>

      {hasHandoffs && (
        <HandoffQueuePanel
          items={handoffItems}
          memberById={roster.memberById}
          refresh={handoffs.refresh}
          ownerUnscoped={ownerUnscoped}
        />
      )}

      <AssignmentsPanel memberById={roster.memberById} restrictToUserId={restrictToUserId} />

      {/* TIER 2 — quiet sections: present as real cards when a producer has written,
          collapse to a one-line note when empty (no viewport-eating plates). */}
      {!scoreboard.loading && scoreboard.rows.length > 0 ? (
        <TeamScoreboard
          rows={scoreboard.rows}
          loading={scoreboard.loading}
          memberById={roster.memberById}
          rolesByUser={roster.rolesByUser}
          restrictToUserId={restrictToUserId}
        />
      ) : !scoreboard.loading ? (
        <SectionNote icon={BarChart3}>
          Team scoreboard — rep performance populates here once your reps start recording.
        </SectionNote>
      ) : null}

      {!hasHandoffs && (ownerUnscoped ? (
        <HandoffQueuePanel
          items={handoffItems}
          memberById={roster.memberById}
          refresh={handoffs.refresh}
          ownerUnscoped={ownerUnscoped}
        />
      ) : (
        <SectionNote icon={ArrowLeftRight}>
          Handoff queue — leads teed up to move between teammates land here to accept.
        </SectionNote>
      ))}

      {/* FOOTER — reserved roadmap capability as one muted strip, never a full card. */}
      <SectionNote icon={Wallet} action={<StatePill state="roadmap">Roadmap</StatePill>}>
        Compensation — commission, splits, and payouts will run from here.
      </SectionNote>
    </PageShell>
  );
}

export default function TeamHub() {
  // The whole floor is staff-only; Members & Roles inside stays admin-only (its own gate).
  // A non-staff user gets RoleGate's default "Restricted area" panel.
  return (
    <RoleGate allow={["admin", "sales_rep", "cs_rep", "finance", "manager", "owner", "viewer"]}>
      <TeamFloor />
    </RoleGate>
  );
}
