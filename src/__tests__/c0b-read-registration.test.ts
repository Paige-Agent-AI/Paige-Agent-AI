// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PAIGE_SPINE_CAPABILITIES as registry } from "../../supabase/functions/_shared/paige-spine/registry";
import type { SpineCapability } from "../../supabase/functions/_shared/paige-spine/contracts";
import { LEGACY_CAPABILITIES } from "../../supabase/functions/_shared/paige-capability-status/legacy-capabilities";
import { OWNER_OPS_BRANCH_TOOLS, authorityAdmits, requiresWorkspaceAdmin } from "../../supabase/functions/_shared/workspace-authority";
import { projectCapabilities } from "../../supabase/functions/_shared/paige-capability-status/projection";
import { mutatingTools } from "../../supabase/functions/_shared/action-risk";
const PAIGE_SPINE_CAPABILITIES: readonly SpineCapability[] = registry;

// Frozen BEFORE registration: preserve the entire branch's routing, including non-batch tools.
const OWNER_OPS_BEFORE = `crm_update_pipeline_stage crm_assign_coach crm_create_task crm_create_contact crm_update_contact
propose_business_brief_update update_business_profile pipeline_catalogue pipeline_archive_preview pipeline_folder_archive_preview pipeline_configure
deal_create deal_move_stage member_grant_role team_set_work_profile team_set_permission team_invite_member team_invite_resend team_invite_revoke member_revoke_role
calendar_book_meeting generate_image draft_marketing_content content_save document_generate growth_list growth_page_generate growth_page_save growth_form_save
growth_funnel_generate growth_funnel_build action_file action_advance inbox_list integrations_list capability_status contact_event_status
social_post social_analytics social_accounts improvement_propose improvement_list improvement_decide action_list action_get crm_list_team presence_who_online presence_is_online crm_assign_contact
zapier_list_actions zapier_run_action ghl_list_actions ghl_run_action crm_log_activity crm_add_note crm_list_documents crm_file_document
crm_search_contacts crm_get_contact_summary crm_list_deals crm_list_tasks crm_pipeline_summary comms_connection_summary comms_list_numbers comms_search_numbers comms_buy_number comms_name_number
comms_set_primary_number comms_registration_status comms_draft_registration comms_setup_calling`.split(/\s+/).sort();
const batch = [
  ["plan_list", "planning.list", "public.plan_list", "member"],
  ["action_list", "action_bus.list", "public.list_actions", "workspace-admin"],
  ["action_get", "action_bus.get", "public.list_actions", "workspace-admin"],
] as const;

describe("C0b canonical read declaration convergence", () => {
  it("preserves authority across every known registered and legacy Chat tool", () => {
    const outsideBefore = new Set(`list_subagents delegate_to_subagent forge_subagent propose_action read_email_campaigns read_email_campaign_audience email_campaign_draft email_campaign_request_approval read_email_series email_series_draft email_series_request_approval`.split(" "));
    const known = new Set([...Object.keys(LEGACY_CAPABILITIES), ...PAIGE_SPINE_CAPABILITIES.map((c) => c.action?.chatTool).filter((t): t is string => !!t), ...batch.map(([tool]) => tool)]);
    for (const tool of known) expect(requiresWorkspaceAdmin(tool, new Set()), tool).toBe(tool !== "capability_status" && (OWNER_OPS_BEFORE.includes(tool) || outsideBefore.has(tool)));
  });
  it("preserves the full owner-ops branch set and existing admitted authority combinations", () => {
    expect([...OWNER_OPS_BRANCH_TOOLS].sort()).toEqual(OWNER_OPS_BEFORE);
    for (const tool of ["action_list", "action_get"]) {
      expect(requiresWorkspaceAdmin(tool, new Set())).toBe(true);
      for (const workspaceAdmin of [false, true]) for (const platformOperator of [false, true]) for (const seat of [false, true]) {
        expect(authorityAdmits(tool, { workspaceAdmin, platformOperator, seat }, new Set())).toBe(workspaceAdmin || platformOperator);
      }
    }
    expect(requiresWorkspaceAdmin("plan_list", new Set())).toBe(false);
    expect(OWNER_OPS_BRANCH_TOOLS.has("unknown_unemitted_tool")).toBe(false);
    expect(authorityAdmits("unknown_unemitted_tool", { workspaceAdmin: false, platformOperator: false, seat: false }, new Set())).toBe(false);
  });
  it.each(batch)("registers %s with its actual executor, risk, seat and no false maturity upgrade", (tool, key, executor, seat) => {
    const cap = PAIGE_SPINE_CAPABILITIES.find((c) => c.action?.chatTool === tool);
    expect(cap).toMatchObject({ key, readiness: "none", maturity: "PARTIAL", mindBinding: "UNAVAILABLE",
      action: { chatTool: tool, executor, classification: "read", riskPolicyKey: "read_only", approvalAuthority: "none", seatAuthority: seat } });
    expect(LEGACY_CAPABILITIES[tool]).toBeUndefined();
    const baseline = JSON.parse(readFileSync("scripts/ci/capability-declaration-baseline.json", "utf8"));
    expect(baseline.some((row: { tool: string }) => row.tool === tool)).toBe(false);
  });
  it("preserves discovery and role projection parity when the declaration source changes", () => {
    for (const admin of [false, true]) {
      const common = { tools: batch.map(([name]) => ({ name, description: `Read ${name}.` })),
        isMutating: () => false, lanes: new Map(), workspaceAdminTools: new Set(["action_list", "action_get"]),
        isWorkspaceAdmin: admin, readiness: new Map() };
      const old = projectCapabilities({ ...common, spine: [], legacy: Object.fromEntries(batch.map(([tool]) => [tool, {
        domain: tool === "plan_list" ? "planning" : "action_bus", effect: "read", selfDescribe: tool !== "action_get", readiness: "none",
      }])) });
      const next = projectCapabilities({ ...common, spine: PAIGE_SPINE_CAPABILITIES, legacy: LEGACY_CAPABILITIES });
      const facts = (rows: typeof old) => rows.filter((r) => r.tool).map(({ tool, availability, reason, actionKind }) => ({ tool, availability, reason, actionKind }));
      expect(facts(next)).toEqual(facts(old));
      expect(next.filter((r) => r.tool).every((r) => r.source === "spine")).toBe(true);
    }
  });
  it("preserves full legacy/current registered projection, including internal action_get", () => {
    const restored = Object.fromEntries(batch.map(([tool]) => [tool, {
      domain: tool === "plan_list" ? "planning" : "action_bus", effect: "read" as const,
      selfDescribe: tool !== "action_get", readiness: "none" as const,
    }]));
    const oldSpine = PAIGE_SPINE_CAPABILITIES.filter((cap) => !batch.some(([, key]) => cap.key === key));
    const oldLegacy = { ...LEGACY_CAPABILITIES, ...restored };
    const names = new Set([...Object.keys(oldLegacy), ...PAIGE_SPINE_CAPABILITIES.map((c) => c.action?.chatTool).filter((t): t is string => !!t)]);
    for (const admin of [false, true]) {
      const common = { tools: [...names].map((name) => ({ name, description: `Read ${name}.` })),
        isMutating: (tool: string) => mutatingTools().has(tool), lanes: new Map(),
        workspaceAdminTools: new Set([...names].filter((t) => requiresWorkspaceAdmin(t, new Set()))),
        isWorkspaceAdmin: admin, readiness: new Map() };
      const prior = projectCapabilities({ ...common, spine: oldSpine, legacy: oldLegacy });
      const next = projectCapabilities({ ...common, spine: PAIGE_SPINE_CAPABILITIES, legacy: LEGACY_CAPABILITIES });
      const visibleFacts = (rows: typeof prior) => rows.map(({ key: _key, source: _source, ...facts }) => facts);
      expect(visibleFacts(next)).toEqual(visibleFacts(prior));
      expect(next.some((r) => r.tool === "action_get")).toBe(false);
    }
  });
});
