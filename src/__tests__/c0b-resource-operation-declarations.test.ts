// @vitest-environment node
import { describe, expect, it } from "vitest";
import { C0B_RESOURCE_OPERATION_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/domains/c0b_resource_operations";
import { LEGACY_CAPABILITIES } from "../../supabase/functions/_shared/paige-capability-status/legacy-capabilities";
import { classifyAction, mutatingTools } from "../../supabase/functions/_shared/action-risk";
import { projectCapabilities, type Lane } from "../../supabase/functions/_shared/paige-capability-status/projection";

// Frozen incumbent declarations, not expectations derived from the new declarations.
const prior = [
  ["deep_research", "research_knowledge", "read", false, true, "research_provider"],
  ["save_to_knowledge_base", "research_knowledge", "mutate", false, true, "none"],
  ["web_fetch", "research_knowledge", "read", false, true, "none"],
  ["web_search", "research_knowledge", "read", false, true, "research_provider"],
  ["automation_draft", "automations", "mutate", false, true, "none"],
  ["comms_buy_number", "communications", "external_effect", true, true, "none"],
  ["comms_connection_summary", "communications", "read", true, true, "none"],
  ["comms_draft_registration", "communications", "mutate", true, true, "none"],
  ["comms_list_numbers", "communications", "read", true, true, "none"],
  ["comms_name_number", "communications", "mutate", true, false, "none"],
  ["comms_registration_status", "communications", "read", true, true, "none"],
  ["comms_search_numbers", "communications", "read", true, true, "none"],
  ["comms_set_primary_number", "communications", "mutate", true, true, "none"],
] as const;
describe("C0b incumbent resource operations", () => {
  it.each(prior)("preserves %s incumbent authority and discovery", (tool, domain, classification, admin, selfDescribe, readiness) => {
    const cap = C0B_RESOURCE_OPERATION_CAPABILITIES.find(c => c.action?.chatTool === tool);
    expect(cap).toMatchObject({ domain, selfDescribe, readiness, maturity: "PARTIAL", mindBinding: "UNAVAILABLE", chatBinding: "LIVE",
      action: { classification, riskPolicyKey: classification === "read" ? "read_only" : classifyAction(tool),
        approvalAuthority: classification === "read" ? "none" : "chat-canonical", seatAuthority: admin ? "workspace-admin" : "member" } });
    expect(cap?.action?.idempotency.length).toBeGreaterThan(70);
  });
  it("preserves visible facts for admin/member and confirm/auto/off, including provider unavailable", () => {
    const legacy = Object.fromEntries(prior.map(([tool,domain,effect,,selfDescribe,readiness]) => [tool,{domain,effect,selfDescribe,readiness}]));
    for (const isWorkspaceAdmin of [false,true]) for (const lane of ["confirm","auto","off"] as Lane[]) {
      const input = {tools: prior.map(([name])=>({name,description:`Existing ${name}.`})), isMutating:(tool:string)=>mutatingTools().has(tool),
        lanes:new Map(prior.map(([name])=>[name,lane])), workspaceAdminTools:new Set(prior.filter(r=>r[3]).map(r=>r[0])),
        isWorkspaceAdmin, readiness:new Map()};
      const before=projectCapabilities({...input,spine:[],legacy});
      const after=projectCapabilities({...input,spine:C0B_RESOURCE_OPERATION_CAPABILITIES,legacy:{}});
      const facts=(rows:typeof before)=>rows.map(({key:_key,source:_source,...rest})=>rest);
      expect(facts(after)).toEqual(facts(before));
    }
  });
  it("does not reinterpret owner-only automation setters", () => {
    for(const tool of ["automation_set_grant","automation_set_state"]) {
      expect(C0B_RESOURCE_OPERATION_CAPABILITIES.some(c=>c.action?.chatTool===tool)).toBe(false);
      expect(LEGACY_CAPABILITIES[tool]).toBeDefined();
    }
    expect(classifyAction("automation_set_grant")).toBe("owner_only");
    expect(classifyAction("automation_set_state")).toBe("owner_only");
  });
});
