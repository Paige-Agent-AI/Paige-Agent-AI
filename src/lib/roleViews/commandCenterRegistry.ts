// Command Center role→persona→view registry (IA slice 1c-vii).
//
// This is PLATFORM-DEFAULT, coaching-generic PRESENTATION config (§9 operator
// layer) — identical for every tenant, not tenant-authored data — so it lives as a
// TS registry in code, NOT a DB table (a table would falsely imply per-tenant
// authorship + need RLS + a read binding for zero benefit today; §18 keeps nav/lens
// config in code already). Adding a view = editing this file; wiring a 1c-ix role =
// ONE line in ROLE_TO_PERSONA — no migration, no schema change (the owner's ask).
//
// It adds ZERO new data path: it only SELECTS which existing, already-tenant-scoped
// KPIs/rails/panels a persona sees. The honesty gates are structural (§13):
//  - KpiKey/RailKey unions list ONLY keys that exist in practice_dashboard_metrics /
//    practice_attention_queue, so a metric with no real source (show-rate,
//    cash-collected, …) cannot compile into a tile.
//  - 5 net-new personas are status:"planned", unmapped, never rendered until 1c-ix
//    assigns the enum role.

/** KPI keys — MUST equal keys on PracticeMetrics (usePracticeDashboard). */
export type KpiKey =
  | "active_clients"
  | "won_value_cents"
  | "active_retainers"
  | "pipeline_value_cents";

/** Rail keys — MUST equal keys on PracticeAttention. */
export type RailKey =
  | "at_risk_clients"
  | "follow_ups_due"
  | "upcoming_sessions_7d"
  | "tasks_due"
  | "onboarding_in_progress";

export type PanelKey = "kpis" | "needs_today" | "open_pipeline";
export type CommandCenterView = "mine" | "team" | "business";

export interface PersonaView {
  id: string;
  /** on-voice label, zero jargon (§3), §2-inclusive (never hardwire "coaching"). */
  label: string;
  description: string;
  /** "active" renders today; "planned" is defined-but-dormant (§13) — never mapped
   *  from a real role, never rendered, until 1c-ix assigns it. */
  status: "active" | "planned";
  kpis: KpiKey[];
  rail: RailKey[];
  railEmphasis?: RailKey;
  panels: PanelKey[];
  /** show the gold "Drafts awaiting you" approvals act (identity-driven, not view-driven). */
  showApprovalsAct: boolean;
  /** show the Export button in the header. */
  showExport: boolean;
  /** views this persona MAY switch between (Team is filtered out until TEAM_VIEW_ENABLED). */
  views: CommandCenterView[];
  defaultView: CommandCenterView;
}

export const PERSONAS: Record<string, PersonaView> = {
  owner: {
    id: "owner", label: "Practice owner",
    description: "The people you serve, the revenue in motion, and what's waiting on you today.",
    status: "active",
    kpis: ["active_clients", "won_value_cents", "active_retainers", "pipeline_value_cents"],
    rail: ["at_risk_clients", "follow_ups_due", "upcoming_sessions_7d", "tasks_due", "onboarding_in_progress"],
    railEmphasis: "at_risk_clients",
    panels: ["kpis", "needs_today", "open_pipeline"],
    showApprovalsAct: true, showExport: true,
    views: ["mine", "business"], defaultView: "business",
  },
  // §2: never hardwire "coaching" in shared copy — this role is delivery staff across
  // coaching/consulting/agency verticals, so the heading reads "Client delivery".
  coach: {
    id: "coach", label: "Client delivery",
    description: "Your clients, their sessions, and what needs a personal touch today.",
    status: "active",
    kpis: ["active_clients", "active_retainers"],
    rail: ["at_risk_clients", "upcoming_sessions_7d", "onboarding_in_progress", "tasks_due", "follow_ups_due"],
    railEmphasis: "at_risk_clients",
    panels: ["kpis", "needs_today"],
    showApprovalsAct: true, showExport: false,
    views: ["mine"], defaultView: "mine",
  },
  sales: {
    id: "sales", label: "Sales",
    description: "Your pipeline, the deals in motion, and the follow-ups that close them.",
    status: "active",
    kpis: ["pipeline_value_cents", "won_value_cents"],
    rail: ["follow_ups_due", "upcoming_sessions_7d"],
    railEmphasis: "follow_ups_due",
    panels: ["kpis", "needs_today", "open_pipeline"],
    showApprovalsAct: true, showExport: false,
    views: ["mine"], defaultView: "mine",
  },
  client_success: {
    id: "client_success", label: "Client success",
    description: "Who's at risk, who's onboarding, and who needs you this week.",
    status: "active",
    kpis: ["active_clients", "active_retainers"],
    rail: ["at_risk_clients", "onboarding_in_progress", "upcoming_sessions_7d", "tasks_due"],
    railEmphasis: "at_risk_clients",
    panels: ["kpis", "needs_today"],
    showApprovalsAct: true, showExport: false,
    views: ["mine"], defaultView: "mine",
  },
  finance: {
    id: "finance", label: "Finance",
    description: "Revenue booked, retainers running, and the value still in your pipeline.",
    status: "active",
    kpis: ["won_value_cents", "active_retainers", "pipeline_value_cents"],
    rail: ["follow_ups_due"],
    panels: ["kpis", "open_pipeline"],
    showApprovalsAct: false, showExport: true,
    views: ["mine", "business"], defaultView: "business",
  },
  // Least-privileged read-only persona: trimmed of whole-team revenue/pipeline
  // (won/pipeline). practice_dashboard_metrics is role-blind, so the registry can
  // only narrow what this persona is SHOWN, not enforce RPC-level tiering — the
  // deeper role-gate on the RPC is a filed follow-up (#413).
  viewer: {
    id: "viewer", label: "Overview",
    description: "A read-only view of the practice at a glance.",
    status: "active",
    kpis: ["active_clients", "active_retainers"],
    rail: ["at_risk_clients", "follow_ups_due", "upcoming_sessions_7d", "tasks_due", "onboarding_in_progress"],
    panels: ["kpis", "needs_today", "open_pipeline"],
    showApprovalsAct: false, showExport: false,
    views: ["mine"], defaultView: "mine",
  },

  // ── Planned personas — defined for 1c-ix, DORMANT today (§13). Unreferenced by
  //    ROLE_TO_PERSONA, so they never map from a real role and never render. KPIs
  //    they will need but that have NO source today live in DEFERRED_KPIS, not
  //    invented here. When 1c-ix ships the enum role it adds ONE ROLE_TO_PERSONA
  //    line — no reshape, no migration.
  sales_manager: {
    id: "sales_manager", label: "Sales manager",
    description: "Your team's pipeline and the deals moving across every rep.",
    status: "planned",
    kpis: ["pipeline_value_cents", "won_value_cents"], rail: ["follow_ups_due"],
    panels: ["kpis", "open_pipeline"],
    showApprovalsAct: true, showExport: false,
    views: ["mine", "team", "business"], defaultView: "team",
  },
  setter: {
    id: "setter", label: "Appointment setter",
    description: "The calls to make and the meetings to set today.",
    status: "planned",
    kpis: [], rail: ["upcoming_sessions_7d", "follow_ups_due"], panels: ["needs_today"],
    showApprovalsAct: true, showExport: false,
    views: ["mine"], defaultView: "mine",
  },
  closer: {
    id: "closer", label: "Closer",
    description: "The deals on your desk and the revenue you're bringing home.",
    status: "planned",
    kpis: ["pipeline_value_cents", "won_value_cents"],
    rail: ["upcoming_sessions_7d", "follow_ups_due"], panels: ["kpis", "needs_today", "open_pipeline"],
    showApprovalsAct: true, showExport: false,
    views: ["mine"], defaultView: "mine",
  },
  success_coach: {
    id: "success_coach", label: "Success coach",
    description: "Who's at risk, who's onboarding, and who needs you this week.",
    status: "planned",
    kpis: ["active_clients", "active_retainers"],
    rail: ["at_risk_clients", "onboarding_in_progress", "upcoming_sessions_7d", "tasks_due"],
    railEmphasis: "at_risk_clients", panels: ["kpis", "needs_today"],
    showApprovalsAct: true, showExport: false,
    views: ["mine", "team"], defaultView: "mine",
  },
  ops_manager: {
    id: "ops_manager", label: "Operations manager",
    description: "Tasks, follow-ups, and onboarding across the whole operation.",
    status: "planned",
    kpis: ["active_clients"], rail: ["tasks_due", "follow_ups_due", "onboarding_in_progress"],
    panels: ["kpis", "needs_today"],
    showApprovalsAct: true, showExport: false,
    views: ["mine", "team", "business"], defaultView: "business",
  },
};

/** Real, assignable role/flag → persona. "owner" is a computed flag (not an
 *  app_role enum): resolvePersona injects the synthetic "owner" role when the
 *  active tenant's owner_user_id === userId, before lookup. 1c-ix appends its
 *  enum roles here (one line each). */
export const ROLE_TO_PERSONA: Record<string, string> = {
  owner: "owner",
  admin: "owner",
  sales_rep: "sales",
  cs_rep: "client_success",
  finance: "finance",
  viewer: "viewer",
  // 1c-ix: sales_manager, setter, closer, success_coach, ops_manager
};

/** Highest authority wins for a multi-hat user. */
export const PERSONA_PRECEDENCE = [
  "owner", "admin", "sales_rep", "cs_rep", "finance", "viewer",
] as const;

export function resolvePersona(roles: string[], isOwner: boolean): PersonaView {
  const effective = isOwner ? ["owner", ...roles] : roles;
  for (const r of PERSONA_PRECEDENCE) {
    const pid = ROLE_TO_PERSONA[r];
    if (effective.includes(r) && pid) {
      const p = PERSONAS[pid];
      if (p && p.status === "active") return p; // never resolve to a planned persona
    }
  }
  return PERSONAS.viewer; // safe default: read-only, no act, no export
}

/** Team-view source is not built yet (§13). Flip to true in 1c-ix when the
 *  per-manager direct-reports rollup exists; until then "team" is filtered out of
 *  every persona's selectable views (never backfilled from agency/operator RPCs —
 *  those cross the §9 tier seam). */
export const TEAM_VIEW_ENABLED = false;

/** Honest ledger of role KPIs the owner named that have NO real source today.
 *  Documented, not rendered — each is OUTSIDE the KpiKey union so it cannot compile
 *  into a tile. Each must gain a real RPC/column before it can become a KpiKey. */
export const DEFERRED_KPIS = [
  { key: "show_rate", needs: "bookings held vs. scheduled — no booking-outcome column" },
  { key: "close_rate", needs: "won deals vs. opportunities per owner — no per-user deal attribution" },
  { key: "cash_collected", needs: "payments received in window — no collections aggregate RPC" },
  { key: "calls_today", needs: "dials/calls logged today — no call-activity source" },
  { key: "bookings_set", needs: "meetings set today — no per-user booking-created rollup" },
  { key: "invoices_overdue", needs: "dunning at tenant level — no billing metric on the attention queue" },
] as const;
