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
  [
    "crm_search_contacts",
    "crm_clients.search_contacts",
    "edge.paige-ai-chat",
    true,
    true
  ],
  [
    "crm_get_contact_summary",
    "crm_clients.contact_summary",
    "edge.paige-ai-chat",
    true,
    true
  ],
  [
    "crm_list_tasks",
    "crm_clients.list_tasks",
    "edge.paige-ai-chat",
    true,
    true
  ],
  [
    "crm_list_deals",
    "sales.crm_list_deals",
    "edge.paige-ai-chat",
    true,
    true
  ],
  [
    "crm_pipeline_summary",
    "sales.crm_pipeline_summary",
    "edge.paige-ai-chat",
    true,
    true
  ],
  [
    "pipeline_catalogue",
    "sales.pipeline_catalogue",
    "public.get_pipeline_catalogue",
    true,
    true
  ],
  [
    "pipeline_archive_preview",
    "sales.pipeline_archive_preview",
    "public.prepare_pipeline_archive_as_paige",
    true,
    false
  ],
  [
    "pipeline_folder_archive_preview",
    "sales.pipeline_folder_archive_preview",
    "public.prepare_pipeline_folder_archive_as_paige",
    true,
    false
  ]
] as const;
const spine: readonly SpineCapability[] = PAIGE_SPINE_CAPABILITIES;

describe("C0b existing CRM and Pipeline reads/preparations", () => {
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
