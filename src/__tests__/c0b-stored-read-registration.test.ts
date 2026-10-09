// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry";
import type { SpineCapability } from "../../supabase/functions/_shared/paige-spine/contracts";
import { LEGACY_CAPABILITIES } from "../../supabase/functions/_shared/paige-capability-status/legacy-capabilities";
import { requiresWorkspaceAdmin } from "../../supabase/functions/_shared/workspace-authority";
import { projectCapabilities } from "../../supabase/functions/_shared/paige-capability-status/projection";
import { mutatingTools } from "../../supabase/functions/_shared/action-risk";

// Captured from the existing legacy rows and actual handler before registration.
const batch = [
  ["automation_list", "automations.list", "edge.paige-ai-chat", false, true],
  ["automation_triggers_list", "automations.triggers_list", "edge.paige-ai-chat", false, false],
  ["document_pending_reviews", "research_knowledge.document_pending_reviews", "edge.paige-ai-chat", false, false],
  ["document_resume_review", "research_knowledge.document_resume_review", "edge.paige-ai-chat", false, false],
  ["crm_list_documents", "crm_clients.list_documents", "edge.paige-ai-chat", true, true],
  ["improvement_list", "platform_meta.improvement_list", "edge.paige-ai-chat", true, false],
  ["crm_list_team", "team.list_team", "public.list_team_members", true, true],
  ["presence_who_online", "team.presence_who_online", "public.presence_list_online", true, true],
  ["presence_is_online", "team.presence_is_online", "public.presence_check_user", true, false],
  ["get_client_rail", "crm_clients.client_rail", "public.get_client_rail_for_chat", false, true],
  ["list_event_kinds", "crm_clients.event_kinds", "public.list_event_kinds", false, true],
] as const;
const spine: readonly SpineCapability[] = PAIGE_SPINE_CAPABILITIES;

describe("C0b existing stored-state reads", () => {
  it.each(batch)("declares %s without changing executor, seat, readiness, visibility or maturity", (tool, key, executor, admin, selfDescribe) => {
    expect(spine.find((c) => c.action?.chatTool === tool)).toMatchObject({ key, selfDescribe,
      readiness: "none", humanSurface: "PAIGE workspace", maturity: "PARTIAL", mindBinding: "UNAVAILABLE",
      action: { chatTool: tool, executor, classification: "read", riskPolicyKey: "read_only",
        approvalAuthority: "none", seatAuthority: admin ? "workspace-admin" : "member" } });
    expect(requiresWorkspaceAdmin(tool, new Set())).toBe(admin);
    expect(mutatingTools().has(tool)).toBe(false);
    expect(LEGACY_CAPABILITIES[tool]).toBeUndefined();
    const baseline = JSON.parse(readFileSync("scripts/ci/capability-declaration-baseline.json", "utf8"));
    expect(baseline.some((r: { tool: string }) => r.tool === tool)).toBe(false);
  });
  it("preserves complete prior/current discovery, including unavailable and member-refused rows", () => {
    const restored = Object.fromEntries(batch.map(([tool, key, , , selfDescribe]) => [tool, {
      domain: key.split(".")[0], effect: "read" as const, selfDescribe, readiness: "none" as const,
    }]));
    const oldSpine = spine.filter((c) => !batch.some(([, key]) => c.key === key));
    const oldLegacy = { ...LEGACY_CAPABILITIES, ...restored };
    const names = new Set([...Object.keys(oldLegacy), ...spine.map((c) => c.action?.chatTool).filter((t): t is string => !!t)]);
    for (const admin of [false, true]) {
      const common = { tools: [...names].map((name) => ({ name, description: `Read ${name}.` })),
        isMutating: (tool: string) => mutatingTools().has(tool), lanes: new Map(),
        workspaceAdminTools: new Set([...names].filter((t) => requiresWorkspaceAdmin(t, new Set()))),
        isWorkspaceAdmin: admin, readiness: new Map() };
      const old = projectCapabilities({ ...common, spine: oldSpine, legacy: oldLegacy });
      const next = projectCapabilities({ ...common, spine, legacy: LEGACY_CAPABILITIES });
      const visible = (rows: typeof old) => rows.map(({ key: _key, source: _source, ...facts }) => facts);
      expect(visible(next)).toEqual(visible(old));
      expect(next.filter((r) => batch.some(([tool]) => tool === r.tool)).every((r) => r.source === "spine")).toBe(true);
    }
  });
});
