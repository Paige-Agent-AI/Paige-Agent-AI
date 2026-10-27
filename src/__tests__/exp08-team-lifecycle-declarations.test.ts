// @vitest-environment node
// EXP08 team lifecycle — the Spine declarations of PAIGE's two team reads and five team writes.
import { it, expect } from "vitest";
import type { SpineCapability } from "../../supabase/functions/_shared/paige-spine/contracts";
import {
  TEAM_LIFECYCLE_CAPABILITIES, TEAM_LIFECYCLE_TOOLS, TEAM_LIFECYCLE_READ_TOOL_NAMES, TEAM_LIFECYCLE_WRITE_TOOL_NAMES,
} from "../../supabase/functions/_shared/paige-spine/domains/team_lifecycle";
import { PAIGE_SPINE_CAPABILITIES, validateSpineRegistry } from "../../supabase/functions/_shared/paige-spine/registry";
import { classifyAction } from "../../supabase/functions/_shared/action-risk";
import { requiresWorkspaceAdmin, OWNER_OPS_BRANCH_TOOLS } from "../../supabase/functions/_shared/workspace-authority";

const reads = [
  ["team_list_members", "public.get_solo_team_workspace", "member", false],
  ["team_member_holdings", "public.team_member_holdings", "door-seat", true],
] as const;
const writes = [
  ["team_suspend_member", "public.suspend_solo_team_member"],
  ["team_reinstate_member", "public.reinstate_solo_team_member"],
  ["team_remove_member", "public.remove_solo_team_member"],
  ["team_set_conversations", "public.set_solo_team_member_team_hub_access"],
  ["team_handover_work", "public.plan_update_item_versioned"],
] as const;
const capabilities: readonly SpineCapability[] = TEAM_LIFECYCLE_CAPABILITIES;
const byTool = (tool: string) => capabilities.find((c) => c.action?.chatTool === tool);

it("declares exactly the seven tools the chat offers, and nothing else", () => {
  expect(capabilities.map((c) => c.action?.chatTool).sort()).toEqual([...reads.map(([t]) => t), ...writes.map(([t]) => t)].sort());
  expect(TEAM_LIFECYCLE_TOOLS.map((t) => t.function.name).sort()).toEqual(capabilities.map((c) => c.action?.chatTool).sort());
  expect([...TEAM_LIFECYCLE_READ_TOOL_NAMES].sort()).toEqual(reads.map(([t]) => t).sort());
  expect([...TEAM_LIFECYCLE_WRITE_TOOL_NAMES].sort()).toEqual(writes.map(([t]) => t).sort());
});

it("composes into the registry and passes its validator", () => {
  for (const c of capabilities) expect(PAIGE_SPINE_CAPABILITIES).toContain(c);
  expect(validateSpineRegistry(capabilities)).toEqual([]);
});

it.each(reads)("%s is a read on its existing definer, admitted at its definer's own seat rule", (tool, executor, seat, admin) => {
  expect(byTool(tool)).toMatchObject({ domain: "team", readiness: "none", chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE",
    action: { classification: "read", executor, riskPolicyKey: "read_only", approvalAuthority: "none", seatAuthority: seat } });
  expect(classifyAction(tool)).toBe("unclassified");
  expect(requiresWorkspaceAdmin(tool, new Set())).toBe(admin);
});

it.each(writes)("%s is a high, card-approved mutation on %s, owner/admin seat only", (tool, executor) => {
  expect(byTool(tool)).toMatchObject({ domain: "team", readiness: "none", selfDescribe: true, chatBinding: "LIVE",
    action: { classification: "mutate", executor, riskPolicyKey: "high", approvalAuthority: "chat-canonical", seatAuthority: "door-seat" } });
  expect(classifyAction(tool)).toBe("high");
  expect(requiresWorkspaceAdmin(tool, new Set())).toBe(true);
  expect(OWNER_OPS_BRANCH_TOOLS.has(tool)).toBe(false);
  expect(byTool(tool)!.action!.idempotency.length).toBeGreaterThan(60);
});

it("tells PAIGE to read holdings and offer hand-over before removal, and states the authority rule", () => {
  const description = (name: string) => TEAM_LIFECYCLE_TOOLS.find((t) => t.function.name === name)!.function.description;
  expect(description("team_remove_member")).toMatch(/ALWAYS read team_member_holdings first.*offer to hand it over BEFORE proposing removal/);
  for (const name of ["team_suspend_member", "team_reinstate_member", "team_remove_member", "team_set_conversations", "team_member_holdings"])
    expect(description(name)).toMatch(/owner acts on admins and members, an admin acts on members only, and nobody acts on the owner or on themselves/);
  expect(description("team_list_members")).toMatch(/Never shows email addresses/);
});
