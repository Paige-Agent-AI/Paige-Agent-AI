// @vitest-environment node
//
// C0a — the capability PROJECTION (docs/delivery/paige-conversational-loop-r0.md §20 + the owner's
// acceptance list A–J). The manifest is derived from the tools actually emitted this turn and their
// canonical declarations; nothing PAIGE can do is listed by hand. These tests pin the properties the
// owner ruled on, each written so that reinstating the old defect fails it.
import { describe, expect, it } from "vitest";
import {
  labelFromDescription,
  PLANNED_CAPABILITIES,
  PROJECTION_REASON,
  projectCapabilities,
  type ProjectionInput,
  type SpineDeclarationLike,
} from "../../supabase/functions/_shared/paige-capability-status/projection";
import { CAPABILITY_TRUTH_RULE, renderProjectedCapabilityBlock } from "../../supabase/functions/_shared/paige-capability-status/render";
import { CAPABILITY_STATUS_TOOL } from "../../supabase/functions/_shared/paige-capability-gateway/gateway";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry";
import { mutatingTools } from "../../supabase/functions/_shared/action-risk";

const MUTATING = mutatingTools();

function input(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    tools: [],
    spine: [],
    legacy: {},
    isMutating: (t) => MUTATING.has(t),
    lanes: new Map(),
    workspaceAdminTools: new Set(),
    isWorkspaceAdmin: true,
    readiness: new Map(),
    ...over,
  };
}

const byTool = (rows: ReturnType<typeof projectCapabilities>) =>
  Object.fromEntries(rows.filter((r) => r.tool).map((r) => [r.tool, r]));

describe("A — a newly registered capability appears with no projection change", () => {
  it("projects a fake read capability the moment it is registered and emitted", () => {
    const fake: SpineDeclarationLike = {
      key: "operations.delivery_project_read", domain: "operations",
      action: { classification: "read", chatTool: "operations_read_project" },
    };
    const rows = projectCapabilities(input({
      spine: [fake],
      tools: [{ name: "operations_read_project", description: "Read a delivery project. Returns its milestones." }],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "operations.delivery_project_read", family: "operations", availability: "live", source: "spine",
      label: "Read a delivery project.",
    });
  });

  it("projects a registered write as needs-approval until the lane is auto", () => {
    const fake: SpineDeclarationLike = {
      key: "operations.delivery_project_create", domain: "operations",
      action: { classification: "mutate", chatTool: "operations_create_project" },
    };
    const tools = [{ name: "operations_create_project", description: "Create a delivery project." }];
    expect(projectCapabilities(input({ spine: [fake], tools }))[0].availability).toBe("needs_approval");
    expect(projectCapabilities(input({
      spine: [fake], tools, lanes: new Map([["operations_create_project", "auto"]]),
    }))[0].availability).toBe("live");
  });
});

describe("B / J — a capability not emitted this turn is not claimed", () => {
  it("drops a tool the moment it is no longer on the surface (disabled, retired, out of Studio scope)", () => {
    const spine: SpineDeclarationLike[] = [
      { key: "crm.a", domain: "crm", action: { classification: "read", chatTool: "crm_a" } },
      { key: "crm.b", domain: "crm", action: { classification: "read", chatTool: "crm_b" } },
    ];
    const both = projectCapabilities(input({
      spine, tools: [{ name: "crm_a", description: "A." }, { name: "crm_b", description: "B." }],
    }));
    const one = projectCapabilities(input({ spine, tools: [{ name: "crm_a", description: "A." }] }));
    expect(both.map((r) => r.tool)).toEqual(["crm_a", "crm_b"]);
    expect(one.map((r) => r.tool)).toEqual(["crm_a"]);
  });

  it("does not offer a journey-stage move when no such chat tool exists (the R0 over-claim)", () => {
    const rows = projectCapabilities(input({
      spine: PAIGE_SPINE_CAPABILITIES as unknown as SpineDeclarationLike[],
      tools: [{ name: "crm_search_contacts", description: "Search contacts." }],
    }));
    expect(rows.some((r) => r.tool === "crm_advance_journey_stage" || r.key === "crm.advance_journey_stage")).toBe(false);
  });
});

describe("C — a provider that is not ready reads needs-setup, never approval", () => {
  const spine: SpineDeclarationLike[] = [{
    key: "integrations.n8n_list_workflows", domain: "integrations", readiness: "n8n_connection",
    action: { classification: "read", chatTool: "n8n_list_workflows" },
  }];
  const tools = [{ name: "n8n_list_workflows", description: "List workflows." }];

  it("not_ready → needs_setup with what to connect", () => {
    const [row] = projectCapabilities(input({ spine, tools, readiness: new Map([["n8n_connection", "not_ready"]]) }));
    expect(row.availability).toBe("needs_setup");
    expect(row.reason).toMatch(/n8n/i);
  });
  it("ready → live; unconfirmed → an attempt (proof owed), never a promise and never a setup claim", () => {
    expect(projectCapabilities(input({ spine, tools, readiness: new Map([["n8n_connection", "ready"]]) }))[0].availability).toBe("live");
    for (const readiness of [new Map([["n8n_connection", "unknown"]]), new Map()] as const) {
      const [row] = projectCapabilities(input({ spine, tools, readiness: readiness as ProjectionInput["readiness"] }));
      expect(row.availability).toBe("proof_owed");
      expect(row.reason).toBe(PROJECTION_REASON.unconfirmedConnection);
    }
  });
});

describe("D — workspace role decides admin-only tools (ADMIN IS A TENANT ROLE)", () => {
  const spine: SpineDeclarationLike[] = [{ key: "team.invite", domain: "team", action: { classification: "mutate", chatTool: "team_invite_member" } }];
  const tools = [{ name: "team_invite_member", description: "Invite a teammate." }];
  const gate = new Set(["team_invite_member"]);

  it("a member sees the tool as needing the owner or an admin — not 'wrong account type'", () => {
    const [row] = projectCapabilities(input({ spine, tools, workspaceAdminTools: gate, isWorkspaceAdmin: false }));
    expect(row.availability).toBe("not_for_tier");
    expect(row.reason).toMatch(/owner or an admin/);
  });
  it("the workspace's owner/admin sees it on its real lane", () => {
    const [row] = projectCapabilities(input({ spine, tools, workspaceAdminTools: gate, isWorkspaceAdmin: true }));
    expect(row.availability).toBe("needs_approval");
  });
  it("role outranks readiness and lane (most restrictive wins)", () => {
    const [row] = projectCapabilities(input({
      spine, tools, workspaceAdminTools: gate, isWorkspaceAdmin: false,
      lanes: new Map([["team_invite_member", "auto"]]),
    }));
    expect(row.availability).toBe("not_for_tier");
  });
});

describe("D2 — governed-door tools are described by the door's own seat rule", () => {
  const spine: SpineDeclarationLike[] = [
    { key: "crm.contact_archive", domain: "crm", action: { classification: "mutate", chatTool: "crm_archive_contact" } },
    { key: "crm.contact_create", domain: "crm", action: { classification: "mutate", chatTool: "crm_create_contact" } },
  ];
  const tools = [{ name: "crm_archive_contact", description: "Archive." }, { name: "crm_create_contact", description: "Create." }];
  const door = new Set(["crm_archive_contact", "crm_create_contact"]);
  it("a member sees EVERY door tool as needing the owner or an admin — not just the ones in the owner-ops set", () => {
    const rows = byTool(projectCapabilities(input({ spine, tools, workspaceAdminTools: door, isWorkspaceAdmin: false })));
    expect(rows.crm_archive_contact.availability).toBe("not_for_tier");
    expect(rows.crm_create_contact.availability).toBe("not_for_tier");
  });
  it("the per-tool authority answer is used (an operator acting-as holds no door seat)", () => {
    const rows = byTool(projectCapabilities(input({
      spine, tools, workspaceAdminTools: door, isWorkspaceAdmin: (t) => !door.has(t),
    })));
    expect(rows.crm_archive_contact.availability).toBe("not_for_tier");
  });
});

describe("E — the lane is the decision, and an unknown lane never over-claims auto", () => {
  const spine: SpineDeclarationLike[] = [{ key: "crm.x", domain: "crm", action: { classification: "mutate", chatTool: "crm_x" } }];
  const tools = [{ name: "crm_x", description: "X." }];
  it("missing lane → needs approval", () => {
    expect(projectCapabilities(input({ spine, tools }))[0].availability).toBe("needs_approval");
  });
  it("off → needs approval with the manual reason", () => {
    const [row] = projectCapabilities(input({ spine, tools, lanes: new Map([["crm_x", "off"]]) }));
    expect(row.availability).toBe("needs_approval");
    expect(row.reason).toMatch(/manual/);
  });
});

describe("legacy (C0b worklist) and undeclared rows", () => {
  it("an unregistered legacy tool projects from its classification row", () => {
    const [row] = projectCapabilities(input({
      tools: [{ name: "web_search", description: "Search the web. Returns cited results." }],
      legacy: { web_search: { domain: "research_knowledge", effect: "read", selfDescribe: true, readiness: "research_provider" } },
      readiness: new Map([["research_provider", "not_ready"]]),
    }));
    expect(row).toMatchObject({ family: "research_knowledge", availability: "needs_setup", source: "legacy" });
  });
  it("an internal helper stays callable but out of her self-description", () => {
    const rows = projectCapabilities(input({
      tools: [{ name: "pipeline_archive_preview", description: "Preview." }],
      legacy: { pipeline_archive_preview: { domain: "crm_clients", effect: "read", selfDescribe: false, readiness: "none" } },
    }));
    expect(rows).toHaveLength(0);
  });
  it("an undeclared tool is still projected (honest) and flagged for CI", () => {
    const [row] = projectCapabilities(input({ tools: [{ name: "mystery_tool", description: "Does a thing." }] }));
    expect(row.source).toBe("undeclared");
  });
});

describe("the real registry", () => {
  it("every self-described Spine chat tool projects as source=spine; internal tools stay hidden", () => {
    const spine = PAIGE_SPINE_CAPABILITIES as unknown as SpineDeclarationLike[];
    const tools = spine.filter((c) => c.action?.chatTool).map((c) => ({ name: c.action!.chatTool!, description: "x." }));
    const rows = byTool(projectCapabilities(input({ spine, tools })));
    for (const c of spine) {
      if (!c.action?.chatTool) continue;
      if (c.selfDescribe === false) {
        expect(rows[c.action.chatTool], c.key).toBeUndefined();
        continue;
      }
      expect(rows[c.action.chatTool]?.source, c.key).toBe("spine");
    }
  });

  it("team management and deal moves are claimed when their tools are emitted (the R0 under-claims)", () => {
    const rows = byTool(projectCapabilities(input({
      spine: PAIGE_SPINE_CAPABILITIES as unknown as SpineDeclarationLike[],
      tools: [
        { name: "team_invite_member", description: "Invite a teammate." },
        { name: "deal_move_stage", description: "Move a deal to another stage." },
      ],
    })));
    expect(rows.team_invite_member.availability).toBe("needs_approval");
    expect(rows.deal_move_stage.availability).toBe("needs_approval");
  });
});

describe("render", () => {
  it("groups by availability then family, names the tool, and prints the reason once", () => {
    const rows = projectCapabilities(input({
      spine: [
        { key: "crm.read", domain: "crm", action: { classification: "read", chatTool: "crm_read" } },
        { key: "integrations.a", domain: "integrations", readiness: "n8n_connection", action: { classification: "read", chatTool: "n8n_a" } },
        { key: "integrations.b", domain: "integrations", readiness: "n8n_connection", action: { classification: "read", chatTool: "n8n_b" } },
      ],
      tools: [{ name: "crm_read", description: "R." }, { name: "n8n_a", description: "A." }, { name: "n8n_b", description: "B." }],
      readiness: new Map([["n8n_connection", "not_ready"]]),
      planned: PLANNED_CAPABILITIES,
    }));
    const text = renderProjectedCapabilityBlock(rows, [{ name: "Research Scout", domain: "research" }]);
    expect(text).not.toContain(PROJECTION_REASON.confirm); // the heading already says it
    expect(text).toContain("- crm: crm_read");
    expect(text).toContain("- integrations: n8n_a, n8n_b — Connect your n8n account first.");
    expect(text.match(/Connect your n8n account first/g)).toHaveLength(1);
    expect(text).toContain("never read out tool names");
    expect(text).toContain("- research: Research Scout");
    expect(text).toContain("Publish a post to your social accounts");
  });

  it("keeps the MANUAL lane's reason so 'off' never reads like 'confirm'", () => {
    const spine: SpineDeclarationLike[] = [
      { key: "crm.a", domain: "crm", action: { classification: "mutate", chatTool: "crm_a" } },
      { key: "crm.b", domain: "crm", action: { classification: "mutate", chatTool: "crm_b" } },
    ];
    const rows = projectCapabilities(input({
      spine, tools: [{ name: "crm_a", description: "A." }, { name: "crm_b", description: "B." }],
      lanes: new Map([["crm_a", "off"], ["crm_b", "confirm"]]),
    }));
    const text = renderProjectedCapabilityBlock(rows);
    expect(text).toContain(`- crm: crm_a — ${PROJECTION_REASON.manual}`);
    expect(text).toMatch(/^- crm: crm_b$/m);
  });

  it("returns empty for an empty projection so nothing is injected", () => {
    expect(renderProjectedCapabilityBlock([])).toBe("");
  });
});

// SURFACE-AWARE SELF-KNOWLEDGE (owner addition 2026-10-05). What PAIGE can do comes from this block;
// what the owner TELLS her is coming is the owner's account; the platform's own roadmap and delivery
// state is operator scope and never hers to claim in a workspace. The rule lives here, once, beside
// the projection it protects (§18) — never as a hand-kept capability list.
describe("surface-aware self-knowledge — capability truth vs what the owner says", () => {
  const block = (over: Partial<ProjectionInput> = {}) => renderProjectedCapabilityBlock(projectCapabilities(input({
    spine: [{ key: "crm.read", domain: "crm", action: { classification: "read", chatTool: "crm_read" } }],
    tools: [{ name: "crm_read", description: "Read a contact." }],
    ...over,
  })));

  it("A/E — the block carries the attribution and contradiction contract, in the owner's words", () => {
    const text = block();
    expect(text).toContain(CAPABILITY_TRUTH_RULE);
    // A: owner-described plans are acknowledged as THEIRS, never as her own knowledge or tracking
    expect(CAPABILITY_TRUTH_RULE).toContain("Based on what you're telling me");
    expect(CAPABILITY_TRUTH_RULE).toMatch(/never as something you know or are tracking yourself/);
    // no program/roadmap visibility from a workspace
    expect(CAPABILITY_TRUTH_RULE).toMatch(/no view of the platform's roadmap, build or release status/);
    // E: the owner saying it is live does not make it live
    expect(CAPABILITY_TRUTH_RULE).toContain(
      "That's the direction you've given me, but this workspace does not currently expose that capability to me yet.",
    );
    // …but that line is the LAST resort: a claim the report places in another state is answered with
    // that state, and the scenario-E line is reserved for what the report does not offer at all.
    const stateFirst = CAPABILITY_TRUTH_RULE.indexOf("answer with the state this report gives it");
    const lastResort = CAPABILITY_TRUTH_RULE.indexOf("Only when it is not listed as something you can do at all");
    expect(stateFirst).toBeGreaterThan(-1);
    expect(lastResort).toBeGreaterThan(stateFirst);
    expect(CAPABILITY_TRUTH_RULE.indexOf("That's the direction you've given me")).toBeGreaterThan(lastResort);
    for (const state of ["needs approval before it goes ahead", "needs a connection or setup first", "needs the owner or an admin", "not proven here yet"]) {
      expect(CAPABILITY_TRUTH_RULE).toContain(state);
    }
  });

  it("the rule's referent is true wherever it is read — the prompt block AND the capability_status tool's note", () => {
    // The same constant is the tool result's `note`, where there is no block to point at.
    expect(CAPABILITY_TRUTH_RULE).toContain("this capability report");
    expect(CAPABILITY_TRUTH_RULE).not.toMatch(/this block/i);
    // §18: the tool description points at the note rather than restating the rule in its own words.
    const description = CAPABILITY_STATUS_TOOL.function.description;
    expect(description).toContain("Follow the result's note on what the person tells you.");
    expect(description).not.toMatch(/their account|being built|coming soon/i);
  });

  it("C — a capability shipped and emitted this turn reads CAN DO NOW with no edit to the rule or the renderer", () => {
    const text = block({
      spine: [
        { key: "crm.read", domain: "crm", action: { classification: "read", chatTool: "crm_read" } },
        { key: "sales.invoice_read", domain: "sales", action: { classification: "read", chatTool: "sales_read_invoice" } },
      ],
      tools: [{ name: "crm_read", description: "Read a contact." }, { name: "sales_read_invoice", description: "Read an invoice." }],
    });
    const live = text.slice(text.indexOf("CAN DO NOW"));
    expect(live).toMatch(/^- sales: sales_read_invoice$/m);
    // …and the moment it is no longer emitted it is gone again: the rule names no capability itself
    expect(block()).not.toContain("sales_read_invoice");
    expect(CAPABILITY_TRUTH_RULE).not.toMatch(/invoice|marketing|sales/i);
  });

  it("B — the workspace block holds no operator briefing or program-state text", () => {
    const text = block({ planned: PLANNED_CAPABILITIES });
    for (const operatorOnly of ["OPERATOR BRIEFING", "DOCTRINE §-INDEX", "PLATFORM SNAPSHOT", "CURRENT GAPS", "Real ARR"]) {
      expect(text).not.toContain(operatorOnly);
    }
  });

  it("the capability_status tool names every state it can return, including the not-yet-proven one", () => {
    expect(CAPABILITY_STATUS_TOOL.function.description).toContain("proof_owed");
  });
});

describe("labelFromDescription", () => {
  it("takes the first sentence, falls back to the name, and caps length", () => {
    expect(labelFromDescription("x", "Do the thing. Then more.")).toBe("Do the thing.");
    expect(labelFromDescription("crm_list_deals", "")).toBe("crm list deals");
    expect(labelFromDescription("x", "a".repeat(300)).length).toBeLessThanOrEqual(110);
  });
});
