/**
 * THE GOVERNED MCP DOOR, tested as a matrix over the REAL catalogue rather than a handful of cases.
 *
 * WHY IT IS DRIVEN FROM THE POLICY AND WHY THE COUNTS ARE STILL WRITTEN DOWN.
 * Every case below iterates `MCP_CAPABILITY_POLICY`, so adding a tool without a decision is
 * impossible to miss. That alone would be circular — a test that derives its expectations from the
 * thing under test agrees with anything — so the numbers that MATTER are pinned as literals: 117
 * tools, 51 reads, 66 mutations, 65 `approval_required`, exactly 1 `owner_only`. Emptying the
 * policy, flipping an effect, or quietly reclassifying a send breaks an arithmetic assertion here
 * before it can reach production.
 *
 * REAL CODE, NOT A DOUBLE. `decideMcpToolCall`, `decideGovernedExecution`, `classifyAction` and the
 * capability policy are the shipped modules. What this file asserts is what the door does.
 *
 * WHAT IT DOES NOT PROVE (§13/§32). This exercises the DECISION and the SHAPE of the chokepoint's
 * source. It is not authenticated runtime proof against the deployed function; that is a separate
 * evidence class and it is owed, not claimed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decideMcpToolCall,
  mcpGovernedAuditRow,
  MCP_LANE_NOT_RESOLVED,
  type McpGovernedInput,
} from "../../supabase/functions/_shared/paige-mcp/governed-adapter.ts";
import {
  MCP_CAPABILITY_POLICY,
  MCP_TOOL_COUNT,
  lookupMcpCapability,
} from "../../supabase/functions/_shared/paige-mcp/capability-policy.ts";
import { classifyAction, unclassifiedWriteReason } from "../../supabase/functions/_shared/action-risk.ts";

const ENTRIES = Object.entries(MCP_CAPABILITY_POLICY);
const READS = ENTRIES.filter(([, c]) => c.effect === "read");
const MUTATIONS = ENTRIES.filter(([, c]) => c.effect === "mutate");

const call = (over: Partial<McpGovernedInput> = {}): McpGovernedInput => ({
  tool: "search_contacts",
  args: {},
  authenticated: true,
  userId: "user-1",
  actorKind: "user",
  tenantId: "tenant-1",
  access: { allowed: true },
  startedAtMs: Date.now(),
  nowIso: "2026-09-05T00:00:00.000Z",
  ...over,
});

const decide = (over: Partial<McpGovernedInput> = {}) => decideMcpToolCall(call(over));

/** Governance values a model could try to write into its own arguments. Every one of them is a
 *  field some other surface reads for real, which is exactly why they are the dangerous ones. */
const FORGED_ARGS = {
  tenant_id: "some-other-tenant",
  tenantId: "some-other-tenant",
  workspace_id: "some-other-tenant",
  role: "super_admin",
  actor_role: "platform_admin",
  user_id: "someone-else",
  confirm: true,
  confirmed: true,
  approved: true,
  approval: { granted: true },
  claimedArgs: { anything: true },
  claimedFor: "crm_delete_contact",
  autonomy_lane: "auto",
  autonomyLane: "auto",
  principal: "person",
  access: { allowed: true },
  effect: "read",
  __proto__: { effect: "read" },
};

/**
 * The same forgery attempt, but with values that could not appear in a legitimate audit row by
 * coincidence. `FORGED_ARGS` is deliberately REALISTIC so the decision tests prove a plausible
 * `autonomy_lane: "auto"` is ignored; realistic values are useless for a leak check, because
 * "auto" is a substring of the payload's own `autonomy_lane` key and "read" of its `effect`. A
 * substring check that fires on the row's own vocabulary is a check somebody deletes.
 */
const SENTINEL_ARGS = Object.fromEntries(
  Object.keys(FORGED_ARGS).map((k, i) => [k, `zzsentinel${i}zz`]),
);
const SENTINELS = Object.values(SENTINEL_ARGS) as string[];

describe("the capability map is complete, and complete in both directions", () => {
  it("covers exactly the number of tools the door declares", () => {
    expect(ENTRIES.length).toBe(117);
    expect(MCP_TOOL_COUNT).toBe(117);
  });

  it("splits 51 reads / 66 mutations, as verified from the handler bodies", () => {
    expect(READS.length).toBe(51);
    expect(MUTATIONS.length).toBe(66);
  });

  it("carries handler-backed evidence on every single row", () => {
    for (const [tool, cap] of ENTRIES) {
      expect(cap.evidence, tool).toBeTruthy();
      // A row whose evidence names no location is a row nobody can re-verify, which is the same
      // as a row nobody verified.
      expect(cap.evidence, `${tool} evidence must cite a file:line`).toMatch(/:\d+/);
      expect(cap.canonical, tool).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("resolves EVERY mutation in the one classifier", () => {
    // A mutation whose canonical key is unknown to action-risk.ts is refused
    // `unclassified_mutation` at runtime — safe, but it means the map named a key that does not
    // exist, and the refusal would blame the act rather than the mapping.
    const unclassified = MUTATIONS.filter(([, c]) => classifyAction(c.canonical) === "unclassified");
    expect(unclassified.map(([t, c]) => `${t} → ${c.canonical}`)).toEqual([]);
  });

  it("keeps EVERY read out of the classifier and out of the write-shaped names", () => {
    // Both constraints come from the seam's step 6. A read whose key is classified is refused
    // `effect_mismatch`; a read whose key reads as a write is refused `unclassified_mutation`.
    // Either one turns a working read into a production outage, silently.
    const classified = READS.filter(([, c]) => classifyAction(c.canonical) !== "unclassified");
    expect(classified.map(([t, c]) => `${t} → ${c.canonical}`)).toEqual([]);
    const writeShaped = READS.filter(([, c]) => unclassifiedWriteReason(c.canonical) !== null);
    expect(writeShaped.map(([t, c]) => `${t} → ${c.canonical}`)).toEqual([]);
  });

  it("never lets one canonical key mean both a read and a change", () => {
    const readKeys = new Set(READS.map(([, c]) => c.canonical));
    const both = MUTATIONS.filter(([, c]) => readKeys.has(c.canonical));
    expect(both.map(([t, c]) => `${t} → ${c.canonical}`)).toEqual([]);
  });

  it("denies by default — an unmapped name resolves to nothing, including the prototype's", () => {
    // A plain-object lookup answers `constructor` and `__proto__` off the prototype chain, and a
    // truthy check downstream then treats an invented tool as classified.
    for (const name of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", ""]) {
      expect(lookupMcpCapability(name), name).toBeUndefined();
    }
  });
});

describe("the door's answer for all 117 tools", () => {
  it("allows every verified read", () => {
    const refused = READS.filter(([tool]) => decide({ tool }).outcome.kind !== "allow");
    expect(refused.map(([t]) => t)).toEqual([]);
  });

  it("refuses every verified mutation — 65 approval_required, exactly 1 owner_only", () => {
    const codes = MUTATIONS.map(([tool]) => {
      const { outcome } = decide({ tool });
      return outcome.kind === "refuse" ? outcome.code : `ALLOWED:${tool}`;
    });
    expect(codes.filter((c) => c === "approval_required").length).toBe(65);
    expect(codes.filter((c) => c === "owner_only").length).toBe(1);
    expect(codes.filter((c) => c !== "approval_required" && c !== "owner_only")).toEqual([]);
  });

  it("gives a machine credential exactly the same answers as a person", () => {
    // A platform API key is a verified credential with no person behind it. It reaches reads; it
    // must not reach a change, and it must not hear a DIFFERENT story about why.
    for (const [tool, cap] of ENTRIES) {
      const asUser = decide({ tool }).outcome;
      const asKey = decide({ tool, actorKind: "platform", userId: null }).outcome;
      expect(asKey.kind, tool).toBe(asUser.kind);
      if (asUser.kind === "refuse" && asKey.kind === "refuse") {
        expect(asKey.code, tool).toBe(asUser.code);
      }
      expect(cap.effect === "read" ? "allow" : "refuse", tool).toBe(asKey.kind);
    }
  });

  it("says owner_only ONLY where no approval would ever help", () => {
    const ownerOnly = MUTATIONS.filter(([tool]) => {
      const { outcome } = decide({ tool });
      return outcome.kind === "refuse" && outcome.code === "owner_only";
    });
    expect(ownerOnly.length).toBe(1);
    // The two messages must not be interchangeable: one sends a person to go and approve, the
    // other says there is nothing to approve. Telling somebody to fetch an approval that cannot
    // exist is the failure this distinction prevents.
    const [ownerTool] = ownerOnly[0];
    const owner = decide({ tool: ownerTool }).outcome;
    const ordinary = decide({ tool: MUTATIONS.find(([t]) => t !== ownerTool)![0] }).outcome;
    expect(owner.kind === "refuse" && owner.message).not.toBe(ordinary.kind === "refuse" && ordinary.message);
  });

  it("sends a caller to Paige only for an act Paige can actually perform", () => {
    // The near-miss worth recording: the no-home sentence first read "there is no approved path",
    // and the honesty check below caught it on the word "approved". The check is word-level and
    // cannot tell a denial of approval from a claim of one — so the sentence was reworded rather
    // than the guard narrowed. A blunt guard plus clear copy beats a clever guard.
    const home = ENTRIES.filter(([, c]) => c.effect === "mutate" && c.paigeHome);
    const away = ENTRIES.filter(([, c]) => c.effect === "mutate" && !c.paigeHome);
    expect(home.length).toBe(11);
    expect(away.length).toBe(55); // 54 approval_required + create_tenant, which is owner_only
    for (const [tool] of home) {
      const { outcome } = decide({ tool });
      expect(outcome.kind === "refuse" && outcome.message, tool).toContain("Ask Paige to do it");
    }
    for (const [tool] of away) {
      const { outcome } = decide({ tool });
      if (outcome.kind !== "refuse" || outcome.code === "owner_only") continue;
      expect(outcome.message, tool).toContain("no path through Paige");
      expect(outcome.message, tool).not.toContain("Ask Paige to do it");
    }
  });

  it("never describes a refusal as a success, a queue, a send or an approval", () => {
    // §13. The exact words matter: "queued", "sent", "will be", "pending" all tell a caller that
    // something is going to happen, and nothing is.
    const LIES = /\b(queued|queueing|sent|sending|scheduled|completed|succeeded|approved|pending|will be (sent|run|created)|has been)\b/i;
    for (const [tool] of ENTRIES) {
      const { outcome } = decide({ tool });
      if (outcome.kind !== "refuse") continue;
      expect(outcome.message, `${tool}: ${outcome.message}`).not.toMatch(LIES);
      expect(outcome.status, tool).toBe(403);
    }
  });
});

describe("named harm classes the owner asked to see refused, by name", () => {
  const refusedCode = (tool: string) => {
    const { outcome } = decide({ tool });
    return outcome.kind === "refuse" ? outcome.code : `ALLOWED`;
  };

  // Each list is pinned rather than filtered from the policy: filtering would pass against a
  // policy that had reclassified the whole class into `read`.
  const CLASSES: Array<[string, string[]]> = [
    ["deletes", ["delete_task", "delete_stage_automation_rule"]],
    ["outbound sends", ["send_btf_template_email", "send_transactional_email", "send_composed_email", "bulk_send_template_email"]],
    ["workflow and skill execution", ["run_workflow", "run_skill", "register_workflow", "cancel_workflow_run"]],
    ["billing", ["create_invoice", "send_invoice"]],
    ["privacy", ["handle_data_subject_request"]],
    ["provider dispatch", ["delegate_to_subagent", "compose_email", "verify_business", "cancel_workflow_run"]],
    ["workspace switching", ["switch_into_subaccount", "exit_subaccount"]],
    ["access and roles", ["assign_coach", "create_team_invitation", "bulk_assign_clients_to_coach"]],
    ["platform availability", ["suspend_tenant", "update_tenant_features", "broadcast_system_announcement", "update_tenant_branding"]],
  ];

  for (const [label, tools] of CLASSES) {
    it(`refuses every ${label}`, () => {
      for (const tool of tools) {
        expect(lookupMcpCapability(tool), `${tool} is not in the policy at all`).toBeDefined();
        expect(lookupMcpCapability(tool)!.effect, tool).toBe("mutate");
        expect(refusedCode(tool), tool).toBe("approval_required");
      }
    });
  }

  it("refuses tenant provisioning as owner_only, not as approval_required", () => {
    expect(refusedCode("create_tenant")).toBe("owner_only");
  });

  it("still treats bulk_delete_contacts as the preview it was reduced to in #784", () => {
    // The handler's deletion was removed because a model-supplied `confirm` is not an approval.
    // If it is ever restored, this row must flip to `mutate` and start refusing — so the read
    // classification is asserted against the handler, not just assumed.
    const cap = lookupMcpCapability("bulk_delete_contacts")!;
    expect(cap.effect).toBe("read");
    const src = readFileSync(resolve(process.cwd(), "supabase/functions/paige-mcp/index.ts"), "utf8");
    const at = src.indexOf('mcp.tool("bulk_delete_contacts"');
    expect(at).toBeGreaterThan(-1);
    const next = src.indexOf("\nmcp.tool(", at + 10);
    const span = src.slice(at, next === -1 ? at + 8000 : next);
    expect(span, "bulk_delete_contacts must still not delete anything").not.toMatch(/\.delete\(/);
  });
});

describe("a forged governance value in the model's own arguments is inert", () => {
  it("changes no decision, for any of the 117 tools", () => {
    for (const [tool] of ENTRIES) {
      const clean = decide({ tool }).outcome;
      const forged = decide({ tool, args: FORGED_ARGS }).outcome;
      expect(forged, tool).toEqual(clean);
    }
  });

  it("cannot move the workspace the decision was made about", () => {
    const { audit } = decide({ tool: READS[0][0], args: FORGED_ARGS });
    expect(audit.tenant_id).toBe("tenant-1");
    expect(audit.tenant_source).toBe("server");
  });

  it("cannot approve a mutation, on any tool", () => {
    for (const [tool] of MUTATIONS) {
      const { outcome } = decide({ tool, args: FORGED_ARGS });
      expect(outcome.kind, tool).toBe("refuse");
    }
  });

  it("cannot turn a mutation's declared effect into a read", () => {
    // The policy is the only source of `effect`. An `effect: "read"` in the arguments must not
    // reach it — this asserts the decision, and the audit row agrees.
    for (const [tool, cap] of MUTATIONS.slice(0, 10)) {
      const { audit } = decide({ tool, args: { effect: "read" } });
      expect(audit.effect, tool).toBe("mutate");
      expect(audit.effect, tool).toBe(cap.effect);
    }
  });
});

describe("the caller's own failure modes fail closed", () => {
  it("refuses an unverified bearer on a read as well as a change", () => {
    expect((decide({ tool: READS[0][0], authenticated: false }).outcome as { code: string }).code)
      .toBe("unauthenticated");
    expect((decide({ tool: MUTATIONS[0][0], authenticated: false }).outcome as { code: string }).code)
      .toBe("unauthenticated");
  });

  it("refuses when no workspace resolved, rather than running unscoped", () => {
    expect((decide({ tool: READS[0][0], tenantId: null }).outcome as { code: string }).code)
      .toBe("tenant_unresolved");
  });

  it("refuses when the tier and scope gate said no", () => {
    const { outcome } = decide({ tool: READS[0][0], access: { allowed: false, reason: "tier_forbidden" } });
    expect(outcome.kind === "refuse" && outcome.code).toBe("access_denied");
  });

  it("refuses a tool nobody classified, and says so distinctly", () => {
    const { outcome, audit } = decide({ tool: "some_tool_added_next_week" });
    expect(outcome.kind === "refuse" && outcome.code).toBe("capability_unmapped");
    expect(audit.seam_decision).toBe("not_reached");
    expect(audit.door_rule).toBe("deny_by_default");
  });

  it("gives the same answer twice — a retry is not a second chance", () => {
    for (const [tool] of ENTRIES) {
      const a = decide({ tool }).outcome;
      const b = decide({ tool }).outcome;
      const c = decide({ tool, args: { attempt: 2 } }).outcome;
      expect(b, tool).toEqual(a);
      expect(c, tool).toEqual(a);
    }
  });
});

describe("the durable record is safe to keep and honest about what happened", () => {
  it("writes a decision row for every attempt, allowed or refused", () => {
    for (const [tool] of ENTRIES) {
      const row = mcpGovernedAuditRow(decide({ tool }).audit);
      expect(["mcp_governed_allow", "mcp_governed_refuse"]).toContain(row.action);
      expect(row.target_type).toBe("mcp_tool");
    }
  });

  it("carries the workspace the decision was about, so its owner can read the row", () => {
    // On the COLUMN, not in the payload: the tenant-admin read policy on `paige_audit_log` gates on
    // `tenant_id = current_user_tenant_id()`, so a payload key would satisfy nothing. A governance
    // record the affected workspace cannot read is a write-only log.
    for (const [tool] of ENTRIES) {
      expect(mcpGovernedAuditRow(decide({ tool }).audit).tenant_id, tool).toBe("tenant-1");
    }
    // Null only when no workspace resolved — which is itself the refusal, not a silent gap.
    const unresolved = mcpGovernedAuditRow(decide({ tool: READS[0][0], tenantId: null }).audit);
    expect(unresolved.tenant_id).toBeNull();
  });

  it("never puts a tool NAME in the uuid column — the defect that erased this surface's history", () => {
    for (const [tool] of ENTRIES) {
      expect(mcpGovernedAuditRow(decide({ tool }).audit).target_id, tool).toBeNull();
    }
  });

  it("carries no arguments, no credentials and no caller-supplied text", () => {
    for (const [tool] of ENTRIES) {
      const row = mcpGovernedAuditRow(decide({ tool, args: SENTINEL_ARGS }).audit);
      const json = JSON.stringify(row);
      for (const leak of SENTINELS) {
        expect(json, `${tool} leaked ${leak}`).not.toContain(leak);
      }
      // Credential markers, independent of the arguments. Deliberately NOT the bare word
      // "authorization": `list_payment_authorizations` contains it in its own name, and a check
      // that fires on a legitimate tool name is one somebody weakens rather than fixes.
      for (const marker of ["Bearer ", "apikey", "service_role", "eyJ"]) {
        expect(json, `${tool} leaked ${marker}`).not.toContain(marker);
      }
    }
  });

  it("carries only the fields it declares, so a later addition is a deliberate act", () => {
    const row = mcpGovernedAuditRow(decide({ tool: MUTATIONS[0][0] }).audit);
    expect(Object.keys(row.payload).sort()).toEqual([
      "actor_kind", "autonomy_lane", "capability", "category", "decided_at", "decision",
      "decision_ms", "door_rule", "effect", "enforcement", "refusal_code", "risk",
      "seam_decision", "seam_refusal_code", "tenant_source", "tool",
    ]);
  });

  it("records that no autonomy lane was consulted, rather than implying one was", () => {
    const row = mcpGovernedAuditRow(decide({ tool: MUTATIONS[0][0] }).audit);
    expect(row.payload.autonomy_lane).toBe(MCP_LANE_NOT_RESOLVED);
    expect(MCP_LANE_NOT_RESOLVED).toBe("not_resolved");
  });

  it("names the door's own rule when the door, not the seam, made the call", () => {
    const mutation = decide({ tool: MUTATIONS.find(([t]) => t !== "create_tenant")![0] }).audit;
    expect(mutation.door_rule).toBe("mcp_carries_no_approval_channel");
    expect(mutation.decision).toBe("refuse");
    // A read is the seam's own answer, so no override is claimed.
    expect(decide({ tool: READS[0][0] }).audit.door_rule).toBeNull();
  });
});

describe("the chokepoint itself — the shape the decision depends on", () => {
  const SRC = readFileSync(resolve(process.cwd(), "supabase/functions/paige-mcp/index.ts"), "utf8");
  /** Strip `//` and block comments before matching. A previous version of this pattern matched its
   *  own JSDoc, so every assertion passed against a file that had stopped doing the thing. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("runs the governed door after the tier and scope gate and before dispatch", () => {
    const gate = code.indexOf("await enforceTierAndScope(peekedBody, actor)");
    const governed = code.indexOf("await governMcpToolCall(peekedBody, actor,");
    const dispatch = code.indexOf("await actorStore.run(actor, () => httpHandler(c.req.raw))");
    expect(gate).toBeGreaterThan(-1);
    expect(governed).toBeGreaterThan(gate);
    expect(dispatch).toBeGreaterThan(governed);
  });

  it("hands the seam the gate's own verdict, not a literal true", () => {
    expect(code).toContain("governMcpToolCall(peekedBody, actor, { allowed: gate.ok })");
  });

  it("resolves the workspace server-side and never from the request body", () => {
    const at = code.indexOf("async function governMcpToolCall(");
    expect(at).toBeGreaterThan(-1);
    const body = code.slice(at, code.indexOf("\n}\n", at));
    expect(body).toContain("actorTenantId()");
    // The only thing taken out of the request is the tool name and the arguments themselves.
    expect(body).not.toMatch(/tenantId\s*=\s*.*(params|body|rpc)\./);
    expect(body).toContain("args: rpc?.params?.arguments");
  });

  it("returns the refusal before the handler runs, so nothing has to be undone", () => {
    const governedCall = code.indexOf("const governed = await governMcpToolCall(");
    const refusalReturn = code.indexOf("if (!governed.ok) {", governedCall);
    const dispatch = code.indexOf("httpHandler(c.req.raw)", governedCall);
    expect(refusalReturn).toBeGreaterThan(governedCall);
    expect(refusalReturn).toBeLessThan(dispatch);
  });

  it("refuses a JSON-RPC batch rather than letting it slip past a single-object check", () => {
    expect(code).toContain("if (Array.isArray(body)) {");
    expect(code).toContain('code: "batch_not_governed"');
  });

  it("keeps the audit uuid repair, which every one of the call sites depends on", () => {
    expect(code).toContain("const isUuid = typeof target_id === \"string\" && AUDIT_UUID.test(target_id);");
    expect(code).toContain("target_id: isUuid ? target_id : null,");
    expect(code).toContain("...(!isUuid && target_id ? { target_ref: target_id } : {}),");
    // The repair is worthless if a second, unrepaired writer exists.
    expect((code.match(/\.from\("paige_audit_log"\)\s*\.insert\(/g) ?? []).length).toBe(1);
  });
});
