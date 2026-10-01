/**
 * capabilityTools — the map from the owner-facing capability domains shown on the Trust Compass to
 * the REAL governed tools behind them, and each tool's action-risk class.
 *
 * WHY THIS FILE EXISTS. The Solo Trust Compass lets an owner set how much Paige may do per
 * capability. The only genuinely tenant-writable governance seam is `set_tool_autonomy` (per TOOL
 * key → `tenant_tool_autonomy.mode`), and the runtime gate `resolve_tool_autonomy` reads it. The
 * owner does not think in 63 tool keys; they think in a handful of capabilities. This file is the
 * one place that grouping lives, so the surface never invents a capability with no real tool behind
 * it, and never offers a control the platform cannot honour.
 *
 * THE RISK CLASS IS NOT DECIDED HERE. It is a property of the ACTION and its one home is
 * `supabase/functions/_shared/action-risk.ts` (§18). This file carries a COPY of the class for each
 * tenant-relevant tool only so the browser can render the knob's ceiling without importing edge
 * code into the app bundle — and `capabilityTools.test.ts` imports the real policy and FAILS if any
 * copied class drifts from it, or if a mapped tool is a ghost the catalogue does not expose. A copy
 * guarded by a test is not a second source of truth; an unguarded copy would be.
 *
 * A CURATED SUBSET, NOT THE WHOLE CATALOGUE. `list_tool_autonomy` is a SHARED contract: it also
 * carries the MCP-door / operator acts (`tenant_create`, `agency_*`, `platform_post_notification`,
 * cross-tenant/privacy acts) that a Solo tenant's Trust Compass must NOT front (§9/§53). So this map
 * deliberately covers only the Solo-capability tools; the test records that subset relationship
 * (mapped ⊂ catalogue) rather than forcing every cross-tier act onto a Solo knob. Extending the Solo
 * surface to newly-catalogued Solo-relevant tools is a scoped §00 product decision, tracked separately.
 *
 * WHAT A RISK CLASS MEANS FOR A KNOB (mirrors the runtime clamp in `paige-ai-chat`):
 *   • ordinary   — the owner may set off / confirm / auto. The full range is real.
 *   • high       — the runtime clamps `auto` down to `confirm` before it ever runs, so offering
 *                  "Acts within guardrails" would be a control the platform neutralises (§70.1 — no
 *                  false affordance). The real choice is off / confirm; the knob caps at confirm.
 *   • owner_only — never performed from an assistant at any approval strength; this is the owner's
 *                  call in Settings, so the knob is read-only ("Your call").
 *
 * are not real tools (they exist only in a label switch and are `unclassified` in the risk policy,
 * so the runtime refuses them, fail-closed). Mapping them would put a knob in front of an action
 * that can never run. The drift test asserts they stay out.
 */

/** The three governed lanes, same literal union the backend uses. */
export type ToolMode = "auto" | "confirm" | "off";

/** The action-risk class, copied per tool below and guarded against action-risk.ts. */
export type ToolRisk = "ordinary" | "high" | "owner_only";

/** The five owner-facing postures (owner-approved 2026-09-05). */
export type Posture = "guardrails" | "asks" | "held" | "your_call" | "not_ready";

export interface CapabilityDomain {
  key: string;
  /** Owner-facing name. Never a category slug or a tool key. */
  title: string;
  /** Glyph key resolved against `Ic` in _shared. */
  icon: string;
  /** One plain line describing what this capability covers. */
  blurb: string;
}

/** The capability domains shown on the compass, in display order. Each has ≥1 real tool below. */
export const CAPABILITY_DOMAINS: readonly CapabilityDomain[] = [
  { key: "crm", title: "CRM & client records", icon: "users", blurb: "Contacts, notes, client files, and business profile." },
  { key: "pipeline", title: "Pipeline & work", icon: "grid", blurb: "Deals, stages, tasks, plans, and programs." },
  { key: "comms", title: "Communications", icon: "mail", blurb: "Phone numbers, carrier registration, and meetings." },
  { key: "content", title: "Content & Studio", icon: "spark", blurb: "Marketing drafts, images, documents, pages, and funnels." },
  { key: "autos", title: "Automations & connected apps", icon: "bolt", blurb: "Workflows, connected-app actions, and the action bus." },
  // Marketplace install/uninstall are undispatched tombstones (UNMAPPED_CATALOGUE_TOOLS), so this
  // domain governs only teammate access + invitations — the label must not claim "marketplace/installs"
  // it cannot affect (§70.1/§13). Rename here if a real install-governance seam ever lands.
  { key: "account", title: "Team access", icon: "shield", blurb: "Teammate roles, permissions, and invitations." },
] as const;

export type CapabilityKey = (typeof CAPABILITY_DOMAINS)[number]["key"];

/**
 * The governed tool → { capability domain, risk class }. Tool keys and the risk class are copied
 * from the catalogue (`list_tool_autonomy`) and the risk policy (`action-risk.ts`); the domain
 * grouping is this surface's own presentation. Guarded by `capabilityTools.test.ts`.
 */
export const TOOL_MAP: Readonly<Record<string, { capability: CapabilityKey; risk: ToolRisk }>> = {
  // ── CRM & client records ──────────────────────────────────────────────────────────────────
  // The delete knob fronts the GOVERNED tool (`crm_hard_delete_contact`, classified high behind
  // the crm-command executor). Its legacy namesake `crm_delete_contact` was retired with its edge
  // by PR-A and is deliberately absent.
  crm_create_contact: { capability: "crm", risk: "ordinary" },
  crm_update_contact: { capability: "crm", risk: "ordinary" },
  crm_hard_delete_contact: { capability: "crm", risk: "high" },
  crm_assign_coach: { capability: "crm", risk: "high" },
  crm_assign_contact: { capability: "crm", risk: "high" },
  crm_log_activity: { capability: "crm", risk: "ordinary" },
  crm_add_note: { capability: "crm", risk: "ordinary" },
  crm_file_document: { capability: "crm", risk: "high" },
  update_client_data: { capability: "crm", risk: "ordinary" },
  update_business_profile: { capability: "crm", risk: "ordinary" },
  propose_business_brief_update: { capability: "crm", risk: "ordinary" },
  save_to_knowledge_base: { capability: "crm", risk: "ordinary" },

  // ── Pipeline & work ───────────────────────────────────────────────────────────────────────
  // §00 FOLLOW-UP (Codex r7 F-D): mission_create/revise/transition are LIVE, HIGH-risk, Solo-facing
  // chat mutations (humanSurface /command-center/business-game-plan) NOT governed here — so
  // "Pipeline & work → Held" does not hold them. They are business-PLAN acts, a different concept than
  // this Pipeline/deals domain, so their governance HOME on the compass (a new "Business plan" domain,
  // or folding in) is a design/organization decision for CD/owner — deliberately not mis-filed under
  // Pipeline. Tracked in decision-log; the "curates a subset" test records the gap honestly.
  crm_update_pipeline_stage: { capability: "pipeline", risk: "ordinary" },
  crm_create_task: { capability: "pipeline", risk: "ordinary" },
  deal_create: { capability: "pipeline", risk: "ordinary" },
  deal_move_stage: { capability: "pipeline", risk: "ordinary" },
  pipeline_configure: { capability: "pipeline", risk: "ordinary" },
  plan_create: { capability: "pipeline", risk: "ordinary" },
  plan_add_milestone: { capability: "pipeline", risk: "ordinary" },
  plan_assign_task: { capability: "pipeline", risk: "ordinary" },
  plan_update_item: { capability: "pipeline", risk: "ordinary" },
  plan_set_reminder: { capability: "pipeline", risk: "ordinary" },
  plan_remove_item: { capability: "pipeline", risk: "high" },

  // ── Communications ────────────────────────────────────────────────────────────────────────
  comms_name_number: { capability: "comms", risk: "ordinary" },
  comms_draft_registration: { capability: "comms", risk: "ordinary" },
  comms_buy_number: { capability: "comms", risk: "high" },
  comms_set_primary_number: { capability: "comms", risk: "high" },
  calendar_book_meeting: { capability: "comms", risk: "high" },

  // ── Content & Studio ──────────────────────────────────────────────────────────────────────
  draft_marketing_content: { capability: "content", risk: "ordinary" },
  generate_image: { capability: "content", risk: "ordinary" },
  content_save: { capability: "content", risk: "ordinary" },
  document_generate: { capability: "content", risk: "ordinary" },
  growth_page_save: { capability: "content", risk: "ordinary" },
  growth_page_publish: { capability: "content", risk: "high" },
  growth_funnel_build: { capability: "content", risk: "ordinary" },
  growth_funnel_publish: { capability: "content", risk: "high" },

  // ── Automations & connected apps ──────────────────────────────────────────────────────────
  n8n_run_workflow: { capability: "autos", risk: "high" },
  n8n_activate_workflow: { capability: "autos", risk: "high" },
  n8n_deactivate_workflow: { capability: "autos", risk: "high" },
  n8n_create_workflow: { capability: "autos", risk: "high" },
  n8n_update_workflow: { capability: "autos", risk: "high" },
  n8n_archive_workflow: { capability: "autos", risk: "high" },
  // n8n_delete_workflow is a containment tombstone (see UNMAPPED_CATALOGUE_TOOLS) — no runtime
  // dispatches it, so a knob for it would govern nothing. Deliberately NOT mapped (§70.1).
  zapier_run_action: { capability: "autos", risk: "high" },
  delegate_to_subagent: { capability: "autos", risk: "high" },
  forge_subagent: { capability: "autos", risk: "ordinary" },
  automation_draft: { capability: "autos", risk: "ordinary" },
  automation_set_grant: { capability: "autos", risk: "owner_only" },
  automation_set_state: { capability: "autos", risk: "owner_only" },
  action_file: { capability: "autos", risk: "ordinary" },
  action_advance: { capability: "autos", risk: "ordinary" },
  author_event_kind: { capability: "autos", risk: "ordinary" },
  social_connection_start: { capability: "autos", risk: "high" },
  social_account_select: { capability: "autos", risk: "high" },
  social_connection_disconnect: { capability: "autos", risk: "high" },

  // ── Team access (marketplace install/uninstall are undispatched tombstones — see below) ─────
  member_grant_role: { capability: "account", risk: "high" },
  member_revoke_role: { capability: "account", risk: "high" },
  team_set_work_profile: { capability: "account", risk: "ordinary" },
  team_set_permission: { capability: "account", risk: "high" },
  team_invite_member: { capability: "account", risk: "high" },
  team_invite_resend: { capability: "account", risk: "high" },
  team_invite_revoke: { capability: "account", risk: "high" },
  // marketplace_install / marketplace_uninstall are containment tombstones (see below) — no runtime
  // dispatches them, so a knob would render as a working control and report a successful save for a
  // capability nothing can execute or govern. Deliberately NOT mapped (§70.1).
};

/**
 * Catalogue rows that are intentionally NOT governable knobs.
 * - `marketplace_install` / `marketplace_uninstall` / `n8n_delete_workflow`: containment TOMBSTONES —
 *   classified in the autonomy policy and lint-exempted (`action-risk-lint.mjs`) precisely because no
 *   runtime dispatches them (`20261020300000_tool_autonomy_catalogue_covers_the_gate.sql`). Governing
 *   them from the Trust Compass would be a §70.1 false affordance; they stay off the surface until a
 *   real dispatch path exists.
 */
export const UNMAPPED_CATALOGUE_TOOLS: readonly string[] = [
  "marketplace_install",
  "marketplace_uninstall",
  "n8n_delete_workflow",
];

const MODE_RANK: Readonly<Record<ToolMode, number>> = { off: 0, confirm: 1, auto: 2 };
const RANK_MODE: readonly ToolMode[] = ["off", "confirm", "auto"];

/** The highest mode a tool of this risk can genuinely reach at runtime. */
export function maxModeForRisk(risk: ToolRisk): ToolMode {
  return risk === "ordinary" ? "auto" : risk === "high" ? "confirm" : "off";
}

/** Clamp a desired mode down to what the tool's risk allows (never raises). */
export function clampModeToRisk(mode: ToolMode, risk: ToolRisk): ToolMode {
  const cap = maxModeForRisk(risk);
  return MODE_RANK[mode] <= MODE_RANK[cap] ? mode : cap;
}

/** min of two modes (the more restrictive). Used to fold the ceiling into the effective. */
export function minMode(a: ToolMode, b: ToolMode): ToolMode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b;
}

export function rankOfMode(mode: ToolMode): number {
  return MODE_RANK[mode];
}

export function modeOfRank(rank: number): ToolMode {
  return RANK_MODE[Math.max(0, Math.min(2, rank))];
}

/** The owner-facing posture for an EFFECTIVE mode and its tool risk. */
export function postureOf(effective: ToolMode, risk: ToolRisk): Posture {
  if (risk === "owner_only") return "your_call";
  return effective === "auto" ? "guardrails" : effective === "confirm" ? "asks" : "held";
}

export const POSTURE_LABEL: Readonly<Record<Posture, string>> = {
  guardrails: "Acts within guardrails",
  asks: "Asks first",
  held: "Held",
  your_call: "Your call",
  not_ready: "Not ready",
};

/** Tools that belong to a capability domain, in a stable order. */
export function toolsForCapability(key: CapabilityKey): string[] {
  return Object.keys(TOOL_MAP).filter((t) => TOOL_MAP[t].capability === key);
}
